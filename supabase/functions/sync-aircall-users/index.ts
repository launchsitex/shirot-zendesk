import {
  createClient,
  type SupabaseClient,
} from "npm:@supabase/supabase-js@2";

type AircallNumber = {
  id: number;
  name?: string;
  digits?: string;
  deleted?: boolean;
};

type AircallUser = {
  id: number;
  name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  deleted?: boolean;
  availability_status?: string;
  substatus?: string;
  state?: string;
  numbers?: AircallNumber[];
};

Deno.serve(async (request) => {
  const supabase = getAdminClient();
  if (!(await authorizeSync(request, supabase))) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  try {
    const { data: credentials, error: credentialsError } = await supabase
      .rpc("get_aircall_api_credentials")
      .single();
    if (credentialsError || !credentials) {
      throw new Error(
        credentialsError?.message ?? "Aircall API credentials are not configured",
      );
    }

    const users = await fetchAllUsers(
      String(credentials.api_id),
      String(credentials.api_token),
    );
    await syncUsers(supabase, users);
    return jsonResponse({ ok: true, users: users.length });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
});

async function fetchAllUsers(apiId: string, apiToken: string) {
  const users: AircallUser[] = [];
  let page = 1;

  while (page <= 100) {
    const response = await fetch(
      `https://api.aircall.io/v1/users?page=${page}&per_page=50`,
      {
        headers: {
          Authorization: `Basic ${btoa(`${apiId}:${apiToken}`)}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) {
      const message = (await response.text()).slice(0, 300);
      throw new Error(`Aircall users ${response.status}: ${message}`);
    }

    const result = (await response.json()) as {
      users?: AircallUser[];
      meta?: { next_page_link?: string | null };
    };
    users.push(...(result.users ?? []));
    if (!result.meta?.next_page_link) return users;
    page += 1;
  }

  throw new Error("Aircall users pagination exceeded 100 pages");
}

async function syncUsers(supabase: SupabaseClient, users: AircallUser[]) {
  const numbers = new Map<string, AircallNumber>();
  for (const user of users) {
    for (const number of user.numbers ?? []) {
      numbers.set(String(number.id), number);
    }
  }

  if (numbers.size) {
    const { error } = await supabase.from("talk_lines").upsert(
      [...numbers.values()].map((number) => ({
        id: String(number.id),
        name: String(number.name ?? number.digits ?? number.id),
        number: number.digits ? String(number.digits) : null,
        active: number.deleted !== true,
        raw: { ...number, provider: "aircall" },
        synced_at: new Date().toISOString(),
      })),
      { onConflict: "id" },
    );
    if (error) throw error;
  }

  if (users.length) {
    const now = new Date().toISOString();
    const { error: agentsError } = await supabase.from("agents").upsert(
      users.map((user) => ({
        id: String(user.id),
        name: String(
          user.name ??
            ([user.first_name, user.last_name].filter(Boolean).join(" ") ||
              user.email ||
              user.id),
        ),
        email: user.email ? String(user.email) : null,
        active: user.deleted !== true,
        raw: { ...user, provider: "aircall" },
        synced_at: now,
      })),
      { onConflict: "id" },
    );
    if (agentsError) throw agentsError;

    for (const user of users) {
      const agentId = String(user.id);
      const state = mapState(user);
      const { data: previous } = await supabase
        .from("agent_live_status")
        .select("state,state_since,current_call_started_at")
        .eq("agent_id", agentId)
        .maybeSingle();

      // "unavailable" is NOT away presence: Aircall reports in-call agents
      // as unavailable, so treating it as away closed live calls (bug).
      const awayPresence = [
        "back_office",
        "on_break",
        "out_for_lunch",
        "in_training",
        "other",
      ].includes(state);

      // Aircall explicit presence wins — close phantom open calls, but only
      // truly stale ones (no webhook update for 30+ minutes).
      if (awayPresence) {
        await supabase
          .from("calls")
          .update({
            status: "answered",
            ended_at: now,
            completion_status: "aircall_api_sync_away",
            source_updated_at: now,
            synced_at: now,
          })
          .eq("agent_id", agentId)
          .eq("status", "in_progress")
          .lt(
            "source_updated_at",
            new Date(Date.now() - 30 * 60_000).toISOString(),
          );
      }

      if (!awayPresence) {
        // Roster sync only knows availability — never wipe an active call
        // state. Aircall also reports in-call agents as "unavailable", so any
        // open call means the webhook owns this agent's state right now.
        const { count } = await supabase
          .from("calls")
          .select("id", { count: "exact", head: true })
          .eq("agent_id", agentId)
          .eq("status", "in_progress");
        if ((count ?? 0) > 0 || previous?.state === "wrap_up") {
          continue;
        }
      }

      const { error } = await supabase.from("agent_live_status").upsert(
        {
          agent_id: agentId,
          state,
          state_since: previous?.state === state ? previous.state_since : now,
          current_call_started_at: null,
          zendesk_agent_state:
            user.substatus ?? user.state ?? user.availability_status ?? state,
          zendesk_call_status: "aircall_api_sync",
          raw: {
            provider: "aircall",
            source: "users_api",
            substatus: user.substatus ?? user.state ?? null,
          },
          updated_at: now,
        },
        { onConflict: "agent_id" },
      );
      if (error) throw error;
    }
  }
}

function mapState(user: AircallUser) {
  const substatus = String(user.substatus ?? user.state ?? "").toLowerCase();
  const states: Record<string, string> = {
    always_open: "available",
    always_opened: "available",
    according_to_schedule: "scheduled",
    auto: "scheduled",
    out_for_lunch: "out_for_lunch",
    on_a_break: "on_break",
    on_break: "on_break",
    in_training: "in_training",
    doing_back_office: "back_office",
    other: "other",
    always_closed: "unavailable",
  };
  if (states[substatus]) return states[substatus];
  if (user.availability_status === "available") return "available";
  if (user.availability_status === "custom") return "scheduled";
  // Aircall reports a mid-call agent's availability_status as "in_call" /
  // "after_call_work" — without these the roster sync could never restore
  // on_call/wrap_up for an agent it's otherwise correctly leaving alone.
  if (user.availability_status === "in_call") return "on_call";
  if (user.availability_status === "after_call_work") return "wrap_up";
  return "unavailable";
}

function getAdminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function authorizeSync(request: Request, supabase: SupabaseClient) {
  const { data: expected, error } = await supabase.rpc("get_sync_secret");
  if (error) return false;
  return Boolean(
    expected &&
      request.headers.get("x-sync-secret") &&
      request.headers.get("x-sync-secret") === expected,
  );
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
