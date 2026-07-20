"use client";

import {
  AlertTriangle,
  CalendarDays,
  CircleAlert,
  Info,
  LoaderCircle,
  ScrollText,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type SystemLog = {
  id: string;
  severity: "info" | "warning" | "error";
  category: string;
  title: string;
  message: string;
  details: Record<string, unknown>;
  occurredAtIsrael: string;
};

type LogsPayload = {
  from: string;
  to: string;
  logs: SystemLog[];
};

function toInputDate(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

export function SystemLogsClient() {
  const [from, setFrom] = useState(() =>
    toInputDate(new Date(Date.now() - 7 * 86_400_000)),
  );
  const [to, setTo] = useState(() => toInputDate(new Date()));
  const [severity, setSeverity] = useState("");
  const [data, setData] = useState<LogsPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ from, to });
      if (severity) params.set("severity", severity);
      const response = await fetch(`/api/system-logs?${params}`, {
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "טעינת הלוג נכשלה");
      setData(result);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "טעינת הלוג נכשלה",
      );
    } finally {
      setLoading(false);
    }
  }, [from, to, severity]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#e4f5f2] text-[#158f83]">
          <ScrollText size={23} />
        </span>
        <div>
          <h1 className="text-2xl font-bold">לוג מערכת</h1>
          <p className="mt-1 text-sm text-[#75838b]">
            שגיאות, אזהרות ואירועי מערכת עם תאריך ושעה לפי שעון ישראל
          </p>
        </div>
      </header>

      <section className="card flex flex-wrap items-center gap-2 p-4">
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
        <select
          value={severity}
          onChange={(event) => setSeverity(event.target.value)}
          className="h-10 rounded-xl border border-[#dfe6ea] bg-white px-3 text-xs font-bold outline-none"
        >
          <option value="">כל החומרות</option>
          <option value="error">שגיאות</option>
          <option value="warning">אזהרות</option>
          <option value="info">מידע</option>
        </select>
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
        <section className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-[#f7fafb] text-[#6d7c84]">
                <tr>
                  <th className="px-4 py-3 text-right font-medium">זמן ישראל</th>
                  <th className="px-4 py-3 text-right font-medium">חומרה</th>
                  <th className="px-4 py-3 text-right font-medium">קטגוריה</th>
                  <th className="px-4 py-3 text-right font-medium">אירוע</th>
                </tr>
              </thead>
              <tbody>
                {(data?.logs ?? []).map((log) => (
                  <tr key={log.id} className="border-t border-[#eef3f5] align-top">
                    <td className="px-4 py-3 font-mono text-xs" dir="ltr">
                      {log.occurredAtIsrael}
                    </td>
                    <td className="px-4 py-3">
                      <SeverityBadge severity={log.severity} />
                    </td>
                    <td className="px-4 py-3 text-xs text-[#5d6d75]">
                      {log.category}
                    </td>
                    <td className="px-4 py-3">
                      <strong className="block text-sm">{log.title}</strong>
                      <p className="mt-1 text-xs text-[#5d6d75]">{log.message}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(data?.logs.length ?? 0) === 0 && (
              <p className="px-5 py-10 text-center text-sm text-[#75838b]">
                אין אירועים בטווח שנבחר
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function SeverityBadge({
  severity,
}: {
  severity: "info" | "warning" | "error";
}) {
  if (severity === "error") {
    return (
      <span className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">
        <CircleAlert size={13} />
        שגיאה
      </span>
    );
  }
  if (severity === "warning") {
    return (
      <span className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
        <AlertTriangle size={13} />
        אזהרה
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-lg bg-[#e4f5f2] px-2.5 py-1 text-xs font-semibold text-[#11786e]">
      <Info size={13} />
      מידע
    </span>
  );
}
