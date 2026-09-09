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
 * - first response time: from the moment the bot handed the conversation to
 *   the agents (`handedToAgentAt`) to the agent's first WhatsApp message
 *   (`firstResponseSeconds`, null until an agent has written). A person, not
 *   the bot — the bot does not fire the trigger, and the time it spends
 *   before the handoff is not the customer waiting for a person.
 * - waiting: a ticket where the customer wrote last (or nobody from the team
 *   has written at all) and the ticket is still open. `waitingSince` is the
 *   customer's first message that is still unanswered — the account owner's
 *   definition: the handoff when no agent has written yet, otherwise the
 *   first customer message after the agent's last one. Null when the agent
 *   wrote last or the ticket is finished.
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
  /**
   * When the bot handed the conversation to the agents (Zendesk's
   * OfferedToEvent). The first-response clock starts here, not at createdAt:
   * the bot handles the start of every conversation. Null if the sync has no
   * handoff for this ticket, in which case createdAt stands in and
   * `firstResponseFromHandoff` is false.
   */
  handedToAgentAt: string | null;
  firstResponseFromHandoff: boolean;
  /**
   * Seconds from the handoff (or createdAt, see above) to the agent's first
   * WhatsApp message; null if no agent has written yet.
   */
  firstResponseSeconds: number | null;
  closed: boolean;
  /** Seconds from createdAt to updatedAt; only set once `closed` is true. */
  timeToCloseSeconds: number | null;
  /** The agent's most recent WhatsApp message, if any. */
  lastAgentMessageAt: string | null;
  /** The customer's most recent WhatsApp message, if any. */
  lastCustomerMessageAt: string | null;
  /**
   * The moment the customer's current wait is counted from: their first
   * message that is still unanswered (the handoff if no agent has written
   * yet). Null when the agent wrote last or the ticket is finished — i.e.
   * the customer is not waiting.
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

/**
 * A ticket the bot has handed to the agents that nobody has picked up yet.
 * It has no assignee, so its department comes from Zendesk's routing group
 * (zendesk_group_departments), not from the agent roster. Not limited to the
 * dashboard's day or department: a queue is "right now", whatever it holds.
 */
export type WaQueueTicket = {
  id: string;
  customerName: string | null;
  customerPhone: string | null;
  departmentId: string | null;
  departmentName: string;
  createdAt: string;
  handedToAgentAt: string;
};

export type WaDashboardPayload = {
  date: string;
  totals: WaGroupStats;
  byAgent: WaAgentSummary[];
  byDepartment: WaDepartmentSummary[];
  hourly: WaHourlyBucket[];
  rows: WaTicketRow[];
  queue: WaQueueTicket[];
  /** The department this payload is scoped to, and all the ones a viewer can pick. */
  department: { id: string; name: string };
  departments: { id: string; name: string }[];
  syncedAt: string | null;
};

export type QueuedTicket = WaQueueTicket & {
  /** Since the bot's handoff, as of `now`. */
  waitedSeconds: number;
};

/** The queue by department, longest wait first inside each, as of `now`. */
export function queueByDepartment(
  queue: WaQueueTicket[],
  now: Date,
): { departmentName: string; tickets: QueuedTicket[] }[] {
  const nowMs = now.getTime();
  const groups = new Map<string, QueuedTicket[]>();
  for (const ticket of queue) {
    const bucket = groups.get(ticket.departmentName) ?? [];
    bucket.push({
      ...ticket,
      waitedSeconds: secondsSince(ticket.handedToAgentAt, nowMs),
    });
    groups.set(ticket.departmentName, bucket);
  }
  return [...groups.entries()]
    .map(([departmentName, tickets]) => ({
      departmentName,
      tickets: tickets.sort((a, b) => b.waitedSeconds - a.waitedSeconds),
    }))
    .sort((a, b) => b.tickets[0].waitedSeconds - a.tickets[0].waitedSeconds);
}

/**
 * Escalation tiers for a customer currently waiting on an agent — the figure
 * the account owner called more important than the close-time stats, since it
 * is the one a manager can act on right now by nudging a specific agent.
 */
export const WAITING_TIER_MINUTES = [3, 7, 10] as const;
export type WaitingTierMinutes = (typeof WAITING_TIER_MINUTES)[number];

export type WaitingTicket = WaTicketRow & {
  /** Since the customer's first unanswered message, as of `now`. */
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

/**
 * How long the customer waited for the agent's first message, as of `now`:
 * the recorded figure once an agent has written; the live, still-growing
 * figure while an open ticket has no agent message yet; null for a ticket
 * that finished without any agent message (the bot resolved it).
 */
export function firstResponseElapsed(
  row: WaTicketRow,
  now: Date,
): number | null {
  if (row.firstResponseSeconds != null) return row.firstResponseSeconds;
  if (row.closed) return null;
  return secondsSince(row.handedToAgentAt ?? row.createdAt, now.getTime());
}

/** How many tickets' first response took (or has so far taken) over each tier. */
export function firstResponseTierCounts(
  rows: WaTicketRow[],
  now: Date,
): Record<WaitingTierMinutes, number> {
  const elapsed = rows
    .map((row) => firstResponseElapsed(row, now))
    .filter((value): value is number => value != null);
  const counts = {} as Record<WaitingTierMinutes, number>;
  for (const minutes of WAITING_TIER_MINUTES) {
    counts[minutes] = elapsed.filter((value) => value >= minutes * 60).length;
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

function groupBy(rows: WaTicketRow[], key: (row: WaTicketRow) => string) {
  const map = new Map<string, WaTicketRow[]>();
  for (const row of rows) {
    const groupKey = key(row);
    const bucket = map.get(groupKey);
    if (bucket) bucket.push(row);
    else map.set(groupKey, [row]);
  }
  return map;
}

const worstFirst = (a: WaGroupStats, b: WaGroupStats) =>
  b.awaitingReply - a.awaitingReply || b.ticketCount - a.ticketCount;

/**
 * Per-agent rollup. Shared by the API route and the "דשבורד WA" page, which
 * recomputes everything client-side when the viewer excludes agents.
 */
export function summarizeByAgent(rows: WaTicketRow[]): WaAgentSummary[] {
  return [...groupBy(rows, (row) => row.agentId ?? "unassigned").values()]
    .map((agentRows) => ({
      agentId: agentRows[0].agentId,
      agentName: agentRows[0].agentName ?? "ללא שיוך נציג",
      departmentName: agentRows[0].departmentName,
      ...summarizeTickets(agentRows),
    }))
    .sort(worstFirst);
}

export function summarizeByDepartment(
  rows: WaTicketRow[],
): WaDepartmentSummary[] {
  return [...groupBy(rows, (row) => row.departmentName ?? "ללא שיוך מחלקה")]
    .map(([departmentName, deptRows]) => ({
      departmentName,
      ...summarizeTickets(deptRows),
    }))
    .sort(worstFirst);
}

const israelHourFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Jerusalem",
  hour: "2-digit",
  hour12: false,
});

/** Tickets opened per hour of the Israel day, all 24 hours present. */
export function hourlyBuckets(rows: WaTicketRow[]): WaHourlyBucket[] {
  const counts = new Map<number, number>();
  for (const row of rows) {
    // "24" is what some engines print for midnight with hour12:false.
    const hour = Number(israelHourFormatter.format(new Date(row.createdAt))) % 24;
    counts.set(hour, (counts.get(hour) ?? 0) + 1);
  }
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    count: counts.get(hour) ?? 0,
  }));
}
