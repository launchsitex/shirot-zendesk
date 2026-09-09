import { Suspense } from "react";
import { AppShell } from "@/components/sidebar";
import { WaDashboardPageClient } from "@/components/wa-dashboard-page";
import { requirePageAccess } from "@/lib/auth/access";

export default async function WaDashboardPage() {
  await requirePageAccess("wa-dashboard");

  return (
    <AppShell>
      {/* The client reads ?department= from the URL, which needs a boundary. */}
      <Suspense>
        <WaDashboardPageClient />
      </Suspense>
    </AppShell>
  );
}
