import { NextRequest, NextResponse } from "next/server";
import { getDepartmentScope } from "@/lib/auth/department-scope";
import { getMockDashboardData } from "@/lib/mock-data";
import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/supabase/server";
import type { CallRecording } from "@/lib/types";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

type ListPageResult = {
  recordings: CallRecording[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  totalDurationSeconds: number;
  voicemailCount: number;
};

export async function GET(request: NextRequest) {
  const pageParam = Number(request.nextUrl.searchParams.get("page") ?? "1");
  const page = Number.isFinite(pageParam) ? Math.max(1, Math.floor(pageParam)) : 1;
  const search = request.nextUrl.searchParams.get("search")?.trim() ?? "";
  const department =
    request.nextUrl.searchParams.get("department")?.trim() || null;
  const type = request.nextUrl.searchParams.get("type")?.trim() || null;

  if (
    !isSupabaseConfigured() ||
    process.env.NEXT_PUBLIC_DEMO_MODE === "true"
  ) {
    const dashboard = getMockDashboardData();
    let recordings: CallRecording[] = dashboard.calls
      .filter((call) => call.status === "answered")
      .map((call) => ({
        id: `demo-${call.id}`,
        callId: call.id,
        ticketId: `T-${call.id.replace("call-", "")}`,
        recordingType: "call" as const,
        durationSeconds: call.talkTimeSeconds,
        createdAt: call.startedAt,
        agentName: call.agentName,
        departmentId: call.departmentId,
        departmentName: call.departmentName,
        customerNumber: call.customerNumber,
      }));

    if (department) {
      recordings = recordings.filter((item) => item.departmentId === department);
    }
    if (type) {
      recordings = recordings.filter((item) => item.recordingType === type);
    }
    if (search) {
      const needle = search.toLowerCase();
      const digits = search.replace(/\D/g, "");
      recordings = recordings.filter(
        (item) =>
          item.agentName?.toLowerCase().includes(needle) ||
          item.ticketId.toLowerCase().includes(needle) ||
          (digits && item.customerNumber.replace(/\D/g, "").includes(digits)),
      );
    }

    const totalCount = recordings.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
    const safePage = Math.min(page, totalPages);
    const start = (safePage - 1) * PAGE_SIZE;
    const pageRows = recordings.slice(start, start + PAGE_SIZE);

    return NextResponse.json({
      recordings: pageRows,
      departments: dashboard.departments,
      source: "demo",
      scopedDepartmentId: null,
      page: safePage,
      pageSize: PAGE_SIZE,
      totalCount,
      totalPages,
      totalDurationSeconds: recordings.reduce(
        (sum, item) => sum + item.durationSeconds,
        0,
      ),
      voicemailCount: recordings.filter(
        (item) => item.recordingType === "voicemail",
      ).length,
    });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const departmentScope = await getDepartmentScope(supabase, user.id);
  const effectiveDepartment = departmentScope ?? department;

  const [pageResult, departmentsResult] = await Promise.all([
    supabase.rpc("list_call_recordings_page", {
      p_page: page,
      p_page_size: PAGE_SIZE,
      p_department_id: effectiveDepartment,
      p_recording_type: type,
      p_search: search || null,
    }),
    (() => {
      let query = supabase
        .from("departments")
        .select("id,name")
        .eq("active", true)
        .order("name");
      if (departmentScope) query = query.eq("id", departmentScope);
      return query;
    })(),
  ]);

  if (pageResult.error || departmentsResult.error) {
    return NextResponse.json(
      {
        error:
          pageResult.error?.message ??
          departmentsResult.error?.message ??
          "load_failed",
      },
      { status: 500 },
    );
  }

  const payload = (pageResult.data ?? {}) as ListPageResult;

  return NextResponse.json({
    recordings: payload.recordings ?? [],
    departments: departmentsResult.data ?? [],
    source: "supabase",
    scopedDepartmentId: departmentScope,
    page: payload.page ?? page,
    pageSize: payload.pageSize ?? PAGE_SIZE,
    totalCount: payload.totalCount ?? 0,
    totalPages: payload.totalPages ?? 1,
    totalDurationSeconds: payload.totalDurationSeconds ?? 0,
    voicemailCount: payload.voicemailCount ?? 0,
  });
}
