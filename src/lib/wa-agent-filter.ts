/**
 * The agent picker shared by "דשבורד WA" and "דשבורד TV WA": which agents a
 * viewer has excluded from every figure on the screen, remembered per
 * department in this browser. Both screens read and write the same key, so a
 * choice made on the dashboard carries over to the TV in the same browser.
 */
const EXCLUDED_AGENTS_KEY = "wa-dashboard:excluded-agents";

/** Rows without an assignee share one picker entry. */
export const UNASSIGNED_AGENT_KEY = "unassigned";

export function agentKey(agentId: string | null | undefined): string {
  return agentId ?? UNASSIGNED_AGENT_KEY;
}

export function readExcludedAgents(departmentId: string): string[] {
  try {
    const raw = window.localStorage.getItem(`${EXCLUDED_AGENTS_KEY}:${departmentId}`);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function writeExcludedAgents(departmentId: string, excluded: string[]): void {
  try {
    window.localStorage.setItem(
      `${EXCLUDED_AGENTS_KEY}:${departmentId}`,
      JSON.stringify(excluded),
    );
  } catch {
    // Storage unavailable — the choice simply lasts until the next visit.
  }
}
