import { NextRequest, NextResponse } from "next/server";
import { canAccessPage } from "@/lib/app-pages";
import { getCurrentProfile } from "@/lib/auth/access";
import { jerusalemDayBounds, jerusalemToday } from "@/lib/israel-time";
import {
  EXCLUDED_SALES_AGENTS,
  type SalesTransferCategory,
  type SalesTransferDailyRow,
  type SalesTransferRow,
  type SalesTransfersPayload,
} from "@/lib/sales-transfers";
import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, must-revalidate" };
const TREND_DAYS = 14;

type BetweenRow = {
  id: string;
  phone: string;
  sales_agent: string | null;
  transferred_at: string;
  is_repeat: boolean;
  category: string | null;
  ticket_id: string | null;
  ticket_department: string | null;
  ticket_status: string | null;
  ticket_agent_name: string | null;
  customer_name: string | null;
  last_customer_message_at: string | null;
  last_agent_message_at: string | null;
  called_service_line_before: boolean | null;
  called_deliveries_24h: boolean | null;
  wa_after_ticket_id: string | null;
  wa_after_at: string | null;
};

type DailyRow = {
  day: string;
  category: string | null;
  transfers: number;
  episodes: number;
  customers: number;
};

function shiftDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "supabase_not_configured" },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json(
      { error: "unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }
  if (!canAccessPage(profile, "sales-transfers")) {
    return NextResponse.json(
      { error: "forbidden" },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  const date = request.nextUrl.searchParams.get("date") ?? jerusalemToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "invalid_date" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const supabase = await createSupabaseServerClient();
  const [dayResult, dailyResult] = await Promise.all([
    supabase.rpc("sales_transfers_between", {
      p_from: jerusalemDayBounds(date),
      p_to: jerusalemDayBounds(date, true),
      p_excluded_agents: EXCLUDED_SALES_AGENTS,
    }),
    supabase.rpc("sales_transfers_daily", {
      p_from: jerusalemDayBounds(shiftDate(date, -(TREND_DAYS - 1))),
      p_to: jerusalemDayBounds(date, true),
      p_excluded_agents: EXCLUDED_SALES_AGENTS,
    }),
  ]);

  if (dayResult.error || dailyResult.error) {
    return NextResponse.json(
      {
        error: "sales_transfers_query_failed",
        details: (dayResult.error ?? dailyResult.error)?.message,
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  const rows: SalesTransferRow[] = ((dayResult.data ?? []) as BetweenRow[]).map(
    (row) => ({
      id: row.id,
      phone: row.phone,
      salesAgent: row.sales_agent,
      transferredAt: row.transferred_at,
      isRepeat: row.is_repeat === true,
      category: row.category as SalesTransferCategory | null,
      ticketId: row.ticket_id,
      ticketDepartment: row.ticket_department,
      ticketStatus: row.ticket_status,
      ticketAgentName: row.ticket_agent_name,
      customerName: row.customer_name,
      lastCustomerMessageAt: row.last_customer_message_at,
      lastAgentMessageAt: row.last_agent_message_at,
      calledServiceLineBefore: row.called_service_line_before === true,
      calledDeliveries24h: row.called_deliveries_24h === true,
      waAfterTicketId: row.wa_after_ticket_id,
      waAfterAt: row.wa_after_at,
    }),
  );

  const daily: SalesTransferDailyRow[] = ((dailyResult.data ?? []) as DailyRow[]).map(
    (row) => ({
      day: row.day,
      category: row.category as SalesTransferCategory | null,
      transfers: Number(row.transfers ?? 0),
      episodes: Number(row.episodes ?? 0),
      customers: Number(row.customers ?? 0),
    }),
  );

  const payload: SalesTransfersPayload = { date, rows, daily };
  return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
}
