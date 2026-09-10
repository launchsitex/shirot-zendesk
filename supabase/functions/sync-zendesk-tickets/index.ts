// Pulls Zendesk tickets into public.zendesk_tickets for the "מעקב פניות" page.
//
// Uses Zendesk's incremental export rather than the search API: search caps out
// at 1000 results and its cursor drifts, while incremental export is designed
// for exactly this, pages reliably, and sideloads the requester records so the
// customer's name and phone arrive with the ticket instead of costing one extra
// API call each.
//
// The cursor lives in zendesk_sync_state.last_start_time. Incremental export is
// keyed on *updated* time, so a run picks up status changes on tickets it has
// already seen — which is what keeps the open/closed counts honest.
//
// Only tickets created on or after the configured cutoff are added, so the
// table holds the current month as asked rather than the full 27k history —
// but a ticket already stored keeps being updated past the month boundary.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const MAX_PAGES_PER_RUN = 20;
// Comment events stream far heavier than tickets, so they get a smaller budget:
// incremental exports are limited to ten requests a minute and the ticket pass
// above already spends some of that. A backlog simply drains over several runs.
const MAX_EVENT_PAGES_PER_RUN = 6;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

type ZendeskUser = {
  id: number;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
};

type ZendeskTicket = {
  id: number;
  subject?: string | null;
  status?: string | null;
  priority?: string | null;
  requester_id?: number | null;
  assignee_id?: number | null;
  group_id?: number | null;
  custom_status_id?: number | null;
  created_at: string;
  updated_at: string;
  via?: { channel?: string | null } | null;
};

Deno.serve(async (request) => {
  if (request.method !== "POST") return jsonResponse({ error: "method" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data: expected } = await supabase.rpc("get_sync_secret");
  if (!expected || request.headers.get("x-sync-secret") !== expected) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // Empty body is the normal cron invocation.
  }

  try {
    const result = await sync(supabase, body);
    return jsonResponse({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[sync-zendesk-tickets] failed", message);
    await supabase.from("system_event_logs").insert({
      severity: "error",
      category: "zendesk-tickets",
      title: "סנכרון פניות מ-Zendesk נכשל",
      message,
    });
    return jsonResponse({ error: message }, 500);
  }
});

async function sync(supabase: SupabaseClient, body: Record<string, unknown>) {
  const email = Deno.env.get("mail_Zendesk")?.trim();
  const token = Deno.env.get("API_Zendesk")?.trim();
  const subdomain = (Deno.env.get("ZENDESK_SUBDOMAIN") ?? "rcity").trim();
  if (!email || !token) throw new Error("mail_Zendesk / API_Zendesk not set");

  const auth = `Basic ${btoa(`${email}/token:${token}`)}`;
  const base = `https://${subdomain}.zendesk.com/api/v2`;

  // Start of the current month in Jerusalem, as a unix timestamp.
  const monthStart = startOfCurrentMonthUtc();
  const cutoffMs = Date.parse(monthStart);

  const { data: state } = await supabase
    .from("zendesk_sync_state")
    .select("last_start_time")
    .eq("id", 1)
    .maybeSingle();

  // A full resync is requested explicitly; otherwise resume from the cursor,
  // falling back to the month start on the very first run.
  const startTime = body.full === true
    ? Math.floor(cutoffMs / 1000)
    : (state?.last_start_time ?? Math.floor(cutoffMs / 1000));

  // Assignee email -> our agent id. Names are not used as a fallback: two
  // people can share a display name, and an email cannot be ambiguous.
  const { data: agentRows } = await supabase
    .from("agents")
    .select("id,email");
  const agentByEmail = new Map<string, string>();
  for (const agent of agentRows ?? []) {
    const key = String(agent.email ?? "").trim().toLowerCase();
    if (key) agentByEmail.set(key, agent.id);
  }

  let cursor = startTime;
  let pages = 0;
  let seen = 0;
  let stored = 0;
  let endOfStream = false;

  while (pages < MAX_PAGES_PER_RUN) {
    const url =
      `${base}/incremental/tickets.json?start_time=${cursor}&include=users`;
    const response = await fetch(url, {
      headers: { Authorization: auth, Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 429) {
      // Incremental export allows 10 requests a minute; stop cleanly and let
      // the next scheduled run continue from the cursor we already hold.
      break;
    }
    if (!response.ok) {
      throw new Error(
        `zendesk_${response.status}:${(await response.text()).slice(0, 300)}`,
      );
    }

    const page = await response.json() as {
      tickets?: ZendeskTicket[];
      users?: ZendeskUser[];
      end_time?: number;
      end_of_stream?: boolean;
    };
    pages += 1;

    const usersById = new Map<number, ZendeskUser>();
    for (const user of page.users ?? []) usersById.set(user.id, user);

    const tickets = page.tickets ?? [];
    seen += tickets.length;

    // New tickets are stored only from the cutoff on, but a ticket already in
    // the table keeps receiving updates whatever its age. Without this, every
    // ticket froze at whatever it looked like on the last day of its month:
    // on 2026-09-09 a hundred August tickets still read "new / unassigned"
    // days after they had been put on hold in Zendesk.
    const pageIds = tickets.map((ticket) => String(ticket.id));
    const { data: known } = pageIds.length
      ? await supabase.from("zendesk_tickets").select("id").in("id", pageIds)
      : { data: [] as { id: string }[] };
    const knownIds = new Set((known ?? []).map((row) => String(row.id)));

    const rows = tickets
      .filter((ticket) =>
        Date.parse(ticket.created_at) >= cutoffMs ||
        knownIds.has(String(ticket.id))
      )
      .map((ticket) => {
        const requester = ticket.requester_id
          ? usersById.get(ticket.requester_id)
          : undefined;
        const assignee = ticket.assignee_id
          ? usersById.get(ticket.assignee_id)
          : undefined;
        const assigneeEmail = String(assignee?.email ?? "").trim().toLowerCase();
        return {
          id: String(ticket.id),
          subject: ticket.subject ?? null,
          status: String(ticket.status ?? "unknown"),
          priority: ticket.priority ?? null,
          requester_id: ticket.requester_id ? String(ticket.requester_id) : null,
          requester_name: requester?.name ?? null,
          requester_phone: requester?.phone ?? null,
          assignee_id: ticket.assignee_id ? String(ticket.assignee_id) : null,
          assignee_email: assignee?.email ?? null,
          assignee_name: assignee?.name ?? null,
          agent_id: assigneeEmail
            ? (agentByEmail.get(assigneeEmail) ?? null)
            : null,
          group_id: ticket.group_id ? String(ticket.group_id) : null,
          custom_status_id: ticket.custom_status_id
            ? String(ticket.custom_status_id)
            : null,
          // Promoted out of raw so the open-tickets page can exclude WhatsApp
          // with an indexed filter instead of probing JSONB on every row.
          via_channel: ticket.via?.channel ?? null,
          zendesk_created_at: ticket.created_at,
          zendesk_updated_at: ticket.updated_at,
          raw: ticket as unknown as Record<string, unknown>,
          synced_at: new Date().toISOString(),
        };
      });

    if (rows.length) {
      const { error } = await supabase
        .from("zendesk_tickets")
        .upsert(rows, { onConflict: "id" });
      if (error) throw new Error(`upsert:${error.message}`);
      stored += rows.length;
    }

    if (page.end_time) cursor = page.end_time;
    if (page.end_of_stream || !tickets.length) {
      endOfStream = true;
      break;
    }
  }

  const result = {
    pages,
    tickets_seen: seen,
    tickets_stored: stored,
    end_of_stream: endOfStream,
    cursor,
  };

  await supabase.from("zendesk_sync_state").update({
    last_start_time: cursor,
    last_run_at: new Date().toISOString(),
    last_result: result,
  }).eq("id", 1);

  const comments = await syncComments(
    supabase,
    { auth, base },
    body.full === true ? Math.floor(cutoffMs / 1000) : null,
    cutoffMs,
  );

  // Availability is not on the incremental export's ten-a-minute budget (it
  // is a normal endpoint), so it rides along every run without cost to the
  // ticket passes. A failure here is logged but must not fail the tickets.
  let availability: Record<string, unknown>;
  try {
    availability = await syncAgentAvailability(supabase, { auth, base }, agentByEmail);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[sync-zendesk-tickets] availability failed", message);
    availability = { error: message };
  }

  // Also a normal endpoint, off the incremental budget. Keeps
  // zendesk_custom_statuses current as statuses are added or renamed —
  // see 20260910140000_zendesk_custom_statuses for why this matters for
  // "ממתין לתגובה".
  let customStatuses: Record<string, unknown>;
  try {
    customStatuses = await syncCustomStatuses(supabase, { auth, base });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[sync-zendesk-tickets] custom statuses failed", message);
    customStatuses = { error: message };
  }

  return { ...result, comments, availability, customStatuses };
}

/**
 * Snapshot of every agent's status and messaging load from the Agent
 * Availability API (20260909230000_zendesk_agent_availability). Statuses can
 * be custom names ("הפסקה"), stored as given; the dashboards translate the
 * built-in ones and show custom ones as they are.
 */
async function syncAgentAvailability(
  supabase: SupabaseClient,
  api: { auth: string; base: string },
  agentByEmail: Map<string, string>,
) {
  const response = await fetch(
    `${api.base}/agent_availabilities?include=channels&page[size]=100`,
    {
      headers: { Authorization: api.auth, Accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok) {
    throw new Error(
      `zendesk_availability_${response.status}:${(await response.text()).slice(0, 200)}`,
    );
  }
  const page = await response.json() as {
    data?: Array<{
      attributes?: {
        agent_id?: number;
        agent_status?: { name?: string; reason?: string; updated_at?: string };
        group_ids?: number[];
      };
    }>;
    included?: Array<{
      id?: string;
      attributes?: {
        name?: string;
        status?: string;
        work_item_count?: number;
        max_capacity?: number;
      };
    }>;
  };

  // Channel rows are keyed "agent_availabilities|<agent>|channels|<name>".
  const messagingByAgent = new Map<string, {
    status?: string;
    work_item_count?: number;
    max_capacity?: number;
  }>();
  for (const channel of page.included ?? []) {
    const attributes = channel.attributes ?? {};
    if (attributes.name !== "messaging") continue;
    const agentId = String(channel.id ?? "").split("|")[1];
    if (agentId) messagingByAgent.set(agentId, attributes);
  }

  const agents = page.data ?? [];
  const zendeskIds = agents
    .map((row) => row.attributes?.agent_id)
    .filter((id): id is number => id != null);

  // Zendesk id -> email, to land on our roster the same way ticket assignees
  // do. show_many takes up to 100 ids; this account has ~45 agents.
  const emailById = new Map<string, string>();
  for (let i = 0; i < zendeskIds.length; i += 100) {
    const chunk = zendeskIds.slice(i, i + 100);
    const users = await fetch(
      `${api.base}/users/show_many.json?ids=${chunk.join(",")}`,
      {
        headers: { Authorization: api.auth, Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!users.ok) continue;
    const body = await users.json() as {
      users?: Array<{ id?: number; email?: string | null }>;
    };
    for (const user of body.users ?? []) {
      if (user.id != null && user.email) {
        emailById.set(String(user.id), user.email.trim().toLowerCase());
      }
    }
  }

  const now = new Date().toISOString();
  const rows = agents.flatMap((row) => {
    const attributes = row.attributes ?? {};
    if (attributes.agent_id == null) return [];
    const zendeskId = String(attributes.agent_id);
    const messaging = messagingByAgent.get(zendeskId);
    const email = emailById.get(zendeskId);
    return [{
      zendesk_agent_id: zendeskId,
      agent_id: email ? (agentByEmail.get(email) ?? null) : null,
      status_name: attributes.agent_status?.name ?? "unknown",
      status_reason: attributes.agent_status?.reason ?? null,
      status_updated_at: attributes.agent_status?.updated_at ?? null,
      messaging_status: messaging?.status ?? null,
      messaging_work_items: messaging?.work_item_count ?? 0,
      messaging_max_capacity: messaging?.max_capacity ?? null,
      group_ids: (attributes.group_ids ?? []).map(String),
      synced_at: now,
    }];
  });

  if (rows.length) {
    const { error } = await supabase
      .from("zendesk_agent_availability")
      .upsert(rows, { onConflict: "zendesk_agent_id" });
    if (error) throw new Error(`availability_upsert:${error.message}`);
  }

  return {
    agents: rows.length,
    mapped: rows.filter((row) => row.agent_id).length,
    online: rows.filter((row) => row.status_name === "online").length,
  };
}

/**
 * Every custom status, agent-facing label and which one is the *default* for
 * its category ("פתוחה" for open — see 20260910140000_zendesk_custom_statuses).
 * A handful of rows; fetched and replaced whole rather than upserted, so a
 * status someone deletes in Zendesk disappears here too.
 */
async function syncCustomStatuses(
  supabase: SupabaseClient,
  api: { auth: string; base: string },
) {
  const response = await fetch(`${api.base}/custom_statuses`, {
    headers: { Authorization: api.auth, Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(
      `zendesk_custom_statuses_${response.status}:${(await response.text()).slice(0, 200)}`,
    );
  }
  const page = await response.json() as {
    custom_statuses?: Array<{
      id: number;
      status_category?: string;
      agent_label?: string;
      default?: boolean;
      active?: boolean;
    }>;
  };

  const rows = (page.custom_statuses ?? []).map((status) => ({
    id: String(status.id),
    status_category: status.status_category ?? "open",
    agent_label: status.agent_label ?? "",
    is_default: status.default === true,
    active: status.active !== false,
    synced_at: new Date().toISOString(),
  }));

  if (rows.length) {
    const { error } = await supabase
      .from("zendesk_custom_statuses")
      .upsert(rows, { onConflict: "id" });
    if (error) throw new Error(`custom_statuses_upsert:${error.message}`);
    const keepIds = rows.map((row) => row.id);
    await supabase
      .from("zendesk_custom_statuses")
      .delete()
      .not("id", "in", `(${keepIds.join(",")})`);
  }

  return { statuses: rows.length };
}

/**
 * Pulls comment events and refreshes the documentation counters.
 *
 * Whether an agent wrote anything cannot come from Zendesk's `replies` metric:
 * that counts public replies, and this team writes internal notes through the
 * Aircall app, so it reads zero almost everywhere. The comment event stream
 * gives the author of every comment, and a comment counts as documentation when
 * its author is the ticket's own assignee.
 */
async function syncComments(
  supabase: SupabaseClient,
  api: { auth: string; base: string },
  forcedStart: number | null,
  cutoffMs: number,
) {
  const { data: state } = await supabase
    .from("zendesk_sync_state")
    .select("last_events_start_time")
    .eq("id", 1)
    .maybeSingle();

  let cursor = forcedStart ??
    state?.last_events_start_time ??
    Math.floor(cutoffMs / 1000);

  let pages = 0;
  let stored = 0;
  let messagesStored = 0;
  let transitionsStored = 0;
  let endOfStream = false;
  const touched = new Set<string>();
  const touchedWhatsapp = new Set<string>();
  const touchedTransitions = new Set<string>();

  while (pages < MAX_EVENT_PAGES_PER_RUN) {
    const url =
      `${api.base}/incremental/ticket_events.json?start_time=${cursor}` +
      `&include=comment_events`;
    const response = await fetch(url, {
      headers: { Authorization: api.auth, Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 429) break;
    if (!response.ok) {
      throw new Error(
        `zendesk_events_${response.status}:` +
          `${(await response.text()).slice(0, 300)}`,
      );
    }

    const page = await response.json() as {
      ticket_events?: Array<Record<string, unknown>>;
      end_time?: number;
      end_of_stream?: boolean;
    };
    pages += 1;

    const rows: Array<Record<string, unknown>> = [];
    const messages: Array<Record<string, unknown>> = [];
    const transitions: Array<Record<string, unknown>> = [];
    for (const event of page.ticket_events ?? []) {
      const ticketId = String(event.ticket_id ?? "");
      if (!ticketId) continue;
      const at = String(event.created_at ?? new Date().toISOString());
      for (
        const child of (event.child_events ?? []) as Array<
          Record<string, unknown>
        >
      ) {
        if (child.event_type === "Comment") {
          rows.push({
            id: String(child.id ?? `${event.id}-${child.author_id}`),
            ticket_id: ticketId,
            author_id: child.author_id != null ? String(child.author_id) : null,
            is_public: child.public === true,
            created_at: at,
          });
          touched.add(ticketId);
          continue;
        }
        // WhatsApp runs on Zendesk Messaging, where messages are not comments
        // while the chat is live — the whole session lands as one transcript
        // later. A Messaging trigger does flip a tag on every message, though,
        // so a tag change that *adds* one of these is a message with a
        // direction and a time. See 20260909120000_zendesk_whatsapp_messages.
        // The bot handles the start of every conversation and hands it to the
        // agents' queue by clearing its own assignment and moving the status
        // open→new (agents cannot set "new" themselves). That transition is
        // where the first-response clock starts. Not OfferedToEvent: that
        // fires when the routing offers the chat to an available agent, which
        // can be minutes later (20260909200000_zendesk_whatsapp_handoff_is_status_new).
        if (child.event_type !== "Change") continue;

        // Status and assignee changes, for exact close times and for
        // crediting first response / closure to the agent assigned at that
        // moment (20260909220000_zendesk_ticket_transitions).
        if ("status" in child && child.status != null) {
          transitions.push({
            id: `${child.id ?? event.id}-status`,
            ticket_id: ticketId,
            at,
            kind: "status",
            value: String(child.status),
          });
          touchedTransitions.add(ticketId);
        }
        if ("assignee_id" in child) {
          transitions.push({
            id: `${child.id ?? event.id}-assignee`,
            ticket_id: ticketId,
            at,
            kind: "assignee",
            value: child.assignee_id == null ? "" : String(child.assignee_id),
          });
          touchedTransitions.add(ticketId);
        }

        const direction =
          child.status === "new" && child.previous_value === "open"
            ? "handoff"
            : whatsappFlip(child);
        if (!direction) continue;
        messages.push({
          id: String(child.id ?? `${event.id}-${direction}`),
          ticket_id: ticketId,
          direction,
          at,
        });
        touchedWhatsapp.add(ticketId);
      }
    }

    if (transitions.length) {
      const { error } = await supabase
        .from("zendesk_ticket_transitions")
        .upsert(transitions, { onConflict: "id" });
      if (error) throw new Error(`transition_upsert:${error.message}`);
      transitionsStored += transitions.length;
    }

    if (rows.length) {
      const { error } = await supabase
        .from("zendesk_ticket_comments")
        .upsert(rows, { onConflict: "id" });
      if (error) throw new Error(`comment_upsert:${error.message}`);
      stored += rows.length;
    }

    if (messages.length) {
      const { error } = await supabase
        .from("zendesk_whatsapp_messages")
        .upsert(messages, { onConflict: "id" });
      if (error) throw new Error(`whatsapp_upsert:${error.message}`);
      messagesStored += messages.length;
    }

    if (page.end_time) cursor = page.end_time;
    if (page.end_of_stream || !(page.ticket_events ?? []).length) {
      endOfStream = true;
      break;
    }
  }

  // Only tickets touched this run are recomputed, in chunks so the array
  // parameter stays a sane size.
  let recomputed = 0;
  const ids = [...touched];
  for (let i = 0; i < ids.length; i += 500) {
    const { data, error } = await supabase.rpc(
      "recompute_ticket_documentation",
      { p_ticket_ids: ids.slice(i, i + 500) },
    );
    if (error) throw new Error(`recompute:${error.message}`);
    recomputed += Number(data ?? 0);
  }

  let whatsappRecomputed = 0;
  const whatsappIds = [...touchedWhatsapp];
  for (let i = 0; i < whatsappIds.length; i += 500) {
    const { data, error } = await supabase.rpc(
      "recompute_whatsapp_activity",
      { p_ticket_ids: whatsappIds.slice(i, i + 500) },
    );
    if (error) throw new Error(`recompute_whatsapp:${error.message}`);
    whatsappRecomputed += Number(data ?? 0);
  }

  // After the WhatsApp pass: crediting first response needs
  // first_agent_message_at to be current.
  let transitionsRecomputed = 0;
  const transitionIds = [...touchedTransitions];
  for (let i = 0; i < transitionIds.length; i += 500) {
    const { data, error } = await supabase.rpc(
      "recompute_ticket_transitions",
      { p_ticket_ids: transitionIds.slice(i, i + 500) },
    );
    if (error) throw new Error(`recompute_transitions:${error.message}`);
    transitionsRecomputed += Number(data ?? 0);
  }

  const result = {
    pages,
    comments_stored: stored,
    tickets_touched: touched.size,
    tickets_recomputed: recomputed,
    whatsapp_messages_stored: messagesStored,
    whatsapp_tickets_recomputed: whatsappRecomputed,
    transitions_stored: transitionsStored,
    transitions_recomputed: transitionsRecomputed,
    end_of_stream: endOfStream,
    cursor,
  };

  await supabase.from("zendesk_sync_state").update({
    last_events_start_time: cursor,
    last_events_result: result,
  }).eq("id", 1);

  return result;
}

const WHATSAPP_FLIP_TAGS = {
  agent: "last_whatsapp_reply_agent",
  customer: "last_whatsapp_reply_customer",
} as const;

/**
 * Which side wrote, if this Change child event is one of the Messaging
 * trigger's flips — i.e. it *added* a last_whatsapp_reply_* tag.
 *
 * In the incremental ticket_events export a tag change is not a
 * field_name/value/previous_value triple like in ticket audits: the child
 * carries `tags` (the full list after the change) plus `added_tags` and
 * `removed_tags`, and `via: "Messaging Trigger"`. Verified on a live page
 * on 2026-09-09. A change that merely carries the tag along (triage adding
 * an intent tag, say) has it in `tags` but not in `added_tags`, and is
 * ignored.
 */
function whatsappFlip(
  child: Record<string, unknown>,
): "agent" | "customer" | null {
  const asTags = (input: unknown): string[] =>
    Array.isArray(input)
      ? input.map(String)
      : typeof input === "string"
      ? input.split(/\s+/).filter(Boolean)
      : [];
  const added = asTags(child.added_tags);
  for (const direction of ["agent", "customer"] as const) {
    if (added.includes(WHATSAPP_FLIP_TAGS[direction])) return direction;
  }
  return null;
}

/** First instant of the current month, Asia/Jerusalem, as an ISO string. */
function startOfCurrentMonthUtc(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
  const [year, month] = parts.split("-");
  // Same two-pass wall-clock correction used elsewhere in the project.
  const wallClockUtc = Date.parse(`${year}-${month}-01T00:00:00.000Z`);
  let instant = wallClockUtc;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (let pass = 0; pass < 2; pass += 1) {
    const p = Object.fromEntries(
      formatter.formatToParts(new Date(instant))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
    const representedAsUtc = Date.UTC(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day),
      Number(p.hour),
      Number(p.minute),
      Number(p.second),
    );
    instant = wallClockUtc - (representedAsUtc - instant);
  }
  return new Date(instant).toISOString();
}
