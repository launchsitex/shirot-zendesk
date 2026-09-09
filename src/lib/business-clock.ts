import { WEEKDAY_LABELS, type DaySchedule, type Weekday } from "@/lib/business-hours";
import { israelHolidayOn } from "@/lib/israel-holidays";
import { formatIsraelDate, jerusalemInstant } from "@/lib/israel-time";

/**
 * The "business clock" behind every WhatsApp duration: a clock that only
 * runs inside the department's business hours (Israel time) and stands
 * still outside them. A customer handed to the agents at 14:58 and answered
 * at 08:03 the next morning waited five minutes, not seventeen hours — the
 * agents were not at work in between, so that time cannot be held against
 * them. The schedule is the one the admin keeps in settings
 * ([[business-hours]]); `null` means no schedule, and the wall clock is used.
 * Israeli holidays and their eves ([[israel-holidays]]) count as closed days
 * whatever the weekly schedule says.
 */
export type BusinessClock = DaySchedule[] | null;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Guard against runaway loops on absurd ranges (a year is plenty). */
const MAX_DAYS = 400;

/** A schedule with no open day cannot measure anything: fall back to wall time. */
export function hasOpenDays(schedule: DaySchedule[] | null | undefined): boolean {
  return Boolean(schedule?.some((day) => day.isOpen));
}

export function businessClockFor(
  schedule: DaySchedule[] | null | undefined,
): BusinessClock {
  return hasOpenDays(schedule) ? schedule! : null;
}

// The open/close instants repeat for every ticket and every tick of the
// live clock; resolving Jerusalem wall time to an instant is the expensive
// part, so remember each one.
const instantCache = new Map<string, number>();

function instantOf(date: string, time: string): number {
  const key = `${date}T${time}`;
  const cached = instantCache.get(key);
  if (cached != null) return cached;
  if (instantCache.size > 4000) instantCache.clear();
  const value = Date.parse(jerusalemInstant(date, time));
  instantCache.set(key, value);
  return value;
}

/** YYYY-MM-DD of the calendar day `days` after `date` (also YYYY-MM-DD). */
function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

function weekdayOf(date: string): Weekday {
  return new Date(`${date}T12:00:00Z`).getUTCDay() as Weekday;
}

/**
 * Seconds between `from` and `to` that fall inside the schedule's open
 * windows; plain elapsed seconds when there is no usable schedule. Never
 * negative: a `to` before `from` is zero.
 */
export function businessSecondsBetween(
  from: string | Date,
  to: string | Date,
  clock: BusinessClock,
): number {
  const fromMs = typeof from === "string" ? Date.parse(from) : from.getTime();
  const toMs = typeof to === "string" ? Date.parse(to) : to.getTime();
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || toMs <= fromMs) return 0;
  if (!hasOpenDays(clock)) return Math.floor((toMs - fromMs) / 1000);

  // Start one day early: an overnight window (open 20:00, close 02:00)
  // that began the previous evening can still be running at `from`.
  const lastDay = formatIsraelDate(new Date(toMs));
  let day = shiftDate(formatIsraelDate(new Date(fromMs)), -1);
  let totalMs = 0;
  for (let step = 0; step < MAX_DAYS && day <= lastDay; step += 1) {
    const schedule = clock!.find((item) => item.day === weekdayOf(day));
    if (schedule?.isOpen && !israelHolidayOn(day)) {
      const openMs = instantOf(day, schedule.open);
      let closeMs = instantOf(day, schedule.close);
      if (closeMs <= openMs) closeMs = instantOf(shiftDate(day, 1), schedule.close);
      const overlap = Math.min(toMs, closeMs) - Math.max(fromMs, openMs);
      if (overlap > 0) totalMs += overlap;
    }
    day = shiftDate(day, 1);
  }
  return Math.floor(totalMs / 1000);
}

/**
 * A short Hebrew description of when the clock runs, for the screens'
 * footnotes: "ראשון–חמישי 08:00–15:00", or one entry per day when the hours
 * differ. Null when the wall clock is in use.
 */
export function businessClockLabel(clock: BusinessClock): string | null {
  if (!hasOpenDays(clock)) return null;
  const open = clock!.filter((day) => day.isOpen).sort((a, b) => a.day - b.day);
  const hours = (day: DaySchedule) => `${day.open}–${day.close}`;
  const sameHours = open.every((day) => hours(day) === hours(open[0]));
  const consecutive = open.every(
    (day, index) => index === 0 || day.day === open[index - 1].day + 1,
  );
  if (sameHours && consecutive && open.length > 1) {
    return `${WEEKDAY_LABELS[open[0].day]}–${WEEKDAY_LABELS[open[open.length - 1].day]} ${hours(open[0])}`;
  }
  return open.map((day) => `${WEEKDAY_LABELS[day.day]} ${hours(day)}`).join(", ");
}
