/**
 * Job roles for agents — data the admin manages in Settings ("תפקידי
 * נציגות", table `agent_roles`), kept on `agents.role`. The only thing that
 * reads them is "זמינות נציגות" on the WhatsApp screens, which groups
 * answering agents first and everyone else after, in the roles' order.
 * Tickets, waiting lists and pay figures ignore the role and stay with
 * whoever handled the conversation.
 *
 * `agent` is the default role of every new agent and cannot be deleted;
 * `answeringAgents` in wa-dashboard.ts is defined by it.
 */
export type AgentRoleDef = {
  id: string;
  /** Singular, for the picker on an agent card ("נציגת מענה"). */
  label: string;
  /** Plural, for the availability group heading ("נציגות מענה"). */
  groupLabel: string;
  sortOrder: number;
};

export const DEFAULT_AGENT_ROLE = "agent";

/**
 * The roles as first seeded, used while the list is still loading and as the
 * name for a role id the list no longer knows (never expected after the FK,
 * but the screens must not crash on it).
 */
export const FALLBACK_AGENT_ROLES: AgentRoleDef[] = [
  { id: "agent", label: "נציגת מענה", groupLabel: "נציגות מענה", sortOrder: 10 },
  { id: "branches", label: "נציגת סניפים", groupLabel: "נציגות סניפים", sortOrder: 20 },
  { id: "retention", label: "שימור לקוחות", groupLabel: "שימור לקוחות", sortOrder: 30 },
  { id: "shift_lead", label: "אחמ\"שית", groupLabel: "אחמ\"שיות", sortOrder: 40 },
  { id: "coordinator", label: "מתאמת", groupLabel: "מתאמות", sortOrder: 50 },
  { id: "manager", label: "מנהלת", groupLabel: "מנהלות", sortOrder: 60 },
  { id: "inactive", label: "לא עובד/ת", groupLabel: "לא עובדות", sortOrder: 70 },
];

/** Anything unknown (old rows, a bad value) reads as an answering agent. */
export function normalizeAgentRole(value: unknown): string {
  return typeof value === "string" && value.trim() ? value : DEFAULT_AGENT_ROLE;
}

export function sortAgentRoles(roles: AgentRoleDef[]): AgentRoleDef[] {
  return [...roles].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, "he"),
  );
}

export function agentRoleLabel(roles: AgentRoleDef[], id: string): string {
  return (
    roles.find((role) => role.id === id)?.label ??
    FALLBACK_AGENT_ROLES.find((role) => role.id === id)?.label ??
    id
  );
}

export function agentRoleGroupLabel(roles: AgentRoleDef[], id: string): string {
  return (
    roles.find((role) => role.id === id)?.groupLabel ??
    FALLBACK_AGENT_ROLES.find((role) => role.id === id)?.groupLabel ??
    id
  );
}
