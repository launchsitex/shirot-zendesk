import { AppShell } from "@/components/sidebar";
import { TicketTrackingPageClient } from "@/components/ticket-tracking-page";
import { requirePageAccess } from "@/lib/auth/access";

export default async function TicketTrackingPage() {
  await requirePageAccess("ticket-tracking");

  return (
    <AppShell>
      <TicketTrackingPageClient />
    </AppShell>
  );
}
