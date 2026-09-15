import { AppShell } from "@/components/sidebar";
import { requirePageAccess } from "@/lib/auth/access";
import { SurveyImportClient } from "@/components/survey-import-client";

export default async function SurveysImportPage() {
  await requirePageAccess("surveys-import");

  return (
    <AppShell>
      <SurveyImportClient />
    </AppShell>
  );
}
