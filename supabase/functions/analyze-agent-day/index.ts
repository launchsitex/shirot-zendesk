import { getAdminClient } from "../_shared/zendesk.ts";
import {
  describeHoldWindows,
  describeTransferEvents,
  extractHoldWindows,
  extractTransferEvents,
  fetchRecordingBytes,
} from "../_shared/recordings.ts";

type UnknownRecord = Record<string, unknown>;

// The browser calls this function directly (the Next.js host proxy times out
// on long analyses), so every response must carry CORS headers.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

const GEMINI_MODEL = "gemini-2.5-pro";
// Gemini inline request budget is ~20MB total; leave headroom for the prompt.
const MAX_TOTAL_AUDIO_BYTES = 17 * 1024 * 1024;
const MAX_RECORDING_SECONDS = 40 * 60;
const MAX_BATCH_RECORDINGS = 12;

const BATCH_PROMPT = `אתה מנהל מוקד שירות לקוחות ואספקות עם ניסיון של שנים רבות בחברות קמעונאיות בישראל (רהיטים / משלוחים / שירות).
אתה מבצע בקרת איכות על נציג: מצורפות הקלטות של חלק משיחות היום שלו. כל הקלטה מסומנת במספר שיחה ופרטיה.

משימות:
1. האזן לכל ההקלטות המצורפות, אחת-אחת.
2. לכל שיחה כתוב סיכום קצר, ציון 1-10, ומשוב ממוקד ומקצועי — מה היה טוב ומה לשפר.
3. השתמש במספרי השיחות בדיוק כפי שסומנו (callIndex).

כללי שיחה שהועברה בין נציגים (Transfer) — חובה מוחלטת:
- אתה מנתח אך ורק את הנציג ששמו מופיע למעלה. אם מסומן שהשיחה הועברה — בהקלטה משתתפים שני נציגים או יותר, וחובה להפריד ביניהם.
- זהה את נקודת ההעברה: לפי הזמן שדווח מהמרכזייה אם צוין, או לפי האזנה (קול חדש, הצגה עצמית, "אני מעביר/ה אותך", מוזיקת המתנה לפני מעבר).
- הציון, המשוב, החוזקות והחולשות מתייחסים אך ורק לקטעים שבהם הנציג המנותח מדבר. אל תייחס לו שום דבר שאמר או עשה הנציג/ה האחר/ת — לא לטובה ולא לרעה.
- בסיכום השיחה מותר לציין במשפט אחד שחלק מהשיחה טופל על ידי נציג/ה אחר/ת, כהקשר בלבד.

כללי החזק (Hold) והשתק (Mute) — חובה מוחלטת:
- אם מפורטים לשיחה חלונות זמן שבהם הלקוח היה בהמתנה (Hold, נתון מדויק מהמרכזייה) — אל תנתח ואל תשפוט שום דיבור, צעקות, רעש רקע או מוזיקה שנשמעים בתוך החלונות האלה. רעשי מוקד בהקלטה בזמן Hold אינם נשמעים ללקוח (הוא שומע מוזיקת המתנה) ואסור להוריד עליהם ציון או להמליץ על Mute. כן מותר להעריך רק את ההתנהלות סביב ההחזקה: האם הנציג ביקש רשות לפני, האם משך ההמתנה סביר, והאם חזר עם התנצלות/עדכון.
- גם בלי נתוני Hold מהמרכזייה: קטע עם מוזיקת המתנה, או קטע שבו הנציג יצא מהשיחה עם הלקוח (אמר "רגע"/"אבדוק" ואז נעלם) ואז חוזר — זה Hold. אל תשפוט רעשי מוקד/צעקות ברקע בזמן הזה, ואל תמליץ להשתמש ב-Mute במקום Hold.
- Mute משתיק רק את מיקרופון הנציג; הוא לא שם את הלקוח בהמתנה. אל תבלבל בין השניים ואל תמליץ על Mute כטיפול ברעשי מוקד בזמן המתנה.
- אם הנציג שקט לגמרי לאורך זמן בזמן שהלקוח מדבר (בלי מוזיקת המתנה) — ייתכן Mute; אל תוריד ציון על "חוסר תגובה" בקטע כזה, לכל היותר ציין זאת כהערה.

חשוב: כל הטקסטים בעברית. אל תמציא שיחות שלא צורפו. החזר JSON בלבד לפי הסכמה.`;

const SUMMARY_PROMPT = `אתה מנהל מוקד שירות לקוחות ואספקות עם ניסיון של שנים רבות בחברות קמעונאיות בישראל (רהיטים / משלוחים / שירות).
ביצעת בקרת איכות יומית על נציג: האזנת לכל שיחות היום שלו וכתבת משוב לכל שיחה. עכשיו מצורפים כל המשובים שכתבת + הנתונים המספריים של היום.

משימות:
1. כתוב ביקורת יומית מלאה ומקצועית, כמו מנהל מוקד מחמיר אבל הוגן שהאזין לכל השיחות.
2. נתח גם את הנתונים המספריים של היום (כמות שיחות, נענו/לא נענו, זמני שיחה, סטטוסים).
3. זהה דפוסים חוזרים (לטובה ולרעה) לאורך היום, על בסיס המשובים לכל השיחות.
4. תן תוכנית שיפור קונקרטית ויומיומית לנציג, עם משפטים לדוגמה.

חשוב: כל הטקסטים בעברית. התבסס רק על המשובים והנתונים המצורפים. החזר JSON בלבד לפי הסכמה.`;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
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
  const mode = String(body.mode ?? "plan");
  if (!agentId) return jsonResponse({ error: "agent_id_required" }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return jsonResponse({ error: "date_required" }, 400);
  }

  const day = await loadDay(supabase, agentId, date);
  if ("errorResponse" in day) return day.errorResponse;

  try {
    if (mode === "plan") {
      return planResponse(supabase, day);
    }
    if (mode === "batch") {
      return await batchResponse(supabase, geminiKey, day, body);
    }
    if (mode === "summary") {
      return await summaryResponse(supabase, geminiKey, day, body, user.id);
    }
    return jsonResponse({ error: "unknown_mode" }, 400);
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
  raw: unknown;
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

type DayContext = {
  agent: { id: string; name: string | null };
  agentId: string;
  date: string;
  dayStart: string;
  dayEnd: string;
  calls: CallRow[];
};

async function loadDay(
  supabase: ReturnType<typeof getAdminClient>,
  agentId: string,
  date: string,
): Promise<DayContext | { errorResponse: Response }> {
  const { data: agent } = await supabase
    .from("agents")
    .select("id,name")
    .eq("id", agentId)
    .maybeSingle();
  if (!agent) {
    return { errorResponse: jsonResponse({ error: "agent_not_found" }, 404) };
  }

  const dayStart = jerusalemBoundary(date, false);
  const dayEnd = jerusalemBoundary(date, true);

  const { data: calls, error: callsError } = await supabase
    .from("calls")
    .select(
      "id,direction,status,customer_number,started_at,ended_at,duration_seconds,talk_time_seconds,wait_time_seconds,raw",
    )
    .eq("agent_id", agentId)
    .gte("started_at", dayStart)
    .lte("started_at", dayEnd)
    .order("started_at", { ascending: true });
  if (callsError) {
    return { errorResponse: jsonResponse({ error: callsError.message }, 500) };
  }
  if (!calls?.length) {
    return {
      errorResponse: jsonResponse(
        {
          error: "no_calls",
          message: "לא נמצאו שיחות לנציג הזה בתאריך שנבחר.",
        },
        404,
      ),
    };
  }

  return { agent, agentId, date, dayStart, dayEnd, calls };
}

/** Stage 1: list all recordings of the day so the client can batch them. */
async function planResponse(
  supabase: ReturnType<typeof getAdminClient>,
  day: DayContext,
) {
  const callIds = day.calls.map((call) => String(call.id));
  const { data: recordings } = await supabase
    .from("call_recordings")
    .select("id,call_id,duration_seconds,created_at")
    .in("call_id", callIds)
    .eq("recording_type", "call")
    .order("created_at", { ascending: true });

  const callById = new Map(day.calls.map((call) => [String(call.id), call]));
  const eligible: {
    recordingId: string;
    callId: string;
    durationSeconds: number;
  }[] = [];
  let skippedTooLong = 0;

  // Keep recordings in call start-time order so call numbering follows the day.
  const sorted = [...(recordings ?? [])].sort((a, b) => {
    const callA = callById.get(String(a.call_id));
    const callB = callById.get(String(b.call_id));
    return (
      new Date(callA?.started_at ?? 0).getTime() -
      new Date(callB?.started_at ?? 0).getTime()
    );
  });

  for (const recording of sorted) {
    if (!callById.has(String(recording.call_id))) continue;
    if (Number(recording.duration_seconds ?? 0) > MAX_RECORDING_SECONDS) {
      skippedTooLong += 1;
      continue;
    }
    eligible.push({
      recordingId: String(recording.id),
      callId: String(recording.call_id),
      durationSeconds: Number(recording.duration_seconds ?? 0),
    });
  }

  if (!eligible.length) {
    return jsonResponse(
      {
        error: "no_recordings",
        message:
          "יש שיחות ביום הזה אבל אין אף הקלטה זמינה לניתוח. נסה תאריך אחר.",
      },
      404,
    );
  }

  const statusSummary = await buildStatusSummary(
    supabase,
    day.agentId,
    day.dayStart,
    day.dayEnd,
  );

  return jsonResponse({
    ok: true,
    agent: { id: day.agent.id, name: day.agent.name },
    date: day.date,
    stats: buildStats(day.calls),
    statusSummary,
    recordings: eligible,
    skippedTooLong,
    model: GEMINI_MODEL,
  });
}

/** Stage 2: listen to one batch of recordings and review each call. */
async function batchResponse(
  supabase: ReturnType<typeof getAdminClient>,
  geminiKey: string,
  day: DayContext,
  body: UnknownRecord,
) {
  const recordingIds = Array.isArray(body.recordingIds)
    ? body.recordingIds.map(String).slice(0, MAX_BATCH_RECORDINGS)
    : [];
  const startIndex = Math.max(1, Number(body.startIndex ?? 1));
  if (!recordingIds.length) {
    return jsonResponse({ error: "recording_ids_required" }, 400);
  }

  const { data: recordings } = await supabase
    .from("call_recordings")
    .select(
      "id,call_id,recording_type,duration_seconds,created_at,recording_url,raw",
    )
    .in("id", recordingIds);

  // Preserve the client's requested order (day order), and drop anything that
  // doesn't belong to this agent+day.
  const callById = new Map(day.calls.map((call) => [String(call.id), call]));
  const byId = new Map(
    (recordings ?? []).map((row) => [String(row.id), row as RecordingRow]),
  );
  const ordered = recordingIds
    .map((id) => byId.get(id))
    .filter(
      (row): row is RecordingRow =>
        Boolean(row) && callById.has(String(row!.call_id)),
    );

  const audioParts: { label: string; bytes: Uint8Array; mimeType: string }[] =
    [];
  const includedCalls: IncludedCall[] = [];
  let totalBytes = 0;
  let skipped = 0;

  for (const recording of ordered) {
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

    const call = callById.get(String(recording.call_id))!;
    totalBytes += audio.bytes.byteLength;
    const index = startIndex + includedCalls.length;
    const time = new Date(call.started_at).toLocaleTimeString("he-IL", {
      timeZone: "Asia/Jerusalem",
      hour: "2-digit",
      minute: "2-digit",
    });
    const holdLines = describeHoldWindows(extractHoldWindows(call.raw));
    const transferLines = describeTransferEvents(
      extractTransferEvents(call.raw),
    );
    const analyzedName = day.agent.name ?? "הנציג המנותח";
    const label = [
      `שיחה ${index}:`,
      `- שעה: ${time}`,
      `- כיוון: ${call.direction === "outbound" ? "יוצאת" : "נכנסת"}`,
      `- לקוח: ${call.customer_number ?? "לא ידוע"}`,
      `- משך שיחה: ${Number(call.talk_time_seconds ?? 0)} שניות`,
      transferLines.length
        ? [
            "- שיחה שהועברה בין נציגים — חובה להפריד:",
            ...transferLines.map((line) => `  * ${line}`),
            `  * נתח ותן ציון אך ורק לחלק של ${analyzedName} בשיחה. אל תשפוט את הנציג/ה האחר/ת.`,
          ].join("\n")
        : "- לא דווחה העברה בין נציגים לשיחה זו.",
      holdLines.length
        ? [
            "- חלונות המתנה (Hold) מדווחים מהמרכזייה — אל תנתח את האודיו בתוכם:",
            ...holdLines.map((line) => `  * ${line}`),
          ].join("\n")
        : "- לא דווחו חלונות המתנה (Hold) לשיחה זו.",
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

  if (!audioParts.length) {
    return jsonResponse({
      ok: true,
      callReviews: [],
      includedCalls: [],
      skipped,
    });
  }

  const schema = {
    type: "object",
    properties: {
      callReviews: {
        type: "array",
        description: "משוב לכל שיחה שנותחה, לפי מספרי השיחות שסומנו",
        items: {
          type: "object",
          properties: {
            callIndex: {
              type: "integer",
              description: "מספר השיחה כפי שסומן",
            },
            summary: { type: "string", description: "סיכום קצר של השיחה" },
            score: { type: "integer", description: "ציון 1 עד 10 לשיחה" },
            feedback: { type: "string", description: "משוב ממוקד על השיחה" },
          },
          required: ["callIndex", "summary", "score", "feedback"],
        },
      },
    },
    required: ["callReviews"],
  };

  const context = [
    BATCH_PROMPT,
    "",
    `נציג: ${day.agent.name ?? day.agentId}`,
    `תאריך: ${day.date}`,
    `מצורפות ${audioParts.length} הקלטות (שיחות ${startIndex} עד ${
      startIndex + audioParts.length - 1
    } מתוך היום).`,
  ].join("\n");

  const parts: UnknownRecord[] = [{ text: context }];
  for (const audio of audioParts) {
    parts.push({ text: audio.label });
    parts.push({
      inline_data: {
        mime_type: audio.mimeType,
        data: bytesToBase64(audio.bytes),
      },
    });
  }

  const analysis = await callGemini(geminiKey, parts, schema);

  return jsonResponse({
    ok: true,
    callReviews: Array.isArray(analysis.callReviews)
      ? analysis.callReviews
      : [],
    includedCalls,
    skipped,
  });
}

/** Stage 3: merge all per-call reviews into the full daily manager report. */
async function summaryResponse(
  supabase: ReturnType<typeof getAdminClient>,
  geminiKey: string,
  day: DayContext,
  body: UnknownRecord,
  analyzedBy: string,
) {
  const callReviews = Array.isArray(body.callReviews)
    ? (body.callReviews as UnknownRecord[])
    : [];
  if (!callReviews.length) {
    return jsonResponse({ error: "call_reviews_required" }, 400);
  }
  const analyzedCalls = Array.isArray(body.analyzedCalls)
    ? (body.analyzedCalls as UnknownRecord[])
    : [];

  const stats = buildStats(day.calls);
  const statusSummary = await buildStatusSummary(
    supabase,
    day.agentId,
    day.dayStart,
    day.dayEnd,
  );

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
      "recurringStrengths",
      "recurringWeaknesses",
      "improvementPlan",
      "coachingScript",
      "managerNotes",
      "riskFlags",
    ],
  };

  const statusLines = statusSummary.length
    ? statusSummary
        .map((item) => `- ${item.state}: ${Math.round(item.seconds / 60)} דקות`)
        .join("\n")
    : "- אין נתוני סטטוס ליום הזה";

  const reviewLines = callReviews
    .map((review) =>
      [
        `שיחה ${review.callIndex} (ציון ${review.score}/10):`,
        `סיכום: ${review.summary}`,
        `משוב: ${review.feedback}`,
      ].join("\n"),
    )
    .join("\n\n");

  const skippedCount = Number(body.skippedCount ?? 0);
  const context = [
    SUMMARY_PROMPT,
    "",
    `נציג: ${day.agent.name ?? day.agentId}`,
    `תאריך: ${day.date}`,
    "",
    "נתוני היום:",
    `- סך שיחות: ${stats.totalCalls}`,
    `- נכנסות: ${stats.inbound} | יוצאות: ${stats.outbound}`,
    `- נענו: ${stats.answered} | לא נענו: ${stats.missed}`,
    `- זמן שיחה כולל: ${Math.round(stats.totalTalkSeconds / 60)} דקות`,
    `- זמן שיחה ממוצע: ${stats.averageTalkSeconds} שניות`,
    "",
    "זמני סטטוס:",
    statusLines,
    "",
    `נותחו ${callReviews.length} שיחות מוקלטות.` +
      (skippedCount > 0
        ? ` ${skippedCount} הקלטות נוספות לא נותחו בגלל מגבלות טכניות — ציין זאת בהערות המנהל.`
        : ""),
    "",
    "המשובים לכל השיחות:",
    reviewLines,
  ].join("\n");

  const analysis = await callGemini(geminiKey, [{ text: context }], schema);
  const analyzedAt = new Date().toISOString();

  // Persist every completed analysis so the page can show a history.
  const fullAnalysis = { ...analysis, callReviews };
  const overallScore = Number((analysis as UnknownRecord).overallScore);
  const { data: saved, error: saveError } = await supabase
    .from("agent_day_analyses")
    .insert({
      agent_id: day.agent.id,
      agent_name: day.agent.name ?? day.agentId,
      analysis_date: day.date,
      analyzed_at: analyzedAt,
      analyzed_by: analyzedBy,
      overall_score: Number.isFinite(overallScore) ? overallScore : null,
      calls_analyzed: callReviews.length,
      skipped_recordings: skippedCount,
      stats,
      status_summary: statusSummary,
      analyzed_calls: analyzedCalls,
      analysis: fullAnalysis,
      model: GEMINI_MODEL,
    })
    .select("id")
    .single();
  if (saveError) {
    console.error("agent_day_analyses insert failed", saveError.message);
  }

  return jsonResponse({
    ok: true,
    analysisId: saved?.id ?? null,
    agent: { id: day.agent.id, name: day.agent.name },
    date: day.date,
    stats,
    statusSummary,
    analysis,
    model: GEMINI_MODEL,
    analyzedAt,
  });
}

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

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// gemini-2.5-pro counts its internal "thinking" tokens against maxOutputTokens.
// Without an explicit cap, a batch with more context (transfers, holds, longer
// calls) can let thinking consume the entire budget, leaving zero tokens for
// the actual JSON reply — which surfaces as gemini_empty_response. Capping
// thinkingBudget low and maxOutputTokens generously guarantees room for output.
const GEMINI_THINKING_BUDGET = 1024;
const GEMINI_MAX_OUTPUT_TOKENS = 16384;
const GEMINI_MAX_RETRIES = 2;

class GeminiCallError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGeminiOnce(
  apiKey: string,
  parts: UnknownRecord[],
  schema: UnknownRecord,
): Promise<UnknownRecord> {
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
          maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
          thinkingConfig: { thinkingBudget: GEMINI_THINKING_BUDGET },
        },
      }),
    },
  );

  const payload = (await response.json()) as UnknownRecord;
  if (!response.ok) {
    const err =
      (payload.error as { message?: string } | undefined)?.message ??
      JSON.stringify(payload).slice(0, 500);
    throw new GeminiCallError(`gemini_error:${err}`, response.status);
  }

  const text = extractGeminiText(payload);
  if (!text) throw new GeminiCallError("gemini_empty_response");

  try {
    return JSON.parse(text) as UnknownRecord;
  } catch {
    throw new GeminiCallError("gemini_invalid_json");
  }
}

/** Retries transient failures (empty response, rate limiting, server errors) with backoff. */
async function callGemini(
  apiKey: string,
  parts: UnknownRecord[],
  schema: UnknownRecord,
): Promise<UnknownRecord> {
  for (let attempt = 0; attempt <= GEMINI_MAX_RETRIES; attempt += 1) {
    try {
      return await callGeminiOnce(apiKey, parts, schema);
    } catch (error) {
      const retryable =
        error instanceof GeminiCallError &&
        (error.message === "gemini_empty_response" ||
          error.status === 429 ||
          (error.status !== undefined && error.status >= 500));
      if (!retryable || attempt === GEMINI_MAX_RETRIES) throw error;
      await sleep(1000 * (attempt + 1));
    }
  }
  throw new Error("gemini_empty_response");
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
