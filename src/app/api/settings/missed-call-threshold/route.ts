import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const saveSchema = z.object({
  thresholdSeconds: z.number().int().min(0).max(3600),
});

async function loadThreshold(): Promise<{ thresholdSeconds: number }> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
    });
  }

  const { data, error } = await supabase
    .from("missed_call_settings")
    .select("short_no_answer_threshold_seconds")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    throw new Response(JSON.stringify({ error: error.message }), {
      status: 500,
    });
  }

  return { thresholdSeconds: data?.short_no_answer_threshold_seconds ?? 60 };
}

export async function GET() {
  try {
    const result = await loadThreshold();
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = saveSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { error: upsertError } = await supabase
    .from("missed_call_settings")
    .upsert(
      {
        id: 1,
        short_no_answer_threshold_seconds: parsed.data.thresholdSeconds,
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      },
      { onConflict: "id" },
    );
  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  try {
    const result = await loadThreshold();
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "reload_failed" }, { status: 500 });
  }
}
