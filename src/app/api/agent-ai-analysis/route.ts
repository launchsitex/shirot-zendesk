import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const FLAG_KEY = "ai_call_analysis";

const analyzeSchema = z.object({
  agentId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

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

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return {
      error: NextResponse.json({ error: "אין סשן פעיל" }, { status: 401 }),
    };
  }

  return { supabase, user, accessToken: session.access_token };
}

/** List active agents for the picker. */
export async function GET() {
  const access = await requireAiAccess();
  if ("error" in access) return access.error;

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

/** Analyze an agent's full day with Gemini. */
export async function POST(request: NextRequest) {
  const access = await requireAiAccess();
  if ("error" in access) return access.error;

  const parsed = analyzeSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const response = await fetch(`${baseUrl}/functions/v1/analyze-agent-day`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${access.accessToken}`,
      apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(parsed.data),
    cache: "no-store",
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    return NextResponse.json(
      {
        error: result.error ?? "analysis_failed",
        message: result.message ?? "ניתוח הנציג נכשל",
      },
      { status: response.status },
    );
  }

  return NextResponse.json(result);
}
