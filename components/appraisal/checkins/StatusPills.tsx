"use client";

import type { ObjectiveStatus } from "@/types/checkins";

const PILLS: { value: ObjectiveStatus; label: string; bg: string; border: string; text: string }[] = [
  { value: "ON_TRACK", label: "On track", bg: "#ecfdf5", border: "#bbf0d9", text: "#2e7d4f" },
  { value: "AT_RISK", label: "At risk", bg: "#fffbeb", border: "#fbe3a1", text: "#8a5a00" },
  { value: "BEHIND", label: "Behind", bg: "#fef2f2", border: "#fbd5d5", text: "#b42318" },
];

interface StatusPillsProps {
  value: ObjectiveStatus | null;
  onChange: (s: ObjectiveStatus) => void;
  disabled?: boolean;
}

export function StatusPills({ value, onChange, disabled }: StatusPillsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {PILLS.map((p) => {
        const selected = value === p.value;
        return (
          <button
            key={p.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(p.value)}
            className="inline-flex items-center px-3 py-1.5 rounded-[8px] border text-[11px] font-semibold transition-colors"
            style={{
              background: selected ? p.bg : "#f3f3f3",
              borderColor: selected ? p.border : "#e7e7e7",
              color: selected ? p.text : "#646f79",
              cursor: disabled ? "not-allowed" : "pointer",
              opacity: disabled ? 0.7 : 1,
            }}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}
