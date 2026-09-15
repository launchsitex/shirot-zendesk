import { NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/access";
import { canAccessPage } from "@/lib/app-pages";

async function requireQueueAccess() {
  if (!isSupabaseConfigured()) {
    return { error: NextResponse.json({ error: "Supabase אינו מחובר" }, { status: 400 }) };
  }
  const profile = await getCurrentProfile();
  if (!profile || !canAccessPage(profile, "surveys-queue")) {
    return { error: NextResponse.json({ error: "אין הרשאה" }, { status: 403 }) };
  }
  return { profile };
}

export async function GET(request: Request) {
  const auth = await requireQueueAccess();
  if (auth.error) return auth.error;

  const status = new URL(request.url).searchParams.get("status") ?? "pending";
  const supabase = await createSupabaseServerClient();

  let query = supabase
    .from("survey_pending_sends")
    .select(
      "id, customer_name, phone, order_number, message_text, status, agent_name, sent_at, responded_at, created_at, survey_branches!branch_id(name), survey_movers!mover_id(name)",
    )
    .order("created_at", { ascending: false })
    .limit(500);

  if (status !== "all") query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ rows: data ?? [] });
}

export async function PATCH(request: Request) {
  const auth = await requireQueueAccess();
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => null);
  const ids = Array.isArray(body?.ids) ? body.ids.filter((id: unknown) => typeof id === "string") : [];
  const action = body?.action;
  if (ids.length === 0 || (action !== "mark_sent" && action !== "mark_pending")) {
    return NextResponse.json({ error: "בקשה לא תקינה" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const update =
    action === "mark_sent"
      ? { status: "sent" as const, sent_at: new Date().toISOString() }
      : { status: "pending" as const, sent_at: null };

  const { error } = await supabase.from("survey_pending_sends").update(update).in("id", ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, count: ids.length });
}
