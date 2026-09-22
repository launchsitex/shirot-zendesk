import {
  authorizeSync,
  getAdminClient,
  jsonResponse,
} from "../_shared/zendesk.ts";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

// Same "מעל 10 דק'" threshold already used across the WA screens
// (WAITING_TIER_MINUTES in src/lib/wa-dashboard.ts) — not a separate
// number to keep track of.
const DEFAULT_THRESHOLD_SECONDS = 10 * 60;

type AlertRow = {
  ticket_id: string;
  customer_name: string | null;
  agent_name: string | null;
  department_name: string | null;
  effective_waiting_since: string;
  wait_seconds: number;
};

Deno.serve(async (request) => {
  if (request.method !== "POST") return jsonResponse({ error: "method" }, 405);

  const supabase = getAdminClient();
  if (!(await authorizeSync(request, supabase))) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  try {
    const sent = await checkAndNotify(supabase);
    return jsonResponse({ ok: true, sent });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[notify-wa-waiting] failed", message);
    return jsonResponse({ error: message }, 500);
  }
});

async function checkAndNotify(
  supabase: ReturnType<typeof getAdminClient>,
): Promise<number> {
  const { data, error } = await supabase.rpc("find_wa_waiting_alerts", {
    p_threshold_seconds: DEFAULT_THRESHOLD_SECONDS,
  });
  if (error) throw new Error(`find_wa_waiting_alerts: ${error.message}`);
  const rows = (data ?? []) as AlertRow[];
  if (rows.length === 0) return 0;

  const { data: recipients } = await supabase
    .from("missed_call_notification_recipients")
    .select("email");
  const emails = (recipients ?? [])
    .map((row) => String(row.email ?? "").trim())
    .filter(Boolean);
  if (!emails.length) return 0;

  const resendKey = Deno.env.get("RESEND_API_KEY")?.trim();
  if (!resendKey) {
    console.error("[notify-wa-waiting] RESEND_API_KEY is not configured");
    return 0;
  }

  const { data: notificationSettings } = await supabase
    .from("missed_call_notification_settings")
    .select("from_email")
    .eq("id", 1)
    .maybeSingle();
  const fromEmail = notificationSettings?.from_email?.trim();
  if (!fromEmail) {
    console.error("[notify-wa-waiting] no sender address configured in Settings");
    return 0;
  }

  const html = buildEmailHtml(rows);
  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `City Live <${fromEmail}>`,
      to: emails,
      subject: rows.length === 1
        ? `פנייה ממתינה לתגובה — ${rows[0].department_name ?? "ללא מחלקה"}`
        : `${rows.length} פניות ממתינות לתגובה מעל 10 דק'`,
      html,
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`resend_error:${response.status}:${text.slice(0, 300)}`);
  }

  // Stamp each ticket so this exact wait is never emailed twice — a new
  // wait (agent replied, customer wrote again) gets a new
  // effective_waiting_since and alerts again on its own.
  for (const row of rows) {
    await supabase
      .from("zendesk_tickets")
      .update({ waiting_alert_sent_for: row.effective_waiting_since })
      .eq("id", row.ticket_id);
  }

  return rows.length;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatClock(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  const parts = [minutes, remaining].map((v) => String(v).padStart(2, "0"));
  return hours ? `${String(hours).padStart(2, "0")}:${parts.join(":")}` : parts.join(":");
}

function buildEmailHtml(rows: AlertRow[]) {
  const items = rows
    .map((row) => `
      <tr>
        <td style="padding:10px 0 2px 0;color:#718087;font-size:12px;font-family:Arial,Helvetica,sans-serif;">
          פנייה #${escapeHtml(row.ticket_id)} · ${escapeHtml(row.department_name ?? "ללא מחלקה")}
        </td>
      </tr>
      <tr>
        <td style="padding:0 0 14px 0;border-bottom:1px solid #eef1f2;font-family:Arial,Helvetica,sans-serif;">
          <span style="color:#17242d;font-size:15px;font-weight:bold;">${escapeHtml(row.customer_name ?? "לקוח")}</span>
          <span style="color:#718087;font-size:13px;"> · ${escapeHtml(row.agent_name ?? "ללא שיוך נציג")}</span>
          <br/>
          <span style="color:#c8434c;font-size:18px;font-weight:bold;">ממתין ${formatClock(row.wait_seconds)}</span>
        </td>
      </tr>`)
    .join("");

  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>פניות ממתינות לתגובה</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f6f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f7;padding:32px 16px;">
<tr>
<td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
<tr>
<td style="background-color:#c8434c;padding:20px 28px;font-family:Arial,Helvetica,sans-serif;">
<span style="color:#ffffff;font-size:18px;font-weight:bold;">💬 ${rows.length} ${rows.length === 1 ? "פנייה ממתינה" : "פניות ממתינות"} לתגובה מעל 10 דק'</span>
</td>
</tr>
<tr>
<td style="padding:24px 28px 8px 28px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${items}
</table>
</td>
</tr>
<tr>
<td style="background-color:#f8fafb;padding:16px 28px;color:#a3adb1;font-size:12px;text-align:center;font-family:Arial,Helvetica,sans-serif;">
City Live · התראה אוטומטית על פניות WhatsApp שממתינות לתגובה
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>`;
}
