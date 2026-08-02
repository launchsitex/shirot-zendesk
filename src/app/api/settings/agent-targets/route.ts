import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const targetsSchema = z.object({
  targets: z
    .array(
      z.object({
        agentId: z.string().trim().min(1),
        departmentId: z.string().trim().min(1),
        // null clears the target for that agent/department pair.
        target: z.number().int().min(0).max(10_000).nullable(),
      }),
    )
    .max(2_000),
});

const enabledSchema = z.object({ enabled: z.boolean() });
const addRecipientSchema = z.object({ email: z.string().trim().email() });

async function requireAdmin() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      error: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") {
    return {
      error: NextResponse.json({ error: "forbidden" }, { status: 403 }),
    };
  }

  return { supabase, userId: user.id };
}

async function loadState(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
) {
  const [agents, departments, targets, recipients, settings, sender] =
    await Promise.all([
      supabase
        .from("agents")
        .select("id,name,department_id")
        .eq("active", true)
        .order("name"),
      supabase
        .from("departments")
        .select("id,name")
        .eq("active", true)
        .order("name"),
      supabase
        .from("agent_call_targets")
        .select("agent_id,department_id,daily_inbound_target"),
      supabase
        .from("agent_target_report_recipients")
        .select("id,email")
        .order("created_at", { ascending: true }),
      supabase
        .from("agent_target_report_settings")
        .select("enabled,send_local_time,last_sent_on")
        .eq("id", 1)
        .maybeSingle(),
      // The report reuses the sender address already verified in Resend for the
      // missed-call alerts, so there is one place to configure it.
      supabase
        .from("missed_call_notification_settings")
        .select("from_email")
        .eq("id", 1)
        .maybeSingle(),
    ]);

  const failure =
    agents.error ??
    departments.error ??
    targets.error ??
    recipients.error ??
    settings.error;
  if (failure) throw new Error(failure.message);

  return {
    agents: (agents.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      departmentId: row.department_id,
    })),
    departments: departments.data ?? [],
    targets: (targets.data ?? []).map((row) => ({
      agentId: row.agent_id,
      departmentId: row.department_id,
      target: row.daily_inbound_target,
    })),
    recipients: recipients.data ?? [],
    enabled: settings.data?.enabled ?? true,
    sendLocalTime: String(settings.data?.send_local_time ?? "15:30").slice(0, 5),
    lastSentOn: settings.data?.last_sent_on ?? null,
    fromEmail: sender.data?.from_email ?? "",
  };
}

export async function GET() {
  const session = await requireAdmin();
  if ("error" in session) return session.error;
  try {
    return NextResponse.json(await loadState(session.supabase));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "load_failed" },
      { status: 500 },
    );
  }
}

/** Bulk-save the edited target cells. */
export async function PUT(request: NextRequest) {
  const session = await requireAdmin();
  if ("error" in session) return session.error;

  const parsed = targetsSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const cleared = parsed.data.targets.filter((row) => row.target === null);
  const set = parsed.data.targets.filter(
    (row): row is typeof row & { target: number } => row.target !== null,
  );

  // An emptied cell means "no target", which is the absence of a row rather
  // than a zero — zero is a legitimate target of "take no inbound calls".
  for (const row of cleared) {
    const { error } = await session.supabase
      .from("agent_call_targets")
      .delete()
      .eq("agent_id", row.agentId)
      .eq("department_id", row.departmentId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  if (set.length) {
    const { error } = await session.supabase.from("agent_call_targets").upsert(
      set.map((row) => ({
        agent_id: row.agentId,
        department_id: row.departmentId,
        daily_inbound_target: row.target,
        updated_at: new Date().toISOString(),
        updated_by: session.userId,
      })),
      { onConflict: "agent_id,department_id" },
    );
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  try {
    return NextResponse.json(await loadState(session.supabase));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "reload_failed" },
      { status: 500 },
    );
  }
}

/** Turn the daily email on or off. */
export async function PATCH(request: NextRequest) {
  const session = await requireAdmin();
  if ("error" in session) return session.error;

  const parsed = enabledSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const { error } = await session.supabase
    .from("agent_target_report_settings")
    .upsert(
      {
        id: 1,
        enabled: parsed.data.enabled,
        updated_at: new Date().toISOString(),
        updated_by: session.userId,
      },
      { onConflict: "id" },
    );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  try {
    return NextResponse.json(await loadState(session.supabase));
  } catch (reloadError) {
    return NextResponse.json(
      {
        error:
          reloadError instanceof Error ? reloadError.message : "reload_failed",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if ("error" in session) return session.error;

  const parsed = addRecipientSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const { error } = await session.supabase
    .from("agent_target_report_recipients")
    .insert({ email: parsed.data.email, created_by: session.userId });
  if (error) {
    return NextResponse.json(
      {
        error:
          error.code === "23505" ? "כתובת המייל כבר ברשימה" : error.message,
      },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await loadState(session.supabase));
  } catch (reloadError) {
    return NextResponse.json(
      {
        error:
          reloadError instanceof Error ? reloadError.message : "reload_failed",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const session = await requireAdmin();
  if ("error" in session) return session.error;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id_required" }, { status: 400 });
  }

  const { error } = await session.supabase
    .from("agent_target_report_recipients")
    .delete()
    .eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  try {
    return NextResponse.json(await loadState(session.supabase));
  } catch (reloadError) {
    return NextResponse.json(
      {
        error:
          reloadError instanceof Error ? reloadError.message : "reload_failed",
      },
      { status: 500 },
    );
  }
}
