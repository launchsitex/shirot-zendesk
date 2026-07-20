"use client";

import { LoaderCircle, Save, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

export function AiAnalysisSettingsClient() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/settings/ai-analysis", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "load_failed");
        setEnabled(Boolean(payload.enabled));
      })
      .catch((loadError) =>
        setError(
          loadError instanceof Error
            ? loadError.message
            : "טעינת הגדרות ניתוח AI נכשלה",
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const response = await fetch("/api/settings/ai-analysis", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "save_failed");
      setEnabled(Boolean(payload.enabled));
      setSaved(true);
      // Sidebar reads the flag from /api/me once — refresh so the menu updates.
      window.setTimeout(() => window.location.reload(), 600);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "שמירת ההגדרות נכשלה",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="card flex items-center gap-3 p-5 text-[#7f8d94]">
        <LoaderCircle className="animate-spin" size={18} />
        טוען הגדרות ניתוח AI…
      </section>
    );
  }

  return (
    <section className="card p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#e8f7f4] text-[#158f83]">
          <Sparkles size={18} />
        </span>
        <div>
          <h2 className="font-bold text-[#17242d]">ניתוח AI להקלטות</h2>
          <p className="mt-1 text-sm text-[#7f8d94]">
            כשמופעל — מופיע עמוד &quot;ניתוח AI&quot; בתפריט (למנהלי מערכת בלבד).
            הניתוח משתמש ב-Gemini על הקלטות השיחה.
          </p>
        </div>
      </div>

      <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-[#e5ebee] bg-[#fbfcfd] px-4 py-3">
        <div>
          <p className="text-sm font-bold text-[#17242d]">הצגת עמוד ניתוח AI</p>
          <p className="text-xs text-[#7f8d94]">
            כבוי כברירת מחדל. הפעלה חושפת את העמוד בתפריט הצד.
          </p>
        </div>
        <input
          type="checkbox"
          className="h-5 w-5 accent-[#158f83]"
          checked={enabled}
          onChange={(event) => {
            setEnabled(event.target.checked);
            setSaved(false);
          }}
        />
      </label>

      {error ? (
        <p className="mt-3 text-sm text-[#c34850]">{error}</p>
      ) : null}
      {saved ? (
        <p className="mt-3 text-sm text-[#1f7a55]">ההגדרות נשמרו</p>
      ) : null}

      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="mt-4 inline-flex items-center gap-2 rounded-xl bg-[#102d38] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-60"
      >
        {saving ? (
          <LoaderCircle className="animate-spin" size={16} />
        ) : (
          <Save size={16} />
        )}
        שמירת הגדרה
      </button>
    </section>
  );
}
