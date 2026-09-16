"use client";

import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

type PullRequest = {
  id: string;
  date_from: string;
  date_to: string;
  include_service_calls: boolean;
  status: "pending" | "processing" | "done" | "error";
  inserted_count: number | null;
  matched_count: number | null;
  result_summary: string | null;
  error_message: string | null;
  created_at: string;
  processed_at: string | null;
};

const STATUS_LABEL: Record<PullRequest["status"], string> = {
  pending: "ממתין להרצה",
  processing: "מתבצע כרגע",
  done: "הושלם",
  error: "שגיאה",
};

const STATUS_COLOR: Record<PullRequest["status"], string> = {
  pending: "var(--muted)",
  processing: "var(--blue)",
  done: "var(--teal)",
  error: "var(--red)",
};

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function SurveyPriorityPullForm() {
  const [dateFrom, setDateFrom] = useState(todayIso());
  const [dateTo, setDateTo] = useState(todayIso());
  const [includeServiceCalls, setIncludeServiceCalls] = useState(false);
  const [requests, setRequests] = useState<PullRequest[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function load() {
    try {
      const response = await fetch("/api/surveys/priority-pull");
      if (!response.ok) return;
      const payload = await response.json();
      setRequests(payload.requests ?? []);
    } catch {
      // best-effort refresh
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    const poll = window.setInterval(() => void load(), 30_000);
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(poll);
    };
  }, []);

  async function handleSubmit() {
    setSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/surveys/priority-pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dateFrom, dateTo, includeServiceCalls }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "הבקשה נכשלה");
      setMessage("הבקשה נשלחה — הלקוחות ייכנסו לתור אוטומטית תוך עד שעה.");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "הבקשה נכשלה");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="card flex flex-col gap-4 p-5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center justify-between text-right"
      >
        <span className="text-base font-semibold" style={{ color: "var(--ink)" }}>
          ייבוא לקוחות מפריוריטי לפי טווח תאריכי אספקה
        </span>
        <span className="text-sm" style={{ color: "var(--blue)" }}>
          {open ? "סגור" : "פתח"}
        </span>
      </button>

      {open && (
        <>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            שולף הזמנות בסטטוס &quot;סופקה&quot; עם תעודת משלוח בפועל בטווח התאריכים שתבחר, בסניפים המאושרים
            בלבד — וללא הזמנות של סניפי שירות (קריאות שירות/חלפים), אלא אם תסמן את האפשרות למטה. הריצה
            מתבצעת ברקע ולא מיידית — עד שעה מרגע השליחה.
          </p>

          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span style={{ color: "var(--muted)" }}>מתאריך</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
                className="rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "var(--line)" }}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span style={{ color: "var(--muted)" }}>עד תאריך</span>
              <input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
                className="rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "var(--line)" }}
              />
            </label>
            <label className="flex h-10 items-center gap-2 text-sm" style={{ color: "var(--ink)" }}>
              <input
                type="checkbox"
                checked={includeServiceCalls}
                onChange={(event) => setIncludeServiceCalls(event.target.checked)}
              />
              כלול גם קריאות שירות
            </label>
            <button
              type="button"
              disabled={submitting}
              onClick={handleSubmit}
              className="h-10 rounded-lg px-5 text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: "var(--blue)" }}
            >
              {submitting ? "שולח..." : "שלח בקשה"}
            </button>
            <button
              type="button"
              onClick={() => void load()}
              className="flex h-10 items-center gap-1.5 rounded-lg border px-3 text-sm"
              style={{ borderColor: "var(--line)", color: "var(--muted)" }}
            >
              <RefreshCw size={14} />
              רענון
            </button>
          </div>

          {message && (
            <p className="text-sm" style={{ color: "var(--ink)" }}>
              {message}
            </p>
          )}

          {requests.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-right" style={{ color: "var(--muted)" }}>
                    <th className="px-3 py-1.5 font-medium">טווח</th>
                    <th className="px-3 py-1.5 font-medium">קריאות שירות</th>
                    <th className="px-3 py-1.5 font-medium">סטטוס</th>
                    <th className="px-3 py-1.5 font-medium">תוצאה</th>
                    <th className="px-3 py-1.5 font-medium">נשלח</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((req) => (
                    <tr key={req.id} className="border-t" style={{ borderColor: "var(--line)" }}>
                      <td className="whitespace-nowrap px-3 py-2">
                        {req.date_from} — {req.date_to}
                      </td>
                      <td className="px-3 py-2" style={{ color: "var(--muted)" }}>
                        {req.include_service_calls ? "כן" : "לא"}
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-medium" style={{ color: STATUS_COLOR[req.status] }}>
                          {STATUS_LABEL[req.status]}
                        </span>
                      </td>
                      <td className="px-3 py-2" style={{ color: "var(--muted)" }}>
                        {req.status === "done" &&
                          `${req.inserted_count ?? 0} חדשים מתוך ${req.matched_count ?? 0} תואמים`}
                        {req.status === "error" && (req.error_message ?? "שגיאה לא ידועה")}
                        {(req.status === "pending" || req.status === "processing") && "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2" style={{ color: "var(--muted)" }}>
                        {formatDateTime(req.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
