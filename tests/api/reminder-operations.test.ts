import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { FakeSupabase } from "../helpers/fake-supabase";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  createClient: vi.fn(),
  sendEmailViaGraph: vi.fn(),
  sendEmail: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
  isPlaceholderUser: (u: { id?: string } | null) => u?.id === "placeholder-user-id",
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/email", () => ({ sendEmailViaGraph: mocks.sendEmailViaGraph }));
vi.mock("@/lib/notifications", () => ({ sendEmail: mocks.sendEmail }));
vi.mock("@/lib/notifications/create", () => ({
  createNotificationForEmployeeId: mocks.notify,
  isAppUserUuid: (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
}));

import { GET as LIST } from "@/app/api/admin/reminder-deliveries/route";
import { GET as DETAIL } from "@/app/api/admin/reminder-deliveries/[id]/route";
import { GET as PREVIEW } from "@/app/api/admin/reminder-deliveries/[id]/preview/route";
import { POST as RETRY } from "@/app/api/admin/reminder-deliveries/[id]/retry/route";
import { GET as OUTSTANDING } from "@/app/api/admin/outstanding-appraisal-actions/route";

const TABLE = "appraisal_notification_deliveries";
// 08:00 in Jamaica on 10 Nov 2026: the Mid-Year due date (30 Oct) is 11 days past.
const NOW = new Date("2026-11-10T13:00:00Z");
const HR_ID = "11111111-1111-4111-8111-111111111111";
const HR = { id: HR_ID, roles: ["hr"] };
const ADMIN = { id: "u-admin", roles: ["admin"] };
const EMPLOYEE = { id: "u-emp", roles: ["employee"] };
const MANAGER = { id: "u-mgr", roles: ["manager"] };

const SENSITIVE = /4\.37|Exceeds Expectations|SECRET_COMMENT_TEXT|SECRET_CHECKIN_TEXT|SECRET_EVIDENCE|request-id|mailbox .* unavailable/;

let db: FakeSupabase;

const delivery = (row: Record<string, unknown>) => ({
  cycle_id: "c-1",
  recipient_email: null,
  claim_token: null,
  last_attempt_at: null,
  sent_at: null,
  next_retry_at: null,
  error_code: null,
  in_app_notified_at: null,
  created_at: row.updated_at,
  ...row,
});

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
        { id: "c-old", name: "FY 2025", fiscal_year: "2025", status: "closed", end_date: "2026-03-31", midyear_review_enabled: false },
      ],
      appraisals: [
        {
          id: "a-1",
          employee_id: "emp-1",
          manager_employee_id: "mgr-1",
          cycle_id: "c-1",
          review_type: "annual",
          status: "IN_PROGRESS",
          overall_score: 4.37,
          final_rating: "Exceeds Expectations",
          manager_comments: "SECRET_COMMENT_TEXT",
        },
        { id: "a-2", employee_id: "emp-2", manager_employee_id: "mgr-1", cycle_id: "c-1", review_type: "annual", status: "IN_PROGRESS" },
        { id: "a-3", employee_id: "emp-3", manager_employee_id: "mgr-1", cycle_id: "c-1", review_type: "annual", status: "IN_PROGRESS" },
        { id: "a-5", employee_id: "emp-5", manager_employee_id: "mgr-1", cycle_id: "c-old", review_type: "annual", status: "SELF_ASSESSMENT" },
      ],
      check_ins: [
        { id: "ci-1", appraisal_id: "a-1", review_mode: "FORMAL_SCORED", status: "OPEN", employee_comments: "SECRET_CHECKIN_TEXT" },
        { id: "ci-2", appraisal_id: "a-2", review_mode: "FORMAL_SCORED", status: "EMPLOYEE_SUBMITTED" },
        { id: "ci-3", appraisal_id: "a-3", review_mode: "FORMAL_SCORED", status: "COMPLETE" },
      ],
      employees: [
        { employee_id: "emp-1", full_name: "Jane Employee", email: "jane@example.test" },
        { employee_id: "emp-2", full_name: "Ann Analyst", email: "ann@example.test" },
        { employee_id: "emp-3", full_name: "Cal Complete", email: "cal@example.test" },
        { employee_id: "emp-5", full_name: "Old Cycle", email: "old@example.test" },
        { employee_id: "mgr-1", full_name: "Mark Manager", email: "mark@example.test" },
        { employee_id: "dir-1", full_name: "Dana Director", email: "dana@example.test" },
      ],
      reporting_lines: [
        { id: "rl-1", employee_id: "emp-1", manager_employee_id: "mgr-1", is_primary: true },
        { id: "rl-2", employee_id: "mgr-1", manager_employee_id: "dir-1", is_primary: true },
      ],
      app_users: [],
      app_notifications: [],
      appraisal_audit: [],
      evidence: [{ id: "ev-1", appraisal_id: "a-1", description: "SECRET_EVIDENCE" }],
      [TABLE]: [
        delivery({
          id: "d-sent",
          appraisal_id: "a-1",
          recipient_employee_id: "emp-1",
          recipient_email: "jane@example.test",
          recipient_role: "employee",
          notification_kind: "MIDYEAR_DUE_SOON",
          reminder_key: "MIDYEAR_DUE_SOON:-3:2026-10-30",
          offset_days: -3,
          due_date: "2026-10-30",
          scheduled_for: "2026-10-27",
          status: "SENT",
          attempt_count: 1,
          last_attempt_at: "2026-10-27T13:00:00.000Z",
          sent_at: "2026-10-27T13:00:01.000Z",
          in_app_notified_at: "2026-10-27T13:00:00.000Z",
          updated_at: "2026-10-27T13:00:01.000Z",
        }),
        delivery({
          id: "d-failed",
          appraisal_id: "a-1",
          recipient_employee_id: "emp-1",
          recipient_role: "employee",
          notification_kind: "MIDYEAR_OVERDUE",
          reminder_key: "MIDYEAR_OVERDUE:+1:2026-10-30",
          offset_days: 1,
          due_date: "2026-10-30",
          scheduled_for: "2026-10-31",
          status: "FAILED",
          attempt_count: 1,
          error_code: "GRAPH_503",
          last_attempt_at: "2026-10-31T13:00:00.000Z",
          next_retry_at: "2026-10-31T13:15:00.000Z",
          in_app_notified_at: "2026-10-31T13:00:00.000Z",
          updated_at: "2026-10-31T13:00:01.000Z",
        }),
        delivery({
          id: "d-mgr-sent",
          appraisal_id: "a-2",
          recipient_employee_id: "mgr-1",
          recipient_email: "mark@example.test",
          recipient_role: "manager",
          notification_kind: "MIDYEAR_MANAGER_REVIEW_PENDING",
          reminder_key: "MIDYEAR_MANAGER_REVIEW_PENDING:+3:2026-10-30",
          offset_days: 3,
          due_date: "2026-10-30",
          scheduled_for: "2026-11-02",
          status: "SENT",
          attempt_count: 1,
          last_attempt_at: "2026-11-02T13:00:00.000Z",
          sent_at: "2026-11-02T13:00:01.000Z",
          updated_at: "2026-11-02T13:00:01.000Z",
        }),
        delivery({
          id: "d-skip",
          appraisal_id: "a-3",
          recipient_employee_id: "emp-3",
          recipient_role: "employee",
          notification_kind: "MIDYEAR_DUE_SOON",
          reminder_key: "MIDYEAR_DUE_SOON:-7:2026-10-30",
          offset_days: -7,
          due_date: "2026-10-30",
          scheduled_for: "2026-10-23",
          status: "SKIPPED",
          attempt_count: 0,
          error_code: "NO_LONGER_REQUIRED",
          updated_at: "2026-10-23T13:00:01.000Z",
        }),
        delivery({
          id: "d-pending",
          appraisal_id: "a-2",
          recipient_employee_id: "mgr-1",
          recipient_role: "manager",
          notification_kind: "MIDYEAR_MANAGER_REVIEW_PENDING",
          reminder_key: "MIDYEAR_MANAGER_REVIEW_PENDING:+7:2026-10-30",
          offset_days: 7,
          due_date: "2026-10-30",
          scheduled_for: "2026-11-06",
          status: "PENDING",
          attempt_count: 0,
          updated_at: "2026-11-06T13:00:00.000Z",
        }),
        delivery({
          id: "d-old",
          appraisal_id: "a-5",
          cycle_id: "c-old",
          recipient_employee_id: "emp-5",
          recipient_role: "employee",
          notification_kind: "FINAL_REVIEW_DUE_SOON",
          reminder_key: "FINAL_REVIEW_DUE_SOON:-7:2026-03-31",
          offset_days: -7,
          due_date: "2026-03-31",
          scheduled_for: "2026-03-24",
          status: "SENT",
          attempt_count: 1,
          sent_at: "2026-03-24T13:00:01.000Z",
          updated_at: "2026-03-24T13:00:01.000Z",
        }),
      ],
    },
    { [TABLE]: [["appraisal_id", "recipient_employee_id", "reminder_key"]] }
  );
  mocks.createClient.mockReturnValue(db);
}

const listReq = (query = "") => LIST(new NextRequest(`http://localhost/api/admin/reminder-deliveries${query ? `?${query}` : ""}`));
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const detail = (id: string) => DETAIL(new Request(`http://localhost/api/admin/reminder-deliveries/${id}`), ctx(id));
const preview = (id: string) => PREVIEW(new Request(`http://localhost/api/admin/reminder-deliveries/${id}/preview`), ctx(id));
const retry = (id: string) => RETRY(new Request(`http://localhost/api/admin/reminder-deliveries/${id}/retry`, { method: "POST" }), ctx(id));
const outstanding = (query = "") =>
  OUTSTANDING(new NextRequest(`http://localhost/api/admin/outstanding-appraisal-actions${query ? `?${query}` : ""}`));
const row = (id: string) => db.tables[TABLE].find((d) => d.id === id)!;
const ids = (body: { items: { id: string }[] }) => body.items.map((i) => i.id);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  seed();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://ascend.example.test");
  vi.stubEnv("APPRAISAL_ESCALATION_DAYS_OVERDUE", "");
  mocks.getCurrentUser.mockResolvedValue(HR);
  mocks.sendEmailViaGraph.mockResolvedValue({ success: true });
  mocks.notify.mockResolvedValue(undefined);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("access control", () => {
  const calls: [string, () => Promise<Response>][] = [
    ["list", () => listReq()],
    ["detail", () => detail("d-failed")],
    ["preview", () => preview("d-failed")],
    ["retry", () => retry("d-failed")],
    ["outstanding", () => outstanding()],
  ];

  it.each(calls)("%s: HR and Admin are allowed", async (_name, call) => {
    for (const user of [HR, ADMIN]) {
      seed();
      mocks.getCurrentUser.mockResolvedValue(user);
      expect((await call()).status).toBe(200);
    }
  });

  it.each(calls)("%s: employees and managers get 403, anonymous gets 401, and nothing is sent", async (_name, call) => {
    for (const user of [EMPLOYEE, MANAGER]) {
      mocks.getCurrentUser.mockResolvedValue(user);
      const res = await call();
      expect(res.status).toBe(403);
      expect(JSON.stringify(await res.json())).not.toMatch(/Jane|jane@|GRAPH/);
    }
    mocks.getCurrentUser.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    mocks.getCurrentUser.mockResolvedValue({ id: "placeholder-user-id", roles: ["hr"] });
    expect((await call()).status).toBe(401);
    expect(mocks.sendEmailViaGraph).not.toHaveBeenCalled();
    expect(row("d-failed")).toMatchObject({ status: "FAILED", attempt_count: 1 });
  });
});

describe("GET /api/admin/reminder-deliveries", () => {
  it("defaults to the current cycle, newest activity first, with display columns", async () => {
    const body = await (await listReq()).json();
    expect(body.cycleId).toBe("c-1");
    expect(ids(body)).toEqual(["d-pending", "d-mgr-sent", "d-failed", "d-sent", "d-skip"]);
    expect(body.cycles.map((c: { id: string }) => c.id)).toEqual(["c-1", "c-old"]);
    const failed = body.items.find((i: { id: string }) => i.id === "d-failed");
    expect(failed).toMatchObject({
      employeeName: "Jane Employee",
      kindLabel: expect.any(String),
      recipientRole: "employee",
      recipientName: "Jane Employee",
      dueDate: "2026-10-30",
      status: "FAILED",
      statusLabel: "Failed",
      statusTone: "error",
      attemptCount: 1,
      errorCode: "GRAPH_503",
      reason: "Mail service unavailable",
    });
    expect(body.items.find((i: { id: string }) => i.id === "d-skip")).toMatchObject({ statusLabel: "Skipped", reason: "Action already completed" });
  });

  it("lists every cycle with cycleId=all and one cycle when chosen", async () => {
    expect(ids(await (await listReq("cycleId=all")).json())).toContain("d-old");
    expect(ids(await (await listReq("cycleId=c-old")).json())).toEqual(["d-old"]);
  });

  it("returns summary metrics and success rate for the filtered set, ignoring the status filter", async () => {
    const body = await (await listReq("status=FAILED")).json();
    expect(ids(body)).toEqual(["d-failed"]);
    expect(body.metrics).toEqual({ sent: 2, failed: 1, pending: 1, sending: 0, skipped: 1, successRate: 2 / 3 });
    const none = await (await listReq("cycleId=c-old&status=FAILED")).json();
    expect(none.metrics).toMatchObject({ sent: 1, failed: 0, successRate: 1 });
  });

  it("filters by status, reminder type, recipient role, employee name and date range on the server", async () => {
    expect(ids(await (await listReq("status=SENT")).json())).toEqual(["d-mgr-sent", "d-sent"]);
    expect(ids(await (await listReq("kind=MIDYEAR_OVERDUE")).json())).toEqual(["d-failed"]);
    expect(ids(await (await listReq("role=manager")).json())).toEqual(["d-pending", "d-mgr-sent"]);
    expect(ids(await (await listReq("q=jane")).json())).toEqual(["d-failed", "d-sent"]);
    expect(ids(await (await listReq("q=nobody")).json())).toEqual([]);
    expect(ids(await (await listReq("q=50%25")).json())).toEqual([]);
    expect(ids(await (await listReq("from=2026-10-31&to=2026-10-31")).json())).toEqual(["d-failed"]);
    expect(ids(await (await listReq("from=2026-11-01")).json())).toEqual(["d-pending", "d-mgr-sent"]);
  });

  it("rejects invalid filters", async () => {
    for (const q of ["status=DONE", "kind=SIGNOFF_REMINDER", "role=hr", "from=31-10-2026", "from=2026-11-02&to=2026-11-01", "page=0", "pageSize=abc", "cycleId=bad id"]) {
      const res = await listReq(q);
      expect(res.status, q).toBe(400);
    }
  });

  it("paginates on the server: 25 by default, at most 100", async () => {
    for (let i = 0; i < 30; i++) {
      db.tables[TABLE].push(
        delivery({
          id: `d-extra-${String(i).padStart(2, "0")}`,
          appraisal_id: "a-3",
          recipient_employee_id: "emp-3",
          recipient_role: "employee",
          notification_kind: "FINAL_REVIEW_DUE_SOON",
          reminder_key: `FINAL_REVIEW_DUE_SOON:-${i + 8}:2027-03-31`,
          offset_days: -(i + 8),
          due_date: "2027-03-31",
          scheduled_for: "2027-03-01",
          status: "SKIPPED",
          attempt_count: 0,
          error_code: "SUPERSEDED",
          updated_at: "2026-10-01T13:00:00.000Z",
        })
      );
    }
    const first = await (await listReq()).json();
    expect(first).toMatchObject({ total: 35, page: 1, pageSize: 25 });
    expect(first.items).toHaveLength(25);
    const second = await (await listReq("page=2")).json();
    expect(second.items).toHaveLength(10);
    expect(new Set([...ids(first), ...ids(second)]).size).toBe(35);
    const capped = await (await listReq("pageSize=500")).json();
    expect(capped.pageSize).toBe(100);
    expect(capped.items).toHaveLength(35);
    expect(capped.metrics.skipped).toBe(31);
  });

  it("never returns scores, comments, evidence or raw provider text", async () => {
    const text = JSON.stringify(await (await listReq("cycleId=all")).json());
    expect(text).not.toMatch(SENSITIVE);
    expect(text).not.toMatch(/claim_token|html|body/i);
  });
});

describe("GET /api/admin/reminder-deliveries/[id]", () => {
  it("shows sanitised delivery bookkeeping and retry eligibility", async () => {
    const res = await detail("d-failed");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      id: "d-failed",
      appraisal: { id: "a-1", employeeName: "Jane Employee", cycleName: "FY 2026", statusLabel: "In progress" },
      kind: "MIDYEAR_OVERDUE",
      recipientRole: "employee",
      recipientName: "Jane Employee",
      recipientEmail: "jane@example.test",
      recipientEmailSource: "current",
      scheduledFor: "2026-10-31",
      dueDate: "2026-10-30",
      timing: "1 day overdue",
      status: "FAILED",
      attemptCount: 1,
      maxAttempts: 3,
      firstAttemptAt: "2026-10-31T13:00:00.000Z",
      firstAttemptRecorded: true,
      lastAttemptAt: "2026-10-31T13:00:00.000Z",
      sentAt: null,
      errorCode: "GRAPH_503",
      reason: "Mail service unavailable",
      stillRequired: true,
      retry: { allowed: true, blockCode: null, message: null },
    });
    expect(JSON.stringify(body)).not.toMatch(SENSITIVE);
    expect(body).not.toHaveProperty("claim_token");
    expect(body).not.toHaveProperty("html");
  });

  it("reports the skip reason and that a first attempt is not recorded after several attempts", async () => {
    expect(await (await detail("d-skip")).json()).toMatchObject({ status: "SKIPPED", reason: "Action already completed", retry: { allowed: false } });
    Object.assign(row("d-failed"), { attempt_count: 2 });
    expect(await (await detail("d-failed")).json()).toMatchObject({ firstAttemptAt: null, firstAttemptRecorded: false });
  });

  it("returns 404 for unknown or malformed ids", async () => {
    expect((await detail("missing")).status).toBe(404);
    expect((await detail("bad id!")).status).toBe(404);
  });
});

describe("GET /api/admin/reminder-deliveries/[id]/preview", () => {
  it("regenerates the email from current data without sending or writing", async () => {
    const res = await preview("d-failed");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notice).toBe("Preview reflects the appraisal's current state.");
    expect(body.stateChanged).toBe(false);
    expect(body.subject).toContain("Mid-Year Review");
    expect(body.html).toContain("https://ascend.example.test/appraisals/a-1");
    expect(JSON.stringify(body)).not.toMatch(SENSITIVE);
    expect(db.writes).toEqual([]);
    expect(mocks.sendEmailViaGraph).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("flags when the appraisal has moved on since the reminder was scheduled", async () => {
    Object.assign(db.tables.check_ins.find((c) => c.id === "ci-1")!, { status: "EMPLOYEE_SUBMITTED" });
    const body = await (await preview("d-failed")).json();
    expect(body).toMatchObject({ stateChanged: true, stateChangeReason: "Action already completed" });
  });
});

describe("POST /api/admin/reminder-deliveries/[id]/retry", () => {
  it("retries a failed reminder through the worker on the same row and key, and audits it", async () => {
    const before = db.tables[TABLE].length;
    const res = await retry("d-failed");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ deliveryId: "d-failed", previousStatus: "FAILED", status: "SENT", statusLabel: "Sent", attemptCount: 2, outcome: "SENT" });
    expect(db.tables[TABLE]).toHaveLength(before);
    expect(row("d-failed")).toMatchObject({
      status: "SENT",
      attempt_count: 2,
      reminder_key: "MIDYEAR_OVERDUE:+1:2026-10-30",
      sent_at: NOW.toISOString(),
      error_code: null,
      recipient_email: "jane@example.test",
    });
    expect(mocks.sendEmailViaGraph).toHaveBeenCalledTimes(1);
    expect(mocks.sendEmailViaGraph.mock.calls[0][0]).toMatchObject({ to: "jane@example.test" });
    expect(mocks.notify).not.toHaveBeenCalled();

    expect(db.tables.appraisal_audit).toHaveLength(1);
    const audit = db.tables.appraisal_audit[0];
    expect(audit).toMatchObject({
      appraisal_id: "a-1",
      action_type: "reminder_retry",
      actor_id: HR_ID,
      acted_at: NOW.toISOString(),
      detail: { delivery_id: "d-failed", previous_status: "FAILED", resulting_status: "SENT", attempt_count: 2 },
    });
    expect(JSON.stringify(audit)).not.toMatch(/Mid-Year Review due|https:\/\/|html|jane@/);
    const log = (console.info as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0])).find((l) => l.includes("appraisal_reminder_retry"));
    expect(JSON.parse(log!)).toEqual({
      event: "appraisal_reminder_retry",
      actor_id: HR_ID,
      delivery_id: "d-failed",
      previous_status: "FAILED",
      resulting_status: "SENT",
      at: NOW.toISOString(),
    });
  });

  it("re-checks the appraisal first: a completed action is marked SKIPPED and nothing is sent", async () => {
    Object.assign(db.tables.check_ins.find((c) => c.id === "ci-1")!, { status: "EMPLOYEE_SUBMITTED" });
    const res = await retry("d-failed");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "SKIPPED", reason: "Action already completed" });
    expect(row("d-failed")).toMatchObject({ status: "SKIPPED", error_code: "NO_LONGER_REQUIRED", attempt_count: 1 });
    expect(mocks.sendEmailViaGraph).not.toHaveBeenCalled();
    expect(db.tables.appraisal_audit[0]).toMatchObject({ detail: { previous_status: "FAILED", resulting_status: "SKIPPED" } });
  });

  it("records a sanitised failure when the retry fails again", async () => {
    mocks.sendEmailViaGraph.mockResolvedValue({ success: false, error: 'Graph sendMail failed (503): {"message":"mailbox jane@example.test unavailable, request-id 9"}' });
    const res = await retry("d-failed");
    const body = await res.json();
    expect(body).toMatchObject({ status: "FAILED", attemptCount: 2, reason: "Mail service unavailable" });
    expect(JSON.stringify(body)).not.toMatch(SENSITIVE);
    expect(row("d-failed")).toMatchObject({ status: "FAILED", attempt_count: 2, error_code: "GRAPH_503" });
    expect(JSON.stringify(db.tables.appraisal_audit)).not.toMatch(SENSITIVE);
  });

  const blocked: [string, Record<string, unknown>, string][] = [
    ["a sent reminder", { status: "SENT", sent_at: "2026-11-01T13:00:00.000Z", error_code: null }, "ALREADY_SENT"],
    ["a pending reminder", { status: "PENDING", attempt_count: 0, error_code: null }, "NOT_FAILED"],
    ["a skipped reminder", { status: "SKIPPED", error_code: "NO_LONGER_REQUIRED" }, "NOT_FAILED"],
    ["an invalid recipient", { error_code: "GRAPH_400" }, "INVALID_RECIPIENT"],
    ["a reminder at the attempt limit", { attempt_count: 3 }, "MAX_ATTEMPTS"],
  ];

  it.each(blocked)("refuses %s with 409 and changes nothing", async (_name, patch, code) => {
    Object.assign(row("d-failed"), patch);
    const snapshot = { ...row("d-failed") };
    const res = await retry("d-failed");
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe(code);
    expect(row("d-failed")).toEqual(snapshot);
    expect(mocks.sendEmailViaGraph).not.toHaveBeenCalled();
    expect(db.tables.appraisal_audit).toEqual([]);
  });

  it("refuses when the recipient has no email address", async () => {
    Object.assign(db.tables.employees.find((e) => e.employee_id === "emp-1")!, { email: null });
    const res = await retry("d-failed");
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("NO_RECIPIENT_EMAIL");
    expect(row("d-failed")).toMatchObject({ status: "FAILED", attempt_count: 1 });
    expect(mocks.sendEmailViaGraph).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown reminder", async () => {
    expect((await retry("missing")).status).toBe(404);
  });
});

describe("GET /api/admin/outstanding-appraisal-actions", () => {
  type Item = { appraisalId: string; requiredAction: string; responsibleRole: string; daysOverdue: number; escalationCandidate: boolean; escalationTarget: unknown; lastReminderSentAt: string | null; escalationKey: string };

  it("lists overdue employee and manager actions with days overdue and the last reminder sent", async () => {
    const body = await (await outstanding()).json();
    expect(body.cycleId).toBe("c-1");
    const items = body.items as Item[];
    expect(items.map((i) => [i.appraisalId, i.requiredAction, i.responsibleRole, i.daysOverdue])).toEqual([
      ["a-1", "Submit Mid-Year Review", "employee", 11],
      ["a-2", "Complete Mid-Year manager review", "manager", 11],
    ]);
    expect(items[0]).toMatchObject({ employeeName: "Jane Employee", reviewStage: "Mid-Year Review", responsibleName: "Jane Employee", dueDate: "2026-10-30", lastReminderSentAt: "2026-10-27T13:00:01.000Z" });
    expect(items[1]).toMatchObject({ responsibleName: "Mark Manager", lastReminderSentAt: "2026-11-02T13:00:01.000Z" });
    expect(body.summary).toEqual({ overdue: 2, employeeActions: 1, managerActions: 1, escalationCandidates: 2 });
  });

  it("excludes completed steps and steps not yet due", async () => {
    const items = (await (await outstanding()).json()).items as Item[];
    expect(items.some((i) => i.appraisalId === "a-3")).toBe(false);
    expect(items.some((i) => i.appraisalId === "a-5")).toBe(false);
    Object.assign(db.tables.check_ins.find((c) => c.id === "ci-1")!, { status: "COMPLETE" });
    const after = (await (await outstanding()).json()).items as Item[];
    expect(after.map((i) => i.appraisalId)).toEqual(["a-2"]);
  });

  it("suggests the appraisal manager for employee steps and the manager's primary manager for manager steps", async () => {
    const items = (await (await outstanding()).json()).items as Item[];
    expect(items[0]).toMatchObject({ escalationCandidate: true, escalationKey: "ESCALATION:MIDYEAR_EMPLOYEE:2026-10-30", escalationTarget: { type: "DIRECT_MANAGER", employeeId: "mgr-1", name: "Mark Manager" } });
    expect(items[1]).toMatchObject({ escalationCandidate: true, escalationTarget: { type: "SECOND_LEVEL_MANAGER", employeeId: "dir-1", name: "Dana Director" } });
  });

  it("falls back to HR follow-up when the manager's reporting line is ambiguous or missing", async () => {
    db.tables.reporting_lines.push({ id: "rl-3", employee_id: "mgr-1", manager_employee_id: "dir-2", is_primary: true });
    let items = (await (await outstanding()).json()).items as Item[];
    expect(items[1].escalationTarget).toMatchObject({ type: "HR", employeeId: null, basis: "Manager has more than one primary reporting line" });
    db.tables.reporting_lines = [];
    items = (await (await outstanding()).json()).items as Item[];
    expect(items[1].escalationTarget).toMatchObject({ type: "HR", basis: "Manager has no primary reporting line" });
  });

  it("uses APPRAISAL_ESCALATION_DAYS_OVERDUE and lists candidates only when asked", async () => {
    vi.stubEnv("APPRAISAL_ESCALATION_DAYS_OVERDUE", "14");
    let body = await (await outstanding()).json();
    expect(body.escalationDaysOverdue).toBe(14);
    expect((body.items as Item[]).every((i) => !i.escalationCandidate && i.escalationTarget === null)).toBe(true);
    expect((await (await outstanding("candidatesOnly=1")).json()).items).toEqual([]);

    vi.stubEnv("APPRAISAL_ESCALATION_DAYS_OVERDUE", "soon");
    body = await (await outstanding("candidatesOnly=1")).json();
    expect(body.escalationDaysOverdue).toBe(7);
    expect(body.warnings[0]).toMatch(/APPRAISAL_ESCALATION_DAYS_OVERDUE/);
    expect(body.items).toHaveLength(2);
  });

  it("sends no email and writes nothing", async () => {
    await outstanding();
    expect(db.writes).toEqual([]);
    expect(mocks.sendEmailViaGraph).not.toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it("never returns scores, comments or evidence", async () => {
    expect(JSON.stringify(await (await outstanding("cycleId=all")).json())).not.toMatch(SENSITIVE);
  });

  it("rejects invalid paging", async () => {
    expect((await outstanding("pageSize=0")).status).toBe(400);
    expect((await outstanding("cycleId=bad id")).status).toBe(400);
  });
});
