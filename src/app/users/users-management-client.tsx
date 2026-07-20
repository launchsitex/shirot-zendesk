"use client";

import {
  KeyRound,
  LoaderCircle,
  Pencil,
  Plus,
  Shield,
  Trash2,
  UserRoundCog,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppPageId, AppRole } from "@/lib/app-pages";

type ManagedUser = {
  id: string;
  email: string;
  displayName: string | null;
  role: AppRole;
  departmentId: string | null;
  departmentName: string | null;
  allowedPages: AppPageId[];
  createdAt: string;
  updatedAt: string;
};

type UsersPayload = {
  users: ManagedUser[];
  departments: { id: string; name: string }[];
  pages: { id: AppPageId; label: string }[];
};

type FormState = {
  email: string;
  displayName: string;
  password: string;
  role: AppRole;
  departmentId: string;
  allowedPages: AppPageId[];
};

const emptyForm = (defaultPages: AppPageId[]): FormState => ({
  email: "",
  displayName: "",
  password: "",
  role: "viewer",
  departmentId: "",
  allowedPages: defaultPages,
});

const roleLabels: Record<AppRole, string> = {
  admin: "מנהל מערכת",
  manager: "מנהל",
  viewer: "צופה",
};

export function UsersManagementClient() {
  const [data, setData] = useState<UsersPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm([]));
  const [showForm, setShowForm] = useState(false);

  const defaultPages = useMemo(
    () =>
      (data?.pages ?? [])
        .map((page) => page.id)
        .filter((id) => id !== "settings" && id !== "users"),
    [data?.pages],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/users", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setData(result);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "טעינת המשתמשים נכשלה",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm(defaultPages));
    setShowForm(true);
    setError("");
  }

  function openEdit(user: ManagedUser) {
    setEditingId(user.id);
    setForm({
      email: user.email,
      displayName: user.displayName ?? "",
      password: "",
      role: user.role,
      departmentId: user.departmentId ?? "",
      allowedPages:
        user.role === "admin"
          ? (data?.pages.map((page) => page.id) ?? [])
          : user.allowedPages,
    });
    setShowForm(true);
    setError("");
  }

  function togglePage(pageId: AppPageId) {
    setForm((current) => {
      const exists = current.allowedPages.includes(pageId);
      return {
        ...current,
        allowedPages: exists
          ? current.allowedPages.filter((id) => id !== pageId)
          : [...current.allowedPages, pageId],
      };
    });
  }

  async function saveUser(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        email: form.email,
        displayName: form.displayName,
        password: form.password || undefined,
        role: form.role,
        departmentId: form.departmentId || null,
        allowedPages: form.role === "admin" ? [] : form.allowedPages,
      };

      const response = await fetch("/api/users", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editingId ? { id: editingId, ...payload } : payload,
        ),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setShowForm(false);
      await load();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "שמירת המשתמש נכשלה",
      );
    } finally {
      setSaving(false);
    }
  }

  async function removeUser(user: ManagedUser) {
    if (!window.confirm(`למחוק את המשתמש ${user.displayName || user.email}?`)) {
      return;
    }
    setError("");
    try {
      const response = await fetch(`/api/users?id=${encodeURIComponent(user.id)}`, {
        method: "DELETE",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      await load();
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "מחיקת המשתמש נכשלה",
      );
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#e4f5f2] text-[#158f83]">
            <UserRoundCog size={23} />
          </span>
          <div>
            <h1 className="text-2xl font-bold">ניהול משתמשים</h1>
            <p className="mt-1 text-sm text-[#75838b]">
              יצירה, עריכה, מחיקה והרשאות גישה לעמודי המערכת
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-xl bg-[#158f83] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#11786e]"
        >
          <Plus size={17} />
          משתמש חדש
        </button>
      </header>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {showForm && (
        <section className="card p-6">
          <div className="mb-5 flex items-center gap-3">
            <Shield className="text-[#158f83]" size={22} />
            <div>
              <h2 className="font-bold">
                {editingId ? "עריכת משתמש" : "יצירת משתמש"}
              </h2>
              <p className="text-xs text-[#7a888f]">
                ניתן ליצור גם מנהל מערכת עם גישה מלאה לכל העמודים
              </p>
            </div>
          </div>

          <form onSubmit={saveUser} className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium text-[#44535b]">שם תצוגה</span>
                <input
                  required
                  value={form.displayName}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      displayName: event.target.value,
                    }))
                  }
                  className="w-full rounded-xl border border-[#d7e0e4] bg-white px-3 py-2.5 outline-none focus:border-[#158f83]"
                />
              </label>
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium text-[#44535b]">אימייל</span>
                <input
                  required
                  type="email"
                  disabled={Boolean(editingId)}
                  value={form.email}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                  className="w-full rounded-xl border border-[#d7e0e4] bg-white px-3 py-2.5 outline-none focus:border-[#158f83] disabled:bg-[#f3f6f7]"
                />
              </label>
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium text-[#44535b]">
                  {editingId ? "סיסמה חדשה (אופציונלי)" : "סיסמה"}
                </span>
                <input
                  required={!editingId}
                  type="password"
                  minLength={8}
                  value={form.password}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      password: event.target.value,
                    }))
                  }
                  className="w-full rounded-xl border border-[#d7e0e4] bg-white px-3 py-2.5 outline-none focus:border-[#158f83]"
                  placeholder={editingId ? "השאר ריק כדי לא לשנות" : "לפחות 8 תווים"}
                />
              </label>
              <label className="block space-y-1.5 text-sm">
                <span className="font-medium text-[#44535b]">תפקיד</span>
                <select
                  value={form.role}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      role: event.target.value as AppRole,
                    }))
                  }
                  className="w-full rounded-xl border border-[#d7e0e4] bg-white px-3 py-2.5 outline-none focus:border-[#158f83]"
                >
                  <option value="viewer">צופה</option>
                  <option value="manager">מנהל</option>
                  <option value="admin">מנהל מערכת</option>
                </select>
              </label>
              <label className="block space-y-1.5 text-sm md:col-span-2">
                <span className="font-medium text-[#44535b]">מחלקה</span>
                <select
                  value={form.departmentId}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      departmentId: event.target.value,
                    }))
                  }
                  className="w-full rounded-xl border border-[#d7e0e4] bg-white px-3 py-2.5 outline-none focus:border-[#158f83]"
                >
                  <option value="">ללא שיוך</option>
                  {(data?.departments ?? []).map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-[#44535b]">
                <KeyRound size={16} />
                עמודים מותרים
              </div>
              {form.role === "admin" ? (
                <p className="rounded-xl bg-[#e4f5f2] px-4 py-3 text-sm text-[#11786e]">
                  מנהל מערכת מקבל גישה מלאה לכל העמודים אוטומטית, כולל הגדרות
                  וניהול משתמשים.
                </p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {(data?.pages ?? [])
                    .filter(
                      (page) => page.id !== "settings" && page.id !== "users",
                    )
                    .map((page) => {
                      const checked = form.allowedPages.includes(page.id);
                      return (
                        <label
                          key={page.id}
                          className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition ${
                            checked
                              ? "border-[#158f83] bg-[#e4f5f2]"
                              : "border-[#d7e0e4] bg-white hover:border-[#b7c6cc]"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => togglePage(page.id)}
                            className="accent-[#158f83]"
                          />
                          {page.label}
                        </label>
                      );
                    })}
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-xl bg-[#158f83] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              >
                {saving ? (
                  <LoaderCircle className="animate-spin" size={16} />
                ) : null}
                {editingId ? "שמירת שינויים" : "יצירת משתמש"}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-xl border border-[#d7e0e4] px-4 py-2.5 text-sm text-[#44535b]"
              >
                ביטול
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="card overflow-hidden">
        <div className="flex items-center gap-3 border-b border-[#e8eef1] px-5 py-4">
          <Users className="text-[#158f83]" size={20} />
          <h2 className="font-bold">משתמשים במערכת</h2>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 px-5 py-10 text-sm text-[#75838b]">
            <LoaderCircle className="animate-spin" size={18} />
            טוען משתמשים...
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-[#f7fafb] text-[#6d7c84]">
                <tr>
                  <th className="px-4 py-3 text-right font-medium">שם</th>
                  <th className="px-4 py-3 text-right font-medium">אימייל</th>
                  <th className="px-4 py-3 text-right font-medium">תפקיד</th>
                  <th className="px-4 py-3 text-right font-medium">מחלקה</th>
                  <th className="px-4 py-3 text-right font-medium">עמודים</th>
                  <th className="px-4 py-3 text-right font-medium">פעולות</th>
                </tr>
              </thead>
              <tbody>
                {(data?.users ?? []).map((user) => (
                  <tr key={user.id} className="border-t border-[#eef3f5]">
                    <td className="px-4 py-3 font-medium">
                      {user.displayName || "—"}
                    </td>
                    <td className="px-4 py-3 text-[#5d6d75]">{user.email}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-semibold ${
                          user.role === "admin"
                            ? "bg-[#102d38] text-white"
                            : user.role === "manager"
                              ? "bg-[#e9b24a]/20 text-[#8a6418]"
                              : "bg-[#e4f5f2] text-[#11786e]"
                        }`}
                      >
                        {roleLabels[user.role]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[#5d6d75]">
                      {user.departmentName || "ללא"}
                    </td>
                    <td className="px-4 py-3 text-[#5d6d75]">
                      {user.role === "admin"
                        ? "הכל"
                        : `${user.allowedPages.length} עמודים`}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(user)}
                          className="rounded-lg bg-[#eef5f7] p-2 text-[#35515c] hover:bg-[#e1ecef]"
                          title="עריכה"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void removeUser(user)}
                          className="rounded-lg bg-red-50 p-2 text-red-600 hover:bg-red-100"
                          title="מחיקה"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(data?.users.length ?? 0) === 0 && (
              <p className="px-5 py-8 text-sm text-[#75838b]">אין משתמשים להצגה</p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
