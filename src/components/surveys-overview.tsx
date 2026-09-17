"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, Inbox, Star, Upload, X } from "lucide-react";
import { SurveyPriorityPullForm } from "@/components/survey-priority-pull-form";
import { SurveyScoreExport } from "@/components/survey-score-export";

type ResponseRow = {
  id: string;
  order_number: string;
  branch_id: string | null;
  mover_id: string | null;
  agent_name: string | null;
  score_branch: number;
  score_coordination: number;
  score_mover: number;
  feedback_positive: string | null;
  feedback_negative: string | null;
  submitted_at: string;
  excluded_from_average: boolean;
  excluded_reason: string | null;
  survey_branches: { name: string } | null;
  survey_movers: { name: string } | null;
  survey_pending_sends: { customer_name: string; phone: string } | null;
};

const EXCLUDE_REASON_LABEL: Record<string, string> = {
  error: "טעות",
  not_relevant: "לא רלוונטית לתחום",
};

type Branch = { id: string; name: string };
type Mover = { id: string; name: string };

type Drilldown = { type: "agent" | "mover"; key: string; label: string };

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

function SelectFilter({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label
      className="relative flex h-10 items-center rounded-lg border bg-white"
      style={{ borderColor: "var(--line)" }}
    >
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-full min-w-36 appearance-none bg-transparent pr-3 pl-8 text-sm font-medium outline-none"
        style={{ color: "var(--ink)" }}
      >
        <option value="">{label}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown size={14} className="pointer-events-none absolute left-3" style={{ color: "var(--muted)" }} />
    </label>
  );
}

function Bar({
  label,
  count,
  value,
  maxValue,
  displayValue,
  color,
  onClick,
}: {
  label: string;
  count?: number;
  value: number;
  maxValue: number;
  displayValue: string;
  color: string;
  onClick?: () => void;
}) {
  const width = maxValue > 0 ? Math.max((value / maxValue) * 100, 3) : 0;
  const content = (
    <>
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
    </>
  );

  if (!onClick) {
    return <div className="flex items-center gap-3">{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg p-1 text-right transition-colors hover:bg-black/[0.03]"
    >
      {content}
    </button>
  );
}

function ExcludeToggle({
  row,
  open,
  onOpen,
  onClose,
  onUpdate,
}: {
  row: ResponseRow;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onUpdate: (excluded: boolean, reason: string | null) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);

  async function submit(excluded: boolean, reason: string | null) {
    setSaving(true);
    try {
      await onUpdate(excluded, reason);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  if (row.excluded_from_average) {
    return (
      <div className="flex items-center gap-2">
        <span
          className="rounded-full px-2 py-0.5 text-[11px] font-bold"
          style={{ background: "#f1e6fb", color: "#7a3fc2" }}
        >
          מוחרג מהממוצע{row.excluded_reason ? ` · ${EXCLUDE_REASON_LABEL[row.excluded_reason] ?? row.excluded_reason}` : ""}
        </span>
        <button
          type="button"
          disabled={saving}
          onClick={() => void submit(false, null)}
          className="text-xs underline disabled:opacity-50"
          style={{ color: "var(--muted)" }}
        >
          בטל החרגה
        </button>
      </div>
    );
  }

  if (open) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          סיבה:
        </span>
        <button
          type="button"
          disabled={saving}
          onClick={() => void submit(true, "error")}
          className="rounded-full border px-2 py-0.5 text-[11px] font-medium disabled:opacity-50"
          style={{ borderColor: "var(--line)", color: "var(--ink)" }}
        >
          טעות
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => void submit(true, "not_relevant")}
          className="rounded-full border px-2 py-0.5 text-[11px] font-medium disabled:opacity-50"
          style={{ borderColor: "var(--line)", color: "var(--ink)" }}
        >
          לא רלוונטית לתחום
        </button>
        <button type="button" onClick={onClose} className="text-xs underline" style={{ color: "var(--muted)" }}>
          ביטול
        </button>
      </div>
    );
  }

  return (
    <button type="button" onClick={onOpen} className="text-xs underline" style={{ color: "var(--muted)" }}>
      החרג מהממוצע
    </button>
  );
}

export function SurveysOverview({
  responses,
  branches,
  movers,
  pendingCount,
  sentCount,
}: {
  responses: ResponseRow[];
  branches: Branch[];
  movers: Mover[];
  pendingCount: number;
  sentCount: number;
}) {
  const [localResponses, setLocalResponses] = useState(responses);
  const [branchFilter, setBranchFilter] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [moverFilter, setMoverFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [drilldown, setDrilldown] = useState<Drilldown | null>(null);
  const [excludeEditorId, setExcludeEditorId] = useState<string | null>(null);

  async function handleExcludeUpdate(id: string, excluded: boolean, reason: string | null) {
    const response = await fetch("/api/surveys/responses", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, excluded, reason }),
    });
    if (!response.ok) return;
    setLocalResponses((current) =>
      current.map((row) =>
        row.id === id ? { ...row, excluded_from_average: excluded, excluded_reason: reason } : row,
      ),
    );
  }

  const allAgentNames = useMemo(
    () => [...new Set(localResponses.map((row) => row.agent_name).filter((name): name is string => Boolean(name)))].sort(
      (a, b) => a.localeCompare(b, "he"),
    ),
    [localResponses],
  );

  const hasFilters = Boolean(branchFilter || agentFilter || moverFilter || dateFrom || dateTo);

  function clearFilters() {
    setBranchFilter("");
    setAgentFilter("");
    setMoverFilter("");
    setDateFrom("");
    setDateTo("");
  }

  const filteredResponses = useMemo(() => {
    return localResponses.filter((row) => {
      if (branchFilter && row.branch_id !== branchFilter) return false;
      if (agentFilter && row.agent_name !== agentFilter) return false;
      if (moverFilter && row.mover_id !== moverFilter) return false;
      if (dateFrom && row.submitted_at < dateFrom) return false;
      if (dateTo && row.submitted_at > `${dateTo}T23:59:59`) return false;
      return true;
    });
  }, [localResponses, branchFilter, agentFilter, moverFilter, dateFrom, dateTo]);

  // Excluded responses still count as "a response was received" (hero stats,
  // response rate) but never enter any average/distribution calculation.
  const averagingResponses = useMemo(
    () => filteredResponses.filter((row) => !row.excluded_from_average),
    [filteredResponses],
  );

  const totalResponses = filteredResponses.length;
  const responseRate = !hasFilters && sentCount > 0 ? (totalResponses / sentCount) * 100 : null;
  const overallAvg = average(averagingResponses.map(avgOf));

  const categoryAverages = [
    { label: "מוכר/ת וסניף", value: average(averagingResponses.map((row) => row.score_branch)) },
    { label: "תיאום אספקה", value: average(averagingResponses.map((row) => row.score_coordination)) },
    { label: "מוביל/ים", value: average(averagingResponses.map((row) => row.score_mover)) },
  ];

  const satisfied = averagingResponses.filter((row) => avgOf(row) >= 4).length;
  const neutral = averagingResponses.filter((row) => avgOf(row) >= 3 && avgOf(row) < 4).length;
  const unsatisfied = averagingResponses.filter((row) => avgOf(row) < 3).length;
  const distributionTotal = averagingResponses.length;
  const distribution = [
    { label: "מרוצים (4-5)", count: satisfied, color: "var(--teal)" },
    { label: "ניטרלי (3-4)", count: neutral, color: "var(--amber)" },
    { label: "לא מרוצים (1-3)", count: unsatisfied, color: "var(--red)" },
  ];

  const branchAverages = branches
    .map((branch) => {
      const rows = averagingResponses.filter((row) => row.branch_id === branch.id);
      return { id: branch.id, name: branch.name, value: average(rows.map(avgOf)), count: rows.length };
    })
    .filter((branch) => branch.count > 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  const agentAverages = allAgentNames
    .map((name) => {
      const rows = averagingResponses.filter((row) => row.agent_name === name);
      return { name, value: average(rows.map((row) => row.score_branch)), count: rows.length };
    })
    .filter((agent) => agent.count > 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  const moverAverages = movers
    .map((mover) => {
      const rows = averagingResponses.filter((row) => row.mover_id === mover.id);
      return { id: mover.id, name: mover.name, value: average(rows.map((row) => row.score_mover)), count: rows.length };
    })
    .filter((mover) => mover.count > 0)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  const feed = [...filteredResponses]
    .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))
    .slice(0, 8);

  const drilldownRows = useMemo(() => {
    if (!drilldown) return [];
    return filteredResponses
      .filter((row) => (drilldown.type === "agent" ? row.agent_name === drilldown.key : row.mover_id === drilldown.key))
      .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
  }, [drilldown, filteredResponses]);

  const drilldownAvg = drilldown
    ? average(
        drilldownRows
          .filter((row) => !row.excluded_from_average)
          .map((row) => (drilldown.type === "agent" ? row.score_branch : row.score_mover)),
      )
    : null;

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
          <Link
            href="/surveys/reviews"
            className="flex h-10 items-center gap-2 rounded-lg border px-4 text-sm font-semibold"
            style={{ borderColor: "var(--line)", color: "var(--ink)" }}
          >
            <Star size={16} />
            בקשת ביקורות בגוגל
          </Link>
        </div>
      </div>

      <div className="card flex flex-wrap items-center gap-3 p-4">
        <span className="text-sm font-semibold" style={{ color: "var(--ink)" }}>
          סינון:
        </span>
        <SelectFilter
          label="כל הסניפים"
          value={branchFilter}
          onChange={setBranchFilter}
          options={branches.map((branch) => ({ value: branch.id, label: branch.name }))}
        />
        <SelectFilter
          label="כל הסוכנים/ות"
          value={agentFilter}
          onChange={setAgentFilter}
          options={allAgentNames.map((name) => ({ value: name, label: name }))}
        />
        <SelectFilter
          label="כל המובילים"
          value={moverFilter}
          onChange={setMoverFilter}
          options={movers.map((mover) => ({ value: mover.id, label: mover.name }))}
        />
        <div className="flex items-center gap-1.5 text-sm" style={{ color: "var(--muted)" }}>
          <span>מ-</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
            className="h-10 rounded-lg border px-2 text-sm"
            style={{ borderColor: "var(--line)", color: "var(--ink)" }}
          />
          <span>עד</span>
          <input
            type="date"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
            className="h-10 rounded-lg border px-2 text-sm"
            style={{ borderColor: "var(--line)", color: "var(--ink)" }}
          />
        </div>
        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="flex items-center gap-1 text-sm underline"
            style={{ color: "var(--red)" }}
          >
            <X size={14} />
            נקה סינון
          </button>
        )}
        {hasFilters && (
          <span className="mr-auto text-sm" style={{ color: "var(--muted)" }}>
            מציג {totalResponses} מתוך {responses.length} תשובות
          </span>
        )}
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
            {hasFilters ? "לא זמין בעת סינון" : `${totalResponses} תשובות מתוך ${sentCount} שנשלחו`}
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
          {distributionTotal === 0 ? (
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              אין תשובות תואמות
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {distribution.map((item) => (
                <Bar
                  key={item.label}
                  label={item.label}
                  value={item.count}
                  maxValue={distributionTotal}
                  displayValue={`${Math.round((item.count / distributionTotal) * 100)}%`}
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
          {distributionTotal === 0 ? (
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              אין תשובות תואמות
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
            אין תשובות תואמות
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {branchAverages.map((branch) => (
              <Bar
                key={branch.id}
                label={branch.name}
                count={branch.count}
                value={branch.value ?? 0}
                maxValue={5}
                displayValue={formatScore(branch.value)}
                color="var(--teal)"
                onClick={() => setBranchFilter((current) => (current === branch.id ? "" : branch.id))}
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
            ציון &quot;מוכר/ת וסניף&quot; בלבד, מפולח לפי הסוכן/ת שרשום/ה בהזמנה בפריוריטי. לחץ/י על שם כדי לראות את כל התשובות שלו/ה.
          </p>
          {agentAverages.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              אין תשובות תואמות
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
                  onClick={() => setDrilldown({ type: "agent", key: agent.name, label: agent.name })}
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
            ציון &quot;מוביל/ים&quot; בלבד, מפולח לפי המוביל שביצע את האספקה. לחץ/י על שם כדי לראות את כל התשובות שלו.
          </p>
          {moverAverages.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--muted)" }}>
              אין תשובות תואמות
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {moverAverages.map((mover) => (
                <Bar
                  key={mover.id}
                  label={mover.name}
                  count={mover.count}
                  value={mover.value ?? 0}
                  maxValue={5}
                  displayValue={formatScore(mover.value)}
                  color="var(--teal)"
                  onClick={() => setDrilldown({ type: "mover", key: mover.id, label: mover.name })}
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
            אין תשובות תואמות
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
                  <ExcludeToggle
                    row={row}
                    open={excludeEditorId === row.id}
                    onOpen={() => setExcludeEditorId(row.id)}
                    onClose={() => setExcludeEditorId(null)}
                    onUpdate={(excluded, reason) => handleExcludeUpdate(row.id, excluded, reason)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {drilldown && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setDrilldown(null)}
        >
          <div
            className="card flex max-h-[85vh] w-full max-w-2xl flex-col gap-4 overflow-hidden p-0"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b p-4" style={{ borderColor: "var(--line)" }}>
              <div>
                <h3 className="text-base font-semibold" style={{ color: "var(--ink)" }}>
                  {drilldown.label} — {drilldown.type === "agent" ? "כל התשובות" : "כל האספקות"}
                </h3>
                <p className="text-xs" style={{ color: "var(--muted)" }}>
                  {drilldownRows.length} תשובות · ממוצע {formatScore(drilldownAvg)} / 5
                </p>
              </div>
              <button type="button" onClick={() => setDrilldown(null)} aria-label="סגור">
                <X size={20} style={{ color: "var(--muted)" }} />
              </button>
            </div>
            <div className="flex-1 divide-y overflow-y-auto" style={{ borderColor: "var(--line)" }}>
              {drilldownRows.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm" style={{ color: "var(--muted)" }}>
                  אין תשובות
                </p>
              ) : (
                drilldownRows.map((row) => (
                  <div key={row.id} className="flex flex-col gap-1.5 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold" style={{ color: "var(--ink)" }}>
                          {row.survey_pending_sends?.customer_name ?? "—"}
                        </span>
                        <span className="text-xs" style={{ color: "var(--muted)" }}>
                          {row.order_number}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold" dir="ltr" style={{ color: "var(--teal)" }}>
                          {(drilldown.type === "agent" ? row.score_branch : row.score_mover).toFixed(1)} / 5
                        </span>
                        <span className="text-xs" style={{ color: "var(--muted)" }}>
                          {formatDate(row.submitted_at)}
                        </span>
                      </div>
                    </div>
                    {row.survey_pending_sends?.phone && (
                      <span className="text-xs" dir="ltr" style={{ color: "var(--muted)" }}>
                        {row.survey_pending_sends.phone}
                      </span>
                    )}
                    {(row.feedback_positive || row.feedback_negative) && (
                      <div className="flex flex-col gap-1">
                        {row.feedback_positive && (
                          <p className="text-sm" style={{ color: "var(--ink)" }}>
                            <span style={{ color: "var(--teal)" }}>+ </span>
                            {row.feedback_positive}
                          </p>
                        )}
                        {row.feedback_negative && (
                          <p className="text-sm" style={{ color: "var(--ink)" }}>
                            <span style={{ color: "var(--red)" }}>− </span>
                            {row.feedback_negative}
                          </p>
                        )}
                      </div>
                    )}
                    <ExcludeToggle
                      row={row}
                      open={excludeEditorId === row.id}
                      onOpen={() => setExcludeEditorId(row.id)}
                      onClose={() => setExcludeEditorId(null)}
                      onUpdate={(excluded, reason) => handleExcludeUpdate(row.id, excluded, reason)}
                    />
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
