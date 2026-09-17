import { AppShell } from "@/components/sidebar";
import { requirePageAccess } from "@/lib/auth/access";
import { SurveysOverview } from "@/components/surveys-overview";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function SurveysPage() {
  await requirePageAccess("surveys");
  const supabase = await createSupabaseServerClient();

  const [
    { data: responseRows },
    { data: branches },
    { data: movers },
    { count: pendingCount },
    { count: sentCount },
  ] = await Promise.all([
    supabase
      .from("survey_responses")
      .select(
        "id, order_number, branch_id, mover_id, agent_name, score_branch, score_coordination, score_mover, feedback_positive, feedback_negative, submitted_at, excluded_from_average, excluded_reason, survey_branches!branch_id(name), survey_movers!mover_id(name), survey_pending_sends!pending_send_id(customer_name, phone)",
      )
      .order("submitted_at", { ascending: false })
      .limit(5000),
    supabase.from("survey_branches").select("id, name"),
    supabase.from("survey_movers").select("id, name"),
    supabase
      .from("survey_pending_sends")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase
      .from("survey_pending_sends")
      .select("id", { count: "exact", head: true })
      .eq("status", "sent"),
  ]);

  const normalizedResponses = (responseRows ?? []).map((row) => ({
    ...row,
    survey_branches: Array.isArray(row.survey_branches) ? (row.survey_branches[0] ?? null) : row.survey_branches,
    survey_movers: Array.isArray(row.survey_movers) ? (row.survey_movers[0] ?? null) : row.survey_movers,
    survey_pending_sends: Array.isArray(row.survey_pending_sends)
      ? (row.survey_pending_sends[0] ?? null)
      : row.survey_pending_sends,
  }));

  return (
    <AppShell>
      <SurveysOverview
        responses={normalizedResponses}
        branches={branches ?? []}
        movers={movers ?? []}
        pendingCount={pendingCount ?? 0}
        sentCount={sentCount ?? 0}
      />
    </AppShell>
  );
}
