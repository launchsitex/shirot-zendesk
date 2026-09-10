import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  DEFAULT_AGENT_ROLE,
  sortAgentRoles,
  type AgentRoleDef,
} from "@/lib/agent-roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, must-revalidate" };

const labelSchema = z.string().trim().min(1).max(40);
const createSchema = z.object({ label: labelSchema, groupLabel: labelSchema });
const updateSchema = z.union([
  z.object({ id: z.string().min(1), label: labelSchema, groupLabel: labelSchema }),
  // The full list of ids in the wanted order.
  z.object({ order: z.array(z.string().min(1)).min(1).max(100) }),
]);

export type AgentRolesPayload = {
  roles: (AgentRoleDef & { agentCount: number })[];
};

type Supabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

async function requireUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      error: NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE_HEADERS }),
    };
  }
  return { supabase, user };
}

async function requireAdmin() {
  const auth = await requireUser();
  if ("error" in auth) return auth;
  const { data: profile } = await auth.supabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (profile?.role !== "admin") {
    return {
      error: NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE_HEADERS }),
    };
  }
  return auth;
}

/** Roles in display order, each with how many agents currently hold it. */
async function loadRoles(supabase: Supabase): Promise<AgentRolesPayload> {
  const [rolesResult, agentsResult] = await Promise.all([
    supabase.from("agent_roles").select("id,label,group_label,sort_order"),
    supabase.from("agents").select("role"),
  ]);
  if (rolesResult.error) throw new Error(rolesResult.error.message);
  if (agentsResult.error) throw new Error(agentsResult.error.message);
  const counts = new Map<string, number>();
  for (const row of (agentsResult.data ?? []) as { role: string }[]) {
    counts.set(row.role, (counts.get(row.role) ?? 0) + 1);
  }
  const roles = sortAgentRoles(
    ((rolesResult.data ?? []) as {
      id: string;
      label: string;
      group_label: string;
      sort_order: number;
    }[]).map((row) => ({
      id: row.id,
      label: row.label,
      groupLabel: row.group_label,
      sortOrder: row.sort_order,
    })),
  ).map((role) => ({ ...role, agentCount: counts.get(role.id) ?? 0 }));
  return { roles };
}

function respond(payload: AgentRolesPayload) {
  return NextResponse.json(payload, { headers: NO_STORE_HEADERS });
}

function failed(error: unknown, code: string) {
  return NextResponse.json(
    { error: code, details: error instanceof Error ? error.message : String(error) },
    { status: 500, headers: NO_STORE_HEADERS },
  );
}

/** Any signed-in user may read the list (the agents page shows role names). */
export async function GET() {
  const auth = await requireUser();
  if ("error" in auth) return auth.error;
  try {
    return respond(await loadRoles(auth.supabase));
  } catch (error) {
    return failed(error, "agent_roles_load_failed");
  }
}

/** A new role goes to the end of the order; its id is generated once and never shown. */
export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400, headers: NO_STORE_HEADERS });
  }
  try {
    const current = await loadRoles(auth.supabase);
    const sortOrder = Math.max(0, ...current.roles.map((role) => role.sortOrder)) + 10;
    const id = `role_${Date.now().toString(36)}`;
    const { error } = await auth.supabase.from("agent_roles").insert({
      id,
      label: parsed.data.label,
      group_label: parsed.data.groupLabel,
      sort_order: sortOrder,
    });
    if (error) throw new Error(error.message);
    return respond(await loadRoles(auth.supabase));
  } catch (error) {
    return failed(error, "agent_role_create_failed");
  }
}

/** Rename one role, or reorder all of them. */
export async function PATCH(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400, headers: NO_STORE_HEADERS });
  }
  try {
    if ("order" in parsed.data) {
      const updates = parsed.data.order.map((id, index) =>
        auth.supabase
          .from("agent_roles")
          .update({ sort_order: (index + 1) * 10, updated_at: new Date().toISOString() })
          .eq("id", id),
      );
      for (const result of await Promise.all(updates)) {
        if (result.error) throw new Error(result.error.message);
      }
    } else {
      const { error } = await auth.supabase
        .from("agent_roles")
        .update({
          label: parsed.data.label,
          group_label: parsed.data.groupLabel,
          updated_at: new Date().toISOString(),
        })
        .eq("id", parsed.data.id);
      if (error) throw new Error(error.message);
    }
    return respond(await loadRoles(auth.supabase));
  } catch (error) {
    return failed(error, "agent_role_update_failed");
  }
}

/**
 * Delete a role nobody holds. The default role stays: every new agent lands
 * on it. A role still in use answers 409 so the admin moves the agents first.
 */
export async function DELETE(request: NextRequest) {
  const auth = await requireAdmin();
  if ("error" in auth) return auth.error;
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!id) {
    return NextResponse.json({ error: "missing_id" }, { status: 400, headers: NO_STORE_HEADERS });
  }
  if (id === DEFAULT_AGENT_ROLE) {
    return NextResponse.json({ error: "default_role" }, { status: 409, headers: NO_STORE_HEADERS });
  }
  try {
    const current = await loadRoles(auth.supabase);
    const role = current.roles.find((item) => item.id === id);
    if (!role) {
      return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE_HEADERS });
    }
    if (role.agentCount > 0) {
      return NextResponse.json(
        { error: "role_in_use", agentCount: role.agentCount },
        { status: 409, headers: NO_STORE_HEADERS },
      );
    }
    const { error } = await auth.supabase.from("agent_roles").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return respond(await loadRoles(auth.supabase));
  } catch (error) {
    return failed(error, "agent_role_delete_failed");
  }
}
