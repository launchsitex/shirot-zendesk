import { NextResponse } from "next/server";
import { getMockDashboardData } from "@/lib/mock-data";
import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/supabase/server";
import type { CallRecording } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  if (
    !isSupabaseConfigured() ||
    process.env.NEXT_PUBLIC_DEMO_MODE === "true"
  ) {
    const dashboard = getMockDashboardData();
    const recordings: CallRecording[] = dashboard.calls
      .filter((call) => call.status === "answered")
      .slice(0, 12)
      .map((call) => ({
        id: `demo-${call.id}`,
        callId: call.id,
        ticketId: `T-${call.id.replace("call-", "")}`,
        recordingType: "call",
        durationSeconds: call.talkTimeSeconds,
        createdAt: call.startedAt,
        agentName: call.agentName,
        departmentId: call.departmentId,
        departmentName: call.departmentName,
        customerNumber: call.customerNumber,
      }));
    return NextResponse.json({
      recordings,
      departments: dashboard.departments,
      source: "demo",
    });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [recordingsResult, departmentsResult] = await Promise.all([
    supabase
      .from("call_recordings")
      .select(
        "id,call_id,ticket_id,recording_type,duration_seconds,created_at,calls(customer_number,department_id,agents(name),departments(name))",
      )
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase
      .from("departments")
      .select("id,name")
      .eq("active", true)
      .order("name"),
  ]);
  const error = recordingsResult.error ?? departmentsResult.error;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const recordings: CallRecording[] = (recordingsResult.data ?? []).map(
    (row) => {
      const call = row.calls as unknown as {
        customer_number: string;
        department_id: string | null;
        agents: { name: string } | null;
        departments: { name: string } | null;
      };
      return {
        id: row.id,
        callId: row.call_id,
        ticketId: row.ticket_id,
        recordingType: row.recording_type,
        durationSeconds: row.duration_seconds,
        createdAt: row.created_at,
        agentName: call?.agents?.name ?? null,
        departmentId: call?.department_id ?? null,
        departmentName: call?.departments?.name ?? null,
        customerNumber: call?.customer_number ?? "",
      };
    },
  );

  return NextResponse.json({
    recordings,
    departments: departmentsResult.data ?? [],
    source: "supabase",
  });
}
