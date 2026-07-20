import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  defaultWeekSchedule,
  normalizeSchedule,
  type BusinessHoursConfig,
} from "@/lib/business-hours";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const daySchema = z.object({
  day: z.number().int().min(0).max(6),
  isOpen: z.boolean(),
  open: z.string().regex(/^\d{2}:\d{2}$/),
  close: z.string().regex(/^\d{2}:\d{2}$/),
});

const saveSchema = z.object({
  enabled: z.boolean(),
  departments: z.array(
    z.object({
      departmentId: z.string().min(1),
      schedule: z.array(daySchema).min(7).max(7),
    }),
  ),
});

async function loadConfig(): Promise<BusinessHoursConfig> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
    });
  }

  const [flagResult, hoursResult, departmentsResult] = await Promise.all([
    supabase
      .from("app_feature_flags")
      .select("enabled")
      .eq("key", "after_hours_routing")
      .maybeSingle(),
    supabase
      .from("department_business_hours")
      .select("department_id, schedule"),
    supabase
      .from("departments")
      .select("id, name")
      .eq("active", true)
      .order("name"),
  ]);

  if (flagResult.error || hoursResult.error || departmentsResult.error) {
    throw new Response(
      JSON.stringify({
        error:
          flagResult.error?.message ??
          hoursResult.error?.message ??
          departmentsResult.error?.message ??
          "load_failed",
      }),
      { status: 500 },
    );
  }

  const hoursByDept = new Map(
    (hoursResult.data ?? []).map((row) => [
      row.department_id as string,
      normalizeSchedule(row.schedule),
    ]),
  );

  return {
    enabled: Boolean(flagResult.data?.enabled),
    departments: (departmentsResult.data ?? []).map((department) => ({
      departmentId: department.id,
      departmentName: department.name,
      schedule: hoursByDept.get(department.id) ?? defaultWeekSchedule(),
    })),
  };
}

export async function GET() {
  try {
    const config = await loadConfig();
    return NextResponse.json(config);
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = saveSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const { error: flagError } = await supabase.from("app_feature_flags").upsert(
    {
      key: "after_hours_routing",
      enabled: parsed.data.enabled,
      updated_at: now,
      updated_by: user.id,
    },
    { onConflict: "key" },
  );
  if (flagError) {
    return NextResponse.json({ error: flagError.message }, { status: 500 });
  }

  for (const department of parsed.data.departments) {
    const { error } = await supabase.from("department_business_hours").upsert(
      {
        department_id: department.departmentId,
        schedule: normalizeSchedule(department.schedule),
        updated_at: now,
        updated_by: user.id,
      },
      { onConflict: "department_id" },
    );
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  try {
    const config = await loadConfig();
    return NextResponse.json(config);
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "reload_failed" }, { status: 500 });
  }
}
