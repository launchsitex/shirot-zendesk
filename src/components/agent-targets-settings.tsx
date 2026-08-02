"use client";

import {
  LoaderCircle,
  Mail,
  Plus,
  Save,
  Target,
  Trash2,
} from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";

type Agent = { id: string; name: string; departmentId: string | null };
type Department = { id: string; name: string };
type Recipient = { id: string; email: string };

type SettingsState = {
  agents: Agent[];
  departments: Department[];
  targets: { agentId: string; departmentId: string; target: number }[];
  recipients: Recipient[];
  enabled: boolean;
  sendLocalTime: string;
  lastSentOn: string | null;
  fromEmail: string;
};

const cellKey = (agentId: string, departmentId: string) =>
  `${agentId}::${departmentId}`;

export function AgentTargetsSettingsClient() {
  const [state, setState] = useState<SettingsState | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newEmail, setNewEmail] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [addingRecipient, setAddingRecipient] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [togglingEnabled, setTogglingEnabled] = useState(false);

  function applyState(next: SettingsState) {
    setState(next);
    setDrafts(
      Object.fromEntries(
        next.targets.map((row) => [
          cellKey(row.agentId, row.departmentId),
          String(row.target),
        ]),
      ),
    );
  }

  async function load() {
    try {
      const response = await fetch("/api/settings/agent-targets", {
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "load_failed");
      applyState(payload);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "טעינת ההגדרות נכשלה",
      );
    }
  }

  useEffect(() => {
    // Deferred a tick so the synchronous setState inside load doesn't cascade
    // into the initial render (same pattern as agent-ai-analysis-client).
    const initialLoad = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(initialLoad);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saved_targets = useMemo(
    () =>
      new Map(
        (state?.targets ?? []).map((row) => [
          cellKey(row.agentId, row.departmentId),
          String(row.target),
        ]),
      ),
    [state],
  );

  // Only cells whose value actually moved are sent, so saving stays cheap even
  // with 48 agents across every department.
  const changedCells = useMemo(() => {
    const keys = new Set([
      ...Object.keys(drafts),
      ...saved_targets.keys(),
    ]);
    const changed: {
      agentId: string;
      departmentId: string;
      target: number | null;
    }[] = [];
    for (const key of keys) {
      const draft = (drafts[key] ?? "").trim();
      const current = saved_targets.get(key) ?? "";
      if (draft === current) continue;
      const [agentId, departmentId] = key.split("::");
      changed.push({
        agentId,
        departmentId,
        target: draft === "" ? null : Number(draft),
      });
    }
    return changed;
  }, [drafts, saved_targets]);

  const invalid = changedCells.some(
    (cell) =>
      cell.target !== null &&
      (!Number.isInteger(cell.target) || cell.target < 0),
  );

  async function saveTargets() {
    if (!changedCells.length || invalid) return;
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const response = await fetch("/api/settings/agent-targets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets: changedCells }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "save_failed");
      applyState(payload);
      setSaved(true);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "שמירת היעדים נכשלה",
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(enabled: boolean) {
    setTogglingEnabled(true);
    setError("");
    try {
      const response = await fetch("/api/settings/agent-targets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "save_failed");
      applyState(payload);
    } catch (toggleError) {
      setError(
        toggleError instanceof Error
          ? toggleError.message
          : "עדכון מצב הדוח נכשל",
      );
    } finally {
      setTogglingEnabled(false);
    }
  }

  async function addRecipient(event: React.FormEvent) {
    event.preventDefault();
    if (!newEmail.trim()) return;
    setAddingRecipient(true);
    setError("");
    try {
      const response = await fetch("/api/settings/agent-targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail.trim() }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "add_failed");
      applyState(payload);
      setNewEmail("");
    } catch (addError) {
      setError(
        addError instanceof Error ? addError.message : "הוספת הכתובת נכשלה",
      );
    } finally {
      setAddingRecipient(false);
    }
  }

  async function removeRecipient(recipient: Recipient) {
    if (!window.confirm(`להסיר את ${recipient.email} מרשימת התפוצה?`)) return;
    setRemovingId(recipient.id);
    setError("");
    try {
      const response = await fetch(
        `/api/settings/agent-targets?id=${encodeURIComponent(recipient.id)}`,
        { method: "DELETE" },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "remove_failed");
      applyState(payload);
    } catch (removeError) {
      setError(
        removeError instanceof Error ? removeError.message : "הסרת הכתובת נכשלה",
      );
    } finally {
      setRemovingId(null);
    }
  }

  if (!state && !error) {
    return (
      <div className="card flex min-h-40 items-center justify-center p-8">
        <LoaderCircle className="animate-spin text-[#158f83]" size={28} />
      </div>
    );
  }

  const departmentName = new Map(
    (state?.departments ?? []).map((department) => [
      department.id,
      department.name,
    ]),
  );

  // Agents are listed under their own department so the list reads like the
  // org chart, but every agent gets a cell in every department: eight of them
  // answer for both, and each of those needs its own target.
  const agentGroups = groupAgents(state?.agents ?? [], departmentName);

  return (
    <div className="space-y-5">
      <section className="card space-y-6 p-5 md:p-6">
        <header className="flex items-start gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#e7f5f3] text-[#158f83]">
            <Target size={20} />
          </span>
          <div>
            <h2 className="text-lg font-bold">יעד שיחות נכנסות יומי</h2>
            <p className="mt-1 max-w-3xl text-sm text-[#718087]">
              היעד נמדד בשיחות נכנסות שנענו בלבד. שיחה שהנציג העביר הלאה —
              לנציג אחר, למחלקה אחרת או ליעד חיצוני — אינה נספרת לו. שיחה
              שהועברה <strong>אליו</strong> כן נספרת. תא ריק = אין יעד מוגדר.
            </p>
          </div>
        </header>

        {error && (
          <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}

        {state && (
          <>
            <div className="overflow-x-auto rounded-xl border border-[#edf1f3]">
              <table className="w-full min-w-[520px] border-collapse text-sm">
                <thead>
                  <tr className="bg-[#f8fafb] text-[#5d6d75]">
                    <th className="px-4 py-3 text-right font-semibold">נציג</th>
                    {state.departments.map((department) => (
                      <th
                        key={department.id}
                        className="px-4 py-3 text-center font-semibold"
                      >
                        {department.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {agentGroups.map((group) => (
                    <Fragment key={group.label}>
                      <tr>
                        <td
                          colSpan={state.departments.length + 1}
                          className="bg-[#f3f6f7] px-4 py-2 text-xs font-bold text-[#5d6d75]"
                        >
                          {group.label} ({group.agents.length})
                        </td>
                      </tr>
                      {group.agents.map((agent) => (
                        <tr
                          key={agent.id}
                          className="border-t border-[#edf1f3] bg-white"
                        >
                          <td className="px-4 py-2.5 font-medium text-[#17242d]">
                            {agent.name}
                          </td>
                          {state.departments.map((department) => {
                            const key = cellKey(agent.id, department.id);
                            return (
                              <td key={department.id} className="px-3 py-2">
                                <input
                                  type="number"
                                  min={0}
                                  inputMode="numeric"
                                  value={drafts[key] ?? ""}
                                  onChange={(event) => {
                                    setSaved(false);
                                    setDrafts((previous) => ({
                                      ...previous,
                                      [key]: event.target.value,
                                    }));
                                  }}
                                  placeholder="—"
                                  aria-label={`יעד ל${agent.name} במחלקת ${department.name}`}
                                  className="w-full min-w-[72px] rounded-lg border border-[#dfe6ea] bg-[#f8fafb] px-3 py-2 text-center text-sm text-[#17242d] outline-none focus:border-[#158f83] focus:bg-white"
                                />
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void saveTargets()}
                disabled={saving || !changedCells.length || invalid}
                className="inline-flex items-center gap-2 rounded-xl bg-[#158f83] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#11786e] disabled:opacity-60"
              >
                {saving ? (
                  <LoaderCircle size={16} className="animate-spin" />
                ) : (
                  <Save size={16} />
                )}
                שמירת יעדים
              </button>
              {changedCells.length > 0 && !saved && (
                <span className="text-sm text-[#718087]">
                  {changedCells.length} שינויים שטרם נשמרו
                </span>
              )}
              {saved && (
                <span className="text-sm font-semibold text-[#1f7a55]">
                  נשמר.
                </span>
              )}
            </div>
          </>
        )}
      </section>

      {state && (
        <section className="card space-y-6 p-5 md:p-6">
          <header className="flex items-start gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#fff4e2] text-[#b7791f]">
              <Mail size={20} />
            </span>
            <div>
              <h2 className="text-lg font-bold">
                דוח יומי במייל · {state.sendLocalTime}
              </h2>
              <p className="mt-1 max-w-3xl text-sm text-[#718087]">
                כל יום ב-{state.sendLocalTime} יישלח מייל בעברית עם פירוט לכל
                מחלקה ונציג: היעד, כמה שיחות נכנסות נענו בפועל מתחילת היום ועד{" "}
                {state.sendLocalTime}, והפער. הכתובת השולחת נלקחת מהגדרות
                ההתראות על שיחות שלא נענו
                {state.fromEmail ? (
                  <>
                    {" "}
                    (<span dir="ltr">{state.fromEmail}</span>)
                  </>
                ) : (
                  <strong> — ועדיין לא הוגדרה שם, לכן לא יישלחו מיילים</strong>
                )}
                .
              </p>
            </div>
          </header>

          <label className="flex w-fit items-center gap-3 rounded-xl bg-[#f8fafb] px-4 py-3">
            <input
              type="checkbox"
              checked={state.enabled}
              disabled={togglingEnabled}
              onChange={(event) => void toggleEnabled(event.target.checked)}
              className="h-4 w-4 accent-[#158f83]"
            />
            <span className="text-sm font-semibold text-[#17242d]">
              שליחת הדוח היומי פעילה
            </span>
          </label>

          {state.lastSentOn && (
            <p className="text-xs text-[#a3adb1]">
              נשלח לאחרונה: {state.lastSentOn}
            </p>
          )}

          <div className="space-y-3">
            <span className="text-sm font-bold text-[#17242d]">
              רשימת תפוצה ({state.recipients.length})
            </span>

            <form onSubmit={addRecipient} className="flex flex-wrap gap-3">
              <input
                type="email"
                dir="ltr"
                value={newEmail}
                onChange={(event) => setNewEmail(event.target.value)}
                placeholder="name@example.com"
                className="min-w-[240px] flex-1 rounded-xl border border-[#d7e0e4] bg-white px-4 py-2.5 text-sm outline-none focus:border-[#158f83]"
              />
              <button
                type="submit"
                disabled={addingRecipient || !newEmail.trim()}
                className="inline-flex items-center gap-2 rounded-xl bg-[#158f83] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#11786e] disabled:opacity-60"
              >
                {addingRecipient ? (
                  <LoaderCircle size={16} className="animate-spin" />
                ) : (
                  <Plus size={16} />
                )}
                הוספה
              </button>
            </form>

            {state.recipients.length ? (
              <ul className="divide-y divide-[#edf1f3] overflow-hidden rounded-xl border border-[#edf1f3]">
                {state.recipients.map((recipient) => (
                  <li
                    key={recipient.id}
                    className="flex items-center justify-between gap-3 bg-white px-4 py-3"
                  >
                    <span dir="ltr" className="text-sm font-medium text-[#17242d]">
                      {recipient.email}
                    </span>
                    <button
                      type="button"
                      onClick={() => void removeRecipient(recipient)}
                      disabled={removingId === recipient.id}
                      className="rounded-lg bg-red-50 p-2 text-red-600 transition hover:bg-red-100 disabled:opacity-60"
                      title="הסרה"
                    >
                      {removingId === recipient.id ? (
                        <LoaderCircle size={15} className="animate-spin" />
                      ) : (
                        <Trash2 size={15} />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-xl border border-dashed border-[#dfe6ea] px-4 py-6 text-center text-sm text-[#a3adb1]">
                עדיין לא נוספו כתובות מייל — לא יישלח דוח עד שתוסיפו לפחות
                כתובת אחת.
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function groupAgents(
  agents: Agent[],
  departmentName: Map<string, string>,
): { label: string; agents: Agent[] }[] {
  const groups = new Map<string, { label: string; agents: Agent[] }>();
  for (const agent of agents) {
    const key = agent.departmentId ?? "";
    let group = groups.get(key);
    if (!group) {
      group = {
        label: agent.departmentId
          ? (departmentName.get(agent.departmentId) ?? agent.departmentId)
          : "ללא שיוך מחלקה",
        agents: [],
      };
      groups.set(key, group);
    }
    group.agents.push(agent);
  }
  // Unassigned agents last; they are the tail of the list, not the headline.
  return [...groups.entries()]
    .sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)))
    .map(([, group]) => group);
}
