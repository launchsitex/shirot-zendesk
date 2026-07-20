import { redirect } from "next/navigation";
import { AircallSettingsClient } from "@/components/aircall-settings-client";
import { AppShell } from "@/components/sidebar";
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
    <AppShell>
      <AircallSettingsClient />
    </AppShell>
  );
}
