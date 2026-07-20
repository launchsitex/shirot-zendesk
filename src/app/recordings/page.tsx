import { RecordingsPage } from "@/components/recordings-page";
import { AppShell } from "@/components/sidebar";
import { requirePageAccess } from "@/lib/auth/access";

export default async function RecordingsRoute() {
  await requirePageAccess("recordings");

  return (
    <AppShell>
      <RecordingsPage />
    </AppShell>
  );
}
