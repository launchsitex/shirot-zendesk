import { NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/access";
import { canAccessPage } from "@/lib/app-pages";

async function requireAccess() {
  if (!isSupabaseConfigured()) {
    return { error: NextResponse.json({ error: "Supabase אינו מחובר" }, { status: 400 }) };
  }
  const profile = await getCurrentProfile();
  if (!profile || !canAccessPage(profile, "surveys")) {
    return { error: NextResponse.json({ error: "אין הרשאה" }, { status: 403 }) };
  }
  return { profile };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET() {
  const auth = await requireAccess();
  if (auth.error) return auth.error;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("survey_priority_pull_requests")
    .select(
      "id, date_from, date_to, include_service_calls, status, inserted_count, matched_count, result_summary, error_message, created_at, processed_at",
    )
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ requests: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireAccess();
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => null);
  const dateFrom = body?.dateFrom;
  const dateTo = body?.dateTo;
  const includeServiceCalls = body?.includeServiceCalls === true;
  if (typeof dateFrom !== "string" || typeof dateTo !== "string" || !DATE_RE.test(dateFrom) || !DATE_RE.test(dateTo)) {
    return NextResponse.json({ error: "טווח תאריכים לא תקין" }, { status: 400 });
  }
  if (dateFrom > dateTo) {
    return NextResponse.json({ error: "תאריך ההתחלה חייב להיות לפני תאריך הסיום" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("survey_priority_pull_requests").insert({
    date_from: dateFrom,
    date_to: dateTo,
    include_service_calls: includeServiceCalls,
    status: "pending",
    requested_by: auth.profile.id,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
