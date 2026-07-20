"use client";

import {
  ArrowDownLeft,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Clock3,
  Headphones,
  LoaderCircle,
  PhoneCall,
  PhoneMissed,
  Search,
  TrendingUp,
  UserCheck,
  Users,
  UserX,
} from "lucide-react";
import { useEffect, useState } from "react";
import { calculateKpis, formatDuration } from "@/lib/metrics";
import {
  createSupabaseBrowserClient,
  isSupabaseBrowserConfigured,
} from "@/lib/supabase/browser";
import type { AgentState, CallRecord, DashboardData } from "@/lib/types";

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

function useDashboardData() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const loadData = () =>
      fetch("/api/dashboard", {
        cache: "no-store",
        signal: controller.signal,
      })
        .then((response) => {
          if (!response.ok) throw new Error("טעינת הנתונים נכשלה");
          return response.json();
        })
        .then(setData)
        .catch((reason) => {
          if (reason.name !== "AbortError") setError(reason.message);
        });

    void loadData();
    const polling = window.setInterval(() => void loadData(), 15_000);
    const supabase = isSupabaseBrowserConfigured()
      ? createSupabaseBrowserClient()
      : null;
    const channel = supabase
      ?.channel("section-pages-live")
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

    return () => {
      controller.abort();
      window.clearInterval(polling);
      if (supabase && channel) void supabase.removeChannel(channel);
    };
  }, []);

  return { data, error };
}

function PageState({
  data,
  error,
  children,
}: {
  data: DashboardData | null;
  error: string;
  children: (data: DashboardData) => React.ReactNode;
}) {
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
  return children(data);
}

export function CallsHistory() {
  const { data, error } = useDashboardData();
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("");
  const [direction, setDirection] = useState("");
  const [status, setStatus] = useState("");

  return (
    <PageState data={data} error={error}>
      {(dashboard) => {
        const calls = dashboard.calls.filter((call) => {
          const needle = search.trim().toLowerCase();
          return (
            (!needle ||
              call.agentName?.toLowerCase().includes(needle) ||
              call.customerNumber.includes(needle)) &&
            (!department || call.departmentId === department) &&
            (!direction || call.direction === direction) &&
            (!status || call.status === status)
          );
        });

        return (
          <>
            <PageHeader
              title="היסטוריית שיחות"
              subtitle="חיפוש, סינון וצפייה בכל שיחות המוקד"
              icon={<PhoneCall size={22} />}
            />
            <section className="card mb-4 flex flex-wrap items-center gap-2 p-4">
              <label className="flex h-11 min-w-64 flex-1 items-center gap-2 rounded-xl border border-[#dfe6ea] px-3">
                <Search size={17} className="text-[#849198]" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="חיפוש לפי נציג או מספר..."
                  className="w-full bg-transparent text-sm outline-none"
                />
              </label>
              <FilterSelect
                value={department}
                onChange={setDepartment}
                label="כל המחלקות"
                options={dashboard.departments.map((item) => ({
                  value: item.id,
                  label: item.name,
                }))}
              />
              <FilterSelect
                value={direction}
                onChange={setDirection}
                label="כל הכיוונים"
                options={[
                  { value: "inbound", label: "נכנסות" },
                  { value: "outbound", label: "יוצאות" },
                ]}
              />
              <FilterSelect
                value={status}
                onChange={setStatus}
                label="כל הסטטוסים"
                options={[
                  { value: "answered", label: "נענתה" },
                  { value: "missed", label: "לא נענתה" },
                  { value: "in_progress", label: "בשיחה" },
                ]}
              />
            </section>
            <section className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-[#e6ecef] p-4">
                <strong>כל השיחות</strong>
                <span className="text-xs text-[#7d8a91]">
                  {calls.length} תוצאות
                </span>
              </div>
              <div className="scrollbar-thin max-h-[650px] overflow-auto">
                <table className="w-full min-w-[850px] text-right text-xs">
                  <thead className="sticky top-0 bg-[#f8fafb] text-[#748188]">
                    <tr>
                      {[
                        "כיוון",
                        "נציג/ה",
                        "מחלקה",
                        "מספר לקוח",
                        "סטטוס",
                        "תאריך ושעה",
                        "משך שיחה",
                      ].map((heading) => (
                        <th key={heading} className="px-4 py-3 font-semibold">
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#edf1f3]">
                    {calls.map((call) => (
                      <tr key={call.id} className="hover:bg-[#f9fbfb]">
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
                        <td className="px-4 py-3">
                          {call.departmentName ?? "ללא שיוך"}
                        </td>
                        <td className="px-4 py-3 font-mono" dir="ltr">
                          {maskNumber(call.customerNumber)}
                        </td>
                        <td className="px-4 py-3">
                          <CallBadge status={call.status} />
                        </td>
                        <td className="px-4 py-3">
                          {new Date(call.startedAt).toLocaleString("he-IL", {
                            dateStyle: "short",
                            timeStyle: "medium",
                            timeZone: "Asia/Jerusalem",
                          })}
                        </td>
                        <td className="px-4 py-3 font-bold">
                          {formatDuration(call.talkTimeSeconds)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!calls.length && (
                  <p className="p-16 text-center text-sm text-[#7d8a91]">
                    לא נמצאו שיחות התואמות לסינון
                  </p>
                )}
              </div>
            </section>
          </>
        );
      }}
    </PageState>
  );
}

export function AgentsTeams() {
  const { data, error } = useDashboardData();
  return (
    <PageState data={data} error={error}>
      {(dashboard) => {
        const available = dashboard.agents.filter(
          (agent) => agent.state === "available",
        ).length;
        const busy = dashboard.agents.filter((agent) =>
          ["ringing", "on_call", "wrap_up"].includes(agent.state),
        ).length;
        const unavailable = dashboard.agents.length - available - busy;
        return (
          <>
            <PageHeader
              title="נציגים וצוותים"
              subtitle="מצב נציגים בחלוקה למחלקות בזמן אמת"
              icon={<Users size={22} />}
            />
            <section className="mb-5 grid gap-3 sm:grid-cols-3">
              <SummaryCard
                label="זמינים כעת"
                value={available}
                icon={<UserCheck />}
                tone="green"
              />
              <SummaryCard
                label="בטיפול בשיחה"
                value={busy}
                icon={<Headphones />}
                tone="blue"
              />
              <SummaryCard
                label="לא זמינים"
                value={unavailable}
                icon={<UserX />}
                tone="gray"
              />
            </section>
            <div className="grid gap-5 xl:grid-cols-2">
              {dashboard.departments.map((department) => {
                const agents = dashboard.agents.filter(
                  (agent) => agent.departmentId === department.id,
                );
                return (
                  <section key={department.id} className="card overflow-hidden">
                    <div className="flex items-center justify-between border-b border-[#e5ebee] p-5">
                      <div>
                        <h2 className="font-bold">{department.name}</h2>
                        <p className="mt-1 text-xs text-[#7e8c93]">
                          {agents.length} נציגים בצוות
                        </p>
                      </div>
                      <span className="rounded-full bg-[#eef3f5] px-3 py-1 text-xs font-bold">
                        {
                          agents.filter(
                            (agent) => agent.state !== "unavailable",
                          ).length
                        }{" "}
                        מחוברים
                      </span>
                    </div>
                    <div className="grid gap-3 p-4 sm:grid-cols-2">
                      {agents.map((agent) => (
                        <article
                          key={agent.id}
                          className="rounded-2xl border border-[#e5ebee] p-4"
                        >
                          <div className="flex items-center gap-3">
                            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#e8edef] text-sm font-bold">
                              {initials(agent.name)}
                            </span>
                            <div className="min-w-0 flex-1">
                              <strong className="block truncate text-sm">
                                {agent.name}
                              </strong>
                              <span className="text-[11px] text-[#829097]">
                                {department.name}
                              </span>
                            </div>
                          </div>
                          <div className="mt-4 flex items-center justify-between">
                            <span
                              className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${stateStyles[agent.state]}`}
                            >
                              {stateLabels[agent.state]}
                            </span>
                            <span className="text-[10px] text-[#8a969c]">
                              עודכן{" "}
                              {new Date(agent.stateSince).toLocaleTimeString(
                                "he-IL",
                                { hour: "2-digit", minute: "2-digit" },
                              )}
                            </span>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          </>
        );
      }}
    </PageState>
  );
}

export function AnalyticsReports() {
  const { data, error } = useDashboardData();
  return (
    <PageState data={data} error={error}>
      {(dashboard) => {
        const kpis = calculateKpis(dashboard.calls);
        const daily = groupCallsByDay(dashboard.calls);
        const maxDaily = Math.max(...daily.map((day) => day.total), 1);
        const agentStats = buildAgentStats(dashboard.calls);
        return (
          <>
            <PageHeader
              title="דוחות וניתוח"
              subtitle="מגמות ביצועים ותפוקת המוקד"
              icon={<BarChart3 size={22} />}
            />
            <section className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
              <SummaryCard
                label="אחוז מענה"
                value={`${kpis.answerRate}%`}
                icon={<TrendingUp />}
                tone="green"
              />
              <SummaryCard
                label="שיחות שנענו"
                value={kpis.answered}
                icon={<CheckCircle2 />}
                tone="blue"
              />
              <SummaryCard
                label="שיחות שלא נענו"
                value={kpis.missed}
                icon={<PhoneMissed />}
                tone="red"
              />
              <SummaryCard
                label="זמן שיחה ממוצע"
                value={formatDuration(kpis.averageTalkSeconds)}
                icon={<Clock3 />}
                tone="gray"
              />
            </section>
            <section className="mb-5 grid gap-5 xl:grid-cols-[1.35fr_1fr]">
              <div className="card p-5">
                <div className="mb-6">
                  <h2 className="font-bold">נפח שיחות לפי יום</h2>
                  <p className="mt-1 text-xs text-[#7f8d94]">
                    נכנסות ויוצאות בתקופה האחרונה
                  </p>
                </div>
                <div className="flex h-64 items-end gap-2 border-b border-[#e5ebee] px-1">
                  {daily.map((day) => (
                    <div
                      key={day.date}
                      className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2"
                    >
                      <span className="text-[10px] font-bold">{day.total}</span>
                      <div className="flex h-[190px] w-full items-end justify-center gap-1">
                        <div
                          className="w-[38%] rounded-t-md bg-[#158f83]"
                          style={{
                            height: `${Math.max((day.inbound / maxDaily) * 100, day.inbound ? 5 : 0)}%`,
                          }}
                          title={`${day.inbound} נכנסות`}
                        />
                        <div
                          className="w-[38%] rounded-t-md bg-[#587bd3]"
                          style={{
                            height: `${Math.max((day.outbound / maxDaily) * 100, day.outbound ? 5 : 0)}%`,
                          }}
                          title={`${day.outbound} יוצאות`}
                        />
                      </div>
                      <span className="truncate text-[10px] text-[#7f8d94]">
                        {day.label}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex justify-center gap-5 text-xs">
                  <span className="flex items-center gap-2">
                    <i className="h-2.5 w-2.5 rounded-sm bg-[#158f83]" />
                    נכנסות
                  </span>
                  <span className="flex items-center gap-2">
                    <i className="h-2.5 w-2.5 rounded-sm bg-[#587bd3]" />
                    יוצאות
                  </span>
                </div>
              </div>
              <div className="card p-5">
                <h2 className="font-bold">התפלגות שיחות</h2>
                <p className="mt-1 text-xs text-[#7f8d94]">לפי סטטוס מענה</p>
                <div className="relative mx-auto mt-7 h-44 w-44">
                  <div
                    className="h-full w-full rounded-full"
                    style={{
                      background: `conic-gradient(#158f83 0 ${kpis.answerRate}%, #df5b62 ${kpis.answerRate}% 100%)`,
                    }}
                  />
                  <div className="absolute inset-[17px] flex flex-col items-center justify-center rounded-full bg-white">
                    <strong className="text-3xl">{kpis.answerRate}%</strong>
                    <span className="text-xs text-[#7f8d94]">מענה</span>
                  </div>
                </div>
              </div>
            </section>
            <section className="card overflow-hidden">
              <div className="border-b border-[#e5ebee] p-5">
                <h2 className="font-bold">ביצועים לפי נציג</h2>
              </div>
              <div className="overflow-auto">
                <table className="w-full min-w-[650px] text-right text-xs">
                  <thead className="bg-[#f8fafb] text-[#738188]">
                    <tr>
                      {[
                        "נציג/ה",
                        "סה״כ שיחות",
                        "נענו",
                        "לא נענו",
                        "זמן שיחה",
                      ].map((heading) => (
                        <th key={heading} className="px-5 py-3 font-semibold">
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#edf1f3]">
                    {agentStats.map((agent) => (
                      <tr key={agent.name}>
                        <td className="px-5 py-3 font-bold">{agent.name}</td>
                        <td className="px-5 py-3">{agent.total}</td>
                        <td className="px-5 py-3 text-[#21835a]">
                          {agent.answered}
                        </td>
                        <td className="px-5 py-3 text-[#c34850]">
                          {agent.missed}
                        </td>
                        <td className="px-5 py-3 font-bold">
                          {formatDuration(agent.talkSeconds)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        );
      }}
    </PageState>
  );
}

function PageHeader({
  title,
  subtitle,
  icon,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex items-center gap-3">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#e4f5f2] text-[#158f83]">
        {icon}
      </span>
      <div>
        <h1 className="text-2xl font-bold md:text-[28px]">{title}</h1>
        <p className="mt-1 text-sm text-[#75838b]">{subtitle}</p>
      </div>
    </header>
  );
}

const summaryTones = {
  green: "bg-[#e4f5ea] text-[#28875a]",
  blue: "bg-[#e8effe] text-[#4772ce]",
  red: "bg-[#fdebed] text-[#d5545c]",
  gray: "bg-[#edf1f3] text-[#66767e]",
};

function SummaryCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  tone: keyof typeof summaryTones;
}) {
  return (
    <article className="card flex items-center gap-4 p-5">
      <span
        className={`flex h-12 w-12 items-center justify-center rounded-2xl ${summaryTones[tone]}`}
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

function FilterSelect({
  value,
  onChange,
  label,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-11 min-w-40 rounded-xl border border-[#dfe6ea] bg-white px-3 text-xs font-bold outline-none"
    >
      <option value="">{label}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function CallBadge({ status }: { status: CallRecord["status"] }) {
  const labels = {
    answered: "נענתה",
    missed: "לא נענתה",
    in_progress: "בשיחה",
  };
  const styles = {
    answered: "bg-[#e4f5ea] text-[#298653]",
    missed: "bg-[#fdebed] text-[#c8434c]",
    in_progress: "bg-[#e7efff] text-[#396acb]",
  };
  return (
    <span className={`rounded-full px-2.5 py-1 font-bold ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

function groupCallsByDay(calls: CallRecord[]) {
  const grouped = new Map<
    string,
    { date: string; label: string; inbound: number; outbound: number; total: number }
  >();
  calls.forEach((call) => {
    const date = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jerusalem",
    }).format(new Date(call.startedAt));
    const current = grouped.get(date) ?? {
      date,
      label: new Date(call.startedAt).toLocaleDateString("he-IL", {
        day: "2-digit",
        month: "2-digit",
        timeZone: "Asia/Jerusalem",
      }),
      inbound: 0,
      outbound: 0,
      total: 0,
    };
    current[call.direction] += 1;
    current.total += 1;
    grouped.set(date, current);
  });
  return [...grouped.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-10);
}

function buildAgentStats(calls: CallRecord[]) {
  const grouped = new Map<
    string,
    { name: string; total: number; answered: number; missed: number; talkSeconds: number }
  >();
  calls.forEach((call) => {
    if (!call.agentName) return;
    const current = grouped.get(call.agentName) ?? {
      name: call.agentName,
      total: 0,
      answered: 0,
      missed: 0,
      talkSeconds: 0,
    };
    current.total += 1;
    if (call.status === "answered") current.answered += 1;
    if (call.status === "missed") current.missed += 1;
    current.talkSeconds += call.talkTimeSeconds;
    grouped.set(call.agentName, current);
  });
  return [...grouped.values()].sort((a, b) => b.total - a.total);
}

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
}

function maskNumber(number: string) {
  return number || "מספר חסוי";
}
