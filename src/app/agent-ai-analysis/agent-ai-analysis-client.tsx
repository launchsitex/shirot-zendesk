"use client";

import {
  CalendarDays,
  LoaderCircle,
  Phone,
  Sparkles,
  Star,
  UserSearch,
} from "lucide-react";
import { useEffect, useState } from "react";
import { formatDuration } from "@/lib/metrics";
import { formatPhoneDisplay } from "@/lib/phone";
import {
  createSupabaseBrowserClient,
  isSupabaseBrowserConfigured,
} from "@/lib/supabase/browser";

type AgentOption = {
  id: string;
  name: string;
  departmentName: string | null;
};

type CallReview = {
  callIndex: number;
  summary: string;
  score: number;
  feedback: string;
};

type DayAnalysis = {
  dailySummary: string;
  statsInsights: string;
  overallScore: number;
  overallAssessment: string;
  callReviews: CallReview[];
  recurringStrengths: string[];
  recurringWeaknesses: string[];
  improvementPlan: string[];
  coachingScript: string;
  managerNotes: string;
  riskFlags: string[];
};

type AnalyzedCall = {
  index: number;
  callId: string;
  time: string;
  direction: string;
  customerNumber: string;
  durationSeconds: number;
};

type AnalyzeResponse = {
  agent: { id: string; name: string };
  date: string;
  stats: {
    totalCalls: number;
    inbound: number;
    outbound: number;
    answered: number;
    missed: number;
    totalTalkSeconds: number;
    averageTalkSeconds: number;
  };
  statusSummary: { state: string; seconds: number }[];
  analyzedCalls: AnalyzedCall[];
  skippedRecordings: number;
  analysis: DayAnalysis;
  model: string;
  analyzedAt: string;
};

const STATE_LABELS: Record<string, string> = {
  available: "זמין",
  ringing: "מצלצל",
  on_call: "בשיחה",
  wrap_up: "עבודה אחרי שיחה",
  scheduled: "לפי לוח זמנים",
  out_for_lunch: "הפסקת צהריים",
  on_break: "הפסקה",
  in_training: "הדרכה",
  back_office: "עבודה משרדית",
  other: "אחר",
  unavailable: "לא זמין",
};

function todayJerusalem() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
  }).format(new Date());
}

export function AgentAiAnalysisClient() {
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [agentId, setAgentId] = useState("");
  const [date, setDate] = useState(todayJerusalem());
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AnalyzeResponse | null>(null);

  useEffect(() => {
    fetch("/api/agent-ai-analysis", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.message ?? payload.error ?? "load_failed");
        }
        setAgents(payload.agents ?? []);
      })
      .catch((loadError) =>
        setError(
          loadError instanceof Error
            ? loadError.message
            : "טעינת רשימת הנציגים נכשלה",
        ),
      )
      .finally(() => setLoadingAgents(false));
  }, []);

  async function analyze() {
    if (!agentId || !date) return;
    setAnalyzing(true);
    setError("");
    setResult(null);
    try {
      // Call the edge function directly: the analysis can run for several
      // minutes, longer than the web host's proxy timeout, which used to cut
      // the connection and return an HTML error page instead of JSON.
      if (!isSupabaseBrowserConfigured()) {
        throw new Error("Supabase אינו מחובר");
      }
      const supabase = createSupabaseBrowserClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error("אין סשן פעיל — התחבר מחדש");
      }

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/analyze-agent-day`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ agentId, date }),
        },
      );

      const raw = await response.text();
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        throw new Error(
          "השרת החזיר תשובה לא תקינה (ייתכן שהניתוח ארוך מדי) — נסה שוב או בחר יום עם פחות שיחות",
        );
      }
      if (!response.ok) {
        throw new Error(
          String(payload.message ?? payload.error ?? "ניתוח נכשל"),
        );
      }
      setResult(payload as unknown as AnalyzeResponse);
    } catch (analyzeError) {
      setError(
        analyzeError instanceof Error ? analyzeError.message : "ניתוח נכשל",
      );
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="space-y-5">
      <header className="mb-2 flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#e4f5f2] text-[#158f83]">
          <UserSearch size={20} />
        </span>
        <div>
          <h1 className="text-xl font-bold text-[#17242d]">ניתוח נציג AI</h1>
          <p className="text-sm text-[#7f8d94]">
            בחר נציג ותאריך — המערכת תאזין לשיחות היום ותפיק ביקורת מנהל מוקד
            מלאה
          </p>
        </div>
      </header>

      <section className="card p-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <div>
            <label className="mb-2 block text-sm font-bold text-[#35515c]">
              נציג
            </label>
            <select
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
              disabled={loadingAgents}
              className="w-full rounded-xl border border-[#d9e2e6] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#158f83]"
            >
              <option value="">
                {loadingAgents ? "טוען נציגים..." : "בחר נציג"}
              </option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                  {agent.departmentName ? ` · ${agent.departmentName}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-2 block text-sm font-bold text-[#35515c]">
              תאריך
            </label>
            <div className="relative">
              <CalendarDays
                size={16}
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#9aa7ad]"
              />
              <input
                type="date"
                value={date}
                max={todayJerusalem()}
                onChange={(event) => setDate(event.target.value)}
                className="rounded-xl border border-[#d9e2e6] bg-white py-2.5 pr-10 pl-3 text-sm outline-none focus:border-[#158f83]"
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => void analyze()}
            disabled={analyzing || !agentId || !date}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#158f83] px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60"
          >
            {analyzing ? (
              <LoaderCircle className="animate-spin" size={16} />
            ) : (
              <Sparkles size={16} />
            )}
            {analyzing ? "מנתח את היום..." : "נתח נציג"}
          </button>
        </div>
        {analyzing ? (
          <p className="mt-3 text-xs text-[#7f8d94]">
            הניתוח כולל האזנה לכל הקלטות היום — זה עשוי לקחת מספר דקות. אל
            תסגור את העמוד.
          </p>
        ) : null}
      </section>

      {error ? (
        <p className="rounded-2xl border border-[#f5d0d3] bg-[#fff5f6] px-4 py-3 text-sm text-[#c34850]">
          {error}
        </p>
      ) : null}

      {result ? <DayReport result={result} /> : null}
    </div>
  );
}

function DayReport({ result }: { result: AnalyzeResponse }) {
  const { analysis, stats } = result;
  const score = Math.max(
    1,
    Math.min(10, Number(analysis.overallScore) || 0),
  );

  return (
    <section className="space-y-4">
      <div className="card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold text-[#17242d]">
            סיכום יומי — {result.agent.name} ·{" "}
            {new Date(`${result.date}T12:00:00Z`).toLocaleDateString("he-IL", {
              timeZone: "Asia/Jerusalem",
            })}
          </h2>
          <span className="rounded-lg bg-[#eef2f4] px-2 py-1 text-[11px] text-[#66757d]">
            {result.model} · נותחו {result.analyzedCalls.length} שיחות
            {result.skippedRecordings > 0
              ? ` (${result.skippedRecordings} דולגו בגלל מגבלת גודל)`
              : ""}
          </span>
        </div>
        <p className="whitespace-pre-wrap text-sm leading-7 text-[#35515c]">
          {analysis.dailySummary}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="סך שיחות" value={String(stats.totalCalls)} />
        <StatCard
          label="נענו / לא נענו"
          value={`${stats.answered} / ${stats.missed}`}
        />
        <StatCard
          label="זמן שיחה כולל"
          value={formatDuration(stats.totalTalkSeconds)}
        />
        <article className="card p-5">
          <p className="mb-2 text-xs font-bold text-[#7c8990]">ציון יומי</p>
          <div className="flex items-center gap-2">
            <Star className="text-[#c9a227]" size={20} fill="currentColor" />
            <strong className="text-2xl text-[#17242d]">{score}/10</strong>
          </div>
        </article>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <InfoCard title="הערכה כללית" body={analysis.overallAssessment} />
        <InfoCard title="תובנות מהנתונים" body={analysis.statsInsights} />
      </div>

      {result.statusSummary.length ? (
        <article className="card p-5">
          <p className="mb-3 text-xs font-bold text-[#7c8990]">
            זמני סטטוס ביום זה
          </p>
          <div className="flex flex-wrap gap-2">
            {result.statusSummary.map((item) => (
              <span
                key={item.state}
                className="rounded-lg bg-[#eef2f4] px-3 py-1.5 text-xs text-[#35515c]"
              >
                {STATE_LABELS[item.state] ?? item.state}:{" "}
                {formatDuration(item.seconds)}
              </span>
            ))}
          </div>
        </article>
      ) : null}

      {analysis.callReviews?.length ? (
        <article className="card overflow-hidden">
          <div className="border-b border-[#eef3f5] px-5 py-4">
            <h3 className="font-bold text-[#17242d]">משוב לפי שיחה</h3>
          </div>
          <ul className="divide-y divide-[#eef3f5]">
            {analysis.callReviews.map((review) => {
              const call = result.analyzedCalls.find(
                (item) => item.index === review.callIndex,
              );
              return (
                <li key={review.callIndex} className="px-5 py-4">
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-sm text-[#17242d]">
                      שיחה {review.callIndex}
                      {call ? ` · ${call.time}` : ""}
                    </strong>
                    <span className="flex items-center gap-3">
                      {call?.customerNumber ? (
                        <span
                          className="flex items-center gap-1 font-mono text-xs text-[#66757d]"
                          dir="ltr"
                        >
                          <Phone size={12} />
                          {formatPhoneDisplay(call.customerNumber)}
                        </span>
                      ) : null}
                      <span className="rounded-lg bg-[#e4f5f2] px-2 py-0.5 text-xs font-bold text-[#158f83]">
                        {Math.max(1, Math.min(10, review.score))}/10
                      </span>
                    </span>
                  </div>
                  <p className="text-sm leading-6 text-[#35515c]">
                    {review.summary}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-[#66757d]">
                    {review.feedback}
                  </p>
                </li>
              );
            })}
          </ul>
        </article>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <ListCard
          title="חוזקות חוזרות"
          items={analysis.recurringStrengths}
          tone="good"
        />
        <ListCard
          title="דפוסים לשיפור"
          items={analysis.recurringWeaknesses}
          tone="warn"
        />
      </div>

      <ListCard
        title="תוכנית שיפור ממנהל המוקד"
        items={analysis.improvementPlan}
        tone="neutral"
      />

      <InfoCard
        title="תסריט אימון / ניסוחים מומלצים"
        body={analysis.coachingScript}
      />
      <InfoCard title="הערות לשיחת המשוב" body={analysis.managerNotes} />

      {analysis.riskFlags?.length ? (
        <ListCard title="דגלים אדומים" items={analysis.riskFlags} tone="bad" />
      ) : null}
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="card p-5">
      <p className="mb-2 text-xs font-bold text-[#7c8990]">{label}</p>
      <strong className="text-2xl text-[#17242d]">{value}</strong>
    </article>
  );
}

function InfoCard({ title, body }: { title: string; body: string }) {
  return (
    <article className="card p-5">
      <p className="mb-2 text-xs font-bold text-[#7c8990]">{title}</p>
      <p className="whitespace-pre-wrap text-sm leading-6 text-[#35515c]">
        {body || "—"}
      </p>
    </article>
  );
}

function ListCard({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "good" | "warn" | "bad" | "neutral";
}) {
  const bullet =
    tone === "good"
      ? "text-[#1f7a55]"
      : tone === "warn"
        ? "text-[#9a6811]"
        : tone === "bad"
          ? "text-[#c34850]"
          : "text-[#158f83]";

  return (
    <article className="card p-5">
      <p className="mb-3 text-xs font-bold text-[#7c8990]">{title}</p>
      {items?.length ? (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item}
              className="flex gap-2 text-sm leading-6 text-[#35515c]"
            >
              <span
                className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-current ${bullet}`}
              />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[#9aa7ad]">אין פריטים</p>
      )}
    </article>
  );
}
