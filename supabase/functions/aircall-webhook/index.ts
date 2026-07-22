import {
  getAdminClient,
  jsonResponse,
} from "../_shared/zendesk.ts";
import { mapAvailability } from "../_shared/aircall-status.ts";
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
      await processCallEvent(
        supabase,
        eventType,
        payload.data,
        toIso(payload.timestamp),
      );
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
    await logSystemEvent(supabase, {
      severity: "error",
      category: "aircall-webhook",
      title: "כשל בעיבוד אירוע Aircall",
      message: `האירוע ${eventType} נכשל בעיבוד.`,
      details: {
        eventType,
        eventId: eventRow.id,
        error: message.slice(0, 1000),
      },
    });
    return jsonResponse({ error: message }, 500);
  }
});

async function processCallEvent(
  supabase: SupabaseClient,
  eventType: string,
  call: UnknownRecord,
  webhookTimestamp: string | null,
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
  const isHoldEvent = eventType === "call.hold" || eventType === "call.unhold";
  // External transfer leaves the Aircall agent free; keep the call closed for them
  // even if Aircall never sends an immediate hungup for that leg.
  const agentLeftViaExternalTransfer =
    eventType === "call.external_transferred";
  const isFinished =
    eventType === "call.hungup" ||
    eventType === "call.ended" ||
    agentLeftViaExternalTransfer ||
    String(call.status ?? "") === "done";
  const status = isFinished
    ? answeredAt
      ? "answered"
      : "missed"
    : "in_progress";
  const eventTime =
    endedAt ??
    (isFinished ? new Date().toISOString() : null) ??
    // Hold/unhold arrive mid-call; their own timestamp must advance
    // source_updated_at, otherwise the ordering guard drops them.
    (isHoldEvent ? webhookTimestamp ?? new Date().toISOString() : null) ??
    answeredAt ??
    startedAt;

  const { data: existing } = await supabase
    .from("calls")
    .select("status,source_updated_at,agent_id,transferred_by_agent_id,raw")
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

  const transferredBy = isRecord(call.transferred_by) ? call.transferred_by : null;
  if (transferredBy) await upsertAgent(supabase, transferredBy);
  const transferredTo = isRecord(call.transferred_to) ? call.transferred_to : null;
  if (transferredTo) await upsertAgent(supabase, transferredTo);

  const transferEvent =
    eventType === "call.transferred" ||
    eventType === "call.external_transferred";
  const transferredByAgentId =
    (transferredBy?.id ? String(transferredBy.id) : null) ??
    (transferEvent && eventUser?.id ? String(eventUser.id) : null) ??
    existing?.transferred_by_agent_id ??
    null;

  // Prefer the agent on the current event. Never wipe a known agent_id when a
  // later event omits user (common on inbound ringing / decline / hangup).
  // On internal transfer, ownership moves to the destination agent.
  const eventAgentId = eventUser?.id ? String(eventUser.id) : null;
  let answeredAgentId = eventAgentId ?? existing?.agent_id ?? null;
  if (eventType === "call.transferred" && transferredTo?.id) {
    answeredAgentId = String(transferredTo.id);
  }

  const existingRaw = isRecord(existing?.raw) ? existing.raw : {};

  // Accumulate hold/unhold moments so AI analysis can ignore audio heard
  // while the customer was on hold (music, call-center background noise).
  const previousHoldEvents = Array.isArray(existingRaw.hold_events)
    ? existingRaw.hold_events
    : [];
  const holdEvents = isHoldEvent
    ? [
        ...previousHoldEvents,
        { event: eventType, at: webhookTimestamp ?? new Date().toISOString() },
      ]
    : previousHoldEvents;

  // Accumulate timestamped transfers so AI analysis can attribute each part
  // of the recording to the right agent (and judge only the analyzed agent).
  const previousTransferEvents = Array.isArray(existingRaw.transfer_events)
    ? existingRaw.transfer_events
    : [];
  const transferEvents = transferEvent
    ? [
        ...previousTransferEvents,
        {
          event: eventType,
          at: webhookTimestamp ?? new Date().toISOString(),
          from_agent_id:
            (transferredBy?.id ? String(transferredBy.id) : null) ??
            eventAgentId,
          from_agent_name:
            agentDisplayName(transferredBy) ?? agentDisplayName(eventUser),
          to_agent_id: transferredTo?.id ? String(transferredTo.id) : null,
          to_agent_name: agentDisplayName(transferredTo),
        },
      ]
    : previousTransferEvents;

  const mergedRaw = {
    ...existingRaw,
    ...call,
    provider: "aircall",
    last_event: eventType,
    hold_events: holdEvents,
    transfer_events: transferEvents,
    transferred_by:
      transferredBy ??
      (isRecord(existingRaw.transferred_by) ? existingRaw.transferred_by : null),
    transferred_to:
      transferredTo ??
      (isRecord(existingRaw.transferred_to) ? existingRaw.transferred_to : null),
  };

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
    : status === "missed"
      ? Math.max(0, duration)
      : 0;

  const { error: callError } = await supabase.from("calls").upsert(
    {
      id: callId,
      direction: call.direction === "outbound" ? "outbound" : "inbound",
      status,
      completion_status: String(call.status ?? eventType),
      agent_id: answeredAgentId,
      transferred_by_agent_id: transferredByAgentId,
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
      raw: mergedRaw,
      source_updated_at: eventTime,
      synced_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (callError) throw callError;

  if (eventUser?.id) {
    const wrapUpSeconds = Number(eventUser.wrap_up_time ?? 0);
    const state =
      eventType === "call.ringing_on_agent"
        ? "ringing"
        : eventType === "call.answered"
          ? "on_call"
          : eventType === "call.agent_declined"
            ? mapAvailability(eventUser)
            : eventType === "call.hungup"
              ? wrapUpSeconds > 0
                ? "wrap_up"
                : mapAvailability(eventUser)
              : transferEvent
                ? mapAvailability(eventUser)
                : null;
    if (state) {
      if (state !== "on_call" && state !== "ringing") {
        // Clean only stale leftovers; never touch the agent's other live calls.
        await closeOpenCallsForAgent(supabase, String(eventUser.id), eventType, {
          excludeCallId: callId,
        });
      }
      await updateAgentState(
        supabase,
        String(eventUser.id),
        state,
        state === "on_call" ? answeredAt ?? new Date().toISOString() : null,
        state === "wrap_up" ? "after_call_work" : eventType,
      );
    }
  }

  // Internal transfer: the destination agent hasn't answered yet (Aircall
  // rings their phone next). Without this, forceOnCall in the dashboard API
  // shows them "on_call" immediately from the inherited talk_time of the
  // pre-transfer leg — before they've picked up, or even if they decline.
  if (eventType === "call.transferred" && transferredTo?.id) {
    await updateAgentState(supabase, String(transferredTo.id), "ringing", null, eventType);
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
  let state: string;
  let sourceState: string;

  if (normalized === "user.wut_start") {
    // After Call Work / Wrap-up — automatic post-call status in Aircall.
    state = "wrap_up";
    sourceState = "after_call_work";
  } else if (normalized === "user.wut_end") {
    // Wrap-up ended — move to the real next availability (Next status).
    state = mapAvailability(user);
    sourceState = String(
      user.substatus ?? user.availability_status ?? eventType,
    );
  } else if (
    normalized === "user.deleted" ||
    (normalized === "user.disconnected" &&
      !String(user.substatus ?? "").trim())
  ) {
    state = "unavailable";
    sourceState = String(user.substatus ?? user.availability_status ?? eventType);
  } else {
    state = mapAvailability(user);
    sourceState = String(
      user.substatus ?? user.availability_status ?? eventType,
    );
  }

  const agentId = String(user.id);

  // Explicit Aircall presence (Back office, break, etc.) is source of truth —
  // close phantom in_progress rows that never received hungup.
  if (isAwayPresence(state) || state === "wrap_up") {
    await closeOpenCallsForAgent(supabase, agentId, sourceState);
    await updateAgentState(supabase, agentId, state, null, sourceState);
    return;
  }

  // Availability "available" must not overwrite a real active call.
  if (
    state !== "on_call" &&
    state !== "ringing" &&
    state !== "wrap_up" &&
    (await agentHasOpenCall(supabase, agentId))
  ) {
    return;
  }

  await updateAgentState(supabase, agentId, state, null, sourceState);
}

function isAwayPresence(state: string) {
  // "unavailable" is intentionally NOT here: Aircall reports agents who are
  // currently on a call as unavailable, so it must never close live calls.
  return [
    "back_office",
    "on_break",
    "out_for_lunch",
    "in_training",
    "other",
  ].includes(state);
}

const TALK_EVENTS = ["call.answered", "call.hold", "call.unhold"];
const STALE_TALK_MS = 30 * 60_000;
const STALE_RING_MS = 60_000;

async function closeOpenCallsForAgent(
  supabase: SupabaseClient,
  agentId: string,
  reason: string,
  options: { excludeCallId?: string } = {},
) {
  const nowMs = Date.now();
  const now = new Date(nowMs).toISOString();
  const { data: openCalls, error } = await supabase
    .from("calls")
    .select("id,talk_time_seconds,source_updated_at,raw")
    .eq("agent_id", agentId)
    .eq("status", "in_progress");
  if (error || !openCalls?.length) return;

  for (const openCall of openCalls) {
    if (options.excludeCallId && openCall.id === options.excludeCallId) {
      continue;
    }
    const raw = isRecord(openCall.raw) ? openCall.raw : {};
    const lastEvent = String(raw.last_event ?? "");
    const updatedAtMs = new Date(
      openCall.source_updated_at ?? 0,
    ).getTime();
    const staleMs = nowMs - updatedAtMs;

    // A call in active talk is only phantom after a long-missed hangup.
    // Ringing/created/transferred legs get a short grace for racing events.
    if (TALK_EVENTS.includes(lastEvent)) {
      if (staleMs < STALE_TALK_MS) continue;
    } else if (staleMs < STALE_RING_MS) {
      continue;
    }

    const wasAnswered =
      Number(openCall.talk_time_seconds ?? 0) > 0 ||
      Boolean(toIso(raw.answered_at));
    const { error: updateError } = await supabase
      .from("calls")
      .update({
        status: wasAnswered ? "answered" : "missed",
        ended_at: openCall.source_updated_at ?? now,
        completion_status: reason,
        raw: {
          ...raw,
          closed_reason: reason,
          closed_at: now,
        },
        source_updated_at: now,
        synced_at: now,
      })
      .eq("id", openCall.id)
      .eq("status", "in_progress");
    if (updateError) throw updateError;
  }
}

async function agentHasOpenCall(supabase: SupabaseClient, agentId: string) {
  const { count, error } = await supabase
    .from("calls")
    .select("id", { count: "exact", head: true })
    .eq("agent_id", agentId)
    .eq("status", "in_progress");
  if (error) return false;
  return (count ?? 0) > 0;
}

function agentDisplayName(user: UnknownRecord | null): string | null {
  if (!user) return null;
  const joined = [user.first_name, user.last_name].filter(Boolean).join(" ");
  const name = String(user.name ?? joined ?? "").trim();
  return name || null;
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

  const stateChanged = !previous || previous.state !== state;

  const { error } = await supabase.from("agent_live_status").upsert(
    {
      agent_id: agentId,
      state,
      state_since: stateChanged ? now : previous.state_since,
      current_call_started_at: currentCallStartedAt,
      zendesk_agent_state: sourceState,
      zendesk_call_status: sourceState,
      raw: { provider: "aircall", event: sourceState },
      updated_at: now,
    },
    { onConflict: "agent_id" },
  );
  if (error) throw error;

  if (stateChanged) {
    await recordStatusTransition(supabase, agentId, state, now, sourceState);
  }
}

async function recordStatusTransition(
  supabase: SupabaseClient,
  agentId: string,
  state: string,
  startedAt: string,
  sourceEvent: string,
) {
  const { error: closeError } = await supabase
    .from("agent_status_history")
    .update({ ended_at: startedAt })
    .eq("agent_id", agentId)
    .is("ended_at", null);
  if (closeError) {
    await logSystemEvent(supabase, {
      severity: "warning",
      category: "agent-status",
      title: "כשל בסגירת מקטע סטטוס קודם",
      message: `לא ניתן היה לסגור את מקטע הסטטוס הפתוח של נציג ${agentId}.`,
      details: { agentId, error: closeError.message, sourceEvent },
    });
  }

  const { error: insertError } = await supabase
    .from("agent_status_history")
    .insert({
      agent_id: agentId,
      state,
      started_at: startedAt,
      ended_at: null,
      source_event: sourceEvent,
    });
  if (insertError) {
    await logSystemEvent(supabase, {
      severity: "error",
      category: "agent-status",
      title: "כשל בפתיחת מקטע סטטוס חדש",
      message: `לא ניתן היה לשמור מעבר סטטוס עבור נציג ${agentId}.`,
      details: { agentId, state, error: insertError.message, sourceEvent },
    });
  }
}

async function logSystemEvent(
  supabase: SupabaseClient,
  event: {
    severity: "info" | "warning" | "error";
    category: string;
    title: string;
    message: string;
    details?: UnknownRecord;
  },
) {
  try {
    await supabase.from("system_event_logs").insert({
      severity: event.severity,
      category: event.category,
      title: event.title,
      message: event.message,
      details: event.details ?? {},
      occurred_at: new Date().toISOString(),
    });
  } catch {
    // Never fail the webhook because logging failed.
  }
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

function inferDepartment(teams: UnknownRecord[]) {
  const names = teams
    .map((team) =>
      String(team.name ?? "")
        .replace(/\s/g, "")
        .toLowerCase()
        .replaceAll("שרות", "שירות"),
    )
    .join(" ");
  if (
    names.includes("שירותלקוחות") ||
    names.includes("שירות") ||
    names.includes("customerservice")
  ) {
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
