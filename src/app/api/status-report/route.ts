import { NextRequest, NextResponse } from "next/server";
import { getDepartmentScope } from "@/lib/auth/department-scope";
import {
  formatAgentStateLabel,
  formatDurationSeconds,
  formatIsraelDateTime,
  jerusalemDayBounds,
} from "@/lib/israel-time";
import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type HistoryRow = {
  id: string;
  agent_id: string;
  state: string;
  started_at: string;
  ended_at: string | null;
  source_event: string | null;
  agents:
    | {
        id: string;
        name: string;
        department_id: string | null;
        departments:
          | { id: string; name: string }
          | { id: string; name: string }[]
          | null;
      }
    | Array<{
        id: string;
        name: string;
        department_id: string | null;
        departments:
          | { id: string; name: string }
          | { id: string; name: string }[]
          | null;
      }>
    | null;
};

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase אינו מחובר" }, { status: 400 });
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
    new Date().toISOString().slice(0, 10);
  const to =
    request.nextUrl.searchParams.get("to") ??
    new Date().toISOString().slice(0, 10);
  const rangeStart = jerusalemDayBounds(from);
  const rangeEnd = jerusalemDayBounds(to, true);
  const rangeEndMs = new Date(rangeEnd).getTime();
  const rangeStartMs = new Date(rangeStart).getTime();

  let historyQuery = supabase
    .from("agent_status_history")
    .select(
      "id,agent_id,state,started_at,ended_at,source_event,agents!agent_id(id,name,department_id,departments(id,name))",
    )
    .lte("started_at", rangeEnd)
    .or(`ended_at.is.null,ended_at.gte."${rangeStart}"`)
    .order("started_at", { ascending: true })
    .limit(20_000);

  if (departmentScope) {
    const { data: scopedAgents } = await supabase
      .from("agents")
      .select("id")
      .eq("department_id", departmentScope)
      .eq("active", true);
    const ids = (scopedAgents ?? []).map((agent) => agent.id);
    if (ids.length === 0) {
      return NextResponse.json({
        from,
        to,
        departments: [],
        generatedAt: new Date().toISOString(),
      });
    }
    historyQuery = historyQuery.in("agent_id", ids);
  }

  const { data, error } = await historyQuery;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  type AgentBucket = {
    agentId: string;
    agentName: string;
    departmentId: string;
    departmentName: string;
    totals: Map<string, number>;
    segments: Array<{
      id: string;
      state: string;
      stateLabel: string;
      nextStateLabel: string | null;
      startedAt: string;
      startedAtIsrael: string;
      endedAt: string | null;
      endedAtIsrael: string | null;
      durationSeconds: number;
      durationLabel: string;
      sourceEvent: string | null;
    }>;
  };

  const agents = new Map<string, AgentBucket>();

  for (const row of (data ?? []) as unknown as HistoryRow[]) {
    const agentMeta = Array.isArray(row.agents) ? row.agents[0] : row.agents;
    if (!agentMeta) continue;
    const departmentMeta = Array.isArray(agentMeta.departments)
      ? agentMeta.departments[0]
      : agentMeta.departments;
    const departmentId = agentMeta.department_id ?? "unassigned";
    const departmentName = departmentMeta?.name ?? "ללא מחלקה";
    const bucket =
      agents.get(row.agent_id) ??
      ({
        agentId: row.agent_id,
        agentName: agentMeta.name,
        departmentId,
        departmentName,
        totals: new Map<string, number>(),
        segments: [],
      } satisfies AgentBucket);

    const startedMs = Math.max(
      new Date(row.started_at).getTime(),
      rangeStartMs,
    );
    const endedMs = Math.min(
      row.ended_at ? new Date(row.ended_at).getTime() : Date.now(),
      rangeEndMs,
    );
    const durationSeconds = Math.max(0, Math.floor((endedMs - startedMs) / 1000));
    if (durationSeconds <= 0 && row.ended_at) continue;

    bucket.totals.set(
      row.state,
      (bucket.totals.get(row.state) ?? 0) + durationSeconds,
    );
    bucket.segments.push({
      id: row.id,
      state: row.state,
      stateLabel: formatAgentStateLabel(row.state, row.source_event),
      nextStateLabel: null,
      startedAt: row.started_at,
      startedAtIsrael: formatIsraelDateTime(row.started_at),
      endedAt: row.ended_at,
      endedAtIsrael: row.ended_at
        ? formatIsraelDateTime(row.ended_at)
        : "פעיל עכשיו",
      durationSeconds,
      durationLabel: formatDurationSeconds(durationSeconds),
      sourceEvent: row.source_event,
    });
    agents.set(row.agent_id, bucket);
  }

  const byDepartment = new Map<
    string,
    {
      id: string;
      name: string;
      agents: Array<{
        agentId: string;
        agentName: string;
        totals: Array<{
          state: string;
          stateLabel: string;
          durationSeconds: number;
          durationLabel: string;
        }>;
        segments: AgentBucket["segments"];
      }>;
    }
  >();

  for (const agent of agents.values()) {
    const department =
      byDepartment.get(agent.departmentId) ??
      {
        id: agent.departmentId,
        name: agent.departmentName,
        agents: [],
      };
    const segments = agent.segments
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
      .map((segment, index, all) => ({
        ...segment,
        // Same as Aircall "Next status": the status that followed this segment.
        nextStateLabel: all[index + 1]?.stateLabel ?? null,
      }));

    department.agents.push({
      agentId: agent.agentId,
      agentName: agent.agentName,
      totals: [...agent.totals.entries()]
        .map(([state, durationSeconds]) => ({
          state,
          stateLabel: formatAgentStateLabel(state),
          durationSeconds,
          durationLabel: formatDurationSeconds(durationSeconds),
        }))
        .sort((a, b) => b.durationSeconds - a.durationSeconds),
      segments,
    });
    byDepartment.set(agent.departmentId, department);
  }

  const departments = [...byDepartment.values()]
    .map((department) => ({
      ...department,
      agents: department.agents.sort((a, b) =>
        a.agentName.localeCompare(b.agentName, "he"),
      ),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "he"));

  return NextResponse.json({
    from,
    to,
    rangeStartIsrael: formatIsraelDateTime(rangeStart),
    rangeEndIsrael: formatIsraelDateTime(rangeEnd),
    departments,
    generatedAt: new Date().toISOString(),
    scopedDepartmentId: departmentScope,
  });
}
