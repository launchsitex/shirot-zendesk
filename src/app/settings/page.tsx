import { AircallSettingsClient } from "@/components/aircall-settings-client";
import { AppShell } from "@/components/sidebar";
import { requirePageAccess } from "@/lib/auth/access";

export default async function SettingsPage() {
  await requirePageAccess("settings");

  return (
    <AppShell>
      <AircallSettingsClient />
    </AppShell>
  );
}
