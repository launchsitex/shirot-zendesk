/**
 * Israeli public holidays on which the call center is closed, computed from
 * the Hebrew calendar (via Intl, no library) so no yearly table needs
 * maintaining. The account owner's rule: closed on every holiday and on the
 * eve of each of the Torah holidays, on top of Fridays and Saturdays, which
 * the weekly schedule already handles ([[business-hours]]).
 *
 * Included: Rosh Hashana (both days), Yom Kippur, first day of Sukkot,
 * Shemini Atzeret / Simchat Torah, first and seventh days of Pesach, Shavuot
 * — each with its eve — and Independence Day (no eve; it follows the
 * official Sunday/Tuesday/Thursday shifts). Chol HaMoed, Purim, Memorial Day
 * and other working days are not included.
 */

type HebrewDate = { month: string; day: number };

const hebrewFormatter = new Intl.DateTimeFormat("en-u-ca-hebrew", {
  timeZone: "Asia/Jerusalem",
  month: "long",
  day: "numeric",
});

const DAY_MS = 24 * 60 * 60 * 1000;

function hebrewDateOf(date: string): HebrewDate {
  const parts = hebrewFormatter.formatToParts(new Date(`${date}T12:00:00Z`));
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const day = Number(parts.find((part) => part.type === "day")?.value ?? 0);
  return { month, day };
}

function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

function nextDate(date: string): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
}

/** Holidays whose eve is also a day off, keyed "<month>-<day>". */
const HOLIDAYS_WITH_EVE: Record<string, string> = {
  "Tishri-1": "ראש השנה",
  "Tishri-2": "ראש השנה",
  "Tishri-10": "יום כיפור",
  "Tishri-15": "סוכות",
  "Tishri-22": "שמחת תורה",
  "Nisan-15": "פסח",
  "Nisan-21": "שביעי של פסח",
  "Sivan-6": "שבועות",
};

function holidayByHebrewDate({ month, day }: HebrewDate): string | null {
  return HOLIDAYS_WITH_EVE[`${month}-${day}`] ?? null;
}

/**
 * Independence Day is 5 Iyar, moved so it never falls next to Shabbat: a
 * Friday or Saturday 5 Iyar is observed the Thursday before, a Monday is
 * observed on Tuesday.
 */
function isIndependenceDay(hebrew: HebrewDate, weekday: number): boolean {
  if (hebrew.month !== "Iyar") return false;
  if (hebrew.day === 5 && weekday === 3) return true; // Wednesday, unmoved
  if (hebrew.day === 4 && weekday === 4) return true; // 5 Iyar on Friday
  if (hebrew.day === 3 && weekday === 4) return true; // 5 Iyar on Saturday
  if (hebrew.day === 6 && weekday === 2) return true; // 5 Iyar on Monday
  return false;
}

const cache = new Map<string, string | null>();

/**
 * The name of the holiday (or holiday eve) closing the business on this
 * Israel calendar date (YYYY-MM-DD), or null on a working day. Fridays and
 * Saturdays are not the concern here — the weekly schedule covers them.
 */
export function israelHolidayOn(date: string): string | null {
  const cached = cache.get(date);
  if (cached !== undefined) return cached;
  if (cache.size > 2000) cache.clear();

  const hebrew = hebrewDateOf(date);
  let result = holidayByHebrewDate(hebrew);
  if (!result && isIndependenceDay(hebrew, weekdayOf(date))) result = "יום העצמאות";
  if (!result) {
    const tomorrow = holidayByHebrewDate(hebrewDateOf(nextDate(date)));
    if (tomorrow) result = `ערב ${tomorrow}`;
  }
  cache.set(date, result);
  return result;
}
