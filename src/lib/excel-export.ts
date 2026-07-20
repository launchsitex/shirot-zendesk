import ExcelJS from "exceljs";
import { formatIsraelDateTime } from "@/lib/israel-time";
import { formatDuration, formatSecondsLabel, kpiDelta } from "@/lib/metrics";
import type { Kpis } from "@/lib/types";

const BRAND = "158F83";
const BRAND_DARK = "102D38";
const ALT_ROW = "F8FBFC";
const GOOD = "1F7A55";
const BAD = "C34850";
const MUTED = "66757D";

export type AnalyticsExportMeta = {
  title?: string;
  generatedAt?: string | Date;
  rangeFrom: string;
  rangeTo: string;
  presetLabel: string;
  departmentName: string;
  agentName: string;
  callsCompleted: number;
};

export type AnalyticsExportComparison = {
  label: string;
  from: string;
  to: string;
  kpis: Kpis;
};

export type AnalyticsExportAgent = {
  name: string;
  departmentName?: string;
  total: number;
  answered: number;
  missed: number;
  answerRate: number;
  transfers: number;
  talkSeconds: number;
  averageTalkSeconds: number;
  averageAsaSeconds?: number;
  averageWaitSeconds?: number;
  outbound?: number;
};

export type AnalyticsExportDay = {
  date: string;
  label: string;
  inbound: number;
  outbound: number;
  total: number;
  answered?: number;
  missed?: number;
  answerRate?: number;
};

export type AnalyticsExportHour = {
  hour: number;
  label: string;
  total: number;
  inbound: number;
  answered: number;
  missed: number;
  answerRate: number;
};

export type AnalyticsExportCall = {
  startedAt: string;
  startedAtIsrael: string;
  direction: string;
  status: string;
  agentName: string;
  departmentName: string;
  customerNumber: string;
  durationLabel: string;
  talkLabel: string;
  waitLabel: string;
  transferredBy: string;
};

export type AnalyticsExportDepartment = {
  id: string;
  name: string;
  kpis: Kpis;
  agents: AnalyticsExportAgent[];
  daily: AnalyticsExportDay[];
  hourly: AnalyticsExportHour[];
  peakHourLabel?: string;
  weakHourLabel?: string;
};

export type AnalyticsExportInput = {
  meta: AnalyticsExportMeta;
  kpis: Kpis;
  comparisons: AnalyticsExportComparison[];
  agents: AnalyticsExportAgent[];
  daily: AnalyticsExportDay[];
  hourly: AnalyticsExportHour[];
  calls: AnalyticsExportCall[];
  departments: AnalyticsExportDepartment[];
  peakHourLabel?: string;
  weakHourLabel?: string;
};

function styleTitle(cell: ExcelJS.Cell, text: string) {
  cell.value = text;
  cell.font = { name: "Arial", size: 16, bold: true, color: { argb: `FF${BRAND_DARK}` } };
  cell.alignment = { horizontal: "right", vertical: "middle", readingOrder: "rtl" };
}

function styleSection(cell: ExcelJS.Cell, text: string) {
  cell.value = text;
  cell.font = { name: "Arial", size: 12, bold: true, color: { argb: `FF${BRAND}` } };
  cell.alignment = { horizontal: "right", vertical: "middle", readingOrder: "rtl" };
}

function styleHeaderRow(row: ExcelJS.Row, columnCount: number) {
  row.height = 22;
  for (let col = 1; col <= columnCount; col += 1) {
    const cell = row.getCell(col);
    cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: `FF${BRAND_DARK}` },
    };
    cell.alignment = {
      horizontal: "right",
      vertical: "middle",
      wrapText: true,
      readingOrder: "rtl",
    };
    cell.border = {
      bottom: { style: "thin", color: { argb: `FF${BRAND}` } },
    };
  }
}

function styleBodyCell(cell: ExcelJS.Cell, alt = false) {
  cell.font = { name: "Arial", size: 10, color: { argb: `FF${BRAND_DARK}` } };
  cell.alignment = { horizontal: "right", vertical: "middle", readingOrder: "rtl" };
  if (alt) {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: `FF${ALT_ROW}` },
    };
  }
}

function setRtl(sheet: ExcelJS.Worksheet) {
  sheet.views = [{ rightToLeft: true, state: "frozen", ySplit: 0 }];
}

function autofit(sheet: ExcelJS.Worksheet, min = 10, max = 36) {
  sheet.columns.forEach((column) => {
    let width = min;
    column.eachCell?.({ includeEmpty: true }, (cell) => {
      const value = cell.value;
      const text =
        value == null
          ? ""
          : typeof value === "object" && "text" in value
            ? String((value as { text?: string }).text ?? "")
            : String(value);
      width = Math.min(max, Math.max(width, text.length + 2));
    });
    column.width = width;
  });
}

function deltaTone(delta: number, higherIsBetter: boolean | null): string {
  if (delta === 0 || higherIsBetter === null) return MUTED;
  const good = higherIsBetter ? delta > 0 : delta < 0;
  return good ? GOOD : BAD;
}

function signed(value: number, suffix = ""): string {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value}${suffix}`;
}

function presetHebrew(preset: string): string {
  switch (preset) {
    case "today":
      return "היום";
    case "week":
      return "השבוע";
    case "month":
      return "החודש";
    case "custom":
      return "טווח מותאם";
    default:
      return preset;
  }
}

export async function downloadAnalyticsExcel(input: AnalyticsExportInput) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "City Live Dashboard";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.properties.date1904 = false;

  const generatedAt = formatIsraelDateTime(input.meta.generatedAt ?? new Date());
  const rangeText =
    input.meta.rangeFrom === input.meta.rangeTo
      ? input.meta.rangeFrom
      : `${input.meta.rangeFrom} עד ${input.meta.rangeTo}`;

  buildSummarySheet(workbook, input, generatedAt, rangeText);
  buildDepartmentsOverviewSheet(workbook, input, rangeText);
  buildComparisonsSheet(workbook, input, rangeText);
  buildAgentsSheet(workbook, input);
  for (const department of input.departments) {
    buildDepartmentSheet(workbook, department, rangeText);
  }
  buildHourlySheet(workbook, input);
  buildDailySheet(workbook, input);
  buildCallsSheet(workbook, input);

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const filename = `דוח-מוקד_${input.meta.rangeFrom}_${input.meta.rangeTo}.xlsx`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function buildSummarySheet(
  workbook: ExcelJS.Workbook,
  input: AnalyticsExportInput,
  generatedAt: string,
  rangeText: string,
) {
  const sheet = workbook.addWorksheet("סיכום", {
    properties: { defaultRowHeight: 18 },
  });
  setRtl(sheet);

  styleTitle(sheet.getCell(1, 1), input.meta.title ?? "דוח ביצועי מוקד");
  sheet.mergeCells(1, 1, 1, 4);
  sheet.getRow(1).height = 28;

  sheet.getCell(2, 1).value = "רהיטי הסיטי · City Live";
  sheet.getCell(2, 1).font = {
    name: "Arial",
    size: 10,
    color: { argb: `FF${MUTED}` },
  };

  styleSection(sheet.getCell(4, 1), "פרטי הדוח");
  const metaRows: Array<[string, string]> = [
    ["נוצר בתאריך", generatedAt],
    ["טווח נתונים", rangeText],
    ["תצוגה", presetHebrew(input.meta.presetLabel)],
    ["מחלקה", input.meta.departmentName],
    ["נציג/ה", input.meta.agentName],
    ["שיחות שהסתיימו בטווח", String(input.meta.callsCompleted)],
  ];
  if (input.peakHourLabel) {
    metaRows.push(["שעת עומס שיא", input.peakHourLabel]);
  }
  if (input.weakHourLabel) {
    metaRows.push(["שעה עם מענה נמוך", input.weakHourLabel]);
  }

  let row = 5;
  metaRows.forEach(([label, value]) => {
    const labelCell = sheet.getCell(row, 1);
    const valueCell = sheet.getCell(row, 2);
    labelCell.value = label;
    valueCell.value = value;
    labelCell.font = { name: "Arial", size: 10, bold: true, color: { argb: `FF${MUTED}` } };
    styleBodyCell(valueCell);
    labelCell.alignment = { horizontal: "right", readingOrder: "rtl" };
    row += 1;
  });

  row += 1;
  styleSection(sheet.getCell(row, 1), "מדדי ביצוע (KPI)");
  row += 1;
  const kpiHeader = sheet.getRow(row);
  kpiHeader.values = ["מדד", "ערך", "הסבר"];
  styleHeaderRow(kpiHeader, 3);
  row += 1;

  const kpiRows: Array<[string, string | number, string]> = [
    ["אחוז מענה", `${input.kpis.answerRate}%`, "מתוך שיחות נכנסות שהסתיימו"],
    ["נכנסות שנענו", input.kpis.answered, "שיחות נכנסות שנענו בפועל"],
    ["נכנסות שלא נענו", input.kpis.missed, "שיחות נכנסות שהוחמצו"],
    ["שיחות יוצאות", input.kpis.outbound, "שיחות יוצאות שהסתיימו"],
    ["סה״כ שיחות", input.kpis.total, "נכנסות + יוצאות שהסתיימו"],
    ["זמן שיחה ממוצע", formatDuration(input.kpis.averageTalkSeconds), "ממוצע זמן דיבור"],
    [
      "זמן מענה ממוצע (ASA)",
      formatSecondsLabel(input.kpis.averageAsaSeconds),
      "ממוצע המתנה עד מענה בשיחות שנענו",
    ],
    [
      "זמן המתנה ממוצע",
      formatSecondsLabel(input.kpis.averageWaitSeconds),
      "ממוצע המתנה עד מענה או ניתוק",
    ],
    [
      "סה״כ זמן דיבור",
      formatDuration(input.kpis.totalTalkSeconds),
      "סכום זמני הדיבור בטווח",
    ],
  ];

  kpiRows.forEach(([metric, value, note], index) => {
    const current = sheet.getRow(row);
    current.values = [metric, value, note];
    for (let col = 1; col <= 3; col += 1) {
      styleBodyCell(current.getCell(col), index % 2 === 1);
    }
    current.getCell(1).font = {
      name: "Arial",
      size: 10,
      bold: true,
      color: { argb: `FF${BRAND_DARK}` },
    };
    row += 1;
  });

  row += 1;
  styleSection(sheet.getCell(row, 1), "הערות");
  row += 1;
  sheet.getCell(row, 1).value =
    "הזמנים מחושבים לפי שעון ישראל. שיחות פעילות (בשיחה כעת) אינן נכללות בסיכומים. הקובץ מחולק לפי מחלקות: סיכום מחלקות + גיליון נפרד לכל מחלקה, בנוסף לנציגים, שעות, יומי ופירוט שיחות.";
  sheet.mergeCells(row, 1, row, 4);
  sheet.getCell(row, 1).font = {
    name: "Arial",
    size: 9,
    color: { argb: `FF${MUTED}` },
  };
  sheet.getCell(row, 1).alignment = {
    horizontal: "right",
    wrapText: true,
    readingOrder: "rtl",
  };
  sheet.getRow(row).height = 36;

  sheet.getColumn(1).width = 28;
  sheet.getColumn(2).width = 22;
  sheet.getColumn(3).width = 42;
  sheet.getColumn(4).width = 18;
}

function buildDepartmentsOverviewSheet(
  workbook: ExcelJS.Workbook,
  input: AnalyticsExportInput,
  rangeText: string,
) {
  const sheet = workbook.addWorksheet("מחלקות", {
    properties: { defaultRowHeight: 18 },
  });
  setRtl(sheet);
  styleTitle(sheet.getCell(1, 1), "סיכום לפי מחלקות");
  sheet.mergeCells(1, 1, 1, 10);
  sheet.getCell(2, 1).value = `טווח: ${rangeText}`;
  sheet.getCell(2, 1).font = {
    name: "Arial",
    size: 10,
    color: { argb: `FF${MUTED}` },
  };

  const header = sheet.getRow(4);
  header.values = [
    "מחלקה",
    "סה״כ שיחות",
    "נכנסות",
    "נענו",
    "לא נענו",
    "אחוז מענה",
    "יוצאות",
    "זמן שיחה ממוצע",
    "ASA",
    "המתנה ממוצעת",
    "שעת שיא",
    "מענה חלש",
    "מספר נציגים",
  ];
  styleHeaderRow(header, 13);

  input.departments.forEach((department, index) => {
    const row = sheet.getRow(5 + index);
    row.values = [
      department.name,
      department.kpis.total,
      department.kpis.inbound,
      department.kpis.answered,
      department.kpis.missed,
      department.kpis.answerRate / 100,
      department.kpis.outbound,
      formatDuration(department.kpis.averageTalkSeconds),
      formatSecondsLabel(department.kpis.averageAsaSeconds),
      formatSecondsLabel(department.kpis.averageWaitSeconds),
      department.peakHourLabel ?? "—",
      department.weakHourLabel ?? "—",
      department.agents.length,
    ];
    for (let col = 1; col <= 13; col += 1) {
      styleBodyCell(row.getCell(col), index % 2 === 1);
    }
    row.getCell(6).numFmt = "0%";
    row.getCell(6).font = {
      name: "Arial",
      size: 10,
      bold: true,
      color: {
        argb: `FF${department.kpis.answerRate >= 80 ? GOOD : BAD}`,
      },
    };
  });

  const totalsRow = sheet.getRow(5 + input.departments.length + 1);
  totalsRow.values = [
    "סה״כ כל המחלקות",
    input.kpis.total,
    input.kpis.inbound,
    input.kpis.answered,
    input.kpis.missed,
    input.kpis.answerRate / 100,
    input.kpis.outbound,
    formatDuration(input.kpis.averageTalkSeconds),
    formatSecondsLabel(input.kpis.averageAsaSeconds),
    formatSecondsLabel(input.kpis.averageWaitSeconds),
    input.peakHourLabel ?? "—",
    input.weakHourLabel ?? "—",
    input.agents.length,
  ];
  for (let col = 1; col <= 13; col += 1) {
    const cell = totalsRow.getCell(col);
    cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: `FF${BRAND}` },
    };
    cell.alignment = { horizontal: "right", readingOrder: "rtl" };
  }
  totalsRow.getCell(6).numFmt = "0%";

  sheet.views = [{ rightToLeft: true, state: "frozen", ySplit: 4 }];
  autofit(sheet, 12, 26);
}

function safeSheetName(name: string, used: Set<string>): string {
  const cleaned = name.replace(/[\\/?*[\]:]/g, " ").replace(/\s+/g, " ").trim();
  let base = (cleaned || "מחלקה").slice(0, 28);
  let candidate = base;
  let index = 2;
  while (used.has(candidate)) {
    const suffix = ` ${index}`;
    candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    index += 1;
  }
  used.add(candidate);
  return candidate;
}

function buildDepartmentSheet(
  workbook: ExcelJS.Workbook,
  department: AnalyticsExportDepartment,
  rangeText: string,
) {
  const usedNames = new Set(
    workbook.worksheets.map((sheet) => sheet.name),
  );
  const sheet = workbook.addWorksheet(safeSheetName(department.name, usedNames), {
    properties: { defaultRowHeight: 18 },
  });
  setRtl(sheet);
  styleTitle(sheet.getCell(1, 1), `מחלקה: ${department.name}`);
  sheet.mergeCells(1, 1, 1, 8);
  sheet.getCell(2, 1).value = `טווח: ${rangeText}`;
  sheet.getCell(2, 1).font = {
    name: "Arial",
    size: 10,
    color: { argb: `FF${MUTED}` },
  };

  styleSection(sheet.getCell(4, 1), "מדדי המחלקה");
  const kpiHeader = sheet.getRow(5);
  kpiHeader.values = ["מדד", "ערך"];
  styleHeaderRow(kpiHeader, 2);

  const kpiRows: Array<[string, string | number]> = [
    ["אחוז מענה", `${department.kpis.answerRate}%`],
    ["נכנסות שנענו", department.kpis.answered],
    ["נכנסות שלא נענו", department.kpis.missed],
    ["שיחות יוצאות", department.kpis.outbound],
    ["סה״כ שיחות", department.kpis.total],
    ["זמן שיחה ממוצע", formatDuration(department.kpis.averageTalkSeconds)],
    ["ASA", formatSecondsLabel(department.kpis.averageAsaSeconds)],
    ["המתנה ממוצעת", formatSecondsLabel(department.kpis.averageWaitSeconds)],
    ["שעת שיא", department.peakHourLabel ?? "—"],
    ["מענה חלש", department.weakHourLabel ?? "—"],
  ];
  kpiRows.forEach(([metric, value], index) => {
    const row = sheet.getRow(6 + index);
    row.values = [metric, value];
    styleBodyCell(row.getCell(1), index % 2 === 1);
    styleBodyCell(row.getCell(2), index % 2 === 1);
    row.getCell(1).font = {
      name: "Arial",
      size: 10,
      bold: true,
      color: { argb: `FF${BRAND_DARK}` },
    };
  });

  const agentsStart = 6 + kpiRows.length + 2;
  styleSection(sheet.getCell(agentsStart, 1), "נציגי המחלקה");
  const agentHeader = sheet.getRow(agentsStart + 1);
  agentHeader.values = [
    "#",
    "נציג/ה",
    "סה״כ",
    "נענו",
    "לא נענו",
    "אחוז מענה",
    "יוצאות",
    "העברות",
    "זמן שיחה",
    "ממוצע שיחה",
    "ASA",
    "המתנה",
  ];
  styleHeaderRow(agentHeader, 12);

  department.agents.forEach((agent, index) => {
    const row = sheet.getRow(agentsStart + 2 + index);
    row.values = [
      index + 1,
      agent.name,
      agent.total,
      agent.answered,
      agent.missed,
      agent.answerRate / 100,
      agent.outbound ?? 0,
      agent.transfers,
      formatDuration(agent.talkSeconds),
      formatDuration(agent.averageTalkSeconds),
      formatSecondsLabel(agent.averageAsaSeconds ?? 0),
      formatSecondsLabel(agent.averageWaitSeconds ?? 0),
    ];
    for (let col = 1; col <= 12; col += 1) {
      styleBodyCell(row.getCell(col), index % 2 === 1);
    }
    row.getCell(6).numFmt = "0%";
  });

  const hourlyStart = agentsStart + 2 + department.agents.length + 2;
  styleSection(sheet.getCell(hourlyStart, 1), "שעות שיא במחלקה");
  const hourHeader = sheet.getRow(hourlyStart + 1);
  hourHeader.values = [
    "שעה",
    "סה״כ",
    "נכנסות",
    "נענו",
    "לא נענו",
    "אחוז מענה",
  ];
  styleHeaderRow(hourHeader, 6);
  department.hourly.forEach((hour, index) => {
    const row = sheet.getRow(hourlyStart + 2 + index);
    row.values = [
      hour.label,
      hour.total,
      hour.inbound,
      hour.answered,
      hour.missed,
      hour.inbound ? hour.answerRate / 100 : null,
    ];
    for (let col = 1; col <= 6; col += 1) {
      styleBodyCell(row.getCell(col), index % 2 === 1);
    }
    row.getCell(6).numFmt = "0%";
  });

  sheet.getColumn(1).width = 18;
  sheet.getColumn(2).width = 18;
  autofit(sheet, 10, 20);
}

function buildComparisonsSheet(
  workbook: ExcelJS.Workbook,
  input: AnalyticsExportInput,
  rangeText: string,
) {
  const sheet = workbook.addWorksheet("השוואות", {
    properties: { defaultRowHeight: 18 },
  });
  setRtl(sheet);
  styleTitle(sheet.getCell(1, 1), "השוואה לתקופה קודמת");
  sheet.mergeCells(1, 1, 1, 8);
  sheet.getCell(2, 1).value = `תקופה נוכחית: ${rangeText}`;
  sheet.getCell(2, 1).font = {
    name: "Arial",
    size: 10,
    color: { argb: `FF${MUTED}` },
  };

  const header = sheet.getRow(4);
  header.values = [
    "השוואה",
    "טווח השוואה",
    "אחוז מענה (נוכחי)",
    "אחוז מענה (קודם)",
    "שינוי מענה",
    "לא נענו (נוכחי)",
    "לא נענו (קודם)",
    "שינוי לא נענו",
    "ממוצע שיחה (נוכחי)",
    "ממוצע שיחה (קודם)",
    "שינוי ממוצע שיחה (שנ׳)",
    "ASA נוכחי",
    "ASA קודם",
    "המתנה ממוצעת נוכחית",
    "המתנה ממוצעת קודמת",
    "סה״כ שיחות קודם",
  ];
  styleHeaderRow(header, 16);

  input.comparisons.forEach((comparison, index) => {
    const answerDelta = kpiDelta(input.kpis.answerRate, comparison.kpis.answerRate);
    const missedDelta = kpiDelta(input.kpis.missed, comparison.kpis.missed);
    const talkDelta = kpiDelta(
      input.kpis.averageTalkSeconds,
      comparison.kpis.averageTalkSeconds,
    );
    const row = sheet.getRow(5 + index);
    row.values = [
      comparison.label,
      comparison.from === comparison.to
        ? comparison.from
        : `${comparison.from} עד ${comparison.to}`,
      `${input.kpis.answerRate}%`,
      `${comparison.kpis.answerRate}%`,
      signed(answerDelta, "%"),
      input.kpis.missed,
      comparison.kpis.missed,
      signed(missedDelta),
      formatDuration(input.kpis.averageTalkSeconds),
      formatDuration(comparison.kpis.averageTalkSeconds),
      signed(talkDelta),
      formatSecondsLabel(input.kpis.averageAsaSeconds),
      formatSecondsLabel(comparison.kpis.averageAsaSeconds),
      formatSecondsLabel(input.kpis.averageWaitSeconds),
      formatSecondsLabel(comparison.kpis.averageWaitSeconds),
      comparison.kpis.total,
    ];
    for (let col = 1; col <= 16; col += 1) {
      styleBodyCell(row.getCell(col), index % 2 === 1);
    }
    row.getCell(5).font = {
      name: "Arial",
      size: 10,
      bold: true,
      color: { argb: `FF${deltaTone(answerDelta, true)}` },
    };
    row.getCell(8).font = {
      name: "Arial",
      size: 10,
      bold: true,
      color: { argb: `FF${deltaTone(missedDelta, false)}` },
    };
    row.getCell(11).font = {
      name: "Arial",
      size: 10,
      bold: true,
      color: { argb: `FF${MUTED}` },
    };
  });

  sheet.views = [{ rightToLeft: true, state: "frozen", ySplit: 4 }];
  autofit(sheet, 12, 28);
}

function buildAgentsSheet(workbook: ExcelJS.Workbook, input: AnalyticsExportInput) {
  const sheet = workbook.addWorksheet("נציגים", {
    properties: { defaultRowHeight: 18 },
  });
  setRtl(sheet);
  styleTitle(sheet.getCell(1, 1), "ביצועים לפי נציג ומחלקה");
  sheet.mergeCells(1, 1, 1, 10);

  const sortedAgents = [...input.agents].sort(
    (a, b) =>
      (a.departmentName ?? "").localeCompare(b.departmentName ?? "", "he") ||
      b.total - a.total ||
      a.name.localeCompare(b.name, "he"),
  );

  const header = sheet.getRow(3);
  header.values = [
    "#",
    "מחלקה",
    "נציג/ה",
    "סה״כ שיחות",
    "נענו",
    "לא נענו",
    "אחוז מענה",
    "יוצאות",
    "העברות שיחה",
    "סה״כ זמן שיחה",
    "זמן שיחה ממוצע",
    "ASA ממוצע",
    "המתנה ממוצעת",
  ];
  styleHeaderRow(header, 13);

  sortedAgents.forEach((agent, index) => {
    const row = sheet.getRow(4 + index);
    row.values = [
      index + 1,
      agent.departmentName ?? "ללא שיוך",
      agent.name,
      agent.total,
      agent.answered,
      agent.missed,
      agent.answerRate / 100,
      agent.outbound ?? "",
      agent.transfers,
      formatDuration(agent.talkSeconds),
      formatDuration(agent.averageTalkSeconds),
      agent.averageAsaSeconds != null
        ? formatSecondsLabel(agent.averageAsaSeconds)
        : "",
      agent.averageWaitSeconds != null
        ? formatSecondsLabel(agent.averageWaitSeconds)
        : "",
    ];
    for (let col = 1; col <= 13; col += 1) {
      styleBodyCell(row.getCell(col), index % 2 === 1);
    }
    row.getCell(7).numFmt = "0%";
    if (agent.answerRate < 80 && agent.answered + agent.missed > 0) {
      row.getCell(7).font = {
        name: "Arial",
        size: 10,
        bold: true,
        color: { argb: `FF${BAD}` },
      };
    } else {
      row.getCell(7).font = {
        name: "Arial",
        size: 10,
        bold: true,
        color: { argb: `FF${GOOD}` },
      };
    }
  });

  const totalsRow = sheet.getRow(4 + sortedAgents.length + 1);
  const answered = sortedAgents.reduce((sum, agent) => sum + agent.answered, 0);
  const missed = sortedAgents.reduce((sum, agent) => sum + agent.missed, 0);
  const inbound = answered + missed;
  totalsRow.values = [
    "",
    "",
    "סה״כ / ממוצע",
    sortedAgents.reduce((sum, agent) => sum + agent.total, 0),
    answered,
    missed,
    inbound ? answered / inbound : 0,
    sortedAgents.reduce((sum, agent) => sum + (agent.outbound ?? 0), 0),
    sortedAgents.reduce((sum, agent) => sum + agent.transfers, 0),
    formatDuration(sortedAgents.reduce((sum, agent) => sum + agent.talkSeconds, 0)),
    formatDuration(input.kpis.averageTalkSeconds),
    formatSecondsLabel(input.kpis.averageAsaSeconds),
    formatSecondsLabel(input.kpis.averageWaitSeconds),
  ];
  for (let col = 1; col <= 13; col += 1) {
    const cell = totalsRow.getCell(col);
    cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: `FF${BRAND}` },
    };
    cell.alignment = { horizontal: "right", readingOrder: "rtl" };
  }
  totalsRow.getCell(7).numFmt = "0%";

  sheet.views = [{ rightToLeft: true, state: "frozen", ySplit: 3 }];
  sheet.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: 3 + Math.max(sortedAgents.length, 1), column: 13 },
  };
  autofit(sheet, 10, 22);
}

function buildHourlySheet(workbook: ExcelJS.Workbook, input: AnalyticsExportInput) {
  const sheet = workbook.addWorksheet("שעות שיא", {
    properties: { defaultRowHeight: 18 },
  });
  setRtl(sheet);
  styleTitle(sheet.getCell(1, 1), "פירוט לפי שעה ביום");
  sheet.mergeCells(1, 1, 1, 7);
  if (input.peakHourLabel || input.weakHourLabel) {
    sheet.getCell(2, 1).value = [
      input.peakHourLabel ? `עומס שיא: ${input.peakHourLabel}` : null,
      input.weakHourLabel ? `מענה נמוך: ${input.weakHourLabel}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    sheet.getCell(2, 1).font = {
      name: "Arial",
      size: 10,
      color: { argb: `FF${MUTED}` },
    };
  }

  const header = sheet.getRow(4);
  header.values = [
    "שעה",
    "סה״כ שיחות",
    "נכנסות",
    "נענו",
    "לא נענו",
    "אחוז מענה",
    "הערת עומס",
  ];
  styleHeaderRow(header, 7);

  const maxInbound = Math.max(...input.hourly.map((hour) => hour.inbound), 1);
  input.hourly.forEach((hour, index) => {
    const load =
      hour.inbound >= maxInbound && hour.inbound > 0
        ? "שיא עומס"
        : hour.inbound >= 2 && hour.answerRate < 80
          ? "מענה חלש"
          : "";
    const row = sheet.getRow(5 + index);
    row.values = [
      hour.label,
      hour.total,
      hour.inbound,
      hour.answered,
      hour.missed,
      hour.inbound ? hour.answerRate / 100 : null,
      load,
    ];
    for (let col = 1; col <= 7; col += 1) {
      styleBodyCell(row.getCell(col), index % 2 === 1);
    }
    row.getCell(6).numFmt = "0%";
    if (load === "שיא עומס") {
      row.getCell(7).font = {
        name: "Arial",
        size: 10,
        bold: true,
        color: { argb: `FF${BRAND}` },
      };
    }
    if (load === "מענה חלש") {
      row.getCell(7).font = {
        name: "Arial",
        size: 10,
        bold: true,
        color: { argb: `FF${BAD}` },
      };
    }
  });

  sheet.views = [{ rightToLeft: true, state: "frozen", ySplit: 4 }];
  autofit(sheet, 12, 18);
}

function buildDailySheet(workbook: ExcelJS.Workbook, input: AnalyticsExportInput) {
  const sheet = workbook.addWorksheet("יומי", {
    properties: { defaultRowHeight: 18 },
  });
  setRtl(sheet);
  styleTitle(sheet.getCell(1, 1), "נפח שיחות לפי יום");
  sheet.mergeCells(1, 1, 1, 7);

  const header = sheet.getRow(3);
  header.values = [
    "תאריך",
    "תווית",
    "נכנסות",
    "יוצאות",
    "סה״כ",
    "נענו",
    "לא נענו",
    "אחוז מענה",
  ];
  styleHeaderRow(header, 8);

  input.daily.forEach((day, index) => {
    const row = sheet.getRow(4 + index);
    row.values = [
      day.date,
      day.label,
      day.inbound,
      day.outbound,
      day.total,
      day.answered ?? "",
      day.missed ?? "",
      day.answerRate != null ? day.answerRate / 100 : null,
    ];
    for (let col = 1; col <= 8; col += 1) {
      styleBodyCell(row.getCell(col), index % 2 === 1);
    }
    row.getCell(8).numFmt = "0%";
  });

  sheet.views = [{ rightToLeft: true, state: "frozen", ySplit: 3 }];
  autofit(sheet, 10, 16);
}

function buildCallsSheet(workbook: ExcelJS.Workbook, input: AnalyticsExportInput) {
  const sheet = workbook.addWorksheet("פירוט שיחות", {
    properties: { defaultRowHeight: 18 },
  });
  setRtl(sheet);
  styleTitle(sheet.getCell(1, 1), "פירוט שיחות בטווח");
  sheet.mergeCells(1, 1, 1, 10);
  sheet.getCell(2, 1).value = `סה״כ שורות: ${input.calls.length}`;
  sheet.getCell(2, 1).font = {
    name: "Arial",
    size: 10,
    color: { argb: `FF${MUTED}` },
  };

  const header = sheet.getRow(4);
  header.values = [
    "תאריך ושעה (ישראל)",
    "כיוון",
    "סטטוס",
    "נציג/ה",
    "מחלקה",
    "מספר לקוח",
    "משך כולל",
    "זמן דיבור",
    "זמן המתנה",
    "הועבר ע״י",
  ];
  styleHeaderRow(header, 10);

  input.calls.forEach((call, index) => {
    const row = sheet.getRow(5 + index);
    row.values = [
      call.startedAtIsrael,
      call.direction,
      call.status,
      call.agentName,
      call.departmentName,
      call.customerNumber,
      call.durationLabel,
      call.talkLabel,
      call.waitLabel,
      call.transferredBy,
    ];
    for (let col = 1; col <= 10; col += 1) {
      styleBodyCell(row.getCell(col), index % 2 === 1);
    }
    if (call.status === "לא נענתה") {
      row.getCell(3).font = {
        name: "Arial",
        size: 10,
        bold: true,
        color: { argb: `FF${BAD}` },
      };
    }
  });

  sheet.views = [{ rightToLeft: true, state: "frozen", ySplit: 4 }];
  sheet.autoFilter = {
    from: { row: 4, column: 1 },
    to: { row: 4 + Math.max(input.calls.length, 1), column: 10 },
  };
  autofit(sheet, 12, 28);
}

export { presetHebrew };
