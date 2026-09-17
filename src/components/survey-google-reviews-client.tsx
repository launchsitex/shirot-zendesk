"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Star } from "lucide-react";

type FiveStarRow = {
  id: string;
  orderNumber: string;
  submittedAt: string;
  customerName: string;
  phone: string;
  branchName: string;
};

type GoogleLink = {
  branchId: string;
  url: string;
  branchName: string;
};

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function GoogleLinksSettings({
  links,
  loading,
  onSaved,
}: {
  links: GoogleLink[];
  loading: boolean;
  onSaved: () => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [syncedLinks, setSyncedLinks] = useState(links);

  // Re-derive drafts whenever the links prop changes (e.g. after a save) —
  // done during render, not an effect, per React's "adjusting state on prop
  // change" pattern, to avoid an extra cascading render.
  if (links !== syncedLinks) {
    setSyncedLinks(links);
    setDrafts(Object.fromEntries(links.map((row) => [row.branchId, row.url])));
  }

  async function handleSave(branchId: string) {
    setSavingId(branchId);
    setMessage(null);
    try {
      const response = await fetch("/api/surveys/google-links", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId, url: drafts[branchId] ?? "" }),
      });
      if (!response.ok) throw new Error();
      setMessage("נשמר");
      await onSaved();
    } catch {
      setMessage("השמירה נכשלה");
    } finally {
      setSavingId(null);
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
          הגדרות: קישורי ביקורת בגוגל לפי סניף
        </span>
        <span className="text-sm" style={{ color: "var(--blue)" }}>
          {open ? "סגור" : "פתח"}
        </span>
      </button>

      {open && (
        <>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            קישור הביקורת בגוגל (Business Profile) לכל סניף. בעת שליחה תבחר איזה קישור לשלוח — בלי קשר לסניף
            שבו כל לקוח בפועל קנה.
          </p>
          {loading ? (
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              טוען...
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {links.map((link) => (
                <div key={link.branchId} className="flex flex-wrap items-center gap-2">
                  <span className="w-32 shrink-0 text-sm font-medium" style={{ color: "var(--ink)" }}>
                    {link.branchName}
                  </span>
                  <input
                    type="text"
                    dir="ltr"
                    value={drafts[link.branchId] ?? ""}
                    onChange={(event) =>
                      setDrafts((current) => ({ ...current, [link.branchId]: event.target.value }))
                    }
                    placeholder="https://g.page/..."
                    className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm"
                    style={{ borderColor: "var(--line)" }}
                  />
                  <button
                    type="button"
                    disabled={savingId === link.branchId}
                    onClick={() => void handleSave(link.branchId)}
                    className="h-9 rounded-lg px-4 text-sm font-semibold text-white disabled:opacity-50"
                    style={{ background: "var(--blue)" }}
                  >
                    {savingId === link.branchId ? "שומר..." : "שמור"}
                  </button>
                </div>
              ))}
            </div>
          )}
          {message && (
            <p className="text-sm" style={{ color: "var(--teal)" }}>
              {message}
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function SurveyGoogleReviewsClient() {
  const [rows, setRows] = useState<FiveStarRow[]>([]);
  const [links, setLinks] = useState<GoogleLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [countInput, setCountInput] = useState("50");
  const [branchId, setBranchId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [manualQuery, setManualQuery] = useState("");
  const [manualBranchId, setManualBranchId] = useState("");
  const [manualBusy, setManualBusy] = useState(false);
  const [manualMessage, setManualMessage] = useState<string | null>(null);

  async function loadLinks() {
    const response = await fetch("/api/surveys/google-links");
    const payload = await response.json();
    setLinks(response.ok ? payload.links : []);
  }

  async function load() {
    setLoading(true);
    try {
      const [rowsRes] = await Promise.all([fetch("/api/surveys/five-star"), loadLinks()]);
      const rowsPayload = await rowsRes.json();
      setRows(rowsRes.ok ? rowsPayload.rows : []);
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
  }, []);

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

  const selectedRows = useMemo(() => rows.filter((row) => selected.has(row.id)), [rows, selected]);
  const selectedLink = links.find((link) => link.branchId === branchId);

  async function handleSend() {
    if (selectedRows.length === 0 || !branchId) return;
    const confirmed = window.confirm(
      `לשלוח בקשת ביקורת בגוגל (קישור סניף ${selectedLink?.branchName ?? ""}) ל-${selectedRows.length} לקוחות?`,
    );
    if (!confirmed) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/surveys/google-review-send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responseIds: selectedRows.map((row) => row.id), branchId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "השליחה נכשלה");
      const failedCount = payload.failed?.length ?? 0;
      setMessage(
        failedCount > 0
          ? `נשלחו ${payload.sent} בהצלחה, ${failedCount} נכשלו`
          : `נשלחו ${payload.sent} בקשות ביקורת בהצלחה`,
      );
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "השליחה נכשלה");
    } finally {
      setBusy(false);
    }
  }

  const manualSelectedLink = links.find((link) => link.branchId === manualBranchId);

  async function handleManualSend() {
    if (!manualQuery.trim() || !manualBranchId) return;
    const confirmed = window.confirm(
      `לשלוח בקשת ביקורת בגוגל (קישור סניף ${manualSelectedLink?.branchName ?? ""}) ל-${manualQuery.trim()}?`,
    );
    if (!confirmed) return;
    setManualBusy(true);
    setManualMessage(null);
    try {
      const response = await fetch("/api/surveys/google-review-send-manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: manualQuery.trim(), branchId: manualBranchId }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "השליחה נכשלה");
      setManualMessage(`נשלח בהצלחה ל-${payload.customerName} (${payload.phone})`);
      setManualQuery("");
    } catch (err) {
      setManualMessage(err instanceof Error ? err.message : "השליחה נכשלה");
    } finally {
      setManualBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold" style={{ color: "var(--ink)" }}>
          <Star size={20} style={{ color: "var(--amber)" }} />
          בקשת ביקורות בגוגל
        </h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          לקוחות שנתנו ציון 5 בכל שלושת התחומים (מוכר/סניף, תיאום, מוביל) — עדיין לא נשלחה להם בקשת ביקורת.
        </p>
      </div>

      <GoogleLinksSettings links={links} loading={loading} onSaved={loadLinks} />

      <div className="card flex flex-col gap-3 p-5">
        <h2 className="text-base font-semibold" style={{ color: "var(--ink)" }}>
          שליחה ידנית ללקוח בודד
        </h2>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          הזן מספר הזמנה או מספר טלפון — לא דורש שהלקוח מילא סקר או נתן ציון 5.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            dir="ltr"
            value={manualQuery}
            onChange={(event) => setManualQuery(event.target.value)}
            placeholder="מספר הזמנה או טלפון"
            className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: "var(--line)" }}
          />
          <label className="relative flex h-9 items-center rounded-lg border bg-white" style={{ borderColor: "var(--line)" }}>
            <select
              aria-label="קישור לשליחה ידנית"
              value={manualBranchId}
              onChange={(event) => setManualBranchId(event.target.value)}
              className="h-full min-w-40 appearance-none bg-transparent pr-3 pl-8 text-sm font-medium outline-none"
              style={{ color: "var(--ink)" }}
            >
              <option value="">בחר קישור לפי סניף...</option>
              {links.map((link) => (
                <option key={link.branchId} value={link.branchId} disabled={!link.url}>
                  {link.branchName}
                  {!link.url ? " (אין קישור)" : ""}
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute left-3" style={{ color: "var(--muted)" }} />
          </label>
          <button
            type="button"
            disabled={manualBusy || !manualQuery.trim() || !manualBranchId}
            onClick={() => void handleManualSend()}
            className="h-9 rounded-lg px-5 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: "var(--teal)" }}
          >
            {manualBusy ? "שולח..." : "שלח"}
          </button>
          {manualMessage && (
            <span className="text-sm" style={{ color: "var(--ink)" }}>
              {manualMessage}
            </span>
          )}
        </div>
      </div>

      <div className="card flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center gap-3">
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
            <button type="button" onClick={selectCount} className="rounded px-2 py-1 text-sm font-medium" style={{ color: "var(--blue)" }}>
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

          <label className="relative flex h-9 items-center rounded-lg border bg-white" style={{ borderColor: "var(--line)" }}>
            <select
              aria-label="קישור לשליחה"
              value={branchId}
              onChange={(event) => setBranchId(event.target.value)}
              className="h-full min-w-40 appearance-none bg-transparent pr-3 pl-8 text-sm font-medium outline-none"
              style={{ color: "var(--ink)" }}
            >
              <option value="">בחר קישור לפי סניף...</option>
              {links.map((link) => (
                <option key={link.branchId} value={link.branchId} disabled={!link.url}>
                  {link.branchName}
                  {!link.url ? " (אין קישור)" : ""}
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="pointer-events-none absolute left-3" style={{ color: "var(--muted)" }} />
          </label>

          <button
            type="button"
            disabled={busy || selectedRows.length === 0 || !branchId}
            onClick={() => void handleSend()}
            className="h-9 rounded-lg px-5 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: "var(--teal)" }}
          >
            שלח בקשת ביקורת {selectedRows.length > 0 ? `(${selectedRows.length})` : ""}
          </button>

          {message && (
            <span className="text-sm" style={{ color: "var(--ink)" }}>
              {message}
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-right" style={{ color: "var(--muted)" }}>
                <th className="px-4 py-2">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                </th>
                <th className="px-4 py-2 font-medium">לקוח</th>
                <th className="px-4 py-2 font-medium">טלפון</th>
                <th className="px-4 py-2 font-medium">הזמנה</th>
                <th className="px-4 py-2 font-medium">סניף (של הלקוח)</th>
                <th className="px-4 py-2 font-medium">תאריך תשובה</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center" style={{ color: "var(--muted)" }}>
                    טוען...
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center" style={{ color: "var(--muted)" }}>
                    אין כרגע לקוחות עם ציון 5 מלא שלא נשלחה להם בקשה
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.id} className="border-t" style={{ borderColor: "var(--line)" }}>
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={selected.has(row.id)} onChange={() => toggleRow(row.id)} />
                  </td>
                  <td className="px-4 py-3 font-medium">{row.customerName}</td>
                  <td className="px-4 py-3">{row.phone}</td>
                  <td className="px-4 py-3">{row.orderNumber}</td>
                  <td className="px-4 py-3">{row.branchName}</td>
                  <td className="px-4 py-3 whitespace-nowrap" style={{ color: "var(--muted)" }}>
                    {formatDateTime(row.submittedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
