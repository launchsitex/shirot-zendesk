import { NextRequest, NextResponse } from "next/server";
import { jerusalemDayBounds, jerusalemToday } from "@/lib/israel-time";
import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/supabase/server";
import { CLOSED_STATUSES } from "@/lib/tickets";
import {
  summarizeTickets,
  type WaAgentSummary,
  type WaDashboardPayload,
  type WaDepartmentSummary,
  type WaHourlyBucket,
  type WaTicketRow,
} from "@/lib/wa-dashboard";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, must-revalidate" };

// A single Israel calendar day of WhatsApp tickets is a few hundred rows at
// most (see the sync's own note on daily volume) — comfortably under
// PostgREST's row cap, so this is fetched directly and aggregated here rather
// than through a database-side rollup function.
const ROWS_LIMIT = 1000;

const SELECT =
  "id,subject,requester_name,requester_phone,agent_id,assignee_name,status,zendesk_created_at,zendesk_updated_at,first_agent_comment_at,agents(name,departments(name))";

type Row = {
  id: string;
  subject: string | null;
  requester_name: string | null;
  requester_phone: string | null;
  agent_id: string | null;
  assignee_name: string | null;
  status: string;
  zendesk_created_at: string;
  zendesk_updated_at: string;
  first_agent_comment_at: string | null;
  agents: unknown;
};

const israelHourFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Jerusalem",
  hour: "2-digit",
  hour12: false,
});

function israelHour(iso: string): number {
  return Number(israelHourFormatter.format(new Date(iso)));
}

function secondsBetween(from: string, to: string): number {
  return Math.max(
    0,
    Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000),
  );
}

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
  const dayStart = jerusalemDayBounds(date);
  const dayEnd = jerusalemDayBounds(date, true);

  const [rowsResult, syncResult] = await Promise.all([
    supabase
      .from("zendesk_tickets")
      .select(SELECT)
      .eq("via_channel", "whatsapp")
      .gte("zendesk_created_at", dayStart)
      .lte("zendesk_created_at", dayEnd)
      .order("zendesk_created_at", { ascending: true })
      .limit(ROWS_LIMIT),
    supabase
      .from("zendesk_sync_state")
      .select("last_run_at")
      .eq("id", 1)
      .maybeSingle(),
  ]);

  if (rowsResult.error) {
    return NextResponse.json(
      { error: "wa_dashboard_query_failed", details: rowsResult.error.message },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  const rows: WaTicketRow[] = ((rowsResult.data ?? []) as Row[]).map((row) => {
    const agent = (Array.isArray(row.agents) ? row.agents[0] : row.agents) as
      | { name?: string; departments?: { name?: string } | { name?: string }[] }
      | null;
    const department = Array.isArray(agent?.departments)
      ? agent?.departments[0]
      : agent?.departments;
    const closed = CLOSED_STATUSES.has(row.status);
    return {
      id: row.id,
      subject: row.subject,
      customerName: row.requester_name,
      customerPhone: row.requester_phone,
      agentId: row.agent_id,
      agentName: agent?.name ?? row.assignee_name ?? null,
      departmentName: department?.name ?? null,
      status: row.status,
      createdAt: row.zendesk_created_at,
      updatedAt: row.zendesk_updated_at,
      firstResponseSeconds: row.first_agent_comment_at
        ? secondsBetween(row.zendesk_created_at, row.first_agent_comment_at)
        : null,
      closed,
      timeToCloseSeconds: closed
        ? secondsBetween(row.zendesk_created_at, row.zendesk_updated_at)
        : null,
    };
  });

  function group(rows: WaTicketRow[], key: (row: WaTicketRow) => string) {
    const map = new Map<string, WaTicketRow[]>();
    for (const row of rows) {
      const groupKey = key(row);
      let bucket = map.get(groupKey);
      if (!bucket) {
        bucket = [];
        map.set(groupKey, bucket);
      }
      bucket.push(row);
    }
    return map;
  }

  const byAgentMap = group(rows, (row) => row.agentId ?? "unassigned");
  const byDepartmentMap = group(
    rows,
    (row) => row.departmentName ?? "ללא שיוך מחלקה",
  );
  const agentMeta = new Map<
    string,
    { agentId: string | null; agentName: string; departmentName: string | null }
  >();
  for (const [key, agentRows] of byAgentMap) {
    const first = agentRows[0];
    agentMeta.set(key, {
      agentId: first.agentId,
      agentName: first.agentName ?? "ללא שיוך נציג",
      departmentName: first.departmentName,
    });
  }

  const byAgent: WaAgentSummary[] = [...byAgentMap.entries()]
    .map(([key, agentRows]) => ({
      ...agentMeta.get(key)!,
      ...summarizeTickets(agentRows),
    }))
    .sort(
      (a, b) =>
        b.awaitingFirstResponse - a.awaitingFirstResponse ||
        b.ticketCount - a.ticketCount,
    );

  const byDepartment: WaDepartmentSummary[] = [...byDepartmentMap.entries()]
    .map(([departmentName, deptRows]) => ({
      departmentName,
      ...summarizeTickets(deptRows),
    }))
    .sort(
      (a, b) =>
        b.awaitingFirstResponse - a.awaitingFirstResponse ||
        b.ticketCount - a.ticketCount,
    );

  const hourlyMap = new Map<number, number>();
  for (const row of rows) {
    const hour = israelHour(row.createdAt);
    hourlyMap.set(hour, (hourlyMap.get(hour) ?? 0) + 1);
  }
  const hourly: WaHourlyBucket[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    count: hourlyMap.get(hour) ?? 0,
  }));

  const payload: WaDashboardPayload = {
    date,
    totals: summarizeTickets(rows),
    byAgent,
    byDepartment,
    hourly,
    rows,
    syncedAt: syncResult.data?.last_run_at ?? null,
  };

  return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
}
