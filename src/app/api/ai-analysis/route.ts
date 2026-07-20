import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDepartmentScope } from "@/lib/auth/department-scope";
import { formatPhoneDisplay, phoneSearchText } from "@/lib/phone";
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

  const { data, error } = await access.supabase
    .from("call_recordings")
    .select(
      "id,call_id,ticket_id,recording_type,duration_seconds,created_at,calls(customer_number,department_id,agents!agent_id(name),departments(name))",
    )
    .order("created_at", { ascending: false })
    .limit(800);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const digits = phone.replace(/\D/g, "");
  const recordings: CallRecording[] = (data ?? [])
    .map((row) => {
      const call = row.calls as unknown as {
        customer_number: string;
        department_id: string | null;
        agents: { name: string } | null;
        departments: { name: string } | null;
      };
      return {
        id: row.id,
        callId: row.call_id,
        ticketId: row.ticket_id,
        recordingType: row.recording_type,
        durationSeconds: row.duration_seconds,
        createdAt: row.created_at,
        agentName: call?.agents?.name ?? null,
        departmentId: call?.department_id ?? null,
        departmentName: call?.departments?.name ?? null,
        customerNumber: call?.customer_number ?? "",
      };
    })
    .filter((recording) => {
      if (departmentScope && recording.departmentId !== departmentScope) {
        return false;
      }
      return phoneSearchText(recording.customerNumber).includes(digits);
    })
    .slice(0, 40);

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
