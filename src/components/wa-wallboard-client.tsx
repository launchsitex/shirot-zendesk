"use client";

import {
  Inbox,
  LoaderCircle,
  Radio,
  LogOut,
  Maximize2,
  MessageCircle,
  Minimize2,
  UsersRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getHomeHref, type AppProfile } from "@/lib/app-pages";
import { formatDuration, formatSecondsLabel } from "@/lib/metrics";
import {
  createSupabaseBrowserClient,
  isSupabaseBrowserConfigured,
} from "@/lib/supabase/browser";
import { businessClockLabel, businessOpenAt } from "@/lib/business-clock";
import { formatPhone } from "@/lib/tickets";
import {
  agentKey,
  readExcludedAgents,
  writeExcludedAgents,
} from "@/lib/wa-agent-filter";
import {
  agentStatusLabel,
  currentlyWaiting,
  firstResponseElapsed,
  firstResponseTierCounts,
  firstResponseUnderCount,
  freeMessagingSlots,
  queueByDepartment,
  sortAvailability,
  summarizeByDepartment,
  summarizeTickets,
  waitingTier,
  type WaDashboardPayload,
  type WaitingTierMinutes,
} from "@/lib/wa-dashboard";

const REFRESH_MS = 30_000;
const DEFAULT_DEPARTMENT_ID = "customer-service";

function seconds(value: number | null): string {
  return value != null ? formatSecondsLabel(value) : "—";
}

// Muted on purpose: a wall screen full of saturated red reads as alarm, and
// the account owner asked for something calmer. The tier still shows in the
// accent colour of the time itself; the card stays quiet.
function tierTone(minutes: WaitingTierMinutes | null) {
  switch (minutes) {
    case 10:
      return { bg: "bg-[#2c2226] ring-1 ring-[#f2a7a0]/25", text: "text-[#f2a7a0]" };
    case 7:
      return { bg: "bg-[#2b2620] ring-1 ring-[#f0c38e]/25", text: "text-[#f0c38e]" };
    case 3:
      return { bg: "bg-[#29291f] ring-1 ring-[#e8dc9a]/20", text: "text-[#e8dc9a]" };
    default:
      return { bg: "bg-white/6", text: "text-white/75" };
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
 * One screen per department, chosen by `?department=<id>` in the URL and
 * passed through to the shared /api/wa-dashboard route; defaults to Customer
 * Service.
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
  // Agents excluded from every figure on the screen — same per-department
  // choice as the dashboard's picker, so both screens agree in one browser.
  const [excluded, setExcluded] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  // One wall screen per department: the department comes from the URL, so a
  // TV for deliveries is simply /wa-dashboard/tv?department=deliveries.
  const departmentId = useSearchParams().get("department") ?? DEFAULT_DEPARTMENT_ID;

  const loadData = useCallback(async () => {
    try {
      const params = new URLSearchParams({ department: departmentId });
      const response = await fetch(`/api/wa-dashboard?${params}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("לא ניתן לטעון את נתוני הוואטסאפ");
      const result = (await response.json()) as WaDashboardPayload;
      setData(result);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "אירעה שגיאה");
    }
  }, [departmentId]);

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
    // Read after mount so the server render and the first client render
    // match; re-read when the department changes since the choice is per
    // department.
    const stored = readExcludedAgents(departmentId);
    const timer = window.setTimeout(() => setExcluded(stored), 0);
    return () => window.clearTimeout(timer);
  }, [departmentId]);

  function updateExcluded(next: string[]) {
    setExcluded(next);
    writeExcludedAgents(departmentId, next);
  }

  function toggleAgent(key: string) {
    updateExcluded(
      excluded.includes(key)
        ? excluded.filter((item) => item !== key)
        : [...excluded, key],
    );
  }

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

  // Everything below derives from the visible rows, so excluding an agent
  // changes every number on the screen consistently.
  const allAgents = useMemo(() => data?.byAgent ?? [], [data?.byAgent]);
  const visibleRows = useMemo(
    () => (data?.rows ?? []).filter((row) => !excluded.includes(agentKey(row.agentId))),
    [data?.rows, excluded],
  );
  const totals = useMemo(() => summarizeTickets(visibleRows), [visibleRows]);
  const byDepartment = useMemo(() => summarizeByDepartment(visibleRows), [visibleRows]);
  const includedCount = allAgents.filter((a) => !excluded.includes(agentKey(a.agentId))).length;

  // Tickets still waiting for the assignee's first reply, longest first —
  // recomputed every second (via `now`) rather than only on each poll, the
  // same reasoning as the calls wallboard's WaitingTimeBox.
  // Every live duration runs on the department's business clock (the
  // recorded ones in the rows already do, server-side).
  const clock = data?.businessHours ?? null;
  const clockLabel = businessClockLabel(clock);
  // After hours nobody is expected to pick the queue up, so the queue is
  // titled for what it is then: customers waiting for the next shift.
  const openNow = businessOpenAt(now, clock);
  const waiting = useMemo(
    () => currentlyWaiting(visibleRows, now, clock),
    [visibleRows, now, clock],
  );
  const queue = useMemo(
    () => queueByDepartment(data?.queue ?? [], now),
    [data?.queue, now],
  );
  const availability = useMemo(
    () =>
      sortAvailability(
        (data?.availability ?? []).filter(
          (agent) => !excluded.includes(agentKey(agent.agentId)),
        ),
      ),
    [data?.availability, excluded],
  );

  // Waiting customers grouped by their agent; groups ordered by the longest
  // wait inside them, tickets already longest-first from currentlyWaiting.
  const waitingByAgent = useMemo(() => {
    const groups = new Map<string, { key: string; agentName: string; tickets: typeof waiting }>();
    for (const ticket of waiting) {
      const key = ticket.agentId ?? "unassigned";
      const group = groups.get(key) ?? {
        key,
        agentName: ticket.agentName ?? "ללא שיוך נציג",
        tickets: [],
      };
      group.tickets.push(ticket);
      groups.set(key, group);
    }
    return [...groups.values()].sort(
      (a, b) => b.tickets[0].waitedSeconds - a.tickets[0].waitedSeconds,
    );
  }, [waiting]);
  // First response — from the bot's handoff to the agent's first message —
  // as how many tickets crossed each tier today (unanswered ones count live).
  const tiers = useMemo(
    () => firstResponseTierCounts(visibleRows, now, clock),
    [visibleRows, now, clock],
  );
  const underThree = useMemo(
    () => firstResponseUnderCount(visibleRows, 3),
    [visibleRows],
  );

  // The most critical tier (10+ minutes to a first reply) per department, for
  // the department boxes below — the tier row above gives the org-wide picture.
  const over10ByDepartment = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of visibleRows) {
      const elapsed = firstResponseElapsed(row, now, clock);
      if (elapsed == null || elapsed < 10 * 60) continue;
      const key = row.departmentName ?? "ללא שיוך מחלקה";
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return map;
  }, [visibleRows, now, clock]);

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
                פניות וואטסאפ מ-Zendesk · {data?.department.name ?? "…"} · היום
                {clockLabel && ` · שעון עסקי ${clockLabel}, ללא ערבי חג וחגים`}
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
            {allAgents.length > 0 && (
              <button
                type="button"
                onClick={() => setPickerOpen((open) => !open)}
                className={`inline-flex h-12 items-center gap-2 rounded-xl px-4 text-sm font-semibold hover:bg-white/15 ${
                  includedCount < allAgents.length
                    ? "bg-[#e1a62b]/20 text-[#f4d58a] ring-1 ring-[#e1a62b]/50"
                    : "bg-white/10 text-white/90"
                }`}
                aria-expanded={pickerOpen}
                aria-label="בחירת נציגות בחישוב"
                title="בחירת נציגות בחישוב"
              >
                <UsersRound size={18} />
                נציגות {includedCount}/{allAgents.length}
              </button>
            )}
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

        {pickerOpen && allAgents.length > 0 && (
          <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-bold">
                <UsersRound size={16} className="text-white/60" />
                נציגות בחישוב
                <span className="font-normal text-white/45">
                  · ביטול סימון מחריג את הנציגה מכל המספרים במסך
                </span>
              </h2>
              <div className="flex gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => updateExcluded([])}
                  className="rounded-lg bg-white/10 px-2.5 py-1 font-semibold text-white/80 hover:bg-white/15"
                >
                  בחר הכל
                </button>
                <button
                  type="button"
                  onClick={() => updateExcluded(allAgents.map((a) => agentKey(a.agentId)))}
                  className="rounded-lg bg-white/10 px-2.5 py-1 font-semibold text-white/80 hover:bg-white/15"
                >
                  נקה הכל
                </button>
                <button
                  type="button"
                  onClick={() => setPickerOpen(false)}
                  className="rounded-lg bg-white/10 px-2.5 py-1 font-semibold text-white/80 hover:bg-white/15"
                >
                  סגור
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {allAgents.map((agent) => {
                const key = agentKey(agent.agentId);
                const checked = !excluded.includes(key);
                return (
                  <label
                    key={key}
                    className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-1.5 text-sm transition ${
                      checked
                        ? "border-[#1f9d72] bg-[#1f9d72]/20 text-[#6ee0d0]"
                        : "border-white/15 bg-transparent text-white/40"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleAgent(key)}
                      className="accent-[#1f9d72]"
                    />
                    {agent.agentName}
                    <span className="text-xs opacity-70">{agent.ticketCount}</span>
                  </label>
                );
              })}
            </div>
          </section>
        )}

        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <WallMetric label="נענו תוך פחות מ-3 דק׳" value={underThree} tone="green" />
          <WallMetric label="מעל 3 דק׳ לתגובה ראשונה" value={tiers[3]} tone="amber" />
          <WallMetric label="מעל 7 דק׳ לתגובה ראשונה" value={tiers[7]} tone="orange" />
          <WallMetric label="מעל 10 דק׳ לתגובה ראשונה" value={tiers[10]} tone="red" />
          <WallMetric
            label="פניות היום"
            value={totals.ticketCount}
            hint={`${totals.ticketCount - totals.closedCount} פתוחות · ${totals.closedCount} נסגרו`}
            tone="teal"
          />
        </section>

        <article className="rounded-2xl border border-[#e1a62b]/35 bg-[#2a2112] p-3.5">
          <div className="mb-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Inbox className="text-[#f0c15a]" size={20} />
              <h2 className="text-base font-bold">
                {openNow ? "ממתינים לשיוך נציגה" : "ממתינים אחרי שעות הפעילות"}
              </h2>
              <span className="text-xs text-[#f0c15a]/60">
                {openNow
                  ? "הבוט העביר, אף אחת עוד לא לקחה · לפי מחלקה"
                  : "הבוט העביר מחוץ לשעות הפעילות, ייענו במשמרת הבאה · לפי מחלקה"}
              </span>
            </div>
            <strong className="rounded-full bg-[#f0c15a] px-3 py-1 text-lg text-[#2a2112]">
              {queue.reduce((sum, group) => sum + group.tickets.length, 0)}
            </strong>
          </div>
          {queue.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {queue.map((group) => (
                <div key={group.departmentName} className="rounded-xl bg-[#3a2e14]/60 p-2.5">
                  <div className="mb-2 flex items-center justify-between px-1">
                    <strong className="text-sm">{group.departmentName}</strong>
                    <span className="flex items-center gap-2 text-sm">
                      {group.olderCount > 0 && (
                        <span className="text-xs text-white/40">+{group.olderCount} ישנות מיממה</span>
                      )}
                      <span className="font-bold text-[#f0c15a]">{group.tickets.length}</span>
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {group.tickets.map((ticket) => {
                      const tone = tierTone(waitingTier(ticket.waitedSeconds));
                      return (
                        <div
                          key={ticket.id}
                          className={`flex items-center justify-between rounded-xl px-3 py-2 ${tone.bg}`}
                        >
                          <div className="min-w-0">
                            <strong className="block truncate text-sm">
                              {ticket.customerName ?? formatPhone(ticket.customerPhone)}
                            </strong>
                            <span dir="ltr" className="text-xs text-white/45">#{ticket.id}</span>
                          </div>
                          <span className={`shrink-0 text-base font-bold ${tone.text}`}>
                            {formatDuration(ticket.waitedSeconds)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="py-2 text-center text-sm text-[#f0c15a]/70">
              אין פניות שממתינות לשיוך
            </p>
          )}
        </article>

        <article className="flex-1 rounded-3xl border border-white/10 bg-white/5 p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <MessageCircle className="text-[#8fd3c7]" size={24} />
              <div>
                <h2 className="text-xl font-bold">ממתינים לתגובה</h2>
                <p className="text-xs text-white/45">
                  הזמן הגדול — מאז ההודעה של הלקוח שעדיין לא נענתה · הקטן —
                  סה״כ מאז פתיחת הפנייה
                </p>
              </div>
            </div>
            <strong className="rounded-full bg-white/10 px-4 py-1 text-2xl text-[#8fd3c7]">
              {waiting.length}
            </strong>
          </div>
          {waiting.length ? (
            // Every waiting customer, grouped by the agent responsible, so a
            // manager reads the whole picture off the wall — no cap: the point
            // of this screen is that nothing is hidden.
            <div className="space-y-4">
              {waitingByAgent.map((group) => {
                const worst = tierTone(waitingTier(group.tickets[0].waitedSeconds));
                return (
                  <section key={group.key} className="rounded-2xl bg-white/[0.04] p-3">
                    <div className="mb-2 flex items-center justify-between px-1">
                      <h3 className="text-base font-bold">{group.agentName}</h3>
                      <span className="flex items-center gap-3 text-sm">
                        <span className="text-white/45">הארוך ביותר</span>
                        <strong className={worst.text}>
                          {formatDuration(group.tickets[0].waitedSeconds)}
                        </strong>
                        <strong className="rounded-full bg-white/10 px-2.5 py-0.5 text-[#8fd3c7]">
                          {group.tickets.length}
                        </strong>
                      </span>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                      {group.tickets.map((ticket) => {
                        const tone = tierTone(waitingTier(ticket.waitedSeconds));
                        return (
                          <div
                            key={ticket.id}
                            className={`flex items-center justify-between rounded-xl px-3 py-2 ${tone.bg}`}
                          >
                            <div className="min-w-0">
                              <strong className="block truncate text-sm">
                                {ticket.customerName ?? formatPhone(ticket.customerPhone)}
                              </strong>
                              <span dir="ltr" className="block text-xs text-white/40">
                                #{ticket.id}
                              </span>
                            </div>
                            <div className="shrink-0 text-left">
                              <span className={`block text-lg font-bold leading-tight ${tone.text}`}>
                                {formatDuration(ticket.waitedSeconds)}
                              </span>
                              <span className="block font-mono text-[11px] text-white/40">
                                סה״כ {formatDuration(ticket.totalSeconds)}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          ) : (
            <p className="py-8 text-center text-lg text-white/40">
              כל הפניות היום קיבלו תגובה ראשונה
            </p>
          )}
        </article>

        {availability.length > 0 && (
          <article className="rounded-3xl border border-white/10 bg-white/5 p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Radio className="text-[#6ee0d0]" size={24} />
                <div>
                  <h2 className="text-xl font-bold">זמינות נציגות</h2>
                  <p className="text-xs text-white/45">
                    סטטוס וקיבולת Messaging מ-Zendesk · שיחות במקביל מתוך המקסימום
                  </p>
                </div>
              </div>
              <span className="text-sm text-white/60">
                <strong className="text-[#4fd39a]">
                  {availability.filter((a) => a.status === "online").length}
                </strong>{" "}
                מקוונות ·{" "}
                <strong className="text-white">
                  {availability.reduce((sum, a) => sum + freeMessagingSlots(a), 0)}
                </strong>{" "}
                מקומות פנויים
              </span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {availability.map((agent) => {
                const free = freeMessagingSlots(agent);
                const max = agent.messagingMaxCapacity ?? 0;
                const load = max > 0 ? Math.min(1, agent.messagingWorkItems / max) : 0;
                const tone = agent.status === "online"
                  ? { chip: "bg-[#1f9d72] text-white", bar: "bg-[#4fd39a]" }
                  : agent.status === "transfers_only"
                  ? { chip: "bg-[#3b6fd8] text-white", bar: "bg-[#7eb6ff]" }
                  : agent.status === "offline"
                  ? { chip: "bg-[#5a6870] text-white", bar: "bg-white/25" }
                  : { chip: "bg-[#c45d2a] text-white", bar: "bg-[#f0a15a]" };
                return (
                  <div
                    key={agent.agentId}
                    className={`rounded-2xl px-3 py-2.5 ${
                      agent.status === "offline" ? "bg-white/4 opacity-60" : "bg-white/8"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <strong className="truncate text-sm">{agent.agentName}</strong>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${tone.chip}`}>
                        {agentStatusLabel(agent.status)}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
                        <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${load * 100}%` }} />
                      </div>
                      <span dir="ltr" className="font-mono text-sm font-bold">
                        {agent.messagingWorkItems}/{max || "—"}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-white/45">
                      {agent.status === "online"
                        ? free > 0 ? `פנויה לעוד ${free}` : "מלאה"
                        : "לא מקבלת שיחות חדשות"}
                    </p>
                  </div>
                );
              })}
            </div>
          </article>
        )}

        {byDepartment.length > 0 && (
          <section
            className={`grid gap-3 ${byDepartment.length > 1 ? "md:grid-cols-2" : ""}`}
          >
            {byDepartment.map((dept) => (
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
      </div>
    </div>
  );
}

function WallMetric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone: "teal" | "green" | "red" | "orange" | "blue" | "amber";
}) {
  const tones = {
    teal: "from-[#134e48] to-[#0f3a36] border-[#1da99b]/35",
    green: "from-[#174a35] to-[#103528] border-[#4fd39a]/35",
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
      {hint && <p className="mt-1 text-xs text-white/50">{hint}</p>}
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
