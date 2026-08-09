import { OpenTicketsPageClient } from "@/components/open-tickets-page";
import { AppShell } from "@/components/sidebar";
import { requirePageAccess } from "@/lib/auth/access";

export default async function OpenTicketsPage() {
  await requirePageAccess("ticket-tracking-open");

  return (
    <AppShell>
      <OpenTicketsPageClient />
    </AppShell>
  );
}
