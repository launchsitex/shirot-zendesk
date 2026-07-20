import { NextRequest, NextResponse } from "next/server";
import { getDepartmentScope } from "@/lib/auth/department-scope";
import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "recording_unavailable_in_demo" },
      { status: 404 },
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) {
    return NextResponse.json({ error: "session_expired" }, { status: 401 });
  }

  const { id } = await context.params;

  const departmentScope = await getDepartmentScope(supabase, user.id);
  if (departmentScope) {
    const { data: recording, error } = await supabase
      .from("call_recordings")
      .select("id, calls(department_id)")
      .eq("id", id)
      .maybeSingle();
    if (error || !recording) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const call = recording.calls as unknown as {
      department_id: string | null;
    } | null;
    if (call?.department_id !== departmentScope) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }

  const headers: HeadersInit = {
    Authorization: `Bearer ${session.access_token}`,
  };
  const range = request.headers.get("range");
  if (range) headers.Range = range;

  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/stream-recording?id=${encodeURIComponent(id)}`,
    {
      headers,
      cache: "no-store",
    },
  );

  const responseHeaders = new Headers();
  for (const name of [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
  ]) {
    const value = response.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  responseHeaders.set("Cache-Control", "private, no-store");

  return new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
}
