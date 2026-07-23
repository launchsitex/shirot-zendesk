import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const fromEmailSchema = z.object({
  fromEmail: z.string().trim().email(),
});

const addRecipientSchema = z.object({
  email: z.string().trim().email(),
});

async function loadState() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    throw new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
    });
  }

  const [{ data: settings, error: settingsError }, { data: recipients, error: recipientsError }] =
    await Promise.all([
      supabase
        .from("missed_call_notification_settings")
        .select("from_email")
        .eq("id", 1)
        .maybeSingle(),
      supabase
        .from("missed_call_notification_recipients")
        .select("id,email")
        .order("created_at", { ascending: true }),
    ]);

  if (settingsError || recipientsError) {
    throw new Response(
      JSON.stringify({
        error: (settingsError ?? recipientsError)?.message,
      }),
      { status: 500 },
    );
  }

  return {
    fromEmail: settings?.from_email ?? "",
    recipients: recipients ?? [],
  };
}

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

export async function GET() {
  try {
    const result = await loadState();
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "load_failed" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const session = await requireAdmin();
  if ("error" in session) return session.error;

  const parsed = fromEmailSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { error: upsertError } = await session.supabase
    .from("missed_call_notification_settings")
    .upsert(
      {
        id: 1,
        from_email: parsed.data.fromEmail,
        updated_at: new Date().toISOString(),
        updated_by: session.userId,
      },
      { onConflict: "id" },
    );
  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  try {
    return NextResponse.json(await loadState());
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "reload_failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if ("error" in session) return session.error;

  const parsed = addRecipientSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { error: insertError } = await session.supabase
    .from("missed_call_notification_recipients")
    .insert({
      email: parsed.data.email,
      created_by: session.userId,
    });
  if (insertError) {
    const message =
      insertError.code === "23505" ? "כתובת המייל כבר ברשימה" : insertError.message;
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    return NextResponse.json(await loadState());
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "reload_failed" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const session = await requireAdmin();
  if ("error" in session) return session.error;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id_required" }, { status: 400 });
  }

  const { error: deleteError } = await session.supabase
    .from("missed_call_notification_recipients")
    .delete()
    .eq("id", id);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  try {
    return NextResponse.json(await loadState());
  } catch (error) {
    if (error instanceof Response) return error;
    return NextResponse.json({ error: "reload_failed" }, { status: 500 });
  }
}
