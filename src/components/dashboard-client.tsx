"use client";

import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Clock3,
  Headphones,
  LoaderCircle,
  PhoneCall,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  RefreshCw,
  Search,
  Users,
  Wifi,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createSupabaseBrowserClient,
  isSupabaseBrowserConfigured,
} from "@/lib/supabase/browser";
import {
  calculateKpis,
  filterCalls,
  formatDuration,
} from "@/lib/metrics";
import { formatPhoneDisplay, phoneSearchText } from "@/lib/phone";
import type {
  Agent,
  AgentState,
  DashboardData,
  DashboardFilters,
} from "@/lib/types";

const stateLabels: Record<AgentState, string> = {
  available: "זמין",
  ringing: "מצלצל",
  on_call: "בשיחה",
  wrap_up: "סיכום שיחה",
  scheduled: "לפי לוח זמנים",
  out_for_lunch: "יצא לארוחת צהריים",
  on_break: "בהפסקה",
  in_training: "בהדרכה",
  back_office: "עבודה משרדית",
  other: "אחר",
  unavailable: "לא זמין",
};

const stateStyles: Record<AgentState, string> = {
  available: "bg-[#dff5ec] text-[#19845f]",
  ringing: "bg-[#fff1ce] text-[#9a6811]",
  on_call: "bg-[#e7efff] text-[#3768ca]",
  wrap_up: "bg-[#efe9ff] text-[#7753bf]",
  scheduled: "bg-[#e7efff] text-[#3768ca]",
  out_for_lunch: "bg-[#fff0e8] text-[#b55327]",
  on_break: "bg-[#fff0e8] text-[#b55327]",
  in_training: "bg-[#fff0e8] text-[#b55327]",
  back_office: "bg-[#fff0e8] text-[#b55327]",
  other: "bg-[#fff0e8] text-[#b55327]",
  unavailable: "bg-[#f2f4f5] text-[#7b878d]",
};

function toInputDate(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

function presetDates(preset: DashboardFilters["preset"]) {
  const today = new Date();
  const to = toInputDate(today);
  if (preset === "today") return { from: to, to };
  const from = new Date(today);
  if (preset === "week") {
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

function elapsed(iso: string) {
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / 1000),
  );
  return formatDuration(seconds);
}

export function DashboardClient() {
  const initialDates = presetDates("today");
  const [data, setData] = useState<DashboardData | null>(null);
  const [filters, setFilters] = useState<DashboardFilters>({
    preset: "today",
    ...initialDates,
    departmentId: "",
    agentId: "",
  });
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [, setTick] = useState(0);
  const latestRequest = useRef(0);

  const loadData = useCallback(async (quiet = false) => {
    const requestId = ++latestRequest.current;
    if (!quiet) setRefreshing(true);
    try {
      const response = await fetch(
        `/api/dashboard?from=${filters.from}&to=${filters.to}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("לא ניתן לטעון את נתוני המוקד");
      if (requestId !== latestRequest.current) return;
      setData(await response.json());
      setError("");
    } catch (loadError) {
      if (requestId !== latestRequest.current) return;
      setError(loadError instanceof Error ? loadError.message : "אירעה שגיאה");
    } finally {
      if (requestId !== latestRequest.current) return;
      setLoading(false);
      setRefreshing(false);
    }
  }, [filters.from, filters.to]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadData(), 0);
    const polling = window.setInterval(() => loadData(true), 15_000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(polling);
    };
  }, [loadData]);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((tick) => tick + 1), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isSupabaseBrowserConfigured()) return;
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel("dashboard-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "calls" },
        () => loadData(true),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agent_live_status" },
        () => loadData(true),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agents" },
        () => loadData(true),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadData]);

  const visibleCalls = useMemo(() => {
    const calls = filterCalls(
      data?.calls ?? [],
      filters.from,
      filters.to,
      filters.departmentId,
      filters.agentId,
    );
    if (!search.trim()) return calls;
    const needle = search.trim().toLowerCase();
    return calls.filter(
      (call) =>
        call.agentName?.toLowerCase().includes(needle) ||
        phoneSearchText(call.customerNumber).includes(
          needle.replace(/\D/g, "") || needle,
        ) ||
        call.departmentName?.includes(needle),
    );
  }, [data, filters, search]);

  const visibleAgents = data?.agents ?? [];
  const selectableAgents = useMemo(
    () =>
      (data?.agents ?? []).filter(
        (agent) =>
          !filters.departmentId ||
          agent.departmentId === filters.departmentId,
      ),
    [data, filters.departmentId],
  );
  const waitingCalls = useMemo(
    () =>
      (data?.calls ?? []).filter(
        (call) =>
          call.direction === "inbound" &&
          call.status === "in_progress" &&
          !call.agentId &&
          (!filters.departmentId ||
            call.departmentId === filters.departmentId),
      ),
    [data, filters.departmentId],
  );
  const kpis = calculateKpis(visibleCalls);

  function setPreset(preset: DashboardFilters["preset"]) {
    setFilters((current) => ({
      ...current,
      preset,
      ...(preset === "custom"
        ? {}
        : presetDates(preset)),
    }));
  }

  if (loading) {
    return (
      <div className="flex min-h-[70vh] items-center justify-center">
        <LoaderCircle className="animate-spin text-[#158f83]" size={36} />
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight md:text-[28px]">
              ניטור בזמן אמת
            </h1>
            <span className="flex items-center gap-2 rounded-full bg-[#e1f5f0] px-3 py-1 text-xs font-bold text-[#187c70]">
              <i className="live-dot h-2 w-2 rounded-full bg-[#1d9e8f]" />
              LIVE
            </span>
          </div>
          <p className="mt-1 text-sm text-[#75838b]">
            תמונת מצב עדכנית של מוקד השירות והאספקות
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data?.source === "demo" && (
            <span className="rounded-lg bg-[#fff2cc] px-3 py-2 text-xs font-bold text-[#8a6515]">
              מצב הדגמה
            </span>
          )}
          <button
            onClick={() => loadData()}
            className="flex h-10 items-center gap-2 rounded-xl border border-[#dbe3e7] bg-white px-4 text-sm font-semibold hover:bg-[#f8fafb]"
          >
            <RefreshCw
              size={16}
              className={refreshing ? "animate-spin" : ""}
            />
            רענון
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <CircleAlert size={18} />
          {error}
        </div>
      )}

      <section className="card mb-4 p-3 md:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl bg-[#f1f4f6] p-1">
            {(
              [
                ["today", "היום"],
                ["week", "השבוע"],
                ["month", "החודש"],
                ["custom", "טווח מותאם"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setPreset(value)}
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
          {filters.preset === "custom" && (
            <div className="flex items-center gap-2 rounded-xl border border-[#dfe6ea] px-3">
              <CalendarDays size={16} className="text-[#78868e]" />
              <input
                type="date"
                value={filters.from}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    from: event.target.value,
                  }))
                }
                className="h-10 bg-transparent text-xs outline-none"
              />
              <ArrowLeft size={14} />
              <input
                type="date"
                value={filters.to}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    to: event.target.value,
                  }))
                }
                className="h-10 bg-transparent text-xs outline-none"
              />
            </div>
          )}
          <SelectFilter
            label="כל המחלקות"
            value={filters.departmentId}
            onChange={(value) =>
              setFilters((current) => ({
                ...current,
                departmentId: value,
                agentId: "",
              }))
            }
            options={(data?.departments ?? []).map((department) => ({
              value: department.id,
              label: department.name,
            }))}
          />
          <SelectFilter
            label="כל הנציגים"
            value={filters.agentId}
            onChange={(value) =>
              setFilters((current) => ({ ...current, agentId: value }))
            }
            options={selectableAgents.map((agent) => ({
              value: agent.id,
              label: agent.name,
            }))}
          />
          <div className="mr-auto flex items-center gap-2 text-xs text-[#6f7d84]">
            <Wifi size={14} className="text-[#159083]" />
            עודכן{" "}
            {data?.generatedAt
              ? new Date(data.generatedAt).toLocaleTimeString("he-IL", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })
              : "כעת"}
          </div>
        </div>
      </section>

      <section className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-6">
        <MetricCard
          label="סה״כ שיחות"
          value={kpis.total}
          icon={PhoneCall}
          tone="teal"
        />
        <MetricCard
          label="שיחות נכנסות"
          value={kpis.inbound}
          icon={PhoneIncoming}
          tone="blue"
        />
        <MetricCard
          label="שיחות יוצאות"
          value={kpis.outbound}
          icon={PhoneOutgoing}
          tone="purple"
        />
        <MetricCard
          label="שיחות שנענו"
          value={kpis.answered}
          icon={CheckCircle2}
          tone="green"
        />
        <MetricCard
          label="לא נענו"
          value={kpis.missed}
          icon={PhoneMissed}
          tone="red"
        />
        <MetricCard
          label="זמן שיחה ממוצע"
          value={formatDuration(kpis.averageTalkSeconds)}
          icon={Clock3}
          tone="amber"
        />
      </section>

      <section className="card mb-4 overflow-hidden border-r-4 border-r-[#e1a62b]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#edf1f3] p-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#fff3d9] text-[#b47a16]">
              <PhoneIncoming size={20} />
            </span>
            <div>
              <h2 className="font-bold">לקוחות ממתינים על הקו</h2>
              <p className="mt-1 text-xs text-[#819097]">
                שיחות Aircall נכנסות שטרם נענו
              </p>
            </div>
          </div>
          <strong className="rounded-full bg-[#fff3d9] px-4 py-2 text-xl text-[#9a6812]">
            {waitingCalls.length}
          </strong>
        </div>
        {waitingCalls.length > 0 && (
          <div className="grid gap-2 p-3 md:grid-cols-2 xl:grid-cols-3">
            {waitingCalls.map((call) => (
              <div
                key={call.id}
                className="flex items-center justify-between rounded-xl bg-[#fffaf0] px-4 py-3"
              >
                <div>
                  <strong className="block font-mono text-sm" dir="ltr">
                    {formatPhoneDisplay(call.customerNumber)}
                  </strong>
                  <span className="text-xs text-[#7c898f]">
                    {call.departmentName ?? "ממתין לשיוך"}
                  </span>
                </div>
                <span className="font-bold text-[#b47a16]">
                  {elapsed(call.startedAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_290px]">
        <div id="calls" className="card min-w-0 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e6ecef] p-4">
            <div>
              <h2 className="font-bold">שיחות אחרונות</h2>
              <p className="mt-1 text-xs text-[#829097]">
                {visibleCalls.length} שיחות בטווח שנבחר
              </p>
            </div>
            <label className="flex h-10 items-center gap-2 rounded-xl border border-[#dfe6ea] px-3">
              <Search size={16} className="text-[#8a979e]" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="חיפוש נציג או מספר..."
                className="w-44 bg-transparent text-xs outline-none"
              />
            </label>
          </div>
          <div className="scrollbar-thin max-h-[510px] overflow-auto">
            <table className="w-full min-w-[780px] border-collapse text-right">
              <thead className="sticky top-0 z-10 bg-[#f8fafb] text-[11px] text-[#75838a]">
                <tr>
                  <th className="px-4 py-3 font-semibold">כיוון</th>
                  <th className="px-4 py-3 font-semibold">נציג/ה</th>
                  <th className="px-4 py-3 font-semibold">מחלקה</th>
                  <th className="px-4 py-3 font-semibold">מספר לקוח</th>
                  <th className="px-4 py-3 font-semibold">סטטוס</th>
                  <th className="px-4 py-3 font-semibold">התחלה</th>
                  <th className="px-4 py-3 font-semibold">משך שיחה</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#edf1f3]">
                {visibleCalls.map((call) => (
                  <tr
                    key={call.id}
                    className="text-xs transition hover:bg-[#f9fbfb]"
                  >
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex h-8 w-8 items-center justify-center rounded-full ${
                          call.direction === "inbound"
                            ? "bg-[#e5f4f1] text-[#178d80]"
                            : "bg-[#eaf0fe] text-[#4670ca]"
                        }`}
                      >
                        {call.direction === "inbound" ? (
                          <ArrowDownLeft size={16} />
                        ) : (
                          <ArrowUpRight size={16} />
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-bold">
                      {call.agentName ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-[#69777e]">
                      {call.departmentName ?? "ללא שיוך"}
                    </td>
                    <td className="px-4 py-3 font-mono text-[#526169]" dir="ltr">
                      {formatPhoneDisplay(call.customerNumber)}
                    </td>
                    <td className="px-4 py-3">
                      <CallStatus status={call.status} />
                    </td>
                    <td className="px-4 py-3 text-[#526169]">
                      {new Date(call.startedAt).toLocaleTimeString("he-IL", {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                        timeZone: "Asia/Jerusalem",
                      })}
                    </td>
                    <td className="px-4 py-3 font-semibold">
                      {call.status === "in_progress"
                        ? elapsed(call.startedAt)
                        : formatDuration(call.talkTimeSeconds)}
                    </td>
                  </tr>
                ))}
                {!visibleCalls.length && (
                  <tr>
                    <td colSpan={7} className="px-4 py-16 text-center text-sm text-[#78868d]">
                      לא נמצאו שיחות התואמות לסינון
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <aside id="agents" className="space-y-4">
          <div className="card p-5">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="font-bold">אחוז מענה</h2>
                <p className="mt-1 text-xs text-[#819097]">מתוך שיחות נכנסות</p>
              </div>
              <Headphones size={20} className="text-[#158f83]" />
            </div>
            <div className="relative mx-auto h-36 w-36">
              <div
                className="h-full w-full rounded-full"
                style={{
                  background: `conic-gradient(#158f83 ${kpis.answerRate * 3.6}deg, #e9eef0 0deg)`,
                }}
              />
              <div className="absolute inset-[13px] flex flex-col items-center justify-center rounded-full bg-white">
                <strong className="text-3xl">{kpis.answerRate}%</strong>
                <span className="text-[11px] text-[#839097]">אחוז מענה</span>
              </div>
            </div>
          </div>
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#e6ecef] p-4">
              <div>
                <h2 className="font-bold">סטטוס נציגים</h2>
                <p className="mt-1 text-xs text-[#819097]">
                  {visibleAgents.length} נציגים
                </p>
              </div>
              <Users size={19} className="text-[#61717a]" />
            </div>
            <div className="scrollbar-thin max-h-[375px] overflow-y-auto p-2">
              {visibleAgents.map((agent) => (
                <AgentRow key={agent.id} agent={agent} />
              ))}
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}

function SelectFilter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="relative flex h-10 items-center rounded-xl border border-[#dfe6ea] bg-white">
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-full min-w-36 appearance-none bg-transparent pr-3 pl-9 text-xs font-bold outline-none"
      >
        <option value="">{label}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={14}
        className="pointer-events-none absolute left-3 text-[#7e8c93]"
      />
    </label>
  );
}

const tones = {
  teal: "bg-[#e4f5f2] text-[#158f83]",
  blue: "bg-[#e8effe] text-[#4475dc]",
  purple: "bg-[#f0ebff] text-[#7954c5]",
  green: "bg-[#e4f5ea] text-[#30925b]",
  red: "bg-[#fdebed] text-[#d9545c]",
  amber: "bg-[#fff3d9] text-[#b47a16]",
};

function MetricCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string | number;
  icon: typeof PhoneCall;
  tone: keyof typeof tones;
}) {
  return (
    <article className="card flex min-h-[112px] items-center gap-3 p-4">
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tones[tone]}`}
      >
        <Icon size={20} />
      </span>
      <div>
        <p className="text-[11px] font-semibold text-[#7d8b92]">{label}</p>
        <strong className="mt-1 block text-2xl tracking-tight">{value}</strong>
      </div>
    </article>
  );
}

function CallStatus({ status }: { status: "answered" | "missed" | "in_progress" }) {
  const styles = {
    answered: "bg-[#e4f5ea] text-[#298653]",
    missed: "bg-[#fdebed] text-[#c8434c]",
    in_progress: "bg-[#e7efff] text-[#396acb]",
  };
  const labels = {
    answered: "נענתה",
    missed: "לא נענתה",
    in_progress: "בשיחה",
  };
  return (
    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

function AgentRow({ agent }: { agent: Agent }) {
  const inCall = agent.state === "on_call" && agent.currentCallStartedAt;
  return (
    <div className="flex items-center gap-3 rounded-xl p-2.5 hover:bg-[#f7f9fa]">
      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#e8edef] text-xs font-bold text-[#4f6069]">
        {agent.name
          .split(" ")
          .slice(0, 2)
          .map((word) => word[0])
          .join("")}
        <i
          className={`absolute bottom-0 left-0 h-2.5 w-2.5 rounded-full border-2 border-white ${
            agent.state === "available"
              ? "bg-[#28a677]"
              : agent.state === "unavailable"
                ? "bg-[#a9b1b5]"
                : "bg-[#4d75d7]"
          }`}
        />
      </span>
      <div className="min-w-0 flex-1">
        <strong className="block truncate text-xs">{agent.name}</strong>
        <span className="text-[10px] text-[#88949a]">{agent.departmentName}</span>
      </div>
      <div className="text-left">
        <span
          className={`block rounded-full px-2 py-1 text-[10px] font-bold ${stateStyles[agent.state]}`}
        >
          {stateLabels[agent.state]}
        </span>
        {inCall && (
          <span className="mt-1 block text-[10px] font-semibold text-[#5671a9]">
            {elapsed(agent.currentCallStartedAt!)}
          </span>
        )}
      </div>
    </div>
  );
}

