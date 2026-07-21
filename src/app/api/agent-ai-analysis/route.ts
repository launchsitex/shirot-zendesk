import { NextRequest, NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const FLAG_KEY = "ai_call_analysis";

async function requireAiAccess() {
  if (!isSupabaseConfigured()) {
    return {
      error: NextResponse.json({ error: "Supabase אינו מחובר" }, { status: 400 }),
    };
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      error: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") {
    return {
      error: NextResponse.json({ error: "forbidden" }, { status: 403 }),
    };
  }

  const { data: flag } = await supabase
    .from("app_feature_flags")
    .select("enabled")
    .eq("key", FLAG_KEY)
    .maybeSingle();
  if (!flag?.enabled) {
    return {
      error: NextResponse.json({ error: "feature_disabled" }, { status: 403 }),
    };
  }

  return { supabase, user };
}

/** List active agents, analysis history, or a single saved analysis. */
export async function GET(request: NextRequest) {
  const access = await requireAiAccess();
  if ("error" in access) return access.error;

  const view = request.nextUrl.searchParams.get("view");
  const analysisId = request.nextUrl.searchParams.get("analysisId");

  if (analysisId) {
    const { data, error } = await access.supabase
      .from("agent_day_analyses")
      .select(
        "id,agent_id,agent_name,analysis_date,analyzed_at,overall_score,calls_analyzed,skipped_recordings,stats,status_summary,analyzed_calls,analysis,model",
      )
      .eq("id", analysisId)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ record: data });
  }

  if (view === "history") {
    const { data, error } = await access.supabase
      .from("agent_day_analyses")
      .select(
        "id,agent_id,agent_name,analysis_date,analyzed_at,overall_score,calls_analyzed,skipped_recordings,model",
      )
      .order("analyzed_at", { ascending: false })
      .limit(50);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ history: data ?? [] });
  }

  const { data, error } = await access.supabase
    .from("agents")
    .select("id,name,departments(name)")
    .eq("active", true)
    .order("name");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    agents: (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      departmentName:
        (row.departments as unknown as { name?: string } | null)?.name ?? null,
    })),
  });
}

// The analysis POST goes straight from the browser to the Supabase edge
// function `analyze-agent-day` — proxying it here hit the web host's proxy
// timeout on long analyses and returned an HTML error page.
