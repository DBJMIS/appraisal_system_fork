/**
 * neutral = draft/closed, progress = lavender (active work), warning = amber (pending/waiting),
 * success = mint (complete), attention = coral (problem/overdue), info = blue-gray (informational only).
 */
export type StatusTone = "neutral" | "info" | "progress" | "warning" | "success" | "attention";

export const statusToneClasses: Record<StatusTone, { badge: string; dot: string }> = {
  neutral: { badge: "border-ds-border bg-ds-surface text-ds-text-secondary", dot: "bg-ds-text-muted" },
  info: { badge: "border-ds-info-border bg-ds-info-subtle text-ds-info", dot: "bg-ds-info" },
  progress: { badge: "border-ds-lavender-border bg-ds-lavender-subtle text-ds-lavender-text", dot: "bg-ds-lavender" },
  warning: { badge: "border-ds-warning-border bg-ds-warning-subtle text-ds-warning", dot: "bg-ds-amber" },
  success: { badge: "border-ds-success-border bg-ds-success-subtle text-ds-success", dot: "bg-ds-mint" },
  attention: { badge: "border-ds-error-border bg-ds-error-subtle text-ds-error", dot: "bg-ds-coral" },
};

/** Same tones for components that style with `style={{ ... }}`. */
export const statusToneStyle: Record<StatusTone, { bg: string; border: string; color: string; dot: string }> = {
  neutral: { bg: "var(--ds-surface)", border: "var(--ds-border)", color: "var(--ds-text-secondary)", dot: "var(--ds-text-muted)" },
  info: { bg: "var(--ds-info-subtle)", border: "var(--ds-info-border)", color: "var(--ds-info)", dot: "var(--ds-info)" },
  progress: { bg: "var(--ds-lavender-subtle)", border: "var(--ds-lavender-border)", color: "var(--ds-lavender-text)", dot: "var(--ds-lavender)" },
  warning: { bg: "var(--ds-warning-subtle)", border: "var(--ds-warning-border)", color: "var(--ds-warning)", dot: "var(--ds-amber)" },
  success: { bg: "var(--ds-success-subtle)", border: "var(--ds-success-border)", color: "var(--ds-success)", dot: "var(--ds-mint)" },
  attention: { bg: "var(--ds-error-subtle)", border: "var(--ds-error-border)", color: "var(--ds-error)", dot: "var(--ds-coral)" },
};

export const statusConfig: Record<string, { tone: StatusTone; label: string }> = {
  DRAFT: { tone: "neutral", label: "Draft" },
  PENDING_APPROVAL: { tone: "warning", label: "Pending Approval" },
  IN_PROGRESS: { tone: "progress", label: "In progress" },
  SELF_ASSESSMENT: { tone: "progress", label: "Self Assessment" },
  SUBMITTED: { tone: "success", label: "Submitted" },
  MANAGER_REVIEW: { tone: "warning", label: "Manager Review" },
  PENDING_SIGNOFF: { tone: "warning", label: "Pending Sign-off" },
  HR_REVIEW: { tone: "warning", label: "HR Review" },
  COMPLETE: { tone: "success", label: "Complete" },
};
