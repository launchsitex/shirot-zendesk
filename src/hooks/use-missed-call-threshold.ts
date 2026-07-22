"use client";

import { useEffect, useState } from "react";

export function useMissedCallThreshold() {
  const [thresholdSeconds, setThresholdSeconds] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/settings/missed-call-threshold", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "load_failed");
        setThresholdSeconds(Number(payload.thresholdSeconds) || 0);
        setError("");
      })
      .catch((reason) => {
        if (reason.name === "AbortError") return;
        setError(
          reason instanceof Error
            ? reason.message
            : "טעינת סף שיחות שלא נענו נכשלה",
        );
      });
    return () => controller.abort();
  }, []);

  return { thresholdSeconds, error };
}
