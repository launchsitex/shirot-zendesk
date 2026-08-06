import { describe, expect, it } from "vitest";
import {
  attainment,
  formatHoursMinutes,
  groupByDepartment,
  reportWindow,
  type AgentTargetRow,
} from "@/lib/agent-targets";

const row = (over: Partial<AgentTargetRow> = {}): AgentTargetRow => ({
  departmentId: "deliveries",
  departmentName: "אספקות",
  agentId: "1",
  agentName: "נציג",
  target: 10,
  actual: 10,
  inboundTalkSeconds: 0,
  outboundTalkSeconds: 0,
  ...over,
});

describe("reportWindow", () => {
  // The whole report hinges on 15:30 *Jerusalem*, and Israel is UTC+3 in
  // summer and UTC+2 in winter. Getting this wrong shifts every number by an
  // hour on one side of the DST switch, silently.
  it("resolves the 15:30 cutoff to 12:30 UTC during IDT (summer)", () => {
    const { from, to } = reportWindow("2026-08-02", "until-cutoff");
    expect(from).toBe("2026-08-01T21:00:00.000Z");
    expect(to).toBe("2026-08-02T12:30:00.000Z");
  });

  it("resolves the same cutoff to 13:30 UTC during IST (winter)", () => {
    const { from, to } = reportWindow("2026-12-02", "until-cutoff");
    expect(from).toBe("2026-12-01T22:00:00.000Z");
    expect(to).toBe("2026-12-02T13:30:00.000Z");
  });

  it("spans midnight to midnight for a full day", () => {
    const { from, to } = reportWindow("2026-08-02", "full-day");
    expect(from).toBe("2026-08-01T21:00:00.000Z");
    expect(to).toBe("2026-08-02T21:00:00.000Z");
  });

  it("keeps the window 15.5 hours wide across the spring-forward day", () => {
    // 2026-03-27 is the Israeli DST switch; the day is 23 hours long, so a
    // naive +15.5h from midnight would land at 16:30 local, not 15:30.
    const { from, to } = reportWindow("2026-03-27", "until-cutoff");
    const hours =
      (Date.parse(to) - Date.parse(from)) / (1000 * 60 * 60);
    expect(hours).toBe(14.5);
  });
});

describe("attainment", () => {
  it("is null when no target is set", () => {
    expect(attainment(row({ target: null }))).toBeNull();
  });

  it("is null for a zero target, so the UI shows a dash and not a divide", () => {
    expect(attainment(row({ target: 0 }))).toBeNull();
  });

  it("rounds to whole percent", () => {
    expect(attainment(row({ target: 3, actual: 2 }))).toBe(67);
    expect(attainment(row({ target: 10, actual: 13 }))).toBe(130);
  });
});

describe("formatHoursMinutes", () => {
  it("formats as zero-padded hours:minutes", () => {
    expect(formatHoursMinutes(25_295)).toBe("07:01");
    expect(formatHoursMinutes(0)).toBe("00:00");
    expect(formatHoursMinutes(59)).toBe("00:00");
    expect(formatHoursMinutes(60)).toBe("00:01");
  });

  it("does not roll over past 24 hours — a team total can exceed a day", () => {
    expect(formatHoursMinutes(90_000)).toBe("25:00");
  });

  it("floors seconds rather than rounding minutes up", () => {
    expect(formatHoursMinutes(119)).toBe("00:01");
  });

  it("treats negatives as zero", () => {
    expect(formatHoursMinutes(-10)).toBe("00:00");
  });
});

describe("groupByDepartment", () => {
  it("totals target and actual per department", () => {
    const groups = groupByDepartment([
      row({ agentId: "1", target: 10, actual: 12 }),
      row({ agentId: "2", target: 5, actual: 3 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].totalTarget).toBe(15);
    expect(groups[0].totalActual).toBe(15);
  });

  it("totals talk time per direction alongside the call counts", () => {
    const groups = groupByDepartment([
      row({ agentId: "1", inboundTalkSeconds: 3_600, outboundTalkSeconds: 600 }),
      row({ agentId: "2", inboundTalkSeconds: 1_800, outboundTalkSeconds: 300 }),
    ]);
    expect(groups[0].totalInboundTalkSeconds).toBe(5_400);
    expect(groups[0].totalOutboundTalkSeconds).toBe(900);
  });

  it("counts an untargeted agent's calls without inflating the target", () => {
    const groups = groupByDepartment([
      row({ agentId: "1", target: 10, actual: 4 }),
      row({ agentId: "2", target: null, actual: 6 }),
    ]);
    expect(groups[0].totalTarget).toBe(10);
    expect(groups[0].totalActual).toBe(10);
  });

  it("keeps the same agent separate in each department", () => {
    const groups = groupByDepartment([
      row({ agentId: "1", departmentId: "deliveries", departmentName: "אספקות" }),
      row({
        agentId: "1",
        departmentId: "customer-service",
        departmentName: "שירות לקוחות",
        actual: 3,
      }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.departmentName)).toEqual([
      "אספקות",
      "שירות לקוחות",
    ]);
  });

  it("labels rows with no department", () => {
    const groups = groupByDepartment([
      row({ departmentId: null, departmentName: null }),
    ]);
    expect(groups[0].departmentName).toBe("ללא שיוך מחלקה");
  });
});
