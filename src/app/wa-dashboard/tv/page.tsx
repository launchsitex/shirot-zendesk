import { Suspense } from "react";
import { WaWallboardClient } from "@/components/wa-wallboard-client";
import { requirePageAccess } from "@/lib/auth/access";

export default async function WaDashboardTvPage() {
  await requirePageAccess("wa-dashboard-tv");
  // One wall screen per department: /wa-dashboard/tv?department=<id>. The
  // client reads that from the URL, which needs a boundary.
  return (
    <Suspense>
      <WaWallboardClient />
    </Suspense>
  );
}
