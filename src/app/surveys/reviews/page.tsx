import { AppShell } from "@/components/sidebar";
import { requirePageAccess } from "@/lib/auth/access";
import { SurveyGoogleReviewsClient } from "@/components/survey-google-reviews-client";

export default async function SurveyReviewsPage() {
  await requirePageAccess("surveys-reviews");
  return (
    <AppShell>
      <SurveyGoogleReviewsClient />
    </AppShell>
  );
}
