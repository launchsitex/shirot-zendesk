"use client";

import { useState } from "react";
import { downloadSurveyScoreExcel } from "@/lib/survey-export";

export function SurveyScoreExport() {
  const [minScore, setMinScore] = useState("4.5");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleExport() {
    const parsed = Number(minScore);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 5) {
      setMessage("ציון מינימלי צריך להיות בין 1 ל-5");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/surveys/export-by-score?minScore=${parsed}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "הייצוא נכשל");
      if (payload.rows.length === 0) {
        setMessage("אין לקוחות עם ציון כזה");
        return;
      }
      await downloadSurveyScoreExcel(payload.rows, parsed);
      setMessage(`יוצאו ${payload.rows.length} לקוחות`);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "הייצוא נכשל");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card flex flex-wrap items-end gap-3 p-5">
      <div>
        <h2 className="text-base font-semibold" style={{ color: "var(--ink)" }}>
          ייצוא לקוחות לפי ציון
        </h2>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          לקוחות שהציון הממוצע שלהם (מוכר/סניף, תיאום אספקה, מוביל) גבוה או שווה לערך שתבחר.
        </p>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span style={{ color: "var(--muted)" }}>ציון מינימלי</span>
        <input
          type="number"
          min={1}
          max={5}
          step={0.5}
          value={minScore}
          onChange={(event) => setMinScore(event.target.value)}
          className="w-24 rounded-lg border px-3 py-2 text-sm"
          style={{ borderColor: "var(--line)" }}
        />
      </label>
      <button
        type="button"
        disabled={busy}
        onClick={handleExport}
        className="h-10 rounded-lg px-5 text-sm font-semibold text-white disabled:opacity-50"
        style={{ background: "var(--blue)" }}
      >
        {busy ? "מייצא..." : "ייצוא ל-Excel"}
      </button>
      {message && (
        <span className="text-sm" style={{ color: "var(--teal)" }}>
          {message}
        </span>
      )}
    </div>
  );
}
