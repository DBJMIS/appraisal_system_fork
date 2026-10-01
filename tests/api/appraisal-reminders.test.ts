import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { FakeSupabase } from "../helpers/fake-supabase";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  createClient: vi.fn(),
  sendEmailViaGraph: vi.fn(),
  sendEmail: vi.fn(),
  notify: vi.fn(),
  getToken: vi.fn(),
}));

vi.mock("next-auth/jwt", () => ({ getToken: mocks.getToken }));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
  isPlaceholderUser: (u: { id?: string } | null) => u?.id === "placeholder-user-id",
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/email", () => ({ sendEmailViaGraph: mocks.sendEmailViaGraph }));
vi.mock("@/lib/notifications", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/notifications/create", () => ({ createNotificationForEmployeeId: mocks.notify }));

import { GET, POST } from "@/app/api/cron/appraisal-reminders/route";
import { runAppraisalReminders } from "@/lib/appraisal-reminder-delivery";
import { middleware } from "@/middleware";

const TABLE = "appraisal_notification_deliveries";
const NOW = new Date("2026-10-27T13:00:00Z"); // 08:00 in Jamaica; Mid-Year due 2026-10-30 is 3 days away
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);
const SECRET = "test-cron-secret-value";

const HR = { id: "u-hr", roles: ["hr"] };
const ADMIN = { id: "u-admin", roles: ["admin"] };

let db: FakeSupabase;

function seed() {
  db = new FakeSupabase(
    {
      appraisal_cycles: [
        {
          id: "c-1",
          name: "FY 2026",
          fiscal_year: "2026",
          status: "open",
          end_date: "2027-03-31",
          midyear_review_enabled: true,
          midyear_window_start: "2026-10-01",
          midyear_due_date: "2026-10-30",
        },
        { id: "c-old", name: "FY 2025", fiscal_year: "2025", status: "closed", end_date: "2026-11-01", midyear_review_enabled: false },
      ],
      appraisals: [
        // Scores live on the appraisal row; reminders must never read or show them.
        { id: "a-1", employee_id: "emp-1", manager_employee_id: "mgr-1", cycle_id: "c-1", review_type: "annual", status: "IN_PROGRESS", overall_score: 4.37, final_rating: "Exceeds Expectations" },
        { id: "a-2", employee_id: "emp-2", manager_employee_id: "mgr-1", cycle_id: "c-1", review_type: "annual", status: "IN_PROGRESS" },
        { id: "a-3", employee_id: "emp-3", manager_employee_id: "mgr-1", cycle_id: "c-1", review_type: "annual", status: "IN_PROGRESS" },
        { id: "a-4", employee_id: "emp-4", manager_employee_id: "mgr-1", cycle_id: "c-1", review_type: "annual", status: "DRAFT" },
        { id: "a-5", employee_id: "emp-5", manager_employee_id: "mgr-1", cycle_id: "c-old", review_type: "annual", status: "SELF_ASSESSMENT" },
      ],
      check_ins: [
        { id: "ci-1", appraisal_id: "a-1", review_mode: "FORMAL_SCORED", status: "OPEN" },
        { id: "ci-2", appraisal_id: "a-2", review_mode: "FORMAL_SCORED", status: "EMPLOYEE_SUBMITTED" },
        { id: "ci-3", appraisal_id: "a-3", review_mode: "FORMAL_SCORED", status: "COMPLETE" },
        { id: "ci-4", appraisal_id: "a-4", review_mode: "FORMAL", status: "OPEN" },
      ],
      employees: [
        { employee_id: "emp-1", full_name: "Jane Employee", email: "jane@example.test" },
        { employee_id: "emp-2", full_name: "Ann Analyst", email: "ann@example.test" },
        { employee_id: "emp-3", full_name: "Cal Complete", email: "cal@example.test" },
        { employee_id: "emp-4", full_name: "Dee Draft", email: "dee@example.test" },
        { employee_id: "mgr-1", full_name: "Mark Manager", email: "mark@example.test" },
      ],
      app_users: [],
      app_notifications: [],
      [TABLE]: [],
    },
    { [TABLE]: [["appraisal_id", "recipient_employee_id", "reminder_key"]] }
  );
  mocks.createClient.mockReturnValue(db);
}

const deliveries = () => db.tables[TABLE];
const byKey = (key: string) => deliveries().find((d) => d.reminder_key === key)!;
const EMP_KEY = "MIDYEAR_DUE_SOON:-3:2026-10-30";
const MGR_KEY = "MIDYEAR_MANAGER_REVIEW_PENDING:-3:2026-10-30";
const run = (now = NOW, dryRun = false) => runAppraisalReminders(db as never, { now, dryRun });
const graphRecipients = () => mocks.sendEmailViaGraph.mock.calls.map((c) => (c[0] as { to: string }).to);

beforeEach(() => {
  vi.clearAllMocks();
  seed();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://ascend.example.test");
  vi.stubEnv("APPRAISAL_REMINDER_DAYS_BEFORE", "");
  vi.stubEnv("APPRAISAL_OVERDUE_REMINDER_DAYS", "");
  mocks.sendEmailViaGraph.mockResolvedValue({ success: true });
  mocks.notify.mockResolvedValue(undefined);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("runAppraisalReminders: delivery", () => {
  it("sends due reminders through Graph and records SENT only after Graph accepts", async () => {
    const summary = await run();
    expect(summary).toMatchObject({
      dryRun: false,
      date: "2026-10-27",
      appraisalsChecked: 3,
      remindersPlanned: 2,
      created: 2,
      sent: 2,
      skipped: 0,
      failed: 0,
    });
    expect(graphRecipients().sort()).toEqual(["jane@example.test", "mark@example.test"]);
    expect(byKey(EMP_KEY)).toMatchObject({
      appraisal_id: "a-1",
      recipient_employee_id: "emp-1",
      recipient_role: "employee",
      notification_kind: "MIDYEAR_DUE_SOON",
      status: "SENT",
      attempt_count: 1,
      sent_at: NOW.toISOString(),
      recipient_email: "jane@example.test",
      error_code: null,
      due_date: "2026-10-30",
      scheduled_for: "2026-10-27",
      offset_days: -3,
    });
    expect(byKey(MGR_KEY)).toMatchObject({ recipient_employee_id: "mgr-1", recipient_role: "manager", status: "SENT" });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("renders with the Phase 1 templates and links to the appraisal", async () => {
    await run();
    const call = mocks.sendEmailViaGraph.mock.calls.find((c) => (c[0] as { to: string }).to === "mark@example.test")![0] as {
      subject: string;
      textContent: string;
      htmlContent: string;
      toName: string;
    };
    expect(call.subject).toBe("Mid-Year manager review pending: Ann Analyst");
    expect(call.toName).toBe("Mark Manager");
    expect(call.textContent).toContain("Ann Analyst has submitted their Mid-Year Review");
    expect(call.textContent).toContain("https://ascend.example.test/appraisals/a-2");
    expect(call.htmlContent).toContain("https://ascend.example.test/appraisals/a-2");
  });

  it("creates one in-app notification per reminder", async () => {
    await run();
    expect(mocks.notify).toHaveBeenCalledTimes(2);
    const [employeeId, input] = mocks.notify.mock.calls.find((c) => c[0] === "emp-1")!;
    expect(employeeId).toBe("emp-1");
    expect(input).toMatchObject({
      type: "appraisal.reminder",
      title: "Mid-Year Review due 30 Oct 2026",
      link: "/appraisals/a-1",
      metadata: { appraisal_id: "a-1", kind: "MIDYEAR_DUE_SOON", reminder_key: EMP_KEY },
    });
    expect(byKey(EMP_KEY).in_app_notified_at).toBe(NOW.toISOString());
  });

  it("marks a failed send FAILED with a sanitised code and schedules a retry", async () => {
    mocks.sendEmailViaGraph.mockImplementation(async ({ to }: { to: string }) =>
      to === "jane@example.test"
        ? { success: false, error: 'Graph sendMail failed (503): {"error":{"message":"mailbox jane@example.test unavailable, request-id 123"}}' }
        : { success: true }
    );
    const summary = await run();
    expect(summary).toMatchObject({ sent: 1, failed: 1, retriesScheduled: 1 });
    const row = byKey(EMP_KEY);
    expect(row).toMatchObject({
      status: "FAILED",
      attempt_count: 1,
      error_code: "GRAPH_503",
      next_retry_at: minutes(15).toISOString(),
    });
    expect(row.sent_at ?? null).toBeNull();
    expect(JSON.stringify(row)).not.toMatch(/request-id|unavailable|sendMail/);
    expect(JSON.stringify(summary)).not.toMatch(/Graph sendMail|request-id/);
  });

  it("retries after the backoff and succeeds without a second in-app notification", async () => {
    mocks.sendEmailViaGraph.mockResolvedValueOnce({ success: false, error: "Graph sendMail failed (429): throttled" });
    mocks.sendEmailViaGraph.mockResolvedValue({ success: true });
    await run();
    const failedKey = deliveries().find((d) => d.status === "FAILED")!.reminder_key as string;
    const recipient = byKey(failedKey).recipient_employee_id;

    const early = await run(minutes(5));
    expect(early.sent).toBe(0);
    expect(mocks.sendEmailViaGraph).toHaveBeenCalledTimes(2);

    const retry = await run(minutes(16));
    expect(retry).toMatchObject({ created: 0, sent: 1, failed: 0 });
    expect(byKey(failedKey)).toMatchObject({ status: "SENT", attempt_count: 2, error_code: null, next_retry_at: null });
    expect(mocks.notify.mock.calls.filter((c) => c[0] === recipient)).toHaveLength(1);
  });

  it("stops after 3 attempts", async () => {
    mocks.sendEmailViaGraph.mockResolvedValue({ success: false, error: "Graph sendMail failed (503): down" });
    await run();
    await run(minutes(16));
    const third = await run(minutes(16 + 61));
    expect(third).toMatchObject({ failed: 2, retriesScheduled: 0 });
    expect(byKey(EMP_KEY)).toMatchObject({ status: "FAILED", attempt_count: 3, next_retry_at: null });
    const calls = mocks.sendEmailViaGraph.mock.calls.length;
    expect(calls).toBe(6);
    await run(minutes(24 * 60));
    expect(mocks.sendEmailViaGraph).toHaveBeenCalledTimes(calls);
  });

  it("does not retry a recipient Graph rejects as invalid", async () => {
    mocks.sendEmailViaGraph.mockResolvedValue({ success: false, error: "Graph sendMail failed (400): invalid recipient" });
    const summary = await run();
    expect(summary).toMatchObject({ failed: 2, retriesScheduled: 0 });
    expect(byKey(EMP_KEY)).toMatchObject({ status: "FAILED", attempt_count: 1, error_code: "GRAPH_400", next_retry_at: null });
    await run(minutes(30));
    expect(mocks.sendEmailViaGraph).toHaveBeenCalledTimes(2);
  });

  it("skips a reminder whose action was completed before it was sent", async () => {
    db.tables[TABLE].push({
      id: "d-stale",
      appraisal_id: "a-3",
      recipient_employee_id: "emp-3",
      recipient_role: "employee",
      notification_kind: "MIDYEAR_DUE_SOON",
      reminder_key: EMP_KEY,
      offset_days: -3,
      due_date: "2026-10-30",
      scheduled_for: "2026-10-27",
      status: "PENDING",
      attempt_count: 0,
    });
    const summary = await run();
    expect(summary.skipped).toBe(1);
    expect(db.tables[TABLE].find((d) => d.id === "d-stale")).toMatchObject({ status: "SKIPPED", error_code: "NO_LONGER_REQUIRED" });
    expect(graphRecipients()).not.toContain("cal@example.test");
    expect(mocks.notify.mock.calls.map((c) => c[0])).not.toContain("emp-3");
  });

  it("records why a pending reminder was skipped when its recipient or deadline changed", async () => {
    const pending = { recipient_role: "manager", notification_kind: "MIDYEAR_MANAGER_REVIEW_PENDING", offset_days: -3, scheduled_for: "2026-10-27", status: "PENDING", attempt_count: 0 };
    db.tables[TABLE].push(
      { ...pending, id: "d-old-mgr", appraisal_id: "a-2", recipient_employee_id: "old-mgr", reminder_key: MGR_KEY, due_date: "2026-10-30" },
      { ...pending, id: "d-moved", appraisal_id: "a-2", recipient_employee_id: "mgr-1", reminder_key: "MIDYEAR_MANAGER_REVIEW_PENDING:-3:2026-10-20", due_date: "2026-10-20" }
    );
    await run();
    expect(db.tables[TABLE].find((d) => d.id === "d-old-mgr")).toMatchObject({ status: "SKIPPED", error_code: "RECIPIENT_CHANGED" });
    expect(db.tables[TABLE].find((d) => d.id === "d-moved")).toMatchObject({ status: "SKIPPED", error_code: "SUPERSEDED" });
  });

  it("skips when the status moved on between planning and sending", async () => {
    await run(NOW, true);
    db.tables.check_ins.find((c) => c.id === "ci-1")!.status = "EMPLOYEE_SUBMITTED";
    db.tables[TABLE].push({
      id: "d-raced",
      appraisal_id: "a-1",
      recipient_employee_id: "emp-1",
      recipient_role: "employee",
      notification_kind: "MIDYEAR_DUE_SOON",
      reminder_key: EMP_KEY,
      offset_days: -3,
      due_date: "2026-10-30",
      scheduled_for: "2026-10-27",
      status: "PENDING",
      attempt_count: 0,
    });
    await run();
    expect(db.tables[TABLE].find((d) => d.id === "d-raced")).toMatchObject({ status: "SKIPPED" });
    expect(graphRecipients()).not.toContain("jane@example.test");
  });

  it("skips (without retrying) when the recipient has no email address", async () => {
    db.tables.employees.find((e) => e.employee_id === "emp-1")!.email = null;
    const summary = await run();
    expect(summary).toMatchObject({ sent: 1, skipped: 1, failed: 0 });
    expect(byKey(EMP_KEY)).toMatchObject({ status: "SKIPPED", error_code: "NO_RECIPIENT_EMAIL" });
    expect(graphRecipients()).toEqual(["mark@example.test"]);
  });

  it("falls back to the portal account email when the employee record has none", async () => {
    db.tables.employees.find((e) => e.employee_id === "emp-1")!.email = null;
    db.tables.app_users.push({ id: "u-1", employee_id: "emp-1", email: "jane.portal@example.test" });
    await run();
    expect(graphRecipients()).toContain("jane.portal@example.test");
  });

  it("releases a delivery left in SENDING by a crashed run", async () => {
    db.tables[TABLE].push({
      id: "d-stuck",
      appraisal_id: "a-1",
      recipient_employee_id: "emp-1",
      recipient_role: "employee",
      notification_kind: "MIDYEAR_DUE_SOON",
      reminder_key: EMP_KEY,
      offset_days: -3,
      due_date: "2026-10-30",
      scheduled_for: "2026-10-27",
      status: "SENDING",
      attempt_count: 0,
      claim_token: "old-token",
      last_attempt_at: minutes(-60).toISOString(),
    });
    await run();
    expect(db.tables[TABLE].find((d) => d.id === "d-stuck")).toMatchObject({ status: "SENT", attempt_count: 2 });
    expect(graphRecipients().filter((t) => t === "jane@example.test")).toHaveLength(1);
  });

  it("leaves a recently claimed SENDING delivery alone", async () => {
    db.tables[TABLE].push({
      id: "d-busy",
      appraisal_id: "a-1",
      recipient_employee_id: "emp-1",
      recipient_role: "employee",
      notification_kind: "MIDYEAR_DUE_SOON",
      reminder_key: EMP_KEY,
      status: "SENDING",
      attempt_count: 0,
      claim_token: "other-run",
      last_attempt_at: minutes(-1).toISOString(),
    });
    await run();
    expect(db.tables[TABLE].find((d) => d.id === "d-busy")).toMatchObject({ status: "SENDING", claim_token: "other-run" });
    expect(graphRecipients()).not.toContain("jane@example.test");
  });

  it("defers remaining deliveries when the run reaches its time budget", async () => {
    const summary = await runAppraisalReminders(db as never, { now: NOW, timeBudgetMs: -1 });
    expect(summary).toMatchObject({ created: 2, sent: 0, deferred: 2 });
    expect(deliveries().every((d) => d.status === "PENDING")).toBe(true);
    expect(mocks.sendEmailViaGraph).not.toHaveBeenCalled();
  });
});

describe("runAppraisalReminders: idempotency", () => {
  it("a repeated run creates and sends nothing new", async () => {
    await run();
    const second = await run();
    expect(second).toMatchObject({ remindersPlanned: 0, created: 0, sent: 0 });
    expect(deliveries()).toHaveLength(2);
    expect(mocks.sendEmailViaGraph).toHaveBeenCalledTimes(2);
    expect(mocks.notify).toHaveBeenCalledTimes(2);
  });

  it("a later run the same week waits for the next configured offset", async () => {
    await run();
    expect((await run(new Date("2026-10-28T13:00:00Z"))).sent).toBe(0);
    const dayBefore = await run(new Date("2026-10-29T13:00:00Z"));
    expect(dayBefore.sent).toBe(2);
    expect(deliveries().map((d) => d.reminder_key).sort()).toEqual([
      "MIDYEAR_DUE_SOON:-1:2026-10-30",
      EMP_KEY,
      "MIDYEAR_MANAGER_REVIEW_PENDING:-1:2026-10-30",
      MGR_KEY,
    ]);
  });

  it("overlapping runs send each reminder once (unique key and claim)", async () => {
    const [a, b] = await Promise.all([run(), run()]);
    expect(a.created + b.created).toBe(2);
    expect(deliveries()).toHaveLength(2);
    expect(a.sent + b.sent).toBe(2);
    expect(mocks.sendEmailViaGraph).toHaveBeenCalledTimes(2);
  });

  it("a duplicate occurrence is rejected by the unique key and counted as already scheduled", async () => {
    await run();
    const { error } = await db.from(TABLE).insert({ appraisal_id: "a-1", recipient_employee_id: "emp-1", reminder_key: EMP_KEY });
    expect(error?.message).toMatch(/duplicate key/);
  });
});

describe("runAppraisalReminders: dry run", () => {
  it("lists the reminders without creating deliveries, emails or notifications", async () => {
    const summary = await run(NOW, true);
    expect(summary).toMatchObject({ dryRun: true, appraisalsChecked: 3, remindersPlanned: 2, created: 0, sent: 0 });
    expect(summary.reminders).toEqual(
      expect.arrayContaining([
        {
          appraisalId: "a-1",
          employeeName: "Jane Employee",
          kind: "MIDYEAR_DUE_SOON",
          kindLabel: "Mid-Year Review due soon",
          recipientRole: "employee",
          dueDate: "30 Oct 2026",
          offset: "3 days before due date",
        },
        {
          appraisalId: "a-2",
          employeeName: "Ann Analyst",
          kind: "MIDYEAR_MANAGER_REVIEW_PENDING",
          kindLabel: "Mid-Year manager review pending",
          recipientRole: "manager",
          dueDate: "30 Oct 2026",
          offset: "3 days before due date",
        },
      ])
    );
    expect(db.writes).toEqual([]);
    expect(deliveries()).toEqual([]);
    expect(mocks.sendEmailViaGraph).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });

  it("when nothing is due, reports the next eligible reminders without writing anything", async () => {
    const summary = await run(new Date("2026-10-21T13:00:00Z"), true);
    expect(summary).toMatchObject({ remindersPlanned: 0, reminders: [] });
    expect(summary.nextEligibleReminder).toEqual({
      appraisalId: "a-1",
      employeeName: "Jane Employee",
      reviewType: "Mid-Year Review",
      kind: "MIDYEAR_DUE_SOON",
      label: "Mid-Year Review due soon",
      recipientRole: "employee",
      scheduledDate: "2026-10-23",
      scheduledDateLabel: "23 Oct 2026",
      offsetDays: -7,
      timing: "7 days before due",
    });
    expect(summary.upcomingReminders!.map((u) => [u.appraisalId, u.reviewType, u.recipientRole, u.scheduledDate, u.timing])).toEqual([
      ["a-1", "Mid-Year Review", "employee", "2026-10-23", "7 days before due"],
      ["a-2", "Mid-Year Review", "manager", "2026-10-23", "7 days before due"],
      ["a-3", "Final Review", "employee", "2027-03-01", "availability notice"],
    ]);
    expect(db.writes).toEqual([]);
    expect(mocks.sendEmailViaGraph).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("omits the next eligible reminder when none can be calculated", async () => {
    db.tables.check_ins = [];
    db.tables.appraisal_cycles[0].end_date = null;
    const summary = await run(new Date("2026-10-21T13:00:00Z"), true);
    expect(summary.remindersPlanned).toBe(0);
    expect(summary.nextEligibleReminder).toBeNull();
    expect(summary.upcomingReminders).toEqual([]);
  });

  it("a real run does not include the diagnostic fields", async () => {
    const summary = await run();
    expect(summary.nextEligibleReminder).toBeUndefined();
    expect(summary.upcomingReminders).toBeUndefined();
  });

  it("does not consume the occurrence: the real run still sends it", async () => {
    await run(NOW, true);
    expect((await run()).sent).toBe(2);
  });
});

describe("runAppraisalReminders: app URL messages", () => {
  it("localhost during development is an informational local-testing notice, not a warning", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    const summary = await run(NOW, true);
    expect(summary.notices).toEqual([
      { title: "Local testing mode", message: "Email links point to localhost and will only open correctly on this computer." },
    ]);
    expect(summary.warnings.join(" ")).not.toMatch(/local address/);
  });

  it("localhost in production keeps the configuration warning", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
    const summary = await run(NOW, true);
    expect(summary.notices).toEqual([]);
    expect(summary.warnings).toContain("NEXT_PUBLIC_APP_URL points to a local address (localhost:3000); links will not work for recipients.");
  });

  it.each([
    ["missing", ""],
    ["invalid", "not a url"],
  ])("a %s app URL stays a warning even in development", async (_label, value) => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", value);
    const summary = await run(NOW, true);
    expect(summary.notices).toEqual([]);
    expect(summary.warnings.some((w) => w.startsWith("NEXT_PUBLIC_APP_URL"))).toBe(true);
  });

  it("a real public URL produces neither", async () => {
    const summary = await run(NOW, true);
    expect(summary.notices).toEqual([]);
    expect(summary.warnings).toEqual([]);
  });
});

describe("runAppraisalReminders: privacy and scope", () => {
  it("emails and notifications contain no scores, ratings or comments", async () => {
    await run();
    for (const [opts] of mocks.sendEmailViaGraph.mock.calls as [{ subject: string; textContent: string; htmlContent: string }][]) {
      const all = `${opts.subject} ${opts.textContent} ${opts.htmlContent}`;
      expect(all).not.toMatch(/\bscores?\b|\bratings?\b/i);
      expect(all).not.toContain("4.37");
      expect(all).not.toContain("Exceeds Expectations");
    }
    for (const [, input] of mocks.notify.mock.calls as [string, { title: string; body: string; metadata: unknown }][]) {
      expect(`${input.title} ${input.body} ${JSON.stringify(input.metadata)}`).not.toMatch(/4\.37|Exceeds|score|rating/i);
    }
  });

  it("delivery rows hold only delivery state, never message content", async () => {
    mocks.sendEmailViaGraph.mockResolvedValueOnce({ success: false, error: "Token request failed (401): AADSTS7000215 client secret abc123" });
    await run();
    const allowed = new Set([
      "id",
      "appraisal_id",
      "cycle_id",
      "recipient_employee_id",
      "recipient_email",
      "recipient_role",
      "notification_kind",
      "reminder_key",
      "offset_days",
      "due_date",
      "scheduled_for",
      "status",
      "attempt_count",
      "claim_token",
      "last_attempt_at",
      "sent_at",
      "next_retry_at",
      "error_code",
      "in_app_notified_at",
      "updated_at",
    ]);
    for (const row of deliveries()) {
      for (const key of Object.keys(row)) expect(allowed.has(key)).toBe(true);
      expect(JSON.stringify(row)).not.toMatch(/AADSTS|abc123|Hello|<html/i);
    }
    expect(deliveries().find((d) => d.status === "FAILED")!.error_code).toBe("TOKEN_401");
  });

  it("never plans Adobe Sign reminders and leaves appraisal statuses unchanged", async () => {
    await run();
    expect(deliveries().every((d) => !/SIGN|ADOBE|AGREEMENT/.test(String(d.notification_kind)))).toBe(true);
    expect(db.tables.appraisals.map((a) => a.status)).toEqual(["IN_PROGRESS", "IN_PROGRESS", "IN_PROGRESS", "DRAFT", "SELF_ASSESSMENT"]);
    expect(db.tables.check_ins.map((c) => c.status)).toEqual(["OPEN", "EMPLOYEE_SUBMITTED", "COMPLETE", "OPEN"]);
    expect(db.writes.every((w) => w.table === TABLE)).toBe(true);
  });

  it("the reminder modules use Graph directly, not the error-swallowing sendEmail wrapper", () => {
    for (const file of ["lib/appraisal-reminder-delivery.ts", "lib/appraisal-reminder-planner.ts", "app/api/cron/appraisal-reminders/route.ts"]) {
      const src = fs.readFileSync(path.join(process.cwd(), file), "utf8");
      expect(src).not.toMatch(/from "@\/lib\/notifications"/);
      expect(src).not.toMatch(/nodemailer|smtp/i);
      expect(src).not.toMatch(/adobe/i);
    }
  });
});

describe("/api/cron/appraisal-reminders security", () => {
  const req = (method: "GET" | "POST", headers: Record<string, string> = {}, body?: unknown) =>
    new NextRequest("http://localhost/api/cron/appraisal-reminders", {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const as = (user: unknown) => mocks.getCurrentUser.mockResolvedValue(user);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    vi.stubEnv("CRON_SECRET", SECRET);
    as(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("the scheduled GET runs with the correct bearer secret", async () => {
    const res = await GET(req("GET", { authorization: `Bearer ${SECRET}` }));
    expect(res.status).toBe(200);
    expect((await res.json()).sent).toBe(2);
  });

  it.each([
    ["no secret", {}],
    ["wrong bearer", { authorization: "Bearer nope" }],
    ["wrong x-cron-secret", { "x-cron-secret": "nope" }],
  ])("GET rejects %s", async (_label, headers) => {
    const res = await GET(req("GET", headers));
    expect(res.status).toBe(401);
    expect(mocks.sendEmailViaGraph).not.toHaveBeenCalled();
    expect(db.writes).toEqual([]);
  });

  it("GET rejects even a signed-in HR user without the secret", async () => {
    as(HR);
    expect((await GET(req("GET"))).status).toBe(401);
  });

  it("rejects every secret when CRON_SECRET is not configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(req("GET", { authorization: "Bearer " }))).status).toBe(401);
    expect((await GET(req("GET", { authorization: `Bearer ${SECRET}` }))).status).toBe(401);
  });

  it("POST accepts the scheduler secret via x-cron-secret", async () => {
    const res = await POST(req("POST", { "x-cron-secret": SECRET }));
    expect(res.status).toBe(200);
  });

  it("POST with a bad secret is rejected even for HR", async () => {
    as(HR);
    const res = await POST(req("POST", { "x-cron-secret": "nope" }, { dryRun: true }));
    expect(res.status).toBe(401);
    expect(db.writes).toEqual([]);
  });

  it.each([
    ["unauthenticated", null, 401],
    ["placeholder", { id: "placeholder-user-id", roles: ["admin"] }, 401],
    ["employee", { id: "e", roles: ["employee"] }, 403],
    ["manager", { id: "m", roles: ["manager"] }, 403],
  ])("POST rejects %s users", async (_label, user, status) => {
    as(user);
    const res = await POST(req("POST", {}, { dryRun: false }));
    expect(res.status).toBe(status);
    expect(mocks.sendEmailViaGraph).not.toHaveBeenCalled();
    expect(db.writes).toEqual([]);
  });

  it.each([
    ["HR", HR],
    ["Admin", ADMIN],
  ])("%s can preview and run manually", async (_label, user) => {
    as(user);
    const preview = await POST(req("POST", {}, { dryRun: true }));
    expect(preview.status).toBe(200);
    const previewBody = await preview.json();
    expect(previewBody.dryRun).toBe(true);
    expect(previewBody.reminders).toHaveLength(2);
    expect(db.writes).toEqual([]);

    const runRes = await POST(req("POST", {}, {}));
    expect(runRes.status).toBe(200);
    expect(await runRes.json()).toMatchObject({ dryRun: false, appraisalsChecked: 3, sent: 2, skipped: 0, failed: 0 });
  });

  it("returns a generic error without internals when the run fails", async () => {
    as(HR);
    mocks.createClient.mockReturnValue({
      from: () => {
        throw new Error("connection refused at db.internal:5432");
      },
    });
    const res = await POST(req("POST", {}, {}));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: "The reminder check could not be completed.", code: "RUN_FAILED" });
  });
});

describe("/api/cron/appraisal-reminders through middleware", () => {
  const URL_PATH = "https://ascend.example.test/api/cron/appraisal-reminders";
  const make = (method: "GET" | "POST", headers: Record<string, string> = {}, body?: unknown) =>
    new NextRequest(URL_PATH, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });

  /** Runs middleware first, exactly as Next.js does, and only calls the route if middleware lets it through. */
  async function call(method: "GET" | "POST", headers: Record<string, string> = {}, body?: unknown) {
    const mw = await middleware(make(method, headers, body));
    if (mw.headers.get("location")) return { redirected: true, status: mw.status };
    const res = await (method === "GET" ? GET : POST)(make(method, headers, body));
    return { redirected: false, status: res.status, body: await res.json() };
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    vi.stubEnv("NEXTAUTH_SECRET", "test-nextauth-secret");
    vi.stubEnv("CRON_SECRET", SECRET);
    mocks.getToken.mockResolvedValue(null);
    mocks.getCurrentUser.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("a scheduled call with the valid secret reaches the route and runs", async () => {
    const r = await call("GET", { authorization: `Bearer ${SECRET}` });
    expect(r).toMatchObject({ redirected: false, status: 200 });
    expect(r.body.sent).toBe(2);
  });

  it("x-cron-secret also reaches the route", async () => {
    expect(await call("POST", { "x-cron-secret": SECRET })).toMatchObject({ redirected: false, status: 200 });
  });

  it.each([
    ["no secret", "GET", {}],
    ["an invalid bearer secret", "GET", { authorization: "Bearer wrong" }],
    ["an invalid x-cron-secret", "POST", { "x-cron-secret": "wrong" }],
    ["no secret or session (POST)", "POST", {}],
  ] as const)("is not redirected but is rejected by the route with %s", async (_label, method, headers) => {
    const r = await call(method, headers as Record<string, string>);
    expect(r.redirected).toBe(false);
    expect(r.status).toBe(401);
    expect(mocks.sendEmailViaGraph).not.toHaveBeenCalled();
    expect(db.writes).toEqual([]);
  });

  it("fails closed when CRON_SECRET is not configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("GET", { authorization: `Bearer ${SECRET}` })).status).toBe(401);
    expect((await call("GET", { authorization: "Bearer " })).status).toBe(401);
    expect(mocks.sendEmailViaGraph).not.toHaveBeenCalled();
  });

  it("a signed-in non-HR user is still refused by the route", async () => {
    mocks.getToken.mockResolvedValue({ roles: ["employee"] });
    mocks.getCurrentUser.mockResolvedValue({ id: "e", roles: ["employee"] });
    expect((await call("POST", {}, { dryRun: true })).status).toBe(403);
  });

  it("HR/Admin manual preview and run still work", async () => {
    mocks.getToken.mockResolvedValue({ roles: ["hr"] });
    mocks.getCurrentUser.mockResolvedValue(HR);
    const preview = await call("POST", {}, { dryRun: true });
    expect(preview).toMatchObject({ redirected: false, status: 200 });
    expect(preview.body.reminders).toHaveLength(2);
    expect(db.writes).toEqual([]);

    mocks.getCurrentUser.mockResolvedValue(ADMIN);
    const run = await call("POST", {}, {});
    expect(run).toMatchObject({ redirected: false, status: 200 });
    expect(run.body).toMatchObject({ dryRun: false, sent: 2, failed: 0 });
  });
});

describe("scheduling configuration", () => {
  it("vercel.json schedules the reminder job once a day at 13:00 UTC (08:00 Jamaica)", () => {
    const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), "vercel.json"), "utf8"));
    expect(config.crons).toEqual([{ path: "/api/cron/appraisal-reminders", schedule: "0 13 * * *" }]);
  });
});
