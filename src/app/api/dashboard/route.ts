import { NextRequest, NextResponse } from "next/server";
import { getDepartmentScope } from "@/lib/auth/department-scope";
import { getMockDashboardData } from "@/lib/mock-data";
import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/supabase/server";
import type { Agent, CallRecord, DashboardData } from "@/lib/types";

export const dynamic = "force-dynamic";

function jerusalemBoundary(date: string, endOfDay = false): string {
  const time = endOfDay ? "23:59:59.999" : "00:00:00.000";
  const wallClockUtc = Date.parse(`${date}T${time}Z`);
  let instant = wallClockUtc;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  for (let pass = 0; pass < 2; pass += 1) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(instant))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
    const representedAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    instant = wallClockUtc - (representedAsUtc - instant);
  }

  return new Date(instant).toISOString();
}

const NO_STORE_HEADERS = { "Cache-Control": "no-store, must-revalidate" };

const CALLS_SELECT =
  "id,direction,status,agent_id,transferred_by_agent_id,customer_number,started_at,ended_at,duration_seconds,talk_time_seconds,wait_time_seconds,department_id,agents!agent_id(name),transferred_by_agent:agents!transferred_by_agent_id(name),departments(name)";

// PostgREST caps every response at the project's db-max-rows (1000 by default)
// and silently ignores a larger .limit(). A busy day here runs past 1,400
// calls, so one request returned only the newest 1,000 and every KPI quietly
// under-reported the morning. Page through instead, advancing by the number of
// rows actually returned so the loop stays correct whatever the cap is set to.
const CALLS_PAGE_SIZE = 1000;
// Paging all the way to the end is right for a day or a week, but a month here
// is ~40k calls (and analytics widens the window further for its comparison
// period). Fetching that took dozens of sequential round trips and megabytes of
// JSON, which overran the function's time budget — the dashboard span and then
// rendered nothing at all. Bound the work so a long range degrades to "slightly
// short" instead of "broken", and say so in the payload rather than silently.
const CALLS_MAX_PAGES = 12;
const CALLS_HARD_CAP = CALLS_PAGE_SIZE * CALLS_MAX_PAGES;

export async function GET(request: NextRequest) {
  if (
    !isSupabaseConfigured() ||
    process.env.NEXT_PUBLIC_DEMO_MODE === "true"
  ) {
    return NextResponse.json(getMockDashboardData(), {
      headers: NO_STORE_HEADERS,
    });
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

  const departmentScope = await getDepartmentScope(supabase, user.id);

  const from =
    request.nextUrl.searchParams.get("from") ??
    new Date(Date.now() - 31 * 86_400_000).toISOString().slice(0, 10);
  const to =
    request.nextUrl.searchParams.get("to") ??
    new Date().toISOString().slice(0, 10);

  // Numbers that were retired but left open in Aircall keep accepting calls
  // that then ring nobody. Those are not call centre traffic and are dropped
  // from the moment each line was retired — traffic from before it stays, so
  // the months when these were the live numbers still report correctly.
  const { data: retiredLines } = await supabase
    .from("talk_lines")
    .select("id,excluded_from")
    .not("excluded_from", "is", null);

  const callsPage = (offset: number) => {
    let query = supabase
      .from("calls")
      .select(CALLS_SELECT)
      .gte("started_at", jerusalemBoundary(from))
      .lte("started_at", jerusalemBoundary(to, true))
      .order("started_at", { ascending: false })
      // started_at is not unique; a stable tiebreaker keeps pages from
      // repeating or skipping rows that share a timestamp.
      .order("id", { ascending: false })
      .range(offset, offset + CALLS_PAGE_SIZE - 1);
    if (departmentScope) {
      query = query.eq("department_id", departmentScope);
    }
    // One clause per retired line, ANDed together: keep the row unless it is
    // on that line *and* started after that line's cutoff.
    for (const line of retiredLines ?? []) {
      query = query.or(
        `line_id.neq.${line.id},started_at.lt.${line.excluded_from}`,
      );
    }
    return query;
  };

  let agentsQuery = supabase
    .from("agents")
    .select(
      "id,name,department_id,departments(name),agent_live_status(state,state_since,current_call_started_at)",
    )
    .eq("active", true)
    .order("name");

  let departmentsQuery = supabase
    .from("departments")
    .select("id,name")
    .eq("active", true)
    .order("name");

  if (departmentScope) {
    agentsQuery = agentsQuery.eq("department_id", departmentScope);
    departmentsQuery = departmentsQuery.eq("id", departmentScope);
  }

  const [firstCallsPage, agentsResult, departmentsResult] = await Promise.all([
    callsPage(0),
    agentsQuery,
    departmentsQuery,
  ]);

  const error =
    firstCallsPage.error ?? agentsResult.error ?? departmentsResult.error;
  if (error) {
    return NextResponse.json(
      { error: "dashboard_query_failed", details: error.message },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  const callRows = [...(firstCallsPage.data ?? [])];
  let truncated = false;
  if (callRows.length === CALLS_PAGE_SIZE) {
    // The range spills past one page. Fixed page offsets are only predictable
    // when the server honors CALLS_PAGE_SIZE — a full first page proves it —
    // so pull the rest in parallel batches instead of one-after-another: a
    // month is ~12 pages, and 11 extra sequential round trips were most of
    // the long-range latency. Batching (instead of firing all 11 at once)
    // keeps a "today" poll at one extra batch instead of nine empty fetches.
    const PARALLEL_PAGE_BATCH = 4;
    let nextPage = 1;
    let sawShortPage = false;
    while (!sawShortPage && nextPage < CALLS_MAX_PAGES) {
      const batchSize = Math.min(
        PARALLEL_PAGE_BATCH,
        CALLS_MAX_PAGES - nextPage,
      );
      const batch = await Promise.all(
        Array.from({ length: batchSize }, (_, index) =>
          callsPage((nextPage + index) * CALLS_PAGE_SIZE),
        ),
      );
      nextPage += batchSize;
      for (const page of batch) {
        if (page.error) {
          return NextResponse.json(
            { error: "dashboard_query_failed", details: page.error.message },
            { status: 500, headers: NO_STORE_HEADERS },
          );
        }
        const rows = page.data ?? [];
        callRows.push(...rows);
        if (rows.length < CALLS_PAGE_SIZE) {
          sawShortPage = true;
          break;
        }
      }
    }
    // Twelve full pages may still not be the end of the range.
    truncated = !sawShortPage && callRows.length >= CALLS_HARD_CAP;
  } else if (callRows.length > 0) {
    // Short first page: either the range fits in one page, or db-max-rows is
    // set below CALLS_PAGE_SIZE and offsets can't be predicted — keep the old
    // sequential walk that advances by the rows actually returned.
    let offset = callRows.length;
    while (offset < CALLS_HARD_CAP) {
      const { data: pageRows, error: pageError } = await callsPage(offset);
      if (pageError) {
        return NextResponse.json(
          { error: "dashboard_query_failed", details: pageError.message },
          { status: 500, headers: NO_STORE_HEADERS },
        );
      }
      if (!pageRows?.length) break;
      callRows.push(...pageRows);
      offset += pageRows.length;
    }
    truncated = offset >= CALLS_HARD_CAP;
  }

  const calls: CallRecord[] = callRows.map((row) => {
    const agent = row.agents as unknown as { name: string } | null;
    const transferredBy = row.transferred_by_agent as unknown as {
      name: string;
    } | null;
    const department = row.departments as unknown as { name: string } | null;
    return {
      id: row.id,
      direction: row.direction,
      status: row.status,
      agentId: row.agent_id,
      agentName: agent?.name ?? null,
      transferredByAgentId: row.transferred_by_agent_id,
      transferredByAgentName: transferredBy?.name ?? null,
      departmentId: row.department_id,
      departmentName: department?.name ?? null,
      customerNumber: row.customer_number,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      durationSeconds: row.duration_seconds,
      talkTimeSeconds: row.talk_time_seconds,
      waitTimeSeconds: row.wait_time_seconds ?? 0,
    };
  });

  // Prefer live call truth over availability sync: an open call must show as
  // on_call even when roster sync wrote "available" or "unavailable" (Aircall
  // reports in-call agents as unavailable). Explicit Away presence and
  // wrap-up still win, so stale in_progress rows can't fake "בשיחה". "ringing"
  // also wins over inherited talk_time (e.g. right after an internal
  // transfer, before the destination agent has answered).
  const explicitPresence = new Set<Agent["state"]>([
    "back_office",
    "on_break",
    "out_for_lunch",
    "in_training",
    "other",
    "wrap_up",
    "ringing",
  ]);

  const activeCallByAgent = new Map<string, CallRecord>();
  for (const call of calls) {
    if (call.status !== "in_progress" || !call.agentId) continue;
    const existing = activeCallByAgent.get(call.agentId);
    if (!existing || call.startedAt > existing.startedAt) {
      activeCallByAgent.set(call.agentId, call);
    }
  }

  const agents: Agent[] = (agentsResult.data ?? []).map((row) => {
    const department = row.departments as unknown as { name: string } | null;
    const embeddedStatus = row.agent_live_status as unknown as
      | {
          state: Agent["state"];
          state_since: string;
          current_call_started_at: string | null;
        }
      | Array<{
          state: Agent["state"];
          state_since: string;
          current_call_started_at: string | null;
        }>
      | null;
    const status = Array.isArray(embeddedStatus)
      ? embeddedStatus[0]
      : embeddedStatus;
    const liveState = status?.state ?? "unavailable";
    const activeCall = activeCallByAgent.get(row.id);
    // An answered open call always means on_call unless the agent explicitly
    // moved to Away/wrap-up. Unanswered legs keep "ringing" visible.
    const callAnswered = Boolean(activeCall && activeCall.talkTimeSeconds > 0);
    const forceOnCall =
      Boolean(activeCall) &&
      !explicitPresence.has(liveState) &&
      (callAnswered ||
        liveState === "available" ||
        liveState === "scheduled" ||
        liveState === "unavailable");
    return {
      id: row.id,
      name: row.name,
      departmentId: row.department_id ?? "",
      departmentName: department?.name ?? "ללא מחלקה",
      state: forceOnCall ? "on_call" : liveState,
      stateSince: forceOnCall
        ? activeCall!.startedAt
        : (status?.state_since ?? new Date().toISOString()),
      currentCallStartedAt: forceOnCall
        ? activeCall!.startedAt
        : (status?.current_call_started_at ?? undefined),
    };
  });

  const payload: DashboardData = {
    calls,
    agents,
    departments: departmentsResult.data ?? [],
    generatedAt: new Date().toISOString(),
    source: "supabase",
    scopedDepartmentId: departmentScope,
    // True when the range held more calls than CALLS_HARD_CAP, so figures
    // derived from this payload cover only the most recent slice of it.
    truncated,
  };
  return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
}
