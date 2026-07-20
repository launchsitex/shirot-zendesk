import { NextResponse } from "next/server";
import { resolveAllowedPages, type AppRole } from "@/lib/app-pages";
import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/supabase/server";

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({
      profile: {
        id: "demo",
        displayName: "מצב הדגמה",
        role: "admin",
        departmentId: null,
        allowedPages: [
          "dashboard",
          "wallboard",
          "calls",
          "recordings",
          "agents",
          "analytics",
          "status-report",
          "system-logs",
          "settings",
          "users",
        ],
      },
    });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, role, department_id, allowed_pages")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "הפרופיל לא נמצא" },
      { status: 404 },
    );
  }

  const role = data.role as AppRole;
  return NextResponse.json({
    profile: {
      id: data.id,
      displayName: data.display_name,
      role,
      departmentId: data.department_id,
      allowedPages: resolveAllowedPages(role, data.allowed_pages),
    },
  });
}
