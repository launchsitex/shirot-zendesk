import { describe, expect, it } from "vitest";
import {
  currentlyWaiting,
  summarizeTickets,
  waitingTier,
  waitingTierCounts,
  type WaTicketRow,
} from "@/lib/wa-dashboard";

function ticket(overrides: Partial<WaTicketRow>): WaTicketRow {
  return {
    id: "1",
    subject: null,
    customerName: null,
    customerPhone: null,
    agentId: null,
    agentName: "נציגה",
    departmentName: null,
    status: "open",
    createdAt: "2026-09-06T08:00:00.000Z",
    updatedAt: "2026-09-06T08:00:00.000Z",
    firstResponseSeconds: null,
    closed: false,
    timeToCloseSeconds: null,
    ...overrides,
  };
}

const NOW = new Date("2026-09-06T08:12:00.000Z"); // 12 minutes after createdAt above

describe("waitingTier", () => {
  it("is null under the lowest tier", () => {
    expect(waitingTier(60)).toBeNull();
  });

  it("crosses into the 3-minute tier exactly at 3 minutes", () => {
    expect(waitingTier(180)).toBe(3);
  });

  it("reports the highest tier crossed, not the lowest", () => {
    expect(waitingTier(600)).toBe(10);
    expect(waitingTier(420)).toBe(7);
  });
});

describe("currentlyWaiting", () => {
  it("excludes tickets that already got a first reply", () => {
    const rows = [ticket({ id: "1", firstResponseSeconds: 30 })];
    expect(currentlyWaiting(rows, NOW)).toEqual([]);
  });

  it("excludes closed tickets even without a tracked reply", () => {
    const rows = [ticket({ id: "1", closed: true })];
    expect(currentlyWaiting(rows, NOW)).toEqual([]);
  });

  it("computes live waited seconds and sorts longest-waiting first", () => {
    const rows = [
      ticket({ id: "recent", createdAt: "2026-09-06T08:10:00.000Z" }), // 2 min
      ticket({ id: "oldest", createdAt: "2026-09-06T08:00:00.000Z" }), // 12 min
    ];
    const waiting = currentlyWaiting(rows, NOW);
    expect(waiting.map((t) => t.id)).toEqual(["oldest", "recent"]);
    expect(waiting[0].waitedSeconds).toBe(12 * 60);
    expect(waiting[1].waitedSeconds).toBe(2 * 60);
  });
});

describe("waitingTierCounts", () => {
  it("counts cumulatively — a long wait counts toward every tier it crossed", () => {
    const waiting = [
      { waitedSeconds: 12 * 60 }, // crosses 3, 7, and 10
      { waitedSeconds: 8 * 60 }, // crosses 3 and 7
      { waitedSeconds: 4 * 60 }, // crosses 3 only
      { waitedSeconds: 60 }, // crosses none
    ];
    expect(waitingTierCounts(waiting)).toEqual({ 3: 3, 7: 2, 10: 1 });
  });
});

describe("summarizeTickets", () => {
  it("returns zeroed stats for an empty list", () => {
    expect(summarizeTickets([])).toEqual({
      ticketCount: 0,
      respondedCount: 0,
      avgFirstResponseSeconds: null,
      awaitingFirstResponse: 0,
      closedCount: 0,
      avgTimeToCloseSeconds: null,
    });
  });

  it("averages only tickets that have a value, and counts the rest as awaiting", () => {
    const rows = [
      ticket({ id: "1", firstResponseSeconds: 100 }),
      ticket({ id: "2", firstResponseSeconds: 300 }),
      // Still open and never responded to — counts toward awaitingFirstResponse.
      ticket({ id: "3", firstResponseSeconds: null, closed: false }),
      // Closed without ever having a tracked agent reply — not "awaiting".
      ticket({
        id: "4",
        firstResponseSeconds: null,
        closed: true,
        timeToCloseSeconds: 900,
      }),
    ];

    const stats = summarizeTickets(rows);
    expect(stats.ticketCount).toBe(4);
    expect(stats.respondedCount).toBe(2);
    expect(stats.avgFirstResponseSeconds).toBe(200);
    expect(stats.awaitingFirstResponse).toBe(1);
    expect(stats.closedCount).toBe(1);
    expect(stats.avgTimeToCloseSeconds).toBe(900);
  });
});
