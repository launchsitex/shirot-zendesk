"use client";

import {
  AlertTriangle,
  LoaderCircle,
  LogOut,
  Maximize2,
  MessageCircle,
  Minimize2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getHomeHref, type AppProfile } from "@/lib/app-pages";
import { formatDuration, formatSecondsLabel } from "@/lib/metrics";
import {
  createSupabaseBrowserClient,
  isSupabaseBrowserConfigured,
} from "@/lib/supabase/browser";
import { formatPhone } from "@/lib/tickets";
import { STALE_THRESHOLD_SECONDS, type WaDashboardPayload } from "@/lib/wa-dashboard";

const REFRESH_MS = 30_000;

function elapsedSeconds(iso: string, now: Date) {
  return Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 1000));
}

function seconds(value: number | null): string {
  return value != null ? formatSecondsLabel(value) : "—";
}

/**
 * TV wallboard for today's WhatsApp tickets — the WhatsApp counterpart to
 * "מסך מוקד (TV)" ([[wallboard-client]]). Always today (Israel time), unlike
 * the regular "דשבורד WA" page which lets a viewer pick another day.
 *
 * Deliberately polling-only, no Supabase Realtime channel: the underlying
 * Zendesk sync itself only runs once a minute (a cron job, not a webhook), so
 * subscribing to postgres_changes on zendesk_tickets would add load without
 * adding any real freshness — unlike the calls wallboard, where calls land in
 * the database the instant Aircall's webhook fires.
 */
export function WaWallboardClient() {
  const [data, setData] = useState<WaDashboardPayload | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => new Date());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [profile, setProfile] = useState<AppProfile | null>(null);

  const loadData = useCallback(async () => {
    try {
      const response = await fetch("/api/wa-dashboard", { cache: "no-store" });
      if (!response.ok) throw new Error("לא ניתן לטעון את נתוני הוואטסאפ");
      const result = (await response.json()) as WaDashboardPayload;
      setData(result);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "אירעה שגיאה");
    }
  }, []);

  useEffect(() => {
    fetch("/api/me", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const result = await response.json();
        setProfile(result.profile ?? null);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadData(), 0);
    const polling = window.setInterval(() => void loadData(), REFRESH_MS);
    const clock = window.setInterval(() => setNow(new Date()), 1_000);

    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFsChange);

    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(polling);
      window.clearInterval(clock);
      document.removeEventListener("fullscreenchange", onFsChange);
    };
  }, [loadData]);

  const homeHref = getHomeHref(profile);
  const soloPage =
    Boolean(profile) &&
    profile!.allowedPages.length === 1 &&
    profile!.allowedPages[0] === "wa-dashboard-tv";

  async function signOut() {
    if (isSupabaseBrowserConfigured()) {
      await createSupabaseBrowserClient().auth.signOut();
    }
    window.location.href = "/login";
  }

  async function toggleFullscreen() {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  }

  // Tickets still waiting for the assignee's first reply, oldest first — the
  // one figure on this screen that benefits from ticking live between polls,
  // the same reasoning as the calls wallboard's WaitingTimeBox.
  const awaitingFirstResponse = useMemo(
    () =>
      (data?.rows ?? [])
        .filter((row) => row.firstResponseSeconds == null && !row.closed)
        .sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        )
        .slice(0, 12),
    [data?.rows],
  );

  if (!data && !error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0d222b] text-white">
        <LoaderCircle className="animate-spin text-[#1da99b]" size={48} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0d222b] text-white">
      <div className="mx-auto flex min-h-screen max-w-[1800px] flex-col gap-5 p-4 md:p-6 xl:p-8">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#1f9d72]">
              <MessageCircle size={28} />
            </span>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-bold tracking-tight xl:text-4xl">
                  דשבורד TV WA
                </h1>
                <span className="flex items-center gap-2 rounded-full bg-[#1f9d72]/20 px-3 py-1 text-sm font-bold text-[#6ee0d0]">
                  <i className="live-dot h-2.5 w-2.5 rounded-full bg-[#6ee0d0]" />
                  LIVE
                </span>
              </div>
              <p className="mt-1 text-sm text-white/55">
                פניות וואטסאפ מ-Zendesk · היום
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-white/8 px-5 py-3 text-center">
              <p className="text-xs text-white/45">שעה</p>
              <strong className="block font-mono text-3xl tracking-wide">
                {now.toLocaleTimeString("he-IL", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                  timeZone: "Asia/Jerusalem",
                })}
              </strong>
            </div>
            <button
              type="button"
              onClick={() => void toggleFullscreen()}
              className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 text-white/80 hover:bg-white/15"
              aria-label={isFullscreen ? "יציאה ממסך מלא" : "מסך מלא"}
              title={isFullscreen ? "יציאה ממסך מלא" : "מסך מלא"}
            >
              {isFullscreen ? <Minimize2 size={22} /> : <Maximize2 size={22} />}
            </button>
            {!soloPage && (
              <Link
                href={homeHref === "/wa-dashboard/tv" ? "/wa-dashboard" : homeHref}
                className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 text-white/80 hover:bg-white/15"
                aria-label="חזרה למערכת"
                title="חזרה למערכת"
              >
                <X size={22} />
              </Link>
            )}
            <button
              type="button"
              onClick={() => void signOut()}
              className="inline-flex h-12 items-center gap-2 rounded-xl bg-white/10 px-4 text-sm font-semibold text-white/90 hover:bg-white/15"
              aria-label="התנתק"
              title="התנתק"
            >
              <LogOut size={18} />
              התנתק
            </button>
          </div>
        </header>

        {error && (
          <div className="rounded-2xl border border-red-400/40 bg-red-500/15 px-4 py-3 text-red-100">
            {error}
          </div>
        )}

        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <WallMetric label="פניות היום" value={data?.totals.ticketCount ?? 0} tone="teal" />
          <WallMetric
            label="תגובה ראשונה ממוצעת"
            value={seconds(data?.totals.avgFirstResponseSeconds ?? null)}
            tone="blue"
          />
          <WallMetric
            label="זמן עד סגירה ממוצע"
            value={seconds(data?.totals.avgTimeToCloseSeconds ?? null)}
            tone="amber"
          />
          <WallMetric label="טרם נענו" value={data?.totals.awaitingFirstResponse ?? 0} tone="red" />
        </section>

        {(data?.byDepartment.length ?? 0) > 0 && (
          <section
            className={`grid gap-3 ${
              (data?.byDepartment.length ?? 0) > 1 ? "md:grid-cols-2" : ""
            }`}
          >
            {data?.byDepartment.map((dept) => (
              <DepartmentBox
                key={dept.departmentName}
                name={dept.departmentName}
                ticketCount={dept.ticketCount}
                avgFirstResponseSeconds={dept.avgFirstResponseSeconds}
                avgTimeToCloseSeconds={dept.avgTimeToCloseSeconds}
                awaitingFirstResponse={dept.awaitingFirstResponse}
              />
            ))}
          </section>
        )}

        <article className="flex-1 rounded-3xl border border-white/10 bg-white/5 p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertTriangle className="text-[#f0c15a]" size={24} />
              <h2 className="text-xl font-bold">ממתינים לתגובה ראשונה</h2>
            </div>
            <strong className="text-2xl text-[#f0c15a]">
              {data?.totals.awaitingFirstResponse ?? 0}
            </strong>
          </div>
          {awaitingFirstResponse.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {awaitingFirstResponse.map((ticket) => {
                const waited = elapsedSeconds(ticket.createdAt, now);
                const stale = waited >= STALE_THRESHOLD_SECONDS;
                return (
                  <div
                    key={ticket.id}
                    className={`flex items-center justify-between rounded-2xl px-4 py-3 ${
                      stale ? "bg-[#3a1a18]" : "bg-white/8"
                    }`}
                  >
                    <div className="min-w-0">
                      <strong className="block truncate text-base">
                        {ticket.customerName ?? formatPhone(ticket.customerPhone)}
                      </strong>
                      <span className="text-xs text-white/45">
                        {ticket.agentName ?? "ללא שיוך נציג"} ·{" "}
                        {ticket.departmentName ?? "—"}
                      </span>
                    </div>
                    <span
                      className={`text-xl font-bold ${
                        stale ? "text-[#ff8a80]" : "text-white/80"
                      }`}
                    >
                      {formatDuration(waited)}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="py-8 text-center text-lg text-white/40">
              כל הפניות היום קיבלו תגובה ראשונה
            </p>
          )}
        </article>
      </div>
    </div>
  );
}

function WallMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone: "teal" | "red" | "blue" | "amber";
}) {
  const tones = {
    teal: "from-[#134e48] to-[#0f3a36] border-[#1da99b]/35",
    red: "from-[#4a1d24] to-[#351418] border-[#f07178]/35",
    blue: "from-[#1a3358] to-[#13243f] border-[#7eb6ff]/35",
    amber: "from-[#4a3814] to-[#34270e] border-[#f0c15a]/35",
  };
  return (
    <article className={`rounded-3xl border bg-gradient-to-b p-5 ${tones[tone]}`}>
      <p className="text-sm font-semibold text-white/55">{label}</p>
      <strong className="mt-2 block text-4xl font-bold tracking-tight xl:text-5xl">
        {value}
      </strong>
    </article>
  );
}

function DepartmentBox({
  name,
  ticketCount,
  avgFirstResponseSeconds,
  avgTimeToCloseSeconds,
  awaitingFirstResponse,
}: {
  name: string;
  ticketCount: number;
  avgFirstResponseSeconds: number | null;
  avgTimeToCloseSeconds: number | null;
  awaitingFirstResponse: number;
}) {
  const tone = awaitingFirstResponse > 0
    ? {
      border: "border-[#e1a62b]/40",
      bg: "bg-[#2a2112]",
      accent: "text-[#f0c15a]",
      label: "text-[#f0c15a]/70",
    }
    : {
      border: "border-[#2f9e8f]/35",
      bg: "bg-[#122a26]",
      accent: "text-[#6ee0d0]",
      label: "text-[#6ee0d0]/70",
    };

  return (
    <article className={`rounded-2xl border ${tone.border} ${tone.bg} px-4 py-3`}>
      <div className="mb-2 flex items-center gap-2">
        <MessageCircle className={tone.accent} size={18} />
        <h2 className="text-base font-bold">{name}</h2>
        <strong className={`mr-auto rounded-full bg-white/10 px-3 py-0.5 text-sm ${tone.accent}`}>
          {ticketCount} פניות
        </strong>
      </div>
      <div className="flex items-end gap-6">
        <div>
          <span className={`block text-xs ${tone.label}`}>תגובה ראשונה</span>
          <strong className={`block text-3xl font-bold ${tone.accent}`}>
            {seconds(avgFirstResponseSeconds)}
          </strong>
        </div>
        <div>
          <span className={`block text-xs ${tone.label}`}>עד סגירה</span>
          <strong className="block text-2xl font-bold text-white/80">
            {seconds(avgTimeToCloseSeconds)}
          </strong>
        </div>
        {awaitingFirstResponse > 0 && (
          <div>
            <span className={`block text-xs ${tone.label}`}>טרם נענו</span>
            <strong className={`block text-2xl font-bold ${tone.accent}`}>
              {awaitingFirstResponse}
            </strong>
          </div>
        )}
      </div>
    </article>
  );
}
