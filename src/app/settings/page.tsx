import { AircallSettingsClient } from "@/components/aircall-settings-client";
import { BusinessHoursSettingsClient } from "@/components/business-hours-settings";
import { AppShell } from "@/components/sidebar";
import { requirePageAccess } from "@/lib/auth/access";

export default async function SettingsPage() {
  await requirePageAccess("settings");

  return (
    <AppShell>
      <div className="space-y-5">
        <BusinessHoursSettingsClient />
        <AircallSettingsClient />
      </div>
    </AppShell>
  );
}
