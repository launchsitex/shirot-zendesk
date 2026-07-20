import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  authorizeSync,
  fetchAllPages,
  getAdminClient,
  getZendeskCredentials,
  jsonResponse,
  zendeskFetch,
  type ZendeskCredentials,
} from "../_shared/zendesk.ts";

type UnknownRecord = Record<string, unknown>;

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
      .insert({ stream: "history", status: "running" })
      .select("id")
      .single();
    runId = run?.id ?? null;
    const credentials = await getZendeskCredentials(supabase);

    const directoryCount = await syncDirectory(supabase, credentials);
    const callsCount = await syncIncrementalCalls(supabase, credentials);
    const legsCount = await syncIncrementalLegs(supabase, credentials);
    const processed = directoryCount + callsCount + legsCount;
    const now = new Date().toISOString();

    if (runId) {
      await supabase
        .from("sync_runs")
        .update({
          status: "success",
          records_processed: processed,
          finished_at: now,
        })
        .eq("id", runId);
    }
    return jsonResponse({
      ok: true,
      records: processed,
      calls: callsCount,
      legs: legsCount,
    });
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

async function syncDirectory(
  supabase: SupabaseClient,
  credentials: ZendeskCredentials,
) {
  const { data: state } = await supabase
    .from("sync_state")
    .select("updated_at")
    .eq("stream", "directory")
    .maybeSingle();
  if (
    state?.updated_at &&
    Date.now() - new Date(state.updated_at).getTime() < 15 * 60_000
  ) {
    return 0;
  }

  const [groups, users, memberships, phoneNumbers] = await Promise.all([
    fetchAllPages<UnknownRecord>(
      credentials,
      "/api/v2/groups.json?page[size]=100",
      "groups",
    ),
    fetchAllPages<UnknownRecord>(
      credentials,
      "/api/v2/users.json?page[size]=100",
      "users",
    ),
    fetchAllPages<UnknownRecord>(
      credentials,
      "/api/v2/group_memberships.json?page[size]=100",
      "group_memberships",
    ),
    fetchAllPages<UnknownRecord>(
      credentials,
      "/api/v2/channels/voice/phone_numbers.json?per_page=100",
      "phone_numbers",
    ).catch(() => []),
  ]);
  const now = new Date().toISOString();

  if (groups.length) {
    const { error } = await supabase.from("zendesk_groups").upsert(
      groups.map((group) => ({
        id: String(group.id),
        name: String(group.name ?? ""),
        active: group.deleted !== true,
        raw: group,
        synced_at: now,
      })),
      { onConflict: "id" },
    );
    if (error) throw error;
  }

  const agents = users.filter(
    (user) =>
      user.role === "agent" ||
      user.role === "admin" ||
      user.role_type === "agent" ||
      user.role_type === "admin",
  );
  const agentIds = new Set(agents.map((agent) => String(agent.id)));
  const customers = users.filter(
    (user) => !agentIds.has(String(user.id)),
  );
  if (agents.length) {
    const { error } = await supabase.from("agents").upsert(
      agents.map((user) => ({
        id: String(user.id),
        name: String(user.name ?? user.email ?? user.id),
        email: user.email ? String(user.email) : null,
        avatar_url:
          (user.photo as { content_url?: string } | undefined)?.content_url ??
          null,
        active: user.active !== false,
        raw: user,
        synced_at: now,
      })),
      { onConflict: "id" },
    );
    if (error) throw error;
  }

  if (customers.length) {
    const { error } = await supabase.from("zendesk_customers").upsert(
      customers.map((user) => ({
        id: String(user.id),
        name: user.name ? String(user.name) : null,
        phone: user.phone ? String(user.phone) : null,
        raw: user,
        synced_at: now,
      })),
      { onConflict: "id" },
    );
    if (error) throw error;
  }

  const validMemberships = memberships.filter((membership) =>
    agentIds.has(String(membership.user_id)),
  );
  if (validMemberships.length) {
    const { error } = await supabase.from("agent_group_memberships").upsert(
      validMemberships.map((membership) => ({
        agent_id: String(membership.user_id),
        group_id: String(membership.group_id),
      })),
      { onConflict: "agent_id,group_id" },
    );
    if (error) throw error;
  }

  if (phoneNumbers.length) {
    const { error } = await supabase.from("talk_lines").upsert(
      phoneNumbers.map((line) => ({
        id: String(line.id),
        name: String(line.nickname ?? line.name ?? line.number ?? line.id),
        number: line.number ? String(line.number) : null,
        active: line.enabled !== false,
        raw: line,
        synced_at: now,
      })),
      { onConflict: "id" },
    );
    if (error) throw error;
  }

  await autoMapDepartments(supabase, groups, memberships, agentIds);
  await supabase.from("sync_state").upsert(
    { stream: "directory", updated_at: now },
    { onConflict: "stream" },
  );
  return (
    groups.length +
    agents.length +
    customers.length +
    validMemberships.length +
    phoneNumbers.length
  );
}

async function autoMapDepartments(
  supabase: SupabaseClient,
  groups: UnknownRecord[],
  memberships: UnknownRecord[],
  agentIds: Set<string>,
) {
  const mappings: Array<{ department_id: string; group_id: string }> = [];
  for (const group of groups) {
    const name = String(group.name ?? "")
      .replace(/\s/g, "")
      .toLowerCase()
      .replaceAll("שרות", "שירות");
    if (
      name.includes("שירותלקוחות") ||
      name.includes("שירות") ||
      name.includes("customerservice")
    ) {
      mappings.push({ department_id: "customer-service", group_id: String(group.id) });
    }
    if (name.includes("אספק") || name.includes("deliver")) {
      mappings.push({ department_id: "deliveries", group_id: String(group.id) });
    }
  }
  if (mappings.length) {
    await supabase.from("department_groups").upsert(mappings, {
      onConflict: "group_id",
    });
  }

  const departmentByGroup = new Map(
    mappings.map((mapping) => [mapping.group_id, mapping.department_id]),
  );
  const updates = memberships
    .filter((membership) => agentIds.has(String(membership.user_id)))
    .map((membership) => ({
      agentId: String(membership.user_id),
      departmentId: departmentByGroup.get(String(membership.group_id)),
    }))
    .filter((item) => item.departmentId);
  for (const update of updates) {
    await supabase
      .from("agents")
      .update({ department_id: update.departmentId })
      .eq("id", update.agentId)
      .is("department_id", null);
  }
}

async function getIncrementalUrl(
  supabase: SupabaseClient,
  stream: string,
  endpoint: string,
) {
  const { data } = await supabase
    .from("sync_state")
    .select("cursor,start_time")
    .eq("stream", stream)
    .maybeSingle();
  if (data?.cursor) return data.cursor as string;
  const startTime =
    data?.start_time ?? Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
  return `${endpoint}?start_time=${startTime}`;
}

async function syncIncrementalCalls(
  supabase: SupabaseClient,
  credentials: ZendeskCredentials,
) {
  let url = await getIncrementalUrl(
    supabase,
    "talk_calls",
    "/api/v2/channels/voice/stats/incremental/calls.json",
  );
  let processed = 0;

  for (let page = 0; page < 4; page += 1) {
    const payload = await zendeskFetch<{
      calls?: UnknownRecord[];
      count?: number;
      end_time?: number;
      next_page?: string;
    }>(credentials, url);
    const calls = payload.calls ?? [];
    if (calls.length) {
      const groupIds = [
        ...new Set(calls.map((call) => String(call.call_group_id ?? ""))),
      ].filter(Boolean);
      const lineIds = [
        ...new Set(calls.map((call) => String(call.phone_number_id ?? ""))),
      ].filter(Boolean);
      const customerIds = [
        ...new Set(calls.map((call) => String(call.customer_id ?? ""))),
      ].filter(Boolean);

      if (lineIds.length) {
        await supabase.from("talk_lines").upsert(
          lineIds.map((id) => ({
            id,
            name:
              String(
                calls.find((call) => String(call.phone_number_id) === id)
                  ?.phone_number ?? id,
              ),
            number:
              String(
                calls.find((call) => String(call.phone_number_id) === id)
                  ?.phone_number ?? "",
              ) || null,
          })),
          { onConflict: "id" },
        );
      }

      const { data: mappings } = groupIds.length
        ? await supabase
            .from("department_groups")
            .select("department_id,group_id")
            .in("group_id", groupIds)
        : { data: [] };
      const { data: lineMappings } = lineIds.length
        ? await supabase
            .from("department_lines")
            .select("department_id,line_id")
            .in("line_id", lineIds)
        : { data: [] };
      const { data: customers } = customerIds.length
        ? await supabase
            .from("zendesk_customers")
            .select("id,phone")
            .in("id", customerIds)
        : { data: [] };
      const departmentByGroup = new Map(
        (mappings ?? []).map((mapping) => [
          mapping.group_id,
          mapping.department_id,
        ]),
      );
      const departmentByLine = new Map(
        (lineMappings ?? []).map((mapping) => [
          mapping.line_id,
          mapping.department_id,
        ]),
      );
      const phoneByCustomer = new Map(
        (customers ?? []).map((customer) => [customer.id, customer.phone]),
      );
      const rows = calls.map((call) => {
        const createdAt = String(call.created_at ?? new Date().toISOString());
        const duration = Number(call.duration ?? 0);
        const completion = String(call.completion_status ?? "");
        const direction = call.direction === "outbound" ? "outbound" : "inbound";
        return {
          id: String(call.id),
          direction,
          status: completion === "completed" ? "answered" : "missed",
          completion_status: completion,
          agent_id: Number(call.agent_id ?? 0) > 0 ? String(call.agent_id) : null,
          customer_id:
            Number(call.customer_id ?? 0) > 0 ? String(call.customer_id) : null,
          department_id:
            departmentByGroup.get(String(call.call_group_id ?? "")) ??
            departmentByLine.get(String(call.phone_number_id ?? "")) ??
            null,
          line_id: call.phone_number_id ? String(call.phone_number_id) : null,
          customer_number:
            phoneByCustomer.get(String(call.customer_id ?? "")) ??
            String(call.customer_number ?? ""),
          started_at: createdAt,
          ended_at: new Date(
            new Date(createdAt).getTime() + duration * 1000,
          ).toISOString(),
          duration_seconds: duration,
          talk_time_seconds: Number(call.talk_time ?? 0),
          wait_time_seconds: Number(call.wait_time ?? 0),
          source_updated_at: call.updated_at ?? createdAt,
          raw: call,
          synced_at: new Date().toISOString(),
        };
      });
      const { error } = await supabase.from("calls").upsert(rows, {
        onConflict: "id",
      });
      if (error) throw error;
      processed += rows.length;
    }

    const nextPage = payload.next_page ?? null;
    const shouldContinue =
      (payload.count ?? calls.length) >= 1000 &&
      Boolean(nextPage) &&
      nextPage !== url;
    const { error: stateError } = await supabase.from("sync_state").upsert(
      {
        stream: "talk_calls",
        cursor: nextPage,
        start_time: payload.end_time,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "stream" },
    );
    if (stateError) throw stateError;
    if (!shouldContinue) break;
    url = nextPage!;
  }
  return processed;
}

async function syncIncrementalLegs(
  supabase: SupabaseClient,
  credentials: ZendeskCredentials,
) {
  let url = await getIncrementalUrl(
    supabase,
    "talk_legs",
    "/api/v2/channels/voice/stats/incremental/legs.json",
  );
  let processed = 0;
  for (let page = 0; page < 4; page += 1) {
    const payload = await zendeskFetch<{
      legs?: UnknownRecord[];
      count?: number;
      end_time?: number;
      next_page?: string;
    }>(credentials, url);
    const legs = payload.legs ?? [];
    const knownCallIds = [
      ...new Set(legs.map((leg) => String(leg.call_id ?? ""))),
    ].filter(Boolean);
    const { data: knownCalls } = knownCallIds.length
      ? await supabase.from("calls").select("id").in("id", knownCallIds)
      : { data: [] };
    const callIds = new Set((knownCalls ?? []).map((call) => call.id));
    const validLegs = legs.filter((leg) => callIds.has(String(leg.call_id)));
    if (validLegs.length !== legs.length) {
      throw new Error(
        `Waiting for ${legs.length - validLegs.length} calls referenced by Talk legs`,
      );
    }
    if (validLegs.length) {
      const { error } = await supabase.from("call_legs").upsert(
        validLegs.map((leg) => ({
          id: String(leg.id),
          call_id: String(leg.call_id),
          agent_id: Number(leg.agent_id ?? 0) > 0 ? String(leg.agent_id) : null,
          leg_type: leg.type ? String(leg.type) : null,
          completion_status: leg.completion_status
            ? String(leg.completion_status)
            : null,
          started_at: leg.created_at ?? null,
          ended_at: leg.updated_at ?? null,
          duration_seconds: Number(leg.duration ?? 0),
          talk_time_seconds: Number(leg.talk_time ?? 0),
          wrap_up_seconds: Number(leg.wrap_up_time ?? 0),
          raw: leg,
          synced_at: new Date().toISOString(),
        })),
        { onConflict: "id" },
      );
      if (error) throw error;
      processed += validLegs.length;
    }
    const nextPage = payload.next_page ?? null;
    const shouldContinue =
      (payload.count ?? legs.length) >= 1000 &&
      Boolean(nextPage) &&
      nextPage !== url;
    const { error: stateError } = await supabase.from("sync_state").upsert(
      {
        stream: "talk_legs",
        cursor: nextPage,
        start_time: payload.end_time,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "stream" },
    );
    if (stateError) throw stateError;
    if (!shouldContinue) break;
    url = nextPage!;
  }
  return processed;
}
