"use client";

import { Clock3, Headphones, PhoneMissed, Sparkles } from "lucide-react";
import { useState } from "react";
import { AiAnalysisSettingsClient } from "@/components/ai-analysis-settings";
import { AircallSettingsClient } from "@/components/aircall-settings-client";
import { BusinessHoursSettingsClient } from "@/components/business-hours-settings";
import { MissedCallNotificationSettingsClient } from "@/components/missed-call-notification-settings";
import { MissedCallThresholdSettingsClient } from "@/components/missed-call-threshold-settings";

type TabId = "missed-calls" | "business-hours" | "ai" | "aircall";

const TABS: { id: TabId; label: string; icon: typeof Clock3 }[] = [
  { id: "missed-calls", label: "שיחות שלא נענו", icon: PhoneMissed },
  { id: "business-hours", label: "שעות פעילות", icon: Clock3 },
  { id: "ai", label: "בינה מלאכותית", icon: Sparkles },
  { id: "aircall", label: "Aircall", icon: Headphones },
];

export function SettingsTabs() {
  const [active, setActive] = useState<TabId>("missed-calls");

  return (
    <div className="space-y-5">
      <div className="card flex flex-wrap gap-1.5 p-1.5" role="tablist">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = active === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(tab.id)}
              className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
                isActive
                  ? "bg-[#158f83] text-white"
                  : "text-[#5d6d75] hover:bg-[#f3f6f7]"
              }`}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          );
        })}
      </div>

      <div className="space-y-5">
        {active === "missed-calls" && (
          <>
            <MissedCallThresholdSettingsClient />
            <MissedCallNotificationSettingsClient />
          </>
        )}
        {active === "business-hours" && <BusinessHoursSettingsClient />}
        {active === "ai" && <AiAnalysisSettingsClient />}
        {active === "aircall" && <AircallSettingsClient />}
      </div>
    </div>
  );
}
