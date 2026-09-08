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
 * Escalation tiers for a customer still waiting on a first reply — the figure
 * the account owner called more important than the close-time stats, since it
 * is the one a manager can act on right now by nudging a specific agent.
 */
export const WAITING_TIER_MINUTES = [3, 7, 10] as const;
export type WaitingTierMinutes = (typeof WAITING_TIER_MINUTES)[number];

export type WaitingTicket = WaTicketRow & { waitedSeconds: number };

/**
 * Tickets with no agent reply yet and not closed, each carrying how long the
 * customer has been waiting as of `now` — recomputed on every call rather
 * than stored, since it grows every second the page is open.
 */
export function currentlyWaiting(
  rows: WaTicketRow[],
  now: Date,
): WaitingTicket[] {
  const nowMs = now.getTime();
  return rows
    .filter((row) => row.firstResponseSeconds == null && !row.closed)
    .map((row) => ({
      ...row,
      waitedSeconds: Math.max(
        0,
        Math.floor((nowMs - new Date(row.createdAt).getTime()) / 1000),
      ),
    }))
    .sort((a, b) => b.waitedSeconds - a.waitedSeconds);
}

/** How many currently-waiting tickets have crossed each escalation tier. */
export function waitingTierCounts(
  waiting: { waitedSeconds: number }[],
): Record<WaitingTierMinutes, number> {
  const counts = {} as Record<WaitingTierMinutes, number>;
  for (const minutes of WAITING_TIER_MINUTES) {
    counts[minutes] = waiting.filter(
      (ticket) => ticket.waitedSeconds >= minutes * 60,
    ).length;
  }
  return counts;
}

/** The highest escalation tier (in minutes) a wait has crossed, or null. */
export function waitingTier(waitedSeconds: number): WaitingTierMinutes | null {
  let crossed: WaitingTierMinutes | null = null;
  for (const minutes of WAITING_TIER_MINUTES) {
    if (waitedSeconds >= minutes * 60) crossed = minutes;
  }
  return crossed;
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
