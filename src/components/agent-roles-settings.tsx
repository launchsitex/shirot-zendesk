"use client";

import {
  ArrowDown,
  ArrowUp,
  LoaderCircle,
  Plus,
  Save,
  Trash2,
  UsersRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import { DEFAULT_AGENT_ROLE, type AgentRoleDef } from "@/lib/agent-roles";

type RoleRow = AgentRoleDef & { agentCount: number };

const ERROR_TEXT: Record<string, string> = {
  role_in_use: "יש נציגות בתפקיד הזה. קודם תעבירו אותן לתפקיד אחר בעמוד ״נציגים וצוותים״.",
  default_role: "זה תפקיד ברירת המחדל של כל נציגה חדשה ואי אפשר למחוק אותו.",
  forbidden: "רק מנהל מערכת יכול לשנות תפקידים.",
};

/**
 * "תפקידי נציגות" — the roles an admin can give an agent in "נציגים
 * וצוותים". Their order here is the order of the groups in "זמינות נציגות"
 * on the WhatsApp screens, answering agents meant first. Renames apply
 * everywhere at once; a role can be deleted only when nobody holds it.
 */
export function AgentRolesSettingsClient() {
  const [roles, setRoles] = useState<RoleRow[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newGroupLabel, setNewGroupLabel] = useState("");

  async function request(init: RequestInit & { query?: string }) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/settings/agent-roles${init.query ?? ""}`, {
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        ...init,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "request_failed");
      setRoles(payload.roles as RoleRow[]);
      return true;
    } catch (requestError) {
      const code = requestError instanceof Error ? requestError.message : "request_failed";
      setError(ERROR_TEXT[code] ?? "הפעולה נכשלה, נסו שוב.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/settings/agent-roles", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "load_failed");
        setRoles(payload.roles as RoleRow[]);
      })
      .catch((loadError) => {
        if (loadError instanceof Error && loadError.name === "AbortError") return;
        setError("טעינת התפקידים נכשלה");
      });
    return () => controller.abort();
  }, []);

  async function add() {
    if (!newLabel.trim() || !newGroupLabel.trim()) return;
    const ok = await request({
      method: "POST",
      body: JSON.stringify({ label: newLabel.trim(), groupLabel: newGroupLabel.trim() }),
    });
    if (ok) {
      setNewLabel("");
      setNewGroupLabel("");
    }
  }

  async function move(index: number, direction: -1 | 1) {
    if (!roles) return;
    const target = index + direction;
    if (target < 0 || target >= roles.length) return;
    const order = roles.map((role) => role.id);
    [order[index], order[target]] = [order[target], order[index]];
    await request({ method: "PATCH", body: JSON.stringify({ order }) });
  }

  if (roles === null && !error) {
    return (
      <div className="card flex min-h-40 items-center justify-center p-8">
        <LoaderCircle className="animate-spin text-[#158f83]" size={28} />
      </div>
    );
  }

  return (
    <section className="card space-y-5 p-5 md:p-6">
      <header className="flex items-start gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#e4f5f2] text-[#11786e]">
          <UsersRound size={20} />
        </span>
        <div>
          <h2 className="text-lg font-bold">תפקידי נציגות</h2>
          <p className="mt-1 max-w-2xl text-sm text-[#718087]">
            התפקיד של כל נציגה נבחר בעמוד ״נציגים וצוותים״. הסדר כאן הוא סדר
            הקבוצות ב״זמינות נציגות״ בדשבורדי WA: נציגות מענה ראשונות, מי שלא
            עובדת אחרונה. שינוי שם תופס מיד בכל המסכים. תפקיד נמחק רק כשאף
            נציגה לא נמצאת בו. התפקידים לא משפיעים על שום מדד אחר.
          </p>
        </div>
      </header>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-xs text-[#5d6d75]">
            <tr>
              <th className="px-2 py-2 text-right font-semibold">סדר</th>
              <th className="px-2 py-2 text-right font-semibold">שם התפקיד (יחיד)</th>
              <th className="px-2 py-2 text-right font-semibold">כותרת הקבוצה (רבים)</th>
              <th className="px-2 py-2 text-center font-semibold">נציגות</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {(roles ?? []).map((role, index) => (
              <RoleEditor
                key={role.id}
                role={role}
                index={index}
                count={roles?.length ?? 0}
                busy={busy}
                onMove={(direction) => void move(index, direction)}
                onSave={(label, groupLabel) =>
                  request({ method: "PATCH", body: JSON.stringify({ id: role.id, label, groupLabel }) })
                }
                onDelete={() => request({ method: "DELETE", query: `?id=${encodeURIComponent(role.id)}` })}
              />
            ))}
          </tbody>
        </table>
      </div>

      <form
        className="flex flex-wrap items-end gap-2 rounded-2xl bg-[#f8fafb] p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <label className="flex flex-col gap-1 text-xs font-semibold text-[#17242d]">
          תפקיד חדש (יחיד)
          <input
            value={newLabel}
            onChange={(event) => setNewLabel(event.target.value)}
            placeholder="למשל: נציגת מכירות"
            maxLength={40}
            className="rounded-xl border border-[#dfe6ea] bg-white px-3 py-2 text-sm font-normal"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-[#17242d]">
          כותרת הקבוצה (רבים)
          <input
            value={newGroupLabel}
            onChange={(event) => setNewGroupLabel(event.target.value)}
            placeholder="למשל: נציגות מכירות"
            maxLength={40}
            className="rounded-xl border border-[#dfe6ea] bg-white px-3 py-2 text-sm font-normal"
          />
        </label>
        <button
          type="submit"
          disabled={busy || !newLabel.trim() || !newGroupLabel.trim()}
          className="inline-flex items-center gap-2 rounded-xl bg-[#158f83] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#11786e] disabled:opacity-60"
        >
          <Plus size={16} />
          הוספת תפקיד
        </button>
      </form>
    </section>
  );
}

function RoleEditor({
  role,
  index,
  count,
  busy,
  onMove,
  onSave,
  onDelete,
}: {
  role: RoleRow;
  index: number;
  count: number;
  busy: boolean;
  onMove: (direction: -1 | 1) => void;
  onSave: (label: string, groupLabel: string) => Promise<boolean>;
  onDelete: () => Promise<boolean>;
}) {
  const [label, setLabel] = useState(role.label);
  const [groupLabel, setGroupLabel] = useState(role.groupLabel);
  // Re-sync when the server value changes (after a save or a rename elsewhere).
  const [seen, setSeen] = useState(`${role.label}|${role.groupLabel}`);
  if (seen !== `${role.label}|${role.groupLabel}`) {
    setSeen(`${role.label}|${role.groupLabel}`);
    setLabel(role.label);
    setGroupLabel(role.groupLabel);
  }
  const dirty = label.trim() !== role.label || groupLabel.trim() !== role.groupLabel;
  const isDefault = role.id === DEFAULT_AGENT_ROLE;
  const inputClass =
    "w-full rounded-lg border border-[#dfe6ea] bg-white px-2.5 py-1.5 text-sm text-[#17242d]";

  return (
    <tr className="border-t border-[#edf1f3]">
      <td className="px-2 py-2">
        <span className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={busy || index === 0}
            className="rounded-lg p-1 text-[#5d6d75] hover:bg-[#eef2f3] disabled:opacity-30"
            aria-label="הזזה למעלה"
            title="למעלה"
          >
            <ArrowUp size={14} />
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={busy || index === count - 1}
            className="rounded-lg p-1 text-[#5d6d75] hover:bg-[#eef2f3] disabled:opacity-30"
            aria-label="הזזה למטה"
            title="למטה"
          >
            <ArrowDown size={14} />
          </button>
          <span className="w-5 text-center text-xs text-[#a3adb1]">{index + 1}</span>
        </span>
      </td>
      <td className="px-2 py-2">
        <input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={40} className={inputClass} />
      </td>
      <td className="px-2 py-2">
        <input value={groupLabel} onChange={(event) => setGroupLabel(event.target.value)} maxLength={40} className={inputClass} />
      </td>
      <td className="px-2 py-2 text-center text-[#5d6d75]">{role.agentCount}</td>
      <td className="px-2 py-2">
        <span className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={() => void onSave(label.trim(), groupLabel.trim())}
            disabled={busy || !dirty || !label.trim() || !groupLabel.trim()}
            className="inline-flex items-center gap-1 rounded-lg bg-[#158f83] px-2.5 py-1.5 text-xs font-bold text-white disabled:opacity-40"
          >
            <Save size={13} />
            שמירה
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`למחוק את התפקיד ״${role.label}״?`)) void onDelete();
            }}
            disabled={busy || isDefault || role.agentCount > 0}
            title={
              isDefault
                ? "תפקיד ברירת המחדל לא נמחק"
                : role.agentCount > 0
                  ? "יש נציגות בתפקיד הזה"
                  : "מחיקה"
            }
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-bold text-[#c7502f] hover:bg-[#fdebed] disabled:opacity-30"
          >
            <Trash2 size={13} />
            מחיקה
          </button>
        </span>
      </td>
    </tr>
  );
}
