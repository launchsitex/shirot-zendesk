import { NextRequest, NextResponse } from "next/server";
import { jerusalemDayBounds, jerusalemToday } from "@/lib/israel-time";
import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/supabase/server";
import type {
  AgentTicketSummary,
  TicketRow,
  TicketsPayload,
} from "@/lib/tickets";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, must-revalidate" };

// The list shows the most recent tickets; the per-agent counts come from the
// database over the whole range. Shipping every row just to count them in the
// browser cost ~1.5MB and nine round trips per refresh, which is what kept the
// poll interval slow — the same request-volume trap the call pages hit.
const LIST_LIMIT = 500;

const SELECT =
  "id,subject,status,requester_name,requester_phone,assignee_name,agent_id,zendesk_created_at,zendesk_updated_at,documented,agent_note_count,agent_reply_count,agents(name,departments(name))";

const CLOSED = ["solved", "closed"];

type Row = {
  id: string;
  subject: string | null;
  status: string;
  requester_name: string | null;
  requester_phone: string | null;
  assignee_name: string | null;
  agent_id: string | null;
  zendesk_created_at: string;
  zendesk_updated_at: string;
  documented: boolean;
  agent_note_count: number;
  agent_reply_count: number;
  agents: unknown;
};

type SummaryRow = {
  agent_id: string | null;
  agent_name: string;
  department_name: string | null;
  open_count: number;
  closed_count: number;
  total_count: number;
  documented_count: number;
  undocumented_count: number;
};

/** First day of the current month in Jerusalem, as YYYY-MM-DD. */
function startOfCurrentMonth(): string {
  return `${jerusalemToday().slice(0, 7)}-01`;
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

  const params = request.nextUrl.searchParams;
  const from = params.get("from") ?? startOfCurrentMonth();
  const to = params.get("to") ?? jerusalemToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json(
      { error: "invalid_date" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const fromInstant = jerusalemDayBounds(from);
  const toInstant = jerusalemDayBounds(to, true);
  const agentId = params.get("agentId");
  const status = params.get("status");
  const documented = params.get("documented");

  // Filtering happens in the query, not on an already-truncated list, so
  // narrowing to one agent shows that agent's whole range rather than whichever
  // of their tickets happened to fall inside the newest 500 overall.
  let listQuery = supabase
    .from("zendesk_tickets")
    .select(SELECT)
    .gte("zendesk_created_at", fromInstant)
    .lte("zendesk_created_at", toInstant)
    .order("zendesk_created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(LIST_LIMIT);

  if (agentId === "unassigned") {
    listQuery = listQuery.is("agent_id", null);
  } else if (agentId) {
    listQuery = listQuery.eq("agent_id", agentId);
  }
  if (status === "open") {
    listQuery = listQuery.not("status", "in", `(${CLOSED.join(",")})`);
  } else if (status === "closed") {
    listQuery = listQuery.in("status", CLOSED);
  }
  if (documented === "yes") {
    listQuery = listQuery.eq("documented", true);
  } else if (documented === "no") {
    listQuery = listQuery.eq("documented", false);
  }

  const [listResult, summaryResult, syncResult] = await Promise.all([
    listQuery,
    // Department scoping is enforced by RLS inside the function too, since it
    // is SECURITY INVOKER.
    supabase.rpc("zendesk_ticket_summary", {
      p_from: fromInstant,
      p_to: toInstant,
    }),
    supabase
      .from("zendesk_sync_state")
      .select("last_run_at")
      .eq("id", 1)
      .maybeSingle(),
  ]);

  if (listResult.error || summaryResult.error) {
    return NextResponse.json(
      {
        error: "tickets_query_failed",
        details: (listResult.error ?? summaryResult.error)?.message,
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  const tickets: TicketRow[] = ((listResult.data ?? []) as Row[]).map((row) => {
    const agent = (Array.isArray(row.agents) ? row.agents[0] : row.agents) as
      | { name?: string; departments?: { name?: string } | { name?: string }[] }
      | null;
    const department = Array.isArray(agent?.departments)
      ? agent?.departments[0]
      : agent?.departments;
    return {
      id: row.id,
      subject: row.subject,
      status: row.status,
      customerName: row.requester_name,
      customerPhone: row.requester_phone,
      agentId: row.agent_id,
      // Fall back to the Zendesk assignee so a ticket handled by somebody
      // outside the call centre roster still shows who owns it.
      agentName: agent?.name ?? row.assignee_name ?? null,
      departmentName: department?.name ?? null,
      createdAt: row.zendesk_created_at,
      updatedAt: row.zendesk_updated_at,
      documented: row.documented === true,
      agentNoteCount: Number(row.agent_note_count ?? 0),
      agentReplyCount: Number(row.agent_reply_count ?? 0),
    };
  });

  const summary: AgentTicketSummary[] = (
    (summaryResult.data ?? []) as SummaryRow[]
  ).map((row) => ({
    agentId: row.agent_id,
    agentName: row.agent_name,
    departmentName: row.department_name,
    open: Number(row.open_count ?? 0),
    closed: Number(row.closed_count ?? 0),
    total: Number(row.total_count ?? 0),
    documented: Number(row.documented_count ?? 0),
    undocumented: Number(row.undocumented_count ?? 0),
  }));

  const payload: TicketsPayload = {
    from,
    to,
    rows: tickets,
    summary,
    totals: {
      open: summary.reduce((sum, row) => sum + row.open, 0),
      closed: summary.reduce((sum, row) => sum + row.closed, 0),
      total: summary.reduce((sum, row) => sum + row.total, 0),
      documented: summary.reduce((sum, row) => sum + row.documented, 0),
      undocumented: summary.reduce((sum, row) => sum + row.undocumented, 0),
    },
    listLimit: LIST_LIMIT,
    truncated: tickets.length === LIST_LIMIT,
    syncedAt: syncResult.data?.last_run_at ?? null,
  };
  return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
}
