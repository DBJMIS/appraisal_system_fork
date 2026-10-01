/**
 * Plans which appraisal reminders are due on a given day. Pure: takes already-loaded rows, returns
 * the reminder occurrences to create. Delivery (claiming, sending, retries) is in
 * lib/appraisal-reminder-delivery.ts, which re-checks eligibility with the same rules before sending.
 *
 * Reminders follow the existing workflow only; they never change status and never message anyone
 * whose step is already done:
 *   Mid-Year (cycle has midyear_review_enabled, window open, appraisal IN_PROGRESS)
 *     formal review OPEN                         -> employee: MIDYEAR_DUE_SOON / MIDYEAR_OVERDUE
 *     EMPLOYEE_SUBMITTED or MANAGER_REVIEWED     -> manager:  MIDYEAR_MANAGER_REVIEW_PENDING
 *   Final Review (due date = cycle end_date)
 *     IN_PROGRESS and Final Review available     -> employee: FINAL_REVIEW_AVAILABLE (once), then DUE_SOON / OVERDUE
 *     SELF_ASSESSMENT                            -> employee: FINAL_REVIEW_DUE_SOON / FINAL_REVIEW_OVERDUE
 *     MANAGER_REVIEW                             -> manager:  MANAGER_REVIEW_PENDING
 * Manager reminders go to appraisals.manager_employee_id, the recipient existing workflow emails use.
 */

import type { EmailKind, EmailRecipientRole } from "@/lib/email-templates";
import { isActiveFormalStatus } from "@/lib/midyear-lifecycle";
import {
  DEFAULT_REMINDER_POLICY,
  addDays,
  currentOccurrence,
  cycleReminderPolicy,
  formatOffsetKey,
  toIsoDate,
  upcomingOccurrence,
  type CycleReminderFields,
  type ReminderPolicy,
} from "@/lib/appraisal-reminder-policy";

export const REMINDER_KINDS = [
  "MIDYEAR_DUE_SOON",
  "MIDYEAR_OVERDUE",
  "MIDYEAR_MANAGER_REVIEW_PENDING",
  "FINAL_REVIEW_AVAILABLE",
  "FINAL_REVIEW_DUE_SOON",
  "FINAL_REVIEW_OVERDUE",
  "MANAGER_REVIEW_PENDING",
] as const satisfies readonly EmailKind[];

export type ReminderKind = (typeof REMINDER_KINDS)[number];

export const isReminderKind = (value: unknown): value is ReminderKind =>
  typeof value === "string" && (REMINDER_KINDS as readonly string[]).includes(value);

export interface ReminderCycle extends CycleReminderFields {
  id: string;
  status: string | null;
  end_date: string | null;
  midyear_review_enabled: boolean | null;
  midyear_window_start: string | null;
  midyear_due_date: string | null;
}

export interface ReminderAppraisal {
  id: string;
  employee_id: string;
  manager_employee_id: string | null;
  cycle_id: string | null;
  status: string | null;
}

export interface ReminderFormalCheckIn {
  appraisal_id: string;
  status: string | null;
}

export type MidyearReminderStage = "EMPLOYEE" | "MANAGER";
export type FinalReminderStage = "EMPLOYEE_AVAILABLE" | "EMPLOYEE_IN_PROGRESS" | "MANAGER";

export interface AppraisalReminderState {
  midyear: { stage: MidyearReminderStage; dueDate: string } | null;
  final: { stage: FinalReminderStage; dueDate: string } | null;
}

/** Which reminder audience (if any) currently has an outstanding step on this appraisal. */
export function appraisalReminderState(
  appraisal: ReminderAppraisal,
  cycle: ReminderCycle | null,
  formalCheckIns: ReminderFormalCheckIn[],
  today: string
): AppraisalReminderState {
  const none: AppraisalReminderState = { midyear: null, final: null };
  if (!cycle || String(cycle.status ?? "").toLowerCase() !== "open") return none;

  const status = appraisal.status ?? "";
  const hasManager = Boolean(appraisal.manager_employee_id);
  const midyearEnabled = cycle.midyear_review_enabled === true;

  let midyear: AppraisalReminderState["midyear"] = null;
  const midyearDue = toIsoDate(cycle.midyear_due_date);
  const windowStart = toIsoDate(cycle.midyear_window_start);
  if (midyearEnabled && midyearDue && (!windowStart || windowStart <= today) && status === "IN_PROGRESS") {
    const active = formalCheckIns.find((c) => isActiveFormalStatus(c.status));
    if (active?.status === "OPEN") midyear = { stage: "EMPLOYEE", dueDate: midyearDue };
    else if (active && hasManager) midyear = { stage: "MANAGER", dueDate: midyearDue };
  }

  let final: AppraisalReminderState["final"] = null;
  const finalDue = toIsoDate(cycle.end_date);
  if (finalDue) {
    if (status === "IN_PROGRESS") {
      const midyearSatisfied = !midyearEnabled || formalCheckIns.some((c) => c.status === "COMPLETE");
      if (midyearSatisfied) final = { stage: "EMPLOYEE_AVAILABLE", dueDate: finalDue };
    } else if (status === "SELF_ASSESSMENT") {
      final = { stage: "EMPLOYEE_IN_PROGRESS", dueDate: finalDue };
    } else if (status === "MANAGER_REVIEW" && hasManager) {
      final = { stage: "MANAGER", dueDate: finalDue };
    }
  }

  return { midyear, final };
}

export interface PlannedReminder {
  appraisalId: string;
  cycleId: string | null;
  employeeId: string;
  recipientEmployeeId: string;
  recipientRole: EmailRecipientRole;
  kind: ReminderKind;
  reminderKey: string;
  /** Days relative to the due date (negative = before); null for the one-off availability notice. */
  offsetDays: number | null;
  dueDate: string;
  scheduledFor: string;
  isOverdue: boolean;
}

export const reminderKey = (kind: ReminderKind, offsetDays: number | null, dueDate: string) =>
  `${kind}:${offsetDays == null ? "once" : formatOffsetKey(offsetDays)}:${dueDate}`;

/** Identity of one occurrence, matching the table's unique constraint. */
export const occurrenceId = (appraisalId: string, recipientEmployeeId: string, key: string) =>
  `${appraisalId}|${recipientEmployeeId}|${key}`;

export interface PlanInput {
  today: string;
  /** Timing for anything a cycle does not configure itself; DEFAULT_REMINDER_POLICY when omitted. */
  policy?: ReminderPolicy;
  cycles: ReminderCycle[];
  appraisals: ReminderAppraisal[];
  formalCheckIns: ReminderFormalCheckIn[];
  /** occurrenceId() values already recorded; these are not planned again. */
  existing?: Set<string>;
}

/** Reminder kind and audience for a dated occurrence, given who currently has the step. */
function midyearReminder(stage: MidyearReminderStage, overdue: boolean): { kind: ReminderKind; role: EmailRecipientRole } {
  return stage === "EMPLOYEE"
    ? { kind: overdue ? "MIDYEAR_OVERDUE" : "MIDYEAR_DUE_SOON", role: "employee" }
    : { kind: "MIDYEAR_MANAGER_REVIEW_PENDING", role: "manager" };
}

function finalReminder(stage: FinalReminderStage, overdue: boolean): { kind: ReminderKind; role: EmailRecipientRole } {
  return stage === "MANAGER"
    ? { kind: "MANAGER_REVIEW_PENDING", role: "manager" }
    : { kind: overdue ? "FINAL_REVIEW_OVERDUE" : "FINAL_REVIEW_DUE_SOON", role: "employee" };
}

/** First day of the one-off availability notice, and the day the dated reminders take over. */
function availabilityWindow(dueDate: string, policy: ReminderPolicy) {
  const maxBefore = policy.daysBefore.length ? Math.max(...policy.daysBefore) : 0;
  return { from: addDays(dueDate, -policy.finalReviewNoticeDays), until: addDays(dueDate, -maxBefore) };
}

export interface AppraisalPlanContext {
  appraisal: ReminderAppraisal;
  cycle: ReminderCycle | null;
  state: AppraisalReminderState;
}

/** Reminder timing per cycle (resolved once per cycle), using the cycle's own settings where present. */
export function cyclePolicyResolver(fallback: ReminderPolicy = DEFAULT_REMINDER_POLICY) {
  const byCycle = new Map<string, ReminderPolicy>();
  return (cycle: ReminderCycle | null): ReminderPolicy => {
    if (!cycle) return fallback;
    let policy = byCycle.get(cycle.id);
    if (!policy) {
      policy = cycleReminderPolicy(cycle, fallback);
      byCycle.set(cycle.id, policy);
    }
    return policy;
  };
}

/** Current reminder state for every appraisal in the input (shared by planning and diagnostics). */
export function appraisalContexts(input: Pick<PlanInput, "today" | "cycles" | "appraisals" | "formalCheckIns">): AppraisalPlanContext[] {
  const cycles = new Map(input.cycles.map((c) => [c.id, c]));
  const formalByAppraisal = new Map<string, ReminderFormalCheckIn[]>();
  for (const c of input.formalCheckIns) {
    const list = formalByAppraisal.get(c.appraisal_id) ?? [];
    list.push(c);
    formalByAppraisal.set(c.appraisal_id, list);
  }
  return input.appraisals.map((a) => {
    const cycle = a.cycle_id ? cycles.get(a.cycle_id) ?? null : null;
    return { appraisal: a, cycle, state: appraisalReminderState(a, cycle, formalByAppraisal.get(a.id) ?? [], input.today) };
  });
}

function toReminder(
  input: PlanInput,
  a: ReminderAppraisal,
  kind: ReminderKind,
  recipientRole: EmailRecipientRole,
  dueDate: string,
  offsetDays: number | null,
  scheduledFor: string
): PlannedReminder | null {
  const recipient = recipientRole === "manager" ? a.manager_employee_id : a.employee_id;
  if (!recipient) return null;
  const key = reminderKey(kind, offsetDays, dueDate);
  if (input.existing?.has(occurrenceId(a.id, recipient, key))) return null;
  return {
    appraisalId: a.id,
    cycleId: a.cycle_id,
    employeeId: a.employee_id,
    recipientEmployeeId: recipient,
    recipientRole,
    kind,
    reminderKey: key,
    offsetDays,
    dueDate,
    scheduledFor,
    isOverdue: offsetDays != null && offsetDays > 0,
  };
}

export function planAppraisalReminders(input: PlanInput): PlannedReminder[] {
  const { today } = input;
  const policyFor = cyclePolicyResolver(input.policy);
  const planned: PlannedReminder[] = [];

  for (const { appraisal: a, cycle, state } of appraisalContexts(input)) {
    const policy = policyFor(cycle);
    const add = (r: PlannedReminder | null) => r && planned.push(r);

    if (state.midyear) {
      const occ = currentOccurrence(today, state.midyear.dueDate, policy);
      if (occ) {
        const { kind, role } = midyearReminder(state.midyear.stage, occ.overdue);
        add(toReminder(input, a, kind, role, state.midyear.dueDate, occ.offsetDays, occ.scheduledFor));
      }
    }

    if (state.final) {
      const due = state.final.dueDate;
      const occ = currentOccurrence(today, due, policy);
      if (occ) {
        const { kind, role } = finalReminder(state.final.stage, occ.overdue);
        add(toReminder(input, a, kind, role, due, occ.offsetDays, occ.scheduledFor));
      } else if (state.final.stage === "EMPLOYEE_AVAILABLE") {
        const window = availabilityWindow(due, policy);
        if (today >= window.from && today < window.until) {
          add(toReminder(input, a, "FINAL_REVIEW_AVAILABLE", "employee", due, null, window.from));
        }
      }
    }
  }

  return planned;
}

/**
 * Diagnostic only (dry run): the next reminder each appraisal would receive after today if nothing
 * changes, using the same state, offsets and keys as planAppraisalReminders. One per appraisal,
 * soonest first. Appraisals with no outstanding step, or past their last overdue reminder, yield none.
 */
export function upcomingAppraisalReminders(input: PlanInput, limit = 3): PlannedReminder[] {
  const { today } = input;
  const policyFor = cyclePolicyResolver(input.policy);
  const next: PlannedReminder[] = [];

  for (const { appraisal: a, cycle, state } of appraisalContexts(input)) {
    const policy = policyFor(cycle);
    const candidates: PlannedReminder[] = [];
    const add = (r: PlannedReminder | null) => r && candidates.push(r);

    if (state.midyear) {
      const occ = upcomingOccurrence(today, state.midyear.dueDate, policy);
      if (occ) {
        const { kind, role } = midyearReminder(state.midyear.stage, occ.overdue);
        add(toReminder(input, a, kind, role, state.midyear.dueDate, occ.offsetDays, occ.scheduledFor));
      }
    }

    if (state.final) {
      const due = state.final.dueDate;
      const occ = upcomingOccurrence(today, due, policy);
      if (occ) {
        const { kind, role } = finalReminder(state.final.stage, occ.overdue);
        add(toReminder(input, a, kind, role, due, occ.offsetDays, occ.scheduledFor));
      }
      if (state.final.stage === "EMPLOYEE_AVAILABLE") {
        const window = availabilityWindow(due, policy);
        if (window.from > today && window.from < window.until) {
          add(toReminder(input, a, "FINAL_REVIEW_AVAILABLE", "employee", due, null, window.from));
        }
      }
    }

    candidates.sort((x, y) => x.scheduledFor.localeCompare(y.scheduledFor));
    if (candidates[0]) next.push(candidates[0]);
  }

  return next.sort((x, y) => x.scheduledFor.localeCompare(y.scheduledFor) || x.appraisalId.localeCompare(y.appraisalId)).slice(0, limit);
}

/**
 * Whether a recorded reminder is still needed now: same audience still has the step outstanding,
 * same recipient and the deadline has not moved. Used immediately before sending.
 */
export function isReminderStillRequired(
  delivery: { notification_kind: string; recipient_employee_id: string; due_date: string | null },
  appraisal: ReminderAppraisal,
  state: AppraisalReminderState
): boolean {
  return reminderSkipReason(delivery, appraisal, state) === null;
}

/** Machine-safe reason a recorded reminder is no longer needed. */
export type ReminderSkipCode = "NO_LONGER_REQUIRED" | "SUPERSEDED" | "RECIPIENT_CHANGED";

/** Who a reminder of this kind would go to now, and for which deadline; null when nobody has that step. */
function currentReminderTarget(
  kind: string,
  appraisal: ReminderAppraisal,
  state: AppraisalReminderState
): { dueDate: string; recipient: string | null } | null {
  const m = state.midyear;
  const f = state.final;
  switch (kind) {
    case "MIDYEAR_DUE_SOON":
    case "MIDYEAR_OVERDUE":
      return m?.stage === "EMPLOYEE" ? { dueDate: m.dueDate, recipient: appraisal.employee_id } : null;
    case "MIDYEAR_MANAGER_REVIEW_PENDING":
      return m?.stage === "MANAGER" ? { dueDate: m.dueDate, recipient: appraisal.manager_employee_id } : null;
    case "FINAL_REVIEW_AVAILABLE":
      return f?.stage === "EMPLOYEE_AVAILABLE" ? { dueDate: f.dueDate, recipient: appraisal.employee_id } : null;
    case "FINAL_REVIEW_DUE_SOON":
    case "FINAL_REVIEW_OVERDUE":
      return f && f.stage !== "MANAGER" ? { dueDate: f.dueDate, recipient: appraisal.employee_id } : null;
    case "MANAGER_REVIEW_PENDING":
      return f?.stage === "MANAGER" ? { dueDate: f.dueDate, recipient: appraisal.manager_employee_id } : null;
    default:
      return null;
  }
}

/**
 * Null when a recorded reminder is still needed now (same step outstanding, same deadline, same
 * recipient); otherwise why not: the step is done, the deadline moved, or the recipient changed.
 */
export function reminderSkipReason(
  delivery: { notification_kind: string; recipient_employee_id: string; due_date: string | null },
  appraisal: ReminderAppraisal,
  state: AppraisalReminderState
): ReminderSkipCode | null {
  const target = currentReminderTarget(delivery.notification_kind, appraisal, state);
  if (!target) return "NO_LONGER_REQUIRED";
  if (target.dueDate !== toIsoDate(delivery.due_date)) return "SUPERSEDED";
  if (!target.recipient || target.recipient !== delivery.recipient_employee_id) return "RECIPIENT_CHANGED";
  return null;
}
