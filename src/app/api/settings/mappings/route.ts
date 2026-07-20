import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/supabase/server";

const mappingSchema = z.object({
  groupMappings: z.array(
    z.object({ groupId: z.string().min(1), departmentId: z.string().min(1) }),
  ),
  lineMappings: z.array(
    z.object({ lineId: z.string().min(1), departmentId: z.string().min(1) }),
  ),
});

async function requireAdmin() {
  if (!isSupabaseConfigured()) {
    return { error: "Supabase אינו מחובר", status: 400 } as const;
  }
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "unauthorized", status: 401 } as const;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") {
    return { error: "נדרשת הרשאת מנהל", status: 403 } as const;
  }
  return { supabase } as const;
}

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({
      departments: [],
      groups: [],
      lines: [],
      groupMappings: [],
      lineMappings: [],
      demo: true,
    });
  }
  const access = await requireAdmin();
  if ("error" in access) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  }
  const [departments, groups, lines, groupMappings, lineMappings] =
    await Promise.all([
      access.supabase.from("departments").select("id,name").eq("active", true),
      access.supabase.from("zendesk_groups").select("id,name").eq("active", true),
      access.supabase.from("talk_lines").select("id,name,number").eq("active", true),
      access.supabase.from("department_groups").select("department_id,group_id"),
      access.supabase.from("department_lines").select("department_id,line_id"),
    ]);
  const error =
    departments.error ??
    groups.error ??
    lines.error ??
    groupMappings.error ??
    lineMappings.error;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({
    departments: departments.data,
    groups: groups.data,
    lines: lines.data,
    groupMappings: groupMappings.data,
    lineMappings: lineMappings.data,
  });
}

export async function POST(request: NextRequest) {
  const access = await requireAdmin();
  if ("error" in access) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    );
  }
  const parsed = mappingSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "מיפוי לא תקין" }, { status: 400 });
  }
  const { groupMappings, lineMappings } = parsed.data;
  const { error } = await access.supabase.rpc(
    "replace_department_mappings_authenticated",
    {
    p_group_mappings: groupMappings,
    p_line_mappings: lineMappings,
    },
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
