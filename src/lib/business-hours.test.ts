import { describe, expect, it } from "vitest";
import {
  defaultWeekSchedule,
  isAfterHoursInboundCall,
  isWithinBusinessHours,
  normalizeSchedule,
  splitCallsByBusinessHours,
  type BusinessHoursConfig,
} from "@/lib/business-hours";
import type { CallRecord } from "@/lib/types";

const weekdaySchedule = normalizeSchedule([
  { day: 0, isOpen: false, open: "09:00", close: "18:00" },
  { day: 1, isOpen: true, open: "09:00", close: "18:00" },
  { day: 2, isOpen: true, open: "09:00", close: "18:00" },
  { day: 3, isOpen: true, open: "09:00", close: "18:00" },
  { day: 4, isOpen: true, open: "09:00", close: "18:00" },
  { day: 5, isOpen: true, open: "09:00", close: "13:00" },
  { day: 6, isOpen: false, open: "09:00", close: "18:00" },
]);

// Friday night through early Saturday, then closed for Shabbat.
const overnightSchedule = normalizeSchedule([
  { day: 0, isOpen: false, open: "09:00", close: "18:00" },
  { day: 1, isOpen: true, open: "09:00", close: "18:00" },
  { day: 2, isOpen: true, open: "09:00", close: "18:00" },
  { day: 3, isOpen: true, open: "09:00", close: "18:00" },
  { day: 4, isOpen: true, open: "09:00", close: "18:00" },
  { day: 5, isOpen: true, open: "20:00", close: "02:00" },
  { day: 6, isOpen: false, open: "09:00", close: "18:00" },
]);

const config: BusinessHoursConfig = {
  enabled: true,
  departments: [
    {
      departmentId: "customer-service",
      departmentName: "שירות לקוחות",
      schedule: weekdaySchedule,
    },
  ],
};

function call(
  partial: Partial<CallRecord> & Pick<CallRecord, "id" | "startedAt">,
): CallRecord {
  return {
    direction: "inbound",
    status: "answered",
    agentId: "a1",
    agentName: "נועה",
    transferredByAgentId: null,
    transferredByAgentName: null,
    departmentId: "customer-service",
    departmentName: "שירות לקוחות",
    customerNumber: "050",
    endedAt: null,
    durationSeconds: 60,
    talkTimeSeconds: 40,
    waitTimeSeconds: 10,
    ...partial,
  };
}

describe("business hours", () => {
  it("treats Monday 10:00 Israel as open", () => {
    // 2026-07-20 was Monday; 07:00 UTC = 10:00 Israel (IDT)
    expect(
      isWithinBusinessHours("2026-07-20T07:00:00.000Z", weekdaySchedule),
    ).toBe(true);
  });

  it("treats Monday 18:00 Israel as closed (exclusive end)", () => {
    expect(
      isWithinBusinessHours("2026-07-20T15:00:00.000Z", weekdaySchedule),
    ).toBe(false);
  });

  it("treats Friday 21:00 Israel as open (overnight session before midnight)", () => {
    // 2026-07-17 was Friday; 18:00 UTC = 21:00 Israel (IDT)
    expect(
      isWithinBusinessHours("2026-07-17T18:00:00.000Z", overnightSchedule),
    ).toBe(true);
  });

  it("treats Saturday 01:00 Israel as open (Friday's overnight session spilling past midnight)", () => {
    // 22:00 UTC on 2026-07-17 (Friday) = 01:00 Israel on Saturday 2026-07-18.
    // Saturday's own row is closed for Shabbat, but Friday's overnight
    // window is still running.
    expect(
      isWithinBusinessHours("2026-07-17T22:00:00.000Z", overnightSchedule),
    ).toBe(true);
  });

  it("treats Saturday 10:00 Israel as closed (Shabbat, well past the overnight window)", () => {
    // 2026-07-18 was Saturday; 07:00 UTC = 10:00 Israel
    expect(
      isWithinBusinessHours("2026-07-18T07:00:00.000Z", overnightSchedule),
    ).toBe(false);
  });

  it("normalizeSchedule drops entries with a non-numeric day", () => {
    const schedule = normalizeSchedule([
      { day: "not-a-number", isOpen: true, open: "08:00", close: "20:00" },
    ]);
    expect(schedule).toEqual(defaultWeekSchedule());
  });

  it("only routes inbound after-hours when feature is enabled", () => {
    const afterHoursCall = call({
      id: "1",
      startedAt: "2026-07-20T15:30:00.000Z",
    });
    expect(isAfterHoursInboundCall(afterHoursCall, config)).toBe(true);
    expect(
      isAfterHoursInboundCall(afterHoursCall, { ...config, enabled: false }),
    ).toBe(false);
  });

  it("never marks outbound as after-hours", () => {
    const outbound = call({
      id: "2",
      direction: "outbound",
      startedAt: "2026-07-20T15:30:00.000Z",
    });
    expect(isAfterHoursInboundCall(outbound, config)).toBe(false);
  });

  it("splits calls and keeps outbound in business bucket", () => {
    const calls = [
      call({ id: "in-late", startedAt: "2026-07-20T15:30:00.000Z" }),
      call({
        id: "out-late",
        direction: "outbound",
        startedAt: "2026-07-20T15:30:00.000Z",
      }),
      call({ id: "in-day", startedAt: "2026-07-20T07:00:00.000Z" }),
    ];
    const { business, afterHours } = splitCallsByBusinessHours(calls, config);
    expect(afterHours.map((item) => item.id)).toEqual(["in-late"]);
    expect(business.map((item) => item.id).sort()).toEqual([
      "in-day",
      "out-late",
    ]);
  });
});
