import { NextRequest, NextResponse } from "next/server";
import { businessClockFor, businessClockLabel } from "@/lib/business-clock";
import { normalizeSchedule } from "@/lib/business-hours";
import { jerusalemToday } from "@/lib/israel-time";
import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/supabase/server";
import {
  daysBetween,
  presetRange,
  previousRange,
  type WaDailyRow,
  type WaHistoryPayload,
} from "@/lib/wa-history";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, must-revalidate" };
const DEFAULT_DEPARTMENT_ID = "customer-service";
/** A quarter is the longest comparison the page offers; keeps the query small. */
const MAX_RANGE_DAYS = 92;

const SELECT =
  "day,department_id,agent_id,ticket_count,open_count,closed_count,time_to_close_seconds_sum,responded_count,first_response_seconds_sum,under_3_count,over_3_count,over_7_count,over_10_count,computed_at,agents!agent_id(name)";

type Row = {
  day: string;
  department_id: string;
  agent_id: string;
  ticket_count: number;
  open_count: number;
  closed_count: number;
  time_to_close_seconds_sum: number | string;
  responded_count: number;
  first_response_seconds_sum: number | string;
  under_3_count: number;
  over_3_count: number;
  over_7_count: number;
  over_10_count: number;
  computed_at: string;
  agents: { name?: string } | { name?: string }[] | null;
};

function isIsoDay(value: string | null): value is string {
  return value != null && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

/**
 * The stored daily WhatsApp record for a department over a range of days,
 * plus the equal-length period before it so the page can show what changed.
 * Rows come from public.wa_agent_daily, which the database rebuilds every
 * ten minutes — nothing is computed from live tickets here.
 */
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

  const params = request.nextUrl.searchParams;
  const today = jerusalemToday();
  const fallback = presetRange("this-week", today);
  const from = isIsoDay(params.get("from")) ? params.get("from")! : fallback.from;
  const to = isIsoDay(params.get("to")) ? params.get("to")! : fallback.to;
  if (from > to || daysBetween(from, to) > MAX_RANGE_DAYS) {
    return NextResponse.json(
      { error: "invalid_range" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  // The account owner can pick any period to compare against instead of the
  // automatic equal-length period right before `from` — a slow month against
  // the same month last quarter, say. Falls back to the automatic period
  // when compareFrom/compareTo are absent or invalid.
  const compareFrom = params.get("compareFrom");
  const compareTo = params.get("compareTo");
  const previous =
    isIsoDay(compareFrom) && isIsoDay(compareTo) && compareFrom <= compareTo
      ? { from: compareFrom, to: compareTo }
      : previousRange(from, to);
  if (daysBetween(previous.from, previous.to) > MAX_RANGE_DAYS) {
    return NextResponse.json(
      { error: "invalid_range" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }
  const departmentId = params.get("department") ?? DEFAULT_DEPARTMENT_ID;

  // Two separate queries, not one contiguous range split at `from`: a
  // manually picked comparison period need not be adjacent to the current
  // one at all.
  const [rowsResult, previousRowsResult, departmentsResult, hoursResult] = await Promise.all([
    supabase
      .from("wa_agent_daily")
      .select(SELECT)
      .eq("department_id", departmentId)
      .gte("day", from)
      .lte("day", to)
      .order("day", { ascending: true }),
    supabase
      .from("wa_agent_daily")
      .select(SELECT)
      .eq("department_id", departmentId)
      .gte("day", previous.from)
      .lte("day", previous.to)
      .order("day", { ascending: true }),
    supabase
      .from("departments")
      .select("id,name")
      .eq("active", true)
      .order("sort_order", { ascending: true }),
    supabase
      .from("department_business_hours")
      .select("schedule")
      .eq("department_id", departmentId)
      .maybeSingle(),
  ]);

  const failed = rowsResult.error ?? previousRowsResult.error ??
    departmentsResult.error ?? hoursResult.error;
  if (failed) {
    return NextResponse.json(
      { error: "wa_history_query_failed", details: failed.message },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  const departments = ((departmentsResult.data ?? []) as { id: string; name: string }[])
    .map((row) => ({ id: row.id, name: row.name }));
  const department = departments.find((item) => item.id === departmentId);
  if (!department) {
    return NextResponse.json(
      { error: "unknown_department" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  let computedAt: string | null = null;
  const mapRow = (row: Row): WaDailyRow => {
    const agent = Array.isArray(row.agents) ? row.agents[0] : row.agents;
    return {
      day: row.day,
      departmentId: row.department_id,
      agentId: row.agent_id,
      agentName: agent?.name ?? row.agent_id,
      ticketCount: row.ticket_count,
      openCount: row.open_count,
      closedCount: row.closed_count,
      timeToCloseSecondsSum: Number(row.time_to_close_seconds_sum),
      respondedCount: row.responded_count,
      firstResponseSecondsSum: Number(row.first_response_seconds_sum),
      under3Count: row.under_3_count,
      over3Count: row.over_3_count,
      over7Count: row.over_7_count,
      over10Count: row.over_10_count,
    };
  };
  const rows = ((rowsResult.data ?? []) as Row[]).map((row) => {
    if (computedAt == null || row.computed_at > computedAt) computedAt = row.computed_at;
    return mapRow(row);
  });
  const previousRows = ((previousRowsResult.data ?? []) as Row[]).map(mapRow);

  const payload: WaHistoryPayload = {
    from,
    to,
    previous,
    department,
    departments,
    rows,
    previousRows,
    businessHoursLabel: businessClockLabel(
      businessClockFor(hoursResult.data ? normalizeSchedule(hoursResult.data.schedule) : null),
    ),
    computedAt,
  };

  return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
}
