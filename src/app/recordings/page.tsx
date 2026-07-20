import { RecordingsPage } from "@/components/recordings-page";
import { Sidebar } from "@/components/sidebar";

export default function RecordingsRoute() {
  return (
    <>
      <Sidebar />
      <main className="min-h-screen p-4 pt-20 lg:mr-[238px] lg:p-8">
        <RecordingsPage />
      </main>
    </>
  );
}
