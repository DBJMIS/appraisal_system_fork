/**
 * Formal Mid-Year Review lifecycle: completeness, role and status gates, audit events, and the
 * Self Assessment prerequisite. Informal check-ins are not governed by anything in this module.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadCycleMidyearConfig, type CheckInReviewMode } from "@/lib/midyear-config";
import type { CompetencySection } from "@/lib/midyear-assessment";

/** Formal Mid-Year actions only progress while the appraisal is in this status. */
export const MIDYEAR_APPRAISAL_STATUS = "IN_PROGRESS";

/** Formal check-in statuses that can still change (and can be cancelled). */
export const ACTIVE_FORMAL_STATUSES = ["OPEN", "EMPLOYEE_SUBMITTED", "MANAGER_REVIEWED"] as const;

export const isActiveFormalStatus = (status: string | null | undefined) =>
  (ACTIVE_FORMAL_STATUSES as readonly string[]).includes(String(status));

// ── Completeness ─────────────────────────────────────────────────────────────

export interface CompletenessResponse {
  weight_snapshot?: number | string | null;
  employee_result?: number | string | null;
  mgr_result?: number | string | null;
}

export interface CompletenessCompetency {
  section: CompetencySection | string;
  weight_snapshot?: number | string | null;
  employee_rating_code?: string | null;
  manager_rating_code?: string | null;
}

export interface MidyearCompleteness {
  /** Completeness is enforced only for scored Mid-Year Reviews. */
  required: boolean;
  weights: string[];
  employee: string[];
  manager: string[];
  /** Ready to be scored: weights present and every required item has a scoreable result/rating. */
  complete: boolean;
}

export type MidyearStage = "EMPLOYEE_SUBMIT" | "MANAGER_REVIEW" | "COMPLETE";

const SECTION_ORDER: CompetencySection[] = ["CORE", "PRODUCTIVITY", "TECHNICAL", "LEADERSHIP"];
const SECTION_LABELS: Record<CompetencySection, string> = {
  CORE: "Core competencies",
  PRODUCTIVITY: "Productivity",
  TECHNICAL: "Technical competencies",
  LEADERSHIP: "Leadership",
};

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const hasCode = (v: unknown) => v != null && String(v).trim() !== "";

/** A workplan objective the Mid-Year completeness rule requires: frozen weight above zero. */
export const isRequiredMidyearObjective = (r: CompletenessResponse) => (num(r.weight_snapshot) ?? 0) > 0;
/** Employee stage: the employee's own Mid-Year result is present. */
export const hasEmployeeMidyearResult = (r: CompletenessResponse) => num(r.employee_result) != null;
/** Manager stages: a scoreable result is present (the manager's, else the employee's). */
export const hasScoreableMidyearResult = (r: CompletenessResponse) => (num(r.mgr_result) ?? num(r.employee_result)) != null;

/**
 * Dedicated Mid-Year completeness (independent of the annual calcCompletion).
 * Required items are those with a frozen weight above zero. A workplan result is scoreable when the
 * manager result, else the employee result, is present. Comments are never required.
 */
export function calcMidyearCompleteness(input: {
  reviewMode: CheckInReviewMode | string | null | undefined;
  responses: CompletenessResponse[];
  competencies: CompletenessCompetency[];
  /**
   * Frozen track. When known, every section in the scoring formula must have competencies
   * (Leadership only for the management track) and Leadership rows are ignored off-track.
   */
  isManagementTrack?: boolean | null;
}): MidyearCompleteness {
  const { responses, isManagementTrack } = input;
  const competencies =
    isManagementTrack === false ? input.competencies.filter((c) => c.section !== "LEADERSHIP") : input.competencies;
  const required = input.reviewMode === "FORMAL_SCORED";

  const weights: string[] = [];
  if (responses.length === 0) {
    weights.push("Workplan: no objectives were captured for this Mid-Year Review.");
  } else {
    const missing = responses.filter((r) => num(r.weight_snapshot) == null).length;
    const total = responses.reduce((s, r) => s + (num(r.weight_snapshot) ?? 0), 0);
    if (missing > 0) weights.push(`Workplan: ${missing} objective weight(s) missing.`);
    else if (total <= 0) weights.push("Workplan: objective weights total 0%.");
  }
  for (const section of SECTION_ORDER) {
    const rows = competencies.filter((c) => c.section === section);
    const scoredSection = isManagementTrack != null && (section !== "LEADERSHIP" || isManagementTrack);
    if (rows.length === 0 && scoredSection) {
      weights.push(`${SECTION_LABELS[section]}: no competencies were captured for this Mid-Year Review.`);
    }
    if (rows.length === 0) continue;
    const missing = rows.filter((c) => num(c.weight_snapshot) == null).length;
    const total = rows.reduce((s, c) => s + (num(c.weight_snapshot) ?? 0), 0);
    if (missing > 0) weights.push(`${SECTION_LABELS[section]}: ${missing} weight(s) missing.`);
    else if (total <= 0) weights.push(`${SECTION_LABELS[section]}: weights total 0%.`);
  }

  const requiredResponses = responses.filter(isRequiredMidyearObjective);
  const requiredCompetencies = competencies.filter((c) => (num(c.weight_snapshot) ?? 0) > 0);

  const employee: string[] = [];
  const manager: string[] = [];
  const noEmployeeResult = requiredResponses.filter((r) => !hasEmployeeMidyearResult(r)).length;
  if (noEmployeeResult > 0) employee.push(`Workplan: ${noEmployeeResult} objective(s) missing an employee Mid-Year result.`);
  const noScoreable = requiredResponses.filter((r) => !hasScoreableMidyearResult(r)).length;
  if (noScoreable > 0) manager.push(`Workplan: ${noScoreable} objective(s) missing a scoreable Mid-Year result.`);

  for (const section of SECTION_ORDER) {
    const rows = requiredCompetencies.filter((c) => c.section === section);
    const noSelf = rows.filter((c) => !hasCode(c.employee_rating_code)).length;
    const noMgr = rows.filter((c) => !hasCode(c.manager_rating_code)).length;
    if (noSelf > 0) employee.push(`${SECTION_LABELS[section]}: ${noSelf} employee rating(s) missing.`);
    if (noMgr > 0) manager.push(`${SECTION_LABELS[section]}: ${noMgr} manager rating(s) missing.`);
  }

  return { required, weights, employee, manager, complete: !required || (weights.length === 0 && manager.length === 0) };
}

/** Blockers for moving a formal review past the given stage (none for unscored reviews). */
export function midyearStageBlockers(c: MidyearCompleteness, stage: MidyearStage): string[] {
  if (!c.required) return [];
  return stage === "EMPLOYEE_SUBMIT" ? [...c.weights, ...c.employee] : [...c.weights, ...c.manager];
}

export async function loadMidyearCompleteness(
  supabase: SupabaseClient,
  checkIn: { id: string; review_mode?: string | null; is_management_track?: boolean | null }
): Promise<MidyearCompleteness> {
  const [{ data: responses, error: rErr }, { data: competencies, error: cErr }] = await Promise.all([
    supabase.from("check_in_responses").select("weight_snapshot, employee_result, mgr_result").eq("check_in_id", checkIn.id),
    supabase
      .from("check_in_competency_ratings")
      .select("section, weight_snapshot, employee_rating_code, manager_rating_code")
      .eq("check_in_id", checkIn.id),
  ]);
  if (rErr || cErr) throw new Error((rErr ?? cErr)!.message);
  return calcMidyearCompleteness({
    reviewMode: checkIn.review_mode,
    responses: (responses ?? []) as CompletenessResponse[],
    competencies: (competencies ?? []) as CompletenessCompetency[],
    isManagementTrack: checkIn.is_management_track,
  });
}

// ── Role gates ───────────────────────────────────────────────────────────────

export interface MidyearActor {
  isEmployee: boolean;
  /** Direct manager or active delegate. */
  hasManagerAccess: boolean;
  isHrAdmin: boolean;
  testBypass: boolean;
}

/**
 * Who may reopen a completed formal Mid-Year Review: HR or admin, never on their own appraisal.
 * Managers and delegates revise a reopened review but cannot reopen one.
 */
export const canReopenMidyear = (a: Pick<MidyearActor, "isEmployee" | "isHrAdmin">) => a.isHrAdmin && !a.isEmployee;

export type FormalAction =
  | "EMPLOYEE_SAVE_DRAFT"
  | "EMPLOYEE_SUBMIT"
  | "MANAGER_RESPOND"
  | "MANAGER_COMPLETE"
  | "COMPLETE"
  | "CANCEL"
  | "REOPEN";

const FORMAL_ACTION_RULES: Record<FormalAction, { allowed: (a: MidyearActor) => boolean; denied: string }> = {
  EMPLOYEE_SAVE_DRAFT: { allowed: (a) => a.isEmployee, denied: "Only the employee can enter the employee portion of the Mid-Year Review." },
  EMPLOYEE_SUBMIT: { allowed: (a) => a.isEmployee, denied: "Only the employee can enter the employee portion of the Mid-Year Review." },
  MANAGER_RESPOND: { allowed: (a) => a.hasManagerAccess || a.testBypass, denied: "Only the manager or an active delegate can enter the manager portion of the Mid-Year Review." },
  MANAGER_COMPLETE: { allowed: (a) => a.hasManagerAccess || a.testBypass, denied: "Only the manager or an active delegate can enter the manager portion of the Mid-Year Review." },
  COMPLETE: { allowed: (a) => a.hasManagerAccess || a.testBypass, denied: "Only the manager or an active delegate can complete the Mid-Year Review." },
  CANCEL: { allowed: (a) => a.hasManagerAccess || a.isHrAdmin || a.testBypass, denied: "Only the manager, an active delegate or HR can cancel the Mid-Year Review." },
  REOPEN: { allowed: (a) => canReopenMidyear(a), denied: "Only HR or an administrator can reopen a completed Mid-Year Review." },
};

export const isFormalAction = (action: unknown): action is FormalAction =>
  typeof action === "string" && action in FORMAL_ACTION_RULES;

/** Returns the denial message, or null when the actor may perform the action. */
export function formalActionDenied(action: FormalAction, actor: MidyearActor): string | null {
  const rule = FORMAL_ACTION_RULES[action];
  return rule.allowed(actor) ? null : rule.denied;
}

/** Who may start a formal Mid-Year Review: the manager, an active delegate, or HR/admin. */
export const canInitiateFormal = (a: MidyearActor) => a.hasManagerAccess || a.isHrAdmin || a.testBypass;

export const MIDYEAR_LOCKED_MESSAGE = "The Mid-Year Review can only be changed while the appraisal is In progress.";

// ── Audit ────────────────────────────────────────────────────────────────────

export type MidyearAuditAction =
  | "midyear_created"
  | "midyear_employee_submitted"
  | "midyear_manager_reviewed"
  | "midyear_completed"
  | "midyear_cancelled"
  | "midyear_reopened"
  | "midyear_revision_completed";

const AUDIT_SUMMARY: Record<MidyearAuditAction, string> = {
  midyear_created: "Mid-Year Review created",
  midyear_employee_submitted: "Mid-Year Review submitted by employee",
  midyear_manager_reviewed: "Mid-Year Review reviewed by manager",
  midyear_completed: "Mid-Year Review completed",
  midyear_cancelled: "Mid-Year Review cancelled",
  midyear_reopened: "Mid-Year Review reopened for revision",
  midyear_revision_completed: "Revised Mid-Year Review completed",
};

/** Non-blocking, like the existing appraisal audit writes. */
export async function recordMidyearAudit(
  supabase: SupabaseClient,
  params: {
    appraisalId: string;
    actorId: string | null;
    action: MidyearAuditAction;
    checkIn: { id: string; title?: string | null; review_mode?: string | null };
    detail?: Record<string, unknown>;
  }
): Promise<void> {
  const { appraisalId, actorId, action, checkIn, detail } = params;
  try {
    await supabase.from("appraisal_audit").insert({
      appraisal_id: appraisalId,
      action_type: action,
      actor_id: actorId,
      summary: checkIn.title ? `${AUDIT_SUMMARY[action]}: ${checkIn.title}` : AUDIT_SUMMARY[action],
      detail: { check_in_id: checkIn.id, review_mode: checkIn.review_mode ?? null, ...detail },
    });
  } catch {
    /* non-blocking */
  }
}

// ── Self Assessment prerequisite ─────────────────────────────────────────────

/**
 * When the appraisal's cycle has Mid-Year Review enabled, a formal Mid-Year Review must be COMPLETE
 * before annual Self Assessment can start. Returns the blocking message, or null.
 */
export async function midyearSelfAssessmentBlocker(
  supabase: SupabaseClient,
  appraisal: { id: string; cycle_id?: string | null }
): Promise<string | null> {
  const { config } = await loadCycleMidyearConfig(supabase, appraisal.cycle_id);
  if (!config.enabled) return null;
  const { data, error } = await supabase
    .from("check_ins")
    .select("id, status")
    .eq("appraisal_id", appraisal.id)
    .in("review_mode", ["FORMAL", "FORMAL_SCORED"]);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as { status: string }[];
  if (rows.some((r) => r.status === "COMPLETE")) return null;
  return rows.some((r) => isActiveFormalStatus(r.status))
    ? "Complete the Mid-Year Review before starting self-assessment."
    : "A completed Mid-Year Review is required for this cycle before self-assessment can start.";
}
