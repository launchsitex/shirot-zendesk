"use client";

import {
  Clock3,
  Headphones,
  LoaderCircle,
  Mic2,
  Search,
  Voicemail,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatDuration } from "@/lib/metrics";
import { formatPhoneDisplay, phoneSearchText } from "@/lib/phone";
import type { CallRecording, Department } from "@/lib/types";

interface RecordingsPayload {
  recordings: CallRecording[];
  departments: Department[];
  source: "demo" | "supabase";
}

export function RecordingsPage() {
  const [data, setData] = useState<RecordingsPayload | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("");
  const [type, setType] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/recordings", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error("טעינת ההקלטות נכשלה");
        return response.json();
      })
      .then(setData)
      .catch((reason) => {
        if (reason.name !== "AbortError") setError(reason.message);
      });
    return () => controller.abort();
  }, []);

  const recordings = useMemo(
    () =>
      (data?.recordings ?? []).filter((recording) => {
        const needle = search.trim().toLowerCase();
        return (
          (!needle ||
            recording.agentName?.toLowerCase().includes(needle) ||
            phoneSearchText(recording.customerNumber).includes(
              needle.replace(/\D/g, "") || needle,
            ) ||
            recording.ticketId.includes(needle)) &&
          (!department || recording.departmentId === department) &&
          (!type || recording.recordingType === type)
        );
      }),
    [data, department, search, type],
  );
  const totalDuration = recordings.reduce(
    (sum, recording) => sum + recording.durationSeconds,
    0,
  );

  if (error) {
    return <div className="card p-8 text-center text-red-600">{error}</div>;
  }
  if (!data) {
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
              האזנה להקלטות Zendesk Talk לפי נציג ומחלקה
            </p>
          </div>
        </div>
        {data.source === "demo" && (
          <span className="rounded-full bg-[#fff2cc] px-4 py-2 text-xs font-bold text-[#8a6515]">
            הנגינה תופעל לאחר חיבור Zendesk
          </span>
        )}
      </header>

      <section className="mb-5 grid gap-3 sm:grid-cols-3">
        <Stat
          label="סה״כ הקלטות"
          value={recordings.length}
          icon={<Headphones />}
          tone="teal"
        />
        <Stat
          label="משך הקלטות כולל"
          value={formatDuration(totalDuration)}
          icon={<Clock3 />}
          tone="blue"
        />
        <Stat
          label="הודעות קוליות"
          value={
            recordings.filter(
              (recording) => recording.recordingType === "voicemail",
            ).length
          }
          icon={<Voicemail />}
          tone="purple"
        />
      </section>

      <section className="card mb-4 flex flex-wrap gap-2 p-4">
        <label className="flex h-11 min-w-64 flex-1 items-center gap-2 rounded-xl border border-[#dfe6ea] px-3">
          <Search size={17} className="text-[#849198]" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="חיפוש נציג, מספר או טיקט..."
            className="w-full bg-transparent text-sm outline-none"
          />
        </label>
        <select
          value={department}
          onChange={(event) => setDepartment(event.target.value)}
          className="h-11 min-w-40 rounded-xl border border-[#dfe6ea] bg-white px-3 text-xs font-bold outline-none"
        >
          <option value="">כל המחלקות</option>
          {data.departments.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <select
          value={type}
          onChange={(event) => setType(event.target.value)}
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
          <span className="text-xs text-[#7e8b92]">{recordings.length} תוצאות</span>
        </div>
        <div className="divide-y divide-[#edf1f3]">
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
              {data.source === "supabase" ? (
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
          {!recordings.length && (
            <p className="p-16 text-center text-sm text-[#7d8a91]">
              עדיין לא נמצאו הקלטות. הן יופיעו לאחר סנכרון Zendesk Talk.
            </p>
          )}
        </div>
      </section>
    </>
  );
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

