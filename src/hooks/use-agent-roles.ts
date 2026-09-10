"use client";

import { useEffect, useState } from "react";
import { FALLBACK_AGENT_ROLES, type AgentRoleDef } from "@/lib/agent-roles";

/**
 * The agent job roles from Settings, for any screen that names or lists
 * them. Starts with the seeded list so nothing renders empty while loading.
 */
export function useAgentRoles() {
  const [roles, setRoles] = useState<AgentRoleDef[]>(FALLBACK_AGENT_ROLES);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/settings/agent-roles", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json()) as { roles?: AgentRoleDef[] };
        if (payload.roles?.length) setRoles(payload.roles);
        setLoaded(true);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  return { roles, loaded };
}
