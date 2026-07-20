import type { CallRecord, Kpis } from "@/lib/types";

export function calculateKpis(calls: CallRecord[]): Kpis {
  // Exclude live/in-progress calls so totals match answered + missed + outbound.
  const completed = calls.filter((call) => call.status !== "in_progress");
  const inbound = completed.filter((call) => call.direction === "inbound");
  const answered = inbound.filter((call) => call.status === "answered");
  const missed = inbound.filter((call) => call.status === "missed");
  const outbound = completed.filter((call) => call.direction === "outbound");
  const completedWithTalk = completed.filter(
    (call) => call.talkTimeSeconds > 0,
  );
  const totalTalkSeconds = completedWithTalk.reduce(
    (sum, call) => sum + call.talkTimeSeconds,
    0,
  );

  return {
    total: completed.length,
    inbound: inbound.length,
    outbound: outbound.length,
    answered: answered.length,
    missed: missed.length,
    answerRate: inbound.length
      ? Math.round((answered.length / inbound.length) * 100)
      : 0,
    totalTalkSeconds,
    averageTalkSeconds: completedWithTalk.length
      ? Math.round(totalTalkSeconds / completedWithTalk.length)
      : 0,
  };
}

export function isCallInRange(
  call: CallRecord,
  from: string,
  to: string,
  timeZone = "Asia/Jerusalem",
): boolean {
  const startedAt = new Date(call.startedAt);
  const dateInZone = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(startedAt);

  return dateInZone >= from && dateInZone <= to;
}

export function filterCalls(
  calls: CallRecord[],
  from: string,
  to: string,
  departmentId: string,
  agentId: string,
): CallRecord[] {
  return calls.filter(
    (call) =>
      isCallInRange(call, from, to) &&
      (!departmentId || call.departmentId === departmentId) &&
      (!agentId || call.agentId === agentId),
  );
}

export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainingSeconds = safe % 60;
  const parts = [minutes, remainingSeconds].map((value) =>
    value.toString().padStart(2, "0"),
  );

  return hours ? `${hours.toString().padStart(2, "0")}:${parts.join(":")}` : parts.join(":");
}
