import { NextResponse } from "next/server";
import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/supabase/server";

const recommendedEvents = [
  "call.created",
  "call.ringing_on_agent",
  "call.answered",
  "call.assigned",
  "call.transferred",
  "call.hungup",
  "call.ended",
  "call.voicemail_left",
  "call.comm_assets_generated",
  "user.created",
  "user.connected",
  "user.disconnected",
  "user.opened",
  "user.closed",
  "user.wut_start",
  "user.wut_end",
  "user.created.v2",
  "user.connected.v2",
  "user.disconnected.v2",
  "user.opened.v2",
  "user.closed.v2",
  "user.wut_start.v2",
  "user.wut_end.v2",
  "number.created",
  "number.deleted",
];

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase אינו מחובר" }, { status: 400 });
  }
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") {
    return NextResponse.json({ error: "נדרשת הרשאת מנהל" }, { status: 403 });
  }

  const [keyResult, apiResult] = await Promise.all([
    supabase.rpc("get_aircall_webhook_key_authenticated"),
    supabase.rpc("aircall_api_configured_authenticated"),
  ]);
  if (keyResult.error || !keyResult.data || apiResult.error) {
    return NextResponse.json(
      {
        error:
          keyResult.error?.message ??
          apiResult.error?.message ??
          "Webhook key is unavailable",
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    webhookUrl: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/aircall-webhook?key=${encodeURIComponent(keyResult.data)}`,
    recommendedEvents,
    apiConfigured: Boolean(apiResult.data),
  });
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase אינו מחובר" }, { status: 400 });
  }
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json()) as {
    apiId?: unknown;
    apiToken?: unknown;
  };
  const apiId = typeof body.apiId === "string" ? body.apiId.trim() : "";
  const apiToken =
    typeof body.apiToken === "string" ? body.apiToken.trim() : "";
  if (apiId.length < 3 || apiToken.length < 8) {
    return NextResponse.json(
      { error: "יש להזין API ID ו־API Token תקינים" },
      { status: 400 },
    );
  }

  const { error } = await supabase.rpc(
    "save_aircall_api_credentials_authenticated",
    {
      p_api_id: apiId,
      p_api_token: apiToken,
    },
  );
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
