"use client";

import type { CheckInResponse } from "@/types/checkins";
import type { ObjectiveStatus } from "@/types/checkins";

function dotColor(status: ObjectiveStatus | null | undefined): string {
  if (!status) return "#e7e7e7";
  if (status === "ON_TRACK" || status === "COMPLETE") return "#34d399";
  if (status === "AT_RISK") return "#fbbf24";
  if (status === "BEHIND") return "#f87171";
  return "#e7e7e7";
}

interface TrafficLightDotsProps {
  responses: CheckInResponse[];
}

export function TrafficLightDots({ responses }: TrafficLightDotsProps) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {responses.map((r) => {
        const status = (r.mgr_status_override ?? r.employee_status) as ObjectiveStatus | null | undefined;
        const color = dotColor(status);
        return (
          <span
            key={r.id}
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ background: color, border: "1px solid rgba(13,13,13,0.1)" }}
            title={status ?? "Not set"}
          />
        );
      })}
    </div>
  );
}
