import { describe, expect, it } from "vitest";
import {
  isStale,
  STALE_THRESHOLD_SECONDS,
  summarizeTickets,
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

describe("isStale", () => {
  it("is not stale just under the threshold", () => {
    expect(isStale(STALE_THRESHOLD_SECONDS - 1)).toBe(false);
  });

  it("is stale exactly at the threshold", () => {
    expect(isStale(STALE_THRESHOLD_SECONDS)).toBe(true);
  });

  it("is not stale for a fresh ticket", () => {
    expect(isStale(0)).toBe(false);
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
