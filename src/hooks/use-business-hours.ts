"use client";

import { useEffect, useState } from "react";
import type { BusinessHoursConfig } from "@/lib/business-hours";

export function useBusinessHoursConfig() {
  const [config, setConfig] = useState<BusinessHoursConfig | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/settings/business-hours", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "load_failed");
        setConfig(payload);
        setError("");
      })
      .catch((reason) => {
        if (reason.name === "AbortError") return;
        setError(
          reason instanceof Error ? reason.message : "טעינת שעות פעילות נכשלה",
        );
      });
    return () => controller.abort();
  }, []);

  return { config, error };
}
