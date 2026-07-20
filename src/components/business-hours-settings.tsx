"use client";

import { Clock3, LoaderCircle, Save } from "lucide-react";
import { useEffect, useState } from "react";
import {
  WEEKDAY_LABELS,
  defaultWeekSchedule,
  normalizeSchedule,
  type BusinessHoursConfig,
  type DaySchedule,
  type Weekday,
} from "@/lib/business-hours";

export function BusinessHoursSettingsClient() {
  const [config, setConfig] = useState<BusinessHoursConfig | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings/business-hours", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "load_failed");
        setConfig({
          enabled: Boolean(payload.enabled),
          departments: (payload.departments ?? []).map(
            (department: BusinessHoursConfig["departments"][number]) => ({
              ...department,
              schedule: normalizeSchedule(department.schedule),
            }),
          ),
        });
      })
      .catch((loadError) =>
        setError(
          loadError instanceof Error
            ? loadError.message
            : "טעינת שעות הפעילות נכשלה",
        ),
      );
  }, []);

  function updateDepartmentSchedule(
    departmentId: string,
    day: Weekday,
    patch: Partial<DaySchedule>,
  ) {
    setConfig((current) => {
      if (!current) return current;
      return {
        ...current,
        departments: current.departments.map((department) => {
          if (department.departmentId !== departmentId) return department;
          return {
            ...department,
            schedule: department.schedule.map((item) =>
              item.day === day ? { ...item, ...patch } : item,
            ),
          };
        }),
      };
    });
    setSaved(false);
  }

  function applyDefaultWeekdays(departmentId: string) {
    setConfig((current) => {
      if (!current) return current;
      return {
        ...current,
        departments: current.departments.map((department) =>
          department.departmentId === departmentId
            ? { ...department, schedule: defaultWeekSchedule() }
            : department,
        ),
      };
    });
    setSaved(false);
  }

  async function save() {
    if (!config) return;
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const response = await fetch("/api/settings/business-hours", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: config.enabled,
          departments: config.departments.map((department) => ({
            departmentId: department.departmentId,
            schedule: department.schedule,
          })),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "save_failed");
      setConfig({
        enabled: Boolean(payload.enabled),
        departments: (payload.departments ?? []).map(
          (department: BusinessHoursConfig["departments"][number]) => ({
            ...department,
            schedule: normalizeSchedule(department.schedule),
          }),
        ),
      });
      setSaved(true);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "שמירת ההגדרות נכשלה",
      );
    } finally {
      setSaving(false);
    }
  }

  if (!config && !error) {
    return (
      <div className="card flex min-h-40 items-center justify-center p-8">
        <LoaderCircle className="animate-spin text-[#158f83]" size={28} />
      </div>
    );
  }

  if (!config) {
    return (
      <div className="card p-5 text-sm text-red-600">{error || "שגיאה"}</div>
    );
  }

  return (
    <section className="card space-y-5 p-5 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#e4f5f2] text-[#158f83]">
            <Clock3 size={20} />
          </span>
          <div>
            <h2 className="text-lg font-bold">שעות פעילות המוקד</h2>
            <p className="mt-1 max-w-2xl text-sm text-[#718087]">
              הגדירו ימים ושעות לכל מחלקה. כשהפיצ׳ר מופעל — שיחות{" "}
              <strong>נכנסות</strong> מחוץ לשעות יופיעו בעמוד ״שיחות אחרי שעות
              הפעילות״. שיחות יוצאות תמיד נספרות כרגיל.
            </p>
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-[#dfe6ea] bg-[#f8fafb] px-4 py-3">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(event) => {
              setConfig((current) =>
                current
                  ? { ...current, enabled: event.target.checked }
                  : current,
              );
              setSaved(false);
            }}
            className="h-4 w-4 accent-[#158f83]"
          />
          <span className="text-sm font-bold text-[#17242d]">
            הפעל סינון אחרי שעות הפעילות
          </span>
        </label>
      </header>

      {!config.enabled && (
        <div className="rounded-xl border border-[#f0e1b0] bg-[#fff8e8] px-4 py-3 text-sm text-[#8a6515]">
          הפיצ׳ר כבוי כרגע. כל השיחות מוצגות בעמודים הרגילים עד להפעלה.
        </div>
      )}

      <div className="space-y-5">
        {config.departments.map((department) => (
          <article
            key={department.departmentId}
            className="overflow-hidden rounded-2xl border border-[#e5ebee]"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e5ebee] bg-[#f8fafb] px-4 py-3">
              <h3 className="font-bold text-[#17242d]">
                {department.departmentName}
              </h3>
              <button
                type="button"
                onClick={() => applyDefaultWeekdays(department.departmentId)}
                className="text-xs font-bold text-[#158f83] hover:underline"
              >
                ברירת מחדל: א׳–ה׳ 09:00–18:00
              </button>
            </div>
            <div className="overflow-auto">
              <table className="w-full border-collapse text-right text-xs">
                <thead className="bg-white text-[#738188]">
                  <tr>
                    <th className="px-3 py-2 font-semibold">יום</th>
                    <th className="px-3 py-2 font-semibold">פתוח</th>
                    <th className="px-3 py-2 font-semibold">משעה</th>
                    <th className="px-3 py-2 font-semibold">עד שעה</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#edf1f3]">
                  {department.schedule.map((day) => (
                    <tr key={day.day}>
                      <td className="px-3 py-2.5 font-bold">
                        {WEEKDAY_LABELS[day.day]}
                      </td>
                      <td className="px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={day.isOpen}
                          onChange={(event) =>
                            updateDepartmentSchedule(
                              department.departmentId,
                              day.day,
                              { isOpen: event.target.checked },
                            )
                          }
                          className="h-4 w-4 accent-[#158f83]"
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <input
                          type="time"
                          value={day.open}
                          disabled={!day.isOpen}
                          onChange={(event) =>
                            updateDepartmentSchedule(
                              department.departmentId,
                              day.day,
                              { open: event.target.value },
                            )
                          }
                          className="rounded-lg border border-[#dfe6ea] px-2 py-1.5 disabled:opacity-40"
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <input
                          type="time"
                          value={day.close}
                          disabled={!day.isOpen}
                          onChange={(event) =>
                            updateDepartmentSchedule(
                              department.departmentId,
                              day.day,
                              { close: event.target.value },
                            )
                          }
                          className="rounded-lg border border-[#dfe6ea] px-2 py-1.5 disabled:opacity-40"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        ))}
      </div>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {saved && (
        <p className="rounded-xl border border-[#cfeedf] bg-[#e8f8ef] px-4 py-3 text-sm font-semibold text-[#1f7a55]">
          ההגדרות נשמרו.{" "}
          {config.enabled
            ? "שיחות נכנסות מחוץ לשעות יופיעו בעמוד הייעודי."
            : "הפיצ׳ר כבוי — אין הפרדה של שיחות."}
        </p>
      )}

      <div className="flex justify-start">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-xl bg-[#158f83] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#11786e] disabled:opacity-60"
        >
          {saving ? (
            <LoaderCircle size={16} className="animate-spin" />
          ) : (
            <Save size={16} />
          )}
          שמירת שעות פעילות
        </button>
      </div>
    </section>
  );
}
