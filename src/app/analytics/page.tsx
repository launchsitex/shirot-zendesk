import { AnalyticsReports } from "@/components/section-pages";
import { AppShell } from "@/components/sidebar";
import { requirePageAccess } from "@/lib/auth/access";

export default async function AnalyticsPage() {
  await requirePageAccess("analytics");

  return (
    <AppShell>
      <AnalyticsReports />
    </AppShell>
  );
}
