import { AppShell } from "@/components/sidebar";
import { requireAdmin } from "@/lib/auth/access";
import { UsersManagementClient } from "./users-management-client";

export default async function UsersPage() {
  await requireAdmin();

  return (
    <AppShell>
      <UsersManagementClient />
    </AppShell>
  );
}
