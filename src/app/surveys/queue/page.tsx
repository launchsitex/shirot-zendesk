import { AppShell } from "@/components/sidebar";
import { requirePageAccess } from "@/lib/auth/access";
import { SurveyQueueClient } from "@/components/survey-queue-client";

export default async function SurveysQueuePage() {
  await requirePageAccess("surveys-queue");

  return (
    <AppShell>
      <SurveyQueueClient />
    </AppShell>
  );
}
