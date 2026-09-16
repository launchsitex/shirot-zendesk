import { NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/access";
import { canAccessPage } from "@/lib/app-pages";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EDGE_FUNCTION_URL =
  "https://whshmunahkugkmgxkvvw.supabase.co/functions/v1/priority-pull-now";

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase אינו מחובר" }, { status: 400 });
  }
  const profile = await getCurrentProfile();
  if (!profile || !canAccessPage(profile, "surveys")) {
    return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
  }

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
  const { data: secret, error: secretError } = (await supabase.rpc("get_priority_pull_secret")) as {
    data: string | null;
    error: unknown;
  };
  if (secretError || !secret) {
    return NextResponse.json({ error: "לא ניתן לטעון פרטי חיבור לפריוריטי" }, { status: 500 });
  }

  try {
    const response = await fetch(EDGE_FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-priority-secret": secret },
      body: JSON.stringify({ dateFrom, dateTo, includeServiceCalls }),
    });
    const payload = await response.json();
    if (!response.ok) {
      return NextResponse.json({ error: payload.error ?? "המשיכה מפריוריטי נכשלה" }, { status: response.status });
    }
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "שגיאת רשת מול פריוריטי" },
      { status: 502 },
    );
  }
}
