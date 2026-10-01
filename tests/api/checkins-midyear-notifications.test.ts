import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { FakeSupabase } from "../helpers/fake-supabase";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  createClient: vi.fn(),
  notify: vi.fn(),
  sendEmail: vi.fn(),
  sendSubmitted: vi.fn(),
  sendReviewed: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/dynamics-org-service", async (orig) => ({ ...(await orig<object>()), ...(await import("../helpers/fake-dynamics-org")).fakeDynamicsOrg }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/appraisal-manager-access", () => ({
  resolveManagerAccessForAppraisal: vi.fn(async ({ currentEmployeeId }: { currentEmployeeId: string | null }) => ({
    isPrimaryManager: currentEmployeeId === "mgr-1",
    isDelegated: false,
    hasManagerAccess: currentEmployeeId === "mgr-1",
  })),
}));
vi.mock("@/lib/appraisal-test-bypass", () => ({ allowAppraisalTestBypass: () => false }));
vi.mock("@/lib/notifications/create", () => ({ createNotificationForEmployeeId: mocks.notify }));
vi.mock("@/lib/notifications", () => ({
  sendEmail: mocks.sendEmail,
  sendCheckInSubmittedToManager: mocks.sendSubmitted,
  sendCheckInReviewedToEmployee: mocks.sendReviewed,
}));

import { POST } from "@/app/api/appraisals/[id]/checkins/route";
import { PATCH } from "@/app/api/appraisals/[id]/checkins/[checkinId]/route";
import { POST as WINDOW_NOTICES } from "@/app/api/admin/midyear/window-notices/route";
import { midyearMessages, sendMidyearWindowNotices } from "@/lib/midyear-notifications";
import { fiscalYearLabel, formatMidyearDate } from "@/lib/midyear-config";

const APPRAISAL_ID = "a-1";
const MANAGER = { id: "u-mgr", roles: ["manager"], employee_id: "mgr-1" };
const EMPLOYEE = { id: "u-emp", roles: ["employee"], employee_id: "emp-1" };
const HR = { id: "u-hr", roles: ["hr"], employee_id: "hr-1" };

let db: FakeSupabase;

function seed({ midyear = true, windowStart = "2026-06-01", dueDate = "2026-06-30" } = {}) {
  db = new FakeSupabase(
    {
      appraisals: [
        { id: APPRAISAL_ID, employee_id: "emp-1", manager_employee_id: "mgr-1", division_id: "d-1", cycle_id: "c-1", status: "IN_PROGRESS", is_management: false },
      ],
      appraisal_cycles: [
        {
          id: "c-1",
          name: "FY 2026",
          fiscal_year: "2026",
          status: "open",
          midyear_review_enabled: midyear,
          midyear_scoring_enabled: midyear,
          midyear_window_start: windowStart,
          midyear_due_date: dueDate,
        },
      ],
      employees: [
        { id: "e-uuid-emp", employee_id: "emp-1", full_name: "Jane Employee", email: "jane@example.test", manager_employee_id: "mgr-1" },
        { id: "e-uuid-mgr", employee_id: "mgr-1", full_name: "Mark Manager", email: "mark@example.test", manager_employee_id: null },
      ],
      workplans: [{ id: "wp-1", appraisal_id: APPRAISAL_ID, status: "approved" }],
      workplan_items: [
        { id: "wi-num", workplan_id: "wp-1", major_task: "Deliver reports", weight: 60, metric_type: "NUMBER", metric_target: 10, metric_deadline: null, created_at: 1 },
        { id: "wi-date", workplan_id: "wp-1", major_task: "Launch portal", weight: 40, metric_type: "DATE", metric_target: null, metric_deadline: "2026-06-30", created_at: 2 },
      ],
      evaluation_categories: [
        { id: "cat-core", category_type: "core", active: true },
        { id: "cat-prod", category_type: "productivity", active: true },
      ],
      evaluation_factors: [
        { id: "f-core", category_id: "cat-core", name: "Integrity", weight: 100, display_order: 1, active: true },
        { id: "f-prod", category_id: "cat-prod", name: "Quality", weight: 100, display_order: 1, active: true },
      ],
      appraisal_factor_ratings: [],
      appraisal_technical_competencies: [{ id: "t-sql", appraisal_id: APPRAISAL_ID, name: "SQL", weight: 100, display_order: 1 }],
      rating_scale: [{ code: "7", label: "Meets", factor: 0.7 }],
      check_ins: [],
      check_in_responses: [],
      check_in_competency_ratings: [],
      appraisal_audit: [],
      appraisal_score_snapshots: [],
      midyear_window_notices: [],
      app_users: [],
    },
    {
      appraisal_score_snapshots: [["appraisal_id", "score_type"]],
      midyear_window_notices: [["appraisal_id", "recipient_employee_id"]],
    }
  );
  mocks.createClient.mockReturnValue(db);
}

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;

const as = (user: Record<string, unknown>) => mocks.getCurrentUser.mockResolvedValue(user);
const create = (body: Record<string, unknown>) => POST(json(body), { params: Promise.resolve({ id: APPRAISAL_ID }) });
const patch = (checkinId: string, body: Record<string, unknown>) =>
  PATCH(json(body), { params: Promise.resolve({ id: APPRAISAL_ID, checkinId }) });
const compIds = () => db.tables.check_in_competency_ratings.map((r) => r.id as string);
const emails = () => mocks.sendEmail.mock.calls.map((c) => c[0] as { to: string; subject: string; bodyText: string });
const inApp = () => mocks.notify.mock.calls.map((c) => ({ employeeId: c[0] as string, ...(c[1] as { title: string; body: string; metadata: Record<string, unknown> }) }));

async function createFormal() {
  as(MANAGER);
  expect((await create({ check_in_type: "MIDYEAR" })).status).toBe(200);
  return db.tables.check_ins.at(-1)!.id as string;
}
async function employeeSubmit(id: string) {
  as(EMPLOYEE);
  const res = await patch(id, {
    action: "EMPLOYEE_SUBMIT",
    responses: [
      { workplan_item_id: "wi-num", employee_actual_raw: 8 },
      { workplan_item_id: "wi-date", employee_completion_date: "2026-06-20" },
    ],
    competencies: compIds().map((cid) => ({ id: cid, employee_rating_code: "7" })),
  });
  expect(res.status).toBe(200);
}
async function managerReview(id: string) {
  as(MANAGER);
  const res = await patch(id, { action: "MANAGER_COMPLETE", responses: [], competencies: compIds().map((cid) => ({ id: cid, manager_rating_code: "7" })) });
  expect(res.status).toBe(200);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.notify.mockResolvedValue(undefined);
  mocks.sendEmail.mockResolvedValue(undefined);
  mocks.sendSubmitted.mockResolvedValue(undefined);
  mocks.sendReviewed.mockResolvedValue(undefined);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://supabase.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://appraisals.example.test");
});

afterEach(() => vi.unstubAllEnvs());

describe("labels", () => {
  it("formats the fiscal year and due date", () => {
    expect(fiscalYearLabel("2026")).toBe("FY 2026/27");
    expect(fiscalYearLabel("2026/2027")).toBe("FY 2026/2027");
    expect(fiscalYearLabel("FY 2026/27")).toBe("FY 2026/27");
    expect(fiscalYearLabel(null)).toBeNull();
    expect(formatMidyearDate("2026-06-30")).toBe("30 Jun 2026");
    expect(formatMidyearDate(null)).toBeNull();
  });

  it("uses the agreed wording", () => {
    expect(midyearMessages.windowOpen({ fiscalYear: "FY 2026/27", employeeName: "Jane Employee", dueDate: "30 Jun 2026" }).body).toBe(
      "The Mid-Year Review for FY 2026/27 is now open for Jane Employee. Please initiate the review by 30 Jun 2026."
    );
    expect(midyearMessages.ready({ fiscalYear: "FY 2026/27" }).body).toBe("Your Mid-Year Review for FY 2026/27 is ready for your input.");
  });
});

describe("window-open notice", () => {
  it("is sent once to the manager however many times the job runs", async () => {
    seed();
    const first = await sendMidyearWindowNotices(db as never, { today: "2026-06-05" });
    const second = await sendMidyearWindowNotices(db as never, { today: "2026-06-06" });

    expect(first).toMatchObject({ openCycles: 1, eligible: 1, sent: 1, alreadyNotified: 0 });
    expect(second).toMatchObject({ eligible: 1, sent: 0, alreadyNotified: 1 });
    expect(db.tables.midyear_window_notices).toHaveLength(1);
    expect(db.tables.midyear_window_notices[0]).toMatchObject({ appraisal_id: APPRAISAL_ID, cycle_id: "c-1", recipient_employee_id: "mgr-1" });

    expect(emails()).toHaveLength(1);
    expect(emails()[0].to).toBe("mark@example.test");
    expect(emails()[0].bodyText).toContain(
      "The Mid-Year Review for FY 2026/27 is now open for Jane Employee. Please initiate the review by 30 Jun 2026."
    );
    expect(emails()[0].bodyText).toContain("https://appraisals.example.test/appraisals/a-1");
    expect(inApp()).toHaveLength(1);
    expect(inApp()[0]).toMatchObject({ employeeId: "mgr-1", metadata: { kind: "midyear_window_open", appraisal_id: APPRAISAL_ID } });
  });

  it("does not send when a concurrent run already claimed the notice", async () => {
    seed();
    const realFrom = db.from.bind(db);
    vi.spyOn(db, "from").mockImplementation((table: string) => {
      const q = realFrom(table);
      if (table !== "midyear_window_notices") return q;
      const originalInsert = q.insert.bind(q);
      q.insert = (payload: Record<string, unknown> | Record<string, unknown>[]) => {
        db.tables.midyear_window_notices.push({ id: "other-run", ...(payload as Record<string, unknown>) });
        return originalInsert(payload);
      };
      return q;
    });
    const summary = await sendMidyearWindowNotices(db as never, { today: "2026-06-05" });
    expect(summary).toMatchObject({ sent: 0, alreadyNotified: 1 });
    expect(emails()).toHaveLength(0);
    expect(inApp()).toHaveLength(0);
  });

  it("is not sent before the window opens, after the due date, or when disabled", async () => {
    seed();
    expect((await sendMidyearWindowNotices(db as never, { today: "2026-05-31" })).sent).toBe(0);
    expect((await sendMidyearWindowNotices(db as never, { today: "2026-07-01" })).sent).toBe(0);
    seed({ midyear: false });
    expect((await sendMidyearWindowNotices(db as never, { today: "2026-06-05" })).sent).toBe(0);
    expect(emails()).toHaveLength(0);
    expect(db.tables.midyear_window_notices).toHaveLength(0);
  });

  it("is not sent once the review has been initiated, or for appraisals not IN_PROGRESS", async () => {
    seed();
    await createFormal();
    vi.clearAllMocks();
    expect((await sendMidyearWindowNotices(db as never, { today: "2026-06-05" })).eligible).toBe(0);
    seed();
    db.tables.appraisals[0].status = "SELF_ASSESSMENT";
    expect((await sendMidyearWindowNotices(db as never, { today: "2026-06-05" })).eligible).toBe(0);
    expect(emails()).toHaveLength(0);
  });

  it("is not re-sent after the formal review is cancelled", async () => {
    seed();
    await sendMidyearWindowNotices(db as never, { today: "2026-06-05" });
    const id = await createFormal();
    db.tables.check_ins.find((c) => c.id === id)!.status = "CANCELLED";
    vi.clearAllMocks();
    const summary = await sendMidyearWindowNotices(db as never, { today: "2026-06-06" });
    expect(summary).toMatchObject({ eligible: 1, sent: 0, alreadyNotified: 1 });
    expect(emails()).toHaveLength(0);
  });

  it("endpoint requires HR/Admin or the cron secret", async () => {
    seed();
    as(MANAGER);
    expect((await WINDOW_NOTICES(json({}))).status).toBe(401);
    expect(db.tables.midyear_window_notices).toHaveLength(0);

    vi.stubEnv("CRON_SECRET", "s3cret");
    mocks.getCurrentUser.mockResolvedValue(null);
    expect((await WINDOW_NOTICES(json({}, { "x-cron-secret": "wrong" }))).status).toBe(401);

    as(HR);
    const res = await WINDOW_NOTICES(json({ cycle_id: "c-1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ success: true });
    expect(Object.keys(body).sort()).toEqual(["alreadyNotified", "eligible", "failed", "openCycles", "sent", "success"]);
  });
});

describe("formal review notifications", () => {
  it("initiation emails and notifies the employee", async () => {
    seed();
    const id = await createFormal();
    expect(emails()).toHaveLength(1);
    expect(emails()[0]).toMatchObject({ to: "jane@example.test", subject: "Your Mid-Year Review is ready for your input" });
    expect(emails()[0].bodyText).toContain("Your Mid-Year Review for FY 2026/27 is ready for your input.");
    expect(inApp()).toEqual([
      expect.objectContaining({
        employeeId: "emp-1",
        title: "Mid-Year Review ready",
        body: "Your Mid-Year Review for FY 2026/27 is ready for your input.",
        metadata: expect.objectContaining({ kind: "midyear_ready", check_in_id: id }),
      }),
    ]);
  });

  it("employee submission emails the manager with formal wording", async () => {
    seed();
    const id = await createFormal();
    vi.clearAllMocks();
    await employeeSubmit(id);
    expect(mocks.sendSubmitted).not.toHaveBeenCalled();
    expect(emails()).toHaveLength(1);
    expect(emails()[0]).toMatchObject({ to: "mark@example.test", subject: "Jane Employee has submitted their Mid-Year Review" });
    expect(emails()[0].bodyText).toContain("Jane Employee has submitted their Mid-Year Review for FY 2026/27. Please complete your manager review.");
    expect(inApp()).toEqual([expect.objectContaining({ employeeId: "mgr-1", title: "Mid-Year Review submitted" })]);
  });

  it("completion emails the employee once, at COMPLETE rather than at manager review", async () => {
    seed();
    const id = await createFormal();
    await employeeSubmit(id);
    vi.clearAllMocks();
    await managerReview(id);
    expect(emails()).toHaveLength(0);
    expect(mocks.sendReviewed).not.toHaveBeenCalled();
    expect(inApp()).toHaveLength(0);

    as(MANAGER);
    expect((await patch(id, { action: "COMPLETE" })).status).toBe(200);
    expect(emails()).toHaveLength(1);
    expect(emails()[0]).toMatchObject({ to: "jane@example.test", subject: "Your Mid-Year Review has been completed" });
    expect(emails()[0].bodyText).toContain("Your Mid-Year Review for FY 2026/27 has been completed by your manager.");
    expect(inApp()).toEqual([expect.objectContaining({ employeeId: "emp-1", title: "Mid-Year Review completed" })]);
  });

  it("a failing email does not block the lifecycle", async () => {
    seed();
    mocks.sendEmail.mockRejectedValue(new Error("Graph down"));
    mocks.notify.mockRejectedValue(new Error("db down"));
    const id = await createFormal();
    await employeeSubmit(id);
    expect(db.tables.check_ins.find((c) => c.id === id)!.status).toBe("EMPLOYEE_SUBMITTED");
  });
});

describe("informal check-ins keep their existing wording", () => {
  it("creation: in-app 'New check-in' only, no email", async () => {
    seed();
    as(MANAGER);
    expect((await create({ title: "Q2 catch-up", check_in_type: "QUARTERLY" })).status).toBe(200);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(inApp()).toEqual([
      expect.objectContaining({ employeeId: "emp-1", title: "New check-in", body: 'You have a new check-in to complete: "Q2 catch-up".' }),
    ]);
  });

  it("submission and manager review use the existing check-in emails", async () => {
    seed();
    as(MANAGER);
    await create({ title: "Q2 catch-up", check_in_type: "QUARTERLY" });
    const id = db.tables.check_ins[0].id as string;
    vi.clearAllMocks();

    as(EMPLOYEE);
    expect((await patch(id, { action: "EMPLOYEE_SUBMIT", responses: [] })).status).toBe(200);
    expect(mocks.sendSubmitted).toHaveBeenCalledWith(expect.objectContaining({ appraisalId: APPRAISAL_ID, checkInId: id, checkInTitle: "Q2 catch-up" }));
    expect(inApp()).toEqual([expect.objectContaining({ title: "Check-in submitted" })]);

    vi.clearAllMocks();
    as(MANAGER);
    expect((await patch(id, { action: "MANAGER_COMPLETE", responses: [] })).status).toBe(200);
    expect(mocks.sendReviewed).toHaveBeenCalledWith(expect.objectContaining({ appraisalId: APPRAISAL_ID, checkInId: id }));
    expect(inApp()).toEqual([expect.objectContaining({ title: "Check-in reviewed" })]);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
  });
});
