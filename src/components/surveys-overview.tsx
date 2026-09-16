import Link from "next/link";
import { Inbox, Upload } from "lucide-react";
import { SurveyPriorityPullForm } from "@/components/survey-priority-pull-form";

type ScoreRow = {
  score_branch: number;
  score_coordination: number;
  score_mover: number;
};

type RecentRow = {
  id: string;
  order_number: string;
  score_branch: number;
  score_coordination: number;
  score_mover: number;
  feedback_positive: string | null;
  feedback_negative: string | null;
  submitted_at: string;
  survey_branches: { name: string } | null;
  survey_coordinators: { name: string } | null;
  survey_movers: { name: string } | null;
};

function average(rows: ScoreRow[], key: keyof ScoreRow): number | null {
  if (rows.length === 0) return null;
  const sum = rows.reduce((total, row) => total + row[key], 0);
  return sum / rows.length;
}

function formatScore(value: number | null): string {
  return value === null ? "—" : value.toFixed(1);
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function SurveysOverview({
  scoreRows,
  recentRows,
  pendingCount,
}: {
  scoreRows: ScoreRow[];
  recentRows: RecentRow[];
  pendingCount: number;
}) {
  const kpis = [
    { label: "ממוצע מוכר/ת וסניף", value: average(scoreRows, "score_branch") },
    { label: "ממוצע תיאום אספקה", value: average(scoreRows, "score_coordination") },
    { label: "ממוצע מוביל/ים", value: average(scoreRows, "score_mover") },
  ];

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--ink)" }}>
            סקרי שביעות רצון
          </h1>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            סקר אחד ללקוח, נשלח לאחר שההזמנה סופקה במלואה — מוכר/סניף, תיאום ומוביל.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/surveys/import"
            className="flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold text-white"
            style={{ background: "var(--blue)" }}
          >
            <Upload size={16} />
            ייבוא לקוחות לסקר
          </Link>
          <Link
            href="/surveys/queue"
            className="flex h-10 items-center gap-2 rounded-lg border px-4 text-sm font-semibold"
            style={{ borderColor: "var(--line)", color: "var(--ink)" }}
          >
            <Inbox size={16} />
            תור שליחה
          </Link>
        </div>
      </div>

      <SurveyPriorityPullForm />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="card flex flex-col gap-1 p-5">
            <span className="text-sm" style={{ color: "var(--muted)" }}>
              {kpi.label}
            </span>
            <span className="text-2xl font-bold" style={{ color: "var(--ink)" }} dir="ltr">
              {formatScore(kpi.value)}
              <span className="text-sm font-normal" style={{ color: "var(--muted)" }}>
                {" "}
                / 5
              </span>
            </span>
          </div>
        ))}
        <div className="card flex flex-col gap-1 p-5">
          <span className="text-sm" style={{ color: "var(--muted)" }}>
            בתור לשליחה
          </span>
          <span className="text-2xl font-bold" style={{ color: "var(--blue)" }}>
            {pendingCount}
          </span>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b p-4" style={{ borderColor: "var(--line)" }}>
          <h2 className="text-base font-semibold" style={{ color: "var(--ink)" }}>
            תשובות אחרונות
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-right" style={{ color: "var(--muted)" }}>
                <th className="px-4 py-2 font-medium">הזמנה</th>
                <th className="px-4 py-2 font-medium">סניף</th>
                <th className="px-4 py-2 font-medium">תיאום</th>
                <th className="px-4 py-2 font-medium">מוביל</th>
                <th className="px-4 py-2 font-medium">ציונים</th>
                <th className="px-4 py-2 font-medium">משוב</th>
                <th className="px-4 py-2 font-medium">תאריך</th>
              </tr>
            </thead>
            <tbody>
              {recentRows.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-8 text-center"
                    style={{ color: "var(--muted)" }}
                  >
                    אין תשובות עדיין
                  </td>
                </tr>
              )}
              {recentRows.map((row) => (
                <tr key={row.id} className="border-t" style={{ borderColor: "var(--line)" }}>
                  <td className="px-4 py-3 font-medium">{row.order_number}</td>
                  <td className="px-4 py-3">{row.survey_branches?.name ?? "—"}</td>
                  <td className="px-4 py-3">{row.survey_coordinators?.name ?? "—"}</td>
                  <td className="px-4 py-3">{row.survey_movers?.name ?? "—"}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {row.score_branch}/{row.score_coordination}/{row.score_mover}
                  </td>
                  <td className="max-w-64 px-4 py-3">
                    {row.feedback_positive && (
                      <p className="truncate" style={{ color: "var(--teal)" }}>
                        + {row.feedback_positive}
                      </p>
                    )}
                    {row.feedback_negative && (
                      <p className="truncate" style={{ color: "var(--red)" }}>
                        − {row.feedback_negative}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap" style={{ color: "var(--muted)" }}>
                    {formatDate(row.submitted_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
