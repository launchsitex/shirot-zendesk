import type { CallRecord, DashboardFilters, Kpis } from "@/lib/types";

/** Effective wait until answer (answered) or hang-up (missed). */
export function inboundWaitSeconds(call: CallRecord): number | null {
  if (call.direction !== "inbound" || call.status === "in_progress") {
    return null;
  }
  if (call.waitTimeSeconds > 0) return call.waitTimeSeconds;
  if (call.status === "missed") return Math.max(0, call.durationSeconds);
  if (call.durationSeconds > call.talkTimeSeconds) {
    return Math.max(0, call.durationSeconds - call.talkTimeSeconds);
  }
  return 0;
}

/**
 * A missed inbound call where the customer waited no longer than the
 * admin-configured threshold before hanging up. Display-only classification —
 * call.status stays "missed" in the DB either way.
 */
export function isShortNoAnswer(
  call: CallRecord,
  thresholdSeconds: number,
): boolean {
  if (call.status !== "missed" || thresholdSeconds <= 0) return false;
  const wait = inboundWaitSeconds(call);
  return wait !== null && wait <= thresholdSeconds;
}

export function calculateKpis(
  calls: CallRecord[],
  thresholdSeconds: number,
): Kpis {
  // Exclude live/in-progress calls so totals match answered + missed + outbound.
  const completed = calls.filter((call) => call.status !== "in_progress");
  const inbound = completed.filter((call) => call.direction === "inbound");
  const answered = inbound.filter((call) => call.status === "answered");
  const missedCalls = inbound.filter((call) => call.status === "missed");
  const missed = missedCalls.filter(
    (call) => !isShortNoAnswer(call, thresholdSeconds),
  );
  const missedShort = missedCalls.filter((call) =>
    isShortNoAnswer(call, thresholdSeconds),
  );
  const outbound = completed.filter((call) => call.direction === "outbound");
  const completedWithTalk = completed.filter(
    (call) => call.talkTimeSeconds > 0,
  );
  const totalTalkSeconds = completedWithTalk.reduce(
    (sum, call) => sum + call.talkTimeSeconds,
    0,
  );

  const asaValues = answered
    .map(inboundWaitSeconds)
    .filter((value): value is number => value !== null);
  const waitValues = inbound
    .map(inboundWaitSeconds)
    .filter((value): value is number => value !== null);

  const answerRateBase = answered.length + missed.length;

  return {
    total: completed.length,
    inbound: inbound.length,
    outbound: outbound.length,
    answered: answered.length,
    missed: missed.length,
    missedShort: missedShort.length,
    answerRate: answerRateBase
      ? Math.round((answered.length / answerRateBase) * 100)
      : 0,
    totalTalkSeconds,
    averageTalkSeconds: completedWithTalk.length
      ? Math.round(totalTalkSeconds / completedWithTalk.length)
      : 0,
    averageAsaSeconds: asaValues.length
      ? Math.round(
          asaValues.reduce((sum, value) => sum + value, 0) / asaValues.length,
        )
      : 0,
    averageWaitSeconds: waitValues.length
      ? Math.round(
          waitValues.reduce((sum, value) => sum + value, 0) / waitValues.length,
        )
      : 0,
  };
}

export type DepartmentWaitStats = {
  departmentId: string | null;
  departmentName: string;
  inbound: number;
  answered: number;
  totalWaitSeconds: number;
  /** Mean wait of the calls that were answered; null when none were. */
  averageWaitSeconds: number | null;
  /**
   * Share of inbound calls that were answered, 0–100.
   *
   * The denominator drops calls the customer abandoned inside the configured
   * short-no-answer threshold, exactly as the KPI strip's answer rate does.
   * Dividing by every inbound call instead put a second, lower "אחוז מענה" on
   * the same screen as the headline one — 76.5% against 81% — with no visible
   * reason for the gap.
   */
  answerRatePct: number | null;
  /** Share of answered calls picked up within the target, 0–100. */
  answeredWithinTargetPct: number | null;
  /** Share of every inbound call that waited longer than the target, 0–100. */
  waitedOverTargetPct: number | null;
  /** Share of all waiting time that belongs to this department, 0–100. */
  shareOfWaitPct: number;
};

/** One decimal, so 72.4% and 19.7% do not collapse into 72% and 20%. */
function pct(part: number, whole: number): number | null {
  if (!whole) return null;
  return Math.round((part / whole) * 1000) / 10;
}

/**
 * How long customers waited on inbound calls, split by department.
 *
 * Two different percentages, because they say different things. The share of
 * total waiting time shows where the pain is concentrated, but it mostly
 * follows call volume — a busy department will always dominate it. The share
 * answered inside the target is the performance figure: it is independent of
 * volume, so a small department cannot hide behind a big one.
 *
 * Wait comes from inboundWaitSeconds so this agrees with the rest of the app,
 * including its fallbacks for rows where Aircall left wait_time_seconds at 0.
 */
export function waitStatsByDepartment(
  calls: CallRecord[],
  targetSeconds = 60,
  shortNoAnswerSeconds = 0,
): DepartmentWaitStats[] {
  const groups = new Map<
    string,
    DepartmentWaitStats & {
      withinTarget: number;
      overTarget: number;
      shortAbandons: number;
      answeredWaitSeconds: number;
    }
  >();

  for (const call of calls) {
    if (call.direction !== "inbound") continue;
    const wait = inboundWaitSeconds(call);
    // in_progress calls have no final wait yet; counting them would drag the
    // average toward whatever happens to be ringing right now.
    if (wait === null) continue;

    const key = call.departmentId ?? "";
    let entry = groups.get(key);
    if (!entry) {
      entry = {
        departmentId: call.departmentId ?? null,
        departmentName: call.departmentName ?? "ללא שיוך מחלקה",
        inbound: 0,
        answered: 0,
        totalWaitSeconds: 0,
        averageWaitSeconds: null,
        answerRatePct: null,
        answeredWithinTargetPct: null,
        waitedOverTargetPct: null,
        shareOfWaitPct: 0,
        withinTarget: 0,
        overTarget: 0,
        shortAbandons: 0,
        answeredWaitSeconds: 0,
      };
      groups.set(key, entry);
    }

    entry.inbound += 1;
    entry.totalWaitSeconds += wait;
    // Counted over every inbound call, answered or not: a customer who gave up
    // after four minutes waited just as long as one who was eventually picked
    // up, and the point of this figure is how often people are kept waiting.
    if (wait > targetSeconds) entry.overTarget += 1;
    if (isShortNoAnswer(call, shortNoAnswerSeconds)) entry.shortAbandons += 1;
    if (call.status === "answered") {
      entry.answered += 1;
      entry.answeredWaitSeconds += wait;
      if (wait <= targetSeconds) entry.withinTarget += 1;
    }
  }

  const totalWait = [...groups.values()].reduce(
    (sum, entry) => sum + entry.totalWaitSeconds,
    0,
  );

  return [...groups.values()]
    .map((
      { withinTarget, overTarget, shortAbandons, answeredWaitSeconds, ...entry },
    ) => ({
      ...entry,
      averageWaitSeconds: entry.answered
        ? Math.round(answeredWaitSeconds / entry.answered)
        : null,
      answerRatePct: pct(entry.answered, entry.inbound - shortAbandons),
      // Measured against answered calls only: a call nobody picked up waited a
      // long time, but no one was slow to answer it.
      answeredWithinTargetPct: pct(withinTarget, entry.answered),
      waitedOverTargetPct: pct(overTarget, entry.inbound),
      shareOfWaitPct: pct(entry.totalWaitSeconds, totalWait) ?? 0,
    }))
    .sort((a, b) => b.totalWaitSeconds - a.totalWaitSeconds);
}

export function isCallInRange(
  call: CallRecord,
  from: string,
  to: string,
  timeZone = "Asia/Jerusalem",
): boolean {
  const startedAt = new Date(call.startedAt);
  const dateInZone = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(startedAt);

  return dateInZone >= from && dateInZone <= to;
}

export function filterCalls(
  calls: CallRecord[],
  from: string,
  to: string,
  departmentId: string,
  agentId: string,
): CallRecord[] {
  return calls.filter(
    (call) =>
      isCallInRange(call, from, to) &&
      (!departmentId || call.departmentId === departmentId) &&
      (!agentId || call.agentId === agentId),
  );
}

export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainingSeconds = safe % 60;
  const parts = [minutes, remainingSeconds].map((value) =>
    value.toString().padStart(2, "0"),
  );

  return hours ? `${hours.toString().padStart(2, "0")}:${parts.join(":")}` : parts.join(":");
}

/** Format seconds as mm:ss or with an explicit seconds suffix for short waits. */
export function formatSecondsLabel(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))} שנ׳`;
  return formatDuration(seconds);
}

export function shiftCalendarDate(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function inclusiveDayCount(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
}

export function previousEqualPeriod(
  from: string,
  to: string,
): { from: string; to: string } {
  const length = inclusiveDayCount(from, to);
  const prevTo = shiftCalendarDate(from, -1);
  const prevFrom = shiftCalendarDate(prevTo, -(length - 1));
  return { from: prevFrom, to: prevTo };
}

export type ComparisonSpec = {
  key: string;
  label: string;
  from: string;
  to: string;
};

/** Comparison windows for the analytics period presets. */
export function comparisonPeriods(
  filters: Pick<DashboardFilters, "preset" | "from" | "to">,
): ComparisonSpec[] {
  if (filters.preset === "today") {
    const yesterday = shiftCalendarDate(filters.from, -1);
    const lastWeek = shiftCalendarDate(filters.from, -7);
    return [
      {
        key: "yesterday",
        label: "מול אתמול",
        from: yesterday,
        to: yesterday,
      },
      {
        key: "same-day-last-week",
        label: "מול אותו יום בשבוע שעבר",
        from: lastWeek,
        to: lastWeek,
      },
    ];
  }

  if (filters.preset === "week") {
    const prev = previousEqualPeriod(filters.from, filters.to);
    return [
      {
        key: "previous-week",
        label: "מול השבוע הקודם",
        from: prev.from,
        to: prev.to,
      },
    ];
  }

  if (filters.preset === "month") {
    const prev = previousEqualPeriod(filters.from, filters.to);
    return [
      {
        key: "previous-month",
        label: "מול התקופה הקודמת",
        from: prev.from,
        to: prev.to,
      },
    ];
  }

  const prev = previousEqualPeriod(filters.from, filters.to);
  return [
    {
      key: "previous-custom",
      label: "מול התקופה הקודמת",
      from: prev.from,
      to: prev.to,
    },
  ];
}

export function earliestFetchFrom(
  filters: Pick<DashboardFilters, "preset" | "from" | "to">,
): string {
  const periods = comparisonPeriods(filters);
  return periods.reduce(
    (min, period) => (period.from < min ? period.from : min),
    filters.from,
  );
}

export function kpiDelta(current: number, previous: number): number {
  return current - previous;
}

export type HourBucket = {
  hour: number;
  label: string;
  total: number;
  inbound: number;
  answered: number;
  missed: number;
  missedShort: number;
  answerRate: number;
};

export function groupCallsByHour(
  calls: CallRecord[],
  thresholdSeconds: number,
): HourBucket[] {
  const buckets = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${hour.toString().padStart(2, "0")}:00`,
    total: 0,
    inbound: 0,
    answered: 0,
    missed: 0,
    missedShort: 0,
  }));

  const hourFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    hourCycle: "h23",
  });

  calls.forEach((call) => {
    if (call.status === "in_progress") return;
    const hour = Number(hourFormatter.format(new Date(call.startedAt)));
    if (Number.isNaN(hour) || hour < 0 || hour > 23) return;
    const bucket = buckets[hour];
    bucket.total += 1;
    if (call.direction === "inbound") {
      bucket.inbound += 1;
      if (call.status === "answered") bucket.answered += 1;
      if (call.status === "missed") {
        if (isShortNoAnswer(call, thresholdSeconds)) bucket.missedShort += 1;
        else bucket.missed += 1;
      }
    }
  });

  return buckets.map((bucket) => ({
    ...bucket,
    answerRate: bucket.answered + bucket.missed
      ? Math.round((bucket.answered / (bucket.answered + bucket.missed)) * 100)
      : 0,
  }));
}

/** Keep hours that have traffic, and pad a sensible business window when sparse. */
export function peakHoursForDisplay(buckets: HourBucket[]): HourBucket[] {
  const withTraffic = buckets.filter((bucket) => bucket.total > 0);
  if (!withTraffic.length) return [];
  const first = Math.min(withTraffic[0].hour, 8);
  const last = Math.max(withTraffic[withTraffic.length - 1].hour, 18);
  return buckets.filter((bucket) => bucket.hour >= first && bucket.hour <= last);
}
