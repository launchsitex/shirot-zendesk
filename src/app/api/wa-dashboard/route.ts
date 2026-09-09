import { NextRequest, NextResponse } from "next/server";
import { jerusalemDayBounds, jerusalemToday } from "@/lib/israel-time";
import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/supabase/server";
import { CLOSED_STATUSES } from "@/lib/tickets";
import {
  hourlyBuckets,
  summarizeByAgent,
  summarizeByDepartment,
  summarizeTickets,
  type WaDashboardPayload,
  type WaTicketRow,
} from "@/lib/wa-dashboard";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, must-revalidate" };

// A single Israel calendar day of WhatsApp tickets is a few hundred rows at
// most (see the sync's own note on daily volume) — comfortably under
// PostgREST's row cap, so this is fetched directly and aggregated here rather
// than through a database-side rollup function.
const ROWS_LIMIT = 1000;

// Scoped to Customer Service only, at the account owner's request — Deliveries'
// WhatsApp traffic is a different workflow and was drowning out the figures
// that matter here. Filtered by the department's stable id, not its display
// name, matching how department filters work everywhere else in this app.
const DEPARTMENT_FILTER_ID = "customer-service";

// The *_message_at columns come from the Messaging trigger's tag flips, not
// from ticket comments — see src/lib/wa-dashboard.ts for why.
const SELECT =
  "id,subject,requester_name,requester_phone,agent_id,assignee_name,status,zendesk_created_at,zendesk_updated_at,handed_to_agent_at,first_agent_message_at,last_agent_message_at,last_customer_message_at,customer_waiting_since,agents(name,departments(id,name))";

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
  handed_to_agent_at: string | null;
  first_agent_message_at: string | null;
  last_agent_message_at: string | null;
  last_customer_message_at: string | null;
  customer_waiting_since: string | null;
  agents: unknown;
};

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

  const rows: WaTicketRow[] = ((rowsResult.data ?? []) as Row[])
    .map((row) => {
      const agent = (Array.isArray(row.agents) ? row.agents[0] : row.agents) as
        | {
            name?: string;
            departments?:
              | { id?: string; name?: string }
              | { id?: string; name?: string }[];
          }
        | null;
      const department = Array.isArray(agent?.departments)
        ? agent?.departments[0]
        : agent?.departments;
      const closed = CLOSED_STATUSES.has(row.status);
      const lastAgent = row.last_agent_message_at;
      const lastCustomer = row.last_customer_message_at;
      // The first-response clock starts when the bot hands the customer to
      // the agents; a ticket with no recorded handoff falls back to its start
      // and says so.
      const clockStart = row.handed_to_agent_at ?? row.zendesk_created_at;
      // The customer is waiting when nobody from the team has written yet, or
      // when they wrote again after the agent's last message. The wait is
      // counted from their first message that is still unanswered: the
      // handoff when no agent has written, otherwise the first customer flip
      // after the agent's last message (customer_waiting_since).
      const waitingSince = closed
        ? null
        : lastAgent == null
          ? clockStart
          : row.customer_waiting_since;
      return {
        id: row.id,
        subject: row.subject,
        customerName: row.requester_name,
        customerPhone: row.requester_phone,
        agentId: row.agent_id,
        agentName: agent?.name ?? row.assignee_name ?? null,
        departmentId: department?.id ?? null,
        departmentName: department?.name ?? null,
        status: row.status,
        createdAt: row.zendesk_created_at,
        updatedAt: row.zendesk_updated_at,
        handedToAgentAt: row.handed_to_agent_at,
        firstResponseFromHandoff: row.handed_to_agent_at != null,
        firstResponseSeconds: row.first_agent_message_at
          ? secondsBetween(clockStart, row.first_agent_message_at)
          : null,
        closed,
        timeToCloseSeconds: closed
          ? secondsBetween(row.zendesk_created_at, row.zendesk_updated_at)
          : null,
        lastAgentMessageAt: lastAgent,
        lastCustomerMessageAt: lastCustomer,
        waitingSince,
      };
    })
    .filter((row) => row.departmentId === DEPARTMENT_FILTER_ID);

  const payload: WaDashboardPayload = {
    date,
    totals: summarizeTickets(rows),
    byAgent: summarizeByAgent(rows),
    byDepartment: summarizeByDepartment(rows),
    hourly: hourlyBuckets(rows),
    rows,
    syncedAt: syncResult.data?.last_run_at ?? null,
  };

  return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
}
