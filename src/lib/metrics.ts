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

export function calculateKpis(calls: CallRecord[]): Kpis {
  // Exclude live/in-progress calls so totals match answered + missed + outbound.
  const completed = calls.filter((call) => call.status !== "in_progress");
  const inbound = completed.filter((call) => call.direction === "inbound");
  const answered = inbound.filter((call) => call.status === "answered");
  const missed = inbound.filter((call) => call.status === "missed");
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

  return {
    total: completed.length,
    inbound: inbound.length,
    outbound: outbound.length,
    answered: answered.length,
    missed: missed.length,
    answerRate: inbound.length
      ? Math.round((answered.length / inbound.length) * 100)
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
  answerRate: number;
};

export function groupCallsByHour(calls: CallRecord[]): HourBucket[] {
  const buckets = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${hour.toString().padStart(2, "0")}:00`,
    total: 0,
    inbound: 0,
    answered: 0,
    missed: 0,
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
      if (call.status === "missed") bucket.missed += 1;
    }
  });

  return buckets.map((bucket) => ({
    ...bucket,
    answerRate: bucket.inbound
      ? Math.round((bucket.answered / bucket.inbound) * 100)
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
