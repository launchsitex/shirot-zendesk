import { WaWallboardClient } from "@/components/wa-wallboard-client";
import { requirePageAccess } from "@/lib/auth/access";

export default async function WaDashboardTvPage() {
  await requirePageAccess("wa-dashboard-tv");
  return <WaWallboardClient />;
}
