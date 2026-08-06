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
// Only tickets created on or after the configured cutoff are stored, so the
// table holds the current month as asked rather than the full 27k history.

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const MAX_PAGES_PER_RUN = 20;

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
  created_at: string;
  updated_at: string;
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

    const rows = tickets
      .filter((ticket) => Date.parse(ticket.created_at) >= cutoffMs)
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

  return result;
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
