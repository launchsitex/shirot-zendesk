import { AppShell } from "@/components/sidebar";
import { SalesTransfersPageClient } from "@/components/sales-transfers-page";
import { requirePageAccess } from "@/lib/auth/access";

export default async function SalesTransfersPage() {
  await requirePageAccess("sales-transfers");

  return (
    <AppShell>
      <SalesTransfersPageClient />
    </AppShell>
  );
}
