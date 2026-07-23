import { AppShell } from "@/components/sidebar";
import { SettingsTabs } from "@/components/settings-tabs";
import { requirePageAccess } from "@/lib/auth/access";

export default async function SettingsPage() {
  await requirePageAccess("settings");

  return (
    <AppShell>
      <SettingsTabs />
    </AppShell>
  );
}
