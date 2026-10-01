import { describe, expect, it } from "vitest";
import {
  DEFAULT_REMINDER_POLICY,
  currentOccurrence,
  describeOffset,
  loadReminderPolicy,
  reminderToday,
  retryDelayMinutes,
  shortOffsetLabel,
  type ReminderPolicy,
} from "@/lib/appraisal-reminder-policy";
import {
  REMINDER_KINDS,
  appraisalReminderState,
  isReminderStillRequired,
  occurrenceId,
  planAppraisalReminders,
  upcomingAppraisalReminders,
  type ReminderAppraisal,
  type ReminderCycle,
  type ReminderFormalCheckIn,
} from "@/lib/appraisal-reminder-planner";
import { EMAIL_TEMPLATES } from "@/lib/email-templates";

const MIDYEAR_CYCLE: ReminderCycle = {
  id: "c-mid",
  status: "open",
  end_date: "2027-03-31",
  midyear_review_enabled: true,
  midyear_window_start: "2026-10-01",
  midyear_due_date: "2026-10-30",
};
const ANNUAL_CYCLE: ReminderCycle = {
  id: "c-annual",
  status: "open",
  end_date: "2027-03-31",
  midyear_review_enabled: false,
  midyear_window_start: null,
  midyear_due_date: null,
};

const appraisal = (status: string, over: Partial<ReminderAppraisal> = {}): ReminderAppraisal => ({
  id: "a-1",
  employee_id: "emp-1",
  manager_employee_id: "mgr-1",
  cycle_id: "c-mid",
  status,
  ...over,
});

function plan(opts: {
  today: string;
  status?: string;
  formal?: string[];
  cycle?: ReminderCycle;
  appraisal?: Partial<ReminderAppraisal>;
  policy?: ReminderPolicy;
  existing?: Set<string>;
}) {
  const cycle = opts.cycle ?? MIDYEAR_CYCLE;
  const a = appraisal(opts.status ?? "IN_PROGRESS", { cycle_id: cycle.id, ...opts.appraisal });
  return planAppraisalReminders({
    today: opts.today,
    policy: opts.policy ?? DEFAULT_REMINDER_POLICY,
    cycles: [cycle],
    appraisals: [a],
    formalCheckIns: (opts.formal ?? []).map((status) => ({ appraisal_id: a.id, status })),
    existing: opts.existing,
  });
}

const keys = (p: ReturnType<typeof plan>) => p.map((r) => r.reminderKey);

describe("reminder policy", () => {
  it("defaults to 7,3,1,0 days before and 1,3,7 days overdue", () => {
    const p = loadReminderPolicy({});
    expect(p.daysBefore).toEqual([7, 3, 1, 0]);
    expect(p.overdueDays).toEqual([1, 3, 7]);
    expect(p.finalReviewNoticeDays).toBe(30);
    expect(p.warnings).toEqual([]);
  });

  it("accepts valid overrides", () => {
    const p = loadReminderPolicy({
      APPRAISAL_REMINDER_DAYS_BEFORE: " 1, 14 ,7 ",
      APPRAISAL_OVERDUE_REMINDER_DAYS: "2,5",
      APPRAISAL_FINAL_REVIEW_NOTICE_DAYS: "21",
    });
    expect(p.daysBefore).toEqual([14, 7, 1]);
    expect(p.overdueDays).toEqual([2, 5]);
    expect(p.finalReviewNoticeDays).toBe(21);
    expect(p.warnings).toEqual([]);
  });

  it.each([
    ["APPRAISAL_REMINDER_DAYS_BEFORE", "7,abc"],
    ["APPRAISAL_REMINDER_DAYS_BEFORE", "-1"],
    ["APPRAISAL_REMINDER_DAYS_BEFORE", "7,7"],
    ["APPRAISAL_REMINDER_DAYS_BEFORE", "61"],
    ["APPRAISAL_REMINDER_DAYS_BEFORE", "1.5"],
    ["APPRAISAL_REMINDER_DAYS_BEFORE", "1,2,3,4,5,6,7,8,9,10,11"],
    ["APPRAISAL_OVERDUE_REMINDER_DAYS", "0,3"],
    ["APPRAISAL_OVERDUE_REMINDER_DAYS", "1,3,999"],
  ])("rejects %s=%s and falls back to the default with a warning", (name, value) => {
    const p = loadReminderPolicy({ [name]: value });
    expect(p.daysBefore).toEqual([7, 3, 1, 0]);
    expect(p.overdueDays).toEqual([1, 3, 7]);
    expect(p.warnings).toHaveLength(1);
    expect(p.warnings[0]).toContain(name);
  });

  it("rejects an invalid Final Review notice window", () => {
    const p = loadReminderPolicy({ APPRAISAL_FINAL_REVIEW_NOTICE_DAYS: "0" });
    expect(p.finalReviewNoticeDays).toBe(30);
    expect(p.warnings).toHaveLength(1);
  });

  it("uses Jamaica's calendar date", () => {
    expect(reminderToday(new Date("2026-10-23T03:00:00Z"))).toBe("2026-10-22");
    expect(reminderToday(new Date("2026-10-23T13:00:00Z"))).toBe("2026-10-23");
  });

  it("backs off 15 minutes then 1 hour and stops after 3 attempts", () => {
    expect(retryDelayMinutes(1)).toBe(15);
    expect(retryDelayMinutes(2)).toBe(60);
    expect(retryDelayMinutes(3)).toBeNull();
    expect(retryDelayMinutes(4)).toBeNull();
  });

  it("describes offsets for the dry run", () => {
    expect(describeOffset(-7)).toBe("7 days before due date");
    expect(describeOffset(-1)).toBe("1 day before due date");
    expect(describeOffset(0)).toBe("On the due date");
    expect(describeOffset(3)).toBe("3 days overdue");
    expect(describeOffset(null)).toBe("Review available notice");
  });

  it("catches up a missed occurrence for at most 2 days and never past the last overdue offset", () => {
    const due = "2026-10-30";
    expect(currentOccurrence("2026-10-22", due, DEFAULT_REMINDER_POLICY)).toBeNull();
    expect(currentOccurrence("2026-10-25", due, DEFAULT_REMINDER_POLICY)?.offsetDays).toBe(-7);
    expect(currentOccurrence("2026-10-26", due, DEFAULT_REMINDER_POLICY)).toBeNull();
    expect(currentOccurrence("2026-11-08", due, DEFAULT_REMINDER_POLICY)?.offsetDays).toBe(7);
    expect(currentOccurrence("2026-11-09", due, DEFAULT_REMINDER_POLICY)).toBeNull();
    expect(currentOccurrence("2027-06-01", due, DEFAULT_REMINDER_POLICY)).toBeNull();
  });
});

describe("planAppraisalReminders: Mid-Year", () => {
  it.each([
    ["2026-10-23", "MIDYEAR_DUE_SOON:-7:2026-10-30"],
    ["2026-10-27", "MIDYEAR_DUE_SOON:-3:2026-10-30"],
    ["2026-10-29", "MIDYEAR_DUE_SOON:-1:2026-10-30"],
    ["2026-10-30", "MIDYEAR_DUE_SOON:0:2026-10-30"],
    ["2026-10-31", "MIDYEAR_OVERDUE:+1:2026-10-30"],
    ["2026-11-02", "MIDYEAR_OVERDUE:+3:2026-10-30"],
    ["2026-11-06", "MIDYEAR_OVERDUE:+7:2026-10-30"],
  ])("on %s reminds the employee with %s while the formal review is OPEN", (today, key) => {
    const p = plan({ today, formal: ["OPEN"] });
    expect(keys(p)).toEqual([key]);
    expect(p[0]).toMatchObject({ recipientEmployeeId: "emp-1", recipientRole: "employee", dueDate: "2026-10-30" });
    expect(p[0].isOverdue).toBe(key.includes("+"));
  });

  it("stops overdue reminders after the last configured offset", () => {
    expect(plan({ today: "2026-11-09", formal: ["OPEN"] })).toEqual([]);
    expect(plan({ today: "2026-12-15", formal: ["OPEN"] })).toEqual([]);
  });

  it("reminds the manager, not the employee, once the employee has submitted", () => {
    for (const status of ["EMPLOYEE_SUBMITTED", "MANAGER_REVIEWED"]) {
      const p = plan({ today: "2026-10-27", formal: [status] });
      expect(p).toHaveLength(1);
      expect(p[0]).toMatchObject({
        kind: "MIDYEAR_MANAGER_REVIEW_PENDING",
        recipientEmployeeId: "mgr-1",
        recipientRole: "manager",
        reminderKey: "MIDYEAR_MANAGER_REVIEW_PENDING:-3:2026-10-30",
        isOverdue: false,
      });
    }
    expect(plan({ today: "2026-10-31", formal: ["EMPLOYEE_SUBMITTED"] })[0]).toMatchObject({
      reminderKey: "MIDYEAR_MANAGER_REVIEW_PENDING:+1:2026-10-30",
      isOverdue: true,
    });
  });

  it("sends nothing when the Mid-Year is complete, cancelled or not yet initiated", () => {
    expect(plan({ today: "2026-10-27", formal: ["COMPLETE"] })).toEqual([]);
    expect(plan({ today: "2026-10-27", formal: ["CANCELLED"] })).toEqual([]);
    expect(plan({ today: "2026-10-27", formal: [] })).toEqual([]);
  });

  it("sends nothing when Mid-Year is disabled, the window has not opened or there is no due date", () => {
    expect(plan({ today: "2026-10-27", formal: ["OPEN"], cycle: { ...MIDYEAR_CYCLE, midyear_review_enabled: false } })).toEqual([]);
    expect(plan({ today: "2026-10-27", formal: ["OPEN"], cycle: { ...MIDYEAR_CYCLE, midyear_window_start: "2026-10-28" } })).toEqual([]);
    expect(plan({ today: "2026-10-27", formal: ["OPEN"], cycle: { ...MIDYEAR_CYCLE, midyear_due_date: null } })).toEqual([]);
  });

  it("sends nothing outside IN_PROGRESS or for a closed cycle", () => {
    for (const status of ["DRAFT", "PENDING_APPROVAL", "SELF_ASSESSMENT", "COMPLETE"]) {
      expect(plan({ today: "2026-10-27", status, formal: ["OPEN"] }).filter((r) => r.kind.startsWith("MIDYEAR"))).toEqual([]);
    }
    expect(plan({ today: "2026-10-27", formal: ["OPEN"], cycle: { ...MIDYEAR_CYCLE, status: "closed" } })).toEqual([]);
  });

  it("skips the manager reminder when the appraisal has no manager", () => {
    expect(plan({ today: "2026-10-27", formal: ["EMPLOYEE_SUBMITTED"], appraisal: { manager_employee_id: null } })).toEqual([]);
  });
});

describe("planAppraisalReminders: Final Review", () => {
  it("sends the one-off availability notice inside the notice window, before the due-soon reminders", () => {
    expect(plan({ today: "2027-02-28", cycle: ANNUAL_CYCLE })).toEqual([]);
    const p = plan({ today: "2027-03-01", cycle: ANNUAL_CYCLE });
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({
      kind: "FINAL_REVIEW_AVAILABLE",
      reminderKey: "FINAL_REVIEW_AVAILABLE:once:2027-03-31",
      recipientRole: "employee",
      offsetDays: null,
    });
    expect(keys(plan({ today: "2027-03-15", cycle: ANNUAL_CYCLE }))).toEqual(["FINAL_REVIEW_AVAILABLE:once:2027-03-31"]);
  });

  it("does not repeat the availability notice once recorded", () => {
    const existing = new Set([occurrenceId("a-1", "emp-1", "FINAL_REVIEW_AVAILABLE:once:2027-03-31")]);
    expect(plan({ today: "2027-03-10", cycle: ANNUAL_CYCLE, existing })).toEqual([]);
  });

  it.each([
    ["IN_PROGRESS", "2027-03-24", "FINAL_REVIEW_DUE_SOON:-7:2027-03-31"],
    ["SELF_ASSESSMENT", "2027-03-28", "FINAL_REVIEW_DUE_SOON:-3:2027-03-31"],
    ["SELF_ASSESSMENT", "2027-03-31", "FINAL_REVIEW_DUE_SOON:0:2027-03-31"],
    ["SELF_ASSESSMENT", "2027-04-01", "FINAL_REVIEW_OVERDUE:+1:2027-03-31"],
    ["SELF_ASSESSMENT", "2027-04-07", "FINAL_REVIEW_OVERDUE:+7:2027-03-31"],
  ])("%s on %s plans %s", (status, today, key) => {
    const p = plan({ today, status, cycle: ANNUAL_CYCLE });
    expect(keys(p)).toEqual([key]);
    expect(p[0].recipientRole).toBe("employee");
  });

  it("is not available while a required Mid-Year is incomplete", () => {
    for (const formal of [[], ["OPEN"], ["EMPLOYEE_SUBMITTED"], ["CANCELLED"]]) {
      expect(plan({ today: "2027-03-24", formal }).filter((r) => r.kind.startsWith("FINAL"))).toEqual([]);
    }
    expect(keys(plan({ today: "2027-03-24", formal: ["CANCELLED", "COMPLETE"] }))).toEqual(["FINAL_REVIEW_DUE_SOON:-7:2027-03-31"]);
  });

  it.each(["DRAFT", "PENDING_APPROVAL", "SUBMITTED", "PENDING_SIGNOFF", "HOD_REVIEW", "HR_REVIEW", "COMPLETE"])(
    "sends nothing to the employee or manager while %s",
    (status) => {
      expect(plan({ today: "2027-03-28", status, cycle: ANNUAL_CYCLE })).toEqual([]);
    }
  );

  it("stops once the employee has submitted (MANAGER_REVIEW) and reminds the manager instead", () => {
    const p = plan({ today: "2027-03-28", status: "MANAGER_REVIEW", cycle: ANNUAL_CYCLE });
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({
      kind: "MANAGER_REVIEW_PENDING",
      recipientEmployeeId: "mgr-1",
      recipientRole: "manager",
      reminderKey: "MANAGER_REVIEW_PENDING:-3:2027-03-31",
    });
    expect(plan({ today: "2027-04-03", status: "MANAGER_REVIEW", cycle: ANNUAL_CYCLE })[0]).toMatchObject({
      reminderKey: "MANAGER_REVIEW_PENDING:+3:2027-03-31",
      isOverdue: true,
    });
    expect(plan({ today: "2027-03-28", status: "MANAGER_REVIEW", cycle: ANNUAL_CYCLE, appraisal: { manager_employee_id: null } })).toEqual([]);
  });

  it("sends nothing when the cycle has no end date", () => {
    expect(plan({ today: "2027-03-28", status: "SELF_ASSESSMENT", cycle: { ...ANNUAL_CYCLE, end_date: null } })).toEqual([]);
  });

  it("honours a custom offset policy", () => {
    const policy = { daysBefore: [5], overdueDays: [2], finalReviewNoticeDays: 10 };
    expect(keys(plan({ today: "2027-03-26", status: "SELF_ASSESSMENT", cycle: ANNUAL_CYCLE, policy }))).toEqual([
      "FINAL_REVIEW_DUE_SOON:-5:2027-03-31",
    ]);
    expect(plan({ today: "2027-03-24", status: "SELF_ASSESSMENT", cycle: ANNUAL_CYCLE, policy })).toEqual([]);
    expect(keys(plan({ today: "2027-04-02", status: "SELF_ASSESSMENT", cycle: ANNUAL_CYCLE, policy }))).toEqual([
      "FINAL_REVIEW_OVERDUE:+2:2027-03-31",
    ]);
  });
});

describe("planAppraisalReminders: idempotency", () => {
  it("is deterministic and never re-plans a recorded occurrence", () => {
    const first = plan({ today: "2027-03-28", status: "SELF_ASSESSMENT", cycle: ANNUAL_CYCLE });
    expect(plan({ today: "2027-03-28", status: "SELF_ASSESSMENT", cycle: ANNUAL_CYCLE })).toEqual(first);
    const existing = new Set(first.map((r) => occurrenceId(r.appraisalId, r.recipientEmployeeId, r.reminderKey)));
    expect(plan({ today: "2027-03-28", status: "SELF_ASSESSMENT", cycle: ANNUAL_CYCLE, existing })).toEqual([]);
    expect(plan({ today: "2027-03-29", status: "SELF_ASSESSMENT", cycle: ANNUAL_CYCLE, existing })).toEqual([]);
  });

  it("only plans kinds that have an email template", () => {
    for (const kind of REMINDER_KINDS) expect(EMAIL_TEMPLATES[kind]).toBeDefined();
  });
});

describe("upcomingAppraisalReminders (dry-run diagnostic)", () => {
  function upcoming(opts: Parameters<typeof plan>[0] & { extra?: ReminderAppraisal[]; limit?: number }) {
    const cycle = opts.cycle ?? MIDYEAR_CYCLE;
    const a = appraisal(opts.status ?? "IN_PROGRESS", { cycle_id: cycle.id, ...opts.appraisal });
    const all = [a, ...(opts.extra ?? [])];
    return upcomingAppraisalReminders(
      {
        today: opts.today,
        policy: opts.policy ?? DEFAULT_REMINDER_POLICY,
        cycles: [cycle, ...[MIDYEAR_CYCLE, ANNUAL_CYCLE].filter((c) => c.id !== cycle.id)],
        appraisals: all,
        formalCheckIns: (opts.formal ?? []).map((status) => ({ appraisal_id: a.id, status })),
        existing: opts.existing,
      },
      opts.limit
    );
  }

  it("gives the next configured Mid-Year occurrence after today", () => {
    expect(upcoming({ today: "2026-10-20", formal: ["OPEN"] })).toEqual([
      expect.objectContaining({
        kind: "MIDYEAR_DUE_SOON",
        recipientRole: "employee",
        scheduledFor: "2026-10-23",
        offsetDays: -7,
        reminderKey: "MIDYEAR_DUE_SOON:-7:2026-10-30",
      }),
    ]);
  });

  it("moves on to the following offset once today's occurrence exists", () => {
    const existing = new Set([occurrenceId("a-1", "emp-1", "MIDYEAR_DUE_SOON:-7:2026-10-30")]);
    expect(upcoming({ today: "2026-10-23", formal: ["OPEN"], existing })[0]).toMatchObject({ scheduledFor: "2026-10-27", offsetDays: -3 });
    expect(upcoming({ today: "2026-10-30", formal: ["OPEN"] })[0]).toMatchObject({
      kind: "MIDYEAR_OVERDUE",
      scheduledFor: "2026-10-31",
      offsetDays: 1,
    });
  });

  it("follows the same audience rules as the planner", () => {
    expect(upcoming({ today: "2026-10-20", formal: ["EMPLOYEE_SUBMITTED"] })[0]).toMatchObject({
      kind: "MIDYEAR_MANAGER_REVIEW_PENDING",
      recipientEmployeeId: "mgr-1",
      recipientRole: "manager",
    });
    expect(upcoming({ today: "2027-03-20", status: "MANAGER_REVIEW", cycle: ANNUAL_CYCLE })[0]).toMatchObject({
      kind: "MANAGER_REVIEW_PENDING",
      scheduledFor: "2027-03-24",
    });
  });

  it("gives the Final Review availability notice before the dated reminders", () => {
    expect(upcoming({ today: "2027-02-01", cycle: ANNUAL_CYCLE })[0]).toMatchObject({
      kind: "FINAL_REVIEW_AVAILABLE",
      scheduledFor: "2027-03-01",
      offsetDays: null,
    });
    const existing = new Set([occurrenceId("a-1", "emp-1", "FINAL_REVIEW_AVAILABLE:once:2027-03-31")]);
    expect(upcoming({ today: "2027-03-10", cycle: ANNUAL_CYCLE, existing })[0]).toMatchObject({
      kind: "FINAL_REVIEW_DUE_SOON",
      scheduledFor: "2027-03-24",
      offsetDays: -7,
    });
    expect(upcoming({ today: "2027-03-30", status: "SELF_ASSESSMENT", cycle: ANNUAL_CYCLE })[0]).toMatchObject({
      scheduledFor: "2027-03-31",
      offsetDays: 0,
    });
  });

  it("returns nothing when no reminder can be calculated", () => {
    expect(upcoming({ today: "2026-11-06", formal: ["OPEN"] })).toEqual([]);
    expect(upcoming({ today: "2026-10-20", formal: [] })).toEqual([]);
    expect(upcoming({ today: "2026-10-20", formal: ["COMPLETE"], cycle: { ...MIDYEAR_CYCLE, end_date: null } })).toEqual([]);
    expect(upcoming({ today: "2027-03-20", status: "COMPLETE", cycle: ANNUAL_CYCLE })).toEqual([]);
    expect(upcoming({ today: "2027-04-07", status: "SELF_ASSESSMENT", cycle: ANNUAL_CYCLE })).toEqual([]);
  });

  it("picks the soonest across appraisals, one per appraisal, at most 3", () => {
    const extra: ReminderAppraisal[] = [
      { id: "a-2", employee_id: "emp-2", manager_employee_id: "mgr-1", cycle_id: "c-annual", status: "SELF_ASSESSMENT" },
      { id: "a-3", employee_id: "emp-3", manager_employee_id: "mgr-1", cycle_id: "c-annual", status: "MANAGER_REVIEW" },
      { id: "a-4", employee_id: "emp-4", manager_employee_id: "mgr-1", cycle_id: "c-annual", status: "IN_PROGRESS" },
      { id: "a-5", employee_id: "emp-5", manager_employee_id: "mgr-1", cycle_id: "c-annual", status: "COMPLETE" },
    ];
    const list = upcoming({ today: "2026-10-20", formal: ["OPEN"], extra });
    expect(list.map((r) => [r.appraisalId, r.scheduledFor])).toEqual([
      ["a-1", "2026-10-23"],
      ["a-4", "2027-03-01"],
      ["a-2", "2027-03-24"],
    ]);
    expect(upcoming({ today: "2026-10-20", formal: ["OPEN"], extra, limit: 1 }).map((r) => r.appraisalId)).toEqual(["a-1"]);
  });

  it("labels timing compactly", () => {
    expect(shortOffsetLabel(-3)).toBe("3 days before due");
    expect(shortOffsetLabel(-1)).toBe("1 day before due");
    expect(shortOffsetLabel(0)).toBe("due-date reminder");
    expect(shortOffsetLabel(7)).toBe("7 days overdue");
    expect(shortOffsetLabel(null)).toBe("availability notice");
  });
});

describe("isReminderStillRequired", () => {
  const state = (status: string, formal: string[] = [], cycle = MIDYEAR_CYCLE, today = "2026-10-27") => {
    const a = appraisal(status, { cycle_id: cycle.id });
    const rows: ReminderFormalCheckIn[] = formal.map((s) => ({ appraisal_id: a.id, status: s }));
    return { a, s: appraisalReminderState(a, cycle, rows, today) };
  };

  it("drops an employee Mid-Year reminder once the employee has submitted", () => {
    const row = { notification_kind: "MIDYEAR_DUE_SOON", recipient_employee_id: "emp-1", due_date: "2026-10-30" };
    const open = state("IN_PROGRESS", ["OPEN"]);
    expect(isReminderStillRequired(row, open.a, open.s)).toBe(true);
    const submitted = state("IN_PROGRESS", ["EMPLOYEE_SUBMITTED"]);
    expect(isReminderStillRequired(row, submitted.a, submitted.s)).toBe(false);
  });

  it("drops a manager reminder once the manager review is done or the manager changed", () => {
    const row = { notification_kind: "MANAGER_REVIEW_PENDING", recipient_employee_id: "mgr-1", due_date: "2027-03-31" };
    const pending = state("MANAGER_REVIEW", [], ANNUAL_CYCLE, "2027-03-28");
    expect(isReminderStillRequired(row, pending.a, pending.s)).toBe(true);
    const signoff = state("PENDING_SIGNOFF", [], ANNUAL_CYCLE, "2027-03-28");
    expect(isReminderStillRequired(row, signoff.a, signoff.s)).toBe(false);
    expect(isReminderStillRequired({ ...row, recipient_employee_id: "old-mgr" }, pending.a, pending.s)).toBe(false);
  });

  it("drops a reminder whose due date has since changed", () => {
    const row = { notification_kind: "FINAL_REVIEW_DUE_SOON", recipient_employee_id: "emp-1", due_date: "2027-03-15" };
    const s = state("SELF_ASSESSMENT", [], ANNUAL_CYCLE, "2027-03-10");
    expect(isReminderStillRequired(row, s.a, s.s)).toBe(false);
  });

  it("never treats Adobe Sign or unknown kinds as reminders", () => {
    const s = state("PENDING_SIGNOFF", [], ANNUAL_CYCLE, "2027-03-28");
    expect(isReminderStillRequired({ notification_kind: "SIGNOFF_REMINDER", recipient_employee_id: "emp-1", due_date: null }, s.a, s.s)).toBe(false);
    expect((REMINDER_KINDS as readonly string[]).some((k) => /SIGN|ADOBE|AGREEMENT/.test(k))).toBe(false);
  });
});
