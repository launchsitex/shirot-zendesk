const israelDateTime = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jerusalem",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const israelDateOnly = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jerusalem",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function formatIsraelDateTime(iso: string | Date): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return "—";
  const parts = Object.fromEntries(
    israelDateTime
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export function formatIsraelDate(iso: string | Date): string {
  const date = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(date.getTime())) return "—";
  return israelDateOnly.format(date);
}

/** Inclusive Jerusalem calendar-day bounds as UTC ISO strings. */
export function jerusalemDayBounds(date: string, endOfDay = false): string {
  const time = endOfDay ? "23:59:59.999" : "00:00:00.000";
  const wallClockUtc = Date.parse(`${date}T${time}Z`);
  let instant = wallClockUtc;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  for (let pass = 0; pass < 2; pass += 1) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(instant))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, Number(part.value)]),
    );
    const representedAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    instant = wallClockUtc - (representedAsUtc - instant);
  }

  return new Date(instant).toISOString();
}

export function formatDurationSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

export const AGENT_STATE_LABELS: Record<string, string> = {
  available: "זמין",
  ringing: "מצלצל",
  on_call: "בשיחה",
  wrap_up: "סיכום שיחה",
  scheduled: "לפי לוח זמנים",
  out_for_lunch: "יצא לארוחת צהריים",
  on_break: "בהפסקה",
  in_training: "בהדרכה",
  back_office: "עבודה משרדית",
  other: "אחר",
  unavailable: "לא זמין",
};

/** Exact English labels as shown in the Aircall availability menu. */
export const AGENT_STATE_AIRCALL_EN: Record<string, string> = {
  available: "Available",
  ringing: "Ringing",
  on_call: "In call",
  wrap_up: "After Call Work",
  scheduled: "Scheduled",
  out_for_lunch: "Out for lunch",
  on_break: "On a break",
  in_training: "In training",
  back_office: "Back office",
  other: "Other",
  unavailable: "Unavailable",
};

const AIRCALL_SOURCE_EN: Record<string, string> = {
  always_open: "Available",
  always_opened: "Available",
  available: "Available",
  according_to_schedule: "Scheduled",
  scheduled: "Scheduled",
  out_for_lunch: "Out for lunch",
  lunch: "Out for lunch",
  on_a_break: "On a break",
  on_break: "On a break",
  break: "On a break",
  in_training: "In training",
  training: "In training",
  doing_back_office: "Back office",
  back_office: "Back office",
  other: "Other",
  always_closed: "Unavailable",
  unavailable: "Unavailable",
  ringing: "Ringing",
  on_call: "In call",
  in_call: "In call",
  wrap_up: "After Call Work",
  after_call_work: "After Call Work",
  custom: "Available",
};

function aircallEnglishFromSource(sourceEvent?: string | null): string | null {
  if (!sourceEvent?.trim()) return null;
  const key = sourceEvent.trim().toLowerCase();
  if (AIRCALL_SOURCE_EN[key]) return AIRCALL_SOURCE_EN[key];
  // Skip webhook event names like call.answered / user.wut_start
  if (key.includes(".")) return null;
  return key
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Hebrew label with canonical Aircall English name in parentheses. */
export function formatAgentStateLabel(
  state: string,
  sourceEvent?: string | null,
): string {
  const hebrew = AGENT_STATE_LABELS[state] ?? state;
  // Prefer the mapped system state name (Status) over noisy webhook source strings.
  const english =
    AGENT_STATE_AIRCALL_EN[state] ??
    aircallEnglishFromSource(sourceEvent) ??
    state;
  return `${hebrew} (${english})`;
}
