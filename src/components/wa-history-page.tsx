"use client";

import {
  CalendarRange,
  ChevronDown,
  ChevronUp,
  Download,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { formatIsraelDateTime, jerusalemToday } from "@/lib/israel-time";
import { formatSecondsLabel } from "@/lib/metrics";
import {
  agentsToCsv,
  dayLabel,
  presetRange,
  RANGE_PRESET_LABELS,
  RANGE_PRESETS,
  statsByAgent,
  statsByDay,
  sumRows,
  type RangePreset,
  type WaHistoryPayload,
  type WaPeriodStats,
} from "@/lib/wa-history";

const DEFAULT_DEPARTMENT_ID = "customer-service";
/** First day with complete handoff data; earlier days have partial response figures. */
const COMPLETE_FROM = "2026-09-08";

function seconds(value: number | null): string {
  return value != null ? formatSecondsLabel(value) : "—";
}

function percent(value: number | null): string {
  return value != null ? `${Math.round(value * 100)}%` : "—";
}

/**
 * The delta line under a summary tile: what changed against the previous
 * period of the same length. `lowerIsBetter` flips the colour for durations.
 */
function Delta({
  current,
  previous,
  format,
  lowerIsBetter = false,
}: {
  current: number | null;
  previous: number | null;
  format: (value: number) => string;
  lowerIsBetter?: boolean;
}) {
  if (current == null || previous == null) {
    return <span className="text-xs text-[#a3adb1]">אין השוואה לתקופה הקודמת</span>;
  }
  const diff = current - previous;
  if (diff === 0) {
    return <span className="text-xs text-[#a3adb1]">ללא שינוי מהתקופה הקודמת</span>;
  }
  const better = lowerIsBetter ? diff < 0 : diff > 0;
  return (
    <span className={`text-xs font-semibold ${better ? "text-[#158f83]" : "text-[#c7502f]"}`}>
      {diff > 0 ? "▲" : "▼"} {format(Math.abs(diff))} לעומת {format(previous)} בתקופה הקודמת
    </span>
  );
}

function Tile({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-4">
      <p className="text-xs font-semibold text-[#5d6d75]">{label}</p>
      <strong className="mt-1 block text-3xl font-bold text-[#17242d]">{value}</strong>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function StatCells({ stats }: { stats: WaPeriodStats }) {
  return (
    <>
      <td className="px-3 py-2 text-center font-semibold text-[#17242d]">{stats.ticketCount}</td>
      <td className="px-3 py-2 text-center">{stats.closedCount}</td>
      <td className="px-3 py-2 text-center text-[#5d6d75]">{stats.openCount}</td>
      <td className="px-3 py-2 text-center">{stats.respondedCount}</td>
      <td className="px-3 py-2 text-center font-mono">{seconds(stats.avgFirstResponseSeconds)}</td>
      <td className="px-3 py-2 text-center font-mono">{seconds(stats.avgTimeToCloseSeconds)}</td>
      <td className="px-3 py-2 text-center">
        <span className="font-semibold text-[#158f83]">{stats.under3Count}</span>
        <span className="text-xs text-[#a3adb1]"> · {percent(stats.under3Share)}</span>
      </td>
      <td className="px-3 py-2 text-center text-[#b7791f]">{stats.over3Count}</td>
      <td className="px-3 py-2 text-center text-[#c2652a]">{stats.over7Count}</td>
      <td className="px-3 py-2 text-center font-semibold text-[#c7502f]">{stats.over10Count}</td>
    </>
  );
}

function RangeForm({
  from,
  to,
  max,
  onSubmit,
}: {
  from: string;
  to: string;
  max: string;
  onSubmit: (range: { from: string; to: string }) => void;
}) {
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  return (
    <form
      className="flex flex-wrap items-center gap-2 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        if (draftFrom && draftTo && draftFrom <= draftTo) {
          onSubmit({ from: draftFrom, to: draftTo });
        }
      }}
    >
      <label className="flex items-center gap-1.5 text-[#5d6d75]">
        מתאריך
        <input
          type="date"
          value={draftFrom}
          max={max}
          onChange={(event) => setDraftFrom(event.target.value)}
          className="rounded-lg border border-[#d7e0e4] px-2 py-1 text-[#17242d]"
        />
      </label>
      <label className="flex items-center gap-1.5 text-[#5d6d75]">
        עד
        <input
          type="date"
          value={draftTo}
          max={max}
          onChange={(event) => setDraftTo(event.target.value)}
          className="rounded-lg border border-[#d7e0e4] px-2 py-1 text-[#17242d]"
        />
      </label>
      <button
        type="submit"
        className="rounded-lg bg-[#17242d] px-3 py-1.5 font-semibold text-white hover:bg-[#2a3a45]"
      >
        הצג
      </button>
    </form>
  );
}

/**
 * Lets the account owner pick a specific comparison period instead of the
 * automatic equal-length period right before `from` — e.g. the same week a
 * month ago, or last year's Pesach period. `current` is shown only to bound
 * the picker's `max`; the two ranges need not be adjacent or equal length.
 */
function CompareForm({
  from,
  to,
  max,
  isCustom,
  onSubmit,
  onReset,
}: {
  from: string;
  to: string;
  max: string;
  isCustom: boolean;
  onSubmit: (range: { compareFrom: string; compareTo: string }) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraftFrom(from);
          setDraftTo(to);
          setOpen(true);
        }}
        className="text-xs font-semibold text-[#158f83] hover:underline"
      >
        {isCustom ? "שינוי תקופת ההשוואה" : "בחירת תקופת השוואה"}
      </button>
    );
  }
  return (
    <form
      className="flex flex-wrap items-center gap-2 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        if (draftFrom && draftTo && draftFrom <= draftTo) {
          onSubmit({ compareFrom: draftFrom, compareTo: draftTo });
          setOpen(false);
        }
      }}
    >
      <label className="flex items-center gap-1.5 text-[#5d6d75]">
        להשוואה מ
        <input
          type="date"
          value={draftFrom}
          max={max}
          onChange={(event) => setDraftFrom(event.target.value)}
          className="rounded-lg border border-[#d7e0e4] px-2 py-1 text-[#17242d]"
        />
      </label>
      <label className="flex items-center gap-1.5 text-[#5d6d75]">
        עד
        <input
          type="date"
          value={draftTo}
          max={max}
          onChange={(event) => setDraftTo(event.target.value)}
          className="rounded-lg border border-[#d7e0e4] px-2 py-1 text-[#17242d]"
        />
      </label>
      <button
        type="submit"
        className="rounded-lg bg-[#158f83] px-3 py-1.5 font-semibold text-white hover:bg-[#127a70]"
      >
        החל
      </button>
      {isCustom && (
        <button
          type="button"
          onClick={() => {
            onReset();
            setOpen(false);
          }}
          className="text-xs font-semibold text-[#5d6d75] hover:underline"
        >
          איפוס לתקופה האוטומטית
        </button>
      )}
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-xs text-[#a3adb1] hover:underline"
      >
        ביטול
      </button>
    </form>
  );
}

const STAT_HEADERS = [
  "פניות",
  "נסגרו",
  "עדיין פתוחות",
  "נענו",
  "תגובה ראשונה ממוצעת",
  "זמן סגירה ממוצע",
  "נענו תוך פחות מ-3 דק׳",
  "מעל 3 דק׳",
  "מעל 7 דק׳",
  "מעל 10 דק׳",
];

/**
 * "ביצועי WA" — the stored daily WhatsApp record, for comparing days, weeks
 * and agents: the same figures as "דשבורד WA" (tickets taken, closed, first
 * response and close time on the business clock), kept per agent per day by
 * the database, summed over any range and set against the previous period
 * of the same length. Pay and bonuses rest on these numbers, so nothing here
 * is recomputed from live tickets — it reads the record as stored.
 */
export function WaHistoryPageClient() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const departmentId = searchParams.get("department") ?? DEFAULT_DEPARTMENT_ID;
  const today = jerusalemToday();
  const initial = presetRange("this-week", today);
  const from = searchParams.get("from") ?? initial.from;
  const to = searchParams.get("to") ?? initial.to;
  // Present only when the account owner picked a specific comparison period;
  // absent means the automatic equal-length period right before `from`.
  const compareFrom = searchParams.get("compareFrom");
  const compareTo = searchParams.get("compareTo");
  const hasCustomCompare = Boolean(compareFrom && compareTo);

  const [data, setData] = useState<WaHistoryPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const params = new URLSearchParams({ from, to, department: departmentId });
      if (hasCustomCompare) {
        params.set("compareFrom", compareFrom!);
        params.set("compareTo", compareTo!);
      }
      const response = await fetch(`/api/wa-history?${params}`, { cache: "no-store" });
      const payload: WaHistoryPayload = await response.json();
      if (!response.ok) {
        throw new Error(
          (payload as unknown as { error?: string }).error === "invalid_range"
            ? "טווח התאריכים לא תקין (עד 92 יום)"
            : "לא ניתן לטעון את ביצועי הוואטסאפ",
        );
      }
      setData(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "אירעה שגיאה");
    } finally {
      setLoading(false);
    }
  }, [from, to, departmentId, hasCustomCompare, compareFrom, compareTo]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function navigate(next: {
    from?: string;
    to?: string;
    department?: string;
    compareFrom?: string;
    compareTo?: string;
    clearCompare?: boolean;
  }) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("from", next.from ?? from);
    params.set("to", next.to ?? to);
    params.set("department", next.department ?? departmentId);
    if (next.clearCompare) {
      params.delete("compareFrom");
      params.delete("compareTo");
    } else if (next.compareFrom && next.compareTo) {
      params.set("compareFrom", next.compareFrom);
      params.set("compareTo", next.compareTo);
    }
    setExpanded(null);
    setLoading(true);
    router.replace(`${pathname}?${params}`);
  }

  const activePreset = useMemo(
    () => RANGE_PRESETS.find((preset) => {
      const range = presetRange(preset, today);
      return range.from === from && range.to === to;
    }) ?? null,
    [from, to, today],
  );

  const rows = useMemo(() => data?.rows ?? [], [data?.rows]);
  const totals = useMemo(() => sumRows(rows), [rows]);
  const previousTotals = useMemo(() => sumRows(data?.previousRows ?? []), [data?.previousRows]);
  const days = useMemo(() => statsByDay(rows), [rows]);
  const agents = useMemo(() => statsByAgent(rows), [rows]);
  const maxDayTickets = Math.max(1, ...days.map((day) => day.ticketCount));

  function downloadCsv() {
    const blob = new Blob([agentsToCsv(agents)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `wa-agents-${departmentId}-${from}-${to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-[#17242d] md:text-[28px]">
            <CalendarRange className="text-[#158f83]" size={26} />
            ביצועי WA
          </h1>
          <p className="mt-1 text-sm text-[#5d6d75]">
            הרשומה היומית של כל נציגה בוואטסאפ, לפי היום שבו נפתחה הפנייה: כמה לקחה,
            כמה סגרה, תגובה ראשונה וזמן סגירה. להשוואה בין ימים, שבועות ונציגות.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={downloadCsv}
            disabled={agents.length === 0}
            className="inline-flex items-center gap-2 rounded-xl bg-[#eef2f3] px-3 py-2 text-sm font-semibold text-[#17242d] hover:bg-[#e1e8eb] disabled:opacity-40"
          >
            <Download size={16} />
            ייצוא לאקסל (CSV)
          </button>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex items-center gap-2 rounded-xl bg-[#eef2f3] px-3 py-2 text-sm font-semibold text-[#17242d] hover:bg-[#e1e8eb]"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            רענון
          </button>
        </div>
      </header>

      {data && data.departments.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {data.departments.map((department) => (
            <button
              key={department.id}
              type="button"
              onClick={() => navigate({ department: department.id })}
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
                department.id === departmentId
                  ? "bg-[#17242d] text-white"
                  : "bg-[#eef2f3] text-[#5d6d75] hover:bg-[#e1e8eb]"
              }`}
            >
              {department.name}
            </button>
          ))}
        </div>
      )}

      <section className="card flex flex-wrap items-center gap-3 p-3">
        <div className="flex flex-wrap gap-1.5">
          {RANGE_PRESETS.map((preset: RangePreset) => (
            <button
              key={preset}
              type="button"
              onClick={() => navigate(presetRange(preset, today))}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                preset === activePreset
                  ? "bg-[#158f83] text-white"
                  : "bg-[#eef2f3] text-[#5d6d75] hover:bg-[#e1e8eb]"
              }`}
            >
              {RANGE_PRESET_LABELS[preset]}
            </button>
          ))}
        </div>
        {/* Keyed on the range so the drafts reset when a preset changes the URL. */}
        <RangeForm
          key={`${from}|${to}`}
          from={from}
          to={to}
          max={today}
          onSubmit={(next) => navigate(next)}
        />
        {data && (
          <span className="text-xs text-[#a3adb1]">
            לעומת {dayLabel(data.previous.from)}–{dayLabel(data.previous.to)}
            {hasCustomCompare && " (נבחר ידנית)"}
          </span>
        )}
        <CompareForm
          key={`${compareFrom ?? ""}|${compareTo ?? ""}`}
          from={compareFrom ?? data?.previous.from ?? from}
          to={compareTo ?? data?.previous.to ?? to}
          max={today}
          isCustom={hasCustomCompare}
          onSubmit={(range) => navigate(range)}
          onReset={() => navigate({ clearCompare: true })}
        />
      </section>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="flex items-center justify-center py-16 text-[#a3adb1]">
          <LoaderCircle className="animate-spin" size={32} />
        </div>
      )}

      {data && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <Tile label="פניות" value={String(totals.ticketCount)}>
              <Delta current={totals.ticketCount} previous={previousTotals.ticketCount} format={String} />
            </Tile>
            <Tile label="נסגרו" value={String(totals.closedCount)}>
              <Delta current={totals.closedCount} previous={previousTotals.closedCount} format={String} />
            </Tile>
            <Tile label="תגובה ראשונה ממוצעת" value={seconds(totals.avgFirstResponseSeconds)}>
              <Delta
                current={totals.avgFirstResponseSeconds}
                previous={previousTotals.avgFirstResponseSeconds}
                format={formatSecondsLabel}
                lowerIsBetter
              />
            </Tile>
            <Tile label="זמן סגירה ממוצע" value={seconds(totals.avgTimeToCloseSeconds)}>
              <Delta
                current={totals.avgTimeToCloseSeconds}
                previous={previousTotals.avgTimeToCloseSeconds}
                format={formatSecondsLabel}
                lowerIsBetter
              />
            </Tile>
            <Tile label="נענו תוך פחות מ-3 דק׳" value={percent(totals.under3Share)}>
              <Delta
                current={totals.under3Share != null ? Math.round(totals.under3Share * 100) : null}
                previous={
                  previousTotals.under3Share != null
                    ? Math.round(previousTotals.under3Share * 100)
                    : null
                }
                format={(value) => `${value}%`}
              />
            </Tile>
          </section>

          <p className="px-1 text-xs text-[#a3adb1]">
            {data.computedAt
              ? `הרשומה עודכנה לאחרונה: ${formatIsraelDateTime(data.computedAt)}`
              : "אין עדיין רשומות לטווח זה"}
            {" · מתעדכן כל 10 דקות"}
            {data.businessHoursLabel
              ? ` · הזמנים בשעות הפעילות בלבד (${data.businessHoursLabel}, ללא ערבי חג וחגים)`
              : " · הזמנים מסביב לשעון"}
            {from < COMPLETE_FROM &&
              ` · נתוני תגובה ראשונה מלאים מ-${dayLabel(COMPLETE_FROM)}; לפני כן חלקיים`}
          </p>

          <section className="card overflow-hidden">
            <div className="border-b border-[#eef2f3] px-4 py-3">
              <h2 className="text-sm font-bold text-[#17242d]">לפי יום</h2>
              <p className="text-xs text-[#a3adb1]">
                {totals.ticketCount} פניות ב-{totals.activeDays} ימי פעילות
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-[#f7f9fa] text-xs text-[#5d6d75]">
                  <tr>
                    <th className="px-3 py-2 text-right font-semibold">יום</th>
                    {STAT_HEADERS.map((header) => (
                      <th key={header} className="px-3 py-2 text-center font-semibold">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {days.map((day) => (
                    <tr key={day.day} className="border-t border-[#eef2f3]">
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className="w-16 font-semibold text-[#17242d]">{dayLabel(day.day)}</span>
                          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#eef2f3]">
                            <span
                              className="block h-full rounded-full bg-[#158f83]"
                              style={{ width: `${(day.ticketCount / maxDayTickets) * 100}%` }}
                            />
                          </span>
                        </div>
                      </td>
                      <StatCells stats={day} />
                    </tr>
                  ))}
                  {days.length === 0 && (
                    <tr>
                      <td colSpan={STAT_HEADERS.length + 1} className="px-3 py-8 text-center text-[#a3adb1]">
                        אין פניות וואטסאפ בטווח זה
                      </td>
                    </tr>
                  )}
                </tbody>
                {days.length > 1 && (
                  <tfoot className="border-t-2 border-[#d7e0e4] bg-[#f7f9fa] font-semibold">
                    <tr>
                      <td className="px-3 py-2 text-[#17242d]">סה״כ</td>
                      <StatCells stats={totals} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>

          <section className="card overflow-hidden">
            <div className="border-b border-[#eef2f3] px-4 py-3">
              <h2 className="text-sm font-bold text-[#17242d]">לפי נציגה</h2>
              <p className="text-xs text-[#a3adb1]">
                לחיצה על נציגה פותחת את הפירוט היומי שלה · פניות לפי הנציגה המשויכת
                כרגע, תגובה ראשונה וסגירה לפי מי שהייתה משויכת באותו רגע
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] text-sm">
                <thead className="bg-[#f7f9fa] text-xs text-[#5d6d75]">
                  <tr>
                    <th className="px-3 py-2 text-right font-semibold">נציגה</th>
                    <th className="px-3 py-2 text-center font-semibold">ימי פעילות</th>
                    {STAT_HEADERS.map((header) => (
                      <th key={header} className="px-3 py-2 text-center font-semibold">
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {agents.map((agent) => {
                    const open = expanded === agent.agentId;
                    return (
                      <Fragment key={agent.agentId}>
                        <tr
                          className="cursor-pointer border-t border-[#eef2f3] hover:bg-[#f7f9fa]"
                          onClick={() => setExpanded(open ? null : agent.agentId)}
                        >
                          <td className="px-3 py-2">
                            <span className="flex items-center gap-2 font-semibold text-[#17242d]">
                              {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                              {agent.agentName}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-center text-[#5d6d75]">{agent.activeDays}</td>
                          <StatCells stats={agent} />
                        </tr>
                        {open &&
                          agent.days.map((day) => (
                            <tr key={`${agent.agentId}-${day.day}`} className="bg-[#fbfcfc] text-xs text-[#5d6d75]">
                              <td className="px-3 py-1.5 pr-9">{dayLabel(day.day)}</td>
                              <td />
                              <StatCells stats={day} />
                            </tr>
                          ))}
                      </Fragment>
                    );
                  })}
                  {agents.length === 0 && (
                    <tr>
                      <td colSpan={STAT_HEADERS.length + 2} className="px-3 py-8 text-center text-[#a3adb1]">
                        אין נציגות עם פניות בטווח זה
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
