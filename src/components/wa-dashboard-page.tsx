"use client";

import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  LoaderCircle,
  MessageCircle,
  RefreshCw,
  Timer,
  UsersRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatIsraelDateTime, jerusalemToday } from "@/lib/israel-time";
import { formatDuration, formatSecondsLabel } from "@/lib/metrics";
import { formatPhone, statusLabel } from "@/lib/tickets";
import {
  currentlyWaiting,
  firstResponseElapsed,
  firstResponseTierCounts,
  hourlyBuckets,
  summarizeByDepartment,
  summarizeTickets,
  waitingTier,
  WAITING_TIER_MINUTES,
  type WaDashboardPayload,
  type WaitingTierMinutes,
  type WaTicketRow,
} from "@/lib/wa-dashboard";

const REFRESH_MS = 30_000;
// Which agents the viewer has taken out of the figures. Kept per browser so
// a manager who only follows their own team does not re-tick it every visit.
const EXCLUDED_AGENTS_KEY = "wa-dashboard:excluded-agents";

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

function readExcludedAgents(): string[] {
  try {
    const raw = window.localStorage.getItem(EXCLUDED_AGENTS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Same-day WhatsApp performance for the customer-service department.
 *
 * Leads with "לקוחות ממתינים לתגובה כרגע" — customers whose latest message
 * has no agent reply yet, live, with who they're assigned to — because that
 * is what a manager acts on right now. Next comes first response: how long
 * from the bot handing a conversation to the agents until a person's first
 * message, as an average and as how many tickets crossed 3/7/10 minutes
 * (tickets still unanswered count live). Then close time and the per-agent
 * breakdown.
 *
 * Every figure on the page honours the agent picker: excluded agents' tickets
 * drop out of the averages, tiers, lists and charts alike, recomputed
 * client-side from the same rows the API returns.
 *
 * Definitions live in src/lib/wa-dashboard.ts. Scoped server-side to the
 * Customer Service department — see DEPARTMENT_FILTER_ID in the API route.
 */
export function WaDashboardPageClient() {
  const [date, setDate] = useState(() => jerusalemToday());
  const [data, setData] = useState<WaDashboardPayload | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => new Date());
  const [excluded, setExcluded] = useState<string[]>([]);

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
    // Read after mount so the server render and the first client render match.
    const stored = readExcludedAgents();
    if (stored.length) {
      const timer = window.setTimeout(() => setExcluded(stored), 0);
      return () => window.clearTimeout(timer);
    }
  }, []);

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

  function updateExcluded(next: string[]) {
    setExcluded(next);
    try {
      window.localStorage.setItem(EXCLUDED_AGENTS_KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable — the choice simply lasts until the next visit.
    }
  }

  function toggleAgent(key: string) {
    updateExcluded(
      excluded.includes(key)
        ? excluded.filter((item) => item !== key)
        : [...excluded, key],
    );
  }

  // Everything below derives from the visible rows, so excluding an agent
  // changes every number on the page consistently.
  const allAgents = useMemo(() => data?.byAgent ?? [], [data?.byAgent]);
  const visibleRows = useMemo(
    () =>
      (data?.rows ?? []).filter(
        (row) => !excluded.includes(row.agentId ?? "unassigned"),
      ),
    [data?.rows, excluded],
  );
  const totals = useMemo(() => summarizeTickets(visibleRows), [visibleRows]);
  const byAgent = useMemo(
    () => allAgents.filter((row) => !excluded.includes(row.agentId ?? "unassigned")),
    [allAgents, excluded],
  );
  const byDepartment = useMemo(
    () => summarizeByDepartment(visibleRows),
    [visibleRows],
  );
  const hourly = useMemo(() => hourlyBuckets(visibleRows), [visibleRows]);
  const ticketsByAgent = useMemo(() => {
    const map: Record<string, WaTicketRow[]> = {};
    for (const row of visibleRows) {
      const key = row.agentId ?? "unassigned";
      (map[key] ??= []).push(row);
    }
    return map;
  }, [visibleRows]);

  const waiting = useMemo(
    () => currentlyWaiting(visibleRows, now),
    [visibleRows, now],
  );
  const firstResponseTiers = useMemo(
    () => firstResponseTierCounts(visibleRows, now),
    [visibleRows, now],
  );
  const withoutHandoff = useMemo(
    () => visibleRows.filter((row) => !row.firstResponseFromHandoff).length,
    [visibleRows],
  );

  function toggle(agentKey: string) {
    setExpanded(expanded === agentKey ? null : agentKey);
  }

  const maxHourly = Math.max(1, ...hourly.map((b) => b.count));
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
            תגובה ראשונה מרגע ההעברה מהבוט, וזמן עד שהפנייה נפתרה/נסגרה.
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
          {allAgents.length > 0 && (
            <section className="card p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-bold text-[#17242d]">
                  <UsersRound size={16} className="text-[#5d6d75]" />
                  נציגות בחישוב
                  <span className="font-normal text-[#a3adb1]">
                    · ביטול סימון מחריג את הנציגה מכל המספרים בעמוד
                  </span>
                </h2>
                <div className="flex gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => updateExcluded([])}
                    className="rounded-lg bg-[#eef2f3] px-2.5 py-1 font-semibold text-[#5d6d75] hover:bg-[#e1e8eb]"
                  >
                    בחר הכל
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateExcluded(allAgents.map((a) => a.agentId ?? "unassigned"))
                    }
                    className="rounded-lg bg-[#eef2f3] px-2.5 py-1 font-semibold text-[#5d6d75] hover:bg-[#e1e8eb]"
                  >
                    נקה הכל
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {allAgents.map((agent) => {
                  const key = agent.agentId ?? "unassigned";
                  const checked = !excluded.includes(key);
                  return (
                    <label
                      key={key}
                      className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-1.5 text-sm transition ${
                        checked
                          ? "border-[#158f83] bg-[#e4f5f2] text-[#11786e]"
                          : "border-[#d7e0e4] bg-white text-[#a3adb1]"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleAgent(key)}
                        className="accent-[#158f83]"
                      />
                      {agent.agentName}
                      <span className="text-xs opacity-70">{agent.ticketCount}</span>
                    </label>
                  );
                })}
              </div>
            </section>
          )}

          <section className="card overflow-hidden border-2 border-[#f3c1c6]">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#edf1f3] bg-[#fdebed] px-5 py-3.5">
              <div>
                <h2 className="flex items-center gap-2 text-base font-bold text-[#8a2b32]">
                  <AlertTriangle size={18} />
                  לקוחות ממתינים לתגובה כרגע
                </h2>
                <p className="mt-0.5 text-xs text-[#8a2b32]/70">
                  הזמן נספר מההודעה הראשונה של הלקוח שעדיין לא נענתה. הודעות
                  בוט לא נספרות כמענה.
                </p>
              </div>
              <strong className="text-lg font-bold text-[#8a2b32]">
                {waiting.length} ממתינים
              </strong>
            </header>

            {waiting.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-[#1f7a55]">
                {isToday
                  ? "אין לקוחות שממתינים לתגובה כרגע."
                  : `אין לקוחות שממתינים לתגובה בפניות של ${date}.`}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-sm">
                  <thead>
                    <tr className="text-[#5d6d75]">
                      <th className="px-4 py-2 text-right font-semibold">מס&apos; פנייה</th>
                      <th className="px-4 py-2 text-right font-semibold">לקוח</th>
                      <th className="px-4 py-2 text-right font-semibold">טלפון</th>
                      <th className="px-4 py-2 text-right font-semibold">נציגה משויכת</th>
                      <th className="px-4 py-2 text-center font-semibold">ממתין למענה</th>
                      <th className="px-4 py-2 text-center font-semibold">סה&quot;כ בפנייה</th>
                    </tr>
                  </thead>
                  <tbody>
                    {waiting.map((ticket) => (
                      <tr key={ticket.id} className="border-t border-[#edf1f3]">
                        <td dir="ltr" className="px-4 py-2.5 text-right font-mono text-xs font-bold text-[#17242d]">
                          #{ticket.id}
                        </td>
                        <td className="px-4 py-2.5 text-[#17242d]">
                          {ticket.customerName ?? "—"}
                        </td>
                        <td dir="ltr" className="px-4 py-2.5 text-right text-[#5d6d75]">
                          {formatPhone(ticket.customerPhone)}
                        </td>
                        <td className="px-4 py-2.5 font-semibold text-[#17242d]">
                          {ticket.agentName ?? "ללא שיוך נציג"}
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <span
                            className={`inline-block rounded-lg px-2.5 py-1 text-xs font-bold ${tierClasses(waitingTier(ticket.waitedSeconds))}`}
                          >
                            {formatDuration(ticket.waitedSeconds)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-center font-mono text-xs text-[#5d6d75]">
                          {formatDuration(ticket.totalSeconds)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card overflow-hidden">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#edf1f3] bg-[#f8fafb] px-5 py-3.5">
              <div>
                <h2 className="flex items-center gap-2 text-base font-bold text-[#17242d]">
                  <Timer size={18} className="text-[#5d6d75]" />
                  תגובה ראשונה של נציגה
                </h2>
                <p className="mt-0.5 text-xs text-[#718087]">
                  מרגע שהבוט העביר את השיחה לנציגות ועד ההודעה הראשונה של
                  נציגה. פניות שטרם נענו נספרות בזמן אמת.
                  {withoutHandoff > 0 &&
                    ` ל-${withoutHandoff} פניות אין רישום העברה — נספרות מפתיחת הפנייה.`}
                </p>
              </div>
              <div className="text-left">
                <span className="block text-xs text-[#718087]">ממוצע</span>
                <strong className="block text-2xl font-bold text-[#17242d]">
                  {seconds(totals.avgFirstResponseSeconds)}
                </strong>
                <span className="block text-[11px] text-[#a3adb1]">
                  {totals.respondedCount} נענו מתוך {totals.ticketCount}
                </span>
              </div>
            </header>
            <div className="grid grid-cols-3 divide-x divide-x-reverse divide-[#edf1f3]">
              {WAITING_TIER_MINUTES.map((minutes) => (
                <TierTile key={minutes} minutes={minutes} count={firstResponseTiers[minutes]} />
              ))}
            </div>
          </section>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="card p-5">
              <span className="text-sm text-[#718087]">פניות וואטסאפ</span>
              <strong className="mt-1 block text-3xl font-bold text-[#17242d]">
                {totals.ticketCount}
              </strong>
            </div>
            <div className="card p-5">
              <span className="text-sm text-[#718087]">נפתרו/נסגרו</span>
              <strong className="mt-1 block text-3xl font-bold text-[#17242d]">
                {totals.closedCount}
              </strong>
            </div>
            <div className="card p-5">
              <span className="text-sm text-[#718087]">זמן עד סגירה ממוצע</span>
              <strong className="mt-1 block text-3xl font-bold text-[#17242d]">
                {seconds(totals.avgTimeToCloseSeconds)}
              </strong>
            </div>
          </div>

          <p className="px-1 text-xs text-[#a3adb1]">
            {data.syncedAt
              ? `סונכרן לאחרונה: ${formatIsraelDateTime(data.syncedAt)}`
              : "טרם בוצע סנכרון"}
            {" · שעון ישראל"}
            {isToday && " · הזמנים החיים מתעדכנים כל שנייה, שאר הנתונים כל 30 שניות"}
          </p>

          {byDepartment.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {byDepartment.map((dept) => (
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
                    {dept.awaitingReply > 0 && (
                      <div>
                        <span className="block text-[11px] text-[#a3adb1]">ממתינים כרגע</span>
                        <strong className="text-xl font-bold text-[#c8434c]">
                          {dept.awaitingReply}
                        </strong>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {hourly.some((b) => b.count > 0) && (
            <section className="card p-5">
              <h2 className="mb-3 text-base font-bold text-[#17242d]">
                נפח פניות וואטסאפ לפי שעה · {date}
              </h2>
              <div className="flex h-24 items-end gap-1">
                {hourly.map((bucket) => (
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

            {byAgent.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-[#1f7a55]">
                {allAgents.length === 0
                  ? "אין פניות וואטסאפ ביום זה."
                  : "כל הנציגות מוחרגות — סמן נציגה למעלה כדי לראות נתונים."}
              </p>
            ) : (
              <ul className="divide-y divide-[#edf1f3]">
                {byAgent.map((row) => {
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
                        {row.awaitingReply > 0 && (
                          <span className="min-w-[3.5rem] rounded-lg bg-[#fdebed] px-3 py-1 text-center text-sm font-bold text-[#c8434c]">
                            {row.awaitingReply}
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
                                    <th className="px-3 py-2 text-center font-semibold">מצב</th>
                                    <th className="px-3 py-2 text-center font-semibold">סטטוס</th>
                                    <th className="px-3 py-2 text-center font-semibold">עד סגירה</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {tickets.map((ticket) => {
                                    const firstResponse = firstResponseElapsed(ticket, now);
                                    const liveWaitedSeconds = ticket.waitingSince
                                      ? Math.max(
                                          0,
                                          Math.floor(
                                            (now.getTime() - new Date(ticket.waitingSince).getTime()) / 1000,
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
                                          ) : firstResponse != null ? (
                                            <span
                                              className={`inline-block rounded-lg px-2.5 py-1 text-xs font-bold ${tierClasses(waitingTier(firstResponse))}`}
                                            >
                                              טרם נענתה · {formatDuration(firstResponse)}
                                            </span>
                                          ) : (
                                            <span className="text-xs text-[#a3adb1]">ללא נציגה</span>
                                          )}
                                        </td>
                                        <td className="px-3 py-2.5 text-center">
                                          {liveWaitedSeconds != null ? (
                                            <span
                                              className={`inline-block rounded-lg px-2.5 py-1 text-xs font-bold ${tierClasses(waitingTier(liveWaitedSeconds))}`}
                                            >
                                              ממתין {formatDuration(liveWaitedSeconds)}
                                            </span>
                                          ) : (
                                            <span className="text-xs text-[#a3adb1]">—</span>
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
