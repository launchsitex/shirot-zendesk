import { AiAnalysisSettingsClient } from "@/components/ai-analysis-settings";
import { AircallSettingsClient } from "@/components/aircall-settings-client";
import { BusinessHoursSettingsClient } from "@/components/business-hours-settings";
import { MissedCallThresholdSettingsClient } from "@/components/missed-call-threshold-settings";
import { AppShell } from "@/components/sidebar";
import { requirePageAccess } from "@/lib/auth/access";

export default async function SettingsPage() {
  await requirePageAccess("settings");

  return (
    <AppShell>
      <div className="space-y-5">
        <AiAnalysisSettingsClient />
        <BusinessHoursSettingsClient />
        <MissedCallThresholdSettingsClient />
        <AircallSettingsClient />
      </div>
    </AppShell>
  );
}
