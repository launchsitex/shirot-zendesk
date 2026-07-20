import { NextRequest, NextResponse } from "next/server";
import { getDepartmentScope } from "@/lib/auth/department-scope";
import { getMockDashboardData } from "@/lib/mock-data";
import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/supabase/server";
import type { Agent, CallRecord, DashboardData } from "@/lib/types";

export const dynamic = "force-dynamic";

function jerusalemBoundary(date: string, endOfDay = false): string {
  const time = endOfDay ? "23:59:59.999" : "00:00:00.000";
  const wallClockUtc = Date.parse(`${date}T${time}Z`);
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
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(instant))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
    const representedAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    instant = wallClockUtc - (representedAsUtc - instant);
  }

  return new Date(instant).toISOString();
}

export async function GET(request: NextRequest) {
  if (
    !isSupabaseConfigured() ||
    process.env.NEXT_PUBLIC_DEMO_MODE === "true"
  ) {
    return NextResponse.json(getMockDashboardData());
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const departmentScope = await getDepartmentScope(supabase, user.id);

  const from =
    request.nextUrl.searchParams.get("from") ??
    new Date(Date.now() - 31 * 86_400_000).toISOString().slice(0, 10);
  const to =
    request.nextUrl.searchParams.get("to") ??
    new Date().toISOString().slice(0, 10);

  let callsQuery = supabase
    .from("calls")
    .select(
      "id,direction,status,agent_id,transferred_by_agent_id,customer_number,started_at,ended_at,duration_seconds,talk_time_seconds,wait_time_seconds,department_id,agents!agent_id(name),transferred_by_agent:agents!transferred_by_agent_id(name),departments(name)",
    )
    .gte("started_at", jerusalemBoundary(from))
    .lte("started_at", jerusalemBoundary(to, true))
    .order("started_at", { ascending: false })
    .limit(5000);

  let agentsQuery = supabase
    .from("agents")
    .select(
      "id,name,department_id,departments(name),agent_live_status(state,state_since,current_call_started_at)",
    )
    .eq("active", true)
    .order("name");

  let departmentsQuery = supabase
    .from("departments")
    .select("id,name")
    .eq("active", true)
    .order("name");

  if (departmentScope) {
    callsQuery = callsQuery.eq("department_id", departmentScope);
    agentsQuery = agentsQuery.eq("department_id", departmentScope);
    departmentsQuery = departmentsQuery.eq("id", departmentScope);
  }

  const [callsResult, agentsResult, departmentsResult] = await Promise.all([
    callsQuery,
    agentsQuery,
    departmentsQuery,
  ]);

  const error = callsResult.error ?? agentsResult.error ?? departmentsResult.error;
  if (error) {
    return NextResponse.json(
      { error: "dashboard_query_failed", details: error.message },
      { status: 500 },
    );
  }

  const calls: CallRecord[] = (callsResult.data ?? []).map((row) => {
    const agent = row.agents as unknown as { name: string } | null;
    const transferredBy = row.transferred_by_agent as unknown as {
      name: string;
    } | null;
    const department = row.departments as unknown as { name: string } | null;
    return {
      id: row.id,
      direction: row.direction,
      status: row.status,
      agentId: row.agent_id,
      agentName: agent?.name ?? null,
      transferredByAgentId: row.transferred_by_agent_id,
      transferredByAgentName: transferredBy?.name ?? null,
      departmentId: row.department_id,
      departmentName: department?.name ?? null,
      customerNumber: row.customer_number,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      durationSeconds: row.duration_seconds,
      talkTimeSeconds: row.talk_time_seconds,
      waitTimeSeconds: row.wait_time_seconds ?? 0,
    };
  });
  const agents: Agent[] = (agentsResult.data ?? []).map((row) => {
    const department = row.departments as unknown as { name: string } | null;
    const embeddedStatus = row.agent_live_status as unknown as
      | {
          state: Agent["state"];
          state_since: string;
          current_call_started_at: string | null;
        }
      | Array<{
          state: Agent["state"];
          state_since: string;
          current_call_started_at: string | null;
        }>
      | null;
    const status = Array.isArray(embeddedStatus)
      ? embeddedStatus[0]
      : embeddedStatus;
    return {
      id: row.id,
      name: row.name,
      departmentId: row.department_id ?? "",
      departmentName: department?.name ?? "ללא מחלקה",
      state: status?.state ?? "unavailable",
      stateSince: status?.state_since ?? new Date().toISOString(),
      currentCallStartedAt: status?.current_call_started_at ?? undefined,
    };
  });

  const payload: DashboardData = {
    calls,
    agents,
    departments: departmentsResult.data ?? [],
    generatedAt: new Date().toISOString(),
    source: "supabase",
    scopedDepartmentId: departmentScope,
  };
  return NextResponse.json(payload);
}
