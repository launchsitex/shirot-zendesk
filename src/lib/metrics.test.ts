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
  waitStatsByDepartment,
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

describe("waitStatsByDepartment", () => {
  const make = (over: Partial<CallRecord>): CallRecord => ({
    id: Math.random().toString(36).slice(2),
    direction: "inbound",
    status: "answered",
    agentId: "a1",
    agentName: "נציג",
    transferredByAgentId: null,
    transferredByAgentName: null,
    departmentId: "deliveries",
    departmentName: "אספקות",
    customerNumber: "050",
    startedAt: "2026-08-09T07:00:00.000Z",
    endedAt: "2026-08-09T07:05:00.000Z",
    durationSeconds: 300,
    talkTimeSeconds: 240,
    waitTimeSeconds: 30,
    ...over,
  });

  it("keeps departments apart instead of blending them", () => {
    const stats = waitStatsByDepartment([
      make({ waitTimeSeconds: 100 }),
      make({
        departmentId: "service",
        departmentName: "שירות",
        waitTimeSeconds: 20,
      }),
    ]);
    expect(stats).toHaveLength(2);
    expect(stats.map((row) => row.departmentName)).toEqual(["אספקות", "שירות"]);
    expect(stats[0].averageWaitSeconds).toBe(100);
    expect(stats[1].averageWaitSeconds).toBe(20);
  });

  it("splits the share of total waiting time between them", () => {
    const stats = waitStatsByDepartment([
      make({ waitTimeSeconds: 75 }),
      make({
        departmentId: "service",
        departmentName: "שירות",
        waitTimeSeconds: 25,
      }),
    ]);
    expect(stats[0].shareOfWaitPct).toBe(75);
    expect(stats[1].shareOfWaitPct).toBe(25);
  });

  it("measures the target against answered calls only", () => {
    const stats = waitStatsByDepartment(
      [
        make({ waitTimeSeconds: 30 }),
        make({ waitTimeSeconds: 90 }),
        // A missed call waited far past the target but was never answered, so
        // it must not drag the service level down as if somebody was slow.
        make({ status: "missed", agentId: null, waitTimeSeconds: 600 }),
      ],
      60,
    );
    expect(stats[0].inbound).toBe(3);
    expect(stats[0].answered).toBe(2);
    expect(stats[0].answeredWithinTargetPct).toBe(50);
  });

  it("ignores outbound calls", () => {
    const stats = waitStatsByDepartment([
      make({ direction: "outbound", waitTimeSeconds: 500 }),
      make({ waitTimeSeconds: 10 }),
    ]);
    expect(stats).toHaveLength(1);
    expect(stats[0].inbound).toBe(1);
    expect(stats[0].totalWaitSeconds).toBe(10);
  });

  it("leaves calls still ringing out of the average", () => {
    const stats = waitStatsByDepartment([
      make({ waitTimeSeconds: 40 }),
      make({ status: "in_progress", agentId: null, waitTimeSeconds: 0 }),
    ]);
    expect(stats[0].inbound).toBe(1);
    expect(stats[0].averageWaitSeconds).toBe(40);
  });

  it("labels calls that arrived without a department", () => {
    const stats = waitStatsByDepartment([
      make({ departmentId: null, departmentName: null, waitTimeSeconds: 5 }),
    ]);
    expect(stats[0].departmentName).toBe("ללא שיוך מחלקה");
    expect(stats[0].departmentId).toBeNull();
  });

  it("reports no percentage when nothing was answered", () => {
    const stats = waitStatsByDepartment([
      make({ status: "missed", agentId: null, waitTimeSeconds: 200 }),
    ]);
    expect(stats[0].answered).toBe(0);
    expect(stats[0].averageWaitSeconds).toBeNull();
    expect(stats[0].answeredWithinTargetPct).toBeNull();
  });
});
