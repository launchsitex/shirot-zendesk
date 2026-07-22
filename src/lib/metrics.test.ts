import { describe, expect, it } from "vitest";
import {
  calculateKpis,
  comparisonPeriods,
  earliestFetchFrom,
  filterCalls,
  formatDuration,
  groupCallsByHour,
  inboundWaitSeconds,
  isCallInRange,
  isShortNoAnswer,
  previousEqualPeriod,
  shiftCalendarDate,
} from "@/lib/metrics";
import type { CallRecord } from "@/lib/types";

const calls: CallRecord[] = [
  {
    id: "1",
    direction: "inbound",
    status: "answered",
    agentId: "a1",
    agentName: "נועה",
    transferredByAgentId: null,
    transferredByAgentName: null,
    departmentId: "service",
    departmentName: "שירות",
    customerNumber: "050",
    startedAt: "2026-07-19T07:00:00.000Z",
    endedAt: "2026-07-19T07:02:00.000Z",
    durationSeconds: 120,
    talkTimeSeconds: 90,
    waitTimeSeconds: 18,
  },
  {
    id: "2",
    direction: "inbound",
    status: "missed",
    agentId: null,
    agentName: null,
    transferredByAgentId: null,
    transferredByAgentName: null,
    departmentId: "service",
    departmentName: "שירות",
    customerNumber: "051",
    startedAt: "2026-07-19T08:00:00.000Z",
    endedAt: "2026-07-19T08:00:30.000Z",
    durationSeconds: 30,
    talkTimeSeconds: 0,
    waitTimeSeconds: 0,
  },
  {
    id: "3",
    direction: "outbound",
    status: "answered",
    agentId: "a2",
    agentName: "דן",
    transferredByAgentId: "a1",
    transferredByAgentName: "נועה",
    departmentId: "delivery",
    departmentName: "אספקות",
    customerNumber: "052",
    startedAt: "2026-07-18T22:30:00.000Z",
    endedAt: "2026-07-18T22:32:00.000Z",
    durationSeconds: 120,
    talkTimeSeconds: 60,
    waitTimeSeconds: 0,
  },
];

describe("calculateKpis", () => {
  it("calculates inbound answer rate without counting outbound calls", () => {
    expect(calculateKpis(calls, 0)).toEqual({
      total: 3,
      inbound: 2,
      outbound: 1,
      answered: 1,
      missed: 1,
      missedShort: 0,
      answerRate: 50,
      totalTalkSeconds: 150,
      averageTalkSeconds: 75,
      averageAsaSeconds: 18,
      averageWaitSeconds: 24,
    });
  });

  it("excludes in-progress calls from totals so cards add up", () => {
    const withLive: CallRecord[] = [
      ...calls,
      {
        id: "4",
        direction: "inbound",
        status: "in_progress",
        agentId: "a1",
        agentName: "נועה",
        transferredByAgentId: null,
        transferredByAgentName: null,
        departmentId: "service",
        departmentName: "שירות",
        customerNumber: "053",
        startedAt: "2026-07-19T09:00:00.000Z",
        endedAt: null,
        durationSeconds: 30,
        talkTimeSeconds: 0,
        waitTimeSeconds: 12,
      },
    ];
    const kpis = calculateKpis(withLive, 0);
    expect(kpis.total).toBe(3);
    expect(kpis.answered + kpis.missed + kpis.missedShort + kpis.outbound).toBe(
      kpis.total,
    );
  });

  it("returns zero answer rate when there are no inbound calls", () => {
    expect(calculateKpis([calls[2]], 0).answerRate).toBe(0);
  });

  it("reclassifies short-wait missed calls as missedShort and excludes them from answerRate", () => {
    // calls[1] is missed with a 30s wait (see inboundWaitSeconds test below).
    const kpis = calculateKpis(calls, 60);
    expect(kpis.missed).toBe(0);
    expect(kpis.missedShort).toBe(1);
    // answered(1) / (answered(1) + missed(0)) = 100%, missedShort excluded entirely.
    expect(kpis.answerRate).toBe(100);
  });
});

describe("wait metrics", () => {
  it("uses duration as wait for missed calls without wait_time", () => {
    expect(inboundWaitSeconds(calls[1])).toBe(30);
  });

  it("classifies a missed call as short no-answer only under the threshold", () => {
    expect(isShortNoAnswer(calls[1], 60)).toBe(true);
    expect(isShortNoAnswer(calls[1], 10)).toBe(false);
    expect(isShortNoAnswer(calls[1], 0)).toBe(false);
    expect(isShortNoAnswer(calls[0], 60)).toBe(false);
  });
});

describe("period helpers", () => {
  it("shifts calendar dates", () => {
    expect(shiftCalendarDate("2026-07-20", -1)).toBe("2026-07-19");
    expect(shiftCalendarDate("2026-07-01", -1)).toBe("2026-06-30");
  });

  it("builds an equal previous period", () => {
    expect(previousEqualPeriod("2026-07-14", "2026-07-20")).toEqual({
      from: "2026-07-07",
      to: "2026-07-13",
    });
  });

  it("returns yesterday and same weekday for today preset", () => {
    expect(
      comparisonPeriods({
        preset: "today",
        from: "2026-07-20",
        to: "2026-07-20",
      }),
    ).toEqual([
      {
        key: "yesterday",
        label: "מול אתמול",
        from: "2026-07-19",
        to: "2026-07-19",
      },
      {
        key: "same-day-last-week",
        label: "מול אותו יום בשבוע שעבר",
        from: "2026-07-13",
        to: "2026-07-13",
      },
    ]);
  });

  it("expands fetch from to cover comparisons", () => {
    expect(
      earliestFetchFrom({
        preset: "today",
        from: "2026-07-20",
        to: "2026-07-20",
      }),
    ).toBe("2026-07-13");
  });
});

describe("hourly grouping", () => {
  it("groups inbound answer rate by Jerusalem hour", () => {
    const hourly = groupCallsByHour(calls, 0);
    const answeredHour = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Jerusalem",
        hour: "2-digit",
        hourCycle: "h23",
      }).format(new Date(calls[0].startedAt)),
    );
    expect(hourly[answeredHour].answered).toBe(1);
    expect(hourly[answeredHour].inbound).toBeGreaterThanOrEqual(1);
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
