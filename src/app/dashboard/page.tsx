import { DashboardClient } from "@/components/dashboard-client";
import { AppShell } from "@/components/sidebar";

export default function DashboardPage() {
  return (
    <AppShell>
      <DashboardClient />
    </AppShell>
  );
}
