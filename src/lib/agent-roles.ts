/**
 * Job roles for agents, kept on `agents.role` and set by admins in
 * "נציגים וצוותים". The only thing that reads them is "זמינות נציגות" on
 * the WhatsApp screens, which groups answering agents first and everyone
 * else after — tickets, waiting lists and pay figures ignore the role and
 * stay with whoever handled the conversation.
 *
 * The order here is the display order. `inactive` is for people who left:
 * they sit in the last group until a replacement arrives and gets a role.
 * Adding a role means adding it here and to the CHECK constraint in
 * supabase/migrations/20260910100000_agent_roles.sql.
 */
export const AGENT_ROLES = [
  "agent",
  "branches",
  "retention",
  "shift_lead",
  "coordinator",
  "manager",
  "inactive",
] as const;

export type AgentRole = (typeof AGENT_ROLES)[number];

export const AGENT_ROLE_LABELS: Record<AgentRole, string> = {
  agent: "נציגת מענה",
  branches: "נציגת סניפים",
  retention: "שימור לקוחות",
  shift_lead: "אחמ\"שית",
  coordinator: "מתאמת",
  manager: "מנהלת",
  inactive: "לא עובד/ת",
};

/** Plural group headings for the availability boxes. */
export const AGENT_ROLE_GROUP_LABELS: Record<AgentRole, string> = {
  agent: "נציגות מענה",
  branches: "נציגות סניפים",
  retention: "שימור לקוחות",
  shift_lead: "אחמ\"שיות",
  coordinator: "מתאמות",
  manager: "מנהלות",
  inactive: "לא עובדות",
};

export function isAgentRole(value: unknown): value is AgentRole {
  return typeof value === "string" && (AGENT_ROLES as readonly string[]).includes(value);
}

/** Anything unknown (old rows, a bad value) reads as an answering agent. */
export function normalizeAgentRole(value: unknown): AgentRole {
  return isAgentRole(value) ? value : "agent";
}

export function agentRoleLabel(role: AgentRole): string {
  return AGENT_ROLE_LABELS[role];
}
