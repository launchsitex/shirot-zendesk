import { DashboardClient } from "@/components/dashboard-client";
import { Sidebar } from "@/components/sidebar";

export default function DashboardPage() {
  return (
    <>
      <Sidebar />
      <main className="min-h-screen p-4 pt-20 lg:mr-[238px] lg:p-6 xl:p-8">
        <DashboardClient />
      </main>
    </>
  );
}
