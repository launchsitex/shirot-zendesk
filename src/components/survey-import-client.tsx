"use client";

import { useRef, useState } from "react";

type ImportResult = {
  imported: number;
  skipped: { row: number; reason: string }[];
  duplicates: { row: number; orderNumber: string }[];
};

const REQUIRED_COLUMNS = ["שם לקוח", "טלפון", "מספר הזמנה"];
const OPTIONAL_COLUMNS = ["סניף", "מתאם/ת", "מוביל"];

export function SurveyImportClient() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleUpload() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setError("בחר קובץ Excel תחילה");
      return;
    }
    setUploading(true);
    setError(null);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/surveys/import", {
        method: "POST",
        body: formData,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error ?? "הייבוא נכשל");
      }
      setResult(payload as ImportResult);
      if (fileInputRef.current) fileInputRef.current.value = "";
      setFileName(null);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "הייבוא נכשל");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6 p-6">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: "var(--ink)" }}>
          ייבוא לקוחות לסקר
        </h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          העלה קובץ Excel של הזמנות שסופקו במלואן — כל שורה תיכנס לתור השליחה עם קישור ייחודי.
        </p>
      </div>

      <div className="card flex flex-col gap-3 p-5">
        <p className="text-sm font-medium" style={{ color: "var(--ink)" }}>
          עמודות חובה (שורה ראשונה בקובץ = כותרות):
        </p>
        <div className="flex flex-wrap gap-2">
          {REQUIRED_COLUMNS.map((column) => (
            <span
              key={column}
              className="rounded-full px-3 py-1 text-xs font-medium"
              style={{ background: "var(--teal-soft)", color: "var(--teal)" }}
            >
              {column}
            </span>
          ))}
        </div>
        <p className="text-sm font-medium" style={{ color: "var(--ink)" }}>
          עמודות אופציונליות (משמשות לניתוח בדשבורד):
        </p>
        <div className="flex flex-wrap gap-2">
          {OPTIONAL_COLUMNS.map((column) => (
            <span
              key={column}
              className="rounded-full px-3 py-1 text-xs font-medium"
              style={{ background: "var(--background)", color: "var(--muted)" }}
            >
              {column}
            </span>
          ))}
        </div>
      </div>

      <div className="card flex flex-col gap-4 p-5">
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={(event) => setFileName(event.target.files?.[0]?.name ?? null)}
          className="text-sm"
        />
        {fileName && (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            נבחר: {fileName}
          </p>
        )}
        {error && (
          <p className="text-sm" style={{ color: "var(--red)" }}>
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={handleUpload}
          disabled={uploading}
          className="self-start rounded-lg px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: "var(--blue)" }}
        >
          {uploading ? "מייבא..." : "ייבוא לתור השליחה"}
        </button>
      </div>

      {result && (
        <div className="card flex flex-col gap-3 p-5">
          <p className="text-sm font-semibold" style={{ color: "var(--teal)" }}>
            יובאו בהצלחה {result.imported} לקוחות לתור השליחה
          </p>
          {result.duplicates.length > 0 && (
            <div>
              <p className="text-sm font-medium" style={{ color: "var(--amber)" }}>
                {result.duplicates.length} שורות דולגו — הזמנה כבר קיימת בתור
              </p>
              <ul className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                {result.duplicates.map((row) => (
                  <li key={row.row}>שורה {row.row}: הזמנה {row.orderNumber}</li>
                ))}
              </ul>
            </div>
          )}
          {result.skipped.length > 0 && (
            <div>
              <p className="text-sm font-medium" style={{ color: "var(--red)" }}>
                {result.skipped.length} שורות דולגו — נתונים חסרים
              </p>
              <ul className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                {result.skipped.map((row) => (
                  <li key={row.row}>
                    שורה {row.row}: {row.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
