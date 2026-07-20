"use client";

import {
  CheckCircle2,
  Clipboard,
  Headphones,
  KeyRound,
  LoaderCircle,
  Radio,
  Save,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState } from "react";

type AircallSettings = {
  webhookUrl: string;
  recommendedEvents: string[];
  apiConfigured: boolean;
};

export function AircallSettingsClient() {
  const [settings, setSettings] = useState<AircallSettings | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [apiId, setApiId] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings/aircall", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        setSettings(result);
      })
      .catch((loadError) =>
        setError(
          loadError instanceof Error ? loadError.message : "טעינת ההגדרות נכשלה",
        ),
      );
  }, []);

  async function copyWebhook() {
    if (!settings) return;
    await navigator.clipboard.writeText(settings.webhookUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2500);
  }

  async function saveApiCredentials() {
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const response = await fetch("/api/settings/aircall", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiId, apiToken }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setApiId("");
      setApiToken("");
      setSaved(true);
      setSettings((current) =>
        current ? { ...current, apiConfigured: true } : current,
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "שמירת המפתחות נכשלה",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header>
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#e4f5f2] text-[#158f83]">
            <Headphones size={23} />
          </span>
          <div>
            <h1 className="text-2xl font-bold">חיבור Aircall</h1>
            <p className="mt-1 text-sm text-[#75838b]">
              קליטת שיחות וסטטוסי נציגים בזמן אמת באמצעות Webhook
            </p>
          </div>
        </div>
      </header>

      <section className="card p-6">
        <div className="mb-5 flex items-center gap-3">
          <Radio className="text-[#158f83]" size={22} />
          <div>
            <h2 className="font-bold">כתובת ה־Webhook</h2>
            <p className="text-xs text-[#7a888f]">
              יש להעתיק את הכתובת המלאה לשדה URL במסך Aircall
            </p>
          </div>
        </div>

        {!settings && !error && (
          <div className="flex items-center gap-2 py-5 text-sm text-[#718087]">
            <LoaderCircle className="animate-spin" size={18} />
            טוען כתובת מאובטחת...
          </div>
        )}
        {error && <p className="text-sm text-[#c33c45]">{error}</p>}
        {settings && (
          <>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                readOnly
                dir="ltr"
                value={settings.webhookUrl}
                className="h-12 min-w-0 flex-1 rounded-xl border border-[#dfe6ea] bg-[#f8fafb] px-3 font-mono text-xs"
              />
              <button
                onClick={copyWebhook}
                className="flex h-12 items-center justify-center gap-2 rounded-xl bg-[#158f83] px-5 font-bold text-white"
              >
                {copied ? <CheckCircle2 size={18} /> : <Clipboard size={18} />}
                {copied ? "הועתק" : "העתקה"}
              </button>
            </div>
            <div className="mt-4 flex items-start gap-2 rounded-xl bg-[#eef8f6] p-4 text-sm text-[#286e67]">
              <ShieldCheck className="mt-0.5 shrink-0" size={18} />
              הכתובת כוללת מפתח סודי. אין לפרסם אותה או לשלוח אותה לגורם שאינו
              מנהל Aircall.
            </div>
          </>
        )}
      </section>

      {settings && (
        <section className="card p-6">
          <div className="flex items-start gap-3">
            <KeyRound className="mt-0.5 text-[#158f83]" size={22} />
            <div>
              <h2 className="font-bold">סנכרון כל הנציגים מ־Aircall</h2>
              <p className="mt-1 text-xs leading-5 text-[#7a888f]">
                Webhook שולח רק שינויים ואינו מחזיר את רשימת המשתמשים הקיימת.
                הזן API ID ו־API Token מתוך Aircall כדי לטעון את כל הנציגים
                ולרענן את הסטטוסים בכל דקה.
              </p>
            </div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <input
              dir="ltr"
              value={apiId}
              onChange={(event) => setApiId(event.target.value)}
              placeholder="Aircall API ID"
              autoComplete="off"
              className="h-12 rounded-xl border border-[#dfe6ea] px-3 font-mono text-sm"
            />
            <input
              dir="ltr"
              type="password"
              value={apiToken}
              onChange={(event) => setApiToken(event.target.value)}
              placeholder="Aircall API Token"
              autoComplete="new-password"
              className="h-12 rounded-xl border border-[#dfe6ea] px-3 font-mono text-sm"
            />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={saveApiCredentials}
              disabled={saving || !apiId.trim() || !apiToken.trim()}
              className="flex h-11 items-center gap-2 rounded-xl bg-[#158f83] px-5 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? (
                <LoaderCircle className="animate-spin" size={18} />
              ) : (
                <Save size={18} />
              )}
              שמירה וסנכרון
            </button>
            <span className="text-sm font-semibold text-[#527068]">
              {saved
                ? "המפתחות נשמרו והסנכרון הופעל"
                : settings.apiConfigured
                  ? "API מחובר"
                  : "API עדיין לא מחובר"}
            </span>
          </div>
        </section>
      )}

      {settings && (
        <section className="card p-6">
          <h2 className="font-bold">אירועים שיש להפעיל ב־Aircall</h2>
          <p className="mt-1 text-xs text-[#7a888f]">
            אפשר גם להשאיר את כל האירועים פעילים; אירועים שאינם מוכרים יישמרו
            בבטחה ולא ישבשו את המערכת.
          </p>
          <p className="mt-3 rounded-xl bg-[#fff7e5] p-3 text-xs leading-5 text-[#8a6418]">
            לפי תיעוד Aircall, כדי לקבל את סיבת אי־הזמינות המדויקת באירועי
            user.closed יש לבקש מ־Aircall Support להפעיל שליחת substatus עבור
            החשבון.
          </p>
          <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {settings.recommendedEvents.map((event) => (
              <span
                key={event}
                dir="ltr"
                className="rounded-lg bg-[#f4f7f8] px-3 py-2 font-mono text-xs"
              >
                {event}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
