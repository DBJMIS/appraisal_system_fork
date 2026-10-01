/**
 * Overdue appraisal actions and escalation candidates for the HR/Admin oversight view. Pure:
 * derived from the same reminder state the planner uses (appraisalContexts), so an action is
 * outstanding exactly when a reminder for it would still be required. Nothing here sends email or
 * changes status.
 *
 * Escalation candidate: the action is at least `escalationDaysOverdue` days overdue, it is still
 * outstanding, and at least one overdue reminder for it was already attempted (sent, or failed
 * after an attempt). Candidates are listed for HR follow-up only.
 */

import type { EmailRecipientRole } from "@/lib/email-templates";
import { daysBetween, toIsoDate } from "@/lib/appraisal-reminder-policy";
import {
  appraisalContexts,
  type PlanInput,
  type ReminderAppraisal,
  type ReminderKind,
} from "@/lib/appraisal-reminder-planner";

export type OutstandingStage =
  | "MIDYEAR_EMPLOYEE"
  | "MIDYEAR_MANAGER"
  | "FINAL_NOT_STARTED"
  | "FINAL_SELF_ASSESSMENT"
  | "FINAL_MANAGER";

interface StageDefinition {
  reviewStage: "Mid-Year Review" | "Final Review";
  requiredAction: string;
  responsibleRole: EmailRecipientRole;
  /** Reminder kinds sent for this step; used to find its reminder history. */
  kinds: readonly ReminderKind[];
}

export const OUTSTANDING_STAGES: Record<OutstandingStage, StageDefinition> = {
  MIDYEAR_EMPLOYEE: {
    reviewStage: "Mid-Year Review",
    requiredAction: "Submit Mid-Year Review",
    responsibleRole: "employee",
    kinds: ["MIDYEAR_DUE_SOON", "MIDYEAR_OVERDUE"],
  },
  MIDYEAR_MANAGER: {
    reviewStage: "Mid-Year Review",
    requiredAction: "Complete Mid-Year manager review",
    responsibleRole: "manager",
    kinds: ["MIDYEAR_MANAGER_REVIEW_PENDING"],
  },
  FINAL_NOT_STARTED: {
    reviewStage: "Final Review",
    requiredAction: "Start Final Review self-assessment",
    responsibleRole: "employee",
    kinds: ["FINAL_REVIEW_AVAILABLE", "FINAL_REVIEW_DUE_SOON", "FINAL_REVIEW_OVERDUE"],
  },
  FINAL_SELF_ASSESSMENT: {
    reviewStage: "Final Review",
    requiredAction: "Submit Final Review self-assessment",
    responsibleRole: "employee",
    kinds: ["FINAL_REVIEW_DUE_SOON", "FINAL_REVIEW_OVERDUE"],
  },
  FINAL_MANAGER: {
    reviewStage: "Final Review",
    requiredAction: "Complete manager review",
    responsibleRole: "manager",
    kinds: ["MANAGER_REVIEW_PENDING"],
  },
};

/** Reminder history needed to judge an action; no content, only delivery bookkeeping. */
export interface ActionDeliveryRecord {
  appraisal_id: string;
  recipient_employee_id: string;
  notification_kind: string;
  due_date: string | null;
  offset_days: number | null;
  status: string;
  attempt_count: number;
  sent_at: string | null;
}

export interface OutstandingAction {
  appraisalId: string;
  cycleId: string | null;
  employeeId: string;
  stage: OutstandingStage;
  reviewStage: StageDefinition["reviewStage"];
  requiredAction: string;
  responsibleRole: EmailRecipientRole;
  responsibleEmployeeId: string | null;
  dueDate: string;
  daysOverdue: number;
  lastReminderSentAt: string | null;
  /** At least one overdue reminder for this step was sent or attempted. */
  overdueReminderAttempted: boolean;
  escalationCandidate: boolean;
  /** Deterministic identity: one candidate per appraisal, step and deadline. */
  escalationKey: string;
}

export type OutstandingInput = Pick<PlanInput, "today" | "cycles" | "appraisals" | "formalCheckIns">;

export const escalationKey = (stage: OutstandingStage, dueDate: string) => `ESCALATION:${stage}:${dueDate}`;

function stagesFor(state: ReturnType<typeof appraisalContexts>[number]["state"]): { stage: OutstandingStage; dueDate: string }[] {
  const out: { stage: OutstandingStage; dueDate: string }[] = [];
  if (state.midyear) {
    out.push({ stage: state.midyear.stage === "EMPLOYEE" ? "MIDYEAR_EMPLOYEE" : "MIDYEAR_MANAGER", dueDate: state.midyear.dueDate });
  }
  if (state.final) {
    const stage: OutstandingStage =
      state.final.stage === "EMPLOYEE_AVAILABLE"
        ? "FINAL_NOT_STARTED"
        : state.final.stage === "EMPLOYEE_IN_PROGRESS"
          ? "FINAL_SELF_ASSESSMENT"
          : "FINAL_MANAGER";
    out.push({ stage, dueDate: state.final.dueDate });
  }
  return out;
}

const responsibleFor = (role: EmailRecipientRole, a: ReminderAppraisal) => (role === "manager" ? a.manager_employee_id : a.employee_id);

/**
 * Every outstanding step whose deadline has passed (due date before today), most overdue first.
 * Steps that are complete, not yet due, or on closed cycles are excluded by the shared state rules.
 */
export function outstandingAppraisalActions(
  input: OutstandingInput,
  deliveries: ActionDeliveryRecord[],
  escalationDaysOverdue: number
): OutstandingAction[] {
  const byAppraisal = new Map<string, ActionDeliveryRecord[]>();
  for (const d of deliveries) {
    const list = byAppraisal.get(d.appraisal_id) ?? [];
    list.push(d);
    byAppraisal.set(d.appraisal_id, list);
  }

  const actions: OutstandingAction[] = [];
  for (const { appraisal, state } of appraisalContexts(input)) {
    for (const { stage, dueDate } of stagesFor(state)) {
      if (dueDate >= input.today) continue;
      const def = OUTSTANDING_STAGES[stage];
      const responsible = responsibleFor(def.responsibleRole, appraisal);
      const history = (byAppraisal.get(appraisal.id) ?? []).filter(
        (d) =>
          (def.kinds as readonly string[]).includes(d.notification_kind) &&
          d.recipient_employee_id === responsible &&
          toIsoDate(d.due_date) === dueDate
      );
      const lastReminderSentAt = history.reduce<string | null>(
        (latest, d) => (d.status === "SENT" && d.sent_at && (!latest || d.sent_at > latest) ? d.sent_at : latest),
        null
      );
      const overdueReminderAttempted = history.some(
        (d) => (d.offset_days ?? 0) > 0 && (d.status === "SENT" || (d.status === "FAILED" && d.attempt_count > 0))
      );
      const daysOverdue = daysBetween(dueDate, input.today);
      actions.push({
        appraisalId: appraisal.id,
        cycleId: appraisal.cycle_id,
        employeeId: appraisal.employee_id,
        stage,
        reviewStage: def.reviewStage,
        requiredAction: def.requiredAction,
        responsibleRole: def.responsibleRole,
        responsibleEmployeeId: responsible,
        dueDate,
        daysOverdue,
        lastReminderSentAt,
        overdueReminderAttempted,
        escalationCandidate: overdueReminderAttempted && daysOverdue >= escalationDaysOverdue,
        escalationKey: escalationKey(stage, dueDate),
      });
    }
  }

  return actions.sort((x, y) => y.daysOverdue - x.daysOverdue || x.appraisalId.localeCompare(y.appraisalId) || x.stage.localeCompare(y.stage));
}

export type EscalationTargetType = "DIRECT_MANAGER" | "SECOND_LEVEL_MANAGER" | "HR";

export interface EscalationTarget {
  type: EscalationTargetType;
  employeeId: string | null;
  /** Why this target was suggested (shown to HR; no appraisal content). */
  basis: string;
}

/**
 * Suggested follow-up owner from the reporting hierarchy, or HR when the hierarchy is not
 * unambiguous. `primaryManagersOf` maps an employee to their primary reporting-line managers.
 *   employee's step -> the appraisal's manager (the person who already approves this appraisal)
 *   manager's step  -> that manager's own primary manager, only when exactly one distinct person
 *                      who is neither the employee nor the manager
 */
export function suggestEscalationTarget(
  action: Pick<OutstandingAction, "responsibleRole" | "employeeId" | "responsibleEmployeeId">,
  managerEmployeeId: string | null,
  primaryManagersOf: Map<string, string[]>
): EscalationTarget {
  if (action.responsibleRole === "employee") {
    if (managerEmployeeId && managerEmployeeId !== action.employeeId) {
      return { type: "DIRECT_MANAGER", employeeId: managerEmployeeId, basis: "Appraisal manager" };
    }
    return { type: "HR", employeeId: null, basis: "No manager on the appraisal" };
  }
  const manager = action.responsibleEmployeeId;
  if (!manager) return { type: "HR", employeeId: null, basis: "No manager on the appraisal" };
  const above = [...new Set(primaryManagersOf.get(manager) ?? [])].filter((id) => id && id !== manager && id !== action.employeeId);
  if (above.length === 1) return { type: "SECOND_LEVEL_MANAGER", employeeId: above[0], basis: "Manager's primary reporting line" };
  return {
    type: "HR",
    employeeId: null,
    basis: above.length === 0 ? "Manager has no primary reporting line" : "Manager has more than one primary reporting line",
  };
}
