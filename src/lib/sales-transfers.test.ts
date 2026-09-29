import { describe, expect, it } from "vitest";
import {
  percent,
  summarizeTransfers,
  waitingMinutesAtTransfer,
  type SalesTransferRow,
} from "./sales-transfers";

function row(overrides: Partial<SalesTransferRow> = {}): SalesTransferRow {
  return {
    id: "1",
    phone: "0526323133",
    salesAgent: "עילאי",
    transferredAt: "2026-09-29T07:03:37Z",
    isRepeat: false,
    category: "no_history",
    ticketId: null,
    ticketDepartment: null,
    ticketStatus: null,
    customerName: null,
    lastCustomerMessageAt: null,
    lastAgentMessageAt: null,
    calledServiceLineBefore: false,
    calledDeliveries24h: false,
    waAfterTicketId: null,
    waAfterAt: null,
    ...overrides,
  };
}

describe("summarizeTransfers", () => {
  it("counts repeats as transfers but not as episodes or categories", () => {
    const summary = summarizeTransfers([
      row({ id: "a" }),
      row({ id: "b", isRepeat: true, category: "called_service_line" }),
    ]);
    expect(summary.transfers).toBe(2);
    expect(summary.episodes).toBe(1);
    expect(summary.byCategory.no_history).toBe(1);
    expect(summary.byCategory.called_service_line).toBe(0);
    expect(summary.byAgent[0]).toMatchObject({ agent: "עילאי", transfers: 2, episodes: 1 });
  });

  it("counts distinct customers by the last nine digits", () => {
    const summary = summarizeTransfers([
      row({ id: "a", phone: "0526323133" }),
      row({ id: "b", phone: "+972526323133" }),
      row({ id: "c", phone: "0544956118" }),
    ]);
    expect(summary.customers).toBe(2);
  });

  it("keeps not-yet-classified rows under pending", () => {
    const summary = summarizeTransfers([row({ category: null })]);
    expect(summary.byCategory.pending).toBe(1);
    expect(summary.episodes).toBe(1);
  });

  it("orders agents by transfers, most first", () => {
    const summary = summarizeTransfers([
      row({ id: "a", salesAgent: "אדי" }),
      row({ id: "b", salesAgent: "תאיר ג" }),
      row({ id: "c", salesAgent: "תאיר ג", phone: "0544956118" }),
    ]);
    expect(summary.byAgent.map((agent) => agent.agent)).toEqual(["תאיר ג", "אדי"]);
  });

  it("counts episodes followed by a WhatsApp conversation", () => {
    const summary = summarizeTransfers([
      row({ id: "a", waAfterTicketId: "900" }),
      row({ id: "b", phone: "0544956118" }),
    ]);
    expect(summary.openedWhatsappAfter).toBe(1);
  });
});

describe("waitingMinutesAtTransfer", () => {
  it("measures from the customer's last message to the transfer", () => {
    expect(
      waitingMinutesAtTransfer(
        row({
          category: "waiting_on_us",
          lastCustomerMessageAt: "2026-09-29T06:45:56Z",
          transferredAt: "2026-09-29T07:02:51Z",
        }),
      ),
    ).toBe(17);
  });

  it("is null for other categories", () => {
    expect(
      waitingMinutesAtTransfer(
        row({ category: "in_progress", lastCustomerMessageAt: "2026-09-29T06:45:56Z" }),
      ),
    ).toBeNull();
  });
});

describe("percent", () => {
  it("rounds and handles an empty total", () => {
    expect(percent(1, 3)).toBe("33%");
    expect(percent(0, 0)).toBe("0%");
  });
});
