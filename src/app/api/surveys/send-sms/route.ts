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
  if (!profile || !canAccessPage(profile, "surveys-queue")) {
    return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const ids = Array.isArray(body?.ids)
    ? body.ids.filter((id: unknown): id is string => typeof id === "string")
    : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "לא נבחרו לקוחות" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();

  const { data: creds, error: credsError } = (await supabase
    .rpc("get_infou_credentials")
    .single()) as { data: { username: string; token: string } | null; error: unknown };
  if (credsError || !creds?.username || !creds?.token) {
    return NextResponse.json({ error: "לא ניתן לטעון פרטי חיבור ל-InfoU" }, { status: 500 });
  }

  const { data: rows, error: rowsError } = await supabase
    .from("survey_pending_sends")
    .select("id, phone, message_text")
    .in("id", ids)
    .eq("status", "pending");
  if (rowsError) {
    return NextResponse.json({ error: rowsError.message }, { status: 500 });
  }

  const authHeader = "Basic " + Buffer.from(`${creds.username}:${creds.token}`).toString("base64");

  const sentIds: string[] = [];
  const failed: { id: string; error: string }[] = [];

  for (const row of rows ?? []) {
    try {
      const response = await fetch(INFOU_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Authorization: authHeader,
        },
        body: JSON.stringify({
          Data: {
            Message: row.message_text,
            Recipients: [{ Phone: row.phone, CustomerMessageID: row.id }],
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
      .from("survey_pending_sends")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .in("id", sentIds);
  }

  return NextResponse.json({ ok: true, sent: sentIds.length, failed });
}
