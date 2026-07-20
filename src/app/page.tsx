import { redirect } from "next/navigation";
import { getHomeHref } from "@/lib/app-pages";
import { getCurrentProfile } from "@/lib/auth/access";
import { isSupabaseConfigured } from "@/lib/supabase/server";

export default async function Home() {
  if (!isSupabaseConfigured()) {
    redirect("/dashboard");
  }

  const profile = await getCurrentProfile();
  redirect(getHomeHref(profile));
}
