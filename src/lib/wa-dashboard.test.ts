import { describe, expect, it } from "vitest";
import {
  currentlyWaiting,
  firstResponseElapsed,
  firstResponseTierCounts,
  firstResponseUnderCount,
  queueByDepartment,
  summarizeByAgent,
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
    handedToAgentAt: null,
    firstResponseFromHandoff: false,
    firstResponseSeconds: null,
    closed: false,
    timeToCloseSeconds: null,
    lastAgentMessageAt: null,
    lastCustomerMessageAt: null,
    waitingSince: null,
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
  it("excludes a ticket that is not waiting — the agent wrote last", () => {
    const rows = [
      ticket({
        id: "1",
        firstResponseSeconds: 30,
        lastAgentMessageAt: "2026-09-06T08:00:30.000Z",
        waitingSince: null,
      }),
    ];
    expect(currentlyWaiting(rows, NOW)).toEqual([]);
  });

  it("excludes closed tickets", () => {
    const rows = [ticket({ id: "1", closed: true, waitingSince: null })];
    expect(currentlyWaiting(rows, NOW)).toEqual([]);
  });

  it("counts a never-answered ticket from its start, with total equal to the wait", () => {
    const rows = [
      ticket({
        id: "1",
        createdAt: "2026-09-06T08:00:00.000Z",
        waitingSince: "2026-09-06T08:00:00.000Z",
      }),
    ];
    const waiting = currentlyWaiting(rows, NOW);
    expect(waiting).toHaveLength(1);
    expect(waiting[0].waitedSeconds).toBe(12 * 60);
    expect(waiting[0].totalSeconds).toBe(12 * 60);
  });

  it("counts from the customer's first unanswered message once the agent has replied before — not from the ticket's start", () => {
    // Opened 08:00; agent replied 08:01; customer wrote again 08:10 and is
    // waiting. The wait is measured from that 08:10 message (2 min), while
    // the total age is 12 min.
    const rows = [
      ticket({
        id: "1",
        createdAt: "2026-09-06T08:00:00.000Z",
        firstResponseSeconds: 60,
        lastAgentMessageAt: "2026-09-06T08:01:00.000Z",
        lastCustomerMessageAt: "2026-09-06T08:10:00.000Z",
        waitingSince: "2026-09-06T08:10:00.000Z",
      }),
    ];
    const waiting = currentlyWaiting(rows, NOW);
    expect(waiting).toHaveLength(1);
    expect(waiting[0].waitedSeconds).toBe(2 * 60);
    expect(waiting[0].totalSeconds).toBe(12 * 60);
  });

  it("sorts longest-waiting first", () => {
    const rows = [
      ticket({ id: "recent", waitingSince: "2026-09-06T08:10:00.000Z" }), // 2 min
      ticket({ id: "oldest", waitingSince: "2026-09-06T08:00:00.000Z" }), // 12 min
    ];
    expect(currentlyWaiting(rows, NOW).map((t) => t.id)).toEqual([
      "oldest",
      "recent",
    ]);
  });
});

describe("firstResponseElapsed", () => {
  it("uses the recorded figure once an agent has written", () => {
    expect(firstResponseElapsed(ticket({ firstResponseSeconds: 50 }), NOW)).toBe(50);
  });

  it("counts live from the bot's handoff while no agent has written", () => {
    // Opened 08:00, bot until the 08:09 handoff, no agent message at 08:12.
    const row = ticket({
      createdAt: "2026-09-06T08:00:00.000Z",
      handedToAgentAt: "2026-09-06T08:09:00.000Z",
      firstResponseFromHandoff: true,
    });
    expect(firstResponseElapsed(row, NOW)).toBe(3 * 60);
  });

  it("falls back to the ticket's start when no handoff was recorded", () => {
    expect(firstResponseElapsed(ticket({}), NOW)).toBe(12 * 60);
  });

  it("is null for a ticket that finished without any agent message", () => {
    expect(firstResponseElapsed(ticket({ closed: true }), NOW)).toBeNull();
  });
});

describe("firstResponseTierCounts", () => {
  it("counts answered-late and still-unanswered tickets alike, cumulatively", () => {
    const rows = [
      ticket({ id: "fast", firstResponseSeconds: 50 }), // none
      ticket({ id: "late", firstResponseSeconds: 8 * 60 }), // 3, 7
      ticket({ id: "open", handedToAgentAt: "2026-09-06T08:00:00.000Z" }), // live 12 min: 3, 7, 10
      ticket({ id: "bot-only", closed: true }), // excluded
    ];
    expect(firstResponseTierCounts(rows, NOW)).toEqual({ 3: 2, 7: 2, 10: 1 });
  });
});

describe("firstResponseUnderCount", () => {
  it("counts only answered tickets under the mark — not open ones still under it", () => {
    const rows = [
      ticket({ id: "fast", firstResponseSeconds: 50 }),
      ticket({ id: "exact", firstResponseSeconds: 180 }), // not under
      ticket({ id: "open", handedToAgentAt: "2026-09-06T08:11:00.000Z" }), // unanswered
    ];
    expect(firstResponseUnderCount(rows, 3)).toBe(1);
  });
});

describe("summarizeByAgent", () => {
  it("groups by agent, labels the unassigned bucket, and puts the most waiting first", () => {
    const rows = [
      ticket({ id: "1", agentId: "a", agentName: "א" }),
      ticket({ id: "2", agentId: "b", agentName: "ב", waitingSince: "2026-09-06T08:00:00.000Z" }),
      ticket({ id: "3", agentId: null, agentName: null }),
    ];
    const summary = summarizeByAgent(rows);
    expect(summary.map((s) => s.agentName)).toEqual(["ב", "א", "ללא שיוך נציג"]);
    expect(summary[0].awaitingReply).toBe(1);
  });
});

describe("queueByDepartment", () => {
  it("groups by department, longest wait first within and across groups", () => {
    const queue = [
      { id: "1", customerName: null, customerPhone: null, departmentId: "deliveries", departmentName: "אספקות", createdAt: "2026-09-06T07:50:00.000Z", handedToAgentAt: "2026-09-06T08:10:00.000Z" }, // 2 min
      { id: "2", customerName: null, customerPhone: null, departmentId: "customer-service", departmentName: "שירות לקוחות", createdAt: "2026-09-06T07:50:00.000Z", handedToAgentAt: "2026-09-06T08:00:00.000Z" }, // 12 min
      { id: "3", customerName: null, customerPhone: null, departmentId: "customer-service", departmentName: "שירות לקוחות", createdAt: "2026-09-06T07:50:00.000Z", handedToAgentAt: "2026-09-06T08:11:00.000Z" }, // 1 min
    ];
    const grouped = queueByDepartment(queue, NOW);
    expect(grouped.map((g) => g.departmentName)).toEqual(["שירות לקוחות", "אספקות"]);
    expect(grouped[0].tickets.map((t) => t.id)).toEqual(["2", "3"]);
    expect(grouped[0].tickets[0].waitedSeconds).toBe(12 * 60);
    expect(grouped[0].olderCount).toBe(0);
  });

  it("counts a ticket unassigned for over a day instead of listing it", () => {
    const queue = [
      { id: "stale", customerName: null, customerPhone: null, departmentId: "deliveries", departmentName: "אספקות", createdAt: "2026-09-01T08:00:00.000Z", handedToAgentAt: "2026-09-01T08:00:00.000Z" },
      { id: "live", customerName: null, customerPhone: null, departmentId: "deliveries", departmentName: "אספקות", createdAt: "2026-09-06T08:00:00.000Z", handedToAgentAt: "2026-09-06T08:00:00.000Z" },
    ];
    const [group] = queueByDepartment(queue, NOW);
    expect(group.tickets.map((t) => t.id)).toEqual(["live"]);
    expect(group.olderCount).toBe(1);
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

  it("averages only tickets that have a value, and counts waitingSince toward awaitingReply", () => {
    const rows = [
      ticket({ id: "1", firstResponseSeconds: 100, waitingSince: null }),
      ticket({ id: "2", firstResponseSeconds: 300, waitingSince: null }),
      // Never responded to and still open — waiting.
      ticket({
        id: "3",
        firstResponseSeconds: null,
        closed: false,
        waitingSince: "2026-09-06T08:00:00.000Z",
      }),
      // Closed without ever having an agent message — not waiting.
      ticket({
        id: "4",
        firstResponseSeconds: null,
        closed: true,
        timeToCloseSeconds: 900,
        waitingSince: null,
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
