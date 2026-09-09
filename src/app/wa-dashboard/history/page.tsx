import { Suspense } from "react";
import { AppShell } from "@/components/sidebar";
import { WaHistoryPageClient } from "@/components/wa-history-page";
import { requirePageAccess } from "@/lib/auth/access";

export default async function WaHistoryPage() {
  await requirePageAccess("wa-dashboard-history");

  return (
    <AppShell>
      {/* The client reads ?from=&to=&department= from the URL, which needs a boundary. */}
      <Suspense>
        <WaHistoryPageClient />
      </Suspense>
    </AppShell>
  );
}
