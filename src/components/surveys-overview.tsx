import Link from "next/link";
import { Inbox, Upload } from "lucide-react";
import { SurveyPriorityPullForm } from "@/components/survey-priority-pull-form";
import { SurveyScoreExport } from "@/components/survey-score-export";

type ScoreRow = {
  score_branch: number;
  score_coordination: number;
  score_mover: number;
  branch_id: string | null;
  mover_id: string | null;
  agent_name: string | null;
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
};

type Branch = { id: string; name: string };
type Mover = { id: string; name: string };

function avgOf(row: { score_branch: number; score_coordination: number; score_mover: number }): number {
  return (row.score_branch + row.score_coordination + row.score_mover) / 3;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function formatScore(value: number | null): string {
  return value === null ? "—" : value.toFixed(1);
}

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)}%`;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function Bar({
  label,
  count,
  value,
  maxValue,
  displayValue,
  color,
}: {
  label: string;
  count?: number;
  value: number;
  maxValue: number;
  displayValue: string;
  color: string;
}) {
  const width = maxValue > 0 ? Math.max((value / maxValue) * 100, 3) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="w-32 shrink-0 truncate text-sm font-medium" style={{ color: "var(--ink)" }}>
        {label}
        {count !== undefined && (
          <span className="text-xs font-normal" style={{ color: "var(--muted)" }}>
            {" "}
            ({count})
          </span>
        )}
      </span>
      <div className="h-2.5 flex-1 overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${width}%`, background: color }}
        />
      </div>
      <span className="w-10 shrink-0 text-left text-sm font-semibold" dir="ltr" style={{ color: "var(--ink)" }}>
        {displayValue}
      </span>
    </div>
  );
}

export function SurveysOverview({
  scoreRows,
  recentRows,
  branches,
  movers,
  pendingCount,
  sentCount,
}: {
  scoreRows: ScoreRow[];
  recentRows: RecentRow[];
  branches: Branch[];
  movers: Mover[];
  pendingCount: number;
  sentCount: number;
}) {
  const totalResponses = scoreRows.length;
  const responseRate = sentCount > 0 ? (totalResponses / sentCount) * 100 : null;
  const overallAvg = average(scoreRows.map(avgOf));

  const categoryAverages = [
    { label: "מוכר/ת וסניף", value: average(scoreRows.map((row) => row.score_branch)) },
    { label: "תיאום אספקה", value: average(scoreRows.map((row) => row.score_coordination)) },
    { label: "מוביל/ים", value: average(scoreRows.map((row) => row.score_mover)) },
  ];

  const satisfied = scoreRows.filter((row) => avgOf(row) >= 4).length;
  const neutral = scoreRows.filter((row) => avgOf(row) >= 3 && avgOf(row) < 4).length;
  const unsatisfied = scoreRows.filter((row) => avgOf(row) < 3).length;
  const distribution = [
    { label: "מרוצים (4-5)", count: satisfied, color: "var(--teal)" },
    { label: "ניטרלי (3-4)", count: neutral, color: "var(--amber)" },
    { label: "לא מרוצים (1-3)", count: unsatisfied, color: "var(--red)" },
  ];

  const branchAverages = branches
    .map((branch) => {
      const rows = scoreRows.filter((row) => row.branch_id === branch.id);
      return { name: branch.name, value: average(rows.map(avgOf)), count: rows.length };
    })
    .filter((branch) => branch.count > 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  const agentNames = [...new Set(scoreRows.map((row) => row.agent_name).filter((name): name is string => Boolean(name)))];
  const agentAverages = agentNames
    .map((name) => {
      const rows = scoreRows.filter((row) => row.agent_name === name);
      return { name, value: average(rows.map((row) => row.score_branch)), count: rows.length };
    })
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  const moverAverages = movers
    .map((mover) => {
      const rows = scoreRows.filter((row) => row.mover_id === mover.id);
      return { name: mover.name, value: average(rows.map((row) => row.score_mover)), count: rows.length };
    })
    .filter((mover) => mover.count > 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  const feed = recentRows.slice(0, 8);

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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="card flex flex-col gap-1 p-6">
          <span className="text-sm" style={{ color: "var(--muted)" }}>
            אחוז מענה לסקר
          </span>
          <span className="text-4xl font-bold" style={{ color: "var(--ink)" }}>
            {formatPercent(responseRate)}
          </span>
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            {totalResponses} תשובות מתוך {sentCount} שנשלחו
          </span>
        </div>
        <div className="card flex flex-col gap-1 p-6">
          <span className="text-sm" style={{ color: "var(--muted)" }}>
            תשובות שהתקבלו
          </span>
          <span className="text-4xl font-bold" style={{ color: "var(--ink)" }}>
            {totalResponses}
          </span>
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            {pendingCount} עוד ממתינים בתור
          </span>
        </div>
        <div className="card flex flex-col gap-1 p-6">
          <span className="text-sm" style={{ color: "var(--muted)" }}>
            ציון ממוצע כללי
          </span>
          <span className="text-4xl font-bold" dir="ltr" style={{ color: "var(--teal)" }}>
            {formatScore(overallAvg)}
            <span className="text-lg font-normal" style={{ color: "var(--muted)" }}>
              {" "}
              / 5
            </span>
          </span>
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            ממוצע שלושת התחומים יחד
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card flex flex-col gap-4 p-6">
          <h2 className="text-base font-semibold" style={{ color: "var(--ink)" }}>
            התפלגות שביעות רצון
          </h2>
          {totalResponses === 0 ? (
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              אין עדיין תשובות
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {distribution.map((item) => (
                <Bar
                  key={item.label}
                  label={item.label}
                  value={item.count}
                  maxValue={totalResponses}
                  displayValue={`${Math.round((item.count / totalResponses) * 100)}%`}
                  color={item.color}
                />
              ))}
            </div>
          )}
        </div>

        <div className="card flex flex-col gap-4 p-6">
          <h2 className="text-base font-semibold" style={{ color: "var(--ink)" }}>
            ציון ממוצע לפי תחום
          </h2>
          {totalResponses === 0 ? (
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              אין עדיין תשובות
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {categoryAverages.map((item) => (
                <Bar
                  key={item.label}
                  label={item.label}
                  value={item.value ?? 0}
                  maxValue={5}
                  displayValue={formatScore(item.value)}
                  color="var(--blue)"
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card flex flex-col gap-4 p-6">
        <h2 className="text-base font-semibold" style={{ color: "var(--ink)" }}>
          ציון ממוצע לפי סניף
        </h2>
        {branchAverages.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            אין עדיין תשובות
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {branchAverages.map((branch) => (
              <Bar
                key={branch.name}
                label={branch.name}
                value={branch.value ?? 0}
                maxValue={5}
                displayValue={formatScore(branch.value)}
                color="var(--teal)"
              />
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card flex flex-col gap-4 p-6">
          <h2 className="text-base font-semibold" style={{ color: "var(--ink)" }}>
            ציון ממוצע לפי סוכן/ת מכירות
          </h2>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            ציון &quot;מוכר/ת וסניף&quot; בלבד, מפולח לפי הסוכן/ת שרשום/ה בהזמנה בפריוריטי.
          </p>
          {agentAverages.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              אין עדיין תשובות
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {agentAverages.map((agent) => (
                <Bar
                  key={agent.name}
                  label={agent.name}
                  count={agent.count}
                  value={agent.value ?? 0}
                  maxValue={5}
                  displayValue={formatScore(agent.value)}
                  color="var(--blue)"
                />
              ))}
            </div>
          )}
        </div>

        <div className="card flex flex-col gap-4 p-6">
          <h2 className="text-base font-semibold" style={{ color: "var(--ink)" }}>
            ציון ממוצע לפי מוביל
          </h2>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            ציון &quot;מוביל/ים&quot; בלבד, מפולח לפי המוביל שביצע את האספקה.
          </p>
          {moverAverages.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              אין עדיין תשובות
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {moverAverages.map((mover) => (
                <Bar
                  key={mover.name}
                  label={mover.name}
                  count={mover.count}
                  value={mover.value ?? 0}
                  maxValue={5}
                  displayValue={formatScore(mover.value)}
                  color="var(--teal)"
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <SurveyPriorityPullForm />
      <SurveyScoreExport />

      <div className="card overflow-hidden">
        <div className="border-b p-4" style={{ borderColor: "var(--line)" }}>
          <h2 className="text-base font-semibold" style={{ color: "var(--ink)" }}>
            משוב אחרון
          </h2>
        </div>
        {feed.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm" style={{ color: "var(--muted)" }}>
            אין תשובות עדיין
          </p>
        ) : (
          <div className="divide-y" style={{ borderColor: "var(--line)" }}>
            {feed.map((row) => {
              const branchName = row.survey_branches?.name ?? "—";
              const avg = avgOf(row);
              return (
                <div key={row.id} className="flex flex-col gap-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold" style={{ color: "var(--ink)" }}>
                        {row.order_number}
                      </span>
                      <span className="text-xs" style={{ color: "var(--muted)" }}>
                        {branchName}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold" dir="ltr" style={{ color: "var(--teal)" }}>
                        {avg.toFixed(1)} / 5
                      </span>
                      <span className="text-xs" style={{ color: "var(--muted)" }}>
                        {formatDate(row.submitted_at)}
                      </span>
                    </div>
                  </div>
                  {(row.feedback_positive || row.feedback_negative) && (
                    <div className="flex flex-col gap-1.5">
                      {row.feedback_positive && (
                        <div className="flex items-start gap-2">
                          <span
                            className="mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold"
                            style={{ background: "var(--teal-soft)", color: "var(--teal)" }}
                          >
                            חיובי
                          </span>
                          <p className="text-sm" style={{ color: "var(--ink)" }}>
                            {row.feedback_positive}
                          </p>
                        </div>
                      )}
                      {row.feedback_negative && (
                        <div className="flex items-start gap-2">
                          <span
                            className="mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold"
                            style={{ background: "#fbe9ea", color: "var(--red)" }}
                          >
                            לשיפור
                          </span>
                          <p className="text-sm" style={{ color: "var(--ink)" }}>
                            {row.feedback_negative}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
