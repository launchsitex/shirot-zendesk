import ExcelJS from "exceljs";

export type SurveyQueueExportRow = {
  phone: string;
  messageText: string;
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
