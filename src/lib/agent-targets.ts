/**
 * Shared vocabulary for "יעדים לנציגים" — the daily inbound-call target per
 * agent per department, and the report that measures it.
 *
 * The metric itself lives in SQL (public.agent_target_report), so the page and
 * the 15:30 email can never drift apart. This module only fixes the *window*
 * they ask about.
 */

import { jerusalemInstant } from "@/lib/israel-time";

/** The daily report closes at 15:30 Asia/Jerusalem, as specified. */
export const REPORT_CUTOFF_TIME = "15:30";

export type TargetWindow = "until-cutoff" | "full-day";

export type AgentTargetRow = {
  departmentId: string | null;
  departmentName: string | null;
  agentId: string;
  agentName: string;
  target: number | null;
  actual: number;
};

export type AgentTargetReport = {
  date: string;
  window: TargetWindow;
  cutoff: string;
  rows: AgentTargetRow[];
};

/**
 * Start (inclusive) and end (exclusive) instants for a report window.
 *
 * The email reports the day so far, up to 15:30. The page offers the same
 * window by default so its numbers match the email exactly, and a full-day
 * option for looking back at a finished day.
 */
export function reportWindow(date: string, window: TargetWindow) {
  return {
    from: jerusalemInstant(date, "00:00"),
    to:
      window === "full-day"
        ? jerusalemInstant(nextDay(date), "00:00")
        : jerusalemInstant(date, REPORT_CUTOFF_TIME),
  };
}

function nextDay(date: string): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/** Attainment as a percentage, or null when no target is set. */
export function attainment(row: AgentTargetRow): number | null {
  if (!row.target || row.target <= 0) return null;
  return Math.round((row.actual / row.target) * 100);
}

/** Rows regrouped per department, in display order. */
export function groupByDepartment(rows: AgentTargetRow[]) {
  const groups = new Map<
    string,
    { departmentId: string | null; departmentName: string; rows: AgentTargetRow[] }
  >();

  for (const row of rows) {
    const key = row.departmentId ?? "";
    let group = groups.get(key);
    if (!group) {
      group = {
        departmentId: row.departmentId,
        departmentName: row.departmentName ?? "ללא שיוך מחלקה",
        rows: [],
      };
      groups.set(key, group);
    }
    group.rows.push(row);
  }

  return [...groups.values()].map((group) => ({
    ...group,
    totalTarget: group.rows.reduce((sum, row) => sum + (row.target ?? 0), 0),
    totalActual: group.rows.reduce((sum, row) => sum + row.actual, 0),
  }));
}
