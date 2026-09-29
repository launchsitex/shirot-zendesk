export const SALES_TRANSFER_CATEGORIES = [
  "waiting_on_us",
  "in_progress",
  "recently_solved",
  "called_service_line",
  "old_history",
  "no_history",
] as const;

export type SalesTransferCategory = (typeof SALES_TRANSFER_CATEGORIES)[number];

export const CATEGORY_META: Record<
  SalesTransferCategory,
  { label: string; hint: string; tone: string }
> = {
  waiting_on_us: {
    label: "ממתין לתגובה שלנו",
    hint: "כתב בוואטסאפ ועוד לא ענינו לו",
    tone: "bg-[#fdebed] text-[#c8434c]",
  },
  in_progress: {
    label: "בטיפול – ענינו לו",
    hint: "יש פנייה פתוחה וכבר ענינו, ובכל זאת התקשר",
    tone: "bg-[#fff4e0] text-[#a86a00]",
  },
  recently_solved: {
    label: "נסגרה לאחרונה",
    hint: "פנייה נסגרה ב-7 הימים האחרונים והוא חוזר",
    tone: "bg-[#fff4e0] text-[#a86a00]",
  },
  called_service_line: {
    label: "חייג לקו השירות לפני",
    hint: "שמע את ההודעה בקו השירות ועבר למכירות",
    tone: "bg-[#e8f1fb] text-[#2f6db5]",
  },
  old_history: {
    label: "היסטוריה ישנה",
    hint: "פנה אלינו בעבר, לא בשבוע האחרון",
    tone: "bg-[#eef2f3] text-[#5d6d75]",
  },
  no_history: {
    label: "ללא היסטוריה",
    hint: "חייג ישר למכירות בלי שום מגע קודם איתנו",
    tone: "bg-[#eef2f3] text-[#5d6d75]",
  },
};

/** Not included in call-centre reports (agreed with the owner). */
export const EXCLUDED_SALES_AGENTS = ["סנדי", "יונתן ג"];

export type SalesTransferRow = {
  id: string;
  phone: string;
  salesAgent: string | null;
  transferredAt: string;
  isRepeat: boolean;
  category: SalesTransferCategory | null;
  ticketId: string | null;
  ticketDepartment: string | null;
  ticketStatus: string | null;
  customerName: string | null;
  lastCustomerMessageAt: string | null;
  lastAgentMessageAt: string | null;
  calledServiceLineBefore: boolean;
  calledDeliveries24h: boolean;
  waAfterTicketId: string | null;
  waAfterAt: string | null;
};

export type SalesTransferDailyRow = {
  day: string;
  category: SalesTransferCategory | null;
  transfers: number;
  episodes: number;
  customers: number;
};

export type SalesTransfersPayload = {
  date: string;
  rows: SalesTransferRow[];
  daily: SalesTransferDailyRow[];
};

export type CategoryCounts = Record<SalesTransferCategory | "pending", number>;

function emptyCounts(): CategoryCounts {
  return {
    waiting_on_us: 0,
    in_progress: 0,
    recently_solved: 0,
    called_service_line: 0,
    old_history: 0,
    no_history: 0,
    pending: 0,
  };
}

export type SalesAgentSummary = {
  agent: string;
  transfers: number;
  episodes: number;
  byCategory: CategoryCounts;
};

export type SalesTransfersSummary = {
  transfers: number;
  episodes: number;
  customers: number;
  byCategory: CategoryCounts;
  openedWhatsappAfter: number;
  byAgent: SalesAgentSummary[];
};

/**
 * Category counts are per episode: a repeat transfer of the same phone within
 * 30 minutes belongs to the first one and is only counted in `transfers`.
 */
export function summarizeTransfers(rows: SalesTransferRow[]): SalesTransfersSummary {
  const byCategory = emptyCounts();
  const agents = new Map<string, SalesAgentSummary>();
  const phones = new Set<string>();
  let episodes = 0;
  let openedWhatsappAfter = 0;

  for (const row of rows) {
    phones.add(row.phone.replace(/\D/g, "").slice(-9));
    const agentName = row.salesAgent ?? "לא ידוע";
    let agent = agents.get(agentName);
    if (!agent) {
      agent = { agent: agentName, transfers: 0, episodes: 0, byCategory: emptyCounts() };
      agents.set(agentName, agent);
    }
    agent.transfers += 1;
    if (row.isRepeat) continue;

    const key = row.category ?? "pending";
    episodes += 1;
    byCategory[key] += 1;
    agent.episodes += 1;
    agent.byCategory[key] += 1;
    if (row.waAfterTicketId) openedWhatsappAfter += 1;
  }

  return {
    transfers: rows.length,
    episodes,
    customers: phones.size,
    byCategory,
    openedWhatsappAfter,
    byAgent: [...agents.values()].sort(
      (a, b) => b.transfers - a.transfers || a.agent.localeCompare(b.agent, "he"),
    ),
  };
}

/** Minutes the customer had been waiting on our WhatsApp reply at the transfer. */
export function waitingMinutesAtTransfer(row: SalesTransferRow): number | null {
  if (row.category !== "waiting_on_us" || !row.lastCustomerMessageAt) return null;
  const minutes =
    (Date.parse(row.transferredAt) - Date.parse(row.lastCustomerMessageAt)) / 60_000;
  return Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : null;
}

export function percent(part: number, total: number): string {
  if (!total) return "0%";
  return `${Math.round((part / total) * 100)}%`;
}
