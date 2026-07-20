import type { Agent, CallRecord, DashboardData, Department } from "@/lib/types";

const departments: Department[] = [
  { id: "customer-service", name: "שירות לקוחות" },
  { id: "deliveries", name: "אספקות" },
];

const agentSeeds = [
  ["a1", "לירון מלכה", "customer-service"],
  ["a2", "רועי כהן", "customer-service"],
  ["a3", "שרון אזולאי", "customer-service"],
  ["a4", "מורן לוי", "customer-service"],
  ["a5", "נועה אברהם", "deliveries"],
  ["a6", "דניאל פרץ", "deliveries"],
  ["a7", "עדן שלום", "deliveries"],
  ["a8", "איתי מזרחי", "deliveries"],
] as const;

const states = [
  "available",
  "ringing",
  "on_call",
  "on_call",
  "wrap_up",
  "unavailable",
  "available",
  "unavailable",
] as const;

function minutesAgo(value: number): string {
  return new Date(Date.now() - value * 60_000).toISOString();
}

export function getMockDashboardData(): DashboardData {
  const agents: Agent[] = agentSeeds.map(
    ([id, name, departmentId], index) => ({
      id,
      name,
      departmentId,
      departmentName:
        departments.find((department) => department.id === departmentId)?.name ??
        "",
      state: states[index],
      stateSince: minutesAgo(2 + index * 3),
      currentCallStartedAt:
        states[index] === "on_call" ? minutesAgo(3 + index) : undefined,
    }),
  );
  const names = agents.map((agent) => agent.name);
  const calls: CallRecord[] = Array.from({ length: 34 }, (_, index) => {
    const agent = agents[index % agents.length];
    const direction = index % 4 === 0 ? "outbound" : "inbound";
    const status =
      index === 0 || index === 3
        ? "in_progress"
        : index % 7 === 0
          ? "missed"
          : "answered";
    const started = new Date();
    started.setMinutes(started.getMinutes() - index * 27 - 2);
    if (index > 18) started.setDate(started.getDate() - (index % 8));
    const duration = status === "missed" ? 34 + index : 110 + index * 17;

    return {
      id: `call-${index + 1}`,
      direction,
      status,
      agentId: status === "missed" ? null : agent.id,
      agentName: status === "missed" ? null : names[index % names.length],
      departmentId: agent.departmentId,
      departmentName: agent.departmentName,
      customerNumber: `+972 5${index % 9}-${String(370_5595 + index * 731).slice(0, 7)}`,
      startedAt: started.toISOString(),
      endedAt:
        status === "in_progress"
          ? null
          : new Date(started.getTime() + duration * 1000).toISOString(),
      durationSeconds: status === "in_progress" ? 0 : duration,
      talkTimeSeconds: status === "missed" ? 0 : Math.max(duration - 22, 0),
    };
  });

  return {
    calls,
    agents,
    departments,
    generatedAt: new Date().toISOString(),
    source: "demo",
  };
}
