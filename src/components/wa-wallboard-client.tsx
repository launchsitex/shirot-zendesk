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
import {
  currentlyWaiting,
  firstResponseElapsed,
  firstResponseTierCounts,
  waitingTier,
  type WaDashboardPayload,
  type WaitingTierMinutes,
} from "@/lib/wa-dashboard";

const REFRESH_MS = 30_000;
const WAITING_LIST_CAP = 24;

function seconds(value: number | null): string {
  return value != null ? formatSecondsLabel(value) : "—";
}

function tierTone(minutes: WaitingTierMinutes | null) {
  switch (minutes) {
    case 10:
      return { bg: "bg-[#3a1a18]", text: "text-[#ff8a80]" };
    case 7:
      return { bg: "bg-[#3a2712]", text: "text-[#ffb066]" };
    case 3:
      return { bg: "bg-[#33300f]", text: "text-[#f0d15a]" };
    default:
      return { bg: "bg-white/8", text: "text-white/80" };
  }
}

/**
 * TV wallboard for today's WhatsApp tickets — the WhatsApp counterpart to
 * "מסך מוקד (TV)" ([[wallboard-client]]). Always today (Israel time), unlike
 * the regular "דשבורד WA" page which lets a viewer pick another day.
 *
 * Leads with the 3/7/10-minute escalation tiers for customers still waiting
 * on a reply to their most recent message — the account owner asked for this
 * ahead of the close-time stats, since it is what a manager acts on in the
 * moment. The avg response/close-time figures move to the department boxes
 * instead of the headline row.
 *
 * Scoped server-side to the Customer Service department only (excludes
 * Deliveries) — see DEPARTMENT_FILTER_ID in the shared /api/wa-dashboard
 * route.
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

  // Tickets still waiting for the assignee's first reply, longest first —
  // recomputed every second (via `now`) rather than only on each poll, the
  // same reasoning as the calls wallboard's WaitingTimeBox.
  const waiting = useMemo(
    () => currentlyWaiting(data?.rows ?? [], now),
    [data?.rows, now],
  );
  // First response — from the bot's handoff to the agent's first message —
  // as how many tickets crossed each tier today (unanswered ones count live).
  const tiers = useMemo(
    () => firstResponseTierCounts(data?.rows ?? [], now),
    [data?.rows, now],
  );

  // The most critical tier (10+ minutes to a first reply) per department, for
  // the department boxes below — the tier row above gives the org-wide picture.
  const over10ByDepartment = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of data?.rows ?? []) {
      const elapsed = firstResponseElapsed(row, now);
      if (elapsed == null || elapsed < 10 * 60) continue;
      const key = row.departmentName ?? "ללא שיוך מחלקה";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [data?.rows, now]);

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
          <WallMetric label="מעל 10 דק׳ לתגובה ראשונה" value={tiers[10]} tone="red" />
          <WallMetric label="מעל 7 דק׳ לתגובה ראשונה" value={tiers[7]} tone="orange" />
          <WallMetric label="מעל 3 דק׳ לתגובה ראשונה" value={tiers[3]} tone="amber" />
          <WallMetric label="פניות היום" value={data?.totals.ticketCount ?? 0} tone="teal" />
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
                over10={over10ByDepartment.get(dept.departmentName) ?? 0}
              />
            ))}
          </section>
        )}

        <article className="flex-1 rounded-3xl border border-white/10 bg-white/5 p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertTriangle className="text-[#f0c15a]" size={24} />
              <div>
                <h2 className="text-xl font-bold">ממתינים לתגובה</h2>
                <p className="text-xs text-white/45">
                  הזמן הגדול — מאז ההודעה של הלקוח שעדיין לא נענתה · הקטן —
                  סה״כ מאז פתיחת הפנייה
                </p>
              </div>
            </div>
            <strong className="text-2xl text-[#f0c15a]">{waiting.length}</strong>
          </div>
          {waiting.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {waiting.slice(0, WAITING_LIST_CAP).map((ticket) => {
                const tone = tierTone(waitingTier(ticket.waitedSeconds));
                return (
                  <div
                    key={ticket.id}
                    className={`flex items-center justify-between rounded-2xl px-4 py-3 ${tone.bg}`}
                  >
                    <div className="min-w-0">
                      <strong className="block truncate text-base">
                        {ticket.customerName ?? formatPhone(ticket.customerPhone)}
                      </strong>
                      <span className="block text-xs text-white/45">
                        {ticket.agentName ?? "ללא שיוך נציג"} ·{" "}
                        <span dir="ltr">#{ticket.id}</span>
                      </span>
                    </div>
                    <div className="shrink-0 text-left">
                      <span className={`block text-xl font-bold ${tone.text}`}>
                        {formatDuration(ticket.waitedSeconds)}
                      </span>
                      <span className="block font-mono text-xs text-white/40">
                        סה״כ {formatDuration(ticket.totalSeconds)}
                      </span>
                    </div>
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
  tone: "teal" | "red" | "orange" | "blue" | "amber";
}) {
  const tones = {
    teal: "from-[#134e48] to-[#0f3a36] border-[#1da99b]/35",
    red: "from-[#4a1d24] to-[#351418] border-[#f07178]/35",
    orange: "from-[#4a2e14] to-[#34200e] border-[#ffb066]/35",
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
  over10,
}: {
  name: string;
  ticketCount: number;
  avgFirstResponseSeconds: number | null;
  avgTimeToCloseSeconds: number | null;
  over10: number;
}) {
  const tone = over10 > 0
    ? {
      border: "border-[#e0564f]/50",
      bg: "bg-[#3a1a18]",
      accent: "text-[#ff8a80]",
      label: "text-[#ff8a80]/70",
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
        {over10 > 0 && (
          <div>
            <span className={`block text-xs ${tone.label}`}>מעל 10 דק&apos; לתגובה ראשונה</span>
            <strong className={`block text-2xl font-bold ${tone.accent}`}>
              {over10}
            </strong>
          </div>
        )}
      </div>
    </article>
  );
}
