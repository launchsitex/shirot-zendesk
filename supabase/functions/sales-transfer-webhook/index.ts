import { createClient } from "npm:@supabase/supabase-js@2";

// Receives one CallMarker "שיחה שהועברה" row at a time from a trigger on
// call_logs in the CRM-RC project and records it in sales_service_transfers.
// Authenticated by a dedicated shared secret (vault: sales_transfer_secret).

type TransferBody = {
  id?: string;
  phone?: string | null;
  agent_name?: string | null;
  direction?: string | null;
  created_at?: string | null;
};

const TRANSFER_DIRECTION = "שיחה שהועברה";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "method" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data: expected, error: secretError } = await supabase.rpc(
    "get_sales_transfer_secret",
  );
  const provided = request.headers.get("x-transfer-secret");
  if (secretError || !expected || !provided || provided !== expected) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: TransferBody;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  if (body.direction !== TRANSFER_DIRECTION) {
    return json({ ok: true, skipped: "not_a_transfer" });
  }
  if (!body.id || !body.phone || !body.created_at) {
    return json({ ok: true, skipped: "missing_fields" });
  }

  const { error } = await supabase.rpc("ingest_sales_service_transfer", {
    p_id: body.id,
    p_phone: body.phone,
    p_agent: body.agent_name ?? null,
    p_at: body.created_at,
  });
  if (error) {
    console.error("[sales-transfer-webhook] ingest failed", error.message);
    return json({ error: error.message }, 500);
  }
  return json({ ok: true });
});
