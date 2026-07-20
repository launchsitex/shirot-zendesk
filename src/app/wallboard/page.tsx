import { WallboardClient } from "@/components/wallboard-client";
import { requirePageAccess } from "@/lib/auth/access";

export default async function WallboardPage() {
  await requirePageAccess("wallboard");
  return <WallboardClient />;
}
