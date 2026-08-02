/**
 * The Hebrew RTL body of the daily "יעדים לנציגים" report.
 *
 * Kept free of Deno APIs and of the function's side effects so the template can
 * be rendered and eyeballed on its own — email HTML is the one thing you cannot
 * check by reading it.
 *
 * Table-based layout with inline styles throughout, because that is what mail
 * clients render reliably; dir="rtl" is repeated on every nested table since
 * Outlook drops it from the outer one.
 */

export type ReportRow = {
  department_id: string | null;
  department_name: string | null;
  agent_id: string;
  agent_name: string;
  daily_inbound_target: number | null;
  inbound_answered: number;
};

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function formatHebrewDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

export function buildEmailHtml(
  rows: ReportRow[],
  date: string,
  cutoff: string,
): string {
  const groups = new Map<string, { name: string; rows: ReportRow[] }>();
  for (const row of rows) {
    const key = row.department_id ?? "";
    let group = groups.get(key);
    if (!group) {
      group = { name: row.department_name ?? "ללא שיוך מחלקה", rows: [] };
      groups.set(key, group);
    }
    group.rows.push(row);
  }

  const sections = [...groups.values()]
    .map((group) => {
      const totalTarget = group.rows.reduce(
        (sum, row) => sum + (row.daily_inbound_target ?? 0),
        0,
      );
      const totalActual = group.rows.reduce(
        (sum, row) => sum + Number(row.inbound_answered ?? 0),
        0,
      );

      const body = [...group.rows]
        .sort((a, b) => Number(b.inbound_answered) - Number(a.inbound_answered))
        .map((row) => {
          const actual = Number(row.inbound_answered ?? 0);
          const target = row.daily_inbound_target;
          const gap = target === null ? null : actual - target;
          const gapColor =
            gap === null ? "#a3adb1" : gap >= 0 ? "#1f7a55" : "#c8434c";
          // Exactly on target reads "0", not "+0".
          const gapText =
            gap === null ? "—" : gap > 0 ? `+${gap}` : String(gap);
          return `
      <tr>
        <td style="padding:10px 14px;border-bottom:1px solid #eef1f2;font-size:14px;color:#17242d;font-family:Arial,Helvetica,sans-serif;">${escapeHtml(row.agent_name ?? "")}</td>
        <td align="center" style="padding:10px 8px;border-bottom:1px solid #eef1f2;font-size:14px;color:#718087;font-family:Arial,Helvetica,sans-serif;">${target ?? "—"}</td>
        <td align="center" style="padding:10px 8px;border-bottom:1px solid #eef1f2;font-size:15px;font-weight:bold;color:#17242d;font-family:Arial,Helvetica,sans-serif;">${actual}</td>
        <td align="center" style="padding:10px 8px;border-bottom:1px solid #eef1f2;font-size:14px;font-weight:bold;color:${gapColor};font-family:Arial,Helvetica,sans-serif;">${gapText}</td>
      </tr>`;
        })
        .join("");

      const totalGap = totalActual - totalTarget;
      const totalColor = totalGap >= 0 ? "#1f7a55" : "#c8434c";

      return `
  <tr><td style="padding:22px 0 8px 0;">
    <span style="font-size:16px;font-weight:bold;color:#17242d;font-family:Arial,Helvetica,sans-serif;">${escapeHtml(group.name)}</span>
  </td></tr>
  <tr><td>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="rtl" style="border:1px solid #eef1f2;border-radius:12px;overflow:hidden;">
      <tr style="background-color:#f8fafb;">
        <th align="right" style="padding:10px 14px;font-size:12px;color:#5d6d75;font-family:Arial,Helvetica,sans-serif;">נציג</th>
        <th align="center" style="padding:10px 8px;font-size:12px;color:#5d6d75;font-family:Arial,Helvetica,sans-serif;">יעד</th>
        <th align="center" style="padding:10px 8px;font-size:12px;color:#5d6d75;font-family:Arial,Helvetica,sans-serif;">בפועל</th>
        <th align="center" style="padding:10px 8px;font-size:12px;color:#5d6d75;font-family:Arial,Helvetica,sans-serif;">פער</th>
      </tr>
      ${body}
      <tr style="background-color:#f8fafb;">
        <td style="padding:11px 14px;font-size:13px;font-weight:bold;color:#17242d;font-family:Arial,Helvetica,sans-serif;">סה״כ</td>
        <td align="center" style="padding:11px 8px;font-size:13px;font-weight:bold;color:#718087;font-family:Arial,Helvetica,sans-serif;">${totalTarget || "—"}</td>
        <td align="center" style="padding:11px 8px;font-size:14px;font-weight:bold;color:#17242d;font-family:Arial,Helvetica,sans-serif;">${totalActual}</td>
        <td align="center" style="padding:11px 8px;font-size:13px;font-weight:bold;color:${totalColor};font-family:Arial,Helvetica,sans-serif;">${totalTarget ? (totalGap > 0 ? `+${totalGap}` : String(totalGap)) : "—"}</td>
      </tr>
    </table>
  </td></tr>`;
    })
    .join("");

  const empty = `
  <tr><td style="padding:28px 0;text-align:center;color:#a3adb1;font-size:14px;font-family:Arial,Helvetica,sans-serif;">
    לא נרשמו שיחות נכנסות שנענו בטווח הזה, ולא הוגדרו יעדים.
  </td></tr>`;

  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>יעדים לנציגים</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f6f7;" dir="rtl">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="rtl" style="background-color:#f4f6f7;padding:32px 16px;">
<tr>
<td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="rtl" style="max-width:640px;background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
<tr>
<td style="background-color:#158f83;padding:20px 28px;font-family:Arial,Helvetica,sans-serif;">
<span style="color:#ffffff;font-size:18px;font-weight:bold;">🎯 יעדים לנציגים</span>
<div style="color:#d3ece9;font-size:13px;margin-top:4px;">${escapeHtml(formatHebrewDate(date))} · מתחילת היום ועד ${escapeHtml(cutoff)}</div>
</td>
</tr>
<tr>
<td style="padding:4px 28px 24px 28px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" dir="rtl">
${sections || empty}
</table>
</td>
</tr>
<tr>
<td style="background-color:#f8fafb;padding:16px 28px;color:#a3adb1;font-size:12px;text-align:center;font-family:Arial,Helvetica,sans-serif;">
נספרות שיחות נכנסות שנענו בלבד. שיחה שהנציג העביר הלאה אינה נספרת לו; שיחה שהועברה אליו כן נספרת.
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>`;
}
