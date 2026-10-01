import type { ReactNode } from "react";

export const WORKFLOW_STEPS = [
  { status: "DRAFT", label: "Draft", short: "1" },
  { status: "PENDING_APPROVAL", label: "Approval", short: "2" },
  { status: "IN_PROGRESS", label: "In progress", short: "3" },
  { status: "SELF_ASSESSMENT", label: "Self Assessment", short: "4" },
  { status: "MANAGER_REVIEW", label: "Manager Review", short: "5" },
  { status: "PENDING_SIGNOFF", label: "Sign-off", short: "6" },
  { status: "HR_REVIEW", label: "HR Review", short: "7" },
  { status: "COMPLETE", label: "Complete", short: "8" },
] as const;

interface AppraisalWorkflowStepsProps {
  currentStepIndex: number;
  /** Milestone within the In progress stage (e.g. the Mid-Year Review). It is not a workflow stage. */
  inProgressMilestone?: ReactNode;
}

export function AppraisalWorkflowSteps({ currentStepIndex, inProgressMilestone }: AppraisalWorkflowStepsProps) {
  const hasMilestone = inProgressMilestone != null;
  return (
    <ol
      className={`mb-4 flex w-full ${hasMilestone ? "items-start" : "items-center"} gap-2 overflow-x-auto`}
      aria-label="Appraisal workflow"
    >
      {WORKFLOW_STEPS.map((step, i) => {
        const isCompleted = i < currentStepIndex;
        const isCurrent = i === currentStepIndex;
        const node = (
          <span className="flex shrink-0 items-center gap-1.5" aria-current={isCurrent ? "step" : undefined}>
            <span
              className={`inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-[11px] font-medium ${
                isCurrent
                  ? "bg-ds-accent text-ds-on-primary"
                  : isCompleted
                    ? "bg-ds-surface text-ds-text-primary"
                    : "border border-ds-border text-ds-text-muted"
              }`}
            >
              {isCompleted ? "✓" : step.short}
            </span>
            <span
              className={`whitespace-nowrap text-xs ${
                isCurrent ? "font-semibold text-ds-text-primary" : isCompleted ? "font-medium text-ds-text-secondary" : "text-ds-text-secondary"
              }`}
            >
              {step.label}
            </span>
          </span>
        );
        const connector =
          i < WORKFLOW_STEPS.length - 1 ? (
            <span className={`h-px min-w-3 flex-1 ${isCompleted ? "bg-ds-text-muted" : "bg-ds-border"}`} aria-hidden="true" />
          ) : null;

        if (hasMilestone && step.status === "IN_PROGRESS") {
          // The li's width comes from the row, so the label never widens it; past 16rem the label wraps.
          return (
            <li key={step.status} className="flex min-w-0 flex-1 flex-col last:flex-none">
              <span className="flex items-center gap-2">
                {node}
                {connector}
              </span>
              <span className="mt-1 block w-max max-w-[16rem]" data-in-progress-milestone>
                {inProgressMilestone}
              </span>
            </li>
          );
        }

        return (
          <li key={step.status} className="flex min-w-0 flex-1 items-center gap-2 last:flex-none">
            {node}
            {connector}
          </li>
        );
      })}
    </ol>
  );
}
