"use client";

import {
  CheckCircle2,
  Clock3,
  Headphones,
  LoaderCircle,
  LogOut,
  Maximize2,
  Minimize2,
  PhoneCall,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getHomeHref, type AppProfile } from "@/lib/app-pages";
import { calculateKpis, formatDuration } from "@/lib/metrics";
import { formatPhoneDisplay } from "@/lib/phone";
import {
  createSupabaseBrowserClient,
  isSupabaseBrowserConfigured,
} from "@/lib/supabase/browser";
import type { Agent, AgentState, CallRecord, DashboardData } from "@/lib/types";

const stateLabels: Record<AgentState, string> = {
  available: "זמין",
  ringing: "מצלצל",
  on_call: "בשיחה",
  wrap_up: "סיכום",
  scheduled: "לפי לוח",
  out_for_lunch: "צהריים",
  on_break: "הפסקה",
  in_training: "הדרכה",
  back_office: "משרדי",
  other: "אחר",
  unavailable: "לא זמין",
};

const stateStyles: Record<AgentState, string> = {
  available: "bg-[#1f9d72] text-white",
  ringing: "bg-[#d4a017] text-white",
  on_call: "bg-[#3b6fd8] text-white",
  wrap_up: "bg-[#6b4fc2] text-white",
  scheduled: "bg-[#3b6fd8] text-white",
  out_for_lunch: "bg-[#c45d2a] text-white",
  on_break: "bg-[#c45d2a] text-white",
  in_training: "bg-[#c45d2a] text-white",
  back_office: "bg-[#c45d2a] text-white",
  other: "bg-[#c45d2a] text-white",
  unavailable: "bg-[#5a6870] text-white",
};

function todayJerusalem(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

function elapsed(iso: string) {
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / 1000),
  );
  return formatDuration(seconds);
}

export function WallboardClient() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => new Date());
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [profile, setProfile] = useState<AppProfile | null>(null);

  const loadData = useCallback(async () => {
    const day = todayJerusalem();
    try {
      const response = await fetch(`/api/dashboard?from=${day}&to=${day}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("לא ניתן לטעון את נתוני המוקד");
      setData(await response.json());
      setError("");
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "אירעה שגיאה",
      );
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
    const polling = window.setInterval(() => void loadData(), 10_000);
    const clock = window.setInterval(() => setNow(new Date()), 1_000);
    const supabase = isSupabaseBrowserConfigured()
      ? createSupabaseBrowserClient()
      : null;
    const channel = supabase
      ?.channel("wallboard-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "calls" },
        () => void loadData(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agent_live_status" },
        () => void loadData(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agents" },
        () => void loadData(),
      )
      .subscribe();

    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFsChange);

    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(polling);
      window.clearInterval(clock);
      document.removeEventListener("fullscreenchange", onFsChange);
      if (supabase && channel) void supabase.removeChannel(channel);
    };
  }, [loadData]);

  const homeHref = getHomeHref(profile);
  const wallboardOnly =
    Boolean(profile) &&
    profile!.allowedPages.length === 1 &&
    profile!.allowedPages[0] === "wallboard";

  async function signOut() {
    if (isSupabaseBrowserConfigured()) {
      await createSupabaseBrowserClient().auth.signOut();
    }
    window.location.href = "/login";
  }

  const kpis = useMemo(
    () => calculateKpis(data?.calls ?? []),
    [data?.calls],
  );

  const waitingCalls = useMemo(
    () =>
      (data?.calls ?? [])
        .filter(
          (call) =>
            call.direction === "inbound" &&
            call.status === "in_progress" &&
            !call.agentId,
        )
        .sort(
          (a, b) =>
            new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
        ),
    [data?.calls],
  );

  const liveCalls = useMemo(
    () =>
      (data?.calls ?? []).filter(
        (call) => call.status === "in_progress" && Boolean(call.agentId),
      ),
    [data?.calls],
  );

  const connected = useMemo(
    () =>
      (data?.agents ?? []).filter((agent) => agent.state !== "unavailable")
        .length,
    [data?.agents],
  );

  const busyAgents = useMemo(
    () =>
      (data?.agents ?? []).filter((agent) =>
        ["ringing", "on_call", "wrap_up"].includes(agent.state),
      ).length,
    [data?.agents],
  );

  const departmentSections = useMemo(() => {
    const departments = data?.departments ?? [];
    const agents = data?.agents ?? [];
    return departments
      .map((department) => ({
        id: department.id,
        name: department.name,
        agents: agents.filter((agent) => agent.departmentId === department.id),
      }))
      .filter((section) => section.agents.length > 0);
  }, [data]);

  async function toggleFullscreen() {
    if (!document.fullscreenElement) {
      await document.documentElement.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  }

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
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#1da99b]">
              <Headphones size={28} />
            </span>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-bold tracking-tight xl:text-4xl">
                  City Live
                </h1>
                <span className="flex items-center gap-2 rounded-full bg-[#1da99b]/20 px-3 py-1 text-sm font-bold text-[#6ee0d0]">
                  <i className="live-dot h-2.5 w-2.5 rounded-full bg-[#6ee0d0]" />
                  LIVE
                </span>
              </div>
              <p className="mt-1 text-sm text-white/55">
                מוקד רהיטי הסיטי · {todayJerusalem()}
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
            {!wallboardOnly && (
              <Link
                href={homeHref === "/wallboard" ? "/dashboard" : homeHref}
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

        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <WallMetric label='סה״כ היום' value={kpis.total} tone="teal" />
          <WallMetric label="נכנסות שנענו" value={kpis.answered} tone="green" />
          <WallMetric label="לא נענו" value={kpis.missed} tone="red" />
          <WallMetric label="יוצאות" value={kpis.outbound} tone="blue" />
          <WallMetric label="מחוברים" value={connected} tone="teal" />
          <WallMetric label="בשיחה כעת" value={busyAgents} tone="amber" />
        </section>

        <section className="grid flex-1 gap-5 xl:grid-cols-[1.1fr_1fr]">
          <div className="flex flex-col gap-5">
            <article className="rounded-3xl border border-[#e1a62b]/35 bg-[#2a2112] p-5">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <PhoneIncoming className="text-[#f0c15a]" size={26} />
                  <h2 className="text-xl font-bold">ממתינים על הקו</h2>
                </div>
                <strong className="rounded-full bg-[#f0c15a] px-4 py-1.5 text-2xl text-[#2a2112]">
                  {waitingCalls.length}
                </strong>
              </div>
              {waitingCalls.length ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {waitingCalls.slice(0, 8).map((call) => (
                    <WaitingCard key={call.id} call={call} />
                  ))}
                </div>
              ) : (
                <p className="py-8 text-center text-lg text-[#f0c15a]/70">
                  אין ממתינים כרגע
                </p>
              )}
            </article>

            <article className="rounded-3xl border border-white/10 bg-white/5 p-5">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <PhoneCall className="text-[#7eb6ff]" size={26} />
                  <h2 className="text-xl font-bold">שיחות פעילות</h2>
                </div>
                <strong className="text-2xl text-[#7eb6ff]">
                  {liveCalls.length}
                </strong>
              </div>
              {liveCalls.length ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {liveCalls.slice(0, 10).map((call) => (
                    <LiveCallCard key={call.id} call={call} />
                  ))}
                </div>
              ) : (
                <p className="py-8 text-center text-lg text-white/40">
                  אין שיחות פעילות
                </p>
              )}
            </article>
          </div>

          <article className="rounded-3xl border border-white/10 bg-white/5 p-5">
            <div className="mb-5 flex items-center gap-3">
              <Users className="text-[#6ee0d0]" size={26} />
              <h2 className="text-xl font-bold">סטטוס נציגים</h2>
            </div>
            <div className="space-y-5">
              {departmentSections.map((section) => (
                <div key={section.id}>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-lg font-bold">{section.name}</h3>
                    <span className="text-sm text-white/45">
                      {
                        section.agents.filter(
                          (agent) => agent.state !== "unavailable",
                        ).length
                      }{" "}
                      מחוברים · {section.agents.length} בצוות
                    </span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {section.agents.map((agent) => (
                      <AgentCard key={agent.id} agent={agent} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </article>
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-3 text-sm text-white/40">
          <span className="flex items-center gap-2">
            <Clock3 size={16} />
            זמן שיחה ממוצע היום: {formatDuration(kpis.averageTalkSeconds)}
          </span>
          <span className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <CheckCircle2 size={15} className="text-[#4fd39a]" />
              מענה {kpis.answerRate}%
            </span>
            <span className="flex items-center gap-1.5">
              <PhoneMissed size={15} className="text-[#f07178]" />
              לא נענו {kpis.missed}
            </span>
            <span className="flex items-center gap-1.5">
              <PhoneOutgoing size={15} className="text-[#7eb6ff]" />
              יוצאות {kpis.outbound}
            </span>
          </span>
        </footer>
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
  tone: "teal" | "green" | "red" | "blue" | "amber";
}) {
  const tones = {
    teal: "from-[#134e48] to-[#0f3a36] border-[#1da99b]/35",
    green: "from-[#174a35] to-[#103528] border-[#4fd39a]/35",
    red: "from-[#4a1d24] to-[#351418] border-[#f07178]/35",
    blue: "from-[#1a3358] to-[#13243f] border-[#7eb6ff]/35",
    amber: "from-[#4a3814] to-[#34270e] border-[#f0c15a]/35",
  };
  return (
    <article
      className={`rounded-3xl border bg-gradient-to-b p-5 ${tones[tone]}`}
    >
      <p className="text-sm font-semibold text-white/55">{label}</p>
      <strong className="mt-2 block text-4xl font-bold tracking-tight xl:text-5xl">
        {value}
      </strong>
    </article>
  );
}

function WaitingCard({ call }: { call: CallRecord }) {
  return (
    <div className="flex items-center justify-between rounded-2xl bg-[#3a2e14] px-4 py-3">
      <div>
        <strong className="block font-mono text-lg" dir="ltr">
          {formatPhoneDisplay(call.customerNumber)}
        </strong>
        <span className="text-sm text-[#f0c15a]/70">
          {call.departmentName ?? "ממתין לשיוך"}
        </span>
      </div>
      <span className="text-2xl font-bold text-[#f0c15a]">
        {elapsed(call.startedAt)}
      </span>
    </div>
  );
}

function LiveCallCard({ call }: { call: CallRecord }) {
  return (
    <div className="flex items-center justify-between rounded-2xl bg-white/8 px-4 py-3">
      <div className="min-w-0">
        <strong className="block truncate text-base">
          {call.agentName ?? "נציג"}
        </strong>
        <span className="font-mono text-sm text-white/45" dir="ltr">
          {formatPhoneDisplay(call.customerNumber)}
        </span>
      </div>
      <span className="text-xl font-bold text-[#7eb6ff]">
        {elapsed(call.startedAt)}
      </span>
    </div>
  );
}

function AgentCard({ agent }: { agent: Agent }) {
  return (
    <div className="flex items-center justify-between rounded-2xl bg-white/8 px-3 py-2.5">
      <div className="min-w-0">
        <strong className="block truncate text-sm">{agent.name}</strong>
        {agent.state === "on_call" && agent.currentCallStartedAt && (
          <span className="text-xs text-white/40">
            {elapsed(agent.currentCallStartedAt)}
          </span>
        )}
      </div>
      <span
        className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${stateStyles[agent.state]}`}
      >
        {stateLabels[agent.state]}
      </span>
    </div>
  );
}
