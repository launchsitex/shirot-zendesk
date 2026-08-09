import { NextRequest, NextResponse } from "next/server";
import { jerusalemDayBounds, jerusalemToday } from "@/lib/israel-time";
import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/supabase/server";
import type { OpenTicketsPayload, TicketRow } from "@/lib/tickets";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, must-revalidate" };

const LIST_LIMIT = 500;

/**
 * Tickets the assigned agent finished without writing anything in.
 *
 * "Finished" is solved OR closed. The team's Zendesk shows four statuses —
 * פתוחה / תזכורת / בהמתנה / פתורה — and "פתורה" is `solved`, what an agent sets
 * when they are done. `closed` is the same ticket after Zendesk archives it
 * automatically days later and is not offered in their UI, so counting only
 * `solved` would make an undocumented ticket vanish from a past day once it
 * aged. WhatsApp is excluded: those conversations are opened by the customer's
 * own message rather than by an agent handling a call.
 */
const FINISHED = ["solved", "closed"];
const EXCLUDED_CHANNEL = "whatsapp";

const SELECT =
  "id,subject,status,requester_name,requester_phone,assignee_name,agent_id,zendesk_created_at,zendesk_updated_at,documented,agent_note_count,agent_reply_count,via_channel,agents(name,departments(name))";

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
  undocumented_count: number;
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

  const params = request.nextUrl.searchParams;
  const date = params.get("date") ?? jerusalemToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "invalid_date" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const fromInstant = jerusalemDayBounds(date);
  const toInstant = jerusalemDayBounds(date, true);
  const agentId = params.get("agentId");

  // The agent's own tickets are only fetched when their row is expanded, so the
  // page costs one small request until somebody drills in.
  let listQuery = null;
  if (agentId) {
    let query = supabase
      .from("zendesk_tickets")
      .select(SELECT)
      .gte("zendesk_created_at", fromInstant)
      .lte("zendesk_created_at", toInstant)
      .eq("documented", false)
      .in("status", FINISHED)
      .not("via_channel", "eq", EXCLUDED_CHANNEL)
      .order("zendesk_created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(LIST_LIMIT);
    query = agentId === "unassigned"
      ? query.is("agent_id", null)
      : query.eq("agent_id", agentId);
    listQuery = query;
  }

  const [summaryResult, listResult, syncResult] = await Promise.all([
    // Department scoping is enforced by RLS inside the function, which is
    // SECURITY INVOKER.
    supabase.rpc("zendesk_undocumented_summary", {
      p_from: fromInstant,
      p_to: toInstant,
    }),
    listQuery,
    supabase
      .from("zendesk_sync_state")
      .select("last_run_at")
      .eq("id", 1)
      .maybeSingle(),
  ]);

  if (summaryResult.error || listResult?.error) {
    return NextResponse.json(
      {
        error: "open_tickets_query_failed",
        details: (summaryResult.error ?? listResult?.error)?.message,
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  const rows: TicketRow[] = ((listResult?.data ?? []) as Row[]).map((row) => {
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
      agentName: agent?.name ?? row.assignee_name ?? null,
      departmentName: department?.name ?? null,
      createdAt: row.zendesk_created_at,
      updatedAt: row.zendesk_updated_at,
      documented: row.documented === true,
      agentNoteCount: Number(row.agent_note_count ?? 0),
      agentReplyCount: Number(row.agent_reply_count ?? 0),
    };
  });

  const summary = ((summaryResult.data ?? []) as SummaryRow[]).map((row) => ({
    agentId: row.agent_id,
    agentName: row.agent_name,
    departmentName: row.department_name,
    undocumented: Number(row.undocumented_count ?? 0),
  }));

  const payload: OpenTicketsPayload = {
    date,
    summary,
    rows,
    total: summary.reduce((sum, row) => sum + row.undocumented, 0),
    syncedAt: syncResult.data?.last_run_at ?? null,
  };
  return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
}
