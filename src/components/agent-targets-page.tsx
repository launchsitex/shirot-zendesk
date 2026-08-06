"use client";

import { LoaderCircle, Target, TrendingDown, TrendingUp } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  attainment,
  formatHoursMinutes,
  groupByDepartment,
  type AgentTargetReport,
} from "@/lib/agent-targets";
import { jerusalemToday } from "@/lib/israel-time";

export function AgentTargetsPageClient() {
  const [date, setDate] = useState(() => jerusalemToday());
  const [fullDay, setFullDay] = useState(false);
  const [report, setReport] = useState<AgentTargetReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        date,
        window: fullDay ? "full-day" : "until-cutoff",
      });
      const response = await fetch(`/api/agent-targets?${params}`, {
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "load_failed");
      setReport(payload);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "טעינת הדוח נכשלה",
      );
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [date, fullDay]);

  useEffect(() => {
    // Deferred a tick so the synchronous setState inside load doesn't cascade
    // into the render (same pattern as dashboard-client).
    const pending = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(pending);
  }, [load]);

  const groups = report ? groupByDepartment(report.rows) : [];

  return (
    <div className="space-y-5">
      <header className="card flex flex-wrap items-center gap-4 p-5">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#e7f5f3] text-[#158f83]">
          <Target size={20} />
        </span>
        <div className="flex-1">
          <h1 className="text-lg font-bold">יעדים לנציגים</h1>
          <p className="mt-0.5 text-sm text-[#718087]">
            שיחות נכנסות שנענו, ללא שיחות שהנציג העביר הלאה, מול היעד היומי.
          </p>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <span className="font-semibold text-[#5d6d75]">תאריך</span>
          <input
            type="date"
            value={date}
            max={jerusalemToday()}
            onChange={(event) => setDate(event.target.value)}
            className="rounded-xl border border-[#dfe6ea] bg-[#f8fafb] px-3 py-2 text-sm text-[#17242d] outline-none focus:border-[#158f83]"
          />
        </label>

        <label className="flex items-center gap-2 rounded-xl bg-[#f8fafb] px-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={fullDay}
            onChange={(event) => setFullDay(event.target.checked)}
            className="h-4 w-4 accent-[#158f83]"
          />
          <span className="font-semibold text-[#5d6d75]">יום מלא</span>
        </label>
      </header>

      {report && (
        <p className="px-1 text-xs text-[#a3adb1]">
          {fullDay
            ? "מוצג היום המלא (00:00–24:00)."
            : `מוצג מ-00:00 עד ${report.cutoff} — אותו חתך בדיוק שנשלח במייל היומי.`}
        </p>
      )}

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {loading && (
        <div className="card flex min-h-40 items-center justify-center p-8">
          <LoaderCircle className="animate-spin text-[#158f83]" size={28} />
        </div>
      )}

      {!loading && report && !groups.length && (
        <p className="card px-4 py-10 text-center text-sm text-[#a3adb1]">
          אין נתונים לתאריך הזה, ולא הוגדרו יעדים.
        </p>
      )}

      {!loading &&
        groups.map((group) => {
          const gap = group.totalActual - group.totalTarget;
          return (
            <section
              key={group.departmentId ?? "none"}
              className="card overflow-hidden"
            >
              <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#edf1f3] bg-[#f8fafb] px-5 py-3.5">
                <h2 className="text-base font-bold text-[#17242d]">
                  {group.departmentName}
                </h2>
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <span className="text-[#718087]">
                    זמן נכנסות{" "}
                    <strong dir="ltr" className="tabular-nums text-[#17242d]">
                      {formatHoursMinutes(group.totalInboundTalkSeconds)}
                    </strong>
                  </span>
                  <span className="text-[#718087]">
                    זמן יוצאות{" "}
                    <strong dir="ltr" className="tabular-nums text-[#17242d]">
                      {formatHoursMinutes(group.totalOutboundTalkSeconds)}
                    </strong>
                  </span>
                  <span className="text-[#718087]">
                    סה״כ בפועל{" "}
                    <strong className="text-[#17242d]">
                      {group.totalActual}
                    </strong>
                  </span>
                  {group.totalTarget > 0 && (
                    <>
                      <span className="text-[#718087]">
                        יעד{" "}
                        <strong className="text-[#17242d]">
                          {group.totalTarget}
                        </strong>
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 font-bold ${
                          gap >= 0
                            ? "bg-[#e7f6ee] text-[#1f7a55]"
                            : "bg-[#fdebed] text-[#c8434c]"
                        }`}
                      >
                        {gap >= 0 ? (
                          <TrendingUp size={14} />
                        ) : (
                          <TrendingDown size={14} />
                        )}
                        {gap > 0 ? `+${gap}` : gap}
                      </span>
                    </>
                  )}
                </div>
              </header>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-sm">
                  <thead>
                    <tr className="text-[#5d6d75]">
                      <th className="px-5 py-3 text-right font-semibold">
                        נציג
                      </th>
                      <th className="px-4 py-3 text-center font-semibold">
                        יעד
                      </th>
                      <th className="px-4 py-3 text-center font-semibold">
                        בפועל
                      </th>
                      <th className="px-4 py-3 text-center font-semibold">
                        פער
                      </th>
                      <th className="whitespace-nowrap px-4 py-3 text-center font-semibold">
                        זמן שיחות נכנסות
                      </th>
                      <th className="whitespace-nowrap px-4 py-3 text-center font-semibold">
                        זמן שיחות יוצאות
                      </th>
                      <th className="px-4 py-3 text-center font-semibold">
                        עמידה ביעד
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...group.rows]
                      .sort((a, b) => b.actual - a.actual)
                      .map((row) => {
                        const percent = attainment(row);
                        const rowGap =
                          row.target === null ? null : row.actual - row.target;
                        return (
                          <tr
                            key={row.agentId}
                            className="border-t border-[#edf1f3]"
                          >
                            <td className="px-5 py-3 font-medium text-[#17242d]">
                              {row.agentName}
                            </td>
                            <td className="px-4 py-3 text-center text-[#718087]">
                              {row.target ?? "—"}
                            </td>
                            <td className="px-4 py-3 text-center font-bold text-[#17242d]">
                              {row.actual}
                            </td>
                            <td
                              className={`px-4 py-3 text-center font-semibold ${
                                rowGap === null
                                  ? "text-[#a3adb1]"
                                  : rowGap >= 0
                                    ? "text-[#1f7a55]"
                                    : "text-[#c8434c]"
                              }`}
                            >
                              {rowGap === null
                                ? "—"
                                : rowGap > 0
                                  ? `+${rowGap}`
                                  : rowGap}
                            </td>
                            <td
                              dir="ltr"
                              className="px-4 py-3 text-center font-medium tabular-nums text-[#17242d]"
                            >
                              {formatHoursMinutes(row.inboundTalkSeconds)}
                            </td>
                            <td
                              dir="ltr"
                              className="px-4 py-3 text-center font-medium tabular-nums text-[#17242d]"
                            >
                              {formatHoursMinutes(row.outboundTalkSeconds)}
                            </td>
                            <td className="px-4 py-3">
                              {percent === null ? (
                                <span className="block text-center text-[#a3adb1]">
                                  —
                                </span>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#edf1f3]">
                                    <div
                                      className={`h-full rounded-full ${
                                        percent >= 100
                                          ? "bg-[#1f7a55]"
                                          : percent >= 70
                                            ? "bg-[#e9b24a]"
                                            : "bg-[#c8434c]"
                                      }`}
                                      style={{
                                        width: `${Math.min(100, percent)}%`,
                                      }}
                                    />
                                  </div>
                                  <span className="w-12 text-left text-xs font-bold text-[#5d6d75]">
                                    {percent}%
                                  </span>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
    </div>
  );
}
