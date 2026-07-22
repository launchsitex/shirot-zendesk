"use client";

import { LoaderCircle, PhoneMissed, Save } from "lucide-react";
import { useEffect, useState } from "react";

export function MissedCallThresholdSettingsClient() {
  const [thresholdSeconds, setThresholdSeconds] = useState<number | null>(
    null,
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings/missed-call-threshold", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "load_failed");
        setThresholdSeconds(Number(payload.thresholdSeconds) || 0);
      })
      .catch((loadError) =>
        setError(
          loadError instanceof Error
            ? loadError.message
            : "טעינת ההגדרה נכשלה",
        ),
      );
  }, []);

  async function save() {
    if (thresholdSeconds === null) return;
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const response = await fetch("/api/settings/missed-call-threshold", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thresholdSeconds }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "save_failed");
      setThresholdSeconds(Number(payload.thresholdSeconds) || 0);
      setSaved(true);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "שמירת ההגדרה נכשלה",
      );
    } finally {
      setSaving(false);
    }
  }

  if (thresholdSeconds === null && !error) {
    return (
      <div className="card flex min-h-40 items-center justify-center p-8">
        <LoaderCircle className="animate-spin text-[#158f83]" size={28} />
      </div>
    );
  }

  if (thresholdSeconds === null) {
    return (
      <div className="card p-5 text-sm text-red-600">{error || "שגיאה"}</div>
    );
  }

  return (
    <section className="card space-y-5 p-5 md:p-6">
      <header className="flex items-start gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#fdebed] text-[#c8434c]">
          <PhoneMissed size={20} />
        </span>
        <div>
          <h2 className="text-lg font-bold">סף “לא נענה פחות זמן”</h2>
          <p className="mt-1 max-w-2xl text-sm text-[#718087]">
            שיחות נכנסות שלא נענו, שבהן הלקוח המתין עד למספר השניות שתגדירו
            כאן ואז ניתק, יסווגו בנפרד כ“לא נענה פחות זמן” — לא ייספרו כ“לא
            נענו” ולא ישפיעו על אחוז המענה, אך ימשיכו להופיע בכל מקום
            במערכת ולא יימחקו.
          </p>
        </div>
      </header>

      <label className="flex max-w-xs flex-col gap-2">
        <span className="text-sm font-bold text-[#17242d]">
          סף המתנה (בשניות)
        </span>
        <input
          type="number"
          min={0}
          max={3600}
          step={1}
          value={thresholdSeconds}
          onChange={(event) => {
            const value = Math.max(
              0,
              Math.min(3600, Math.round(Number(event.target.value) || 0)),
            );
            setThresholdSeconds(value);
            setSaved(false);
          }}
          className="rounded-xl border border-[#dfe6ea] bg-[#f8fafb] px-4 py-2.5 text-sm text-[#17242d]"
        />
      </label>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {saved && (
        <p className="rounded-xl border border-[#cfeedf] bg-[#e8f8ef] px-4 py-3 text-sm font-semibold text-[#1f7a55]">
          ההגדרה נשמרה.
        </p>
      )}

      <div className="flex justify-start">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl bg-[#158f83] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#11786e] disabled:opacity-60"
        >
          {saving ? (
            <LoaderCircle size={16} className="animate-spin" />
          ) : (
            <Save size={16} />
          )}
          שמירת סף
        </button>
      </div>
    </section>
  );
}
