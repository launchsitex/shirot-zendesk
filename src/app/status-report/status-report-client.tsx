"use client";

import {
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Clock3,
  LoaderCircle,
  Timer,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type StatusTotals = {
  state: string;
  stateLabel: string;
  durationSeconds: number;
  durationLabel: string;
};

type StatusSegment = {
  id: string;
  state: string;
  stateLabel: string;
  nextStateLabel: string | null;
  startedAtIsrael: string;
  endedAtIsrael: string | null;
  durationLabel: string;
  sourceEvent: string | null;
};

type AgentReport = {
  agentId: string;
  agentName: string;
  totals: StatusTotals[];
  segments: StatusSegment[];
};

type DepartmentReport = {
  id: string;
  name: string;
  agents: AgentReport[];
};

type ReportPayload = {
  from: string;
  to: string;
  rangeStartIsrael: string;
  rangeEndIsrael: string;
  departments: DepartmentReport[];
  scopedDepartmentId?: string | null;
};

function toInputDate(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

function presetDates(preset: "today" | "week" | "month") {
  const today = new Date();
  const to = toInputDate(today);
  if (preset === "today") return { from: to, to };
  const from = new Date(today);
  if (preset === "week") {
    const weekday = Number(
      new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        timeZone: "Asia/Jerusalem",
      })
        .format(today)
        .replace(
          /Sun|Mon|Tue|Wed|Thu|Fri|Sat/,
          (value) =>
            String(
              ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(value),
            ),
        ),
    );
    from.setDate(from.getDate() - weekday);
  } else {
    from.setDate(1);
  }
  return { from: toInputDate(from), to };
}

export function StatusReportClient() {
  const initial = presetDates("today");
  const [preset, setPreset] = useState<"today" | "week" | "month" | "custom">(
    "today",
  );
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [data, setData] = useState<ReportPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/status-report?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
        { cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "טעינת הדוח נכשלה");
      setData(result);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "טעינת הדוח נכשלה",
      );
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function applyPreset(next: "today" | "week" | "month") {
    const dates = presetDates(next);
    setPreset(next);
    setFrom(dates.from);
    setTo(dates.to);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#e4f5f2] text-[#158f83]">
            <Timer size={23} />
          </span>
          <div>
            <h1 className="text-2xl font-bold">זמני סטטוס נציגים</h1>
            <p className="mt-1 text-sm text-[#75838b]">
              כמה זמן היה כל נציג בכל סטטוס, כולל חותמות זמן לפי שעון ישראל
            </p>
          </div>
        </div>
      </header>

      <section className="card flex flex-wrap items-center gap-2 p-4">
        {(
          [
            ["today", "היום"],
            ["week", "השבוע"],
            ["month", "החודש"],
            ["custom", "מותאם"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              if (value === "custom") setPreset("custom");
              else applyPreset(value);
            }}
            className={`rounded-xl px-3 py-2 text-xs font-bold ${
              preset === value
                ? "bg-[#158f83] text-white"
                : "bg-[#eef4f6] text-[#44535b]"
            }`}
          >
            {label}
          </button>
        ))}
        {preset === "custom" && (
          <div className="flex items-center gap-2 rounded-xl border border-[#dfe6ea] px-3">
            <CalendarDays size={15} className="text-[#849198]" />
            <input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="h-10 bg-transparent text-xs outline-none"
            />
            <span className="text-xs text-[#849198]">עד</span>
            <input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="h-10 bg-transparent text-xs outline-none"
            />
          </div>
        )}
        {data && (
          <span className="mr-auto text-xs text-[#6f7d84]">
            טווח: {data.rangeStartIsrael} — {data.rangeEndIsrael}
          </span>
        )}
      </section>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <LoaderCircle className="animate-spin text-[#158f83]" size={34} />
        </div>
      ) : (
        <div className="space-y-5">
          {(data?.departments ?? []).map((department) => (
            <section key={department.id} className="card overflow-hidden">
              <div className="border-b border-[#e8eef1] px-5 py-4">
                <h2 className="font-bold">{department.name}</h2>
                <p className="mt-1 text-xs text-[#7a888f]">
                  {department.agents.length} נציגים בטווח שנבחר
                </p>
              </div>
              <div className="divide-y divide-[#eef3f5]">
                {department.agents.map((agent) => {
                  const open = Boolean(expanded[agent.agentId]);
                  return (
                    <div key={agent.agentId} className="p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <strong className="block">{agent.agentName}</strong>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {agent.totals.map((total) => (
                              <span
                                key={total.state}
                                className="rounded-lg bg-[#eef5f7] px-2.5 py-1 text-xs font-semibold text-[#35515c]"
                              >
                                {total.stateLabel}: {total.durationLabel}
                              </span>
                            ))}
                            {!agent.totals.length && (
                              <span className="text-xs text-[#7a888f]">
                                אין מקטעי סטטוס בטווח
                              </span>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setExpanded((current) => ({
                              ...current,
                              [agent.agentId]: !open,
                            }))
                          }
                          className="inline-flex items-center gap-1 rounded-xl border border-[#d7e0e4] px-3 py-2 text-xs font-semibold text-[#44535b]"
                        >
                          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          פירוט זמנים
                        </button>
                      </div>
                      {open && (
                        <div className="mt-4 overflow-x-auto rounded-xl border border-[#e8eef1]">
                          <table className="min-w-full text-xs">
                            <thead className="bg-[#f7fafb] text-[#6d7c84]">
                              <tr>
                                <th className="px-3 py-2 text-right font-medium">
                                  סטטוס
                                </th>
                                <th className="px-3 py-2 text-right font-medium">
                                  סטטוס הבא
                                </th>
                                <th className="px-3 py-2 text-right font-medium">
                                  התחלה (ישראל)
                                </th>
                                <th className="px-3 py-2 text-right font-medium">
                                  סיום (ישראל)
                                </th>
                                <th className="px-3 py-2 text-right font-medium">
                                  משך
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {agent.segments.map((segment) => (
                                <tr
                                  key={segment.id}
                                  className="border-t border-[#eef3f5]"
                                >
                                  <td className="px-3 py-2 font-semibold">
                                    {segment.stateLabel}
                                  </td>
                                  <td className="px-3 py-2 font-semibold text-[#35515c]">
                                    {segment.nextStateLabel ?? "—"}
                                  </td>
                                  <td className="px-3 py-2 font-mono" dir="ltr">
                                    {segment.startedAtIsrael}
                                  </td>
                                  <td className="px-3 py-2 font-mono" dir="ltr">
                                    {segment.endedAtIsrael}
                                  </td>
                                  <td className="px-3 py-2 font-bold">
                                    {segment.durationLabel}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
          {!data?.departments.length && (
            <div className="card p-10 text-center text-sm text-[#75838b]">
              <Clock3 className="mx-auto mb-3 text-[#158f83]" size={28} />
              אין עדיין נתוני סטטוס בטווח שנבחר. הנתונים נשמרים מעכשיו והלאה.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
