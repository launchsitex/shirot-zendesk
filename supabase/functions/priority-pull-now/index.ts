// Direct, synchronous Priority pull: called from the Next.js server
// (/api/surveys/priority-pull-now) when an admin clicks "משוך עכשיו" on the
// surveys page. Replaces the queue+hourly-cron flow for on-demand pulls —
// this runs the Priority query and the survey_pending_sends insert in one
// request, so the result is immediate.
//
// Auth: not a Supabase user JWT (verify_jwt=false) — gated by a shared
// `x-priority-secret` header checked against public.get_priority_pull_secret()
// (Vault-backed, granted only to `authenticated`+`service_role`), so only our
// own Next.js server, which already checked canAccessPage(profile,"surveys"),
// can trigger this.
//
// Priority credentials (priority_user/priority_password/priority_url) are
// Edge Function project secrets (Supabase dashboard — not Vault, not in
// git). priority_url's value is a full sample ORDERS query URL from whoever
// set up API access — we only use its origin+path root.
//
// Filtering mirrors the hourly cloud routine exactly (see
// trig_01HCDTc2K7ggDMGbTvhijnDa and CHANGELOG.md 2026-09-16): CUSTNAME must
// be an approved sales branch, and BRANCHNAME must NOT be a service/repair
// branch unless includeServiceCalls is explicitly requested.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const APPROVED_CUSTNAME = new Set(["2", "3", "4", "5", "6", "7", "8", "20"]);
const SERVICE_BRANCHNAME = new Set(["10", "11", "12", "13", "14", "16", "17", "18", "19", "23", "24"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_PAGES = 30;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

function getAdminClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function authorize(req: Request, supabase: SupabaseClient): Promise<boolean> {
  const { data: expected, error } = await supabase.rpc("get_priority_pull_secret");
  if (error) return false;
  return Boolean(expected) && req.headers.get("x-priority-secret") === expected;
}

interface ShipTo { PHONENUM?: string | null; CELLPHONE?: string | null }
interface OrderRow {
  ORDNAME: string;
  CUSTNAME: string | null;
  BRANCHNAME: string | null;
  AGENTNAME: string | null;
  CDES: string | null;
  SHIPPERNAME: string | null;
  SHAY_SDATE: string | null;
  SHIPTO2_SUBFORM?: ShipTo | null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "method" }, 405);
  const supabase = getAdminClient();
  if (!(await authorize(req, supabase))) return jsonResponse({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => null);
  const dateFrom = body?.dateFrom;
  const dateTo = body?.dateTo;
  const includeServiceCalls = body?.includeServiceCalls === true;
  if (typeof dateFrom !== "string" || typeof dateTo !== "string" || !DATE_RE.test(dateFrom) || !DATE_RE.test(dateTo)) {
    return jsonResponse({ error: "טווח תאריכים לא תקין" }, 400);
  }
  if (dateFrom > dateTo) return jsonResponse({ error: "תאריך ההתחלה חייב להיות לפני תאריך הסיום" }, 400);

  const priorityUser = Deno.env.get("priority_user");
  const priorityPassword = Deno.env.get("priority_password");
  const priorityUrl = Deno.env.get("priority_url");
  if (!priorityUser || !priorityPassword || !priorityUrl) {
    return jsonResponse({ error: "חיבור לפריוריטי לא מוגדר (priority_user/priority_password/priority_url)" }, 500);
  }
  const root = priorityUrl.replace(/\/+$/, "").replace(/\/ORDERS.*$/, "");
  const authHeader = "Basic " + btoa(`${priorityUser}:${priorityPassword}`);

  // Deliberately narrow: exact status 'סופקה' (not 'סופקה חלקית' or others) and
  // SHAY_SDATE (the delivery-coordination date field) in range. This misses
  // roughly 30% of real deliveries — orders with a different/partial status,
  // or with no SHAY_SDATE at all (seen mostly on pure closet/sofa orders,
  // product families 7/71/72, which often skip the delivery-coordination
  // step). That's accepted: the hourly cloud routine (survey-priority-pull
  // request queue, using the correct priority_deliveries source) still picks
  // up everything this misses, deduped by order_number. See CHANGELOG.md
  // 2026-09-16.
  const filter =
    `ORDSTATUSDES eq 'סופקה' and SHAY_SDATE ge ${dateFrom}T00:00:00+03:00 and SHAY_SDATE le ${dateTo}T23:59:59+03:00`;
  const params = new URLSearchParams();
  params.set("$select", "ORDNAME,CUSTNAME,BRANCHNAME,AGENTNAME,CDES,SHIPPERNAME,SHAY_SDATE");
  params.set("$expand", "SHIPTO2_SUBFORM");
  params.set("$filter", filter);
  params.set("$top", "200");
  let nextUrl: string | null = `${root}/ORDERS?${params.toString()}`;

  const rows: OrderRow[] = [];
  let pages = 0;
  try {
    while (nextUrl && pages < MAX_PAGES) {
      const res = await fetch(nextUrl, {
        headers: { Authorization: authHeader, Accept: "application/json" },
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) {
        const text = (await res.text()).slice(0, 500);
        return jsonResponse({ error: `פריוריטי החזיר ${res.status}: ${text}` }, 502);
      }
      const payload = await res.json();
      rows.push(...((payload.value as OrderRow[] | undefined) ?? []));
      nextUrl = payload["@odata.nextLink"] ?? null;
      pages += 1;
    }
  } catch (error) {
    return jsonResponse({ error: `שגיאת רשת מול פריוריטי: ${error instanceof Error ? error.message : String(error)}` }, 502);
  }

  const matched = rows.filter((row) => {
    const custname = row.CUSTNAME ?? "";
    const branchname = row.BRANCHNAME ?? "";
    if (!APPROVED_CUSTNAME.has(custname)) return false;
    if (!includeServiceCalls && SERVICE_BRANCHNAME.has(branchname)) return false;
    return true;
  });

  const withPhone = matched
    .map((row) => ({
      row,
      phone: row.SHIPTO2_SUBFORM?.PHONENUM || row.SHIPTO2_SUBFORM?.CELLPHONE || "",
    }))
    .filter((entry) => entry.phone);
  const noPhoneCount = matched.length - withPhone.length;

  const moverNames = [...new Set(withPhone.map((entry) => entry.row.SHIPPERNAME).filter((name): name is string => Boolean(name)))];
  if (moverNames.length > 0) {
    const { error: moverError } = await supabase
      .from("survey_movers")
      .upsert(moverNames.map((name) => ({ id: name, name })), { onConflict: "id", ignoreDuplicates: true });
    if (moverError) return jsonResponse({ error: `שגיאת מובילים: ${moverError.message}` }, 500);
  }

  const { data: template, error: templateError } = await supabase
    .from("survey_message_template")
    .select("template_text")
    .eq("id", "default")
    .single();
  if (templateError || !template) return jsonResponse({ error: "לא נמצאה קבוצת הודעה בברירת מחדל" }, 500);

  const rowsToInsert = withPhone.map((entry) => ({
    customer_name: entry.row.CDES || "לקוח",
    phone: entry.phone,
    order_number: entry.row.ORDNAME,
    branch_id: entry.row.CUSTNAME,
    mover_id: entry.row.SHIPPERNAME || null,
    agent_name: entry.row.AGENTNAME || null,
    delivered_at: (entry.row.SHAY_SDATE || "").slice(0, 10) || null,
    status: "pending" as const,
    message_text: "",
  }));

  let insertedCount = 0;
  const BATCH = 50;
  for (let i = 0; i < rowsToInsert.length; i += BATCH) {
    const batch = rowsToInsert.slice(i, i + BATCH);
    const { data: inserted, error: insertError } = await supabase
      .from("survey_pending_sends")
      .upsert(batch, { onConflict: "order_number", ignoreDuplicates: true })
      .select("id, token, customer_name, order_number");
    if (insertError) return jsonResponse({ error: `הוספה לתור: ${insertError.message}` }, 500);
    insertedCount += inserted?.length ?? 0;
    await Promise.all(
      (inserted ?? []).map((row) => {
        const text = template.template_text
          .replaceAll("{שם_לקוח}", row.customer_name)
          .replaceAll("{מספר_הזמנה}", row.order_number)
          .replaceAll("{קישור}", `https://zend-shirot.rc-info.org/s/${row.token}`);
        return supabase.from("survey_pending_sends").update({ message_text: text }).eq("id", row.id);
      }),
    );
  }

  return jsonResponse({
    ok: true,
    matchedCount: matched.length,
    insertedCount,
    skippedNoPhone: noPhoneCount,
    pagesFetched: pages,
  });
});
