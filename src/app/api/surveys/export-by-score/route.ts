import { NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/access";
import { canAccessPage } from "@/lib/app-pages";

export async function GET(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase אינו מחובר" }, { status: 400 });
  }
  const profile = await getCurrentProfile();
  if (!profile || !canAccessPage(profile, "surveys")) {
    return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
  }

  const minScoreParam = new URL(request.url).searchParams.get("minScore");
  const minScore = Number(minScoreParam);
  if (!Number.isFinite(minScore) || minScore < 1 || minScore > 5) {
    return NextResponse.json({ error: "ציון מינימלי לא תקין" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("survey_responses")
    .select(
      "order_number, score_branch, score_coordination, score_mover, submitted_at, survey_pending_sends!pending_send_id(customer_name, phone)",
    )
    .order("submitted_at", { ascending: false })
    .limit(2000);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? [])
    .map((row) => {
      const pending = Array.isArray(row.survey_pending_sends)
        ? row.survey_pending_sends[0]
        : row.survey_pending_sends;
      const avgScore = (row.score_branch + row.score_coordination + row.score_mover) / 3;
      return {
        customerName: pending?.customer_name ?? "",
        phone: pending?.phone ?? "",
        orderNumber: row.order_number,
        avgScore,
        scoreBranch: row.score_branch,
        scoreCoordination: row.score_coordination,
        scoreMover: row.score_mover,
        submittedAt: row.submitted_at,
      };
    })
    .filter((row) => row.avgScore >= minScore)
    .sort((a, b) => b.avgScore - a.avgScore);

  return NextResponse.json({ rows });
}
