"use client";

import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  LoaderCircle,
  MessageCircle,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatIsraelDateTime, jerusalemToday } from "@/lib/israel-time";
import { formatDuration, formatSecondsLabel } from "@/lib/metrics";
import { formatPhone, statusLabel } from "@/lib/tickets";
import {
  currentlyWaiting,
  waitingTier,
  waitingTierCounts,
  WAITING_TIER_MINUTES,
  type WaDashboardPayload,
  type WaitingTierMinutes,
  type WaTicketRow,
} from "@/lib/wa-dashboard";

const REFRESH_MS = 30_000;

function seconds(value: number | null): string {
  return value != null ? formatSecondsLabel(value) : "—";
}

function tierClasses(minutes: WaitingTierMinutes | null): string {
  switch (minutes) {
    case 10:
      return "bg-[#fdebed] text-[#c8434c]";
    case 7:
      return "bg-[#fdeee0] text-[#c1651f]";
    case 3:
      return "bg-[#fdf6df] text-[#9c7a1a]";
    default:
      return "bg-[#eef2f3] text-[#5d6d75]";
  }
}

function TierTile({ minutes, count }: { minutes: WaitingTierMinutes; count: number }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-4 py-4">
      <strong
        className={`flex h-14 w-14 items-center justify-center rounded-full text-2xl font-bold ${tierClasses(minutes)}`}
      >
        {count}
      </strong>
      <span className="text-xs font-semibold text-[#718087]">מעל {minutes} דק&apos;</span>
    </div>
  );
}

/**
 * Same-day WhatsApp performance: how long it took an agent to send a first
 * reply, and how long a ticket stayed open before reaching solved/closed.
 *
 * The headline figure is "לקוחות ממתינים לתגובה כרגע" — customers with no
 * agent reply yet, right now, broken into 3/7/10-minute escalation tiers with
 * who they're assigned to. The account owner asked for this ahead of the
 * close-time stats: it is the one number a manager can act on immediately by
 * nudging a specific agent, so it leads the page and ticks live every second
 * rather than waiting for the next 30-second poll.
 *
 * "First reply" and "closed" follow the definitions already established
 * elsewhere in this app: a comment counts once its author is the ticket's own
 * assignee ([[tickets]] — Zendesk's own reply metric is unusable here since
 * this team writes through the Aircall app), and "closed" means solved OR
 * closed, since this Zendesk only auto-archives to literal `closed` days
 * later.
 */
export function WaDashboardPageClient() {
  const [date, setDate] = useState(() => jerusalemToday());
  const [data, setData] = useState<WaDashboardPayload | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    setError("");
    try {
      const params = new URLSearchParams({ date });
      const response = await fetch(`/api/wa-dashboard?${params}`, {
        cache: "no-store",
      });
      const payload: WaDashboardPayload = await response.json();
      if (!response.ok) {
        throw new Error(
          (payload as unknown as { error?: string }).error ?? "load_failed",
        );
      }
      setData(payload);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "טעינת הנתונים נכשלה",
      );
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const poll = window.setInterval(() => void load(), REFRESH_MS);
    const clock = window.setInterval(() => setNow(new Date()), 1_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(poll);
      window.clearInterval(clock);
    };
  }, [load]);

  function changeDate(next: string) {
    setDate(next);
    setExpanded(null);
    setData(null);
    setLoading(true);
  }

  const ticketsByAgent = useMemo(() => {
    const map: Record<string, WaTicketRow[]> = {};
    for (const row of data?.rows ?? []) {
      const key = row.agentId ?? "unassigned";
      (map[key] ??= []).push(row);
    }
    return map;
  }, [data]);

  const waiting = useMemo(
    () => currentlyWaiting(data?.rows ?? [], now),
    [data?.rows, now],
  );
  const tiers = useMemo(() => waitingTierCounts(waiting), [waiting]);

  function toggle(agentKey: string) {
    setExpanded(expanded === agentKey ? null : agentKey);
  }

  const maxHourly = Math.max(1, ...(data?.hourly.map((b) => b.count) ?? [1]));
  const isToday = date === jerusalemToday();

  return (
    <div className="space-y-5">
      <header className="card flex flex-wrap items-center gap-4 p-5">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#e7f7f2] text-[#1f9d72]">
          <MessageCircle size={20} />
        </span>
        <div className="flex-1">
          <h1 className="text-lg font-bold">דשבורד WA</h1>
          <p className="mt-0.5 text-sm text-[#718087]">
            פניות וואטסאפ מ-Zendesk ליום זה: מי ממתין לתגובה כרגע, זמן
            תגובה ראשונה וזמן עד שהפנייה נפתרה/נסגרה.
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
          <section className="card overflow-hidden border-2 border-[#f3c1c6]">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#edf1f3] bg-[#fdebed] px-5 py-3.5">
              <h2 className="flex items-center gap-2 text-base font-bold text-[#8a2b32]">
                <AlertTriangle size={18} />
                לקוחות ממתינים לתגובה כרגע
              </h2>
              <strong className="text-lg font-bold text-[#8a2b32]">
                {waiting.length} ממתינים
              </strong>
            </header>

            <div className="grid grid-cols-3 divide-x divide-x-reverse divide-[#edf1f3] border-b border-[#edf1f3]">
              {WAITING_TIER_MINUTES.map((minutes) => (
                <TierTile key={minutes} minutes={minutes} count={tiers[minutes]} />
              ))}
            </div>

            {waiting.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-[#1f7a55]">
                כל הפניות של {isToday ? "היום" : date} קיבלו תגובה ראשונה.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <thead>
                    <tr className="text-[#5d6d75]">
                      <th className="px-4 py-2 text-right font-semibold">לקוח</th>
                      <th className="px-4 py-2 text-right font-semibold">טלפון</th>
                      <th className="px-4 py-2 text-right font-semibold">נציגה משויכת</th>
                      <th className="px-4 py-2 text-right font-semibold">מחלקה</th>
                      <th className="px-4 py-2 text-center font-semibold">ממתין</th>
                    </tr>
                  </thead>
                  <tbody>
                    {waiting.map((ticket) => (
                      <tr key={ticket.id} className="border-t border-[#edf1f3]">
                        <td className="px-4 py-2.5 text-[#17242d]">
                          {ticket.customerName ?? "—"}
                        </td>
                        <td dir="ltr" className="px-4 py-2.5 text-right text-[#5d6d75]">
                          {formatPhone(ticket.customerPhone)}
                        </td>
                        <td className="px-4 py-2.5 font-semibold text-[#17242d]">
                          {ticket.agentName ?? "ללא שיוך נציג"}
                        </td>
                        <td className="px-4 py-2.5 text-[#5d6d75]">
                          {ticket.departmentName ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span
                            className={`inline-block rounded-lg px-2.5 py-1 text-xs font-bold ${tierClasses(waitingTier(ticket.waitedSeconds))}`}
                          >
                            {formatDuration(ticket.waitedSeconds)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="card p-5">
              <span className="text-sm text-[#718087]">פניות וואטסאפ</span>
              <strong className="mt-1 block text-3xl font-bold text-[#17242d]">
                {data.totals.ticketCount}
              </strong>
            </div>
            <div className="card p-5">
              <span className="text-sm text-[#718087]">תגובה ראשונה ממוצעת</span>
              <strong className="mt-1 block text-3xl font-bold text-[#17242d]">
                {seconds(data.totals.avgFirstResponseSeconds)}
              </strong>
            </div>
            <div className="card p-5">
              <span className="text-sm text-[#718087]">זמן עד סגירה ממוצע</span>
              <strong className="mt-1 block text-3xl font-bold text-[#17242d]">
                {seconds(data.totals.avgTimeToCloseSeconds)}
              </strong>
            </div>
          </div>

          <p className="px-1 text-xs text-[#a3adb1]">
            {data.syncedAt
              ? `סונכרן לאחרונה: ${formatIsraelDateTime(data.syncedAt)}`
              : "טרם בוצע סנכרון"}
            {" · שעון ישראל"}
            {isToday && " · הרשימה למעלה מתעדכנת כל שנייה, שאר הנתונים כל 30 שניות"}
          </p>

          {data.byDepartment.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {data.byDepartment.map((dept) => (
                <div key={dept.departmentName} className="card p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <strong className="text-sm font-bold text-[#17242d]">
                      {dept.departmentName}
                    </strong>
                    <span className="text-xs text-[#a3adb1]">
                      {dept.ticketCount} פניות
                    </span>
                  </div>
                  <div className="flex items-end gap-5">
                    <div>
                      <span className="block text-[11px] text-[#a3adb1]">תגובה ראשונה</span>
                      <strong className="text-xl font-bold text-[#17242d]">
                        {seconds(dept.avgFirstResponseSeconds)}
                      </strong>
                    </div>
                    <div>
                      <span className="block text-[11px] text-[#a3adb1]">עד סגירה</span>
                      <strong className="text-xl font-bold text-[#5d6d75]">
                        {seconds(dept.avgTimeToCloseSeconds)}
                      </strong>
                    </div>
                    {dept.awaitingFirstResponse > 0 && (
                      <div>
                        <span className="block text-[11px] text-[#a3adb1]">טרם נענו</span>
                        <strong className="text-xl font-bold text-[#c8434c]">
                          {dept.awaitingFirstResponse}
                        </strong>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {data.hourly.some((b) => b.count > 0) && (
            <section className="card p-5">
              <h2 className="mb-3 text-base font-bold text-[#17242d]">
                נפח פניות וואטסאפ לפי שעה · {date}
              </h2>
              <div className="flex h-24 items-end gap-1">
                {data.hourly.map((bucket) => (
                  <div
                    key={bucket.hour}
                    className="flex-1 rounded-t bg-[#1f9d72]/70"
                    style={{ height: `${(bucket.count / maxHourly) * 100}%` }}
                    title={`${bucket.hour}:00 · ${bucket.count} פניות`}
                  />
                ))}
              </div>
            </section>
          )}

          <section className="card overflow-hidden">
            <header className="border-b border-[#edf1f3] bg-[#f8fafb] px-5 py-3.5">
              <h2 className="text-base font-bold text-[#17242d]">
                פירוט לפי נציגה
              </h2>
            </header>

            {data.byAgent.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-[#1f7a55]">
                אין פניות וואטסאפ ביום זה.
              </p>
            ) : (
              <ul className="divide-y divide-[#edf1f3]">
                {data.byAgent.map((row) => {
                  const key = row.agentId ?? "unassigned";
                  const isOpen = expanded === key;
                  const tickets = ticketsByAgent[key] ?? [];
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        onClick={() => toggle(key)}
                        aria-expanded={isOpen}
                        className={`flex w-full flex-wrap items-center gap-3 px-5 py-4 text-right transition ${
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
                        <span className="text-xs text-[#a3adb1]">תגובה</span>
                        <span className="text-sm text-[#5d6d75]">
                          {seconds(row.avgFirstResponseSeconds)}
                        </span>
                        <span className="text-xs text-[#a3adb1]">סגירה</span>
                        <span className="text-sm text-[#5d6d75]">
                          {seconds(row.avgTimeToCloseSeconds)}
                        </span>
                        <span className="min-w-[3.5rem] rounded-lg bg-[#eef2f3] px-3 py-1 text-center text-sm font-bold text-[#5d6d75]">
                          {row.ticketCount}
                        </span>
                        {row.awaitingFirstResponse > 0 && (
                          <span className="min-w-[3.5rem] rounded-lg bg-[#fdebed] px-3 py-1 text-center text-sm font-bold text-[#c8434c]">
                            {row.awaitingFirstResponse}
                          </span>
                        )}
                      </button>

                      {isOpen && (
                        <div className="border-t border-[#edf1f3] bg-[#fbfcfd] px-5 py-4">
                          {tickets.length > 0 ? (
                            <div className="overflow-x-auto">
                              <table className="w-full min-w-[820px] border-collapse text-sm">
                                <thead>
                                  <tr className="text-[#5d6d75]">
                                    <th className="px-3 py-2 text-right font-semibold">מס׳ פנייה</th>
                                    <th className="px-3 py-2 text-right font-semibold">שם הלקוח</th>
                                    <th className="px-3 py-2 text-right font-semibold">טלפון</th>
                                    <th className="px-3 py-2 text-center font-semibold">תגובה ראשונה</th>
                                    <th className="px-3 py-2 text-center font-semibold">סטטוס</th>
                                    <th className="px-3 py-2 text-center font-semibold">עד סגירה</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {tickets.map((ticket) => {
                                    const stillWaiting =
                                      ticket.firstResponseSeconds == null && !ticket.closed;
                                    const liveWaitedSeconds = stillWaiting
                                      ? Math.max(
                                          0,
                                          Math.floor(
                                            (now.getTime() - new Date(ticket.createdAt).getTime()) / 1000,
                                          ),
                                        )
                                      : null;
                                    return (
                                      <tr key={ticket.id} className="border-t border-[#edf1f3]">
                                        <td dir="ltr" className="px-3 py-2.5 text-right font-mono text-xs font-bold text-[#17242d]">
                                          #{ticket.id}
                                        </td>
                                        <td className="px-3 py-2.5 text-[#17242d]">
                                          {ticket.customerName ?? "—"}
                                        </td>
                                        <td dir="ltr" className="px-3 py-2.5 text-right text-[#5d6d75]">
                                          {formatPhone(ticket.customerPhone)}
                                        </td>
                                        <td className="px-3 py-2.5 text-center">
                                          {ticket.firstResponseSeconds != null ? (
                                            <span className="inline-block rounded-lg bg-[#eef2f3] px-2.5 py-1 text-xs font-bold text-[#5d6d75]">
                                              {formatSecondsLabel(ticket.firstResponseSeconds)}
                                            </span>
                                          ) : liveWaitedSeconds != null ? (
                                            <span
                                              className={`inline-block rounded-lg px-2.5 py-1 text-xs font-bold ${tierClasses(waitingTier(liveWaitedSeconds))}`}
                                            >
                                              ממתין {formatDuration(liveWaitedSeconds)}
                                            </span>
                                          ) : (
                                            <span className="inline-block rounded-lg bg-[#eef2f3] px-2.5 py-1 text-xs font-bold text-[#5d6d75]">
                                              נסגרה ללא תגובה
                                            </span>
                                          )}
                                        </td>
                                        <td className="px-3 py-2.5 text-center">
                                          <span className="inline-block rounded-lg bg-[#eef2f3] px-2.5 py-1 text-xs font-bold text-[#5d6d75]">
                                            {statusLabel(ticket.status)}
                                          </span>
                                        </td>
                                        <td className="px-3 py-2.5 text-center text-[#5d6d75]">
                                          {ticket.timeToCloseSeconds != null
                                            ? formatSecondsLabel(ticket.timeToCloseSeconds)
                                            : "עדיין פתוחה"}
                                        </td>
                                      </tr>
                                    );
                                  })}
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
