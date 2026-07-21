import { redirect } from "next/navigation";
import { AgentAiAnalysisClient } from "@/app/agent-ai-analysis/agent-ai-analysis-client";
import { AppShell } from "@/components/sidebar";
import { getHomeHref } from "@/lib/app-pages";
import { getCurrentProfile, requirePageAccess } from "@/lib/auth/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function AgentAiAnalysisPage() {
  await requirePageAccess("agent-ai-analysis");

  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") {
    redirect(getHomeHref(profile));
  }

  const supabase = await createSupabaseServerClient();
  const { data: flag } = await supabase
    .from("app_feature_flags")
    .select("enabled")
    .eq("key", "ai_call_analysis")
    .maybeSingle();

  if (!flag?.enabled) {
    redirect("/settings");
  }

  return (
    <AppShell>
      <AgentAiAnalysisClient />
    </AppShell>
  );
}
