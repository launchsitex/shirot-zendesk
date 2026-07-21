import {
  getAdminClient,
  jsonResponse,
} from "../_shared/zendesk.ts";
import { fetchRecordingBytes } from "../_shared/recordings.ts";

type UnknownRecord = Record<string, unknown>;

const GEMINI_MODEL = "gemini-2.5-pro";
// Gemini inline request budget is ~20MB total; leave headroom for the prompt.
const MAX_TOTAL_AUDIO_BYTES = 17 * 1024 * 1024;
const MAX_RECORDING_SECONDS = 40 * 60;
const MAX_RECORDINGS = 12;

const DAY_ANALYSIS_PROMPT = `אתה מנהל מוקד שירות לקוחות ואספקות עם ניסיון של שנים רבות בחברות קמעונאיות בישראל (רהיטים / משלוחים / שירות).
אתה מבצע בקרת איכות יומית על נציג: מצורפים נתוני היום המלאים שלו וכן הקלטות של שיחות מאותו יום.

משימות:
1. האזן לכל ההקלטות המצורפות, אחת-אחת. כל הקלטה מסומנת במספר שיחה ופרטיה.
2. נתח גם את הנתונים המספריים של היום (כמות שיחות, נענו/לא נענו, זמני שיחה, סטטוסים).
3. כתוב ביקורת יומית מלאה ומקצועית, כמו מנהל מוקד מחמיר אבל הוגן שישב והאזין לכל השיחות.
4. לכל שיחה שהאזנת לה — תן משוב קצר וממוקד עם ציון.
5. זהה דפוסים חוזרים (לטובה ולרעה) לאורך היום, לא רק בשיחה בודדת.
6. תן תוכנית שיפור קונקרטית ויומיומית לנציג, עם משפטים לדוגמה.

חשוב: כל הטקסטים בעברית. אל תמציא שיחות שלא צורפו. אם צורפו רק חלק מההקלטות — ציין זאת בהערות המנהל. החזר JSON בלבד לפי הסכמה.`;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "authorization, x-client-info, apikey, content-type",
      },
    });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "method" }, 405);
  }

  const authorization = request.headers.get("authorization");
  const token = authorization?.replace(/^Bearer\s+/i, "");
  if (!token) return jsonResponse({ error: "unauthorized" }, 401);

  const supabase = getAdminClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(token);
  if (authError || !user) return jsonResponse({ error: "unauthorized" }, 401);

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") {
    return jsonResponse({ error: "forbidden" }, 403);
  }

  const { data: flag } = await supabase
    .from("app_feature_flags")
    .select("enabled")
    .eq("key", "ai_call_analysis")
    .maybeSingle();
  if (!flag?.enabled) {
    return jsonResponse({ error: "feature_disabled" }, 403);
  }

  const geminiKey = Deno.env.get("GEMINI_API_KEY")?.trim();
  if (!geminiKey) {
    return jsonResponse({ error: "gemini_key_missing" }, 500);
  }

  let body: UnknownRecord;
  try {
    body = (await request.json()) as UnknownRecord;
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const agentId = String(body.agentId ?? "").trim();
  const date = String(body.date ?? "").trim();
  if (!agentId) return jsonResponse({ error: "agent_id_required" }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return jsonResponse({ error: "date_required" }, 400);
  }

  const { data: agent } = await supabase
    .from("agents")
    .select("id,name")
    .eq("id", agentId)
    .maybeSingle();
  if (!agent) return jsonResponse({ error: "agent_not_found" }, 404);

  const dayStart = jerusalemBoundary(date, false);
  const dayEnd = jerusalemBoundary(date, true);

  const { data: calls, error: callsError } = await supabase
    .from("calls")
    .select(
      "id,direction,status,customer_number,started_at,ended_at,duration_seconds,talk_time_seconds,wait_time_seconds,departments(name)",
    )
    .eq("agent_id", agentId)
    .gte("started_at", dayStart)
    .lte("started_at", dayEnd)
    .order("started_at", { ascending: true });
  if (callsError) {
    return jsonResponse({ error: callsError.message }, 500);
  }
  if (!calls?.length) {
    return jsonResponse(
      {
        error: "no_calls",
        message: "לא נמצאו שיחות לנציג הזה בתאריך שנבחר.",
      },
      404,
    );
  }

  const stats = buildStats(calls);
  const statusSummary = await buildStatusSummary(
    supabase,
    agentId,
    dayStart,
    dayEnd,
  );

  const callIds = calls.map((call) => String(call.id));
  const { data: recordings } = await supabase
    .from("call_recordings")
    .select("id,call_id,recording_type,duration_seconds,created_at,recording_url,raw")
    .in("call_id", callIds)
    .eq("recording_type", "call")
    .order("created_at", { ascending: true });

  try {
    const { audioParts, includedCalls, skipped } = await collectAudio(
      supabase,
      recordings ?? [],
      calls,
    );

    if (!audioParts.length) {
      return jsonResponse(
        {
          error: "no_recordings",
          message:
            "יש שיחות ביום הזה אבל אין אף הקלטה זמינה לניתוח. נסה תאריך אחר.",
        },
        404,
      );
    }

    const analysis = await analyzeDayWithGemini(geminiKey, {
      agentName: String(agent.name ?? agentId),
      date,
      stats,
      statusSummary,
      includedCalls,
      skippedCount: skipped,
      audioParts,
    });

    return jsonResponse({
      ok: true,
      agent: { id: agent.id, name: agent.name },
      date,
      stats,
      statusSummary,
      analyzedCalls: includedCalls,
      skippedRecordings: skipped,
      analysis,
      model: GEMINI_MODEL,
      analyzedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const friendly =
      message.startsWith("recording_fetch_failed") ||
      message.includes("aircall_recording_missing") ||
      message.includes("aircall_api_credentials_missing") ||
      message.includes("aircall_call_fetch_failed")
        ? "לא הצלחנו להוריד חלק מקבצי ההקלטה מ-Aircall. נסה שוב."
        : message;
    return jsonResponse({ error: "analysis_failed", message: friendly }, 500);
  }
});

type CallRow = {
  id: string | number;
  direction: string;
  status: string;
  customer_number: string | null;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  talk_time_seconds: number | null;
  wait_time_seconds: number | null;
  departments?: { name?: string } | { name?: string }[] | null;
};

type RecordingRow = {
  id: string;
  call_id: string;
  recording_type?: string | null;
  duration_seconds: number | null;
  created_at: string;
  recording_url: string;
  raw: unknown;
};

type IncludedCall = {
  index: number;
  callId: string;
  time: string;
  direction: string;
  customerNumber: string;
  durationSeconds: number;
};

function buildStats(calls: CallRow[]) {
  const answered = calls.filter((call) => call.status === "answered");
  const missed = calls.filter((call) => call.status === "missed");
  const inbound = calls.filter((call) => call.direction === "inbound");
  const outbound = calls.filter((call) => call.direction === "outbound");
  const totalTalk = calls.reduce(
    (sum, call) => sum + Number(call.talk_time_seconds ?? 0),
    0,
  );
  return {
    totalCalls: calls.length,
    inbound: inbound.length,
    outbound: outbound.length,
    answered: answered.length,
    missed: missed.length,
    totalTalkSeconds: totalTalk,
    averageTalkSeconds: answered.length
      ? Math.round(totalTalk / answered.length)
      : 0,
  };
}

async function buildStatusSummary(
  supabase: ReturnType<typeof getAdminClient>,
  agentId: string,
  dayStart: string,
  dayEnd: string,
) {
  const { data: history } = await supabase
    .from("agent_status_history")
    .select("state,started_at,ended_at")
    .eq("agent_id", agentId)
    .gte("started_at", dayStart)
    .lte("started_at", dayEnd)
    .order("started_at", { ascending: true });

  const totals = new Map<string, number>();
  for (const row of history ?? []) {
    const start = new Date(row.started_at).getTime();
    const end = new Date(
      row.ended_at ?? Math.min(Date.now(), new Date(dayEnd).getTime()),
    ).getTime();
    const seconds = Math.max(0, Math.round((end - start) / 1000));
    totals.set(row.state, (totals.get(row.state) ?? 0) + seconds);
  }
  return [...totals.entries()]
    .map(([state, seconds]) => ({ state, seconds }))
    .sort((a, b) => b.seconds - a.seconds);
}

async function collectAudio(
  supabase: ReturnType<typeof getAdminClient>,
  recordings: RecordingRow[],
  calls: CallRow[],
) {
  const callById = new Map(calls.map((call) => [String(call.id), call]));
  const audioParts: { label: string; bytes: Uint8Array; mimeType: string }[] =
    [];
  const includedCalls: IncludedCall[] = [];
  let totalBytes = 0;
  let skipped = 0;

  for (const recording of recordings) {
    if (audioParts.length >= MAX_RECORDINGS) {
      skipped += 1;
      continue;
    }
    if (Number(recording.duration_seconds ?? 0) > MAX_RECORDING_SECONDS) {
      skipped += 1;
      continue;
    }
    const call = callById.get(String(recording.call_id));
    if (!call) {
      skipped += 1;
      continue;
    }

    let audio: { bytes: Uint8Array; mimeType: string };
    try {
      audio = await fetchRecordingBytes(supabase, {
        id: recording.id,
        call_id: recording.call_id,
        recording_url: recording.recording_url,
        recording_type: recording.recording_type,
        raw: recording.raw,
      });
    } catch {
      skipped += 1;
      continue;
    }

    if (totalBytes + audio.bytes.byteLength > MAX_TOTAL_AUDIO_BYTES) {
      skipped += 1;
      continue;
    }

    totalBytes += audio.bytes.byteLength;
    const index = audioParts.length + 1;
    const time = new Date(call.started_at).toLocaleTimeString("he-IL", {
      timeZone: "Asia/Jerusalem",
      hour: "2-digit",
      minute: "2-digit",
    });
    const label = [
      `שיחה ${index}:`,
      `- שעה: ${time}`,
      `- כיוון: ${call.direction === "outbound" ? "יוצאת" : "נכנסת"}`,
      `- לקוח: ${call.customer_number ?? "לא ידוע"}`,
      `- משך שיחה: ${Number(call.talk_time_seconds ?? 0)} שניות`,
    ].join("\n");

    audioParts.push({ label, bytes: audio.bytes, mimeType: audio.mimeType });
    includedCalls.push({
      index,
      callId: String(call.id),
      time,
      direction: call.direction,
      customerNumber: call.customer_number ?? "",
      durationSeconds: Number(call.talk_time_seconds ?? 0),
    });
  }

  return { audioParts, includedCalls, skipped };
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function analyzeDayWithGemini(
  apiKey: string,
  input: {
    agentName: string;
    date: string;
    stats: ReturnType<typeof buildStats>;
    statusSummary: { state: string; seconds: number }[];
    includedCalls: IncludedCall[];
    skippedCount: number;
    audioParts: { label: string; bytes: Uint8Array; mimeType: string }[];
  },
) {
  const schema = {
    type: "object",
    properties: {
      dailySummary: {
        type: "string",
        description: "סיכום יומי מלא של ביצועי הנציג בעברית",
      },
      statsInsights: {
        type: "string",
        description: "תובנות מהנתונים המספריים של היום",
      },
      overallScore: {
        type: "integer",
        description: "ציון יומי כולל 1 עד 10",
      },
      overallAssessment: {
        type: "string",
        description: "הערכה כללית של היום כולו",
      },
      callReviews: {
        type: "array",
        description: "משוב לכל שיחה שנותחה, לפי סדר השיחות",
        items: {
          type: "object",
          properties: {
            callIndex: {
              type: "integer",
              description: "מספר השיחה כפי שסומן",
            },
            summary: { type: "string", description: "סיכום קצר של השיחה" },
            score: { type: "integer", description: "ציון 1 עד 10 לשיחה" },
            feedback: {
              type: "string",
              description: "משוב ממוקד על השיחה",
            },
          },
          required: ["callIndex", "summary", "score", "feedback"],
        },
      },
      recurringStrengths: {
        type: "array",
        items: { type: "string" },
        description: "חוזקות שחזרו לאורך היום",
      },
      recurringWeaknesses: {
        type: "array",
        items: { type: "string" },
        description: "חולשות / דפוסים בעייתיים שחזרו לאורך היום",
      },
      improvementPlan: {
        type: "array",
        items: { type: "string" },
        description: "תוכנית שיפור קונקרטית — צעדים מעשיים",
      },
      coachingScript: {
        type: "string",
        description: "משפטים לדוגמה שהנציג יכול לאמץ, על בסיס מה שנשמע",
      },
      managerNotes: {
        type: "string",
        description: "הערות מנהל לשיחת המשוב עם הנציג",
      },
      riskFlags: {
        type: "array",
        items: { type: "string" },
        description: "דגלים אדומים אם יש",
      },
    },
    required: [
      "dailySummary",
      "statsInsights",
      "overallScore",
      "overallAssessment",
      "callReviews",
      "recurringStrengths",
      "recurringWeaknesses",
      "improvementPlan",
      "coachingScript",
      "managerNotes",
      "riskFlags",
    ],
  };

  const statusLines = input.statusSummary.length
    ? input.statusSummary
        .map(
          (item) =>
            `- ${item.state}: ${Math.round(item.seconds / 60)} דקות`,
        )
        .join("\n")
    : "- אין נתוני סטטוס ליום הזה";

  const context = [
    DAY_ANALYSIS_PROMPT,
    "",
    `נציג: ${input.agentName}`,
    `תאריך: ${input.date}`,
    "",
    "נתוני היום:",
    `- סך שיחות: ${input.stats.totalCalls}`,
    `- נכנסות: ${input.stats.inbound} | יוצאות: ${input.stats.outbound}`,
    `- נענו: ${input.stats.answered} | לא נענו: ${input.stats.missed}`,
    `- זמן שיחה כולל: ${Math.round(input.stats.totalTalkSeconds / 60)} דקות`,
    `- זמן שיחה ממוצע: ${input.stats.averageTalkSeconds} שניות`,
    "",
    "זמני סטטוס:",
    statusLines,
    "",
    `מצורפות ${input.audioParts.length} הקלטות מתוך היום.` +
      (input.skippedCount > 0
        ? ` ${input.skippedCount} הקלטות נוספות לא צורפו בגלל מגבלת גודל.`
        : ""),
  ].join("\n");

  const parts: UnknownRecord[] = [{ text: context }];
  for (const audio of input.audioParts) {
    parts.push({ text: audio.label });
    parts.push({
      inline_data: {
        mime_type: audio.mimeType,
        data: bytesToBase64(audio.bytes),
      },
    });
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0.3,
          responseMimeType: "application/json",
          responseSchema: schema,
        },
      }),
    },
  );

  const payload = (await response.json()) as UnknownRecord;
  if (!response.ok) {
    const err =
      (payload.error as { message?: string } | undefined)?.message ??
      JSON.stringify(payload).slice(0, 500);
    throw new Error(`gemini_error:${err}`);
  }

  const text = extractGeminiText(payload);
  if (!text) throw new Error("gemini_empty_response");

  try {
    return JSON.parse(text) as UnknownRecord;
  } catch {
    throw new Error("gemini_invalid_json");
  }
}

function extractGeminiText(payload: UnknownRecord) {
  const candidates = payload.candidates as UnknownRecord[] | undefined;
  const parts = (candidates?.[0]?.content as UnknownRecord | undefined)
    ?.parts as UnknownRecord[] | undefined;
  const text = parts?.map((part) => String(part.text ?? "")).join("") ?? "";
  return text.trim();
}

/** UTC instant of a Jerusalem-local day boundary. */
function jerusalemBoundary(date: string, endOfDay: boolean): string {
  const time = endOfDay ? "23:59:59.999" : "00:00:00.000";
  const wallClockUtc = Date.parse(`${date}T${time}Z`);
  let instant = wallClockUtc;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
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
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    instant = wallClockUtc - (representedAsUtc - instant);
  }

  return new Date(instant).toISOString();
}
