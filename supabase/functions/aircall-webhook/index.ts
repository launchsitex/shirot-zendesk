import {
  getAdminClient,
  jsonResponse,
} from "../_shared/zendesk.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

type UnknownRecord = Record<string, unknown>;

Deno.serve(async (request) => {
  if (request.method === "GET") {
    return jsonResponse({ ok: true, provider: "aircall" });
  }
  if (request.method !== "POST") return jsonResponse({ error: "method" }, 405);

  const supabase = getAdminClient();
  const requestUrl = new URL(request.url);
  const key = requestUrl.searchParams.get("key") ?? "";
  const { data: authorized, error: authError } = await supabase.rpc(
    "verify_aircall_webhook_key",
    { p_key: key },
  );
  if (authError || !authorized) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const rawBody = await request.text();
  let payload: UnknownRecord;
  try {
    payload = JSON.parse(rawBody) as UnknownRecord;
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const eventType = String(payload.event ?? "");
  if (!eventType || !isRecord(payload.data)) {
    return jsonResponse({ error: "invalid_aircall_event" }, 400);
  }

  const deliveryHash = await sha256(rawBody);
  const tokenHash = payload.token ? await sha256(String(payload.token)) : null;
  const storedPayload = { ...payload, token: payload.token ? "[redacted]" : undefined };
  const { data: eventRow, error: insertError } = await supabase
    .from("aircall_webhook_events")
    .insert({
      delivery_hash: deliveryHash,
      event_type: eventType,
      aircall_token: tokenHash,
      payload: storedPayload,
    })
    .select("id")
    .single();

  if (insertError?.code === "23505") {
    return jsonResponse({ ok: true, duplicate: true });
  }
  if (insertError || !eventRow) {
    return jsonResponse({ error: insertError?.message ?? "event_store_failed" }, 500);
  }

  try {
    if (eventType.startsWith("call.")) {
      await processCallEvent(supabase, eventType, payload.data);
    } else if (eventType.startsWith("user.")) {
      await processUserEvent(supabase, eventType, payload.data);
    } else if (eventType.startsWith("number.")) {
      await upsertNumber(supabase, payload.data);
    }

    await supabase
      .from("aircall_webhook_events")
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq("id", eventRow.id);
    return jsonResponse({ ok: true, event: eventType });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase
      .from("aircall_webhook_events")
      .update({
        error_message: message.slice(0, 1000),
        processed_at: new Date().toISOString(),
      })
      .eq("id", eventRow.id);
    return jsonResponse({ error: message }, 500);
  }
});

async function processCallEvent(
  supabase: SupabaseClient,
  eventType: string,
  call: UnknownRecord,
) {
  const callId = String(call.id ?? "");
  if (!callId) throw new Error("Aircall call event is missing data.id");

  const user = isRecord(call.user) ? call.user : null;
  const assignedTo = isRecord(call.assigned_to) ? call.assigned_to : null;
  const eventUser = user ?? assignedTo;
  if (eventUser) await upsertAgent(supabase, eventUser);

  const number = isRecord(call.number) ? call.number : null;
  if (number) await upsertNumber(supabase, number);

  const teams = Array.isArray(call.teams)
    ? call.teams.filter(isRecord)
    : [];
  if (teams.length) {
    const { error } = await supabase.from("zendesk_groups").upsert(
      teams.map((team) => ({
        id: String(team.id),
        name: String(team.name ?? team.id),
        active: true,
        raw: team,
        synced_at: new Date().toISOString(),
      })),
      { onConflict: "id" },
    );
    if (error) throw error;
  }

  const lineId = number?.id ? String(number.id) : null;
  const groupIds = teams.map((team) => String(team.id));
  const [{ data: groupMappings }, { data: lineMapping }] = await Promise.all([
    groupIds.length
      ? supabase
          .from("department_groups")
          .select("department_id,group_id")
          .in("group_id", groupIds)
      : Promise.resolve({ data: [] }),
    lineId
      ? supabase
          .from("department_lines")
          .select("department_id")
          .eq("line_id", lineId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const departmentId =
    groupMappings?.[0]?.department_id ??
    lineMapping?.department_id ??
    inferDepartment(teams);

  const startedAt = toIso(call.started_at) ?? new Date().toISOString();
  const answeredAt = toIso(call.answered_at);
  const endedAt = toIso(call.ended_at);
  const isFinished =
    eventType === "call.hungup" ||
    eventType === "call.ended" ||
    String(call.status ?? "") === "done";
  const status = isFinished
    ? answeredAt
      ? "answered"
      : "missed"
    : "in_progress";
  const eventTime = endedAt ?? answeredAt ?? startedAt;

  const { data: existing } = await supabase
    .from("calls")
    .select("status,source_updated_at,agent_id")
    .eq("id", callId)
    .maybeSingle();
  if (
    existing &&
    existing?.status !== "in_progress" &&
    !isFinished &&
    eventType !== "call.comm_assets_generated"
  ) {
    return;
  }
  if (
    existing?.source_updated_at &&
    new Date(existing.source_updated_at).getTime() >
      new Date(eventTime).getTime()
  ) {
    return;
  }

  // Prefer the agent on the current event. Never wipe a known agent_id when a
  // later event omits user (common on inbound ringing / decline / hangup).
  const eventAgentId = eventUser?.id ? String(eventUser.id) : null;
  const answeredAgentId = eventAgentId ?? existing?.agent_id ?? null;
  const duration = Math.max(
    Number(call.duration ?? 0),
    endedAt
      ? Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000)
      : 0,
  );
  const talkTime = answeredAt
    ? Math.max(
        0,
        Math.round(
          ((endedAt ? new Date(endedAt).getTime() : Date.now()) -
            new Date(answeredAt).getTime()) /
            1000,
        ),
      )
    : 0;
  const waitTime = answeredAt
    ? Math.max(
        0,
        Math.round(
          (new Date(answeredAt).getTime() - new Date(startedAt).getTime()) /
            1000,
        ),
      )
    : 0;

  const { error: callError } = await supabase.from("calls").upsert(
    {
      id: callId,
      direction: call.direction === "outbound" ? "outbound" : "inbound",
      status,
      completion_status: String(call.status ?? eventType),
      agent_id: answeredAgentId,
      department_id: departmentId,
      line_id: lineId,
      customer_number: String(
        call.raw_digits ??
          (isRecord(call.contact) ? call.contact.phone_number ?? "" : ""),
      ),
      started_at: startedAt,
      ended_at: isFinished ? endedAt ?? eventTime : null,
      duration_seconds: duration,
      talk_time_seconds: talkTime,
      wait_time_seconds: waitTime,
      raw: { ...call, provider: "aircall", last_event: eventType },
      source_updated_at: eventTime,
      synced_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (callError) throw callError;

  if (eventUser?.id) {
    const state =
      eventType === "call.ringing_on_agent"
        ? "ringing"
        : eventType === "call.answered"
          ? "on_call"
          : eventType === "call.hungup" &&
              Number(eventUser.wrap_up_time ?? 0) === 0
            ? mapAvailability(eventUser)
            : null;
    if (state) {
      await updateAgentState(
        supabase,
        String(eventUser.id),
        state,
        state === "on_call" ? answeredAt ?? new Date().toISOString() : null,
        eventType,
      );
    }
  }

  await storeRecording(supabase, callId, call, "recording");
  await storeRecording(supabase, callId, call, "voicemail");
}

async function processUserEvent(
  supabase: SupabaseClient,
  eventType: string,
  user: UnknownRecord,
) {
  if (!user.id) return;
  const numbers = Array.isArray(user.numbers)
    ? user.numbers.filter(isRecord)
    : [];
  await Promise.all(numbers.map((number) => upsertNumber(supabase, number)));
  await upsertAgent(supabase, user);
  const normalized = eventType.replace(/\.v2$/, "");
  const state =
    normalized === "user.wut_start"
      ? "wrap_up"
      : normalized === "user.deleted" ||
          (normalized === "user.disconnected" &&
            !String(user.substatus ?? "").trim())
        ? "unavailable"
        : mapAvailability(user);
  await updateAgentState(
    supabase,
    String(user.id),
    state,
    null,
    String(user.substatus ?? user.availability_status ?? eventType),
  );
}

async function upsertAgent(supabase: SupabaseClient, user: UnknownRecord) {
  if (!user.id) return;
  const { error } = await supabase.from("agents").upsert(
    {
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
      synced_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) throw error;
}

async function upsertNumber(supabase: SupabaseClient, number: UnknownRecord) {
  if (!number.id) return;
  const { error } = await supabase.from("talk_lines").upsert(
    {
      id: String(number.id),
      name: String(number.name ?? number.digits ?? number.id),
      number: number.digits ? String(number.digits) : null,
      active: number.deleted !== true,
      raw: { ...number, provider: "aircall" },
      synced_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) throw error;
}

async function updateAgentState(
  supabase: SupabaseClient,
  agentId: string,
  state: string,
  currentCallStartedAt: string | null,
  sourceState: string,
) {
  const now = new Date().toISOString();
  const { data: previous } = await supabase
    .from("agent_live_status")
    .select("state,state_since")
    .eq("agent_id", agentId)
    .maybeSingle();
  const { error } = await supabase.from("agent_live_status").upsert(
    {
      agent_id: agentId,
      state,
      state_since: previous?.state === state ? previous.state_since : now,
      current_call_started_at: currentCallStartedAt,
      zendesk_agent_state: sourceState,
      zendesk_call_status: sourceState,
      raw: { provider: "aircall", event: sourceState },
      updated_at: now,
    },
    { onConflict: "agent_id" },
  );
  if (error) throw error;
}

async function storeRecording(
  supabase: SupabaseClient,
  callId: string,
  call: UnknownRecord,
  type: "recording" | "voicemail",
) {
  const directUrl = call[type];
  const shortUrl = call[`${type}_short_url`];
  const url = String(directUrl ?? shortUrl ?? "");
  if (!url.startsWith("https://")) return;
  const { error } = await supabase.from("call_recordings").upsert(
    {
      id: `aircall-${callId}-${type}`,
      call_id: callId,
      ticket_id: callId,
      comment_id: `${type}-${callId}`,
      recording_type: type === "recording" ? "call" : "voicemail",
      recording_url: url,
      duration_seconds: Number(call.duration ?? 0),
      created_at: toIso(call.ended_at) ?? new Date().toISOString(),
      raw: { ...call, provider: "aircall" },
      synced_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) throw error;
}

function mapAvailability(user: UnknownRecord) {
  const substatus = String(user.substatus ?? "")
    .trim()
    .toLowerCase();
  const substatusStates: Record<string, string> = {
    always_open: "available",
    always_opened: "available",
    available: "available",
    according_to_schedule: "scheduled",
    scheduled: "scheduled",
    out_for_lunch: "out_for_lunch",
    lunch: "out_for_lunch",
    on_a_break: "on_break",
    on_break: "on_break",
    break: "on_break",
    in_training: "in_training",
    training: "in_training",
    doing_back_office: "back_office",
    back_office: "back_office",
    other: "other",
    always_closed: "unavailable",
    unavailable: "unavailable",
  };
  if (substatusStates[substatus]) return substatusStates[substatus];

  const availability = String(
    user.availability_status ?? user.status ?? user.available ?? "",
  ).toLowerCase();
  if (
    availability === "available" ||
    availability === "custom" ||
    availability === "true"
  ) {
    return "available";
  }
  if (availability === "in_call") return "on_call";
  if (availability === "after_call_work") return "wrap_up";
  return "unavailable";
}

function inferDepartment(teams: UnknownRecord[]) {
  const names = teams
    .map((team) => String(team.name ?? "").replace(/\s/g, "").toLowerCase())
    .join(" ");
  if (names.includes("שירותלקוחות") || names.includes("customerservice")) {
    return "customer-service";
  }
  if (names.includes("אספק") || names.includes("deliver")) {
    return "deliveries";
  }
  return null;
}

function toIso(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" || /^\d+$/.test(String(value))) {
    const numeric = Number(value);
    const milliseconds = numeric > 10_000_000_000 ? numeric : numeric * 1000;
    return new Date(milliseconds).toISOString();
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
