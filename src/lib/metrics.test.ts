import { describe, expect, it } from "vitest";
import {
  calculateKpis,
  filterCalls,
  formatDuration,
  isCallInRange,
} from "@/lib/metrics";
import type { CallRecord } from "@/lib/types";

const calls: CallRecord[] = [
  {
    id: "1",
    direction: "inbound",
    status: "answered",
    agentId: "a1",
    agentName: "נועה",
    departmentId: "service",
    departmentName: "שירות",
    customerNumber: "050",
    startedAt: "2026-07-19T07:00:00.000Z",
    endedAt: "2026-07-19T07:02:00.000Z",
    durationSeconds: 120,
    talkTimeSeconds: 90,
  },
  {
    id: "2",
    direction: "inbound",
    status: "missed",
    agentId: null,
    agentName: null,
    departmentId: "service",
    departmentName: "שירות",
    customerNumber: "051",
    startedAt: "2026-07-19T08:00:00.000Z",
    endedAt: "2026-07-19T08:00:30.000Z",
    durationSeconds: 30,
    talkTimeSeconds: 0,
  },
  {
    id: "3",
    direction: "outbound",
    status: "answered",
    agentId: "a2",
    agentName: "דן",
    departmentId: "delivery",
    departmentName: "אספקות",
    customerNumber: "052",
    startedAt: "2026-07-18T22:30:00.000Z",
    endedAt: "2026-07-18T22:32:00.000Z",
    durationSeconds: 120,
    talkTimeSeconds: 60,
  },
];

describe("calculateKpis", () => {
  it("calculates inbound answer rate without counting outbound calls", () => {
    expect(calculateKpis(calls)).toEqual({
      total: 3,
      inbound: 2,
      outbound: 1,
      answered: 1,
      missed: 1,
      answerRate: 50,
      totalTalkSeconds: 150,
      averageTalkSeconds: 75,
    });
  });

  it("returns zero answer rate when there are no inbound calls", () => {
    expect(calculateKpis([calls[2]]).answerRate).toBe(0);
  });
});

describe("filters and formatting", () => {
  it("uses Jerusalem calendar dates around UTC midnight", () => {
    expect(isCallInRange(calls[2], "2026-07-19", "2026-07-19")).toBe(true);
  });

  it("filters department and agent together", () => {
    expect(
      filterCalls(calls, "2026-07-19", "2026-07-19", "service", "a1"),
    ).toHaveLength(1);
  });

  it("formats durations consistently", () => {
    expect(formatDuration(65)).toBe("01:05");
    expect(formatDuration(3661)).toBe("01:01:01");
  });
});
