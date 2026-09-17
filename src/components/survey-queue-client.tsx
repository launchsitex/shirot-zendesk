"use client";

import { useEffect, useMemo, useState } from "react";
import { downloadSurveyQueueExcel } from "@/lib/survey-export";

type QueueRow = {
  id: string;
  customer_name: string;
  phone: string;
  order_number: string;
  message_text: string;
  status: "pending" | "sent";
  agent_name: string | null;
  delivered_at: string | null;
  sent_at: string | null;
  responded_at: string | null;
  created_at: string;
  survey_branches: { name: string } | null;
  survey_movers: { name: string } | null;
};

type StatusFilter = "pending" | "sent" | "all";

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function SurveyQueueClient() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("pending");
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [countInput, setCountInput] = useState("50");

  async function load() {
    setLoading(true);
    try {
      const response = await fetch(`/api/surveys/queue?status=${statusFilter}`);
      const payload = await response.json();
      setRows(response.ok ? payload.rows : []);
      setSelected(new Set());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Deferred a tick so the synchronous setState inside load does not cascade
    // into the render.
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const allSelected = rows.length > 0 && selected.size === rows.length;

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((row) => row.id)));
  }

  function toggleRow(id: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectCount() {
    const count = Number(countInput);
    if (!Number.isFinite(count) || count <= 0) return;
    setSelected(new Set(rows.slice(0, Math.floor(count)).map((row) => row.id)));
  }

  const selectedRows = useMemo(
    () => rows.filter((row) => selected.has(row.id)),
    [rows, selected],
  );

  async function handleExportSelected() {
    if (selectedRows.length === 0) return;
    const confirmed = window.confirm(
      `לייצא ל-Excel ולסמן ${selectedRows.length} לקוחות כ"נשלח"? זה לא שולח SMS בפועל — רק מסמן שהם כבר נשלחו.`,
    );
    if (!confirmed) return;
    setBusy(true);
    setMessage(null);
    try {
      await downloadSurveyQueueExcel(
        selectedRows.map((row) => ({ phone: row.phone, messageText: row.message_text })),
      );
      const response = await fetch("/api/surveys/queue", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedRows.map((row) => row.id), action: "mark_sent" }),
      });
      if (!response.ok) throw new Error();
      setMessage(`יוצאו וסומנו כנשלחו ${selectedRows.length} לקוחות`);
      await load();
    } catch {
      setMessage("הייצוא נכשל, נסה שוב");
    } finally {
      setBusy(false);
    }
  }

  async function handleSendDirect() {
    if (selectedRows.length === 0) return;
    const confirmed = window.confirm(
      `לשלוח SMS אמיתי ל-${selectedRows.length} לקוחות עכשיו? פעולה זו לא הפיכה.`,
    );
    if (!confirmed) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/surveys/send-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedRows.map((row) => row.id) }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "השליחה נכשלה");
      const failedCount = payload.failed?.length ?? 0;
      setMessage(
        failedCount > 0
          ? `נשלחו ${payload.sent} בהצלחה, ${failedCount} נכשלו`
          : `נשלחו ${payload.sent} הודעות בהצלחה`,
      );
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "השליחה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveFromQueue() {
    if (selectedRows.length === 0) return;
    const confirmed = window.confirm(
      `להסיר ${selectedRows.length} לקוחות מהתור לגמרי (לא נשלח להם SMS, לא יסומנו כ"נשלח")? לא ניתן לבטל.`,
    );
    if (!confirmed) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/surveys/queue", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedRows.map((row) => row.id) }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "ההסרה נכשלה");
      setMessage(`הוסרו ${payload.count} לקוחות מהתור`);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "ההסרה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  async function handleUnmark(id: string) {
    setBusy(true);
    try {
      await fetch("/api/surveys/queue", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id], action: "mark_pending" }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--ink)" }}>
            תור שליחה
          </h1>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            בחר לקוחות וייצא קובץ להעלאה ל-InfoU — הסימון כ&quot;נשלח&quot; קורה אוטומטית בזמן הייצוא.
          </p>
        </div>
        <div className="flex gap-2">
          {(["pending", "sent", "all"] as StatusFilter[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setStatusFilter(option)}
              className="rounded-full px-4 py-1.5 text-sm font-medium"
              style={{
                background: statusFilter === option ? "var(--blue)" : "var(--background)",
                color: statusFilter === option ? "white" : "var(--muted)",
              }}
            >
              {option === "pending" ? "ממתינים" : option === "sent" ? "נשלחו" : "הכל"}
            </button>
          ))}
        </div>
      </div>

      {statusFilter === "pending" && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={selectedRows.length === 0 || busy}
            onClick={handleExportSelected}
            className="rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: "var(--blue)" }}
          >
            ייצוא {selectedRows.length > 0 ? `(${selectedRows.length})` : ""} וסימון כנשלח
          </button>

          <button
            type="button"
            disabled={selectedRows.length === 0 || busy}
            onClick={handleSendDirect}
            className="rounded-lg border px-5 py-2.5 text-sm font-semibold disabled:opacity-50"
            style={{ borderColor: "var(--teal)", color: "var(--teal)" }}
          >
            שלח SMS ישירות {selectedRows.length > 0 ? `(${selectedRows.length})` : ""}
          </button>

          <button
            type="button"
            disabled={selectedRows.length === 0 || busy}
            onClick={handleRemoveFromQueue}
            className="rounded-lg border px-5 py-2.5 text-sm font-semibold disabled:opacity-50"
            style={{ borderColor: "var(--red)", color: "var(--red)" }}
          >
            הסר מהתור {selectedRows.length > 0 ? `(${selectedRows.length})` : ""}
          </button>

          <div className="flex items-center gap-1.5 rounded-lg border px-2 py-1" style={{ borderColor: "var(--line)" }}>
            <span className="text-sm" style={{ color: "var(--muted)" }}>
              בחר
            </span>
            <input
              type="number"
              min={1}
              value={countInput}
              onChange={(event) => setCountInput(event.target.value)}
              className="w-16 rounded border px-2 py-1 text-sm"
              style={{ borderColor: "var(--line)" }}
            />
            <span className="text-sm" style={{ color: "var(--muted)" }}>
              אחרונים
            </span>
            <button
              type="button"
              onClick={selectCount}
              className="rounded px-2 py-1 text-sm font-medium"
              style={{ color: "var(--blue)" }}
            >
              סמן
            </button>
          </div>

          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-sm underline"
              style={{ color: "var(--muted)" }}
            >
              נקה בחירה
            </button>
          )}

          {message && (
            <span className="text-sm" style={{ color: "var(--teal)" }}>
              {message}
            </span>
          )}
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-right" style={{ color: "var(--muted)" }}>
                {statusFilter === "pending" && (
                  <th className="px-4 py-2">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                  </th>
                )}
                <th className="px-4 py-2 font-medium">לקוח</th>
                <th className="px-4 py-2 font-medium">טלפון</th>
                <th className="px-4 py-2 font-medium">הזמנה</th>
                <th className="px-4 py-2 font-medium">סופק ב-</th>
                <th className="px-4 py-2 font-medium">סניף</th>
                <th className="px-4 py-2 font-medium">מוביל</th>
                <th className="px-4 py-2 font-medium">סוכן/ת</th>
                <th className="px-4 py-2 font-medium">נוצר</th>
                {statusFilter !== "pending" && <th className="px-4 py-2 font-medium">נשלח</th>}
                {statusFilter === "sent" && <th className="px-4 py-2 font-medium" />}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center" style={{ color: "var(--muted)" }}>
                    טוען...
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center" style={{ color: "var(--muted)" }}>
                    אין לקוחות בתור
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.id} className="border-t" style={{ borderColor: "var(--line)" }}>
                  {statusFilter === "pending" && (
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={() => toggleRow(row.id)}
                      />
                    </td>
                  )}
                  <td className="px-4 py-3 font-medium">{row.customer_name}</td>
                  <td className="px-4 py-3">{row.phone}</td>
                  <td className="px-4 py-3">{row.order_number}</td>
                  <td className="px-4 py-3 whitespace-nowrap" style={{ color: "var(--muted)" }}>
                    {formatDate(row.delivered_at)}
                  </td>
                  <td className="px-4 py-3">{row.survey_branches?.name ?? "—"}</td>
                  <td className="px-4 py-3">{row.survey_movers?.name ?? "—"}</td>
                  <td className="px-4 py-3">{row.agent_name ?? "—"}</td>
                  <td className="px-4 py-3 whitespace-nowrap" style={{ color: "var(--muted)" }}>
                    {formatDateTime(row.created_at)}
                  </td>
                  {statusFilter !== "pending" && (
                    <td className="px-4 py-3 whitespace-nowrap" style={{ color: "var(--muted)" }}>
                      {formatDateTime(row.sent_at)}
                    </td>
                  )}
                  {statusFilter === "sent" && (
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleUnmark(row.id)}
                        className="text-xs font-medium underline"
                        style={{ color: "var(--red)" }}
                      >
                        בטל שליחה
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
