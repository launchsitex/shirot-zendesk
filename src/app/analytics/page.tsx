import { AnalyticsReports } from "@/components/section-pages";
import { Sidebar } from "@/components/sidebar";

export default function AnalyticsPage() {
  return (
    <>
      <Sidebar />
      <main className="min-h-screen p-4 pt-20 lg:mr-[238px] lg:p-8">
        <AnalyticsReports />
      </main>
    </>
  );
}
