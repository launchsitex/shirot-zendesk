/**
 * Vocabulary for "דשבורד WA" / "דשבורד TV WA" — WhatsApp tickets from Zendesk
 * for a single Israel calendar day.
 *
 * WhatsApp here runs on Zendesk Messaging, where messages are not ticket
 * comments while the chat is live. What the sync does see is a Messaging
 * trigger flipping a tag on every message — agent or customer — and those
 * flips are the message timeline (see 20260909120000_zendesk_whatsapp_messages
 * and `last_*_message_at` on the ticket). Everything below is derived from
 * them:
 *
 * - first response time: from the customer's first message (`createdAt`) to
 *   the agent's first WhatsApp message (`firstResponseSeconds`, null until an
 *   agent has written). A person, not the bot — the bot does not fire the
 *   trigger.
 * - waiting: a ticket where the customer wrote last (or nobody from the team
 *   has written at all) and the ticket is still open. `waitingSince` is the
 *   agent's *last* message — the account owner's explicit definition: once
 *   an agent has written, the clock counts from that message, not from the
 *   customer's first one. With no agent message yet it counts from
 *   `createdAt`. Null when the agent wrote last or the ticket is finished.
 * - time to close: from `createdAt` to `updatedAt`, only once the ticket
 *   reached solved or closed — the same "finished" definition used
 *   everywhere else in this app (see CLOSED_STATUSES in [[tickets]]). Not
 *   literal `closed` alone: on this Zendesk that is an automatic archival
 *   step days after an agent resolves a ticket, so it is not a meaningful
 *   same-day figure.
 */

export type WaTicketRow = {
  id: string;
  subject: string | null;
  customerName: string | null;
  customerPhone: string | null;
  agentId: string | null;
  agentName: string | null;
  departmentId: string | null;
  departmentName: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  /** Seconds from createdAt to the agent's first WhatsApp message; null if none yet. */
  firstResponseSeconds: number | null;
  closed: boolean;
  /** Seconds from createdAt to updatedAt; only set once `closed` is true. */
  timeToCloseSeconds: number | null;
  /** The agent's most recent WhatsApp message, if any. */
  lastAgentMessageAt: string | null;
  /** The customer's most recent WhatsApp message, if any. */
  lastCustomerMessageAt: string | null;
  /**
   * The moment the customer's current wait is counted from: the agent's last
   * message, or `createdAt` if no agent has written yet. Null when the agent
   * wrote last or the ticket is finished — i.e. the customer is not waiting.
   */
  waitingSince: string | null;
};

export type WaGroupStats = {
  ticketCount: number;
  respondedCount: number;
  avgFirstResponseSeconds: number | null;
  /** Tickets currently awaiting a reply to the customer's latest message. */
  awaitingReply: number;
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
 * Escalation tiers for a customer currently waiting on an agent — the figure
 * the account owner called more important than the close-time stats, since it
 * is the one a manager can act on right now by nudging a specific agent.
 */
export const WAITING_TIER_MINUTES = [3, 7, 10] as const;
export type WaitingTierMinutes = (typeof WAITING_TIER_MINUTES)[number];

export type WaitingTicket = WaTicketRow & {
  /** Since the agent's last message (or the ticket's start), as of `now`. */
  waitedSeconds: number;
  /** Since the ticket was opened, as of `now`. */
  totalSeconds: number;
};

function secondsSince(iso: string, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 1000));
}

/**
 * Tickets whose customer is currently waiting (`waitingSince` set), each
 * carrying how long that has been as of `now` — recomputed on every call
 * rather than stored, since it grows every second the page is open.
 */
export function currentlyWaiting(
  rows: WaTicketRow[],
  now: Date,
): WaitingTicket[] {
  const nowMs = now.getTime();
  return rows
    .filter((row) => row.waitingSince != null)
    .map((row) => ({
      ...row,
      waitedSeconds: secondsSince(row.waitingSince!, nowMs),
      totalSeconds: secondsSince(row.createdAt, nowMs),
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
    awaitingReply: rows.filter((row) => row.waitingSince != null).length,
    closedCount: rows.filter((row) => row.closed).length,
    avgTimeToCloseSeconds: average(closeTimes),
  };
}
