/**
 * Vocabulary for "דשבורד WA" / "דשבורד TV WA" — WhatsApp tickets from Zendesk
 * for a single Israel calendar day, scored on two figures:
 *
 * - first response time: from the customer's first message
 *   (`createdAt`) to the assignee's first comment (`firstResponseSeconds`,
 *   null until the assignee has written anything).
 * - time to close: from `createdAt` to `updatedAt`, only once the ticket
 *   reached solved or closed — the same "finished" definition used
 *   everywhere else in this app (see CLOSED_STATUSES in
 *   [[tickets]]). Not literal `closed` alone: on this team's Zendesk that
 *   status is an automatic archival step days after an agent resolves a
 *   ticket, not something an agent chooses, so it is not a meaningful
 *   same-day figure.
 */

export type WaTicketRow = {
  id: string;
  subject: string | null;
  customerName: string | null;
  customerPhone: string | null;
  agentId: string | null;
  agentName: string | null;
  departmentName: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  /** Seconds from createdAt to the assignee's first comment; null if none yet. */
  firstResponseSeconds: number | null;
  closed: boolean;
  /** Seconds from createdAt to updatedAt; only set once `closed` is true. */
  timeToCloseSeconds: number | null;
};

export type WaGroupStats = {
  ticketCount: number;
  respondedCount: number;
  avgFirstResponseSeconds: number | null;
  awaitingFirstResponse: number;
  closedCount: number;
  avgTimeToCloseSeconds: number | null;
};

export type WaAgentSummary = WaGroupStats & {
  agentId: string | null;
  agentName: string;
  departmentName: string | null;
};

export type WaDepartmentSummary = WaGroupStats & {
  departmentName: string;
};

export type WaHourlyBucket = {
  /** Hour of day in Israel time, 0–23. */
  hour: number;
  count: number;
};

export type WaDashboardPayload = {
  date: string;
  totals: WaGroupStats;
  byAgent: WaAgentSummary[];
  byDepartment: WaDepartmentSummary[];
  hourly: WaHourlyBucket[];
  rows: WaTicketRow[];
  syncedAt: string | null;
};

/**
 * A ticket still awaiting its first agent reply has gone this long since the
 * customer's message — the point past which it is highlighted as urgent.
 */
export const STALE_THRESHOLD_SECONDS = 600;

export function isStale(waitingSeconds: number): boolean {
  return waitingSeconds >= STALE_THRESHOLD_SECONDS;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Rolls a flat list of tickets up into the aggregate figures shown per row. */
export function summarizeTickets(rows: WaTicketRow[]): WaGroupStats {
  const responseTimes = rows
    .map((row) => row.firstResponseSeconds)
    .filter((value): value is number => value != null);
  const closeTimes = rows
    .map((row) => row.timeToCloseSeconds)
    .filter((value): value is number => value != null);
  return {
    ticketCount: rows.length,
    respondedCount: responseTimes.length,
    avgFirstResponseSeconds: average(responseTimes),
    awaitingFirstResponse: rows.filter(
      (row) => row.firstResponseSeconds == null && !row.closed,
    ).length,
    closedCount: rows.filter((row) => row.closed).length,
    avgTimeToCloseSeconds: average(closeTimes),
  };
}
