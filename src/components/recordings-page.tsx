"use client";

import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  Headphones,
  LoaderCircle,
  Mic2,
  Search,
  Voicemail,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDuration } from "@/lib/metrics";
import { formatPhoneDisplay } from "@/lib/phone";
import type { CallRecording, Department } from "@/lib/types";

interface RecordingsPayload {
  recordings: CallRecording[];
  departments: Department[];
  source: "demo" | "supabase";
  scopedDepartmentId?: string | null;
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  totalDurationSeconds: number;
  voicemailCount: number;
}

const PAGE_SIZE = 20;

export function RecordingsPage() {
  const [data, setData] = useState<RecordingsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (!data?.scopedDepartmentId) return;
    const timer = window.setTimeout(() => {
      setDepartment(data.scopedDepartmentId!);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [data?.scopedDepartmentId]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (search) params.set("search", search);
      if (department) params.set("department", department);
      if (type) params.set("type", type);

      const response = await fetch(`/api/recordings?${params}`, {
        cache: "no-store",
        signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : "טעינת ההקלטות נכשלה",
        );
      }
      setData(payload as RecordingsPayload);
    } catch (reason) {
      if (reason instanceof Error && reason.name === "AbortError") return;
      setError(reason instanceof Error ? reason.message : "טעינת ההקלטות נכשלה");
    } finally {
      setLoading(false);
    }
  }, [page, search, department, type]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  const recordings = data?.recordings ?? [];
  const totalPages = Math.max(1, data?.totalPages ?? 1);
  const totalCount = data?.totalCount ?? 0;

  const pageNumbers = useMemo(
    () => buildPageNumbers(page, totalPages),
    [page, totalPages],
  );

  if (error && !data) {
    return <div className="card p-8 text-center text-red-600">{error}</div>;
  }
  if (!data && loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <LoaderCircle className="animate-spin text-[#158f83]" size={34} />
      </div>
    );
  }

  return (
    <>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#e4f5f2] text-[#158f83]">
            <Mic2 size={22} />
          </span>
          <div>
            <h1 className="text-2xl font-bold md:text-[28px]">הקלטות שיחות</h1>
            <p className="mt-1 text-sm text-[#75838b]">
              האזנה להקלטות לפי נציג ומחלקה · {PAGE_SIZE} בעמוד
            </p>
          </div>
        </div>
        {data?.source === "demo" && (
          <span className="rounded-full bg-[#fff2cc] px-4 py-2 text-xs font-bold text-[#8a6515]">
            הנגינה תופעל לאחר חיבור Zendesk
          </span>
        )}
      </header>

      <section className="mb-5 grid gap-3 sm:grid-cols-3">
        <Stat
          label="סה״כ הקלטות"
          value={totalCount.toLocaleString("he-IL")}
          icon={<Headphones />}
          tone="teal"
        />
        <Stat
          label="משך הקלטות כולל"
          value={formatDuration(data?.totalDurationSeconds ?? 0)}
          icon={<Clock3 />}
          tone="blue"
        />
        <Stat
          label="הודעות קוליות"
          value={(data?.voicemailCount ?? 0).toLocaleString("he-IL")}
          icon={<Voicemail />}
          tone="purple"
        />
      </section>

      <section className="card mb-4 flex flex-wrap gap-2 p-4">
        <label className="flex h-11 min-w-64 flex-1 items-center gap-2 rounded-xl border border-[#dfe6ea] px-3">
          <Search size={17} className="text-[#849198]" />
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="חיפוש נציג, מספר או טיקט..."
            className="w-full bg-transparent text-sm outline-none"
          />
        </label>
        <select
          value={department}
          onChange={(event) => {
            setDepartment(event.target.value);
            setPage(1);
          }}
          disabled={Boolean(data?.scopedDepartmentId)}
          className="h-11 min-w-40 rounded-xl border border-[#dfe6ea] bg-white px-3 text-xs font-bold outline-none disabled:bg-[#f3f6f7]"
        >
          {!data?.scopedDepartmentId && <option value="">כל המחלקות</option>}
          {(data?.departments ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <select
          value={type}
          onChange={(event) => {
            setType(event.target.value);
            setPage(1);
          }}
          className="h-11 min-w-40 rounded-xl border border-[#dfe6ea] bg-white px-3 text-xs font-bold outline-none"
        >
          <option value="">כל סוגי ההקלטות</option>
          <option value="call">שיחה</option>
          <option value="voicemail">הודעה קולית</option>
        </select>
      </section>

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#e5ebee] p-5">
          <strong>הקלטות זמינות</strong>
          <span className="text-xs text-[#7e8b92]">
            {totalCount.toLocaleString("he-IL")} תוצאות · עמוד {page} מתוך{" "}
            {totalPages.toLocaleString("he-IL")}
            {loading ? " · טוען…" : ""}
          </span>
        </div>
        <div className={`divide-y divide-[#edf1f3] ${loading ? "opacity-60" : ""}`}>
          {recordings.map((recording) => (
            <article
              key={recording.id}
              className="grid items-center gap-4 p-4 hover:bg-[#fafcfc] md:grid-cols-[1.1fr_.8fr_1.4fr]"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#e4f5f2] text-[#158f83]">
                  {recording.recordingType === "voicemail" ? (
                    <Voicemail size={18} />
                  ) : (
                    <Headphones size={18} />
                  )}
                </span>
                <div>
                  <strong className="block text-sm">
                    {recording.agentName ?? "ללא נציג"}
                  </strong>
                  <span className="text-[11px] text-[#7e8b92]">
                    {recording.departmentName ?? "ללא מחלקה"} · טיקט{" "}
                    {recording.ticketId}
                  </span>
                </div>
              </div>
              <div className="text-xs text-[#65747c]">
                <span className="block font-mono" dir="ltr">
                  {formatPhoneDisplay(recording.customerNumber)}
                </span>
                <span className="mt-1 block">
                  {new Date(recording.createdAt).toLocaleString("he-IL", {
                    dateStyle: "short",
                    timeStyle: "short",
                    timeZone: "Asia/Jerusalem",
                  })}{" "}
                  · {formatDuration(recording.durationSeconds)}
                </span>
              </div>
              {data?.source === "supabase" ? (
                <audio
                  controls
                  preload="none"
                  className="h-10 w-full"
                  src={`/api/recordings/${encodeURIComponent(recording.id)}/stream`}
                >
                  הדפדפן אינו תומך בנגן שמע.
                </audio>
              ) : (
                <div className="rounded-xl bg-[#f2f4f5] px-4 py-3 text-center text-xs text-[#7d898f]">
                  הקלטת הדגמה — ללא קובץ שמע
                </div>
              )}
            </article>
          ))}
          {!recordings.length && !loading && (
            <p className="p-16 text-center text-sm text-[#7d8a91]">
              לא נמצאו הקלטות לפי הסינון הנוכחי.
            </p>
          )}
        </div>

        {totalCount > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e5ebee] px-4 py-3">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              className="inline-flex items-center gap-1 rounded-xl border border-[#dfe6ea] px-3 py-2 text-xs font-bold disabled:opacity-40"
            >
              <ChevronRight size={14} />
              הקודם
            </button>

            <div className="flex flex-wrap items-center justify-center gap-1">
              {pageNumbers.map((item, index) =>
                item === "…" ? (
                  <span
                    key={`ellipsis-${index}`}
                    className="px-2 text-xs text-[#8a969c]"
                  >
                    …
                  </span>
                ) : (
                  <button
                    key={item}
                    type="button"
                    disabled={loading}
                    onClick={() => setPage(item)}
                    className={`min-w-9 rounded-xl px-2.5 py-2 text-xs font-bold ${
                      item === page
                        ? "bg-[#102d38] text-white"
                        : "border border-[#dfe6ea] text-[#35515c] hover:bg-[#f5f8f9]"
                    }`}
                  >
                    {item}
                  </button>
                ),
              )}
            </div>

            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() =>
                setPage((current) => Math.min(totalPages, current + 1))
              }
              className="inline-flex items-center gap-1 rounded-xl border border-[#dfe6ea] px-3 py-2 text-xs font-bold disabled:opacity-40"
            >
              הבא
              <ChevronLeft size={14} />
            </button>
          </div>
        ) : null}
      </section>

      {error ? (
        <p className="mt-3 text-center text-sm text-[#c34850]">{error}</p>
      ) : null}
    </>
  );
}

function buildPageNumbers(current: number, total: number): Array<number | "…"> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }

  const pages = new Set<number>([1, total, current]);
  for (let offset = 1; offset <= 1; offset += 1) {
    pages.add(current - offset);
    pages.add(current + offset);
  }
  if (current <= 3) {
    pages.add(2);
    pages.add(3);
    pages.add(4);
  }
  if (current >= total - 2) {
    pages.add(total - 1);
    pages.add(total - 2);
    pages.add(total - 3);
  }

  const sorted = [...pages]
    .filter((value) => value >= 1 && value <= total)
    .sort((a, b) => a - b);

  const result: Array<number | "…"> = [];
  for (const value of sorted) {
    const previous = result[result.length - 1];
    if (typeof previous === "number" && value - previous > 1) {
      result.push("…");
    }
    result.push(value);
  }
  return result;
}

const tones = {
  teal: "bg-[#e4f5f2] text-[#158f83]",
  blue: "bg-[#e8effe] text-[#4772ce]",
  purple: "bg-[#f0ebff] text-[#7954c5]",
};

function Stat({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  tone: keyof typeof tones;
}) {
  return (
    <article className="card flex items-center gap-4 p-5">
      <span
        className={`flex h-12 w-12 items-center justify-center rounded-2xl ${tones[tone]}`}
      >
        {icon}
      </span>
      <div>
        <p className="text-xs font-semibold text-[#7c8990]">{label}</p>
        <strong className="mt-1 block text-2xl">{value}</strong>
      </div>
    </article>
  );
}
