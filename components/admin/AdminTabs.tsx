"use client";

import { useState } from "react";
import { CyclesTab } from "./tabs/CyclesTab";
import { CompetenciesTab } from "./tabs/CompetenciesTab";
import { RatingScaleTab } from "./tabs/RatingScaleTab";
import { RecommendationRulesTab } from "./tabs/RecommendationRulesTab";
import { VisibilityTab } from "./tabs/VisibilityTab";
import { EmployeeSyncTab } from "./tabs/EmployeeSyncTab";
import { EmailPreviewTab } from "./tabs/EmailPreviewTab";
import { ReminderRunPanel } from "./ReminderRunPanel";
import { NotificationActivityPanel } from "./NotificationActivityPanel";
import { OutstandingActionsPanel } from "./OutstandingActionsPanel";

const TABS = [
  { id: "cycles", label: "Appraisal cycles" },
  { id: "competencies", label: "Competencies" },
  { id: "ratings", label: "Rating scale" },
  { id: "rules", label: "Recommendation rules" },
  { id: "360-settings", label: "360 settings" },
  { id: "sync", label: "Employee sync" },
  { id: "email-preview", label: "Email & reminders" },
] as const;

export function AdminTabs() {
  const [active, setActive] = useState<string>("cycles");

  return (
    <>
      <div
        style={{
          display: "flex",
          gap: 0,
          borderBottom: "1px solid #e7e7e7",
          marginBottom: "24px",
        }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActive(tab.id)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px 16px",
              fontSize: "12px",
              fontWeight: 600,
              border: "none",
              borderBottom: active === tab.id ? "2px solid #0d0e10" : "2px solid transparent",
              marginBottom: active === tab.id ? "-1px" : "-1px",
              background: "none",
              color: active === tab.id ? "#0d0d0d" : "#646f79",
              cursor: "pointer",
              whiteSpace: "nowrap",
              transition: "color 0.15s, border-color 0.15s",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {active === "cycles" && <CyclesTab />}
      {active === "competencies" && <CompetenciesTab />}
      {active === "ratings" && <RatingScaleTab />}
      {active === "rules" && <RecommendationRulesTab />}
      {active === "360-settings" && <VisibilityTab />}
      {active === "sync" && <EmployeeSyncTab />}
      {active === "email-preview" && (
        <div className="space-y-6">
          <EmailPreviewTab />
          <ReminderRunPanel />
          <NotificationActivityPanel />
          <OutstandingActionsPanel />
        </div>
      )}
    </>
  );
}
