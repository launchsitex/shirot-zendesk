import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { randomUUID } from "node:crypto";
import {
  createSupabaseServerClient,
  isSupabaseConfigured,
} from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/access";
import { canAccessPage } from "@/lib/app-pages";

// Manual survey trigger: an admin exports completed orders from Priority to
// Excel (see PROJECT_CONTEXT.md — Priority API access is unconfirmed, so this
// file-based step stands in for it) and uploads it here. Each row becomes one
// survey_pending_sends row with a fresh token; branches/coordinators/movers
// are upserted by name so the template editor's dropdowns fill themselves in.

type FieldKey =
  | "customerName"
  | "phone"
  | "orderNumber"
  | "branchName"
  | "coordinatorName"
  | "moverName";

const HEADER_ALIASES: Record<FieldKey, string[]> = {
  customerName: ["שם לקוח", "שם הלקוח"],
  phone: ["טלפון", "מספר טלפון", "נייד"],
  orderNumber: ["מספר הזמנה", "הזמנה", "מסהזמנה"],
  branchName: ["סניף"],
  coordinatorName: ["מתאם", "מתאמת", "תיאום", "משרד", "מתאםת"],
  moverName: ["מוביל", "מובילים", "חברת הובלה"],
};

function normalizeHeader(value: string): string {
  return value.replace(/['".()/\-\s]/g, "").trim();
}

const NORMALIZED_ALIASES: Record<string, FieldKey> = Object.fromEntries(
  Object.entries(HEADER_ALIASES).flatMap(([field, aliases]) =>
    aliases.map((alias) => [normalizeHeader(alias), field as FieldKey]),
  ),
);

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "text" in value) {
    return String((value as { text: unknown }).text ?? "").trim();
  }
  if (typeof value === "object" && "result" in value) {
    return String((value as { result: unknown }).result ?? "").trim();
  }
  return String(value).trim();
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 9 && !digits.startsWith("0")) return `0${digits}`;
  return digits;
}

function buildMessage(
  template: string,
  vars: { customerName: string; orderNumber: string; link: string },
): string {
  return template
    .replaceAll("{שם_לקוח}", vars.customerName)
    .replaceAll("{מספר_הזמנה}", vars.orderNumber)
    .replaceAll("{קישור}", vars.link);
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Supabase אינו מחובר" }, { status: 400 });
  }

  const profile = await getCurrentProfile();
  if (!profile || !canAccessPage(profile, "surveys-import")) {
    return NextResponse.json({ error: "אין הרשאה" }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "לא נבחר קובץ" }, { status: 400 });
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return NextResponse.json({ error: "הקובץ ריק" }, { status: 400 });
  }

  const headerRow = sheet.getRow(1);
  const columnByField = new Map<FieldKey, number>();
  headerRow.eachCell((cell, colNumber) => {
    const field = NORMALIZED_ALIASES[normalizeHeader(cellText(cell.value))];
    if (field) columnByField.set(field, colNumber);
  });

  const missingColumns = (
    ["customerName", "phone", "orderNumber"] as FieldKey[]
  ).filter((field) => !columnByField.has(field));
  if (missingColumns.length > 0) {
    return NextResponse.json(
      {
        error: `בקובץ חסרות עמודות חובה: ${missingColumns
          .map((field) => HEADER_ALIASES[field][0])
          .join(", ")}`,
      },
      { status: 400 },
    );
  }

  type ParsedRow = {
    rowNumber: number;
    customerName: string;
    phone: string;
    orderNumber: string;
    branchName: string | null;
    coordinatorName: string | null;
    moverName: string | null;
  };
  const parsedRows: ParsedRow[] = [];
  const skipped: { row: number; reason: string }[] = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const get = (field: FieldKey) => {
      const col = columnByField.get(field);
      return col ? cellText(row.getCell(col).value) : "";
    };
    const customerName = get("customerName");
    const phone = normalizePhone(get("phone"));
    const orderNumber = get("orderNumber");
    if (!customerName && !phone && !orderNumber) return; // blank row

    if (!customerName || !phone || !orderNumber) {
      skipped.push({ row: rowNumber, reason: "חסרים שם לקוח / טלפון / מספר הזמנה" });
      return;
    }
    parsedRows.push({
      rowNumber,
      customerName,
      phone,
      orderNumber,
      branchName: get("branchName") || null,
      coordinatorName: get("coordinatorName") || null,
      moverName: get("moverName") || null,
    });
  });

  if (parsedRows.length === 0) {
    return NextResponse.json({ imported: 0, skipped, duplicates: [] });
  }

  const supabase = await createSupabaseServerClient();

  const orderNumbers = [...new Set(parsedRows.map((row) => row.orderNumber))];
  const { data: existingOrders } = await supabase
    .from("survey_pending_sends")
    .select("order_number")
    .in("order_number", orderNumbers);
  const existingOrderSet = new Set((existingOrders ?? []).map((row) => row.order_number));

  const duplicates = parsedRows.filter((row) => existingOrderSet.has(row.orderNumber));
  const rowsToImport = parsedRows.filter((row) => !existingOrderSet.has(row.orderNumber));

  const upsertLookup = async (
    table: "survey_branches" | "survey_coordinators" | "survey_movers",
    names: (string | null)[],
  ) => {
    const unique = [...new Set(names.filter((name): name is string => Boolean(name)))];
    if (unique.length === 0) return;
    const { error } = await supabase
      .from(table)
      .upsert(
        unique.map((name) => ({ id: name, name })),
        { onConflict: "id", ignoreDuplicates: false },
      );
    if (error) throw error;
  };

  await Promise.all([
    upsertLookup("survey_branches", rowsToImport.map((row) => row.branchName)),
    upsertLookup("survey_coordinators", rowsToImport.map((row) => row.coordinatorName)),
    upsertLookup("survey_movers", rowsToImport.map((row) => row.moverName)),
  ]);

  const { data: templateRow } = await supabase
    .from("survey_message_template")
    .select("template_text")
    .eq("id", "default")
    .maybeSingle();
  const template = templateRow?.template_text ?? "שלום {שם_לקוח}, {קישור}";
  const origin = new URL(request.url).origin;

  const pendingRows = rowsToImport.map((row) => {
    const token = randomUUID();
    return {
      customer_name: row.customerName,
      phone: row.phone,
      order_number: row.orderNumber,
      branch_id: row.branchName,
      coordinator_id: row.coordinatorName,
      mover_id: row.moverName,
      token,
      message_text: buildMessage(template, {
        customerName: row.customerName,
        orderNumber: row.orderNumber,
        link: `${origin}/s/${token}`,
      }),
      status: "pending" as const,
    };
  });

  const { error: insertError } = await supabase
    .from("survey_pending_sends")
    .insert(pendingRows);
  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({
    imported: pendingRows.length,
    skipped,
    duplicates: duplicates.map((row) => ({ row: row.rowNumber, orderNumber: row.orderNumber })),
  });
}
