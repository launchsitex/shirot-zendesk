import type { CallRecord } from "@/lib/types";

/** Sunday = 0 … Saturday = 6 (Israel local weekday). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type DaySchedule = {
  day: Weekday;
  isOpen: boolean;
  /** HH:mm local Israel */
  open: string;
  /** HH:mm local Israel — exclusive end (18:00 means until 17:59:59) */
  close: string;
};

export type DepartmentHours = {
  departmentId: string;
  departmentName: string;
  schedule: DaySchedule[];
};

export type BusinessHoursConfig = {
  enabled: boolean;
  departments: DepartmentHours[];
};

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  0: "ראשון",
  1: "שני",
  2: "שלישי",
  3: "רביעי",
  4: "חמישי",
  5: "שישי",
  6: "שבת",
};

export function defaultWeekSchedule(): DaySchedule[] {
  return ([0, 1, 2, 3, 4, 5, 6] as Weekday[]).map((day) => ({
    day,
    isOpen: day >= 1 && day <= 5,
    open: "09:00",
    close: "18:00",
  }));
}

export function normalizeSchedule(raw: unknown): DaySchedule[] {
  const byDay = new Map<Weekday, DaySchedule>();
  defaultWeekSchedule().forEach((day) => byDay.set(day.day, day));

  if (Array.isArray(raw)) {
    raw.forEach((item) => {
      if (!item || typeof item !== "object") return;
      const row = item as Record<string, unknown>;
      const day = Number(row.day) as Weekday;
      if (day < 0 || day > 6) return;
      byDay.set(day, {
        day,
        isOpen: typeof row.isOpen === "boolean" ? row.isOpen : true,
        open: normalizeTime(String(row.open ?? "09:00")),
        close: normalizeTime(String(row.close ?? "18:00")),
      });
    });
  }

  return ([0, 1, 2, 3, 4, 5, 6] as Weekday[]).map(
    (day) => byDay.get(day) ?? defaultWeekSchedule()[day],
  );
}

function normalizeTime(value: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return "09:00";
  const hours = Math.min(23, Math.max(0, Number(match[1])));
  const minutes = Math.min(59, Math.max(0, Number(match[2])));
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function timeToMinutes(value: string): number {
  const [hours, minutes] = normalizeTime(value).split(":").map(Number);
  return hours * 60 + minutes;
}

export function israelWeekdayAndMinutes(date: Date | string): {
  day: Weekday;
  minutes: number;
} {
  const instant = typeof date === "string" ? new Date(date) : date;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Jerusalem",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const weekdayMap: Record<string, Weekday> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const day = weekdayMap[parts.weekday] ?? 0;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return { day, minutes };
}

/** True when the department is open for inbound calls at this instant. */
export function isWithinBusinessHours(
  startedAt: string | Date,
  schedule: DaySchedule[],
): boolean {
  if (!schedule.length) return true;
  const { day, minutes } = israelWeekdayAndMinutes(startedAt);
  const daySchedule = schedule.find((item) => item.day === day);
  if (!daySchedule || !daySchedule.isOpen) return false;
  const open = timeToMinutes(daySchedule.open);
  const close = timeToMinutes(daySchedule.close);
  if (close <= open) {
    // Overnight window (rare): open through midnight then until close.
    return minutes >= open || minutes < close;
  }
  return minutes >= open && minutes < close;
}

/**
 * After-hours inbound call for routing.
 * Outbound never counts as after-hours.
 * When feature is disabled, always false.
 * Departments without a usable schedule are treated as always open.
 */
export function isAfterHoursInboundCall(
  call: Pick<CallRecord, "direction" | "departmentId" | "startedAt">,
  config: BusinessHoursConfig | null | undefined,
): boolean {
  if (!config?.enabled) return false;
  if (call.direction !== "inbound") return false;
  if (!call.departmentId) return false;

  const department = config.departments.find(
    (item) => item.departmentId === call.departmentId,
  );
  if (!department) return false;

  const hasConfiguredOpenDay = department.schedule.some((day) => day.isOpen);
  if (!hasConfiguredOpenDay) return false;

  return !isWithinBusinessHours(call.startedAt, department.schedule);
}

export function splitCallsByBusinessHours<T extends CallRecord>(
  calls: T[],
  config: BusinessHoursConfig | null | undefined,
): { business: T[]; afterHours: T[] } {
  if (!config?.enabled) {
    return { business: calls, afterHours: [] };
  }
  const business: T[] = [];
  const afterHours: T[] = [];
  calls.forEach((call) => {
    if (isAfterHoursInboundCall(call, config)) afterHours.push(call);
    else business.push(call);
  });
  return { business, afterHours };
}
