import type { CheckInReviewMode, MidyearConfig } from "@/lib/midyear-config";
import type { CompetencySection } from "@/lib/midyear-assessment";
import type { MidyearCompleteness } from "@/lib/midyear-lifecycle";

export type CheckInType = "MIDYEAR" | "QUARTERLY" | "ADHOC";

export type CheckInStatus =
  | "OPEN"
  | "EMPLOYEE_SUBMITTED"
  | "MANAGER_REVIEWED"
  | "COMPLETE"
  | "CANCELLED";

export type ObjectiveStatus = "ON_TRACK" | "AT_RISK" | "BEHIND" | "COMPLETE";

export interface CheckIn {
  id: string;
  appraisal_id: string;
  title: string;
  check_in_type: CheckInType;
  /** Absent on rows read before the review_mode column existed; treat as INFORMAL. */
  review_mode?: CheckInReviewMode;
  /** Frozen at formal Mid-Year Review creation; null/absent for informal check-ins. */
  is_management_track?: boolean | null;
  initiated_by: string | null;
  due_date: string | null;
  status: CheckInStatus;
  employee_submitted_at: string | null;
  manager_reviewed_at: string | null;
  manager_overall_notes: string | null;
  note_to_employee: string | null;
  created_at: string;
  updated_at: string;
}

export interface CheckInResponse {
  id: string;
  check_in_id: string;
  workplan_item_id: string;

  employee_status: ObjectiveStatus | null;
  progress_pct: number | null;
  employee_comment: string | null;
  employee_updated_at: string | null;

  mgr_status_override: ObjectiveStatus | null;
  mgr_comment: string | null;
  mgr_acknowledged_at: string | null;
  updated_at?: string | null;

  /** Formal Mid-Year Review workplan inputs; results come from lib/metric-calc.ts. */
  employee_actual_raw?: number | null;
  employee_completion_date?: string | null;
  employee_result?: number | null;
  mgr_actual_raw?: number | null;
  mgr_completion_date?: string | null;
  mgr_result?: number | null;
  weight_snapshot?: number | null;

  workplan_item?: {
    id: string;
    major_task: string;
    corporate_objective: string;
    division_objective: string;
    key_output: string;
    performance_standard: string;
    metric_target: number | null;
    metric_type: string | null;
    metric_deadline?: string | null;
    weight: number;
  };
}

export interface CheckInCompetencyRating {
  id: string;
  check_in_id: string;
  section: CompetencySection;
  factor_id: string | null;
  technical_competency_id: string | null;
  name_snapshot: string;
  weight_snapshot: number;
  display_order: number;
  employee_rating_code: string | null;
  manager_rating_code: string | null;
  employee_comment: string | null;
  manager_comment: string | null;
  updated_at?: string | null;
}

/** One reopening of a completed formal Mid-Year Review (midyear_review_revisions). */
export interface MidyearRevision {
  /** The review version being prepared: 2 for the first reopen. */
  revision_number: number;
  reopened_at: string;
  reopened_by: string;
  reopened_by_name: string | null;
  reopen_reason: string;
  previous_score_revision: number | null;
  completed_at: string | null;
  completed_by: string | null;
  score_revision: number | null;
}

export interface CheckInWithResponses extends CheckIn {
  responses: CheckInResponse[];
  initiated_by_employee?: { full_name: string };
  /** Present for formal Mid-Year Reviews only. */
  competency_ratings?: CheckInCompetencyRating[];
  /** Present for formal Mid-Year Reviews only; reflects saved values. */
  midyear_completeness?: MidyearCompleteness;
  /** Present for formal Mid-Year Reviews only; oldest first. */
  midyear_revisions?: MidyearRevision[];
  /**
   * Reopened formal reviews only: the first manager submission, from the audit trail. Needed because
   * manager_reviewed_at is rewritten when the revised review is submitted again.
   */
  original_manager_reviewed_at?: string | null;
}

/** How the current user relates to the appraisal, as resolved by the server. */
export interface CheckInAccess {
  isEmployee: boolean;
  hasManagerAccess: boolean;
  isDelegate: boolean;
  isHrAdmin: boolean;
}

export interface WorkplanItemForCheckIn {
  id: string;
  major_task: string;
  corporate_objective: string;
  division_objective: string;
  key_output: string;
  weight: number;
  metric_target: number | null;
}

export interface CheckInsPageData {
  checkIns: CheckInWithResponses[];
  appraisal: {
    id: string;
    employeeName: string;
    cycleLabel: string;
    status: string;
    manager_employee_id: string | null;
    employee_id: string;
  };
  workplanItems: WorkplanItemForCheckIn[];
  currentUser: { employee_id: string | null; roles: string[] };
  access?: CheckInAccess;
  midyear?: MidyearConfig;
  /** Present when a formal Mid-Year Review exists. */
  ratingScale?: Array<{ code: string; label: string }>;
}
