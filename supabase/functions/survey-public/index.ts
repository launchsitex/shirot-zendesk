import { getAdminClient } from "../_shared/zendesk.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// Public, unauthenticated endpoint behind the survey link sent by SMS.
// GET  ?token=... -> minimal info to render the form (never phone number).
// POST { token, scoreBranch, scoreCoordination, scoreMover, feedbackPositive,
//        feedbackNegative } -> records the response, once per token.
//
// verify_jwt = false (supabase/config.toml). Always goes through the service
// role here — survey_pending_sends/survey_responses have no anon RLS policy,
// so this function is the only way a customer's name/phone can be read.
//
// Called directly from the customer's browser (the /s/[token] page), so every
// response needs CORS headers and OPTIONS preflight must be answered.

const SCORE_MIN = 1;
const SCORE_MAX = 5;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const supabase = getAdminClient();

  try {
    if (request.method === "GET") return await handleGet(supabase, request);
    if (request.method === "POST") return await handlePost(supabase, request);
    return jsonResponse({ error: "method" }, 405);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logSystemEvent(supabase, {
      severity: "error",
      category: "survey-public",
      title: "כשל בטיפול בבקשת סקר",
      message: message.slice(0, 1000),
    });
    return jsonResponse({ error: "internal_error" }, 500);
  }
});

async function handleGet(supabase: SupabaseClient, request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (!token) return jsonResponse({ error: "missing_token" }, 400);

  const { data: pending, error } = await supabase
    .from("survey_pending_sends")
    .select("customer_name, order_number, responded_at")
    .eq("token", token)
    .maybeSingle();

  if (error) return jsonResponse({ error: "lookup_failed" }, 500);
  if (!pending) return jsonResponse({ valid: false }, 404);

  return jsonResponse({
    valid: true,
    customerName: pending.customer_name,
    orderNumber: pending.order_number,
    alreadyResponded: Boolean(pending.responded_at),
  });
}

async function handlePost(supabase: SupabaseClient, request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const token = String(body.token ?? "");
  if (!token) return jsonResponse({ error: "missing_token" }, 400);

  const scores = {
    score_branch: Number(body.scoreBranch),
    score_coordination: Number(body.scoreCoordination),
    score_mover: Number(body.scoreMover),
  };
  for (const [field, value] of Object.entries(scores)) {
    if (!Number.isInteger(value) || value < SCORE_MIN || value > SCORE_MAX) {
      return jsonResponse({ error: `invalid_${field}` }, 400);
    }
  }
  const feedbackPositive = body.feedbackPositive
    ? String(body.feedbackPositive).slice(0, 2000)
    : null;
  const feedbackNegative = body.feedbackNegative
    ? String(body.feedbackNegative).slice(0, 2000)
    : null;

  const { data: pending, error: pendingError } = await supabase
    .from("survey_pending_sends")
    .select("id, order_number, branch_id, coordinator_id, mover_id, agent_name, responded_at")
    .eq("token", token)
    .maybeSingle();

  if (pendingError) return jsonResponse({ error: "lookup_failed" }, 500);
  if (!pending) return jsonResponse({ error: "invalid_token" }, 404);
  if (pending.responded_at) return jsonResponse({ error: "already_responded" }, 409);

  const { error: insertError } = await supabase.from("survey_responses").insert({
    pending_send_id: pending.id,
    order_number: pending.order_number,
    branch_id: pending.branch_id,
    coordinator_id: pending.coordinator_id,
    mover_id: pending.mover_id,
    agent_name: pending.agent_name,
    ...scores,
    feedback_positive: feedbackPositive,
    feedback_negative: feedbackNegative,
  });

  if (insertError?.code === "23505") {
    return jsonResponse({ error: "already_responded" }, 409);
  }
  if (insertError) return jsonResponse({ error: insertError.message }, 500);

  await supabase
    .from("survey_pending_sends")
    .update({ responded_at: new Date().toISOString() })
    .eq("id", pending.id)
    .is("responded_at", null);

  return jsonResponse({ ok: true });
}

async function logSystemEvent(
  supabase: SupabaseClient,
  event: { severity: "info" | "warning" | "error"; category: string; title: string; message: string },
) {
  try {
    await supabase.from("system_event_logs").insert({
      severity: event.severity,
      category: event.category,
      title: event.title,
      message: event.message,
      details: {},
      occurred_at: new Date().toISOString(),
    });
  } catch {
    // Never fail the request because logging failed.
  }
}
