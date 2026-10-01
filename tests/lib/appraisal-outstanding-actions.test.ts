import { describe, expect, it } from "vitest";
import {
  outstandingAppraisalActions,
  suggestEscalationTarget,
  type ActionDeliveryRecord,
  type OutstandingInput,
} from "@/lib/appraisal-outstanding-actions";
import { loadEscalationPolicy } from "@/lib/appraisal-reminder-policy";
import { reminderSkipReason, appraisalReminderState, type ReminderAppraisal, type ReminderCycle } from "@/lib/appraisal-reminder-planner";
import {
  DELIVERY_STATUS_DISPLAY,
  deliveryReasonLabel,
  deliverySuccessRate,
  retryBlockReason,
} from "@/lib/reminder-operations-display";

const CYCLE: ReminderCycle = {
  id: "c-1",
  status: "open",
  end_date: "2027-03-31",
  midyear_review_enabled: true,
  midyear_window_start: "2026-10-01",
  midyear_due_date: "2026-10-30",
};

const A1: ReminderAppraisal = { id: "a-1", employee_id: "emp-1", manager_employee_id: "mgr-1", cycle_id: "c-1", status: "IN_PROGRESS" };
const A2: ReminderAppraisal = { id: "a-2", employee_id: "emp-2", manager_employee_id: "mgr-1", cycle_id: "c-1", status: "IN_PROGRESS" };
const A3: ReminderAppraisal = { id: "a-3", employee_id: "emp-3", manager_employee_id: "mgr-1", cycle_id: "c-1", status: "MANAGER_REVIEW" };

const input = (today: string, overrides: Partial<OutstandingInput> = {}): OutstandingInput => ({
  today,
  cycles: [CYCLE],
  appraisals: [A1, A2],
  formalCheckIns: [
    { appraisal_id: "a-1", status: "OPEN" },
    { appraisal_id: "a-2", status: "EMPLOYEE_SUBMITTED" },
  ],
  ...overrides,
});

const sent = (over: Partial<ActionDeliveryRecord>): ActionDeliveryRecord => ({
  appraisal_id: "a-1",
  recipient_employee_id: "emp-1",
  notification_kind: "MIDYEAR_OVERDUE",
  due_date: "2026-10-30",
  offset_days: 1,
  status: "SENT",
  attempt_count: 1,
  sent_at: "2026-10-31T13:00:00.000Z",
  ...over,
});

describe("outstandingAppraisalActions", () => {
  it("lists an overdue employee action and an overdue manager action with days overdue", () => {
    const actions = outstandingAppraisalActions(input("2026-11-04"), [], 7);
    expect(actions.map((a) => [a.appraisalId, a.stage, a.responsibleRole, a.responsibleEmployeeId, a.daysOverdue])).toEqual([
      ["a-1", "MIDYEAR_EMPLOYEE", "employee", "emp-1", 5],
      ["a-2", "MIDYEAR_MANAGER", "manager", "mgr-1", 5],
    ]);
    expect(actions[0]).toMatchObject({ reviewStage: "Mid-Year Review", requiredAction: "Submit Mid-Year Review", dueDate: "2026-10-30" });
  });

  it("does not list steps on or before their due date", () => {
    expect(outstandingAppraisalActions(input("2026-10-30"), [], 7)).toEqual([]);
    expect(outstandingAppraisalActions(input("2026-10-31"), [], 7).map((a) => a.daysOverdue)).toEqual([1, 1]);
  });

  it("excludes completed steps", () => {
    const done = input("2026-11-20", { formalCheckIns: [{ appraisal_id: "a-1", status: "COMPLETE" }, { appraisal_id: "a-2", status: "EMPLOYEE_SUBMITTED" }] });
    expect(outstandingAppraisalActions(done, [], 7).map((a) => a.appraisalId)).toEqual(["a-2"]);
  });

  it("excludes appraisals on closed cycles", () => {
    expect(outstandingAppraisalActions(input("2026-11-20", { cycles: [{ ...CYCLE, status: "closed" }] }), [], 7)).toEqual([]);
  });

  it("covers Final Review steps due on the cycle end date", () => {
    const actions = outstandingAppraisalActions(
      input("2027-04-05", { appraisals: [A3], formalCheckIns: [{ appraisal_id: "a-3", status: "COMPLETE" }] }),
      [],
      7
    );
    expect(actions).toMatchObject([{ stage: "FINAL_MANAGER", requiredAction: "Complete manager review", responsibleEmployeeId: "mgr-1", daysOverdue: 5 }]);
  });

  it("reports the latest reminder sent for that step, recipient and deadline only", () => {
    const actions = outstandingAppraisalActions(
      input("2026-11-04"),
      [
        sent({ notification_kind: "MIDYEAR_DUE_SOON", offset_days: -3, sent_at: "2026-10-27T13:00:00.000Z" }),
        sent({ sent_at: "2026-10-31T13:00:00.000Z" }),
        sent({ notification_kind: "MIDYEAR_OVERDUE", offset_days: 3, status: "FAILED", sent_at: null }),
        sent({ due_date: "2026-10-15", sent_at: "2026-11-02T13:00:00.000Z" }),
        sent({ recipient_employee_id: "someone-else", sent_at: "2026-11-03T13:00:00.000Z" }),
      ],
      7
    );
    expect(actions[0].lastReminderSentAt).toBe("2026-10-31T13:00:00.000Z");
    expect(actions[1].lastReminderSentAt).toBeNull();
  });
});

describe("escalation candidates", () => {
  const history = [sent({}), sent({ appraisal_id: "a-2", recipient_employee_id: "mgr-1", notification_kind: "MIDYEAR_MANAGER_REVIEW_PENDING" })];

  it("only once the action is overdue by the threshold", () => {
    expect(outstandingAppraisalActions(input("2026-11-05"), history, 7).map((a) => a.escalationCandidate)).toEqual([false, false]);
    expect(outstandingAppraisalActions(input("2026-11-06"), history, 7).map((a) => [a.daysOverdue, a.escalationCandidate])).toEqual([
      [7, true],
      [7, true],
    ]);
  });

  it("only after an overdue reminder was attempted (sent, or failed after an attempt)", () => {
    const preDueOnly = [sent({ notification_kind: "MIDYEAR_DUE_SOON", offset_days: -3 })];
    expect(outstandingAppraisalActions(input("2026-11-20"), preDueOnly, 7)[0].escalationCandidate).toBe(false);
    const notAttempted = [sent({ status: "PENDING", attempt_count: 0, sent_at: null })];
    expect(outstandingAppraisalActions(input("2026-11-20"), notAttempted, 7)[0].escalationCandidate).toBe(false);
    const failed = [sent({ status: "FAILED", attempt_count: 1, sent_at: null })];
    expect(outstandingAppraisalActions(input("2026-11-20"), failed, 7)[0].escalationCandidate).toBe(true);
  });

  it("ignores reminders for another recipient or a superseded deadline", () => {
    const other = [sent({ recipient_employee_id: "old-recipient" }), sent({ due_date: "2026-10-15" })];
    expect(outstandingAppraisalActions(input("2026-11-20"), other, 7)[0].escalationCandidate).toBe(false);
  });

  it("excludes completed actions", () => {
    const done = input("2026-11-20", { formalCheckIns: [{ appraisal_id: "a-1", status: "COMPLETE" }, { appraisal_id: "a-2", status: "COMPLETE" }] });
    expect(outstandingAppraisalActions(done, history, 7)).toEqual([]);
  });

  it("yields one candidate per appraisal step with a deterministic key, however many reminders were sent", () => {
    const many = [
      sent({ offset_days: 1 }),
      sent({ offset_days: 3, sent_at: "2026-11-02T13:00:00.000Z" }),
      sent({ offset_days: 7, sent_at: "2026-11-06T13:00:00.000Z" }),
    ];
    const first = outstandingAppraisalActions(input("2026-11-20"), many, 7).filter((a) => a.appraisalId === "a-1");
    const again = outstandingAppraisalActions(input("2026-11-21"), many, 7).filter((a) => a.appraisalId === "a-1");
    expect(first).toHaveLength(1);
    expect(first[0].escalationKey).toBe("ESCALATION:MIDYEAR_EMPLOYEE:2026-10-30");
    expect(again[0].escalationKey).toBe(first[0].escalationKey);
  });
});

describe("suggestEscalationTarget", () => {
  const employeeStep = { responsibleRole: "employee" as const, employeeId: "emp-1", responsibleEmployeeId: "emp-1" };
  const managerStep = { responsibleRole: "manager" as const, employeeId: "emp-2", responsibleEmployeeId: "mgr-1" };

  it("employee step: the appraisal manager, else HR", () => {
    expect(suggestEscalationTarget(employeeStep, "mgr-1", new Map())).toEqual({ type: "DIRECT_MANAGER", employeeId: "mgr-1", basis: "Appraisal manager" });
    expect(suggestEscalationTarget(employeeStep, null, new Map())).toMatchObject({ type: "HR", employeeId: null });
  });

  it("manager step: the manager's single primary manager, else HR", () => {
    expect(suggestEscalationTarget(managerStep, "mgr-1", new Map([["mgr-1", ["dir-1"]]]))).toMatchObject({ type: "SECOND_LEVEL_MANAGER", employeeId: "dir-1" });
    expect(suggestEscalationTarget(managerStep, "mgr-1", new Map([["mgr-1", ["dir-1", "dir-1"]]]))).toMatchObject({ type: "SECOND_LEVEL_MANAGER", employeeId: "dir-1" });
    expect(suggestEscalationTarget(managerStep, "mgr-1", new Map([["mgr-1", ["dir-1", "dir-2"]]]))).toMatchObject({ type: "HR" });
    expect(suggestEscalationTarget(managerStep, "mgr-1", new Map())).toMatchObject({ type: "HR" });
    expect(suggestEscalationTarget(managerStep, "mgr-1", new Map([["mgr-1", ["emp-2"]]]))).toMatchObject({ type: "HR" });
    expect(suggestEscalationTarget(managerStep, "mgr-1", new Map([["mgr-1", ["mgr-1"]]]))).toMatchObject({ type: "HR" });
  });
});

describe("loadEscalationPolicy", () => {
  it("defaults to 7 days and accepts whole numbers 1-90", () => {
    expect(loadEscalationPolicy({})).toEqual({ daysOverdue: 7, warnings: [] });
    expect(loadEscalationPolicy({ APPRAISAL_ESCALATION_DAYS_OVERDUE: " 14 " })).toEqual({ daysOverdue: 14, warnings: [] });
    for (const bad of ["0", "91", "-3", "2.5", "seven"]) {
      const p = loadEscalationPolicy({ APPRAISAL_ESCALATION_DAYS_OVERDUE: bad });
      expect(p.daysOverdue, bad).toBe(7);
      expect(p.warnings[0]).toMatch(/APPRAISAL_ESCALATION_DAYS_OVERDUE/);
    }
  });
});

describe("reminderSkipReason", () => {
  const state = (a: ReminderAppraisal, status: string) => appraisalReminderState(a, CYCLE, [{ appraisal_id: a.id, status }], "2026-10-27");
  const row = { notification_kind: "MIDYEAR_MANAGER_REVIEW_PENDING", recipient_employee_id: "mgr-1", due_date: "2026-10-30" };

  it("returns null while still required, otherwise a machine-safe reason", () => {
    expect(reminderSkipReason(row, A2, state(A2, "EMPLOYEE_SUBMITTED"))).toBeNull();
    expect(reminderSkipReason(row, A2, state(A2, "COMPLETE"))).toBe("NO_LONGER_REQUIRED");
    expect(reminderSkipReason({ ...row, due_date: "2026-10-15" }, A2, state(A2, "EMPLOYEE_SUBMITTED"))).toBe("SUPERSEDED");
    expect(reminderSkipReason({ ...row, recipient_employee_id: "old-mgr" }, A2, state(A2, "EMPLOYEE_SUBMITTED"))).toBe("RECIPIENT_CHANGED");
    expect(reminderSkipReason({ ...row, notification_kind: "SIGNOFF_REMINDER" }, A2, state(A2, "EMPLOYEE_SUBMITTED"))).toBe("NO_LONGER_REQUIRED");
  });
});

describe("reminder operations display rules", () => {
  it("labels every status with text and a semantic tone", () => {
    expect(DELIVERY_STATUS_DISPLAY).toEqual({
      SENT: { label: "Sent", tone: "success" },
      FAILED: { label: "Failed", tone: "error" },
      PENDING: { label: "Pending", tone: "warning" },
      SENDING: { label: "Sending", tone: "neutral" },
      SKIPPED: { label: "Skipped", tone: "muted" },
    });
  });

  it("maps stored codes to human-readable reasons", () => {
    expect(deliveryReasonLabel("NO_LONGER_REQUIRED")).toBe("Action already completed");
    expect(deliveryReasonLabel("SUPERSEDED")).toBe("Reminder superseded (due date changed)");
    expect(deliveryReasonLabel("RECIPIENT_CHANGED")).toBe("Recipient changed");
    expect(deliveryReasonLabel("NO_RECIPIENT_EMAIL")).toBe("Missing recipient email");
    expect(deliveryReasonLabel("UNSUPPORTED_KIND")).toBe("No longer eligible");
    expect(deliveryReasonLabel("GRAPH_400")).toBe("Invalid recipient");
    expect(deliveryReasonLabel("GRAPH_503")).toBe("Mail service unavailable");
    expect(deliveryReasonLabel("TOKEN_401")).toBe("Could not sign in to the mail service");
    expect(deliveryReasonLabel("SOMETHING_NEW")).toBe("Delivery error");
    expect(deliveryReasonLabel(null)).toBeNull();
  });

  it("blocks retries without override", () => {
    const ok = { status: "FAILED", attemptCount: 1, errorCode: "GRAPH_503", hasRecipientEmail: true, stillRequired: true };
    expect(retryBlockReason(ok)).toBeNull();
    expect(retryBlockReason({ ...ok, status: "SENT" })?.code).toBe("ALREADY_SENT");
    expect(retryBlockReason({ ...ok, status: "PENDING" })?.code).toBe("NOT_FAILED");
    expect(retryBlockReason({ ...ok, errorCode: "GRAPH_400" })?.code).toBe("INVALID_RECIPIENT");
    expect(retryBlockReason({ ...ok, attemptCount: 3 })?.code).toBe("MAX_ATTEMPTS");
    expect(retryBlockReason({ ...ok, hasRecipientEmail: false })?.code).toBe("NO_RECIPIENT_EMAIL");
    expect(retryBlockReason({ ...ok, stillRequired: false })?.code).toBe("NO_LONGER_REQUIRED");
  });

  it("computes success rate from sent and failed only", () => {
    expect(deliverySuccessRate(3, 1)).toBe(0.75);
    expect(deliverySuccessRate(0, 0)).toBeNull();
  });
});
