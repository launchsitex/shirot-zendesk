import { NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/access";
import { canAccessPage } from "@/lib/app-pages";

const SENDER = "RhityCity";
const INFOU_URL = "https://capi.inforu.co.il/api/v2/SMS/SendSms";
const PHONE_RE = /^0\d{8,9}$/;

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase אינו מחובר" }, { status: 400 });
  }
  const profile = await getCurrentProfile();
  if (!profile || !canAccessPage(profile, "surveys-reviews")) {
    return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  const branchId = body?.branchId;
  if (!query) {
    return NextResponse.json({ error: "יש להזין מספר הזמנה או טלפון" }, { status: 400 });
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

  const isPhone = PHONE_RE.test(query);
  let phone = isPhone ? query : "";
  let customerName = "לקוח";

  if (isPhone) {
    const { data: match } = await supabase
      .from("survey_pending_sends")
      .select("customer_name")
      .eq("phone", query)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (match?.customer_name) customerName = match.customer_name;
  } else {
    const { data: match, error: matchError } = await supabase
      .from("survey_pending_sends")
      .select("customer_name, phone")
      .eq("order_number", query)
      .maybeSingle();
    if (matchError) return NextResponse.json({ error: matchError.message }, { status: 500 });
    if (!match?.phone) {
      return NextResponse.json({ error: "לא נמצא מספר טלפון עבור מספר ההזמנה הזה" }, { status: 404 });
    }
    phone = match.phone;
    customerName = match.customer_name ?? customerName;
  }

  if (!phone) {
    return NextResponse.json({ error: "יש להזין מספר טלפון תקין או מספר הזמנה קיים" }, { status: 400 });
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

  const message = template.template_text
    .replaceAll("{שם_לקוח}", customerName)
    .replaceAll("{קישור}", link.url);
  const authHeader = "Basic " + Buffer.from(`${creds.username}:${creds.token}`).toString("base64");

  try {
    const response = await fetch(INFOU_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8", Authorization: authHeader },
      body: JSON.stringify({
        Data: {
          Message: message,
          Recipients: [{ Phone: phone, CustomerMessageID: `manual-${Date.now()}` }],
          Settings: { Sender: SENDER },
        },
      }),
    });
    const payload = await response.json().catch(() => null);
    if (response.ok && payload?.StatusId === 1) {
      return NextResponse.json({ ok: true, phone, customerName });
    }
    return NextResponse.json(
      { error: payload?.StatusDescription ?? payload?.DetailedDescription ?? `HTTP ${response.status}` },
      { status: 502 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "שגיאת רשת" },
      { status: 502 },
    );
  }
}
