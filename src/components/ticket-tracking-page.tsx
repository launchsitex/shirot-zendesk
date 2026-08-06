"use client";

import { Inbox, LoaderCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatIsraelDateTime, jerusalemToday } from "@/lib/israel-time";
import {
  formatPhone,
  isClosed,
  statusLabel,
  summariseByAgent,
  type TicketsPayload,
} from "@/lib/tickets";

/** Rows mounted at once; filtering still spans the whole range. */
const MAX_TABLE_ROWS = 500;

function startOfCurrentMonth() {
  return `${jerusalemToday().slice(0, 7)}-01`;
}

export function TicketTrackingPageClient() {
  const [from, setFrom] = useState(startOfCurrentMonth);
  const [to, setTo] = useState(() => jerusalemToday());
  const [agentFilter, setAgentFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "open" | "closed">(
    "all",
  );
  const [data, setData] = useState<TicketsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const params = new URLSearchParams({ from, to });
      const response = await fetch(`/api/zendesk-tickets?${params}`, {
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "load_failed");
      setData(payload);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "טעינת הפניות נכשלה",
      );
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    // Deferred a tick so the synchronous setState inside load does not cascade
    // into the render, and polled once a minute rather than on every ticket
    // change — the same restraint the call pages needed.
    const initial = window.setTimeout(() => void load(), 0);
    const poll = window.setInterval(() => void load(), 60_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(poll);
    };
  }, [load]);

  const rows = useMemo(() => data?.rows ?? [], [data]);

  const agentSummaries = useMemo(() => summariseByAgent(rows), [rows]);

  const visibleRows = useMemo(
    () =>
      rows.filter((row) => {
        if (agentFilter && (row.agentName ?? "ללא שיוך נציג") !== agentFilter) {
          return false;
        }
        if (statusFilter === "open" && isClosed(row.status)) return false;
        if (statusFilter === "closed" && !isClosed(row.status)) return false;
        return true;
      }),
    [rows, agentFilter, statusFilter],
  );

  const totals = useMemo(() => {
    const closed = rows.filter((row) => isClosed(row.status)).length;
    return { total: rows.length, closed, open: rows.length - closed };
  }, [rows]);

  return (
    <div className="space-y-5">
      <header className="card flex flex-wrap items-center gap-4 p-5">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#e7f5f3] text-[#158f83]">
          <Inbox size={20} />
        </span>
        <div className="flex-1">
          <h1 className="text-lg font-bold">מעקב פניות</h1>
          <p className="mt-0.5 text-sm text-[#718087]">
            פניות Zendesk לפי נציגה, כולל פרטי הלקוח ומועד פתיחת הפנייה.
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <span className="font-semibold text-[#5d6d75]">מתאריך</span>
          <input
            type="date"
            value={from}
            max={to}
            onChange={(event) => setFrom(event.target.value)}
            className="rounded-xl border border-[#dfe6ea] bg-[#f8fafb] px-3 py-2 text-sm outline-none focus:border-[#158f83]"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="font-semibold text-[#5d6d75]">עד</span>
          <input
            type="date"
            value={to}
            min={from}
            max={jerusalemToday()}
            onChange={(event) => setTo(event.target.value)}
            className="rounded-xl border border-[#dfe6ea] bg-[#f8fafb] px-3 py-2 text-sm outline-none focus:border-[#158f83]"
          />
        </label>
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex items-center gap-2 rounded-xl bg-[#158f83] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#11786e]"
        >
          <RefreshCw size={15} />
          רענון
        </button>
      </header>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {loading && !data && (
        <div className="card flex min-h-40 items-center justify-center p-8">
          <LoaderCircle className="animate-spin text-[#158f83]" size={28} />
        </div>
      )}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <SummaryCard label="סה״כ פניות" value={totals.total} tone="neutral" />
            <SummaryCard label="פתוחות" value={totals.open} tone="open" />
            <SummaryCard label="סגורות" value={totals.closed} tone="closed" />
          </div>

          <p className="px-1 text-xs text-[#a3adb1]">
            {data.syncedAt
              ? `סונכרן לאחרונה: ${formatIsraelDateTime(data.syncedAt)}`
              : "טרם בוצע סנכרון"}
            {data.truncated && " · טווח ארוך — נטענו הפניות האחרונות בלבד"}
          </p>

          <section className="card overflow-hidden">
            <header className="border-b border-[#edf1f3] bg-[#f8fafb] px-5 py-3.5">
              <h2 className="text-base font-bold text-[#17242d]">
                פניות לפי נציגה
              </h2>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] border-collapse text-sm">
                <thead>
                  <tr className="text-[#5d6d75]">
                    <th className="px-5 py-3 text-right font-semibold">נציגה</th>
                    <th className="px-4 py-3 text-right font-semibold">מחלקה</th>
                    <th className="px-4 py-3 text-center font-semibold">פתוחות</th>
                    <th className="px-4 py-3 text-center font-semibold">סגורות</th>
                    <th className="px-4 py-3 text-center font-semibold">סה״כ</th>
                  </tr>
                </thead>
                <tbody>
                  {agentSummaries.map((summary) => (
                    <tr
                      key={summary.agentId ?? summary.agentName}
                      className="cursor-pointer border-t border-[#edf1f3] hover:bg-[#f8fafb]"
                      onClick={() =>
                        setAgentFilter(
                          agentFilter === summary.agentName
                            ? ""
                            : summary.agentName,
                        )
                      }
                    >
                      <td className="px-5 py-3 font-medium text-[#17242d]">
                        {summary.agentName}
                        {agentFilter === summary.agentName && (
                          <span className="mr-2 text-xs text-[#158f83]">
                            (מסונן)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[#718087]">
                        {summary.departmentName ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-center font-bold text-[#c8434c]">
                        {summary.open}
                      </td>
                      <td className="px-4 py-3 text-center font-bold text-[#1f7a55]">
                        {summary.closed}
                      </td>
                      <td className="px-4 py-3 text-center font-bold text-[#17242d]">
                        {summary.total}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#edf1f3] bg-[#f8fafb] px-5 py-3.5">
              <h2 className="text-base font-bold text-[#17242d]">
                כל הפניות ({visibleRows.length})
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                {(["all", "open", "closed"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setStatusFilter(value)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      statusFilter === value
                        ? "bg-[#158f83] text-white"
                        : "bg-white text-[#5d6d75] hover:bg-[#eef2f3]"
                    }`}
                  >
                    {value === "all" ? "הכול" : value === "open" ? "פתוחות" : "סגורות"}
                  </button>
                ))}
                {agentFilter && (
                  <button
                    type="button"
                    onClick={() => setAgentFilter("")}
                    className="rounded-lg bg-[#fdebed] px-3 py-1.5 text-xs font-semibold text-[#c8434c]"
                  >
                    ניקוי סינון נציגה
                  </button>
                )}
              </div>
            </header>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-sm">
                <thead>
                  <tr className="text-[#5d6d75]">
                    <th className="px-5 py-3 text-right font-semibold">נוצרה</th>
                    <th className="px-4 py-3 text-right font-semibold">נציגה</th>
                    <th className="px-4 py-3 text-right font-semibold">לקוח</th>
                    <th className="px-4 py-3 text-right font-semibold">טלפון</th>
                    <th className="px-4 py-3 text-right font-semibold">נושא</th>
                    <th className="px-4 py-3 text-center font-semibold">סטטוס</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.slice(0, MAX_TABLE_ROWS).map((row) => (
                    <tr key={row.id} className="border-t border-[#edf1f3]">
                      <td className="whitespace-nowrap px-5 py-3 text-[#5d6d75]">
                        {formatIsraelDateTime(row.createdAt)}
                      </td>
                      <td className="px-4 py-3 font-medium text-[#17242d]">
                        {row.agentName ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-[#17242d]">
                        {row.customerName ?? "—"}
                      </td>
                      <td dir="ltr" className="px-4 py-3 text-right text-[#5d6d75]">
                        {formatPhone(row.customerPhone)}
                      </td>
                      <td className="max-w-[280px] truncate px-4 py-3 text-[#5d6d75]">
                        {row.subject ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-block rounded-lg px-2.5 py-1 text-xs font-bold ${
                            isClosed(row.status)
                              ? "bg-[#e7f6ee] text-[#1f7a55]"
                              : "bg-[#fdebed] text-[#c8434c]"
                          }`}
                        >
                          {statusLabel(row.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {visibleRows.length > MAX_TABLE_ROWS && (
              <p className="border-t border-[#edf1f3] px-5 py-3 text-xs text-[#a3adb1]">
                מוצגות {MAX_TABLE_ROWS} הפניות האחרונות מתוך {visibleRows.length}.
                צמצמו את טווח התאריכים או סננו לפי נציגה כדי לראות את השאר.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "neutral" | "open" | "closed";
}) {
  const colour =
    tone === "open"
      ? "text-[#c8434c]"
      : tone === "closed"
        ? "text-[#1f7a55]"
        : "text-[#17242d]";
  return (
    <div className="card p-5">
      <span className="text-sm text-[#718087]">{label}</span>
      <strong className={`mt-1 block text-3xl font-bold ${colour}`}>
        {value}
      </strong>
    </div>
  );
}
