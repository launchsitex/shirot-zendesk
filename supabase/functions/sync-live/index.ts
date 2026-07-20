import {
  authorizeSync,
  getAdminClient,
  getZendeskCredentials,
  jsonResponse,
  mapAgentState,
  zendeskFetch,
} from "../_shared/zendesk.ts";

interface AgentActivity {
  agent_id: number;
  name: string;
  avatar_url?: string;
  agent_state?: string;
  call_status?: string | null;
}

interface QueueActivity {
  agents_online?: number;
  calls_waiting?: number;
  callbacks_waiting?: number;
  average_wait_time?: number;
  longest_wait_time?: number;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return jsonResponse({ error: "method" }, 405);
  const supabase = getAdminClient();
  if (!(await authorizeSync(request, supabase))) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }
  const { data: integration } = await supabase
    .from("integration_settings")
    .select("id")
    .eq("provider", "zendesk_talk")
    .eq("enabled", true)
    .maybeSingle();
  if (!integration) {
    return jsonResponse({ ok: true, skipped: "Zendesk is not configured" });
  }
  let runId: number | null = null;
  try {
    const { data: run } = await supabase
      .from("sync_runs")
      .insert({ stream: "live", status: "running" })
      .select("id")
      .single();
    runId = run?.id ?? null;

    const credentials = await getZendeskCredentials(supabase);
    const [agentsPayload, queuePayload, previousStatuses] = await Promise.all([
      zendeskFetch<{ agents_activity: AgentActivity[] }>(
        credentials,
        "/api/v2/channels/voice/stats/agents_activity.json",
      ),
      zendeskFetch<{ current_queue_activity: QueueActivity }>(
        credentials,
        "/api/v2/channels/voice/stats/current_queue_activity.json",
      ),
      supabase
        .from("agent_live_status")
        .select("agent_id,state,state_since,current_call_started_at"),
    ]);

    const now = new Date().toISOString();
    const agents = agentsPayload.agents_activity ?? [];
    if (agents.length) {
      const { error: agentsError } = await supabase.from("agents").upsert(
        agents.map((agent) => ({
          id: String(agent.agent_id),
          name: agent.name,
          avatar_url: agent.avatar_url ?? null,
          active: true,
          synced_at: now,
        })),
        { onConflict: "id" },
      );
      if (agentsError) throw agentsError;

      const previous = new Map(
        (previousStatuses.data ?? []).map((row) => [row.agent_id, row]),
      );
      const { error: statusError } = await supabase
        .from("agent_live_status")
        .upsert(
          agents.map((agent) => {
            const state = mapAgentState(agent.agent_state, agent.call_status);
            const old = previous.get(String(agent.agent_id));
            const unchanged = old?.state === state;
            return {
              agent_id: String(agent.agent_id),
              state,
              zendesk_agent_state: agent.agent_state ?? null,
              zendesk_call_status: agent.call_status ?? null,
              state_since: unchanged ? old.state_since : now,
              current_call_started_at:
                state === "on_call"
                  ? unchanged && old.current_call_started_at
                    ? old.current_call_started_at
                    : now
                  : null,
              raw: agent,
              updated_at: now,
            };
          }),
          { onConflict: "agent_id" },
        );
      if (statusError) throw statusError;
    }
    const presentAgentIds = new Set(
      agents.map((agent) => String(agent.agent_id)),
    );
    const absentAgents = (previousStatuses.data ?? []).filter(
      (status) =>
        !presentAgentIds.has(status.agent_id) && status.state !== "unavailable",
    );
    if (absentAgents.length) {
      const { error: absentError } = await supabase
        .from("agent_live_status")
        .upsert(
          absentAgents.map((status) => ({
            agent_id: status.agent_id,
            state: "unavailable",
            state_since: now,
            current_call_started_at: null,
            zendesk_agent_state: null,
            zendesk_call_status: null,
            updated_at: now,
          })),
          { onConflict: "agent_id" },
        );
      if (absentError) throw absentError;
    }

    const queue = queuePayload.current_queue_activity ?? {};
    const { error: queueError } = await supabase.from("queue_snapshots").insert({
      calls_waiting: queue.calls_waiting ?? 0,
      callbacks_waiting: queue.callbacks_waiting ?? 0,
      agents_online: queue.agents_online ?? 0,
      average_wait_seconds: queue.average_wait_time ?? 0,
      longest_wait_seconds: queue.longest_wait_time ?? 0,
      captured_at: now,
      raw: queue,
    });
    if (queueError) throw queueError;

    if (runId) {
      await supabase
        .from("sync_runs")
        .update({
          status: "success",
          records_processed: agents.length + 1,
          finished_at: now,
        })
        .eq("id", runId);
    }
    return jsonResponse({ ok: true, agents: agents.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (runId) {
      await supabase
        .from("sync_runs")
        .update({
          status: "failed",
          error_message: message.slice(0, 1000),
          finished_at: new Date().toISOString(),
        })
        .eq("id", runId);
    }
    return jsonResponse({ error: message }, 500);
  }
});
