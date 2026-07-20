import { CallsHistory } from "@/components/section-pages";
import { AppShell } from "@/components/sidebar";
import { requirePageAccess } from "@/lib/auth/access";

export default async function CallsPage() {
  await requirePageAccess("calls");

  return (
    <AppShell>
      <CallsHistory />
    </AppShell>
  );
}
