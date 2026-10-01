"use client";

import { cn } from "@/lib/utils";
import { statusToneClasses, type StatusTone } from "@/lib/appraisal-status-display";

type Status = 
  | "draft" 
  | "pending" 
  | "self_submitted" 
  | "manager_in_review" 
  | "manager_completed" 
  | "employee_acknowledged" 
  | "hr_in_review" 
  | "complete" 
  | "closed"
  | "open";

interface StatusBadgeProps {
  status: string;
  className?: string;
}

const toneClasses = statusToneClasses;

const statusConfig: Record<string, { tone: StatusTone; label: string }> = {
  DRAFT: { tone: "neutral", label: "Draft" },
  PENDING_APPROVAL: { tone: "warning", label: "Pending Approval" },
  SELF_ASSESSMENT: { tone: "progress", label: "Self Assessment" },
  SUBMITTED: { tone: "success", label: "Submitted" },
  MANAGER_REVIEW: { tone: "warning", label: "Manager Review" },
  PENDING_SIGNOFF: { tone: "warning", label: "Pending Sign-off" },
  HOD_REVIEW: { tone: "warning", label: "HOD Review" },
  HR_REVIEW: { tone: "warning", label: "HR Review" },
  COMPLETE: { tone: "success", label: "Complete" },
  draft: { tone: "neutral", label: "Draft" },
  pending: { tone: "warning", label: "Pending" },
  self_submitted: { tone: "warning", label: "Self Submitted" },
  manager_in_review: { tone: "warning", label: "In Review" },
  manager_completed: { tone: "success", label: "Manager Completed" },
  employee_acknowledged: { tone: "success", label: "Acknowledged" },
  hr_in_review: { tone: "warning", label: "HR Review" },
  complete: { tone: "success", label: "Complete" },
  closed: { tone: "neutral", label: "Closed" },
  open: { tone: "success", label: "Open" },
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status] ?? {
    tone: "neutral" as const,
    label: status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
  };
  const tone = toneClasses[config.tone];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-ds-badge border px-1.5 py-0.5 text-xs font-medium leading-4",
        tone.badge,
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot)} aria-hidden="true" />
      {config.label}
    </span>
  );
}
