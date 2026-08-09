"use client";

import {
  ChevronDown,
  ChevronLeft,
  FileWarning,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { formatIsraelDateTime, jerusalemToday } from "@/lib/israel-time";
import {
  formatPhone,
  statusLabel,
  type AgentTicketSummary,
  type TicketRow,
  type TicketsPayload,
} from "@/lib/tickets";

const REFRESH_MS = 30_000;

/**
 * The day's undocumented tickets, by agent.
 *
 * The counts come from the summary the database already aggregates, so opening
 * the page costs one small request no matter how many tickets the day holds. An
 * agent's actual tickets are fetched only when their row is expanded — a busy
 * day runs past a thousand tickets, and shipping them all up front to show a
 * handful of counts is what made the parent page slow enough to need fixing.
 */
export function OpenTicketsPageClient() {
  const [date, setDate] = useState(() => jerusalemToday());
  const [summary, setSummary] = useState<AgentTicketSummary[] | null>(null);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [ticketsByAgent, setTicketsByAgent] = useState<
    Record<string, TicketRow[]>
  >({});
  const [loadingAgent, setLoadingAgent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadSummary = useCallback(async () => {
    setError("");
    try {
      const params = new URLSearchParams({ from: date, to: date });
      const response = await fetch(`/api/zendesk-tickets?${params}`, {
        cache: "no-store",
      });
      const payload: TicketsPayload = await response.json();
      if (!response.ok) {
        throw new Error(
          (payload as unknown as { error?: string }).error ?? "load_failed",
        );
      }
      setSummary(payload.summary ?? []);
      setSyncedAt(payload.syncedAt ?? null);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "טעינת הפניות נכשלה",
      );
    } finally {
      setLoading(false);
    }
  }, [date]);

  const loadAgentTickets = useCallback(
    async (agentKey: string) => {
      setLoadingAgent(agentKey);
      try {
        const params = new URLSearchParams({
          from: date,
          to: date,
          documented: "no",
          agentId: agentKey,
        });
        const response = await fetch(`/api/zendesk-tickets?${params}`, {
          cache: "no-store",
        });
        const payload: TicketsPayload = await response.json();
        if (!response.ok) throw new Error("load_failed");
        setTicketsByAgent((previous) => ({
          ...previous,
          [agentKey]: payload.rows ?? [],
        }));
      } catch {
        setError("טעינת הפניות של הנציגה נכשלה");
      } finally {
        setLoadingAgent(null);
      }
    },
    [date],
  );

  useEffect(() => {
    // Deferred a tick so the synchronous setState inside the loader does not
    // cascade into the render.
    const initial = window.setTimeout(() => void loadSummary(), 0);
    const poll = window.setInterval(() => void loadSummary(), REFRESH_MS);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(poll);
    };
  }, [loadSummary]);

  /** Changing the day invalidates anything already fetched for the old one. */
  function changeDate(next: string) {
    setDate(next);
    setExpanded(null);
    setTicketsByAgent({});
  }

  function toggle(agentKey: string) {
    if (expanded === agentKey) {
      setExpanded(null);
      return;
    }
    setExpanded(agentKey);
    if (!ticketsByAgent[agentKey]) void loadAgentTickets(agentKey);
  }

  // Only agents who actually left something undocumented belong on this page.
  const offenders = (summary ?? [])
    .filter((row) => row.undocumented > 0)
    .sort((a, b) => b.undocumented - a.undocumented);
  const totalUndocumented = offenders.reduce(
    (sum, row) => sum + row.undocumented,
    0,
  );

  return (
    <div className="space-y-5">
      <header className="card flex flex-wrap items-center gap-4 p-5">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#fdebed] text-[#c8434c]">
          <FileWarning size={20} />
        </span>
        <div className="flex-1">
          <h1 className="text-lg font-bold">פניות פתוחות</h1>
          <p className="mt-0.5 text-sm text-[#718087]">
            פניות שהנציגה לא תיעדה בהן דבר, בכל סטטוס. לחיצה על שם נציגה
            פותחת את הפניות שלה.
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <span className="font-semibold text-[#5d6d75]">תאריך</span>
          <input
            type="date"
            value={date}
            max={jerusalemToday()}
            onChange={(event) => changeDate(event.target.value)}
            className="rounded-xl border border-[#dfe6ea] bg-[#f8fafb] px-3 py-2 text-sm outline-none focus:border-[#158f83]"
          />
        </label>
        <button
          type="button"
          onClick={() => void loadSummary()}
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

      {loading && !summary && (
        <div className="card flex min-h-40 items-center justify-center p-8">
          <LoaderCircle className="animate-spin text-[#158f83]" size={28} />
        </div>
      )}

      {summary && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="card p-5">
              <span className="text-sm text-[#718087]">
                פניות ללא תיעוד ביום זה
              </span>
              <strong className="mt-1 block text-3xl font-bold text-[#c8434c]">
                {totalUndocumented}
              </strong>
            </div>
            <div className="card p-5">
              <span className="text-sm text-[#718087]">נציגות עם חוסר תיעוד</span>
              <strong className="mt-1 block text-3xl font-bold text-[#17242d]">
                {offenders.length}
              </strong>
            </div>
          </div>

          <p className="px-1 text-xs text-[#a3adb1]">
            {syncedAt
              ? `סונכרן לאחרונה: ${formatIsraelDateTime(syncedAt)}`
              : "טרם בוצע סנכרון"}
            {" · שעון ישראל · המסך מתרענן כל 30 שניות"}
          </p>

          <section className="card overflow-hidden">
            <header className="border-b border-[#edf1f3] bg-[#f8fafb] px-5 py-3.5">
              <h2 className="text-base font-bold text-[#17242d]">
                נציגות שלא תיעדו
              </h2>
            </header>

            {offenders.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-[#1f7a55]">
                כל הפניות של היום תועדו.
              </p>
            ) : (
              <ul className="divide-y divide-[#edf1f3]">
                {offenders.map((row) => {
                  const key = row.agentId ?? "unassigned";
                  const isOpen = expanded === key;
                  const tickets = ticketsByAgent[key];
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        onClick={() => toggle(key)}
                        aria-expanded={isOpen}
                        className={`flex w-full items-center gap-3 px-5 py-4 text-right transition ${
                          isOpen ? "bg-[#f8fafb]" : "hover:bg-[#f8fafb]"
                        }`}
                      >
                        {isOpen ? (
                          <ChevronDown size={18} className="text-[#5d6d75]" />
                        ) : (
                          <ChevronLeft size={18} className="text-[#a3adb1]" />
                        )}
                        <span className="flex-1 font-bold text-[#17242d]">
                          {row.agentName}
                        </span>
                        <span className="text-sm text-[#718087]">
                          {row.departmentName ?? "—"}
                        </span>
                        <span className="min-w-[3.5rem] rounded-lg bg-[#fdebed] px-3 py-1 text-center text-sm font-bold text-[#c8434c]">
                          {row.undocumented}
                        </span>
                      </button>

                      {isOpen && (
                        <div className="border-t border-[#edf1f3] bg-[#fbfcfd] px-5 py-4">
                          {loadingAgent === key && !tickets ? (
                            <div className="flex justify-center py-6">
                              <LoaderCircle
                                className="animate-spin text-[#158f83]"
                                size={22}
                              />
                            </div>
                          ) : tickets && tickets.length > 0 ? (
                            <div className="overflow-x-auto">
                              <table className="w-full min-w-[720px] border-collapse text-sm">
                                <thead>
                                  <tr className="text-[#5d6d75]">
                                    <th className="px-3 py-2 text-right font-semibold">
                                      מס׳ פנייה
                                    </th>
                                    <th className="px-3 py-2 text-right font-semibold">
                                      שם הלקוח
                                    </th>
                                    <th className="px-3 py-2 text-right font-semibold">
                                      טלפון
                                    </th>
                                    <th className="whitespace-nowrap px-3 py-2 text-right font-semibold">
                                      תאריך ושעה
                                    </th>
                                    <th className="px-3 py-2 text-center font-semibold">
                                      סטטוס
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {tickets.map((ticket) => (
                                    <tr
                                      key={ticket.id}
                                      className="border-t border-[#edf1f3]"
                                    >
                                      <td
                                        dir="ltr"
                                        className="px-3 py-2.5 text-right font-mono text-xs font-bold text-[#17242d]"
                                      >
                                        #{ticket.id}
                                      </td>
                                      <td className="px-3 py-2.5 text-[#17242d]">
                                        {ticket.customerName ?? "—"}
                                      </td>
                                      <td
                                        dir="ltr"
                                        className="px-3 py-2.5 text-right text-[#5d6d75]"
                                      >
                                        {formatPhone(ticket.customerPhone)}
                                      </td>
                                      <td className="whitespace-nowrap px-3 py-2.5 text-[#5d6d75]">
                                        {formatIsraelDateTime(ticket.createdAt)}
                                      </td>
                                      <td className="px-3 py-2.5 text-center">
                                        <span className="inline-block rounded-lg bg-[#eef2f3] px-2.5 py-1 text-xs font-bold text-[#5d6d75]">
                                          {statusLabel(ticket.status)}
                                        </span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <p className="py-4 text-center text-sm text-[#a3adb1]">
                              אין פניות להצגה.
                            </p>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
