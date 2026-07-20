"use client";

import { useState, type FormEvent } from "react";
import { Headphones, LoaderCircle, LockKeyhole, Mail } from "lucide-react";
import {
  createSupabaseBrowserClient,
  isSupabaseBrowserConfigured,
} from "@/lib/supabase/browser";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isSignup, setIsSignup] = useState(false);
  const configured = isSupabaseBrowserConfigured();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!configured) {
      window.location.href = "/dashboard";
      return;
    }

    setLoading(true);
    setError("");
    const client = createSupabaseBrowserClient();
    const result = isSignup
      ? await client.auth.signUp({ email, password })
      : await client.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (result.error) {
      setError(
        isSignup
          ? "לא ניתן ליצור משתמש. ייתכן שההרשמה חסומה או שהמשתמש כבר קיים."
          : "פרטי ההתחברות אינם נכונים",
      );
      return;
    }
    if (isSignup && !result.data.session) {
      setError("המשתמש נוצר. יש לאשר את הקישור שנשלח לדואר האלקטרוני.");
      return;
    }
    window.location.href = "/dashboard";
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#102d38] p-5">
      <div className="w-full max-w-[430px] rounded-[28px] bg-white p-8 shadow-2xl">
        <div className="mb-8 text-center">
          <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#e4f5f2] text-[#158f83]">
            <Headphones size={29} />
          </span>
          <h1 className="text-2xl font-bold">City Live</h1>
          <p className="mt-2 text-sm text-[#6e7c85]">
            מרכז השליטה של רהיטי הסיטי
          </p>
        </div>
        <form className="space-y-4" onSubmit={onSubmit}>
          <label className="block text-sm font-semibold">
            דואר אלקטרוני
            <span className="mt-2 flex items-center gap-2 rounded-xl border border-[#e2e9ed] px-3">
              <Mail size={17} className="text-[#89969e]" />
              <input
                className="h-12 w-full outline-none"
                dir="ltr"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required={configured}
              />
            </span>
          </label>
          <label className="block text-sm font-semibold">
            סיסמה
            <span className="mt-2 flex items-center gap-2 rounded-xl border border-[#e2e9ed] px-3">
              <LockKeyhole size={17} className="text-[#89969e]" />
              <input
                className="h-12 w-full outline-none"
                dir="ltr"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required={configured}
              />
            </span>
          </label>
          {error && <p className="text-sm text-[#c33c45]">{error}</p>}
          <button
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#158f83] font-bold text-white hover:bg-[#11796f]"
            disabled={loading}
          >
            {loading && <LoaderCircle className="animate-spin" size={18} />}
            {configured
              ? isSignup
                ? "יצירת משתמש מנהל ראשון"
                : "כניסה למערכת"
              : "כניסה למצב הדגמה"}
          </button>
          {configured && (
            <button
              type="button"
              className="w-full text-sm font-semibold text-[#158f83]"
              onClick={() => {
                setError("");
                setIsSignup((value) => !value);
              }}
            >
              {isSignup
                ? "כבר יש לי משתמש — מעבר לכניסה"
                : "אין עדיין משתמש — יצירת מנהל ראשון"}
            </button>
          )}
        </form>
      </div>
    </main>
  );
}
