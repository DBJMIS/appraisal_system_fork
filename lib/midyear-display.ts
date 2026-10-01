/**
 * Presentation of the formal Mid-Year Review state, shared by the check-ins banner and the
 * appraisal header. Read-only: nothing here changes the review or the appraisal.
 */

import { isFormalReviewMode, type MidyearConfig } from "@/lib/midyear-config";
import type { StatusTone } from "@/lib/appraisal-status-display";
import type { MidyearRevision } from "@/types/checkins";

export interface FormalReviewLike {
  status: string;
  review_mode?: string | null;
}

/** The revision in progress on a reopened review: the latest one, while it is open and the review is not complete. */
export function openMidyearRevision(
  review: { status: string; midyear_revisions?: MidyearRevision[] | null } | null | undefined
): MidyearRevision | null {
  if (!review || review.status === "COMPLETE" || review.status === "CANCELLED") return null;
  const revisions = review.midyear_revisions ?? [];
  const latest = revisions[revisions.length - 1];
  return latest && latest.completed_at == null ? latest : null;
}

type TimelineReview = {
  status: string;
  employee_submitted_at: string | null;
  manager_reviewed_at: string | null;
  updated_at: string;
  midyear_revisions?: MidyearRevision[] | null;
  original_manager_reviewed_at?: string | null;
  responses?: Array<{ updated_at?: string | null }>;
  competency_ratings?: Array<{ updated_at?: string | null }>;
};

export interface MidyearReviewTimeline {
  /** The first manager submission; null only when a reopened review was resubmitted and its history is unavailable. */
  managerSubmittedAt: string | null;
  /** The latest manager save after that submission; null when there was none. */
  lastRevisedAt: string | null;
  completedAt: string | null;
  /** completedAt is the completion of a reopened review. */
  revisedCompletion: boolean;
}

const time = (value: string | null | undefined) => (value ? Date.parse(value) : NaN);

/**
 * Manager-review timestamps of a formal review, or null before the manager first submits.
 *
 * - Once the employee has submitted, only manager saves write the response and competency rows,
 *   so their updated_at marks manager activity. check_ins.updated_at is used only while the review
 *   is active, because COMPLETE and reopen also write it.
 * - manager_reviewed_at is rewritten when a reopened review is submitted again; the first
 *   submission then comes from original_manager_reviewed_at (audit trail).
 */
export function midyearReviewTimeline(review: TimelineReview): MidyearReviewTimeline | null {
  if (!review.manager_reviewed_at) return null;
  const revisions = review.midyear_revisions ?? [];
  const firstReopen = time(revisions[0]?.reopened_at);
  const latestReopen = time(revisions[revisions.length - 1]?.reopened_at);
  const resubmitted = time(review.manager_reviewed_at) > firstReopen;
  const original = review.original_manager_reviewed_at;
  const managerSubmittedAt = !resubmitted ? review.manager_reviewed_at : original && time(original) < firstReopen ? original : null;

  const employeeSubmitted = time(review.employee_submitted_at);
  const activity = [...(review.responses ?? []), ...(review.competency_ratings ?? [])]
    .map((r) => r.updated_at)
    .filter((t): t is string => time(t) > employeeSubmitted);
  activity.push(review.manager_reviewed_at);
  const active = review.status === "EMPLOYEE_SUBMITTED" || review.status === "MANAGER_REVIEWED";
  if (active && time(review.updated_at) > employeeSubmitted && !(time(review.updated_at) <= latestReopen)) {
    activity.push(review.updated_at);
  }
  const latest = activity.reduce((a, b) => (time(b) > time(a) ? b : a));
  const lastRevisedAt = managerSubmittedAt == null || time(latest) > time(managerSubmittedAt) ? latest : null;

  const latestRevision = revisions[revisions.length - 1];
  const complete = review.status === "COMPLETE";
  const revisedCompletion = complete && latestRevision?.completed_at != null;
  return {
    managerSubmittedAt,
    lastRevisedAt,
    completedAt: !complete ? null : revisedCompletion ? latestRevision!.completed_at : review.updated_at,
    revisedCompletion,
  };
}

/** Expects check-ins newest first (as the check-ins API returns them). */
export function pickCurrentFormalReview<T extends FormalReviewLike>(checkIns: T[]): T | null {
  const formal = checkIns.filter((c) => isFormalReviewMode(c.review_mode));
  return formal.find((c) => c.status !== "CANCELLED") ?? formal[0] ?? null;
}

/** A live review keeps the mode it was created with; otherwise the cycle setting applies. */
export function isMidyearScored(review: FormalReviewLike | null, midyear: Pick<MidyearConfig, "scoringEnabled">): boolean {
  return review && review.status !== "CANCELLED" ? review.review_mode === "FORMAL_SCORED" : midyear.scoringEnabled;
}

export type MidyearSubStatusState = "NOT_STARTED" | "EMPLOYEE_INPUT" | "MANAGER_REVIEW" | "COMPLETE";

export const MIDYEAR_SUB_STATUS: Record<MidyearSubStatusState, { label: string; tone: StatusTone }> = {
  NOT_STARTED: { label: "Not started", tone: "neutral" },
  EMPLOYEE_INPUT: { label: "Employee input", tone: "warning" },
  MANAGER_REVIEW: { label: "Manager review", tone: "progress" },
  COMPLETE: { label: "Complete", tone: "success" },
};

/**
 * MANAGER_REVIEWED still waits on the manager (completion), so it stays in Manager review.
 * A cancelled review is not in effect and has to be started again, so it reads as Not started.
 */
export function midyearSubStatusState(review: FormalReviewLike | null): MidyearSubStatusState {
  switch (review?.status) {
    case "OPEN":
      return "EMPLOYEE_INPUT";
    case "EMPLOYEE_SUBMITTED":
    case "MANAGER_REVIEWED":
      return "MANAGER_REVIEW";
    case "COMPLETE":
      return "COMPLETE";
    default:
      return "NOT_STARTED";
  }
}

/** Fired by the check-ins tab after it reloads, so the header follows the same data without a page refresh. */
export const MIDYEAR_REVIEW_UPDATED_EVENT = "midyear-review-updated";

export interface MidyearReviewUpdatedDetail {
  appraisalId: string;
  review: FormalReviewLike | null;
}
