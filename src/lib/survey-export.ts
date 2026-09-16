import ExcelJS from "exceljs";

export type SurveyQueueExportRow = {
  phone: string;
  messageText: string;
};

export type SurveyScoreExportRow = {
  customerName: string;
  phone: string;
  orderNumber: string;
  avgScore: number;
  scoreBranch: number;
  scoreCoordination: number;
  scoreMover: number;
  submittedAt: string;
};

export async function downloadSurveyQueueExcel(rows: SurveyQueueExportRow[]) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "City Live Dashboard";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("לשליחה");
  sheet.views = [{ rightToLeft: true }];
  sheet.columns = [
    { header: "טלפון", key: "phone", width: 16 },
    { header: "הודעה", key: "message", width: 120 },
  ];
  for (const row of rows) {
    sheet.addRow({ phone: row.phone, message: row.messageText });
  }
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { horizontal: "right" };
  sheet.getColumn("message").alignment = { horizontal: "right", wrapText: false };

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const filename = `survey-sms-export_${new Date().toISOString().slice(0, 10)}.xlsx`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function downloadSurveyScoreExcel(rows: SurveyScoreExportRow[], minScore: number) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "City Live Dashboard";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("לקוחות מרוצים");
  sheet.views = [{ rightToLeft: true }];
  sheet.columns = [
    { header: "לקוח", key: "customerName", width: 24 },
    { header: "טלפון", key: "phone", width: 16 },
    { header: "הזמנה", key: "orderNumber", width: 18 },
    { header: "ציון ממוצע", key: "avgScore", width: 12 },
    { header: "מוכר/סניף", key: "scoreBranch", width: 12 },
    { header: "תיאום אספקה", key: "scoreCoordination", width: 14 },
    { header: "מוביל", key: "scoreMover", width: 10 },
    { header: "תאריך תשובה", key: "submittedAt", width: 14 },
  ];
  for (const row of rows) {
    sheet.addRow({
      customerName: row.customerName,
      phone: row.phone,
      orderNumber: row.orderNumber,
      avgScore: Number(row.avgScore.toFixed(2)),
      scoreBranch: row.scoreBranch,
      scoreCoordination: row.scoreCoordination,
      scoreMover: row.scoreMover,
      submittedAt: new Date(row.submittedAt).toLocaleDateString("he-IL"),
    });
  }
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { horizontal: "right" };

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const filename = `סקרים-ציון-${minScore}-ומעלה_${new Date().toISOString().slice(0, 10)}.xlsx`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
