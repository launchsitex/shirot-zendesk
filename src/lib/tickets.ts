/**
 * Vocabulary for "מעקב פניות" — Zendesk tickets shown next to the call data.
 */

export type TicketStatus =
  | "new"
  | "open"
  | "pending"
  | "hold"
  | "solved"
  | "closed"
  | string;

export type TicketRow = {
  id: string;
  subject: string | null;
  status: TicketStatus;
  customerName: string | null;
  customerPhone: string | null;
  agentId: string | null;
  agentName: string | null;
  departmentName: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TicketsPayload = {
  from: string;
  to: string;
  rows: TicketRow[];
  truncated: boolean;
  syncedAt: string | null;
};

/**
 * Zendesk's own wording: solved and closed are finished, everything else is
 * still on somebody's plate. "solved" is included because an agent who solved a
 * ticket has done the work — Zendesk only flips it to "closed" automatically,
 * days later, and counting solved as open would make every agent look behind.
 */
export const CLOSED_STATUSES = new Set(["solved", "closed"]);

export function isClosed(status: TicketStatus): boolean {
  return CLOSED_STATUSES.has(status);
}

export const STATUS_LABELS: Record<string, string> = {
  new: "חדשה",
  open: "פתוחה",
  pending: "ממתינה ללקוח",
  hold: "בהמתנה",
  solved: "נפתרה",
  closed: "סגורה",
};

export function statusLabel(status: TicketStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export type AgentTicketSummary = {
  agentId: string | null;
  agentName: string;
  departmentName: string | null;
  open: number;
  closed: number;
  total: number;
};

/** Per-agent open/closed counts, busiest first. */
export function summariseByAgent(rows: TicketRow[]): AgentTicketSummary[] {
  const byAgent = new Map<string, AgentTicketSummary>();

  for (const row of rows) {
    // Tickets nobody was assigned still need somewhere to land, otherwise the
    // per-agent totals silently disagree with the ticket list.
    const key = row.agentId ?? `unassigned:${row.agentName ?? ""}`;
    let entry = byAgent.get(key);
    if (!entry) {
      entry = {
        agentId: row.agentId,
        agentName: row.agentName ?? "ללא שיוך נציג",
        departmentName: row.departmentName,
        open: 0,
        closed: 0,
        total: 0,
      };
      byAgent.set(key, entry);
    }
    entry.total += 1;
    if (isClosed(row.status)) entry.closed += 1;
    else entry.open += 1;
  }

  return [...byAgent.values()].sort(
    (a, b) => b.total - a.total || a.agentName.localeCompare(b.agentName, "he"),
  );
}

/** Israeli numbers arrive in several shapes; show them consistently. */
export function formatPhone(phone: string | null): string {
  if (!phone) return "—";
  const digits = phone.replace(/\D/g, "");
  const local = digits.startsWith("972") ? `0${digits.slice(3)}` : digits;
  if (local.length === 10) {
    return `${local.slice(0, 3)}-${local.slice(3, 6)}-${local.slice(6)}`;
  }
  if (local.length === 9) {
    return `${local.slice(0, 2)}-${local.slice(2, 5)}-${local.slice(5)}`;
  }
  return phone;
}
