import { AgentsTeams } from "@/components/section-pages";
import { AppShell } from "@/components/sidebar";
import { requirePageAccess } from "@/lib/auth/access";

export default async function AgentsPage() {
  await requirePageAccess("agents");

  return (
    <AppShell>
      <AgentsTeams />
    </AppShell>
  );
}
