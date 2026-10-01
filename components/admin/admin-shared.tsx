"use client";

import React from "react";
import { cycleReminderPolicy } from "@/lib/appraisal-reminder-policy";

export interface Cycle {
  id: string;
  name: string;
  cycle_type: string;
  fiscal_year: string;
  start_date: string;
  end_date: string;
  status: string;
  phase?: string;
  midyear_review_enabled?: boolean;
  midyear_scoring_enabled?: boolean;
  midyear_window_start?: string | null;
  midyear_due_date?: string | null;
  reminder_days_before?: number[] | null;
  overdue_reminder_days?: number[] | null;
  final_review_notice_days?: number | null;
}

export interface Category {
  id: string;
  name: string;
  category_type: string;
  applies_to: string | null;
  active: boolean;
}

export interface Factor {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  display_order: number;
  weight: number | null;
  active: boolean;
  category_name?: string;
}

export interface RatingRow {
  id: string;
  code: string;
  factor: number;
  label: string;
}

export interface Rule {
  id: string;
  rating_label: string;
  recommendation: string;
  description: string | null;
  active: boolean;
}

export interface FeedbackCycle {
  id: string;
  cycle_name: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  linked_appraisal_cycle_id: string;
  peer_feedback_visible_to_reviewee?: boolean;
  direct_report_feedback_visible_to_reviewee?: boolean;
}

export type CategoryForm = { name: string; category_type: string; applies_to: string };
export type FactorForm = { category_id: string; name: string; description: string; display_order: number; weight: number };
export type RuleForm = { rating_label: string; recommendation: string; description: string };
export type CycleForm = {
  cycle_type: string;
  fiscal_year: string;
  start_date: string;
  end_date: string;
  midyear_review_enabled: boolean;
  midyear_scoring_enabled: boolean;
  midyear_window_start: string;
  midyear_due_date: string;
  /** Reminder settings as typed, e.g. "7, 3, 1, 0"; parsed and validated on save. */
  reminder_days_before: string;
  overdue_reminder_days: string;
  final_review_notice_days: string;
};

/** Form text for a cycle's reminder settings (its stored values, or the defaults). */
export function reminderFormFields(c: Partial<Cycle> | null): Pick<CycleForm, "reminder_days_before" | "overdue_reminder_days" | "final_review_notice_days"> {
  const policy = cycleReminderPolicy(c);
  return {
    reminder_days_before: policy.daysBefore.join(", "),
    overdue_reminder_days: policy.overdueDays.join(", "),
    final_review_notice_days: String(policy.finalReviewNoticeDays),
  };
}

export const emptyCategoryForm: CategoryForm = { name: "", category_type: "core", applies_to: "both" };
export const emptyFactorForm: FactorForm = { category_id: "", name: "", description: "", display_order: 0, weight: 0 };
export const emptyRuleForm: RuleForm = { rating_label: "", recommendation: "", description: "" };
export const emptyCycleForm: CycleForm = {
  cycle_type: "annual",
  fiscal_year: "",
  start_date: "",
  end_date: "",
  midyear_review_enabled: false,
  midyear_scoring_enabled: false,
  midyear_window_start: "",
  midyear_due_date: "",
  ...reminderFormFields(null),
};

export function cycleToForm(c: Cycle): CycleForm {
  return {
    cycle_type: c.cycle_type,
    fiscal_year: c.fiscal_year,
    start_date: c.start_date,
    end_date: c.end_date,
    midyear_review_enabled: c.midyear_review_enabled === true,
    midyear_scoring_enabled: c.midyear_review_enabled === true && c.midyear_scoring_enabled === true,
    midyear_window_start: c.midyear_window_start ?? "",
    midyear_due_date: c.midyear_due_date ?? "",
    ...reminderFormFields(c),
  };
}

/** Mid-Year status label for the cycle list. */
export function cycleMidyearStatus(c: Cycle): "Off" | "On" | "Scored" {
  if (c.midyear_review_enabled !== true) return "Off";
  return c.midyear_scoring_enabled === true ? "Scored" : "On";
}

export const CalendarIcon = () => (
  <svg style={{ width: 16, height: 16 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

export const LayersIcon = () => (
  <svg style={{ width: 16, height: 16 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polygon points="12 2 2 7 12 12 22 7 12 2" />
    <polyline points="2 17 12 22 22 17" />
    <polyline points="2 12 12 17 22 12" />
  </svg>
);

export const ListIcon = () => (
  <svg style={{ width: 16, height: 16 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" />
    <line x1="3" y1="12" x2="3.01" y2="12" />
    <line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
);

export const StarIcon = () => (
  <svg style={{ width: 16, height: 16 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

export const AwardIcon = () => (
  <svg style={{ width: 16, height: 16 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="8" r="6" />
    <path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" />
  </svg>
);

export const UsersIcon = () => (
  <svg style={{ width: 16, height: 16 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

export const RefreshIcon = ({ spinning }: { spinning?: boolean }) => (
  <svg style={{ width: 14, height: 14, animation: spinning ? "spin 1s linear infinite" : "none" }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);

export const PlusIcon = () => (
  <svg style={{ width: 14, height: 14 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

export const PencilIcon = () => (
  <svg style={{ width: 14, height: 14 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
  </svg>
);

export const TrashIcon = () => (
  <svg style={{ width: 14, height: 14 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

export const PlayIcon = () => (
  <svg style={{ width: 12, height: 12 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

export const LockIcon = () => (
  <svg style={{ width: 12, height: 12 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

export const Feedback360Icon = () => (
  <svg style={{ width: 16, height: 16 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </svg>
);

export const thStyle: React.CSSProperties = {
  padding: "10px 16px",
  textAlign: "left",
  fontSize: "10.5px",
  fontWeight: 600,
  letterSpacing: "0.07em",
  textTransform: "uppercase",
  color: "#646f79",
  background: "#f3f3f3",
  borderBottom: "1px solid #e7e7e7",
  whiteSpace: "nowrap",
};

export const tdStyle: React.CSSProperties = {
  padding: "12px 16px",
  fontSize: "13.5px",
  verticalAlign: "middle",
  borderBottom: "1px solid #e7e7e7",
};

export const statusStyles: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  draft: { bg: "#f3f3f3", text: "#646f79", border: "#e7e7e7", dot: "#646f79" },
  open: { bg: "#ecfdf5", text: "#2e7d4f", border: "#bbf0d9", dot: "#34d399" },
  closed: { bg: "#f3f3f3", text: "#646f79", border: "#e7e7e7", dot: "#8b949e" },
};

export function CardWrapper({
  children,
  title,
  subtitle,
  icon,
  iconBg,
  iconColor,
  rightAction,
  delay,
}: {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  rightAction?: React.ReactNode;
  delay?: string;
}) {
  return (
    <div
      style={{
        background: "white",
        borderRadius: "8px",
        border: "1px solid #e7e7e7",
        boxShadow: "none",
        overflow: "hidden",
        marginBottom: "20px",
        animation: "fadeUp 0.4s ease both",
        animationDelay: delay,
      }}
    >
      <div
        style={{
          padding: "20px 24px 16px",
          borderBottom: "1px solid #e7e7e7",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "9px",
              background: iconBg,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: iconColor,
            }}
          >
            {icon}
          </div>
          <div>
            <div style={{ fontFamily: "var(--ds-font-sans)", fontSize: "15px", fontWeight: 600, color: "#0d0d0d", letterSpacing: "-0.01em" }}>{title}</div>
            {subtitle && <div style={{ fontSize: "12px", color: "#646f79", marginTop: "1px" }}>{subtitle}</div>}
          </div>
        </div>
        {rightAction}
      </div>
      <div style={{ overflowX: "auto" }}>{children}</div>
    </div>
  );
}

export function ActionButton({
  onClick,
  variant = "secondary",
  children,
  disabled,
}: {
  onClick: () => void;
  variant?: "primary" | "secondary" | "danger";
  children: React.ReactNode;
  disabled?: boolean;
}) {
  const styles: Record<string, React.CSSProperties> = {
    primary: { background: "#0d0e10", color: "white", border: "none", boxShadow: "none" },
    secondary: { background: "white", color: "#646f79", border: "1px solid #e7e7e7" },
    danger: { background: "#fef2f2", color: "#b42318", border: "1px solid #fbd5d5" },
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={(e) => {
        if (disabled) return;
        if (variant === "primary") {
          e.currentTarget.style.filter = "brightness(1.05)";
        } else if (variant === "danger") {
          e.currentTarget.style.background = "#fef2f2";
          e.currentTarget.style.borderColor = "#fbd5d5";
        } else {
          e.currentTarget.style.background = "#f3f3f3";
          e.currentTarget.style.borderColor = "#d0d4d8";
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.filter = "";
        if (variant === "primary") {
          e.currentTarget.style.background = "#0d0e10";
          e.currentTarget.style.borderColor = "transparent";
        } else if (variant === "danger") {
          e.currentTarget.style.background = "#fef2f2";
          e.currentTarget.style.borderColor = "#fbd5d5";
        } else {
          e.currentTarget.style.background = "white";
          e.currentTarget.style.borderColor = "#e7e7e7";
        }
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        padding: "7px 14px",
        borderRadius: "8px",
        fontSize: "13px",
        fontWeight: 500,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "all 0.15s",
        ...styles[variant],
      }}
    >
      {children}
    </button>
  );
}

export function IconButton({
  onClick,
  variant = "default",
  children,
}: {
  onClick: () => void;
  variant?: "default" | "danger";
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        width: "30px",
        height: "30px",
        borderRadius: "8px",
        background: variant === "danger" ? "#fef2f2" : "white",
        border: `1px solid ${variant === "danger" ? "#fbd5d5" : "#e7e7e7"}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: variant === "danger" ? "#b42318" : "#646f79",
        cursor: "pointer",
        transition: "all 0.15s",
      }}
    >
      {children}
    </button>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const style = statusStyles[status] || statusStyles.draft;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        padding: "3px 10px",
        borderRadius: "4px",
        fontSize: "11.5px",
        fontWeight: 600,
        background: style.bg,
        color: style.text,
        border: `1px solid ${style.border}`,
        textTransform: "capitalize",
      }}
    >
      <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: style.dot }} />
      {status}
    </span>
  );
}

export function EmptyTableRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} data-empty-state style={{ ...tdStyle, color: "#646f79", fontSize: "13px" }}>
        {children}
      </td>
    </tr>
  );
}

export function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "5px",
        padding: "3px 10px",
        borderRadius: "4px",
        fontSize: "11.5px",
        fontWeight: 600,
        background: active ? "#ecfdf5" : "#f3f3f3",
        color: active ? "#2e7d4f" : "#646f79",
        border: `1px solid ${active ? "#bbf0d9" : "#e7e7e7"}`,
      }}
    >
      <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: active ? "#2e7d4f" : "#646f79" }} />
      {active ? "Active" : "Inactive"}
    </span>
  );
}
