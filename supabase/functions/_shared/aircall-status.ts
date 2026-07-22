/**
 * Loosely-typed on purpose: the webhook payload's user object (a raw
 * Record<string, unknown>) and the Aircall REST Users API's AircallUser
 * interface use slightly different field names for the same data (the REST
 * API reports substatus under `state`, not `substatus`) — both must
 * structurally satisfy this shape.
 */
type MappableAircallUser = {
  substatus?: unknown;
  state?: unknown;
  availability_status?: unknown;
  status?: unknown;
  available?: unknown;
};

/**
 * Single canonical translation of an Aircall user's substatus/availability
 * into our internal agent_state. Used by both the real-time webhook
 * (aircall-webhook) and the 1-minute roster-sync cron (sync-aircall-users) —
 * they must always agree, or the cron will keep re-imposing a different
 * value than the webhook every minute regardless of what actually happened.
 *
 * An unrecognized/organization-custom substatus (Aircall's "custom"
 * availability_status with no matching substatus key) maps to "other" rather
 * than "available" or "scheduled" — it should read honestly as a non-standard
 * away state, not be guessed into either bucket.
 */
export function mapAvailability(user: MappableAircallUser): string {
  const substatus = String(user.substatus ?? user.state ?? "")
    .trim()
    .toLowerCase();
  const substatusStates: Record<string, string> = {
    always_open: "available",
    always_opened: "available",
    available: "available",
    according_to_schedule: "scheduled",
    scheduled: "scheduled",
    out_for_lunch: "out_for_lunch",
    lunch: "out_for_lunch",
    on_a_break: "on_break",
    on_break: "on_break",
    break: "on_break",
    in_training: "in_training",
    training: "in_training",
    doing_back_office: "back_office",
    back_office: "back_office",
    other: "other",
    always_closed: "unavailable",
    unavailable: "unavailable",
  };
  if (substatusStates[substatus]) return substatusStates[substatus];

  const availability = String(
    user.availability_status ?? user.status ?? user.available ?? "",
  ).toLowerCase();
  if (availability === "available" || availability === "true") {
    return "available";
  }
  if (availability === "custom") return "other";
  if (availability === "in_call") return "on_call";
  if (availability === "after_call_work") return "wrap_up";
  return "unavailable";
}
