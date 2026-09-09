import { describe, expect, it } from "vitest";
import {
  businessClockLabel,
  businessSecondsBetween,
} from "@/lib/business-clock";
import { normalizeSchedule } from "@/lib/business-hours";
import { israelHolidayOn } from "@/lib/israel-holidays";

// The call center's real hours: Sunday–Thursday 08:00–15:00 Israel time.
// September 2026 is Israel daylight time (UTC+3), so 08:00 = 05:00Z.
const officeHours = normalizeSchedule([
  { day: 0, isOpen: true, open: "08:00", close: "15:00" },
  { day: 1, isOpen: true, open: "08:00", close: "15:00" },
  { day: 2, isOpen: true, open: "08:00", close: "15:00" },
  { day: 3, isOpen: true, open: "08:00", close: "15:00" },
  { day: 4, isOpen: true, open: "08:00", close: "15:00" },
  { day: 5, isOpen: false, open: "09:00", close: "18:00" },
  { day: 6, isOpen: false, open: "09:00", close: "18:00" },
]);

describe("businessSecondsBetween", () => {
  it("counts plain elapsed time inside one open window", () => {
    // Wednesday 10:00 → 10:04
    expect(
      businessSecondsBetween("2026-09-09T07:00:00Z", "2026-09-09T07:04:00Z", officeHours),
    ).toBe(240);
  });

  it("stops at closing time and resumes at opening the next morning", () => {
    // Handed over Wednesday 14:58, answered Thursday 08:03: 2 + 3 minutes.
    expect(
      businessSecondsBetween("2026-09-09T11:58:00Z", "2026-09-10T05:03:00Z", officeHours),
    ).toBe(300);
  });

  it("starts the clock at opening for a message sent in the evening", () => {
    // Wednesday 20:00 → Thursday 08:10 is ten minutes.
    expect(
      businessSecondsBetween("2026-09-09T17:00:00Z", "2026-09-10T05:10:00Z", officeHours),
    ).toBe(600);
  });

  it("skips Friday and Saturday", () => {
    // Thursday 3 Sep 16:00 → Sunday 6 Sep 08:15 is fifteen minutes.
    expect(
      businessSecondsBetween("2026-09-03T13:00:00Z", "2026-09-06T05:15:00Z", officeHours),
    ).toBe(900);
  });

  it("skips a Sunday that is Rosh Hashana as well as the weekend", () => {
    // Thursday 10 Sep 14:50 → Friday (erev), Sat–Sun (Rosh Hashana) closed →
    // Monday 14 Sep 08:05: 10 + 5 minutes.
    expect(
      businessSecondsBetween("2026-09-10T11:50:00Z", "2026-09-14T05:05:00Z", officeHours),
    ).toBe(900);
  });

  it("counts a whole working day as seven hours", () => {
    expect(
      businessSecondsBetween("2026-09-09T04:00:00Z", "2026-09-09T13:00:00Z", officeHours),
    ).toBe(7 * 3600);
  });

  it("skips holidays and their eves", () => {
    // Sunday 20 Sep 2026 is erev Yom Kippur, Monday 21 Sep is Yom Kippur:
    // Thursday 17 Sep 14:50 → Tuesday 22 Sep 08:05 is 10 + 5 minutes.
    expect(
      businessSecondsBetween("2026-09-17T11:50:00Z", "2026-09-22T05:05:00Z", officeHours),
    ).toBe(900);
  });

  it("uses the wall clock without a usable schedule", () => {
    expect(
      businessSecondsBetween("2026-09-09T17:00:00Z", "2026-09-10T05:10:00Z", null),
    ).toBe(12 * 3600 + 600);
    const allClosed = officeHours.map((day) => ({ ...day, isOpen: false }));
    expect(
      businessSecondsBetween("2026-09-09T17:00:00Z", "2026-09-09T17:01:00Z", allClosed),
    ).toBe(60);
  });

  it("is never negative", () => {
    expect(
      businessSecondsBetween("2026-09-09T07:04:00Z", "2026-09-09T07:00:00Z", officeHours),
    ).toBe(0);
  });

  it("handles an overnight window that started the previous evening", () => {
    const nights = normalizeSchedule([
      { day: 5, isOpen: true, open: "20:00", close: "02:00" },
    ]).map((day) => (day.day === 5 ? day : { ...day, isOpen: false }));
    // Friday 16 Oct 23:00 → Saturday 01:00 Israel time (still UTC+3).
    expect(
      businessSecondsBetween("2026-10-16T20:00:00Z", "2026-10-16T22:00:00Z", nights),
    ).toBe(7200);
  });
});

describe("israelHolidayOn", () => {
  it("knows the 5787 holidays and their eves", () => {
    expect(israelHolidayOn("2026-09-11")).toBe("ערב ראש השנה");
    expect(israelHolidayOn("2026-09-12")).toBe("ראש השנה");
    expect(israelHolidayOn("2026-09-13")).toBe("ראש השנה");
    expect(israelHolidayOn("2026-09-20")).toBe("ערב יום כיפור");
    expect(israelHolidayOn("2026-09-21")).toBe("יום כיפור");
    expect(israelHolidayOn("2026-09-25")).toBe("ערב סוכות");
    expect(israelHolidayOn("2026-09-26")).toBe("סוכות");
    expect(israelHolidayOn("2026-10-02")).toBe("ערב שמחת תורה");
    expect(israelHolidayOn("2026-10-03")).toBe("שמחת תורה");
    expect(israelHolidayOn("2027-04-21")).toBe("ערב פסח");
    expect(israelHolidayOn("2027-04-22")).toBe("פסח");
    expect(israelHolidayOn("2027-04-28")).toBe("שביעי של פסח");
    expect(israelHolidayOn("2027-06-10")).toBe("ערב שבועות");
    expect(israelHolidayOn("2027-06-11")).toBe("שבועות");
  });

  it("observes Independence Day on its shifted date", () => {
    // 5 Iyar 5786 is Wednesday 22 April 2026 (unmoved);
    // 5 Iyar 5787 is Wednesday 12 May 2027 (unmoved).
    expect(israelHolidayOn("2026-04-22")).toBe("יום העצמאות");
    expect(israelHolidayOn("2027-05-12")).toBe("יום העצמאות");
    expect(israelHolidayOn("2026-04-21")).toBeNull();
  });

  it("treats ordinary days, Chol HaMoed and Purim as working days", () => {
    expect(israelHolidayOn("2026-09-09")).toBeNull();
    expect(israelHolidayOn("2026-09-28")).toBeNull(); // Chol HaMoed Sukkot
    expect(israelHolidayOn("2026-03-03")).toBeNull(); // Purim
  });
});

describe("businessClockLabel", () => {
  it("collapses a run of identical days", () => {
    expect(businessClockLabel(officeHours)).toBe("ראשון–חמישי 08:00–15:00");
  });

  it("lists days separately when hours differ", () => {
    const mixed = officeHours.map((day) =>
      day.day === 4 ? { ...day, close: "13:00" } : day,
    );
    expect(businessClockLabel(mixed)).toBe(
      "ראשון 08:00–15:00, שני 08:00–15:00, שלישי 08:00–15:00, רביעי 08:00–15:00, חמישי 08:00–13:00",
    );
  });

  it("is null for the wall clock", () => {
    expect(businessClockLabel(null)).toBeNull();
  });
});
