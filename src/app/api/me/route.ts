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
          "ai-analysis",
          "agent-ai-analysis",
          "system-logs",
          "settings",
          "users",
        ],
      },
      featureFlags: { aiCallAnalysis: false },
    });
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [{ data, error }, flagResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, display_name, role, department_id, allowed_pages")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("app_feature_flags")
      .select("enabled")
      .eq("key", "ai_call_analysis")
      .maybeSingle(),
  ]);

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
    featureFlags: {
      aiCallAnalysis: Boolean(flagResult.data?.enabled),
    },
  });
}
