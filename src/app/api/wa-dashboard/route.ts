import { NextRequest, NextResponse } from "next/server";
import {
  businessClockFor,
  businessSecondsBetween,
  type BusinessClock,
} from "@/lib/business-clock";
import { normalizeSchedule } from "@/lib/business-hours";
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
  type AgentDirectory,
  type WaAgentAvailability,
  type WaDashboardPayload,
  type WaQueueTicket,
  type WaTicketRow,
} from "@/lib/wa-dashboard";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, must-revalidate" };

// A single Israel calendar day of WhatsApp tickets is a few hundred rows at
// most (see the sync's own note on daily volume) — comfortably under
// PostgREST's row cap, so this is fetched directly and aggregated here rather
// than through a database-side rollup function.
const ROWS_LIMIT = 1000;

// One dashboard per department, at the account owner's request: `?department=`
// picks which, by the department's stable id (the way department filters work
// everywhere else in this app), defaulting to Customer Service.
const DEFAULT_DEPARTMENT_ID = "customer-service";

// The *_message_at columns come from the Messaging trigger's tag flips, not
// from ticket comments — see src/lib/wa-dashboard.ts for why.
const SELECT =
  "id,subject,requester_name,requester_phone,agent_id,assignee_name,status,zendesk_created_at,zendesk_updated_at,handed_to_agent_at,first_agent_message_at,last_agent_message_at,last_customer_message_at,customer_waiting_since,solved_at,first_response_agent_id,solved_by_agent_id,agents!agent_id(name,departments!department_id(id,name))";

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
  solved_at: string | null;
  first_response_agent_id: string | null;
  solved_by_agent_id: string | null;
  agents: unknown;
};

type AgentRow = {
  id: string;
  name: string;
  departments: { name?: string } | { name?: string }[] | null;
};

type AvailabilityRow = {
  agent_id: string | null;
  status_name: string;
  status_updated_at: string | null;
  messaging_work_items: number | null;
  messaging_max_capacity: number | null;
  synced_at: string;
  agents:
    | {
      name?: string;
      department_id?: string | null;
      departments?: { name?: string } | { name?: string }[] | null;
    }
    | Array<{
      name?: string;
      department_id?: string | null;
      departments?: { name?: string } | { name?: string }[] | null;
    }>
    | null;
};

type QueueRow = {
  id: string;
  requester_name: string | null;
  requester_phone: string | null;
  group_id: string | null;
  zendesk_created_at: string;
  handed_to_agent_at: string | null;
};

type GroupRow = {
  group_id: string;
  departments: { id?: string; name?: string } | { id?: string; name?: string }[] | null;
};

const QUEUE_LIMIT = 200;

// "ממתינים לתגובה" also lists open tickets from earlier days — from this
// Israel calendar day on, at the account owner's request: it is the day the
// Messaging tag flips (who wrote last) and the bot handoff started being
// tracked, so earlier tickets have no reliable "still unanswered" signal.
const BACKLOG_FROM_DATE = "2026-09-08";
const BACKLOG_LIMIT = 500;
const MESSAGE_DATA_COMPLETE_FROM = jerusalemDayBounds(BACKLOG_FROM_DATE);

function mapTicketRow(row: Row, clock: BusinessClock): WaTicketRow {
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
  // Exact when the sync saw the solved transition; otherwise the last
  // update is the closest thing available.
  const closedAt = row.solved_at ?? row.zendesk_updated_at;
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
  // Only a ticket in status "open" is waiting on the agent: "pending" and
  // "on-hold" mean the agent parked it (waiting on the customer or a
  // third party), "new" is still in the assignment queue, and solved or
  // closed tickets are done.
  const waitingSince =
    row.status !== "open"
      ? null
      : lastAgent == null
        ? row.zendesk_created_at >= MESSAGE_DATA_COMPLETE_FROM
          ? clockStart
          : null
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
      ? businessSecondsBetween(clockStart, row.first_agent_message_at, clock)
      : null,
    closed,
    timeToCloseSeconds: closed
      ? businessSecondsBetween(row.zendesk_created_at, closedAt, clock)
      : null,
    solvedAt: row.solved_at,
    firstResponseAgentId: row.first_response_agent_id ??
      (row.first_agent_message_at ? row.agent_id : null),
    solvedByAgentId: row.solved_by_agent_id ?? (closed ? row.agent_id : null),
    lastAgentMessageAt: lastAgent,
    lastCustomerMessageAt: lastCustomer,
    waitingSince,
  };
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
  const departmentId =
    request.nextUrl.searchParams.get("department") ?? DEFAULT_DEPARTMENT_ID;

  const isToday = date === jerusalemToday();
  const backlogStart = MESSAGE_DATA_COMPLETE_FROM;

  const [rowsResult, queueResult, groupsResult, departmentsResult, agentsResult, availabilityResult, syncResult, hoursResult, backlogResult] = await Promise.all([
    supabase
      .from("zendesk_tickets")
      .select(SELECT)
      .eq("via_channel", "whatsapp")
      .neq("status", "deleted")
      .gte("zendesk_created_at", dayStart)
      .lte("zendesk_created_at", dayEnd)
      .order("zendesk_created_at", { ascending: true })
      .limit(ROWS_LIMIT),
    // The queue: status "new" — the status the bot leaves a ticket in when it
    // hands it to the agents, and one agents cannot set themselves — with
    // nobody assigned at all (the bot holds the assignment while it handles
    // the start of a conversation). Only "new", at the account owner's
    // request: an unassigned ticket in any other status (open after a
    // customer reply, on hold) is not a customer waiting for pickup. Whatever
    // day it was opened on; departments are split in the payload. The wait
    // runs from the handoff, or the ticket's start if the sync has no handoff
    // event for it.
    supabase
      .from("zendesk_tickets")
      .select(
        "id,requester_name,requester_phone,group_id,zendesk_created_at,handed_to_agent_at",
      )
      .eq("via_channel", "whatsapp")
      .is("assignee_id", null)
      .eq("status", "new")
      .order("zendesk_created_at", { ascending: true })
      .limit(QUEUE_LIMIT),
    supabase
      .from("zendesk_group_departments")
      .select("group_id,departments(id,name)"),
    supabase
      .from("departments")
      .select("id,name")
      .eq("active", true)
      .order("sort_order", { ascending: true }),
    // Names for agents credited with a first response or a closure on a
    // ticket that has since moved to somebody else.
    supabase.from("agents").select("id,name,departments!department_id(name)"),
    // Live status and messaging load, refreshed by the sync every minute.
    supabase
      .from("zendesk_agent_availability")
      .select(
        "agent_id,status_name,status_updated_at,messaging_work_items,messaging_max_capacity,synced_at,agents!agent_id(name,department_id,departments!department_id(name))",
      )
      .not("agent_id", "is", null),
    supabase
      .from("zendesk_sync_state")
      .select("last_run_at")
      .eq("id", 1)
      .maybeSingle(),
    // The department's business hours from settings: every duration below
    // runs on this clock (see WaDashboardPayload.businessHours). Used
    // whenever a schedule is configured, independently of the after-hours
    // call-routing switch — the account owner wants agents measured on
    // working time regardless of how calls are routed.
    supabase
      .from("department_business_hours")
      .select("schedule")
      .eq("department_id", departmentId)
      .maybeSingle(),
    // Open tickets from earlier days (since BACKLOG_FROM_DATE), for the live
    // waiting list only — meaningless for a past date, so skipped there.
    isToday
      ? supabase
          .from("zendesk_tickets")
          .select(SELECT)
          .eq("via_channel", "whatsapp")
          .eq("status", "open")
          .not("agent_id", "is", null)
          .gte("zendesk_created_at", backlogStart)
          .lt("zendesk_created_at", dayStart)
          .order("zendesk_created_at", { ascending: true })
          .limit(BACKLOG_LIMIT)
      : Promise.resolve({ data: [] as Row[], error: null }),
  ]);

  const failed = rowsResult.error ?? queueResult.error ?? groupsResult.error ??
    departmentsResult.error ?? agentsResult.error ?? availabilityResult.error ??
    hoursResult.error ?? backlogResult.error;
  if (failed) {
    return NextResponse.json(
      { error: "wa_dashboard_query_failed", details: failed.message },
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

  const departmentByGroup = new Map<string, { id: string; name: string }>();
  for (const row of (groupsResult.data ?? []) as GroupRow[]) {
    const department = Array.isArray(row.departments)
      ? row.departments[0]
      : row.departments;
    if (department?.id && department.name) {
      departmentByGroup.set(row.group_id, { id: department.id, name: department.name });
    }
  }
  const queue: WaQueueTicket[] = ((queueResult.data ?? []) as QueueRow[]).map(
    (row) => {
      const department = row.group_id ? departmentByGroup.get(row.group_id) : undefined;
      return {
        id: row.id,
        customerName: row.requester_name,
        customerPhone: row.requester_phone,
        departmentId: department?.id ?? null,
        departmentName: department?.name ?? "ללא שיוך מחלקה",
        createdAt: row.zendesk_created_at,
        handedToAgentAt: row.handed_to_agent_at ?? row.zendesk_created_at,
      };
    },
  );

  const clock = businessClockFor(
    hoursResult.data ? normalizeSchedule(hoursResult.data.schedule) : null,
  );

  const rows: WaTicketRow[] = ((rowsResult.data ?? []) as Row[])
    .map((row) => mapTicketRow(row, clock))
    .filter((row) => row.departmentId === departmentId);
  const openBacklog: WaTicketRow[] = ((backlogResult.data ?? []) as Row[])
    .map((row) => mapTicketRow(row, clock))
    .filter((row) => row.departmentId === departmentId);

  const agents: AgentDirectory = {};
  for (const agent of (agentsResult.data ?? []) as AgentRow[]) {
    const department = Array.isArray(agent.departments)
      ? agent.departments[0]
      : agent.departments;
    agents[agent.id] = { name: agent.name, departmentName: department?.name ?? null };
  }

  const availability: WaAgentAvailability[] = (
    (availabilityResult.data ?? []) as AvailabilityRow[]
  ).flatMap((row) => {
    const agent = Array.isArray(row.agents) ? row.agents[0] : row.agents;
    if (!row.agent_id || !agent || agent.department_id !== departmentId) return [];
    const department = Array.isArray(agent.departments)
      ? agent.departments[0]
      : agent.departments;
    return [{
      agentId: row.agent_id,
      agentName: agent.name ?? row.agent_id,
      departmentName: department?.name ?? null,
      status: row.status_name,
      statusSince: row.status_updated_at,
      messagingWorkItems: Number(row.messaging_work_items ?? 0),
      messagingMaxCapacity: row.messaging_max_capacity ?? null,
      syncedAt: row.synced_at,
    }];
  });

  const payload: WaDashboardPayload = {
    date,
    businessHours: clock,
    totals: summarizeTickets(rows),
    byAgent: summarizeByAgent(rows, agents),
    byDepartment: summarizeByDepartment(rows),
    hourly: hourlyBuckets(rows),
    rows,
    openBacklog,
    // This department's queue, plus anything in a group nobody has mapped to
    // a department yet — shown on every department's dashboard rather than on
    // none, so an unmapped routing group cannot hide a waiting customer.
    queue: queue.filter(
      (ticket) => ticket.departmentId === departmentId || ticket.departmentId == null,
    ),
    department,
    departments,
    agents,
    availability,
    syncedAt: syncResult.data?.last_run_at ?? null,
  };

  return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
}
