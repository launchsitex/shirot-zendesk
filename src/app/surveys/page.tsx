import { AppShell } from "@/components/sidebar";
import { requirePageAccess } from "@/lib/auth/access";
import { SurveysOverview } from "@/components/surveys-overview";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function SurveysPage() {
  await requirePageAccess("surveys");
  const supabase = await createSupabaseServerClient();

  const [
    { data: scoreRows },
    { data: recentRows },
    { data: branches },
    { count: pendingCount },
    { count: sentCount },
  ] = await Promise.all([
    supabase
      .from("survey_responses")
      .select("score_branch, score_coordination, score_mover, branch_id")
      .limit(2000),
    supabase
      .from("survey_responses")
      .select(
        "id, order_number, score_branch, score_coordination, score_mover, feedback_positive, feedback_negative, submitted_at, survey_branches!branch_id(name)",
      )
      .order("submitted_at", { ascending: false })
      .limit(20),
    supabase.from("survey_branches").select("id, name"),
    supabase
      .from("survey_pending_sends")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase
      .from("survey_pending_sends")
      .select("id", { count: "exact", head: true })
      .eq("status", "sent"),
  ]);

  const normalizedRecentRows = (recentRows ?? []).map((row) => ({
    ...row,
    survey_branches: Array.isArray(row.survey_branches)
      ? (row.survey_branches[0] ?? null)
      : row.survey_branches,
  }));

  return (
    <AppShell>
      <SurveysOverview
        scoreRows={scoreRows ?? []}
        recentRows={normalizedRecentRows}
        branches={branches ?? []}
        pendingCount={pendingCount ?? 0}
        sentCount={sentCount ?? 0}
      />
    </AppShell>
  );
}
