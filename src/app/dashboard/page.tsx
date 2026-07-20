import { DashboardClient } from "@/components/dashboard-client";
import { AppShell } from "@/components/sidebar";
import { requirePageAccess } from "@/lib/auth/access";

export default async function DashboardPage() {
  await requirePageAccess("dashboard");

  return (
    <AppShell>
      <DashboardClient />
    </AppShell>
  );
}
