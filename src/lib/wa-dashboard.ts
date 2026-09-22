import {
  agentRoleGroupLabel,
  DEFAULT_AGENT_ROLE,
  sortAgentRoles,
  type AgentRoleDef,
} from "@/lib/agent-roles";
import {
  businessOpenAt,
  businessSecondsBetween,
  type BusinessClock,
} from "@/lib/business-clock";
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
 * - first response time, split into two (account owner's request, 2026-09-14
 *   — ticket 74539 sat 70 minutes unassigned in the queue before the agent
 *   who answered even had it, which a single number hid):
 *   - "זמן תגובה מוקד": from the moment the bot handed the conversation to
 *     the agents (`handedToAgentAt`) to the agent's first WhatsApp message
 *     (`firstResponseSeconds`, null until an agent has written) — the
 *     customer's full wait, including time unassigned in the queue.
 *   - "זמן תגובה נציגה": from the moment a person was actually assigned
 *     (`assignedToAgentAt`) to that same first message (`agentResponseSeconds`,
 *     null with no assignee transition recorded before it — e.g. tickets from
 *     before 2026-09-09, when zendesk_ticket_transitions started). The
 *     agent's own responsiveness, without the queue wait she does not
 *     control.
 *   Neither is derived from the bot itself — it does not fire the Messaging
 *   trigger, and the time it spends before the handoff is not the customer
 *   waiting for a person.
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
   * WhatsApp message; null if no agent has written yet. "זמן תגובה מוקד" —
   * the customer's full wait, including any time unassigned in the queue.
   */
  firstResponseSeconds: number | null;
  /**
   * When a person was actually assigned to the ticket, from the last real
   * assignee transition at or before the first agent message — not the
   * bot's handoff to the queue, which can be much earlier. Null when no such
   * transition is on record.
   */
  assignedToAgentAt: string | null;
  /**
   * Seconds from `assignedToAgentAt` to the agent's first WhatsApp message;
   * null if no agent has written yet, or no assignee transition is on
   * record. "זמן תגובה נציגה" — the agent's own responsiveness, without
   * queue time she does not control.
   */
  agentResponseSeconds: number | null;
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
  /**
   * Manually confirmed anomaly (e.g. never routed/offered to any agent) —
   * excluded from every response-time/close-time average and tier count,
   * account owner's per-ticket call, not an automatic rule (2026-09-22, the
   * 13 שירות-לקוחות tickets from that day that sat fully unassigned for
   * hours despite near-instant pickup on everything else). Still counted in
   * ticketCount/closedCount/awaitingReply — it is a real ticket, just not a
   * fair timing sample.
   */
  excludedFromAverages: boolean;
};

/**
 * A ticket on Zendesk's "pending" status: the agent already answered the
 * customer's last message and it is now waiting on the customer. See
 * WaDashboardPayload.pendingReplies.
 */
export type WaPendingTicket = WaTicketRow & {
  /**
   * Seconds from the customer's last message to the agent's reply to it
   * (lastCustomerMessageAt → lastAgentMessageAt) — how fast that specific
   * exchange was, not the ticket's first response. Null without both
   * timestamps, or when the agent's message isn't actually after the
   * customer's — last_*_message_at are each just the latest of their kind,
   * not a matched pair, so a "pending" ticket can still show the customer's
   * one out-pacing the agent's (a status-flip sync lag, e.g.); showing a
   * duration there would read as a misleadingly fast reply.
   */
  lastReplySeconds: number | null;
};

export type WaGroupStats = {
  ticketCount: number;
  respondedCount: number;
  /** "זמן תגובה מוקד" — average from the bot's handoff to first response. */
  avgFirstResponseSeconds: number | null;
  /**
   * "זמן תגובה נציגה" — average from actual assignment to first response.
   * Averaged only over tickets that have an `agentResponseSeconds` (see
   * WaTicketRow), which can be fewer than `respondedCount`.
   */
  avgAgentResponseSeconds: number | null;
  /** Tickets currently awaiting a reply to the customer's latest message. */
  awaitingReply: number;
  closedCount: number;
  avgTimeToCloseSeconds: number | null;
};

export type WaAgentSummary = WaGroupStats & {
  agentId: string | null;
  agentName: string;
  departmentName: string | null;
  /**
   * Average seconds from every customer WhatsApp turn (not just the first,
   * unlike avgFirstResponseSeconds) to the agent's next reply, pooled across
   * every ticket currently assigned to this agent. See
   * `averageMessageResponseByAgent` for how it is computed and its one
   * caveat: a burst of consecutive customer messages before any agent reply
   * counts once, not once per WhatsApp bubble. Null with no such pairs yet.
   */
  avgPerMessageResponseSeconds: number | null;
  /** How many customer-turn → agent-reply pairs the average above is over. */
  perMessageResponseCount: number;
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
  /** Job role id; the availability boxes group by it, answering agents first. */
  role: string;
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

export type AvailabilityGroup = {
  role: string;
  label: string;
  agents: WaAgentAvailability[];
};

/**
 * Availability split into one group per role, in the order the admin set in
 * Settings (answering agents first, people who left last), each sorted like
 * sortAvailability. Empty roles are left out; a role id the list does not
 * know goes last under its own id rather than disappearing.
 */
export function groupAvailabilityByRole(
  agents: WaAgentAvailability[],
  roles: AgentRoleDef[],
): AvailabilityGroup[] {
  const known = sortAgentRoles(roles).map((role) => role.id);
  const unknown = [...new Set(agents.map((agent) => agent.role))].filter(
    (id) => !known.includes(id),
  );
  return [...known, ...unknown].flatMap((role) => {
    const members = agents.filter((agent) => agent.role === role);
    return members.length
      ? [{ role, label: agentRoleGroupLabel(roles, role), agents: sortAvailability(members) }]
      : [];
  });
}

/** Only answering agents (the default role) count toward the headline "online" / "free slots". */
export function answeringAgents(agents: WaAgentAvailability[]): WaAgentAvailability[] {
  return agents.filter((agent) => agent.role === DEFAULT_AGENT_ROLE);
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
  /**
   * Open tickets from earlier days still sitting with this department's
   * agents (the last 30 days), so "ממתינים לתגובה" covers every open
   * WhatsApp conversation and not only today's.
   */
  openBacklog: WaTicketRow[];
  /**
   * Earlier-day tickets whose first agent reply landed today, or that were
   * solved today — folded into totals / byAgent (not ticketCount, which
   * stays "opened today") so a reply or closure credits the day it actually
   * happened, not the day the ticket was opened (account owner's rule,
   * 2026-09-14: a ticket that arrived after hours yesterday and got its
   * first reply at 08:05 today is a 5-minute first response *today*, not
   * invisible because the ticket itself is a day old). Empty for a past
   * date.
   */
  respondedToday: WaTicketRow[];
  closedToday: WaTicketRow[];
  /**
   * Open tickets on Zendesk's "pending" status — the agent already replied
   * to the customer's last message and the ball is in the customer's court.
   * Shown next to "ממתינים לתגובה" (display only, account owner's request
   * 2026-09-14) so a manager sees both directions: who is waiting on us and
   * who we already answered. `lastReplySeconds` is how long the agent took
   * to answer that last customer message specifically (not the ticket's
   * first response) — null if there is no recorded customer message before
   * it. Live-only like `openBacklog`/`queue`: empty for a past date.
   */
  pendingReplies: WaPendingTicket[];
  queue: WaQueueTicket[];
  /** The department this payload is scoped to, and all the ones a viewer can pick. */
  department: { id: string; name: string };
  departments: { id: string; name: string }[];
  /** Names for agents credited on a ticket they are no longer assigned to. */
  agents: AgentDirectory;
  /** This department's agents, live from Zendesk routing. */
  availability: WaAgentAvailability[];
  /** Job roles from Settings, in display order — the availability groups. */
  roles: AgentRoleDef[];
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
/**
 * The queue split by when the bot handed each ticket over: during business
 * hours (someone should pick it up now) or outside them (it waits for the
 * next shift). Everything is "in hours" without a usable schedule.
 */
export function splitQueueByBusinessHours(
  queue: WaQueueTicket[],
  clock: BusinessClock,
): { inHours: WaQueueTicket[]; afterHours: WaQueueTicket[] } {
  const inHours: WaQueueTicket[] = [];
  const afterHours: WaQueueTicket[] = [];
  for (const ticket of queue) {
    (businessOpenAt(ticket.handedToAgentAt, clock) ? inHours : afterHours).push(ticket);
  }
  return { inHours, afterHours };
}

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
 *
 * Wall-clock, not the business clock: the customer is still waiting outside
 * business hours even though no agent is measured on that time (account
 * owner, 2026-09-14 — same reasoning as the queue's own wall clock above).
 * The stored/historical averages ("תגובה מוקד/נציגה", "ביצועי WA") are
 * untouched — only this live view and the escalation-tier colors it drives.
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
    .filter((row) => !row.excludedFromAverages)
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
      !row.excludedFromAverages &&
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

/**
 * Earlier-day tickets whose first reply or close landed today — see
 * WaDashboardPayload.respondedToday/closedToday for why these exist
 * alongside `rows`. Each list is exactly the tickets to credit for that one
 * thing; a ticket answered *and* solved today belongs in both.
 */
export type WaExtraActivity = {
  respondedToday: WaTicketRow[];
  closedToday: WaTicketRow[];
};

const NO_EXTRA_ACTIVITY: WaExtraActivity = { respondedToday: [], closedToday: [] };

/**
 * Rolls a flat list of tickets up into the aggregate figures shown per row.
 * `extra` folds in earlier-day tickets answered/closed today: ticketCount
 * stays "opened today" (rows only), but respondedCount/closedCount and their
 * averages count the reply or the close on the day it actually happened.
 */
export function summarizeTickets(
  rows: WaTicketRow[],
  extra: WaExtraActivity = NO_EXTRA_ACTIVITY,
): WaGroupStats {
  const timedRows = [...rows, ...extra.respondedToday].filter(
    (row) => !row.excludedFromAverages,
  );
  const responseTimes = timedRows
    .map((row) => row.firstResponseSeconds)
    .filter((value): value is number => value != null);
  const agentResponseTimes = timedRows
    .map((row) => row.agentResponseSeconds)
    .filter((value): value is number => value != null);
  const closeTimes = [
    ...rows.filter((row) => row.closed && !row.excludedFromAverages),
    ...extra.closedToday.filter((row) => !row.excludedFromAverages),
  ]
    .map((row) => row.timeToCloseSeconds)
    .filter((value): value is number => value != null);
  return {
    ticketCount: rows.length,
    respondedCount: responseTimes.length,
    avgFirstResponseSeconds: average(responseTimes),
    avgAgentResponseSeconds: average(agentResponseTimes),
    awaitingReply: rows.filter((row) => row.waitingSince != null).length,
    closedCount: rows.filter((row) => row.closed).length + extra.closedToday.length,
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
 * Ticket count and "waiting now" follow the current assignee, from `rows`
 * (today's own tickets) only; first response and closure are credited to the
 * agent assigned at that moment (`firstResponseAgentId` / `solvedByAgentId`)
 * and also pick up `extra` — earlier-day tickets answered or solved today —
 * so an agent whose only work today was on old tickets still shows up, with
 * a ticketCount of 0. `directory` names agents who appear only through
 * credit, with no ticket currently assigned.
 */
export function summarizeByAgent(
  rows: WaTicketRow[],
  directory: AgentDirectory = {},
  extra: WaExtraActivity = NO_EXTRA_ACTIVITY,
): WaAgentSummary[] {
  const keys = new Set<string>();
  for (const row of rows) {
    keys.add(row.agentId ?? "unassigned");
    if (row.firstResponseAgentId) keys.add(row.firstResponseAgentId);
    if (row.solvedByAgentId) keys.add(row.solvedByAgentId);
  }
  for (const row of extra.respondedToday) {
    if (row.firstResponseAgentId) keys.add(row.firstResponseAgentId);
  }
  for (const row of extra.closedToday) {
    if (row.solvedByAgentId) keys.add(row.solvedByAgentId);
  }
  return [...keys]
    .map((key) => {
      const current = rows.filter((row) => (row.agentId ?? "unassigned") === key);
      const responded = rows
        .filter(
          (row) =>
            !row.excludedFromAverages &&
            row.firstResponseSeconds != null && row.firstResponseAgentId === key,
        )
        .concat(
          extra.respondedToday.filter(
            (row) => !row.excludedFromAverages && row.firstResponseAgentId === key,
          ),
        );
      const closed = rows
        .filter((row) => row.closed && !row.excludedFromAverages && row.solvedByAgentId === key)
        .concat(
          extra.closedToday.filter(
            (row) => !row.excludedFromAverages && row.solvedByAgentId === key,
          ),
        );
      const sample = current[0] ??
        extra.respondedToday.find((row) => row.firstResponseAgentId === key) ??
        extra.closedToday.find((row) => row.solvedByAgentId === key);
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
        avgAgentResponseSeconds: average(
          responded
            .map((row) => row.agentResponseSeconds)
            .filter((value): value is number => value != null),
        ),
        awaitingReply: current.filter((row) => row.waitingSince != null).length,
        closedCount: closed.length,
        avgTimeToCloseSeconds: average(
          closed
            .map((row) => row.timeToCloseSeconds)
            .filter((value): value is number => value != null),
        ),
        // Filled in by the API route from zendesk_whatsapp_messages, which
        // this function does not have access to; defaults keep this pure
        // and independently testable.
        avgPerMessageResponseSeconds: null,
        perMessageResponseCount: 0,
      };
    })
    .filter((row) => row.ticketCount > 0 || row.respondedCount > 0 || row.closedCount > 0)
    .sort(worstFirst);
}

export type WhatsappMessageRow = {
  ticket_id: string;
  direction: "handoff" | "agent" | "customer";
  at: string;
};

/**
 * Average seconds from every unanswered customer turn to the agent's next
 * reply, pooled per agent (the ticket's current assignee) from raw
 * zendesk_whatsapp_messages rows — the same table the sync uses to derive
 * first/last message timestamps (see the file header). "handoff" counts as
 * a turn start too: it is the bot handing over a customer who has not had a
 * person reply yet, the same moment "תגובה מוקד" already starts its clock
 * from. Consecutive rows of the same direction cannot happen — each row is
 * already a turn switch (whatsappFlip in the sync function only fires on a
 * tag *change*) — so this pairs each customer/handoff row with the next
 * agent row after it, one pair per turn, not one per WhatsApp bubble.
 */
export function averageMessageResponseByAgent(
  messages: WhatsappMessageRow[],
  agentByTicket: Record<string, string | null>,
): Record<string, { avgSeconds: number | null; count: number }> {
  const byTicket = new Map<string, WhatsappMessageRow[]>();
  for (const row of messages) {
    const bucket = byTicket.get(row.ticket_id);
    if (bucket) bucket.push(row);
    else byTicket.set(row.ticket_id, [row]);
  }
  const sums = new Map<string, { sum: number; count: number }>();
  for (const [ticketId, ticketRows] of byTicket) {
    const key = agentByTicket[ticketId] ?? "unassigned";
    const sorted = [...ticketRows].sort(
      (a, b) => Date.parse(a.at) - Date.parse(b.at),
    );
    let waitingSinceMs: number | null = null;
    for (const row of sorted) {
      if (row.direction === "agent") {
        if (waitingSinceMs != null) {
          const deltaSeconds = (Date.parse(row.at) - waitingSinceMs) / 1000;
          if (deltaSeconds >= 0) {
            const entry = sums.get(key) ?? { sum: 0, count: 0 };
            entry.sum += deltaSeconds;
            entry.count += 1;
            sums.set(key, entry);
          }
          waitingSinceMs = null;
        }
      } else if (waitingSinceMs == null) {
        waitingSinceMs = Date.parse(row.at);
      }
    }
  }
  const result: Record<string, { avgSeconds: number | null; count: number }> = {};
  for (const [key, { sum, count }] of sums) {
    result[key] = { avgSeconds: count > 0 ? sum / count : null, count };
  }
  return result;
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
