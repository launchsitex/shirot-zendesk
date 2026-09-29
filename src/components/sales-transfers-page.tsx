"use client";

import {
  ChevronDown,
  ChevronLeft,
  LoaderCircle,
  PhoneForwarded,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { jerusalemToday } from "@/lib/israel-time";
import {
  CATEGORY_META,
  SALES_TRANSFER_CATEGORIES,
  percent,
  summarizeTransfers,
  waitingMinutesAtTransfer,
  type SalesTransferCategory,
  type SalesTransferDailyRow,
  type SalesTransferRow,
  type SalesTransfersPayload,
} from "@/lib/sales-transfers";
import { formatPhone, STATUS_LABELS } from "@/lib/tickets";

const REFRESH_MS = 15_000;
const ZENDESK_TICKET_URL = "https://rcity.zendesk.com/agent/tickets/";

const timeFormatter = new Intl.DateTimeFormat("he-IL", {
  timeZone: "Asia/Jerusalem",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const weekdayFormatter = new Intl.DateTimeFormat("he-IL", {
  timeZone: "UTC",
  weekday: "short",
});

function timeLabel(iso: string | null) {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : timeFormatter.format(date);
}

function dayLabel(day: string) {
  const [year, month, date] = day.split("-").map(Number);
  const weekday = weekdayFormatter.format(new Date(Date.UTC(year, month - 1, date)));
  return `${String(date).padStart(2, "0")}.${String(month).padStart(2, "0")} ${weekday}`;
}

function formatWait(minutes: number) {
  if (minutes < 60) return `${minutes} דק'`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} ש' ${rest} דק'` : `${hours} ש'`;
}

function CategoryChip({ category }: { category: SalesTransferCategory | null }) {
  if (!category) {
    return (
      <span className="inline-block whitespace-nowrap rounded-lg bg-[#f4f6f7] px-2.5 py-1 text-xs font-bold text-[#a3adb1]">
        מסווג…
      </span>
    );
  }
  const meta = CATEGORY_META[category];
  return (
    <span
      title={meta.hint}
      className={`inline-block whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-bold ${meta.tone}`}
    >
      {meta.label}
    </span>
  );
}

type TrendDay = {
  day: string;
  transfers: number;
  episodes: number;
  byCategory: Partial<Record<SalesTransferCategory, number>>;
};

function buildTrend(daily: SalesTransferDailyRow[]): TrendDay[] {
  const days = new Map<string, TrendDay>();
  for (const row of daily) {
    let entry = days.get(row.day);
    if (!entry) {
      entry = { day: row.day, transfers: 0, episodes: 0, byCategory: {} };
      days.set(row.day, entry);
    }
    entry.transfers += row.transfers;
    entry.episodes += row.episodes;
    if (row.category) {
      entry.byCategory[row.category] =
        (entry.byCategory[row.category] ?? 0) + row.episodes;
    }
  }
  return [...days.values()].sort((a, b) => b.day.localeCompare(a.day));
}

/**
 * Live view of service customers the national sales centre had to transfer
 * on to service, each stamped with the customer's state with us at that
 * moment — so it is visible why service calls keep landing on sales.
 */
export function SalesTransfersPageClient() {
  const [date, setDate] = useState(() => jerusalemToday());
  const [payload, setPayload] = useState<SalesTransfersPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [openCategory, setOpenCategory] = useState<SalesTransferCategory | null>(
    null,
  );

  const load = useCallback(async () => {
    setError("");
    try {
      const params = new URLSearchParams({ date });
      const response = await fetch(`/api/sales-transfers?${params}`, {
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "load_failed");
      setPayload(result as SalesTransfersPayload);
      setUpdatedAt(new Date());
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "טעינת ההעברות נכשלה",
      );
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const poll = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(poll);
    };
  }, [load]);

  const rows = useMemo(() => payload?.rows ?? [], [payload]);
  const summary = useMemo(() => summarizeTransfers(rows), [rows]);
  const trend = useMemo(() => buildTrend(payload?.daily ?? []), [payload]);
  const isToday = date === jerusalemToday();

  return (
    <div className="space-y-5">
      <header className="card flex flex-wrap items-center gap-4 p-5">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#e8f1fb] text-[#2f6db5]">
          <PhoneForwarded size={20} />
        </span>
        <div className="flex-1">
          <h1 className="text-lg font-bold">העברות מהמכירות לשירות</h1>
          <p className="mt-0.5 text-sm text-[#718087]">
            לקוחות שירות שהגיעו למוקד המכירות והועברו לשירות, ומה היה המצב
            שלהם אצלנו ברגע ההעברה.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="font-semibold text-[#5d6d75]">תאריך</span>
          <input
            type="date"
            value={date}
            max={jerusalemToday()}
            onChange={(event) => {
              setDate(event.target.value);
              setLoading(true);
            }}
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

      {loading && !payload ? (
        <div className="card flex min-h-40 items-center justify-center p-8">
          <LoaderCircle className="animate-spin text-[#158f83]" size={28} />
        </div>
      ) : (
        payload && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="card p-5">
                <span className="text-sm text-[#718087]">
                  העברות {isToday ? "היום" : "ביום זה"}
                </span>
                <strong className="mt-1 block text-3xl font-bold text-[#17242d]">
                  {summary.transfers}
                </strong>
                <span className="text-xs text-[#a3adb1]">
                  {`${summary.customers} לקוחות · ${summary.episodes} פניות (אחרי איחוד חוזרות תוך 30 דק')`}
                </span>
              </div>
              <div className="card p-5">
                <span className="text-sm text-[#718087]">ממתינים לתגובה שלנו</span>
                <strong className="mt-1 block text-3xl font-bold text-[#c8434c]">
                  {summary.byCategory.waiting_on_us}
                </strong>
                <span className="text-xs text-[#a3adb1]">
                  {percent(summary.byCategory.waiting_on_us, summary.episodes)} מהפניות
                </span>
              </div>
              <div className="card p-5">
                <span className="text-sm text-[#718087]">ללא שום היסטוריה אצלנו</span>
                <strong className="mt-1 block text-3xl font-bold text-[#17242d]">
                  {summary.byCategory.no_history}
                </strong>
                <span className="text-xs text-[#a3adb1]">
                  {percent(summary.byCategory.no_history, summary.episodes)} מהפניות ·
                  חייגו ישר למכירות
                </span>
              </div>
              <div className="card p-5">
                <span className="text-sm text-[#718087]">
                  פתחו וואטסאפ אחרי ההעברה
                </span>
                <strong className="mt-1 block text-3xl font-bold text-[#1f7a55]">
                  {summary.openedWhatsappAfter}
                </strong>
                <span className="text-xs text-[#a3adb1]">
                  {percent(summary.openedWhatsappAfter, summary.episodes)} מהפניות · תוך
                  12 שעות
                </span>
              </div>
            </div>

            <p className="px-1 text-xs text-[#a3adb1]">
              {updatedAt ? `עודכן ${timeLabel(updatedAt.toISOString())}` : ""}
              {" · שעון ישראל · המסך מתרענן כל 15 שניות · הסיבה נקבעת לפי מצב הלקוח ברגע ההעברה ומתקבעת אחרי 3 דק'"}
            </p>

            <div className="grid gap-5 xl:grid-cols-2">
              <section className="card overflow-hidden">
                <header className="border-b border-[#edf1f3] bg-[#f8fafb] px-5 py-3.5">
                  <h2 className="text-base font-bold text-[#17242d]">
                    למה הגיעו למכירות
                  </h2>
                </header>
                <ul className="divide-y divide-[#edf1f3]">
                  {SALES_TRANSFER_CATEGORIES.map((category) => {
                    const count = summary.byCategory[category];
                    const share = summary.episodes ? count / summary.episodes : 0;
                    const isOpen = openCategory === category;
                    return (
                      <li key={category}>
                        <button
                          type="button"
                          onClick={() => setOpenCategory(isOpen ? null : category)}
                          aria-expanded={isOpen}
                          disabled={count === 0}
                          className={`block w-full px-5 py-3 text-right transition ${
                            isOpen ? "bg-[#f8fafb]" : "hover:bg-[#f8fafb]"
                          } disabled:cursor-default disabled:hover:bg-transparent`}
                        >
                          <div className="flex items-center gap-3">
                            {isOpen ? (
                              <ChevronDown size={16} className="text-[#5d6d75]" />
                            ) : (
                              <ChevronLeft
                                size={16}
                                className={count ? "text-[#a3adb1]" : "text-transparent"}
                              />
                            )}
                            <CategoryChip category={category} />
                            <span className="flex-1 text-xs text-[#718087]">
                              {CATEGORY_META[category].hint}
                            </span>
                            <strong className="text-sm text-[#17242d]">{count}</strong>
                            <span className="w-10 text-left text-xs text-[#a3adb1]">
                              {percent(count, summary.episodes)}
                            </span>
                          </div>
                          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#f1f4f5]">
                            <div
                              className="h-full rounded-full bg-[#158f83]"
                              style={{ width: `${Math.round(share * 100)}%` }}
                            />
                          </div>
                        </button>
                        {isOpen && (
                          <CategoryTransfers
                            rows={rows.filter(
                              (row) => !row.isRepeat && row.category === category,
                            )}
                          />
                        )}
                      </li>
                    );
                  })}
                  {summary.byCategory.pending > 0 && (
                    <li className="px-5 py-3 text-xs text-[#a3adb1]">
                      עוד {summary.byCategory.pending} בסיווג
                    </li>
                  )}
                </ul>
              </section>

              <section className="card overflow-hidden">
                <header className="border-b border-[#edf1f3] bg-[#f8fafb] px-5 py-3.5">
                  <h2 className="text-base font-bold text-[#17242d]">לפי מוכר</h2>
                </header>
                {summary.byAgent.length === 0 ? (
                  <p className="px-5 py-10 text-center text-sm text-[#a3adb1]">
                    אין העברות ביום זה.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] border-collapse text-sm">
                      <thead>
                        <tr className="text-[#5d6d75]">
                          <th className="px-4 py-2.5 text-right font-semibold">מוכר</th>
                          <th className="px-3 py-2.5 text-center font-semibold">העברות</th>
                          <th className="px-3 py-2.5 text-center font-semibold">
                            ממתין לנו
                          </th>
                          <th className="px-3 py-2.5 text-center font-semibold">
                            בטיפול / נסגרה
                          </th>
                          <th className="px-3 py-2.5 text-center font-semibold">
                            ללא היסטוריה
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.byAgent.map((agent) => (
                          <tr key={agent.agent} className="border-t border-[#edf1f3]">
                            <td className="px-4 py-2.5 font-bold text-[#17242d]">
                              {agent.agent}
                            </td>
                            <td className="px-3 py-2.5 text-center">{agent.transfers}</td>
                            <td className="px-3 py-2.5 text-center text-[#c8434c]">
                              {agent.byCategory.waiting_on_us}
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              {agent.byCategory.in_progress +
                                agent.byCategory.recently_solved}
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              {agent.byCategory.no_history}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>

            <section className="card overflow-hidden">
              <header className="border-b border-[#edf1f3] bg-[#f8fafb] px-5 py-3.5">
                <h2 className="text-base font-bold text-[#17242d]">
                  העברות {isToday ? "היום" : "ביום זה"} ({rows.length})
                </h2>
              </header>
              {rows.length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-[#a3adb1]">
                  אין העברות ביום זה.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[980px] border-collapse text-sm">
                    <thead>
                      <tr className="text-[#5d6d75]">
                        <th className="px-4 py-2.5 text-right font-semibold">שעה</th>
                        <th className="px-3 py-2.5 text-right font-semibold">מוכר</th>
                        <th className="px-3 py-2.5 text-right font-semibold">לקוח</th>
                        <th className="px-3 py-2.5 text-right font-semibold">סיבה</th>
                        <th className="px-3 py-2.5 text-right font-semibold">
                          פנייה בזנדסק
                        </th>
                        <th className="px-3 py-2.5 text-right font-semibold">פרטים</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <TransferRow key={row.id} row={row} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="card overflow-hidden">
              <header className="border-b border-[#edf1f3] bg-[#f8fafb] px-5 py-3.5">
                <h2 className="text-base font-bold text-[#17242d]">
                  מגמה - 14 ימים
                </h2>
              </header>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-sm">
                  <thead>
                    <tr className="text-[#5d6d75]">
                      <th className="px-4 py-2.5 text-right font-semibold">יום</th>
                      <th className="px-3 py-2.5 text-center font-semibold">העברות</th>
                      <th className="px-3 py-2.5 text-center font-semibold">פניות</th>
                      {SALES_TRANSFER_CATEGORIES.map((category) => (
                        <th
                          key={category}
                          className="px-3 py-2.5 text-center text-xs font-semibold"
                        >
                          {CATEGORY_META[category].label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {trend.map((day) => (
                      <tr
                        key={day.day}
                        className={`border-t border-[#edf1f3] ${
                          day.day === date ? "bg-[#f3faf9]" : ""
                        }`}
                      >
                        <td className="whitespace-nowrap px-4 py-2.5 font-semibold text-[#17242d]">
                          {dayLabel(day.day)}
                        </td>
                        <td className="px-3 py-2.5 text-center">{day.transfers}</td>
                        <td className="px-3 py-2.5 text-center">{day.episodes}</td>
                        {SALES_TRANSFER_CATEGORIES.map((category) => {
                          const count = day.byCategory[category] ?? 0;
                          return (
                            <td key={category} className="px-3 py-2.5 text-center">
                              {count}
                              <span className="mr-1 text-xs text-[#a3adb1]">
                                {percent(count, day.episodes)}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )
      )}
    </div>
  );
}

function TicketLink({ id }: { id: string }) {
  return (
    <a
      href={`${ZENDESK_TICKET_URL}${encodeURIComponent(id)}`}
      target="_blank"
      rel="noopener noreferrer"
      dir="ltr"
      className="font-mono text-xs font-bold text-[#158f83] underline-offset-2 hover:underline"
    >
      #{id}
    </a>
  );
}

function CategoryTransfers({ rows }: { rows: SalesTransferRow[] }) {
  return (
    <div className="border-t border-[#edf1f3] bg-[#fbfcfd] px-5 py-3">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-xs">
          <thead>
            <tr className="text-[#5d6d75]">
              <th className="px-2 py-1.5 text-right font-semibold">שעה</th>
              <th className="px-2 py-1.5 text-right font-semibold">מוכר</th>
              <th className="px-2 py-1.5 text-right font-semibold">לקוח</th>
              <th className="px-2 py-1.5 text-right font-semibold">פנייה</th>
              <th className="px-2 py-1.5 text-right font-semibold">אצל נציגה</th>
              <th className="px-2 py-1.5 text-right font-semibold">וואטסאפ אחרי</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const waited = waitingMinutesAtTransfer(row);
              return (
                <tr key={row.id} className="border-t border-[#edf1f3]">
                  <td className="whitespace-nowrap px-2 py-1.5 font-semibold text-[#17242d]">
                    {timeLabel(row.transferredAt)}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-[#17242d]">
                    {row.salesAgent ?? "—"}
                  </td>
                  <td className="px-2 py-1.5">
                    <span className="text-[#17242d]">{row.customerName ?? ""}</span>{" "}
                    <span dir="ltr" className="text-[#718087]">
                      {formatPhone(row.phone)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    {row.ticketId ? (
                      <>
                        <TicketLink id={row.ticketId} />
                        {waited !== null && (
                          <span className="mr-1.5 text-[#c8434c]">
                            ממתין {formatWait(waited)}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-[#a3adb1]">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-[#17242d]">
                    {row.ticketId ? (
                      (row.ticketAgentName ?? (
                        <span className="text-[#c8434c]">ללא שיוך</span>
                      ))
                    ) : (
                      <span className="text-[#a3adb1]">—</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    {row.waAfterTicketId ? (
                      <>
                        <TicketLink id={row.waAfterTicketId} />
                        <span className="mr-1.5 text-[#718087]">
                          {timeLabel(row.waAfterAt)}
                        </span>
                      </>
                    ) : (
                      <span className="text-[#a3adb1]">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TransferRow({ row }: { row: SalesTransferRow }) {
  const waited = waitingMinutesAtTransfer(row);
  const notes: string[] = [];
  if (waited !== null) notes.push(`ממתין ${formatWait(waited)} לתגובה`);
  if (row.calledDeliveries24h) notes.push("התקשר לאספקות ב-24 שעות");
  if (row.waAfterTicketId) {
    notes.push(`פתח וואטסאפ ב-${timeLabel(row.waAfterAt)} (#${row.waAfterTicketId})`);
  }

  return (
    <tr className={`border-t border-[#edf1f3] ${row.isRepeat ? "opacity-60" : ""}`}>
      <td className="whitespace-nowrap px-4 py-2.5 font-semibold text-[#17242d]">
        {timeLabel(row.transferredAt)}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-[#17242d]">
        {row.salesAgent ?? "—"}
      </td>
      <td className="px-3 py-2.5">
        <span className="block text-[#17242d]">{row.customerName ?? "—"}</span>
        <span dir="ltr" className="block text-right text-xs text-[#718087]">
          {formatPhone(row.phone)}
        </span>
      </td>
      <td className="px-3 py-2.5">
        {row.isRepeat ? (
          <span className="inline-block whitespace-nowrap rounded-lg bg-[#f4f6f7] px-2.5 py-1 text-xs font-bold text-[#718087]">
            העברה חוזרת
          </span>
        ) : (
          <CategoryChip category={row.category} />
        )}
      </td>
      <td className="px-3 py-2.5">
        {row.ticketId ? (
          <>
            <span className="block">
              <TicketLink id={row.ticketId} />
            </span>
            <span className="block text-xs text-[#718087]">
              {[
                row.ticketAgentName ?? "ללא שיוך",
                row.ticketDepartment,
                row.ticketStatus ? (STATUS_LABELS[row.ticketStatus] ?? row.ticketStatus) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </>
        ) : (
          <span className="text-[#a3adb1]">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-xs text-[#5d6d75]">
        {notes.length ? notes.join(" · ") : "—"}
      </td>
    </tr>
  );
}
