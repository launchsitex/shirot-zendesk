import {
  authorizeSync,
  getAdminClient,
  jsonResponse,
} from "../_shared/zendesk.ts";
import { buildEmailHtml, formatHebrewDate, type ReportRow } from "./email.ts";

/**
 * The daily "יעדים לנציגים" email.
 *
 * Cron fires this twice a day — 12:30 and 13:30 UTC — because pg_cron has no
 * timezone and 15:30 in Jerusalem is 12:30 UTC in summer (IDT) and 13:30 UTC in
 * winter (IST). Whichever run lands on or after the configured local time sends
 * the mail and stamps last_sent_on; the other run finds the stamp (or is still
 * before the cutoff) and does nothing. Passing {"force":true} bypasses both
 * guards for a manual test send.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const TIME_ZONE = "Asia/Jerusalem";

Deno.serve(async (request) => {
  if (request.method !== "POST") return jsonResponse({ error: "method" }, 405);

  const supabase = getAdminClient();
  if (!(await authorizeSync(request, supabase))) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // An empty body is the normal cron invocation.
  }
  const force = body.force === true;

  try {
    const result = await runReport(supabase, force);
    return jsonResponse({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[agent-targets-report] failed", message);
    await supabase.from("system_event_logs").insert({
      severity: "error",
      category: "agent-targets-report",
      title: "שליחת דוח היעדים היומי נכשלה",
      message,
    });
    return jsonResponse({ error: message }, 500);
  }
});

async function runReport(
  supabase: ReturnType<typeof getAdminClient>,
  force: boolean,
) {
  const { data: settings } = await supabase
    .from("agent_target_report_settings")
    .select("enabled,send_local_time,last_sent_on")
    .eq("id", 1)
    .maybeSingle();

  if (!settings?.enabled && !force) return { sent: false, reason: "disabled" };

  const sendLocalTime = String(settings?.send_local_time ?? "15:30").slice(0, 5);
  const now = new Date();
  const today = jerusalemDate(now);

  if (!force) {
    if (settings?.last_sent_on === today) {
      return { sent: false, reason: "already_sent_today" };
    }
    if (jerusalemMinutes(now) < toMinutes(sendLocalTime)) {
      return { sent: false, reason: "before_cutoff" };
    }
  }

  const from = jerusalemInstant(today, "00:00");
  const to = jerusalemInstant(today, sendLocalTime);

  const { data, error } = await supabase.rpc("agent_target_report", {
    p_from: from,
    p_to: to,
  });
  if (error) throw new Error(`report_query:${error.message}`);

  const rows = (data ?? []) as ReportRow[];

  const { data: recipientRows } = await supabase
    .from("agent_target_report_recipients")
    .select("email");
  const recipients = (recipientRows ?? [])
    .map((row) => String(row.email ?? "").trim())
    .filter(Boolean);
  if (!recipients.length) return { sent: false, reason: "no_recipients" };

  const resendKey = Deno.env.get("RESEND_API_KEY")?.trim();
  if (!resendKey) throw new Error("RESEND_API_KEY is not configured");

  // Same verified sender as the missed-call alerts — one address to maintain.
  const { data: sender } = await supabase
    .from("missed_call_notification_settings")
    .select("from_email")
    .eq("id", 1)
    .maybeSingle();
  const fromEmail = sender?.from_email?.trim();
  if (!fromEmail) throw new Error("no sender address configured in Settings");

  const html = buildEmailHtml(rows, today, sendLocalTime);

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `City Live <${fromEmail}>`,
      to: recipients,
      subject: `יעדים לנציגים — ${formatHebrewDate(today)} עד ${sendLocalTime}`,
      html,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`resend_error:${response.status}:${text.slice(0, 300)}`);
  }

  await supabase
    .from("agent_target_report_settings")
    .update({ last_sent_on: today })
    .eq("id", 1);

  await supabase.from("system_event_logs").insert({
    severity: "info",
    category: "agent-targets-report",
    title: "דוח היעדים היומי נשלח",
    message: `${rows.length} שורות ל-${recipients.length} נמענים`,
    details: { date: today, cutoff: sendLocalTime, rows: rows.length },
  });

  return { sent: true, rows: rows.length, recipients: recipients.length };
}

// ------------------------------------------------------------ time helpers --

/** Mirrors src/lib/israel-time.ts jerusalemInstant(). */
function jerusalemInstant(date: string, timeOfDay: string): string {
  const [hours = "0", minutes = "0"] = timeOfDay.split(":");
  const wallClockUtc = Date.parse(
    `${date}T${hours.padStart(2, "0")}:${minutes.padStart(2, "0")}:00.000Z`,
  );
  let instant = wallClockUtc;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  for (let pass = 0; pass < 2; pass += 1) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(instant))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
    const representedAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    instant = wallClockUtc - (representedAsUtc - instant);
  }

  return new Date(instant).toISOString();
}

function jerusalemDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function jerusalemMinutes(now: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(
    parts.find((part) => part.type === "minute")?.value ?? 0,
  );
  return hour * 60 + minute;
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}
