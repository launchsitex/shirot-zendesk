import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AGENT_ROLES } from "@/lib/agent-roles";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, must-revalidate" };

const roleSchema = z.object({
  agentId: z.string().trim().min(1),
  role: z.enum(AGENT_ROLES),
});

/**
 * Sets an agent's job role (see src/lib/agent-roles.ts). Admins only — the
 * "admins update agents" RLS policy enforces the same on the database side,
 * so this check is about a clear 403 rather than a confusing empty update.
 */
export async function PATCH(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: "unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") {
    return NextResponse.json(
      { error: "forbidden" },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  const parsed = roleSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_body" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const { data, error } = await supabase
    .from("agents")
    .update({ role: parsed.data.role })
    .eq("id", parsed.data.agentId)
    .select("id,role")
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { error: "agent_role_update_failed", details: error.message },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
  if (!data) {
    return NextResponse.json(
      { error: "agent_not_found" },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json({ ok: true, agentId: data.id, role: data.role }, { headers: NO_STORE_HEADERS });
}
