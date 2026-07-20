import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Non-admin users assigned to a department only see that department's data.
 * Admins (and users without a department) see the full system.
 */
export async function getDepartmentScope(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("profiles")
    .select("role, department_id")
    .eq("id", userId)
    .maybeSingle();

  if (!data || data.role === "admin") return null;
  return data.department_id ?? null;
}
