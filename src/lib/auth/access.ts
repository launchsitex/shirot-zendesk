import { redirect } from "next/navigation";
import {
  canAccessPage,
  getHomeHref,
  resolveAllowedPages,
  type AppPageId,
  type AppProfile,
  type AppRole,
} from "@/lib/app-pages";
import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/supabase/server";

export async function getCurrentProfile(): Promise<AppProfile | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("id, display_name, role, department_id, allowed_pages")
    .eq("id", user.id)
    .maybeSingle();

  if (!data) return null;

  const role = data.role as AppRole;
  return {
    id: data.id,
    displayName: data.display_name,
    role,
    departmentId: data.department_id,
    allowedPages: resolveAllowedPages(role, data.allowed_pages),
  };
}

export async function requirePageAccess(pageId: AppPageId) {
  if (!isSupabaseConfigured()) return null;
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!canAccessPage(profile, pageId)) {
    const home = getHomeHref(profile);
    const homePageId = home.replace(/^\//, "") as AppPageId;
    if (homePageId === pageId) {
      redirect("/login");
    }
    redirect(home);
  }
  return profile;
}

export async function requireAdmin() {
  if (!isSupabaseConfigured()) return null;
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "admin") redirect(getHomeHref(profile));
  return profile;
}
