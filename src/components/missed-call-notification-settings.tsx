"use client";

import { LoaderCircle, Mail, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

type Recipient = { id: string; email: string };

type NotificationState = {
  fromEmail: string;
  recipients: Recipient[];
};

export function MissedCallNotificationSettingsClient() {
  const [state, setState] = useState<NotificationState | null>(null);
  const [fromEmailDraft, setFromEmailDraft] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [error, setError] = useState("");
  const [savingFrom, setSavingFrom] = useState(false);
  const [addingRecipient, setAddingRecipient] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [savedFrom, setSavedFrom] = useState(false);

  useEffect(() => {
    fetch("/api/settings/missed-call-notifications", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "load_failed");
        setState(payload);
        setFromEmailDraft(payload.fromEmail ?? "");
      })
      .catch((loadError) =>
        setError(
          loadError instanceof Error
            ? loadError.message
            : "טעינת ההגדרה נכשלה",
        ),
      );
  }, []);

  async function saveFromEmail() {
    setSavingFrom(true);
    setSavedFrom(false);
    setError("");
    try {
      const response = await fetch("/api/settings/missed-call-notifications", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromEmail: fromEmailDraft }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "save_failed");
      setState(payload);
      setFromEmailDraft(payload.fromEmail ?? "");
      setSavedFrom(true);
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "שמירת כתובת השולח נכשלה",
      );
    } finally {
      setSavingFrom(false);
    }
  }

  async function addRecipient(event: React.FormEvent) {
    event.preventDefault();
    if (!newEmail.trim()) return;
    setAddingRecipient(true);
    setError("");
    try {
      const response = await fetch("/api/settings/missed-call-notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: newEmail.trim() }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "add_failed");
      setState(payload);
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
        `/api/settings/missed-call-notifications?id=${encodeURIComponent(recipient.id)}`,
        { method: "DELETE" },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "remove_failed");
      setState(payload);
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

  return (
    <section className="card space-y-6 p-5 md:p-6">
      <header className="flex items-start gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#fdebed] text-[#c8434c]">
          <Mail size={20} />
        </span>
        <div>
          <h2 className="text-lg font-bold">התראות מייל על שיחות שלא נענו</h2>
          <p className="mt-1 max-w-2xl text-sm text-[#718087]">
            מייל מעוצב יישלח בזמן אמת לכתובות שלמטה בכל שיחה נכנסת שלא נענתה,
            כולל שם המחלקה וזמן ההמתנה על הקו. שיחות שסווגו כ“לא נענה פחות
            זמן” (לפי הסף שהוגדר למעלה) לא ישלחו מייל.
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
          <div className="space-y-3 border-b border-[#edf1f3] pb-6">
            <span className="text-sm font-bold text-[#17242d]">
              כתובת השולח (from)
            </span>
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="email"
                dir="ltr"
                value={fromEmailDraft}
                onChange={(event) => {
                  setFromEmailDraft(event.target.value);
                  setSavedFrom(false);
                }}
                placeholder="alerts@your-domain.co.il"
                className="min-w-[240px] flex-1 rounded-xl border border-[#dfe6ea] bg-[#f8fafb] px-4 py-2.5 text-sm text-[#17242d]"
              />
              <button
                type="button"
                onClick={() => void saveFromEmail()}
                disabled={savingFrom}
                className="inline-flex items-center gap-2 rounded-xl bg-[#158f83] px-4 py-2.5 text-sm font-bold text-white transition hover:bg-[#11786e] disabled:opacity-60"
              >
                {savingFrom ? (
                  <LoaderCircle size={16} className="animate-spin" />
                ) : (
                  <Save size={16} />
                )}
                שמירה
              </button>
              {savedFrom && (
                <span className="text-sm font-semibold text-[#1f7a55]">
                  נשמר.
                </span>
              )}
            </div>
            <p className="text-xs text-[#a3adb1]">
              חייבת להיות כתובת מדומיין שאומת ב-Resend, אחרת שליחת המיילים
              תיכשל.
            </p>
          </div>

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
                עדיין לא נוספו כתובות מייל — לא יישלחו התראות עד שתוסיפו לפחות
                כתובת אחת.
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}
