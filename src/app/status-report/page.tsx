import { AppShell } from "@/components/sidebar";
import { requirePageAccess } from "@/lib/auth/access";
import { StatusReportClient } from "./status-report-client";

export default async function StatusReportPage() {
  await requirePageAccess("status-report");

  return (
    <AppShell>
      <StatusReportClient />
    </AppShell>
  );
}
