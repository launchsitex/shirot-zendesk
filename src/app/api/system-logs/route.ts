import { NextRequest, NextResponse } from "next/server";
import {
  formatIsraelDateTime,
  jerusalemDayBounds,
} from "@/lib/israel-time";
import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase אינו מחובר" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "נדרשת הרשאת מנהל" }, { status: 403 });
  }

  const from =
    request.nextUrl.searchParams.get("from") ??
    new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  const to =
    request.nextUrl.searchParams.get("to") ??
    new Date().toISOString().slice(0, 10);
  const severity = request.nextUrl.searchParams.get("severity") ?? "";

  let query = supabase
    .from("system_event_logs")
    .select("id,severity,category,title,message,details,occurred_at")
    .gte("occurred_at", jerusalemDayBounds(from))
    .lte("occurred_at", jerusalemDayBounds(to, true))
    .order("occurred_at", { ascending: false })
    .limit(500);

  if (severity === "info" || severity === "warning" || severity === "error") {
    query = query.eq("severity", severity);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    from,
    to,
    logs: (data ?? []).map((row) => ({
      id: row.id,
      severity: row.severity,
      category: row.category,
      title: row.title,
      message: row.message,
      details: row.details,
      occurredAt: row.occurred_at,
      occurredAtIsrael: formatIsraelDateTime(row.occurred_at),
    })),
    generatedAt: new Date().toISOString(),
  });
}
