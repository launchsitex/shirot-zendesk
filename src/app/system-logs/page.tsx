import { AppShell } from "@/components/sidebar";
import { requireAdmin } from "@/lib/auth/access";
import { SystemLogsClient } from "./system-logs-client";

export default async function SystemLogsPage() {
  await requireAdmin();

  return (
    <AppShell>
      <SystemLogsClient />
    </AppShell>
  );
}
