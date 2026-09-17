import { NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/access";
import { canAccessPage } from "@/lib/app-pages";

const SENDER = "RhityCity";
const INFOU_URL = "https://capi.inforu.co.il/api/v2/SMS/SendSms";

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase אינו מחובר" }, { status: 400 });
  }
  const profile = await getCurrentProfile();
  if (!profile || !canAccessPage(profile, "surveys-reviews")) {
    return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const responseIds = Array.isArray(body?.responseIds)
    ? body.responseIds.filter((id: unknown): id is string => typeof id === "string")
    : [];
  const branchId = body?.branchId;
  if (responseIds.length === 0) {
    return NextResponse.json({ error: "לא נבחרו לקוחות" }, { status: 400 });
  }
  if (typeof branchId !== "string") {
    return NextResponse.json({ error: "לא נבחר סניף לקישור" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();

  const { data: link, error: linkError } = await supabase
    .from("survey_google_review_links")
    .select("url")
    .eq("branch_id", branchId)
    .single();
  if (linkError || !link?.url) {
    return NextResponse.json({ error: "לא הוגדר קישור גוגל לסניף שנבחר" }, { status: 400 });
  }

  const { data: template, error: templateError } = await supabase
    .from("survey_message_template")
    .select("template_text")
    .eq("id", "google_review")
    .single();
  if (templateError || !template) {
    return NextResponse.json({ error: "לא נמצאה תבנית הודעה לביקורת גוגל" }, { status: 500 });
  }

  const { data: creds, error: credsError } = (await supabase
    .rpc("get_infou_credentials")
    .single()) as { data: { username: string; token: string } | null; error: unknown };
  if (credsError || !creds?.username || !creds?.token) {
    return NextResponse.json({ error: "לא ניתן לטעון פרטי חיבור ל-InfoU" }, { status: 500 });
  }

  const { data: rows, error: rowsError } = await supabase
    .from("survey_responses")
    .select("id, order_number, survey_pending_sends!pending_send_id(customer_name, phone)")
    .in("id", responseIds)
    .eq("score_branch", 5)
    .eq("score_coordination", 5)
    .eq("score_mover", 5)
    .is("google_review_requested_at", null);
  if (rowsError) return NextResponse.json({ error: rowsError.message }, { status: 500 });

  const authHeader = "Basic " + Buffer.from(`${creds.username}:${creds.token}`).toString("base64");
  const sentIds: string[] = [];
  const failed: { id: string; error: string }[] = [];

  for (const row of rows ?? []) {
    const pending = Array.isArray(row.survey_pending_sends)
      ? row.survey_pending_sends[0]
      : row.survey_pending_sends;
    if (!pending?.phone) {
      failed.push({ id: row.id, error: "אין מספר טלפון" });
      continue;
    }
    const message = template.template_text
      .replaceAll("{שם_לקוח}", pending.customer_name ?? "")
      .replaceAll("{קישור}", link.url);
    try {
      const response = await fetch(INFOU_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Authorization: authHeader,
        },
        body: JSON.stringify({
          Data: {
            Message: message,
            Recipients: [{ Phone: pending.phone, CustomerMessageID: row.id }],
            Settings: { Sender: SENDER },
          },
        }),
      });
      const payload = await response.json().catch(() => null);
      if (response.ok && payload?.StatusId === 1) {
        sentIds.push(row.id);
      } else {
        failed.push({
          id: row.id,
          error: payload?.StatusDescription ?? payload?.DetailedDescription ?? `HTTP ${response.status}`,
        });
      }
    } catch (err) {
      failed.push({ id: row.id, error: err instanceof Error ? err.message : "שגיאת רשת" });
    }
  }

  if (sentIds.length > 0) {
    await supabase
      .from("survey_responses")
      .update({ google_review_requested_at: new Date().toISOString() })
      .in("id", sentIds);
  }

  return NextResponse.json({ ok: true, sent: sentIds.length, failed });
}
