import { NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/supabase/server";

async function requireAdminSession() {
  if (!isSupabaseConfigured()) {
    return {
      error: NextResponse.json({ error: "Supabase אינו מחובר" }, { status: 400 }),
    };
  }

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
      error: NextResponse.json({ error: "נדרשת הרשאת מנהל" }, { status: 403 }),
    };
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    return {
      error: NextResponse.json({ error: "אין סשן פעיל" }, { status: 401 }),
    };
  }

  return { supabase, accessToken: session.access_token };
}

async function callAdminUsers(
  accessToken: string,
  init: RequestInit & { searchParams?: Record<string, string> },
) {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const url = new URL(`${baseUrl}/functions/v1/admin-users`);
  if (init.searchParams) {
    for (const [key, value] of Object.entries(init.searchParams)) {
      url.searchParams.set(key, value);
    }
  }

  const { searchParams: _searchParams, ...requestInit } = init;
  const response = await fetch(url, {
    ...requestInit,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      "Content-Type": "application/json",
      ...(requestInit.headers ?? {}),
    },
    cache: "no-store",
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    return NextResponse.json(
      { error: result.error ?? "פעולת המשתמשים נכשלה" },
      { status: response.status },
    );
  }
  return NextResponse.json(result);
}

export async function GET() {
  const session = await requireAdminSession();
  if ("error" in session && session.error) return session.error;
  return callAdminUsers(session.accessToken!, { method: "GET" });
}

export async function POST(request: Request) {
  const session = await requireAdminSession();
  if ("error" in session && session.error) return session.error;
  const body = await request.json();
  return callAdminUsers(session.accessToken!, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function PATCH(request: Request) {
  const session = await requireAdminSession();
  if ("error" in session && session.error) return session.error;
  const body = await request.json();
  const id = String(body.id ?? "");
  if (!id) {
    return NextResponse.json({ error: "חסר מזהה משתמש" }, { status: 400 });
  }
  const { id: _id, ...payload } = body;
  return callAdminUsers(session.accessToken!, {
    method: "PATCH",
    searchParams: { id },
    body: JSON.stringify(payload),
  });
}

export async function DELETE(request: Request) {
  const session = await requireAdminSession();
  if ("error" in session && session.error) return session.error;
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "חסר מזהה משתמש" }, { status: 400 });
  }
  return callAdminUsers(session.accessToken!, {
    method: "DELETE",
    searchParams: { id },
  });
}
