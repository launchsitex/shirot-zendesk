import { NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/access";
import { canAccessPage } from "@/lib/app-pages";

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase אינו מחובר" }, { status: 400 });
  }
  const profile = await getCurrentProfile();
  if (!profile || !canAccessPage(profile, "surveys-reviews")) {
    return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("survey_responses")
    .select(
      "id, order_number, submitted_at, feedback_positive, feedback_negative, survey_pending_sends!pending_send_id(customer_name, phone), survey_branches!branch_id(name)",
    )
    .eq("score_branch", 5)
    .eq("score_coordination", 5)
    .eq("score_mover", 5)
    .eq("excluded_from_average", false)
    .is("google_review_requested_at", null)
    .is("google_review_skipped_at", null)
    .order("submitted_at", { ascending: false })
    .limit(1000);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []).map((row) => {
    const pending = Array.isArray(row.survey_pending_sends)
      ? row.survey_pending_sends[0]
      : row.survey_pending_sends;
    const branch = Array.isArray(row.survey_branches) ? row.survey_branches[0] : row.survey_branches;
    return {
      id: row.id,
      orderNumber: row.order_number,
      submittedAt: row.submitted_at,
      customerName: pending?.customer_name ?? "",
      phone: pending?.phone ?? "",
      branchName: branch?.name ?? "—",
      feedbackPositive: row.feedback_positive,
      feedbackNegative: row.feedback_negative,
    };
  });

  return NextResponse.json({ rows });
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase אינו מחובר" }, { status: 400 });
  }
  const profile = await getCurrentProfile();
  if (!profile || !canAccessPage(profile, "surveys-reviews")) {
    return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const id = body?.id;
  if (typeof id !== "string") {
    return NextResponse.json({ error: "נתונים לא תקינים" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("survey_responses")
    .update({ google_review_skipped_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
