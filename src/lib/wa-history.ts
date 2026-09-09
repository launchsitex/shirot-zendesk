/**
 * Vocabulary for "ביצועי WA" — the stored daily WhatsApp record per agent
 * (public.wa_agent_daily, rebuilt by the database every ten minutes) rolled
 * up over a range of days for comparing days, weeks and agents. Rows carry
 * sums, not averages, so any range adds up exactly; the averages are taken
 * here, at the edge.
 */

export type WaDailyRow = {
  /** Israel calendar day the tickets were opened on, YYYY-MM-DD. */
  day: string;
  departmentId: string;
  agentId: string;
  agentName: string;
  ticketCount: number;
  openCount: number;
  closedCount: number;
  timeToCloseSecondsSum: number;
  respondedCount: number;
  firstResponseSecondsSum: number;
  under3Count: number;
  over3Count: number;
  over7Count: number;
  over10Count: number;
};

export type WaPeriodStats = {
  ticketCount: number;
  openCount: number;
  closedCount: number;
  respondedCount: number;
  avgFirstResponseSeconds: number | null;
  avgTimeToCloseSeconds: number | null;
  under3Count: number;
  over3Count: number;
  over7Count: number;
  over10Count: number;
  /** Share of responded tickets answered under three minutes, 0–1. */
  under3Share: number | null;
  /** Days in the range with any activity. */
  activeDays: number;
};

export type WaDayStats = WaPeriodStats & { day: string };
export type WaAgentPeriod = WaPeriodStats & {
  agentId: string;
  agentName: string;
  days: WaDayStats[];
};

export type WaHistoryPayload = {
  from: string;
  to: string;
  /** The equal-length period ending the day before `from`, for deltas. */
  previous: { from: string; to: string };
  department: { id: string; name: string };
  departments: { id: string; name: string }[];
  rows: WaDailyRow[];
  previousRows: WaDailyRow[];
  businessHoursLabel: string | null;
  /** When the newest row in the range was computed. */
  computedAt: string | null;
};

export function sumRows(rows: WaDailyRow[]): WaPeriodStats {
  let ticketCount = 0;
  let openCount = 0;
  let closedCount = 0;
  let respondedCount = 0;
  let firstResponseSum = 0;
  let timeToCloseSum = 0;
  let under3Count = 0;
  let over3Count = 0;
  let over7Count = 0;
  let over10Count = 0;
  const days = new Set<string>();
  for (const row of rows) {
    ticketCount += row.ticketCount;
    openCount += row.openCount;
    closedCount += row.closedCount;
    respondedCount += row.respondedCount;
    firstResponseSum += row.firstResponseSecondsSum;
    timeToCloseSum += row.timeToCloseSecondsSum;
    under3Count += row.under3Count;
    over3Count += row.over3Count;
    over7Count += row.over7Count;
    over10Count += row.over10Count;
    if (row.ticketCount > 0 || row.respondedCount > 0 || row.closedCount > 0) {
      days.add(row.day);
    }
  }
  return {
    ticketCount,
    openCount,
    closedCount,
    respondedCount,
    avgFirstResponseSeconds:
      respondedCount > 0 ? firstResponseSum / respondedCount : null,
    avgTimeToCloseSeconds: closedCount > 0 ? timeToCloseSum / closedCount : null,
    under3Count,
    over3Count,
    over7Count,
    over10Count,
    under3Share: respondedCount > 0 ? under3Count / respondedCount : null,
    activeDays: days.size,
  };
}

/** One entry per day in the rows, oldest first. */
export function statsByDay(rows: WaDailyRow[]): WaDayStats[] {
  const byDay = new Map<string, WaDailyRow[]>();
  for (const row of rows) {
    (byDay.get(row.day) ?? byDay.set(row.day, []).get(row.day)!).push(row);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, dayRows]) => ({ day, ...sumRows(dayRows) }));
}

/** One entry per agent, busiest first, each with its own day-by-day list. */
export function statsByAgent(rows: WaDailyRow[]): WaAgentPeriod[] {
  const byAgent = new Map<string, WaDailyRow[]>();
  for (const row of rows) {
    (byAgent.get(row.agentId) ?? byAgent.set(row.agentId, []).get(row.agentId)!).push(row);
  }
  return [...byAgent.values()]
    .map((agentRows) => ({
      agentId: agentRows[0].agentId,
      agentName: agentRows[0].agentName,
      ...sumRows(agentRows),
      days: statsByDay(agentRows),
    }))
    .sort(
      (a, b) =>
        b.ticketCount - a.ticketCount ||
        b.respondedCount - a.respondedCount ||
        a.agentName.localeCompare(b.agentName, "he"),
    );
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD plus `days` (calendar arithmetic, no time zone involved). */
export function shiftDay(day: string, days: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** Sunday = 0 … Saturday = 6 for a YYYY-MM-DD calendar day. */
export function weekdayOf(day: string): number {
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}

/** Inclusive number of days from `from` to `to`. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY_MS) + 1;
}

export const RANGE_PRESETS = ["today", "this-week", "last-week", "this-month", "last-30"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export const RANGE_PRESET_LABELS: Record<RangePreset, string> = {
  today: "היום",
  "this-week": "השבוע",
  "last-week": "שבוע שעבר",
  "this-month": "החודש",
  "last-30": "30 יום",
};

/** The Israeli week starts on Sunday. */
export function presetRange(
  preset: RangePreset,
  today: string,
): { from: string; to: string } {
  const weekday = weekdayOf(today);
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "this-week":
      return { from: shiftDay(today, -weekday), to: today };
    case "last-week": {
      const lastSaturday = shiftDay(today, -weekday - 1);
      return { from: shiftDay(lastSaturday, -6), to: lastSaturday };
    }
    case "this-month":
      return { from: `${today.slice(0, 8)}01`, to: today };
    case "last-30":
      return { from: shiftDay(today, -29), to: today };
  }
}

/** The same number of days, ending the day before `from`. */
export function previousRange(from: string, to: string): { from: string; to: string } {
  const length = daysBetween(from, to);
  const previousTo = shiftDay(from, -1);
  return { from: shiftDay(previousTo, -(length - 1)), to: previousTo };
}

const SHORT_WEEKDAYS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];

/** "ד׳ 09.09" — weekday letter and day.month, the way the team says dates. */
export function dayLabel(day: string): string {
  return `${SHORT_WEEKDAYS[weekdayOf(day)]} ${day.slice(8, 10)}.${day.slice(5, 7)}`;
}

/** Whole seconds → "m:ss" / "h:mm:ss" for the CSV, empty when unknown. */
function csvDuration(seconds: number | null): string {
  if (seconds == null) return "";
  const whole = Math.round(seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * The per-agent table as CSV (UTF-8 with BOM so Excel opens the Hebrew
 * correctly), one line per agent plus one per agent-day underneath.
 */
export function agentsToCsv(agents: WaAgentPeriod[]): string {
  const header = [
    "נציגה",
    "יום",
    "פניות",
    "נסגרו",
    "עדיין פתוחות",
    "נענו",
    "תגובה ראשונה ממוצעת",
    "זמן סגירה ממוצע",
    "נענו תוך פחות מ-3 דק'",
    "מעל 3 דק'",
    "מעל 7 דק'",
    "מעל 10 דק'",
  ];
  const line = (name: string, day: string, stats: WaPeriodStats) =>
    [
      name,
      day,
      stats.ticketCount,
      stats.closedCount,
      stats.openCount,
      stats.respondedCount,
      csvDuration(stats.avgFirstResponseSeconds),
      csvDuration(stats.avgTimeToCloseSeconds),
      stats.under3Count,
      stats.over3Count,
      stats.over7Count,
      stats.over10Count,
    ]
      .map(csvCell)
      .join(",");
  const lines = [header.map(csvCell).join(",")];
  for (const agent of agents) {
    lines.push(line(agent.agentName, "סה\"כ", agent));
    for (const day of agent.days) lines.push(line(agent.agentName, day.day, day));
  }
  return `﻿${lines.join("\n")}`;
}
