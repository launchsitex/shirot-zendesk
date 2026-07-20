import {
  getAdminClient,
  jsonResponse,
} from "../_shared/zendesk.ts";
import { fetchRecordingBytes } from "../_shared/recordings.ts";

type UnknownRecord = Record<string, unknown>;

const GEMINI_MODEL = "gemini-2.5-pro";
const MAX_INLINE_BYTES = 18 * 1024 * 1024;
const MAX_DURATION_SECONDS = 45 * 60;

const ANALYSIS_PROMPT = `אתה מנהל מוקד שירות לקוחות ואספקות עם ניסיון של שנים רבות בחברות קמעונאיות בישראל (רהיטים / משלוחים / שירות).
ההקלטה בעברית: שיחת טלפון בין לקוח לנציג.

משימות:
1. האזן להקלטה והבן את תוכן השיחה.
2. סכם את השיחה בעברית ברורה.
3. הערך את ביצועי הנציג כמו מנהל מוקד מחמיר אבל הוגן.
4. תן המלצות שיפור קונקרטיות ויומיומיות (לא כלליות).

החזר JSON בלבד לפי הסכמה. כל הטקסטים בעברית.`;

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
    .select("role, department_id")
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

  const recordingId = String(body.recordingId ?? "").trim();
  if (!recordingId) {
    return jsonResponse({ error: "recording_id_required" }, 400);
  }

  const { data: recording, error: recordingError } = await supabase
    .from("call_recordings")
    .select(
      "id,call_id,ticket_id,recording_type,duration_seconds,created_at,recording_url,raw,calls(customer_number,department_id,agents!agent_id(name),departments(name))",
    )
    .eq("id", recordingId)
    .maybeSingle();

  if (recordingError || !recording) {
    return jsonResponse({ error: "recording_not_found" }, 404);
  }

  const duration = Number(recording.duration_seconds ?? 0);
  if (duration > MAX_DURATION_SECONDS) {
    return jsonResponse(
      {
        error: "recording_too_long",
        message: "ההקלטה ארוכה מדי לניתוח אוטומטי (מעל 45 דקות).",
      },
      400,
    );
  }

  try {
    const audio = await fetchRecordingBytes(supabase, recording);
    if (audio.bytes.byteLength > MAX_INLINE_BYTES) {
      throw new Error("recording_file_too_large");
    }
    const analysis = await analyzeWithGemini(geminiKey, audio, {
      agentName:
        (recording.calls as { agents?: { name?: string } } | null)?.agents
          ?.name ?? "לא ידוע",
      departmentName:
        (recording.calls as { departments?: { name?: string } } | null)
          ?.departments?.name ?? "לא ידוע",
      customerNumber:
        (recording.calls as { customer_number?: string } | null)
          ?.customer_number ?? "",
      durationSeconds: duration,
      recordingType: String(recording.recording_type ?? "call"),
    });

    return jsonResponse({
      ok: true,
      recording: {
        id: recording.id,
        callId: recording.call_id,
        ticketId: recording.ticket_id,
        recordingType: recording.recording_type,
        durationSeconds: duration,
        createdAt: recording.created_at,
        agentName:
          (recording.calls as { agents?: { name?: string } } | null)?.agents
            ?.name ?? null,
        departmentName:
          (recording.calls as { departments?: { name?: string } } | null)
            ?.departments?.name ?? null,
        customerNumber:
          (recording.calls as { customer_number?: string } | null)
            ?.customer_number ?? "",
      },
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
        ? "לא הצלחנו להוריד את קובץ ההקלטה מ-Aircall (הקישור פג או שאין גישה). נסה שוב."
        : message;
    return jsonResponse({ error: "analysis_failed", message: friendly }, 500);
  }
});

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function analyzeWithGemini(
  apiKey: string,
  audio: { bytes: Uint8Array; mimeType: string },
  meta: {
    agentName: string;
    departmentName: string;
    customerNumber: string;
    durationSeconds: number;
    recordingType: string;
  },
) {
  const schema = {
    type: "object",
    properties: {
      callSummary: {
        type: "string",
        description: "סיכום מלא של השיחה בעברית",
      },
      customerNeed: {
        type: "string",
        description: "מה הלקוח רצה / הבעיה המרכזית",
      },
      outcome: {
        type: "string",
        description: "איך השיחה הסתיימה / מה סוכם",
      },
      customerSentiment: {
        type: "string",
        description: "מצב רגשי של הלקוח",
      },
      agentScore: {
        type: "integer",
        description: "ציון 1 עד 10 לביצועי הנציג",
      },
      agentOverall: {
        type: "string",
        description: "הערכה כללית של הנציג",
      },
      agentStrengths: {
        type: "array",
        items: { type: "string" },
        description: "חוזקות של הנציג",
      },
      agentWeaknesses: {
        type: "array",
        items: { type: "string" },
        description: "חולשות / פערים",
      },
      improvements: {
        type: "array",
        items: { type: "string" },
        description: "המלצות שיפור קונקרטיות",
      },
      coachingScript: {
        type: "string",
        description: "משפטים לדוגמה שהנציג יכול היה לומר טוב יותר",
      },
      managerNotes: {
        type: "string",
        description: "הערות מנהל מוקד לשיתוף בשיחת משוב",
      },
      riskFlags: {
        type: "array",
        items: { type: "string" },
        description: "דגלים אדומים אם יש (הבטחות, כעס, חזרתיות)",
      },
    },
    required: [
      "callSummary",
      "customerNeed",
      "outcome",
      "customerSentiment",
      "agentScore",
      "agentOverall",
      "agentStrengths",
      "agentWeaknesses",
      "improvements",
      "coachingScript",
      "managerNotes",
      "riskFlags",
    ],
  };

  const context = [
    ANALYSIS_PROMPT,
    "",
    `פרטי שיחה:`,
    `- נציג: ${meta.agentName}`,
    `- מחלקה: ${meta.departmentName}`,
    `- מספר לקוח: ${meta.customerNumber || "לא ידוע"}`,
    `- משך: ${meta.durationSeconds} שניות`,
    `- סוג הקלטה: ${meta.recordingType}`,
  ].join("\n");

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: context },
              {
                inline_data: {
                  mime_type: audio.mimeType,
                  data: bytesToBase64(audio.bytes),
                },
              },
            ],
          },
        ],
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
