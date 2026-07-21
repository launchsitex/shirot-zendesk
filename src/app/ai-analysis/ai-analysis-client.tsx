"use client";

import {
  LoaderCircle,
  Phone,
  Search,
  Sparkles,
  Star,
} from "lucide-react";
import { useState } from "react";
import { formatDuration } from "@/lib/metrics";
import { formatPhoneDisplay } from "@/lib/phone";
import type { CallRecording } from "@/lib/types";

type AnalysisResult = {
  callSummary: string;
  customerNeed: string;
  outcome: string;
  customerSentiment: string;
  agentScore: number;
  agentOverall: string;
  agentStrengths: string[];
  agentWeaknesses: string[];
  improvements: string[];
  coachingScript: string;
  managerNotes: string;
  riskFlags: string[];
};

type AnalyzeResponse = {
  recording: CallRecording;
  analysis: AnalysisResult;
  model: string;
  analyzedAt: string;
};

export function AiAnalysisClient() {
  const [phone, setPhone] = useState("");
  const [recordings, setRecordings] = useState<CallRecording[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<AnalyzeResponse | null>(null);

  async function searchRecordings() {
    setSearching(true);
    setError("");
    setResult(null);
    setSelectedId(null);
    try {
      const response = await fetch(
        `/api/ai-analysis?phone=${encodeURIComponent(phone.trim())}`,
        { cache: "no-store" },
      );
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message ?? payload.error ?? "חיפוש נכשל");
      }
      setRecordings(payload.recordings ?? []);
      if (!(payload.recordings ?? []).length) {
        setError("לא נמצאו הקלטות למספר הזה");
      }
    } catch (searchError) {
      setRecordings([]);
      setError(
        searchError instanceof Error ? searchError.message : "חיפוש נכשל",
      );
    } finally {
      setSearching(false);
    }
  }

  async function analyze() {
    if (!selectedId) return;
    setAnalyzing(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/ai-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recordingId: selectedId }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.message ?? payload.error ?? "ניתוח נכשל");
      }
      setResult(payload as AnalyzeResponse);
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
          <Sparkles size={20} />
        </span>
        <div>
          <h1 className="text-xl font-bold text-[#17242d]">ניתוח AI</h1>
          <p className="text-sm text-[#7f8d94]">
            חיפוש הקלטה לפי מספר לקוח וניתוח מלא בסגנון מנהל מוקד
          </p>
        </div>
      </header>

      <section className="card p-5">
        <label className="mb-2 block text-sm font-bold text-[#35515c]">
          מספר טלפון של הלקוח
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Phone
              size={16}
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#9aa7ad]"
            />
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void searchRecordings();
              }}
              placeholder="לדוגמה 054-1234567"
              className="w-full rounded-xl border border-[#d9e2e6] bg-white py-2.5 pr-10 pl-3 text-sm outline-none focus:border-[#158f83]"
              dir="ltr"
            />
          </div>
          <button
            type="button"
            onClick={() => void searchRecordings()}
            disabled={searching || !phone.trim()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#102d38] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"
          >
            {searching ? (
              <LoaderCircle className="animate-spin" size={16} />
            ) : (
              <Search size={16} />
            )}
            חיפוש הקלטות
          </button>
        </div>
      </section>

      {recordings.length > 0 ? (
        <section className="card overflow-hidden">
          <div className="border-b border-[#eef3f5] px-5 py-4">
            <h2 className="font-bold">הקלטות שנמצאו</h2>
            <p className="mt-1 text-xs text-[#7f8d94]">
              בחר הקלטה אחת לניתוח
            </p>
          </div>
          <ul className="divide-y divide-[#eef3f5]">
            {recordings.map((recording) => {
              const selected = selectedId === recording.id;
              return (
                <li key={recording.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(recording.id)}
                    className={`flex w-full flex-col gap-1 px-5 py-4 text-right transition ${
                      selected ? "bg-[#e8f7f4]" : "hover:bg-[#f7fafb]"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong className="text-[#17242d]">
                        {recording.agentName ?? "ללא נציג"}
                      </strong>
                      <span className="font-mono text-xs text-[#66757d]" dir="ltr">
                        {formatPhoneDisplay(recording.customerNumber)}
                      </span>
                    </div>
                    <p className="text-xs text-[#7f8d94]">
                      {recording.departmentName ?? "ללא מחלקה"} ·{" "}
                      {new Date(recording.createdAt).toLocaleString("he-IL", {
                        timeZone: "Asia/Jerusalem",
                      })}{" "}
                      ·{" "}
                      {formatDuration(recording.durationSeconds)}
                      {recording.recordingType === "voicemail"
                        ? " · תא קולי"
                        : ""}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-[#eef3f5] px-5 py-4">
            <button
              type="button"
              onClick={() => void analyze()}
              disabled={!selectedId || analyzing}
              className="inline-flex items-center gap-2 rounded-xl bg-[#158f83] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"
            >
              {analyzing ? (
                <LoaderCircle className="animate-spin" size={16} />
              ) : (
                <Sparkles size={16} />
              )}
              {analyzing ? "מנתח את השיחה…" : "נתח עם Gemini"}
            </button>
            {analyzing ? (
              <p className="mt-2 text-xs text-[#7f8d94]">
                הניתוח עשוי לקחת עד כדקה — ההקלטה נשלחת למודל להאזנה וסיכום.
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {error ? (
        <p className="rounded-2xl border border-[#f5d0d3] bg-[#fff5f6] px-4 py-3 text-sm text-[#c34850]">
          {error}
        </p>
      ) : null}

      {result ? <AnalysisReport result={result} /> : null}
    </div>
  );
}

function AnalysisReport({ result }: { result: AnalyzeResponse }) {
  const { analysis, recording, model } = result;
  const score = Math.max(1, Math.min(10, Number(analysis.agentScore) || 0));

  return (
    <section className="space-y-4">
      <div className="card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold text-[#17242d]">סיכום הניתוח</h2>
          <span className="rounded-lg bg-[#eef2f4] px-2 py-1 text-[11px] text-[#66757d]">
            {model} · {recording.agentName ?? "ללא נציג"}
          </span>
        </div>
        <p className="whitespace-pre-wrap text-sm leading-7 text-[#35515c]">
          {analysis.callSummary}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <InfoCard title="צורך הלקוח" body={analysis.customerNeed} />
        <InfoCard title="תוצאת השיחה" body={analysis.outcome} />
        <InfoCard title="מצב רגשי של הלקוח" body={analysis.customerSentiment} />
        <article className="card p-5">
          <p className="mb-2 text-xs font-bold text-[#7c8990]">ציון נציג</p>
          <div className="flex items-center gap-2">
            <Star className="text-[#c9a227]" size={20} fill="currentColor" />
            <strong className="text-2xl text-[#17242d]">{score}/10</strong>
          </div>
          <p className="mt-3 text-sm leading-6 text-[#35515c]">
            {analysis.agentOverall}
          </p>
        </article>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <ListCard title="חוזקות" items={analysis.agentStrengths} tone="good" />
        <ListCard
          title="לשיפור"
          items={analysis.agentWeaknesses}
          tone="warn"
        />
      </div>

      <ListCard
        title="המלצות שיפור ממנהל מוקד"
        items={analysis.improvements}
        tone="neutral"
      />

      <InfoCard title="תסריט אימון / ניסוח מומלץ" body={analysis.coachingScript} />
      <InfoCard title="הערות למשוב עם הנציג" body={analysis.managerNotes} />

      {analysis.riskFlags?.length ? (
        <ListCard title="דגלים אדומים" items={analysis.riskFlags} tone="bad" />
      ) : null}
    </section>
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
            <li key={item} className="flex gap-2 text-sm leading-6 text-[#35515c]">
              <span className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-current ${bullet}`} />
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
