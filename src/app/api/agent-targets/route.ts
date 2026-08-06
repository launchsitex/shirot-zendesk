import { NextRequest, NextResponse } from "next/server";
import {
  REPORT_CUTOFF_TIME,
  reportWindow,
  type AgentTargetReport,
  type AgentTargetRow,
  type TargetWindow,
} from "@/lib/agent-targets";
import { jerusalemToday } from "@/lib/israel-time";
import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, must-revalidate" };

type ReportRow = {
  department_id: string | null;
  department_name: string | null;
  agent_id: string;
  agent_name: string;
  daily_inbound_target: number | null;
  inbound_answered: number;
  inbound_talk_seconds: number;
  outbound_talk_seconds: number;
};

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "supabase_not_configured" },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const date = request.nextUrl.searchParams.get("date") ?? jerusalemToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "invalid_date" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const window: TargetWindow =
    request.nextUrl.searchParams.get("window") === "full-day"
      ? "full-day"
      : "until-cutoff";
  const { from, to } = reportWindow(date, window);

  // The function is SECURITY INVOKER, so a department-scoped viewer gets only
  // their own department's rows without any filtering here.
  const { data, error } = await supabase.rpc("agent_target_report", {
    p_from: from,
    p_to: to,
  });

  if (error) {
    return NextResponse.json(
      { error: "agent_target_report_failed", details: error.message },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  const rows: AgentTargetRow[] = ((data ?? []) as ReportRow[]).map((row) => ({
    departmentId: row.department_id,
    departmentName: row.department_name,
    agentId: row.agent_id,
    agentName: row.agent_name,
    target: row.daily_inbound_target,
    actual: Number(row.inbound_answered ?? 0),
    inboundTalkSeconds: Number(row.inbound_talk_seconds ?? 0),
    outboundTalkSeconds: Number(row.outbound_talk_seconds ?? 0),
  }));

  const payload: AgentTargetReport = {
    date,
    window,
    cutoff: REPORT_CUTOFF_TIME,
    rows,
  };
  return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
}
