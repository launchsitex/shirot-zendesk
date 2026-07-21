"use client";

import {
  ArrowDown,
  ArrowDownLeft,
  ArrowLeft,
  ArrowUp,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Download,
  Headphones,
  LoaderCircle,
  PhoneCall,
  PhoneMissed,
  PhoneOutgoing,
  Search,
  Timer,
  TrendingUp,
  UserCheck,
  Users,
  UserX,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useBusinessHoursConfig } from "@/hooks/use-business-hours";
import { splitCallsByBusinessHours } from "@/lib/business-hours";
import { formatIsraelDateTime } from "@/lib/israel-time";
import {
  calculateKpis,
  comparisonPeriods,
  earliestFetchFrom,
  filterCalls,
  formatDuration,
  formatSecondsLabel,
  groupCallsByHour,
  inboundWaitSeconds,
  kpiDelta,
  peakHoursForDisplay,
} from "@/lib/metrics";
import { formatPhoneDisplay, phoneSearchText } from "@/lib/phone";
import {
  createSupabaseBrowserClient,
  isSupabaseBrowserConfigured,
} from "@/lib/supabase/browser";
import type {
  AgentState,
  CallRecord,
  DashboardData,
  DashboardFilters,
  Kpis,
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

function useDashboardData(from?: string, to?: string) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const params =
      from && to
        ? `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
        : "";
    const loadData = () =>
      fetch(`/api/dashboard${params}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then((response) => {
          if (!response.ok) throw new Error("טעינת הנתונים נכשלה");
          return response.json();
        })
        .then((payload) => {
          setData(payload);
          setError("");
        })
        .catch((reason) => {
          if (reason.name !== "AbortError") setError(reason.message);
        });

    void loadData();
    const polling = window.setInterval(() => void loadData(), 15_000);
    const supabase = isSupabaseBrowserConfigured()
      ? createSupabaseBrowserClient()
      : null;
    const channel = supabase
      ?.channel(`section-pages-live-${from ?? "all"}-${to ?? "all"}`)
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
  }, [from, to]);

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
  const { config: businessHours } = useBusinessHoursConfig();
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("");
  const [direction, setDirection] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!data?.scopedDepartmentId) return;
    const timer = window.setTimeout(() => {
      setDepartment(data.scopedDepartmentId!);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [data?.scopedDepartmentId]);

  return (
    <PageState data={data} error={error}>
      {(dashboard) => {
        const calls = splitCallsByBusinessHours(dashboard.calls, businessHours)
          .business.filter((call) => {
          const needle = search.trim().toLowerCase();
          return (
            (!needle ||
              call.agentName?.toLowerCase().includes(needle) ||
              call.departmentName?.toLowerCase().includes(needle) ||
              phoneSearchText(call.customerNumber).includes(
                needle.replace(/\D/g, "") || needle,
              )) &&
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
              {!dashboard.scopedDepartmentId ? (
                <FilterSelect
                  value={department}
                  onChange={setDepartment}
                  label="כל המחלקות"
                  options={dashboard.departments.map((item) => ({
                    value: item.id,
                    label: item.name,
                  }))}
                />
              ) : (
                dashboard.departments[0] && (
                  <span className="rounded-xl bg-[#e4f5f2] px-3 py-2 text-xs font-bold text-[#11786e]">
                    {dashboard.departments[0].name}
                  </span>
                )
              )}
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
                <table className="w-full border-collapse text-right text-xs">
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
                        <th
                          key={heading}
                          className="w-0 whitespace-nowrap px-2.5 py-3 font-semibold"
                        >
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#edf1f3]">
                    {calls.map((call) => (
                      <tr key={call.id} className="hover:bg-[#f9fbfb]">
                        <td className="w-0 whitespace-nowrap px-2.5 py-2.5">
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
                        <td className="w-0 whitespace-nowrap px-2.5 py-2.5 font-bold">
                          {call.agentName ? (
                            call.agentName
                          ) : call.status === "in_progress" &&
                            call.direction === "inbound" ? (
                            <span className="font-bold text-[#c34850]">
                              לקוח ממתין
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="w-0 whitespace-nowrap px-2.5 py-2.5">
                          {call.departmentName ?? "ללא שיוך"}
                        </td>
                        <td
                          className="w-0 whitespace-nowrap px-2.5 py-2.5 font-mono"
                          dir="ltr"
                        >
                          {formatPhoneDisplay(call.customerNumber)}
                        </td>
                        <td className="w-0 whitespace-nowrap px-2.5 py-2.5">
                          <CallBadge call={call} />
                        </td>
                        <td className="w-0 whitespace-nowrap px-2.5 py-2.5">
                          {new Date(call.startedAt).toLocaleString("he-IL", {
                            dateStyle: "short",
                            timeStyle: "medium",
                            timeZone: "Asia/Jerusalem",
                          })}
                        </td>
                        <td className="w-0 whitespace-nowrap px-2.5 py-2.5 font-bold">
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
        const connected = dashboard.agents.filter(
          (agent) => agent.state !== "unavailable",
        ).length;
        // "בטיפול בשיחה" means actually on a call — ringing (not yet
        // answered) and wrap_up (post-call, no customer on the line) don't
        // belong here, same distinction already made on the wallboard.
        const busy = dashboard.agents.filter(
          (agent) => agent.state === "on_call",
        ).length;
        const unavailable = dashboard.agents.filter(
          (agent) => agent.state === "unavailable",
        ).length;
        const unassignedAgents = dashboard.agents.filter(
          (agent) => !agent.departmentId,
        );
        const departmentSections = [
          ...dashboard.departments.map((department) => ({
            id: department.id,
            name: department.name,
            agents: dashboard.agents.filter(
              (agent) => agent.departmentId === department.id,
            ),
          })),
          ...(unassignedAgents.length
            ? [
                {
                  id: "unassigned",
                  name: "ללא מחלקה",
                  agents: unassignedAgents,
                },
              ]
            : []),
        ].filter((section) => section.agents.length > 0);

        return (
          <>
            <PageHeader
              title="נציגים וצוותים"
              subtitle="מצב נציגים בחלוקה למחלקות בזמן אמת"
              icon={<Users size={22} />}
            />
            <section className="mb-5 grid gap-3 sm:grid-cols-3">
              <SummaryCard
                label="נציגים מחוברים"
                value={connected}
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
              {departmentSections.map((section) => {
                const connectedInTeam = section.agents.filter(
                  (agent) => agent.state !== "unavailable",
                ).length;
                return (
                  <section key={section.id} className="card overflow-hidden">
                    <div className="flex items-center justify-between border-b border-[#e5ebee] p-5">
                      <div>
                        <h2 className="font-bold">{section.name}</h2>
                        <p className="mt-1 text-xs text-[#7e8c93]">
                          {section.agents.length} נציגים בצוות
                        </p>
                      </div>
                      <span className="rounded-full bg-[#eef3f5] px-3 py-1 text-xs font-bold">
                        {connectedInTeam} מחוברים
                      </span>
                    </div>
                    <div className="grid gap-3 p-4 sm:grid-cols-2">
                      {section.agents.map((agent) => (
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
                                {section.name}
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
                                {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                  timeZone: "Asia/Jerusalem",
                                },
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
  const initialDates = presetDates("today");
  const [filters, setFilters] = useState<DashboardFilters>({
    preset: "today",
    ...initialDates,
    departmentId: "",
    agentId: "",
  });
  const fetchFrom = useMemo(() => earliestFetchFrom(filters), [filters]);
  const { data, error } = useDashboardData(fetchFrom, filters.to);
  const { config: businessHours } = useBusinessHoursConfig();

  useEffect(() => {
    if (!data?.scopedDepartmentId) return;
    const timer = window.setTimeout(() => {
      setFilters((current) =>
        current.departmentId === data.scopedDepartmentId
          ? current
          : { ...current, departmentId: data.scopedDepartmentId!, agentId: "" },
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, [data?.scopedDepartmentId]);

  const departmentCalls = useMemo(
    () =>
      splitCallsByBusinessHours(
        filterCalls(
          data?.calls ?? [],
          filters.from,
          filters.to,
          filters.departmentId,
          "",
        ),
        businessHours,
      ).business,
    [data, filters.from, filters.to, filters.departmentId, businessHours],
  );

  const filteredCalls = useMemo(
    () =>
      filters.agentId
        ? departmentCalls.filter((call) => call.agentId === filters.agentId)
        : departmentCalls,
    [departmentCalls, filters.agentId],
  );

  const selectableAgents = useMemo(
    () =>
      (data?.agents ?? []).filter(
        (agent) =>
          !filters.departmentId || agent.departmentId === filters.departmentId,
      ),
    [data, filters.departmentId],
  );

  function setPreset(preset: DashboardFilters["preset"]) {
    setFilters((current) => ({
      ...current,
      preset,
      ...(preset === "custom" ? {} : presetDates(preset)),
    }));
  }

  return (
    <PageState data={data} error={error}>
      {(dashboard) => {
        const kpis = calculateKpis(filteredCalls);
        const comparisons = comparisonPeriods(filters).map((period) => {
          const periodCalls = splitCallsByBusinessHours(
            filterCalls(
              dashboard.calls,
              period.from,
              period.to,
              filters.departmentId,
              filters.agentId,
            ),
            businessHours,
          ).business;
          return {
            ...period,
            kpis: calculateKpis(periodCalls),
          };
        });
        const daily = groupCallsByDay(filteredCalls);
        const maxDaily = Math.max(...daily.map((day) => day.total), 1);
        const hourly = peakHoursForDisplay(groupCallsByHour(filteredCalls));
        const maxHourly = Math.max(...hourly.map((hour) => hour.inbound), 1);
        const peakHour = hourly.reduce(
          (best, hour) => (hour.inbound > best.inbound ? hour : best),
          hourly[0] ?? {
            hour: 0,
            label: "",
            total: 0,
            inbound: 0,
            answered: 0,
            missed: 0,
            answerRate: 0,
          },
        );
        const weakestAnswerHour = hourly
          .filter((hour) => hour.inbound >= 2)
          .reduce(
            (worst, hour) =>
              hour.answerRate < worst.answerRate ? hour : worst,
            hourly.find((hour) => hour.inbound >= 2) ?? peakHour,
          );
        const agentStats = buildAgentStats(filteredCalls, departmentCalls).filter(
          (agent) => !filters.agentId || agent.agentId === filters.agentId,
        );

        function exportReport() {
          const departmentName = filters.departmentId
            ? (dashboard.departments.find(
                (department) => department.id === filters.departmentId,
              )?.name ?? filters.departmentId)
            : "כל המחלקות";
          const agentName = filters.agentId
            ? (selectableAgents.find((agent) => agent.id === filters.agentId)
                ?.name ?? filters.agentId)
            : "כל הנציגים";

          const departmentsForExport = filters.departmentId
            ? dashboard.departments.filter(
                (department) => department.id === filters.departmentId,
              )
            : dashboard.departments;

          const exportDepartments = departmentsForExport
            .map((department) => {
              const deptCalls = splitCallsByBusinessHours(
                filterCalls(
                  dashboard.calls,
                  filters.from,
                  filters.to,
                  department.id,
                  filters.agentId,
                ),
                businessHours,
              ).business;
              const deptTransferSource = splitCallsByBusinessHours(
                filterCalls(
                  dashboard.calls,
                  filters.from,
                  filters.to,
                  department.id,
                  "",
                ),
                businessHours,
              ).business;
              const deptHourly = peakHoursForDisplay(groupCallsByHour(deptCalls));
              const deptPeak = deptHourly.reduce(
                (best, hour) => (hour.inbound > best.inbound ? hour : best),
                deptHourly[0] ?? {
                  hour: 0,
                  label: "",
                  total: 0,
                  inbound: 0,
                  answered: 0,
                  missed: 0,
                  answerRate: 0,
                },
              );
              const deptWeak = deptHourly
                .filter((hour) => hour.inbound >= 2)
                .reduce(
                  (worst, hour) =>
                    hour.answerRate < worst.answerRate ? hour : worst,
                  deptHourly.find((hour) => hour.inbound >= 2) ?? deptPeak,
                );
              return {
                id: department.id,
                name: department.name,
                kpis: calculateKpis(deptCalls),
                agents: buildAgentStats(deptCalls, deptTransferSource),
                daily: groupCallsByDay(deptCalls),
                hourly: deptHourly,
                peakHourLabel: deptHourly.length
                  ? `${deptPeak.label} (${deptPeak.inbound} נכנסות)`
                  : undefined,
                weakHourLabel:
                  deptWeak.inbound >= 2
                    ? `${deptWeak.label} (${deptWeak.answerRate}%)`
                    : undefined,
              };
            })
            .filter(
              (department) =>
                department.kpis.total > 0 || department.agents.length > 0,
            );

          const unassignedCalls = filteredCalls.filter(
            (call) =>
              !call.departmentId ||
              !dashboard.departments.some(
                (department) => department.id === call.departmentId,
              ),
          );
          if (unassignedCalls.length && !filters.departmentId) {
            const unassignedHourly = peakHoursForDisplay(
              groupCallsByHour(unassignedCalls),
            );
            exportDepartments.push({
              id: "unassigned",
              name: "ללא שיוך",
              kpis: calculateKpis(unassignedCalls),
              agents: buildAgentStats(unassignedCalls),
              daily: groupCallsByDay(unassignedCalls),
              hourly: unassignedHourly,
              peakHourLabel: undefined,
              weakHourLabel: undefined,
            });
          }

          const exportCalls = filteredCalls
            .filter((call) => call.status !== "in_progress")
            .slice()
            .sort(
              (a, b) =>
                (a.departmentName ?? "").localeCompare(
                  b.departmentName ?? "",
                  "he",
                ) ||
                new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
            )
            .map((call) => {
              const wait = inboundWaitSeconds(call);
              return {
                startedAt: call.startedAt,
                startedAtIsrael: formatIsraelDateTime(call.startedAt),
                direction: call.direction === "inbound" ? "נכנסת" : "יוצאת",
                status:
                  call.status === "answered"
                    ? "נענתה"
                    : call.status === "missed"
                      ? "לא נענתה"
                      : "בשיחה",
                agentName: call.agentName ?? "—",
                departmentName: call.departmentName ?? "ללא שיוך",
                customerNumber: formatPhoneDisplay(call.customerNumber),
                durationLabel: formatDuration(call.durationSeconds),
                talkLabel: formatDuration(call.talkTimeSeconds),
                waitLabel:
                  wait == null ? "—" : formatSecondsLabel(wait),
                transferredBy: call.transferredByAgentName ?? "",
              };
            });

          void (async () => {
            const { downloadAnalyticsExcel } = await import("@/lib/excel-export");
            await downloadAnalyticsExcel({
              meta: {
                title: "דוח ביצועי מוקד",
                generatedAt: new Date(),
                rangeFrom: filters.from,
                rangeTo: filters.to,
                presetLabel: filters.preset,
                departmentName,
                agentName,
                callsCompleted: kpis.total,
              },
              kpis,
              comparisons,
              agents: agentStats,
              departments: exportDepartments,
              daily,
              hourly: peakHoursForDisplay(groupCallsByHour(filteredCalls)),
              calls: exportCalls,
              peakHourLabel: hourly.length
                ? `${peakHour.label} (${peakHour.inbound} נכנסות)`
                : undefined,
              weakHourLabel:
                weakestAnswerHour.inbound >= 2
                  ? `${weakestAnswerHour.label} (${weakestAnswerHour.answerRate}%)`
                  : undefined,
            });
          })();
        }

        return (
          <>
            <PageHeader
              title="דוחות וניתוח"
              subtitle="מגמות ביצועים ותפוקת המוקד"
              icon={<BarChart3 size={22} />}
            />
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
                      type="button"
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
                {!dashboard.scopedDepartmentId ? (
                  <FilterSelect
                    value={filters.departmentId}
                    onChange={(value) =>
                      setFilters((current) => ({
                        ...current,
                        departmentId: value,
                        agentId: "",
                      }))
                    }
                    label="כל המחלקות"
                    options={dashboard.departments.map((item) => ({
                      value: item.id,
                      label: item.name,
                    }))}
                  />
                ) : (
                  dashboard.departments[0] && (
                    <span className="rounded-xl bg-[#e4f5f2] px-3 py-2 text-xs font-bold text-[#11786e]">
                      {dashboard.departments[0].name}
                    </span>
                  )
                )}
                <FilterSelect
                  value={filters.agentId}
                  onChange={(value) =>
                    setFilters((current) => ({ ...current, agentId: value }))
                  }
                  label="כל הנציגים"
                  options={selectableAgents.map((agent) => ({
                    value: agent.id,
                    label: agent.name,
                  }))}
                />
                <button
                  type="button"
                  onClick={exportReport}
                  className="inline-flex items-center gap-2 rounded-xl border border-[#d5dee3] bg-white px-3 py-2 text-xs font-bold text-[#2b3a43] transition hover:bg-[#f7fafb]"
                >
                  <Download size={14} />
                  ייצוא Excel
                </button>
                <span className="mr-auto text-xs text-[#6f7d84]">
                  {kpis.total} שיחות שהסתיימו בטווח שנבחר
                </span>
              </div>
            </section>
            <section className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-8">
              <SummaryCard
                label="אחוז מענה"
                value={`${kpis.answerRate}%`}
                icon={<TrendingUp />}
                tone="green"
              />
              <SummaryCard
                label="נכנסות שנענו"
                value={kpis.answered}
                icon={<CheckCircle2 />}
                tone="blue"
              />
              <SummaryCard
                label="נכנסות שלא נענו"
                value={kpis.missed}
                icon={<PhoneMissed />}
                tone="red"
              />
              <SummaryCard
                label="שיחות יוצאות"
                value={kpis.outbound}
                icon={<PhoneOutgoing />}
                tone="blue"
              />
              <SummaryCard
                label='סה״כ שיחות'
                value={kpis.total}
                icon={<PhoneCall />}
                tone="gray"
              />
              <SummaryCard
                label="זמן שיחה ממוצע"
                value={formatDuration(kpis.averageTalkSeconds)}
                icon={<Clock3 />}
                tone="gray"
              />
              <SummaryCard
                label="זמן המתנה ממוצע"
                value={formatSecondsLabel(kpis.averageWaitSeconds)}
                icon={<Timer />}
                tone="green"
              />
            </section>
            <section className="card mb-5 p-5">
              <div className="mb-4">
                <h2 className="font-bold">השוואה לתקופה קודמת</h2>
                <p className="mt-1 text-xs text-[#7f8d94]">
                  אחוז מענה, לא נענו וזמן שיחה ממוצע
                </p>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                {comparisons.map((comparison) => (
                  <ComparisonCard
                    key={comparison.key}
                    label={comparison.label}
                    rangeLabel={
                      comparison.from === comparison.to
                        ? comparison.from
                        : `${comparison.from} עד ${comparison.to}`
                    }
                    current={kpis}
                    previous={comparison.kpis}
                  />
                ))}
              </div>
            </section>
            <section className="mb-5 grid gap-5 xl:grid-cols-[1.35fr_1fr]">
              <div className="card p-5">
                <div className="mb-6">
                  <h2 className="font-bold">נפח שיחות לפי יום</h2>
                  <p className="mt-1 text-xs text-[#7f8d94]">
                    נכנסות ויוצאות בטווח שנבחר
                  </p>
                </div>
                {daily.length ? (
                  <div className="flex h-64 items-end gap-2 border-b border-[#e5ebee] px-1">
                    {daily.map((day) => (
                      <div
                        key={day.date}
                        className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2"
                      >
                        <div className="flex h-[200px] w-full items-end justify-center gap-1">
                          <div className="flex h-full w-[42%] flex-col items-center justify-end gap-1">
                            <span className="text-[10px] font-bold text-[#158f83]">
                              {day.inbound}
                            </span>
                            <div
                              className="w-full rounded-t-md bg-[#158f83]"
                              style={{
                                height: `${Math.max((day.inbound / maxDaily) * 100, day.inbound ? 5 : 0)}%`,
                              }}
                              title={`${day.inbound} נכנסות`}
                            />
                          </div>
                          <div className="flex h-full w-[42%] flex-col items-center justify-end gap-1">
                            <span className="text-[10px] font-bold text-[#587bd3]">
                              {day.outbound}
                            </span>
                            <div
                              className="w-full rounded-t-md bg-[#587bd3]"
                              style={{
                                height: `${Math.max((day.outbound / maxDaily) * 100, day.outbound ? 5 : 0)}%`,
                              }}
                              title={`${day.outbound} יוצאות`}
                            />
                          </div>
                        </div>
                        <span className="truncate text-[10px] text-[#7f8d94]">
                          {day.label}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="py-16 text-center text-sm text-[#7d8a91]">
                    אין שיחות להצגה בטווח שנבחר
                  </p>
                )}
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
            <section className="card mb-5 p-5">
              <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="font-bold">שעות שיא</h2>
                  <p className="mt-1 text-xs text-[#7f8d94]">
                    נפח נכנסות ואחוז מענה לפי שעה (שעון ישראל)
                  </p>
                </div>
                {hourly.length > 0 && (
                  <div className="flex flex-wrap gap-3 text-xs text-[#66757d]">
                    <span>
                      עומס שיא:{" "}
                      <strong className="text-[#17242d]">
                        {peakHour.label} ({peakHour.inbound} נכנסות)
                      </strong>
                    </span>
                    {weakestAnswerHour.inbound >= 2 && (
                      <span>
                        מענה נמוך:{" "}
                        <strong className="text-[#c34850]">
                          {weakestAnswerHour.label} ({weakestAnswerHour.answerRate}
                          %)
                        </strong>
                      </span>
                    )}
                  </div>
                )}
              </div>
              {hourly.length ? (
                <>
                  <div className="mt-4 flex h-56 items-end gap-1.5 border-b border-[#e5ebee] px-1">
                    {hourly.map((hour) => (
                      <div
                        key={hour.hour}
                        className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
                        title={`${hour.label}: ${hour.inbound} נכנסות, מענה ${hour.answerRate}%`}
                      >
                        <span className="text-[10px] font-bold text-[#158f83]">
                          {hour.inbound || ""}
                        </span>
                        <div
                          className="w-full max-w-[28px] rounded-t-md bg-[#158f83]"
                          style={{
                            height: `${Math.max((hour.inbound / maxHourly) * 100, hour.inbound ? 6 : 0)}%`,
                            opacity: hour.answerRate >= 80 || !hour.inbound ? 1 : 0.55,
                          }}
                        />
                        <span
                          className={`text-[10px] font-bold ${
                            hour.inbound && hour.answerRate < 80
                              ? "text-[#c34850]"
                              : "text-[#7f8d94]"
                          }`}
                        >
                          {hour.inbound ? `${hour.answerRate}%` : "—"}
                        </span>
                        <span className="truncate text-[10px] text-[#7f8d94]">
                          {hour.hour.toString().padStart(2, "0")}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap justify-center gap-4 text-xs text-[#7f8d94]">
                    <span className="flex items-center gap-2">
                      <i className="h-2.5 w-2.5 rounded-sm bg-[#158f83]" />
                      נפח נכנסות
                    </span>
                    <span>אחוז מענה מתחת לעמודה · עמודה חלשה כשהמענה נמוך</span>
                  </div>
                </>
              ) : (
                <p className="py-12 text-center text-sm text-[#7d8a91]">
                  אין נתונים לפי שעה בטווח שנבחר
                </p>
              )}
            </section>
            <section className="card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e5ebee] p-5">
                <h2 className="font-bold">ביצועים לפי נציג</h2>
                <button
                  type="button"
                  onClick={exportReport}
                  className="inline-flex items-center gap-2 rounded-xl border border-[#d5dee3] bg-white px-3 py-2 text-xs font-bold text-[#2b3a43] transition hover:bg-[#f7fafb]"
                >
                  <Download size={14} />
                  ייצוא Excel מפורט
                </button>
              </div>
              <div className="overflow-auto">
                <table className="w-full border-collapse text-right text-xs">
                  <thead className="bg-[#f8fafb] text-[#738188]">
                    <tr>
                      {[
                        "נציג/ה",
                        "סה״כ שיחות",
                        "נענו",
                        "לא נענו",
                        "אחוז מענה",
                        "העברות שיחה",
                        "זמן שיחה",
                        "זמן שיחה ממוצע",
                      ].map((heading) => (
                        <th
                          key={heading}
                          className="w-0 whitespace-nowrap px-3 py-3 font-semibold"
                        >
                          {heading}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#edf1f3]">
                    {agentStats.map((agent) => (
                      <tr key={agent.agentId ?? agent.name}>
                        <td className="w-0 whitespace-nowrap px-3 py-3 font-bold">
                          {agent.name}
                        </td>
                        <td className="w-0 whitespace-nowrap px-3 py-3">
                          {agent.total}
                        </td>
                        <td className="w-0 whitespace-nowrap px-3 py-3 text-[#21835a]">
                          {agent.answered}
                        </td>
                        <td className="w-0 whitespace-nowrap px-3 py-3 text-[#c34850]">
                          {agent.missed}
                        </td>
                        <td className="w-0 whitespace-nowrap px-3 py-3 font-bold text-[#158f83]">
                          {agent.answerRate}%
                        </td>
                        <td className="w-0 whitespace-nowrap px-3 py-3 font-bold">
                          {agent.transfers}
                        </td>
                        <td className="w-0 whitespace-nowrap px-3 py-3 font-bold">
                          {formatDuration(agent.talkSeconds)}
                        </td>
                        <td className="w-0 whitespace-nowrap px-3 py-3 font-bold">
                          {formatDuration(agent.averageTalkSeconds)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!agentStats.length && (
                  <p className="p-16 text-center text-sm text-[#7d8a91]">
                    אין נתוני נציגים בטווח שנבחר
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

function formatSignedDelta(value: number): string {
  if (value > 0) return `+${value}`;
  return String(value);
}

function ComparisonCard({
  label,
  rangeLabel,
  current,
  previous,
}: {
  label: string;
  rangeLabel: string;
  current: Kpis;
  previous: Kpis;
}) {
  return (
    <article className="rounded-2xl border border-[#e5ebee] bg-[#fbfcfd] p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-[#17242d]">{label}</h3>
        <span className="text-[11px] text-[#7f8d94]">{rangeLabel}</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <DeltaMetric
          label="אחוז מענה"
          current={`${current.answerRate}%`}
          previous={`${previous.answerRate}%`}
          delta={kpiDelta(current.answerRate, previous.answerRate)}
          suffix="%"
          higherIsBetter
        />
        <DeltaMetric
          label="לא נענו"
          current={current.missed}
          previous={previous.missed}
          delta={kpiDelta(current.missed, previous.missed)}
          higherIsBetter={false}
        />
        <DeltaMetric
          label="ממוצע שיחה"
          current={formatDuration(current.averageTalkSeconds)}
          previous={formatDuration(previous.averageTalkSeconds)}
          delta={kpiDelta(current.averageTalkSeconds, previous.averageTalkSeconds)}
          suffix=" שנ׳"
          higherIsBetter={null}
        />
      </div>
    </article>
  );
}

function DeltaMetric({
  label,
  current,
  previous,
  delta,
  suffix = "",
  higherIsBetter,
}: {
  label: string;
  current: string | number;
  previous: string | number;
  delta: number;
  suffix?: string;
  higherIsBetter: boolean | null;
}) {
  const positive = delta > 0;
  const neutral = delta === 0 || higherIsBetter === null;
  const good =
    higherIsBetter === null ? null : higherIsBetter ? positive : !positive;
  const tone = neutral
    ? "text-[#66757d] bg-[#eef2f4]"
    : good
      ? "text-[#1f7a55] bg-[#e4f5ea]"
      : "text-[#c34850] bg-[#fdebed]";

  return (
    <div className="rounded-xl bg-white p-3 shadow-[0_1px_0_rgba(16,45,56,0.04)]">
      <p className="text-[11px] font-semibold text-[#7c8990]">{label}</p>
      <strong className="mt-1 block text-lg text-[#17242d]">{current}</strong>
      <p className="mt-1 text-[10px] text-[#8a969c]">קודם: {previous}</p>
      <span
        className={`mt-2 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold ${tone}`}
      >
        {!neutral &&
          (positive ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
        {formatSignedDelta(delta)}
        {suffix}
      </span>
    </div>
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

function CallBadge({ call }: { call: CallRecord }) {
  // An in_progress call isn't "בשיחה" until someone actually answers it —
  // otherwise this contradicts the "לקוח ממתין" label shown for the same row.
  const key: "answered" | "missed" | "waiting" | "ringing" | "on_call" =
    call.status !== "in_progress"
      ? call.status
      : !call.agentId
        ? "waiting"
        : call.talkTimeSeconds > 0
          ? "on_call"
          : "ringing";
  const labels = {
    answered: "נענתה",
    missed: "לא נענתה",
    waiting: "ממתין למענה",
    ringing: "מצלצל",
    on_call: "בשיחה",
  };
  const styles = {
    answered: "bg-[#e4f5ea] text-[#298653]",
    missed: "bg-[#fdebed] text-[#c8434c]",
    waiting: "bg-[#fff3d9] text-[#9a6811]",
    ringing: "bg-[#fff3d9] text-[#9a6811]",
    on_call: "bg-[#e7efff] text-[#396acb]",
  };
  return (
    <span className={`rounded-full px-2.5 py-1 font-bold ${styles[key]}`}>
      {labels[key]}
    </span>
  );
}

function groupCallsByDay(calls: CallRecord[]) {
  const grouped = new Map<
    string,
    {
      date: string;
      label: string;
      inbound: number;
      outbound: number;
      total: number;
      answered: number;
      missed: number;
    }
  >();
  calls.forEach((call) => {
    if (call.status === "in_progress") return;
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
      answered: 0,
      missed: 0,
    };
    current[call.direction] += 1;
    current.total += 1;
    if (call.direction === "inbound") {
      if (call.status === "answered") current.answered += 1;
      if (call.status === "missed") current.missed += 1;
    }
    grouped.set(date, current);
  });
  return [...grouped.values()]
    .map((day) => ({
      ...day,
      answerRate: day.inbound
        ? Math.round((day.answered / day.inbound) * 100)
        : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function buildAgentStats(
  calls: CallRecord[],
  transferSourceCalls: CallRecord[] = calls,
) {
  const grouped = new Map<
    string,
    {
      key: string;
      agentId: string | null;
      name: string;
      departmentName: string;
      total: number;
      answered: number;
      missed: number;
      outbound: number;
      transfers: number;
      talkSeconds: number;
      talkCount: number;
      asaTotal: number;
      asaCount: number;
      waitTotal: number;
      waitCount: number;
    }
  >();

  function ensureAgent(
    agentId: string | null,
    name: string,
    departmentName?: string | null,
  ) {
    const key = agentId ?? `name:${name}`;
    const current = grouped.get(key) ?? {
      key,
      agentId,
      name,
      departmentName: departmentName?.trim() || "ללא שיוך",
      total: 0,
      answered: 0,
      missed: 0,
      outbound: 0,
      transfers: 0,
      talkSeconds: 0,
      talkCount: 0,
      asaTotal: 0,
      asaCount: 0,
      waitTotal: 0,
      waitCount: 0,
    };
    if (
      departmentName?.trim() &&
      (current.departmentName === "ללא שיוך" || !current.departmentName)
    ) {
      current.departmentName = departmentName.trim();
    }
    grouped.set(key, current);
    return current;
  }

  calls.forEach((call) => {
    if (!call.agentName && !call.agentId) return;
    if (call.status === "in_progress") return;
    const current = ensureAgent(
      call.agentId,
      call.agentName ?? call.agentId ?? "נציג",
      call.departmentName,
    );
    current.total += 1;
    if (call.direction === "outbound") current.outbound += 1;
    // Answer rate is based on inbound handled calls only.
    if (call.direction === "inbound") {
      if (call.status === "answered") {
        current.answered += 1;
        const wait = inboundWaitSeconds(call);
        if (wait != null) {
          current.asaTotal += wait;
          current.asaCount += 1;
          current.waitTotal += wait;
          current.waitCount += 1;
        }
      }
      if (call.status === "missed") {
        current.missed += 1;
        const wait = inboundWaitSeconds(call);
        if (wait != null) {
          current.waitTotal += wait;
          current.waitCount += 1;
        }
      }
    }
    if (call.talkTimeSeconds > 0) {
      current.talkSeconds += call.talkTimeSeconds;
      current.talkCount += 1;
    }
  });

  transferSourceCalls.forEach((call) => {
    if (!call.transferredByAgentId && !call.transferredByAgentName) return;
    const current = ensureAgent(
      call.transferredByAgentId,
      call.transferredByAgentName ??
        call.transferredByAgentId ??
        "נציג",
      call.departmentName,
    );
    current.transfers += 1;
  });

  return [...grouped.values()]
    .map((agent) => {
      const completed = agent.answered + agent.missed;
      return {
        agentId: agent.agentId,
        name: agent.name,
        departmentName: agent.departmentName,
        total: agent.total,
        answered: agent.answered,
        missed: agent.missed,
        outbound: agent.outbound,
        transfers: agent.transfers,
        talkSeconds: agent.talkSeconds,
        averageTalkSeconds: agent.talkCount
          ? Math.round(agent.talkSeconds / agent.talkCount)
          : 0,
        averageAsaSeconds: agent.asaCount
          ? Math.round(agent.asaTotal / agent.asaCount)
          : 0,
        averageWaitSeconds: agent.waitCount
          ? Math.round(agent.waitTotal / agent.waitCount)
          : 0,
        answerRate: completed
          ? Math.round((agent.answered / completed) * 100)
          : 0,
      };
    })
    .filter((agent) => agent.total > 0 || agent.transfers > 0)
    .sort(
      (a, b) =>
        a.departmentName.localeCompare(b.departmentName, "he") ||
        b.total - a.total ||
        b.transfers - a.transfers,
    );
}

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
}

