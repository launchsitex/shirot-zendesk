import { redirect } from "next/navigation";
import { AircallSettingsClient } from "@/components/aircall-settings-client";
import { Sidebar } from "@/components/sidebar";
import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/supabase/server";

export default async function SettingsPage() {
  if (isSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect("/login");
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (profile?.role !== "admin") redirect("/dashboard");
  }

  return (
    <>
      <Sidebar />
      <main className="min-h-screen p-4 pt-20 lg:mr-[238px] lg:p-8">
        <AircallSettingsClient />
      </main>
    </>
  );
}
