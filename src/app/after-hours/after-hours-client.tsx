"use client";

import {
  ArrowDownLeft,
  Clock3,
  LoaderCircle,
  Moon,
  PhoneMissed,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useBusinessHoursConfig } from "@/hooks/use-business-hours";
import { formatDuration, filterCalls } from "@/lib/metrics";
import { formatPhoneDisplay } from "@/lib/phone";
import { formatIsraelDateTime } from "@/lib/israel-time";
import { splitCallsByBusinessHours } from "@/lib/business-hours";
import type { DashboardData, DashboardFilters } from "@/lib/types";
import { useEffect } from "react";
import {
  createSupabaseBrowserClient,
  isSupabaseBrowserConfigured,
} from "@/lib/supabase/browser";

function toInputDate(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

function presetDates(preset: DashboardFilters["preset"]) {
  const today = new Date();
  const to = toInputDate(today);
  if (preset === "today") return { from: to, to };
  const from = new Date(today);
  if (preset === "week") {
    // Sunday-start calendar week, matching dashboard-client.tsx/section-pages.tsx
    // — not a rolling 7-day window, so "השבוע" means the same range everywhere.
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

export function AfterHoursCallsPage() {
  const initial = presetDates("week");
  const [filters, setFilters] = useState<DashboardFilters>({
    preset: "week",
    ...initial,
    departmentId: "",
    agentId: "",
  });
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const { config, error: hoursError } = useBusinessHoursConfig();

  useEffect(() => {
    const controller = new AbortController();
    const params = `?from=${encodeURIComponent(filters.from)}&to=${encodeURIComponent(filters.to)}`;
    const load = () =>
      fetch(`/api/dashboard${params}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then((response) => {
          if (!response.ok) throw new Error("טעינת השיחות נכשלה");
          return response.json();
        })
        .then((payload) => {
          setData(payload);
          setError("");
        })
        .catch((reason) => {
          if (reason.name !== "AbortError") setError(reason.message);
        });

    void load();
    const polling = window.setInterval(() => void load(), 20_000);
    const supabase = isSupabaseBrowserConfigured()
      ? createSupabaseBrowserClient()
      : null;
    const channel = supabase
      ?.channel("after-hours-calls")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "calls" },
        () => void load(),
      )
      .subscribe();

    return () => {
      controller.abort();
      window.clearInterval(polling);
      if (supabase && channel) void supabase.removeChannel(channel);
    };
  }, [filters.from, filters.to]);

  useEffect(() => {
    if (!data?.scopedDepartmentId) return;
    const timer = window.setTimeout(() => {
      setFilters((current) =>
        current.departmentId === data.scopedDepartmentId
          ? current
          : { ...current, departmentId: data.scopedDepartmentId!, agentId: "" },
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [data?.scopedDepartmentId]);

  const afterHoursCalls = useMemo(() => {
    const ranged = filterCalls(
      data?.calls ?? [],
      filters.from,
      filters.to,
      filters.departmentId,
      filters.agentId,
    );
    return splitCallsByBusinessHours(ranged, config).afterHours;
  }, [data, filters, config]);

  if (error || hoursError) {
    return (
      <div className="card p-8 text-center text-red-600">
        {error || hoursError}
      </div>
    );
  }

  if (!data || !config) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <LoaderCircle className="animate-spin text-[#158f83]" size={34} />
      </div>
    );
  }

  return (
    <div>
      <header className="mb-6 flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#fdebed] text-[#c34850]">
          <Moon size={22} />
        </span>
        <div>
          <h1 className="text-2xl font-bold md:text-[28px]">
            שיחות אחרי שעות הפעילות
          </h1>
          <p className="mt-1 text-sm text-[#75838b]">
            שיחות נכנסות שנכנסו מחוץ לשעות שהוגדרו בהגדרות · שיחות יוצאות לא
            מופיעות כאן
          </p>
        </div>
      </header>

      {!config.enabled ? (
        <section className="card p-8 text-center">
          <Clock3 className="mx-auto text-[#9aa6ad]" size={36} />
          <h2 className="mt-4 text-lg font-bold">הפיצ׳ר כבוי</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-[#718087]">
            כדי להפריד שיחות נכנסות אחרי שעות הפעילות, הפעילו את הסינון בעמוד
            ההגדרות והגדירו ימים ושעות לכל מחלקה.
          </p>
        </section>
      ) : (
        <>
          <section className="card mb-4 p-3 md:p-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-xl bg-[#f1f4f6] p-1">
                {(
                  [
                    ["today", "היום"],
                    ["week", "השבוע"],
                    ["month", "החודש"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() =>
                      setFilters((current) => ({
                        ...current,
                        preset: value,
                        ...presetDates(value),
                      }))
                    }
                    className={`rounded-lg px-3 py-2 text-xs font-bold transition ${
                      filters.preset === value
                        ? "bg-white text-[#17242d] shadow-sm"
                        : "text-[#718087]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {!data.scopedDepartmentId && (
                <select
                  value={filters.departmentId}
                  onChange={(event) =>
                    setFilters((current) => ({
                      ...current,
                      departmentId: event.target.value,
                      agentId: "",
                    }))
                  }
                  className="h-10 rounded-xl border border-[#dfe6ea] bg-white px-3 text-xs font-semibold"
                >
                  <option value="">כל המחלקות</option>
                  {data.departments.map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </select>
              )}
              <span className="mr-auto text-xs text-[#6f7d84]">
                {afterHoursCalls.length} שיחות נכנסות אחרי שעות
              </span>
            </div>
          </section>

          <section className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
            <article className="card flex items-center gap-3 p-4">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#fdebed] text-[#c34850]">
                <Moon size={18} />
              </span>
              <div>
                <p className="text-xs text-[#7c8990]">סה״כ אחרי שעות</p>
                <strong className="text-2xl">{afterHoursCalls.length}</strong>
              </div>
            </article>
            <article className="card flex items-center gap-3 p-4">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#e4f5ea] text-[#28875a]">
                <ArrowDownLeft size={18} />
              </span>
              <div>
                <p className="text-xs text-[#7c8990]">נענו</p>
                <strong className="text-2xl">
                  {
                    afterHoursCalls.filter((call) => call.status === "answered")
                      .length
                  }
                </strong>
              </div>
            </article>
            <article className="card flex items-center gap-3 p-4">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#fdebed] text-[#c34850]">
                <PhoneMissed size={18} />
              </span>
              <div>
                <p className="text-xs text-[#7c8990]">לא נענו</p>
                <strong className="text-2xl">
                  {
                    afterHoursCalls.filter((call) => call.status === "missed")
                      .length
                  }
                </strong>
              </div>
            </article>
          </section>

          <section className="card overflow-hidden">
            <div className="overflow-auto">
              <table className="w-full border-collapse text-right text-xs">
                <thead className="bg-[#f8fafb] text-[#738188]">
                  <tr>
                    {[
                      "זמן התחלה",
                      "מחלקה",
                      "נציג/ה",
                      "מספר לקוח",
                      "סטטוס",
                      "משך",
                      "המתנה",
                    ].map((heading) => (
                      <th
                        key={heading}
                        className="w-0 whitespace-nowrap px-3 py-3 font-semibold"
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#edf1f3]">
                  {afterHoursCalls.map((call) => (
                    <tr key={call.id} className="hover:bg-[#f9fbfb]">
                      <td className="w-0 whitespace-nowrap px-3 py-3 font-bold">
                        {formatIsraelDateTime(call.startedAt)}
                      </td>
                      <td className="w-0 whitespace-nowrap px-3 py-3">
                        {call.departmentName ?? "ללא שיוך"}
                      </td>
                      <td className="w-0 whitespace-nowrap px-3 py-3">
                        {call.agentName ? (
                          call.agentName
                        ) : call.status === "in_progress" ? (
                          <span className="font-bold text-[#c34850]">
                            לקוח ממתין
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td
                        className="w-0 whitespace-nowrap px-3 py-3 font-mono"
                        dir="ltr"
                      >
                        {formatPhoneDisplay(call.customerNumber)}
                      </td>
                      <td className="w-0 whitespace-nowrap px-3 py-3">
                        {call.status === "answered"
                          ? "נענתה"
                          : call.status === "missed"
                            ? "לא נענתה"
                            : !call.agentId
                              ? "ממתין למענה"
                              : call.talkTimeSeconds > 0
                                ? "בשיחה"
                                : "מצלצל"}
                      </td>
                      <td className="w-0 whitespace-nowrap px-3 py-3">
                        {formatDuration(call.durationSeconds)}
                      </td>
                      <td className="w-0 whitespace-nowrap px-3 py-3">
                        {formatDuration(call.waitTimeSeconds)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!afterHoursCalls.length && (
                <p className="p-16 text-center text-sm text-[#7d8a91]">
                  אין שיחות נכנסות אחרי שעות הפעילות בטווח שנבחר
                </p>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
