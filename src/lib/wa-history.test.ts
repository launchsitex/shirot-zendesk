import { describe, expect, it } from "vitest";
import {
  agentsToCsv,
  dayLabel,
  daysBetween,
  presetRange,
  previousRange,
  statsByAgent,
  statsByDay,
  sumRows,
  type WaDailyRow,
} from "@/lib/wa-history";

function row(overrides: Partial<WaDailyRow>): WaDailyRow {
  return {
    day: "2026-09-09",
    departmentId: "customer-service",
    agentId: "a1",
    agentName: "נציגה א",
    ticketCount: 0,
    openCount: 0,
    closedCount: 0,
    timeToCloseSecondsSum: 0,
    respondedCount: 0,
    firstResponseSecondsSum: 0,
    under3Count: 0,
    over3Count: 0,
    over7Count: 0,
    over10Count: 0,
    ...overrides,
  };
}

describe("sumRows", () => {
  it("adds counts and averages from the sums", () => {
    const stats = sumRows([
      row({ ticketCount: 4, respondedCount: 2, firstResponseSecondsSum: 200, under3Count: 1, over3Count: 1, closedCount: 1, timeToCloseSecondsSum: 900 }),
      row({ day: "2026-09-10", ticketCount: 6, respondedCount: 3, firstResponseSecondsSum: 400, under3Count: 3, closedCount: 3, timeToCloseSecondsSum: 2700 }),
    ]);
    expect(stats.ticketCount).toBe(10);
    expect(stats.respondedCount).toBe(5);
    expect(stats.avgFirstResponseSeconds).toBe(120);
    expect(stats.avgTimeToCloseSeconds).toBe(900);
    expect(stats.under3Count).toBe(4);
    expect(stats.under3Share).toBe(0.8);
    expect(stats.activeDays).toBe(2);
  });

  it("has null averages with nothing to average", () => {
    const stats = sumRows([row({ ticketCount: 2 })]);
    expect(stats.avgFirstResponseSeconds).toBeNull();
    expect(stats.avgTimeToCloseSeconds).toBeNull();
    expect(stats.under3Share).toBeNull();
    expect(sumRows([]).activeDays).toBe(0);
  });
});

describe("statsByDay / statsByAgent", () => {
  const rows = [
    row({ day: "2026-09-10", agentId: "a2", agentName: "נציגה ב", ticketCount: 5 }),
    row({ day: "2026-09-09", agentId: "a1", ticketCount: 3, respondedCount: 3, firstResponseSecondsSum: 300 }),
    row({ day: "2026-09-10", agentId: "a1", ticketCount: 4, respondedCount: 4, firstResponseSecondsSum: 800 }),
  ];

  it("orders days oldest first and merges agents within a day", () => {
    const days = statsByDay(rows);
    expect(days.map((d) => d.day)).toEqual(["2026-09-09", "2026-09-10"]);
    expect(days[1].ticketCount).toBe(9);
  });

  it("orders agents busiest first with their own day list", () => {
    const agents = statsByAgent(rows);
    expect(agents.map((a) => a.agentId)).toEqual(["a1", "a2"]);
    expect(agents[0].ticketCount).toBe(7);
    expect(agents[0].avgFirstResponseSeconds).toBeCloseTo(1100 / 7);
    expect(agents[0].days.map((d) => d.day)).toEqual(["2026-09-09", "2026-09-10"]);
    expect(agents[0].activeDays).toBe(2);
  });
});

describe("ranges", () => {
  // Wednesday 9 September 2026.
  const today = "2026-09-09";

  it("builds the presets on a Sunday-first week", () => {
    expect(presetRange("today", today)).toEqual({ from: "2026-09-09", to: "2026-09-09" });
    expect(presetRange("this-week", today)).toEqual({ from: "2026-09-06", to: "2026-09-09" });
    expect(presetRange("last-week", today)).toEqual({ from: "2026-08-30", to: "2026-09-05" });
    expect(presetRange("this-month", today)).toEqual({ from: "2026-09-01", to: "2026-09-09" });
    expect(presetRange("last-30", today)).toEqual({ from: "2026-08-11", to: "2026-09-09" });
  });

  it("takes the previous period of the same length", () => {
    expect(previousRange("2026-09-06", "2026-09-09")).toEqual({ from: "2026-09-02", to: "2026-09-05" });
    expect(previousRange("2026-09-09", "2026-09-09")).toEqual({ from: "2026-09-08", to: "2026-09-08" });
    expect(daysBetween("2026-09-06", "2026-09-09")).toBe(4);
  });

  it("labels a day the way the team says it", () => {
    expect(dayLabel("2026-09-09")).toBe("ד׳ 09.09");
    expect(dayLabel("2026-09-13")).toBe("א׳ 13.09");
  });
});

describe("agentsToCsv", () => {
  it("writes a total line and a line per day, with a BOM for Excel", () => {
    const csv = agentsToCsv(
      statsByAgent([
        row({ ticketCount: 2, respondedCount: 2, firstResponseSecondsSum: 250, under3Count: 1, over3Count: 1 }),
      ]),
    );
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe('נציגה א,"סה""כ",2,0,0,2,2:05,,1,1,0,0');
    expect(lines[2].startsWith("נציגה א,2026-09-09,")).toBe(true);
  });
});
