"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

const NAVY = "#18376C";
const RED = "#E63447";

type LoadState =
  | { status: "loading" }
  | { status: "invalid" }
  | { status: "already_responded" }
  | { status: "ready"; customerName: string; orderNumber: string }
  | { status: "submitted" };

type Scores = {
  branch: number;
  coordination: number;
  mover: number;
};

const RATING_FIELDS: { key: keyof Scores; label: string }[] = [
  { key: "branch", label: "המוכר/ת והסניף" },
  { key: "coordination", label: "התיאום מול המשרד" },
  { key: "mover", label: "המוביל/ים" },
];

export function SurveyForm({ token }: { token: string }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [scores, setScores] = useState<Scores>({ branch: 0, coordination: 0, mover: 0 });
  const [feedbackPositive, setFeedbackPositive] = useState("");
  const [feedbackNegative, setFeedbackNegative] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/survey-public?token=${encodeURIComponent(token)}`,
        );
        const payload = await response.json();
        if (cancelled) return;
        if (!response.ok || !payload.valid) {
          setState({ status: "invalid" });
          return;
        }
        if (payload.alreadyResponded) {
          setState({ status: "already_responded" });
          return;
        }
        setState({
          status: "ready",
          customerName: payload.customerName ?? "",
          orderNumber: payload.orderNumber ?? "",
        });
      } catch {
        if (!cancelled) setState({ status: "invalid" });
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleSubmit() {
    if (scores.branch === 0 || scores.coordination === 0 || scores.mover === 0) {
      setSubmitError("נא לדרג את כל שלושת הנושאים לפני השליחה");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/survey-public`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token,
            scoreBranch: scores.branch,
            scoreCoordination: scores.coordination,
            scoreMover: scores.mover,
            feedbackPositive: feedbackPositive || null,
            feedbackNegative: feedbackNegative || null,
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok) {
        if (payload.error === "already_responded") {
          setState({ status: "already_responded" });
          return;
        }
        throw new Error(payload.error ?? "שגיאה בשליחה");
      }
      setState({ status: "submitted" });
    } catch {
      setSubmitError("אירעה שגיאה בשליחת הסקר. נסה/י שוב.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <div
        className="flex flex-col items-center gap-3 px-4 pb-8 pt-8"
        style={{ background: NAVY }}
      >
        <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-white shadow-sm">
          <Image
            src="/rcity-logo.png"
            alt="רהיטי הסיטי"
            width={56}
            height={56}
            className="h-14 w-14 object-contain"
            priority
          />
        </div>
        <h1 className="text-center text-lg font-bold text-white">
          איך היה השירות אצלנו?
        </h1>
        <div className="h-1 w-10 rounded-full" style={{ background: RED }} />
      </div>

      <div className="mx-auto -mt-5 w-full max-w-md flex-1 px-4 pb-10">
        <div className="rounded-2xl bg-white p-6 shadow-lg">
          {state.status === "loading" && (
            <p className="py-8 text-center text-sm text-gray-500">טוען...</p>
          )}

          {state.status === "invalid" && (
            <p className="py-8 text-center text-sm text-gray-600">
              הקישור אינו תקין או שפג תוקפו.
            </p>
          )}

          {state.status === "already_responded" && (
            <div className="py-8 text-center">
              <p className="mb-1 text-base font-semibold" style={{ color: NAVY }}>
                כבר ענית על הסקר הזה
              </p>
              <p className="text-sm text-gray-500">תודה רבה על הזמן שהקדשת!</p>
            </div>
          )}

          {state.status === "submitted" && (
            <div className="py-8 text-center">
              <p className="mb-1 text-base font-semibold" style={{ color: NAVY }}>
                תודה רבה!
              </p>
              <p className="text-sm text-gray-500">המשוב שלך התקבל ויעזור לנו להשתפר.</p>
            </div>
          )}

          {state.status === "ready" && (
            <div className="flex flex-col gap-6">
              <p className="text-sm text-gray-600">
                שלום {state.customerName}, נשמח לשמוע איך הייתה החוויה שלך בהזמנה{" "}
                <span className="font-semibold" style={{ color: NAVY }}>
                  {state.orderNumber}
                </span>
                .
              </p>

              {RATING_FIELDS.map((field) => (
                <StarRating
                  key={field.key}
                  label={field.label}
                  value={scores[field.key]}
                  onChange={(value) =>
                    setScores((previous) => ({ ...previous, [field.key]: value }))
                  }
                />
              ))}

              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium" style={{ color: NAVY }}>
                  מה היה טוב?
                </span>
                <textarea
                  className="min-h-20 rounded-lg border border-gray-200 p-3 text-sm outline-none transition focus:border-[#18376C] focus:ring-2 focus:ring-[#18376C]/15"
                  value={feedbackPositive}
                  onChange={(event) => setFeedbackPositive(event.target.value)}
                  placeholder="ספר/י לנו מה אהבת..."
                />
              </label>

              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium" style={{ color: NAVY }}>
                  מה אפשר לשפר?
                </span>
                <textarea
                  className="min-h-20 rounded-lg border border-gray-200 p-3 text-sm outline-none transition focus:border-[#18376C] focus:ring-2 focus:ring-[#18376C]/15"
                  value={feedbackNegative}
                  onChange={(event) => setFeedbackNegative(event.target.value)}
                  placeholder="נשמח לשמוע איך נוכל להשתפר..."
                />
              </label>

              {submitError && (
                <p className="text-sm" style={{ color: RED }}>
                  {submitError}
                </p>
              )}

              <button
                type="button"
                disabled={submitting}
                onClick={handleSubmit}
                className="rounded-lg py-3 text-sm font-semibold text-white transition disabled:opacity-60"
                style={{ background: NAVY }}
              >
                {submitting ? "שולח..." : "שליחת הסקר"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StarRating({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium" style={{ color: NAVY }}>
        {label}
      </span>
      <div className="flex flex-row-reverse justify-end gap-1" dir="ltr">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            aria-label={`${star} מתוך 5`}
            onClick={() => onChange(star)}
            className="text-3xl leading-none transition"
            style={{ color: star <= value ? NAVY : "#E0E0E0" }}
          >
            ★
          </button>
        ))}
      </div>
    </div>
  );
}
