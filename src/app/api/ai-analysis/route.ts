import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDepartmentScope } from "@/lib/auth/department-scope";
import { formatPhoneDisplay } from "@/lib/phone";
import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/supabase/server";
import type { CallRecording } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const FLAG_KEY = "ai_call_analysis";

const analyzeSchema = z.object({
  recordingId: z.string().min(1),
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

/** Search recordings by customer phone number. */
export async function GET(request: NextRequest) {
  const access = await requireAiAccess();
  if ("error" in access) return access.error;

  const phone = request.nextUrl.searchParams.get("phone")?.trim() ?? "";
  if (phone.replace(/\D/g, "").length < 4) {
    return NextResponse.json(
      { error: "phone_required", message: "הזן לפחות 4 ספרות ממספר הטלפון" },
      { status: 400 },
    );
  }

  const departmentScope = await getDepartmentScope(
    access.supabase,
    access.user.id,
  );

  // Search must run in SQL against the full table, not an in-memory filter
  // over only the most-recently-created rows — otherwise a recording older
  // than the fetch window can never be found regardless of how exact the
  // phone match is. Reuses the same paginated-search RPC as /recordings.
  const { data, error } = await access.supabase.rpc(
    "list_call_recordings_page",
    {
      p_page: 1,
      p_page_size: 40,
      p_department_id: departmentScope,
      p_recording_type: null,
      p_search: phone,
    },
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const recordings: CallRecording[] = (
    (data as { recordings?: CallRecording[] } | null)?.recordings ?? []
  ).map((recording) => ({
    ...recording,
    customerNumber: recording.customerNumber ?? "",
  }));

  return NextResponse.json({
    phone: formatPhoneDisplay(phone),
    recordings,
  });
}

/** Analyze a selected recording with Gemini. */
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
  const response = await fetch(`${baseUrl}/functions/v1/analyze-recording`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${access.accessToken}`,
      apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ recordingId: parsed.data.recordingId }),
    cache: "no-store",
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    return NextResponse.json(
      {
        error: result.error ?? "analysis_failed",
        message: result.message ?? "ניתוח ההקלטה נכשל",
      },
      { status: response.status },
    );
  }

  return NextResponse.json(result);
}
