import { AfterHoursCallsPage } from "@/app/after-hours/after-hours-client";
import { AppShell } from "@/components/sidebar";
import { requirePageAccess } from "@/lib/auth/access";

export default async function AfterHoursPage() {
  await requirePageAccess("after-hours");

  return (
    <AppShell>
      <AfterHoursCallsPage />
    </AppShell>
  );
}
