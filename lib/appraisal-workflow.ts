/**
 * Appraisal workflow: transition rules.
 * PENDING_APPROVAL → IN_PROGRESS on workplan approval; IN_PROGRESS → SELF_ASSESSMENT when employee starts self-assessment.
 */

import type { AppraisalStatus } from "@/types/appraisal";
import type { SupabaseClient } from "@supabase/supabase-js";

export const VALID_TRANSITIONS: Record<AppraisalStatus, AppraisalStatus[]> = {
  DRAFT: ["PENDING_APPROVAL"],
  PENDING_APPROVAL: ["IN_PROGRESS", "DRAFT"],
  IN_PROGRESS: ["SELF_ASSESSMENT"],
  SELF_ASSESSMENT: ["MANAGER_REVIEW"],
  SUBMITTED: ["MANAGER_REVIEW"],
  MANAGER_REVIEW: ["SELF_ASSESSMENT"],
  PENDING_SIGNOFF: ["HR_REVIEW", "MANAGER_REVIEW"],
  // deprecated - retained for legacy records only
  HOD_REVIEW: ["HR_REVIEW"],
  HR_REVIEW: ["COMPLETE"],
  COMPLETE: [],
};

export class InvalidAppraisalTransitionError extends Error {
  readonly code = "INVALID_APPRAISAL_TRANSITION";
  constructor(
    public readonly current: AppraisalStatus,
    public readonly next: AppraisalStatus
  ) {
    super(
      `Invalid appraisal status transition: ${current} → ${next}. Allowed: ${(VALID_TRANSITIONS[current] ?? []).join(", ") || "none"}.`
    );
    this.name = "InvalidAppraisalTransitionError";
  }
}

export function assertTransition(
  current: AppraisalStatus,
  next: AppraisalStatus
): void {
  const allowed = VALID_TRANSITIONS[current];
  if (!allowed?.includes(next)) {
    throw new InvalidAppraisalTransitionError(current, next);
  }
}

export async function transitionStatus(
  supabase: SupabaseClient,
  appraisalId: string,
  toStatus: AppraisalStatus,
  userId: string,
  note?: string
): Promise<{ error: string | null }> {
  const { data: row, error: fetchErr } = await supabase
    .from("appraisals")
    .select("status")
    .eq("id", appraisalId)
    .single();

  if (fetchErr || !row) {
    return { error: "Appraisal not found" };
  }

  const fromStatus = (row.status as string) as AppraisalStatus;
  assertTransition(fromStatus, toStatus);

  const updatePayload: Record<string, unknown> = { status: toStatus };
  if (toStatus === "SUBMITTED" || toStatus === "MANAGER_REVIEW") updatePayload.submitted_at = new Date().toISOString();
  if (toStatus === "PENDING_SIGNOFF") updatePayload.manager_completed_at = new Date().toISOString();
  if (toStatus === "COMPLETE") updatePayload.hr_closed_at = new Date().toISOString();

  // Conditional on the status just read, so a concurrent or repeated request cannot apply the same transition twice.
  const { data: updated, error: updateErr } = await supabase
    .from("appraisals")
    .update(updatePayload)
    .eq("id", appraisalId)
    .eq("status", fromStatus)
    .select("id");

  if (updateErr) {
    console.error("[appraisal-workflow] status update failed", { appraisalId, toStatus, code: updateErr.code });
    return { error: "Could not update the appraisal status. Please try again." };
  }
  if (!updated || updated.length === 0) {
    return { error: "This appraisal was updated by someone else. Refresh the page and try again." };
  }

  const { error: timelineErr } = await supabase.from("appraisal_timeline").insert({
    appraisal_id: appraisalId,
    from_status: fromStatus,
    to_status: toStatus,
    changed_by: userId,
    note: note ?? null,
  });
  if (timelineErr) {
    console.error("[appraisal-workflow] timeline insert failed", { appraisalId, toStatus, code: timelineErr.code });
  }

  const auditSummary = (note && note.trim()) ? note.trim() : `${fromStatus} → ${toStatus}`;
  const { error: auditErr } = await supabase.from("appraisal_audit").insert({
    appraisal_id: appraisalId,
    action_type: "status_change",
    actor_id: userId,
    summary: auditSummary,
  });
  if (auditErr) {
    console.error("[appraisal-workflow] audit insert failed", { appraisalId, toStatus, code: auditErr.code });
  }

  return { error: null };
}

export type WorkflowRole = "EMPLOYEE" | "MANAGER" | "HOD" | "HR";

export type EditableField =
  | "workplan_structure"
  | "actual_ytd"
  | "self_rating"
  | "self_comments"
  | "manager_rating"
  | "manager_comments";

export function canEditField(
  field: EditableField,
  status: AppraisalStatus,
  userRole: WorkflowRole
): boolean {
  const draftBoth = status === "DRAFT" && (userRole === "EMPLOYEE" || userRole === "MANAGER");
  const rules: Record<EditableField, boolean> = {
    workplan_structure: draftBoth,
    actual_ytd: status === "SELF_ASSESSMENT" && userRole === "EMPLOYEE",
    self_rating: status === "SELF_ASSESSMENT" && userRole === "EMPLOYEE",
    self_comments: status === "SELF_ASSESSMENT" && userRole === "EMPLOYEE",
    manager_rating: status === "MANAGER_REVIEW" && userRole === "MANAGER",
    manager_comments: status === "MANAGER_REVIEW" && userRole === "MANAGER",
  };
  return rules[field] ?? false;
}
