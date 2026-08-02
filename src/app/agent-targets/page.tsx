import { AgentTargetsPageClient } from "@/components/agent-targets-page";
import { AppShell } from "@/components/sidebar";
import { requirePageAccess } from "@/lib/auth/access";

export default async function AgentTargetsPage() {
  await requirePageAccess("agent-targets");

  return (
    <AppShell>
      <AgentTargetsPageClient />
    </AppShell>
  );
}
