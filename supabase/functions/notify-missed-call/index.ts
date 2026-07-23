import {
  authorizeSync,
  getAdminClient,
  jsonResponse,
} from "../_shared/zendesk.ts";

type UnknownRecord = Record<string, unknown>;

const DEFAULT_THRESHOLD_SECONDS = 60;
const RESEND_ENDPOINT = "https://api.resend.com/emails";

Deno.serve(async (request) => {
  if (request.method !== "POST") return jsonResponse({ error: "method" }, 405);

  const supabase = getAdminClient();
  if (!(await authorizeSync(request, supabase))) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  let body: UnknownRecord;
  try {
    body = (await request.json()) as UnknownRecord;
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const callId = String(body.callId ?? "").trim();
  if (!callId) return jsonResponse({ error: "call_id_required" }, 400);

  try {
    const sent = await handleMissedCall(supabase, callId);
    return jsonResponse({ ok: true, sent });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[notify-missed-call] failed", callId, message);
    return jsonResponse({ error: message }, 500);
  }
});

async function handleMissedCall(
  supabase: ReturnType<typeof getAdminClient>,
  callId: string,
): Promise<boolean> {
  const { data: call } = await supabase
    .from("calls")
    .select(
      "id,status,direction,customer_number,started_at,duration_seconds,talk_time_seconds,wait_time_seconds,department_id,departments(name)",
    )
    .eq("id", callId)
    .maybeSingle();

  if (!call || call.status !== "missed" || call.direction !== "inbound") {
    return false;
  }

  const { data: settings } = await supabase
    .from("missed_call_settings")
    .select("short_no_answer_threshold_seconds")
    .eq("id", 1)
    .maybeSingle();
  const thresholdSeconds = Number(
    settings?.short_no_answer_threshold_seconds ?? DEFAULT_THRESHOLD_SECONDS,
  );

  const waitSeconds = inboundWaitSeconds(call);
  // Same rule as the rest of the app: a customer who hung up before the
  // configured threshold is "missed_short", not a real missed call.
  if (
    thresholdSeconds > 0 &&
    waitSeconds !== null &&
    waitSeconds <= thresholdSeconds
  ) {
    return false;
  }

  const { data: recipients } = await supabase
    .from("missed_call_notification_recipients")
    .select("email");
  const emails = (recipients ?? [])
    .map((row) => String(row.email ?? "").trim())
    .filter(Boolean);
  if (!emails.length) return false;

  const resendKey = Deno.env.get("RESEND_API_KEY")?.trim();
  if (!resendKey) {
    console.error("[notify-missed-call] RESEND_API_KEY is not configured");
    return false;
  }

  const { data: notificationSettings } = await supabase
    .from("missed_call_notification_settings")
    .select("from_email")
    .eq("id", 1)
    .maybeSingle();
  const fromEmail = notificationSettings?.from_email?.trim();
  if (!fromEmail) {
    console.error(
      "[notify-missed-call] no sender address configured in Settings",
    );
    return false;
  }

  const departmentRecord = call.departments as { name?: string } | null;
  const departmentName = departmentRecord?.name ?? "ללא שיוך מחלקתי";

  const html = buildEmailHtml({
    departmentName,
    customerNumber: String(call.customer_number ?? "לא ידוע"),
    startedAt: String(call.started_at),
    waitSeconds: waitSeconds ?? 0,
  });

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `City Live <${fromEmail}>`,
      to: emails,
      subject: `שיחה שלא נענתה — ${departmentName}`,
      html,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`resend_error:${response.status}:${text.slice(0, 300)}`);
  }
  return true;
}

/** Mirrors src/lib/metrics.ts inboundWaitSeconds() so the threshold check
 * behaves identically here and in the UI. */
function inboundWaitSeconds(call: UnknownRecord): number | null {
  if (call.direction !== "inbound" || call.status === "in_progress") {
    return null;
  }
  const wait = Number(call.wait_time_seconds ?? 0);
  if (wait > 0) return wait;
  if (call.status === "missed") {
    return Math.max(0, Number(call.duration_seconds ?? 0));
  }
  const duration = Number(call.duration_seconds ?? 0);
  const talk = Number(call.talk_time_seconds ?? 0);
  if (duration > talk) return Math.max(0, duration - talk);
  return 0;
}

function formatClock(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildEmailHtml(data: {
  departmentName: string;
  customerNumber: string;
  startedAt: string;
  waitSeconds: number;
}) {
  const time = new Date(data.startedAt).toLocaleString("he-IL", {
    timeZone: "Asia/Jerusalem",
    dateStyle: "short",
    timeStyle: "short",
  });

  const row = (label: string, value: string, valueStyle = "") => `
    <tr>
      <td style="padding:10px 0 2px 0;color:#718087;font-size:12px;font-family:Arial,Helvetica,sans-serif;">${escapeHtml(label)}</td>
    </tr>
    <tr>
      <td style="padding:0 0 14px 0;border-bottom:1px solid #eef1f2;color:#17242d;font-size:16px;font-weight:bold;font-family:Arial,Helvetica,sans-serif;${valueStyle}">${value}</td>
    </tr>`;

  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>שיחה שלא נענתה</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f6f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f7;padding:32px 16px;">
<tr>
<td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
<tr>
<td style="background-color:#c8434c;padding:20px 28px;font-family:Arial,Helvetica,sans-serif;">
<span style="color:#ffffff;font-size:18px;font-weight:bold;">📞 שיחה שלא נענתה</span>
</td>
</tr>
<tr>
<td style="padding:24px 28px 8px 28px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${row("מחלקה", escapeHtml(data.departmentName))}
${row("מספר לקוח", escapeHtml(data.customerNumber), "direction:ltr;text-align:right;")}
${row("זמן המתנה על הקו", formatClock(data.waitSeconds), "color:#c8434c;font-size:20px;")}
${row("מועד השיחה", escapeHtml(time))}
</table>
</td>
</tr>
<tr>
<td style="background-color:#f8fafb;padding:16px 28px;color:#a3adb1;font-size:12px;text-align:center;font-family:Arial,Helvetica,sans-serif;">
City Live · התראה אוטומטית על שיחה שלא נענתה
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>`;
}
