import { NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/access";
import { canAccessPage } from "@/lib/app-pages";

const VALID_REASONS = ["error", "not_relevant"] as const;

export async function PATCH(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase אינו מחובר" }, { status: 400 });
  }
  const profile = await getCurrentProfile();
  if (!profile || !canAccessPage(profile, "surveys")) {
    return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const id = body?.id;
  const excluded = body?.excluded;
  const reason = body?.reason;
  if (typeof id !== "string" || typeof excluded !== "boolean") {
    return NextResponse.json({ error: "נתונים לא תקינים" }, { status: 400 });
  }
  if (excluded && !VALID_REASONS.includes(reason)) {
    return NextResponse.json({ error: "יש לבחור סיבת החרגה" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("survey_responses")
    .update({
      excluded_from_average: excluded,
      excluded_reason: excluded ? reason : null,
    })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
