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
    departmentId: "customer-service",
    departmentName: null,
    status: "open",
    createdAt: "2026-09-06T08:00:00.000Z",
    updatedAt: "2026-09-06T08:00:00.000Z",
    firstResponseSeconds: null,
    closed: false,
    timeToCloseSeconds: null,
    awaitingReplySince: null,
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
  it("excludes a ticket with no awaitingReplySince — already answered and no follow-up", () => {
    const rows = [
      ticket({ id: "1", firstResponseSeconds: 30, awaitingReplySince: null }),
    ];
    expect(currentlyWaiting(rows, NOW)).toEqual([]);
  });

  it("excludes closed tickets even without a tracked reply", () => {
    const rows = [ticket({ id: "1", closed: true, awaitingReplySince: null })];
    expect(currentlyWaiting(rows, NOW)).toEqual([]);
  });

  it("includes a ticket never replied to, waiting since it was created", () => {
    const rows = [
      ticket({
        id: "1",
        createdAt: "2026-09-06T08:00:00.000Z",
        awaitingReplySince: "2026-09-06T08:00:00.000Z",
      }),
    ];
    const waiting = currentlyWaiting(rows, NOW);
    expect(waiting).toHaveLength(1);
    expect(waiting[0].waitedSeconds).toBe(12 * 60);
  });

  it("includes a ticket the agent already answered once, waiting again since the customer's follow-up — not since the first message", () => {
    // Agent replied at 08:01 (fast first response); customer wrote again at
    // 08:10, unanswered since. The wait must be measured from 08:10, not from
    // createdAt at 08:00 — that was the bug being fixed here.
    const rows = [
      ticket({
        id: "1",
        createdAt: "2026-09-06T08:00:00.000Z",
        firstResponseSeconds: 60,
        awaitingReplySince: "2026-09-06T08:10:00.000Z",
      }),
    ];
    const waiting = currentlyWaiting(rows, NOW);
    expect(waiting).toHaveLength(1);
    expect(waiting[0].waitedSeconds).toBe(2 * 60);
  });

  it("sorts longest-waiting first", () => {
    const rows = [
      ticket({ id: "recent", awaitingReplySince: "2026-09-06T08:10:00.000Z" }), // 2 min
      ticket({ id: "oldest", awaitingReplySince: "2026-09-06T08:00:00.000Z" }), // 12 min
    ];
    expect(currentlyWaiting(rows, NOW).map((t) => t.id)).toEqual([
      "oldest",
      "recent",
    ]);
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
      awaitingReply: 0,
      closedCount: 0,
      avgTimeToCloseSeconds: null,
    });
  });

  it("averages only tickets that have a value, and counts awaitingReplySince toward awaitingReply", () => {
    const rows = [
      ticket({ id: "1", firstResponseSeconds: 100, awaitingReplySince: null }),
      ticket({ id: "2", firstResponseSeconds: 300, awaitingReplySince: null }),
      // Never responded to and still open — awaiting a reply.
      ticket({
        id: "3",
        firstResponseSeconds: null,
        closed: false,
        awaitingReplySince: "2026-09-06T08:00:00.000Z",
      }),
      // Closed without ever having a tracked agent reply — not "awaiting".
      ticket({
        id: "4",
        firstResponseSeconds: null,
        closed: true,
        timeToCloseSeconds: 900,
        awaitingReplySince: null,
      }),
    ];

    const stats = summarizeTickets(rows);
    expect(stats.ticketCount).toBe(4);
    expect(stats.respondedCount).toBe(2);
    expect(stats.avgFirstResponseSeconds).toBe(200);
    expect(stats.awaitingReply).toBe(1);
    expect(stats.closedCount).toBe(1);
    expect(stats.avgTimeToCloseSeconds).toBe(900);
  });
});
