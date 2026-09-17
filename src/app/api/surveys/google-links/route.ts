import { NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/access";
import { canAccessPage } from "@/lib/app-pages";

async function requireAccess() {
  if (!isSupabaseConfigured()) {
    return { error: NextResponse.json({ error: "Supabase אינו מחובר" }, { status: 400 }) };
  }
  const profile = await getCurrentProfile();
  if (!profile || !canAccessPage(profile, "surveys-reviews")) {
    return { error: NextResponse.json({ error: "אין הרשאה" }, { status: 403 }) };
  }
  return { profile };
}

export async function GET() {
  const auth = await requireAccess();
  if (auth.error) return auth.error;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("survey_google_review_links")
    .select("branch_id, url, survey_branches!branch_id(name)")
    .order("branch_id");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type LinkRow = {
    branch_id: string;
    url: string;
    survey_branches: { name: string } | { name: string }[] | null;
  };

  const links = ((data ?? []) as LinkRow[]).map((row) => ({
    branchId: row.branch_id,
    url: row.url,
    branchName: Array.isArray(row.survey_branches)
      ? (row.survey_branches[0]?.name ?? row.branch_id)
      : (row.survey_branches?.name ?? row.branch_id),
  }));

  return NextResponse.json({ links });
}

export async function PATCH(request: Request) {
  const auth = await requireAccess();
  if (auth.error) return auth.error;

  const body = await request.json().catch(() => null);
  const branchId = body?.branchId;
  const url = body?.url;
  if (typeof branchId !== "string" || typeof url !== "string") {
    return NextResponse.json({ error: "נתונים לא תקינים" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("survey_google_review_links")
    .update({ url: url.trim() })
    .eq("branch_id", branchId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
