import { businessSecondsBetween, type BusinessClock } from "@/lib/business-clock";
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
   * When the bot handed the conversation to the agents' queue: the status
   * open→new transition it makes as it lets go (not OfferedToEvent, which is
   * the later moment an available agent is offered the chat). The
   * first-response clock starts here, not at createdAt: the bot handles the
   * start of every conversation. Null if the sync has no handoff for this
   * ticket, in which case createdAt stands in and `firstResponseFromHandoff`
   * is false.
   */
  handedToAgentAt: string | null;
  firstResponseFromHandoff: boolean;
  /**
   * Seconds from the handoff (or createdAt, see above) to the agent's first
   * WhatsApp message; null if no agent has written yet.
   */
  firstResponseSeconds: number | null;
  closed: boolean;
  /**
   * Seconds from createdAt to the moment the ticket was set to solved
   * (`solvedAt`); only set once `closed` is true. Falls back to updatedAt for
   * a ticket whose solved transition the sync never saw.
   */
  timeToCloseSeconds: number | null;
  solvedAt: string | null;
  /**
   * Who gets the credit: the agent assigned at the moment of the first agent
   * message / of solving. Differs from `agentId` when a ticket changed hands.
   * Null when the event has not happened (or nobody was assigned then).
   */
  firstResponseAgentId: string | null;
  solvedByAgentId: string | null;
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
 * A ticket the bot has handed to the agents that nobody has picked up yet:
 * open, with no assignee at all (the bot holds the assignment while it is
 * handling the conversation). Its department comes from Zendesk's routing
 * group (zendesk_group_departments), not from the agent roster. Not limited
 * to the dashboard's day: a queue is "right now", whatever it holds.
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

/**
 * An agent's live state from Zendesk's Agent Availability API: their status
 * and how many messaging conversations they hold against their capacity.
 */
export type WaAgentAvailability = {
  agentId: string;
  agentName: string;
  departmentName: string | null;
  /** online / away / transfers_only / offline, or a custom status name. */
  status: string;
  statusSince: string | null;
  messagingWorkItems: number;
  messagingMaxCapacity: number | null;
  syncedAt: string;
};

export const AGENT_STATUS_LABELS: Record<string, string> = {
  online: "מקוון",
  away: "לא פעיל",
  transfers_only: "העברה בלבד",
  offline: "לא מקוון",
};

export function agentStatusLabel(status: string): string {
  return AGENT_STATUS_LABELS[status] ?? status;
}

/**
 * How many more conversations routing can hand this agent right now: the
 * spare capacity while online, none in any other status (away and custom
 * statuses take no new work; transfers_only only takes transfers).
 */
export function freeMessagingSlots(agent: WaAgentAvailability): number {
  if (agent.status !== "online" || agent.messagingMaxCapacity == null) return 0;
  return Math.max(0, agent.messagingMaxCapacity - agent.messagingWorkItems);
}

/** Online with room first, then online but full, then everyone else by status. */
export function sortAvailability(
  agents: WaAgentAvailability[],
): WaAgentAvailability[] {
  const rank = (agent: WaAgentAvailability) =>
    agent.status === "online"
      ? (freeMessagingSlots(agent) > 0 ? 0 : 1)
      : agent.status === "transfers_only"
      ? 2
      : agent.status === "offline"
      ? 4
      : 3;
  return [...agents].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      b.messagingWorkItems - a.messagingWorkItems ||
      a.agentName.localeCompare(b.agentName, "he"),
  );
}

export type WaDashboardPayload = {
  date: string;
  /**
   * The department's business hours, when configured: every duration on the
   * screens — recorded in `rows` and live on the client — runs on this
   * clock, standing still outside working hours and on Israeli holidays
   * ([[business-clock]]). Null means the wall clock.
   */
  businessHours: BusinessClock;
  totals: WaGroupStats;
  byAgent: WaAgentSummary[];
  byDepartment: WaDepartmentSummary[];
  hourly: WaHourlyBucket[];
  rows: WaTicketRow[];
  queue: WaQueueTicket[];
  /** The department this payload is scoped to, and all the ones a viewer can pick. */
  department: { id: string; name: string };
  departments: { id: string; name: string }[];
  /** Names for agents credited on a ticket they are no longer assigned to. */
  agents: AgentDirectory;
  /** This department's agents, live from Zendesk routing. */
  availability: WaAgentAvailability[];
  syncedAt: string | null;
};

export type QueuedTicket = WaQueueTicket & {
  /** Since the bot's handoff, as of `now`. */
  waitedSeconds: number;
};

/**
 * Anything unassigned for longer than this is not a live queue any more but
 * a backlog (a weekend's worth of tickets nobody ever picked up, say). It is
 * counted per department rather than listed, so it cannot bury the customers
 * waiting right now.
 */
export const QUEUE_LIVE_WINDOW_SECONDS = 24 * 60 * 60;

export type QueueGroup = {
  departmentName: string;
  /** Waiting within the live window, longest first. */
  tickets: QueuedTicket[];
  /** Unassigned for longer than the live window. */
  olderCount: number;
};

/** The queue by department, longest wait first inside each, as of `now`. */
export function queueByDepartment(
  queue: WaQueueTicket[],
  now: Date,
): QueueGroup[] {
  const nowMs = now.getTime();
  const groups = new Map<string, QueueGroup>();
  for (const ticket of queue) {
    const group = groups.get(ticket.departmentName) ?? {
      departmentName: ticket.departmentName,
      tickets: [],
      olderCount: 0,
    };
    const waitedSeconds = secondsSince(ticket.handedToAgentAt, nowMs);
    if (waitedSeconds > QUEUE_LIVE_WINDOW_SECONDS) group.olderCount += 1;
    else group.tickets.push({ ...ticket, waitedSeconds });
    groups.set(ticket.departmentName, group);
  }
  const longest = (group: QueueGroup) => group.tickets[0]?.waitedSeconds ?? -1;
  return [...groups.values()]
    .map((group) => ({
      ...group,
      tickets: group.tickets.sort((a, b) => b.waitedSeconds - a.waitedSeconds),
    }))
    .sort((a, b) => longest(b) - longest(a) || b.olderCount - a.olderCount);
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

/** Wall-clock seconds — the queue's clock, since pickup is wanted now, not in business hours. */
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
  clock: BusinessClock = null,
): WaitingTicket[] {
  return rows
    .filter((row) => row.waitingSince != null)
    .map((row) => ({
      ...row,
      waitedSeconds: businessSecondsBetween(row.waitingSince!, now, clock),
      totalSeconds: businessSecondsBetween(row.createdAt, now, clock),
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
  clock: BusinessClock = null,
): number | null {
  if (row.firstResponseSeconds != null) return row.firstResponseSeconds;
  if (row.closed) return null;
  return businessSecondsBetween(row.handedToAgentAt ?? row.createdAt, now, clock);
}

/** How many tickets' first response took (or has so far taken) over each tier. */
export function firstResponseTierCounts(
  rows: WaTicketRow[],
  now: Date,
  clock: BusinessClock = null,
): Record<WaitingTierMinutes, number> {
  const elapsed = rows
    .map((row) => firstResponseElapsed(row, now, clock))
    .filter((value): value is number => value != null);
  const counts = {} as Record<WaitingTierMinutes, number>;
  for (const minutes of WAITING_TIER_MINUTES) {
    counts[minutes] = elapsed.filter((value) => value >= minutes * 60).length;
  }
  return counts;
}

/** How many tickets an agent answered within `minutes` of the handoff. */
export function firstResponseUnderCount(
  rows: WaTicketRow[],
  minutes: number,
): number {
  return rows.filter(
    (row) =>
      row.firstResponseSeconds != null && row.firstResponseSeconds < minutes * 60,
  ).length;
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

export type AgentDirectory = Record<
  string,
  { name: string; departmentName: string | null }
>;

/**
 * Per-agent rollup. Shared by the API route and the "דשבורד WA" page, which
 * recomputes everything client-side when the viewer excludes agents.
 *
 * Ticket count and "waiting now" follow the current assignee; first response
 * and closure are credited to the agent assigned at that moment
 * (`firstResponseAgentId` / `solvedByAgentId`), so a ticket that changed
 * hands credits each agent for their own part. `directory` names agents who
 * appear only through credit, with no ticket currently assigned.
 */
export function summarizeByAgent(
  rows: WaTicketRow[],
  directory: AgentDirectory = {},
): WaAgentSummary[] {
  const keys = new Set<string>();
  for (const row of rows) {
    keys.add(row.agentId ?? "unassigned");
    if (row.firstResponseAgentId) keys.add(row.firstResponseAgentId);
    if (row.solvedByAgentId) keys.add(row.solvedByAgentId);
  }
  return [...keys]
    .map((key) => {
      const current = rows.filter((row) => (row.agentId ?? "unassigned") === key);
      const responded = rows.filter(
        (row) =>
          row.firstResponseSeconds != null && row.firstResponseAgentId === key,
      );
      const closed = rows.filter(
        (row) => row.closed && row.solvedByAgentId === key,
      );
      const sample = current[0];
      const known = key === "unassigned" ? undefined : directory[key];
      return {
        agentId: key === "unassigned" ? null : key,
        agentName: sample?.agentName ?? known?.name ?? "ללא שיוך נציג",
        departmentName: sample?.departmentName ?? known?.departmentName ?? null,
        ticketCount: current.length,
        respondedCount: responded.length,
        avgFirstResponseSeconds: average(
          responded.map((row) => row.firstResponseSeconds as number),
        ),
        awaitingReply: current.filter((row) => row.waitingSince != null).length,
        closedCount: closed.length,
        avgTimeToCloseSeconds: average(
          closed
            .map((row) => row.timeToCloseSeconds)
            .filter((value): value is number => value != null),
        ),
      };
    })
    .filter((row) => row.ticketCount > 0 || row.respondedCount > 0 || row.closedCount > 0)
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
