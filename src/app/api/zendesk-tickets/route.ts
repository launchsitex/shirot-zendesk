import { NextRequest, NextResponse } from "next/server";
import { jerusalemDayBounds, jerusalemToday } from "@/lib/israel-time";
import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/supabase/server";
import type { TicketRow, TicketsPayload } from "@/lib/tickets";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, must-revalidate" };

// PostgREST caps a response at db-max-rows and ignores a larger .limit(), the
// same trap /api/dashboard hit, so page explicitly. A month of tickets is well
// inside this bound; the flag says so honestly if it ever is not.
const PAGE_SIZE = 1000;
// This account opens well over a thousand tickets a day, so a month is several
// thousand rows. Twelve pages covers it with headroom; past that the payload
// says it was cut rather than quietly under-reporting the counts.
const MAX_PAGES = 12;

const SELECT =
  "id,subject,status,requester_name,requester_phone,assignee_name,agent_id,zendesk_created_at,zendesk_updated_at,agents(name,departments(name))";

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
  agents: unknown;
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

  const from = request.nextUrl.searchParams.get("from") ?? startOfCurrentMonth();
  const to = request.nextUrl.searchParams.get("to") ?? jerusalemToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json(
      { error: "invalid_date" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const rows: Row[] = [];
  let truncated = false;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    // Department scoping is enforced by RLS on zendesk_tickets, not here.
    const { data, error } = await supabase
      .from("zendesk_tickets")
      .select(SELECT)
      .gte("zendesk_created_at", jerusalemDayBounds(from))
      .lte("zendesk_created_at", jerusalemDayBounds(to, true))
      .order("zendesk_created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (error) {
      return NextResponse.json(
        { error: "tickets_query_failed", details: error.message },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }
    const batch = (data ?? []) as Row[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    if (page === MAX_PAGES - 1) truncated = true;
  }

  const { data: syncState } = await supabase
    .from("zendesk_sync_state")
    .select("last_run_at")
    .eq("id", 1)
    .maybeSingle();

  const tickets: TicketRow[] = rows.map((row) => {
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
      // Fall back to the Zendesk assignee name so a ticket handled by somebody
      // outside the call centre roster still shows who owns it.
      agentName: agent?.name ?? row.assignee_name ?? null,
      departmentName: department?.name ?? null,
      createdAt: row.zendesk_created_at,
      updatedAt: row.zendesk_updated_at,
    };
  });

  const payload: TicketsPayload = {
    from,
    to,
    rows: tickets,
    truncated,
    syncedAt: syncState?.last_run_at ?? null,
  };
  return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
}
