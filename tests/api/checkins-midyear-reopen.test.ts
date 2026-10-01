import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FakeSupabase } from "../helpers/fake-supabase";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  createClient: vi.fn(),
  notify: vi.fn(),
  sendEmail: vi.fn(),
  transitionStatus: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/dynamics-org-service", async (orig) => ({ ...(await orig<object>()), ...(await import("../helpers/fake-dynamics-org")).fakeDynamicsOrg }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/appraisal-manager-access", () => ({
  resolveManagerAccessForAppraisal: vi.fn(async ({ currentEmployeeId }: { currentEmployeeId: string | null }) => ({
    isPrimaryManager: currentEmployeeId === "mgr-1",
    isDelegated: false,
    hasManagerAccess: currentEmployeeId === "mgr-1",
  })),
}));
vi.mock("@/lib/appraisal-test-bypass", () => ({ allowAppraisalTestBypass: () => false }));
vi.mock("@/lib/appraisal-workflow", () => ({ transitionStatus: mocks.transitionStatus }));
vi.mock("@/lib/notifications/create", () => ({ createNotificationForEmployeeId: mocks.notify }));
vi.mock("@/lib/notifications", () => ({
  sendEmail: mocks.sendEmail,
  sendCheckInSubmittedToManager: vi.fn().mockResolvedValue(undefined),
  sendCheckInReviewedToEmployee: vi.fn().mockResolvedValue(undefined),
}));

import { GET as GET_LIST, POST } from "@/app/api/appraisals/[id]/checkins/route";
import { midyearReviewTimeline } from "@/lib/midyear-display";
import { GET as GET_CHECKIN, PATCH } from "@/app/api/appraisals/[id]/checkins/[checkinId]/route";
import { GET as GET_SCORES } from "@/app/api/appraisals/[id]/score-snapshots/route";
import { POST as START_SELF_ASSESSMENT } from "@/app/api/appraisals/[id]/start-self-assessment/route";
import { buildMidyearSummaryInput } from "@/lib/midyear-summary-input";
import { calcSummary } from "@/lib/summary-calc";
import { findScoreSnapshot, listMidyearScoreRevisions, loadScoreSnapshotSummaries } from "@/lib/appraisal-score-snapshot";
import { MIDYEAR_LOCKED_MESSAGE } from "@/lib/midyear-lifecycle";
import { REOPEN_REASON_MAX } from "@/lib/midyear-revisions";

const APPRAISAL_ID = "a-1";
const MANAGER = { id: "u-mgr", name: "Mark Manager", roles: ["manager"], employee_id: "mgr-1" };
const EMPLOYEE = { id: "u-emp", name: "Jane Employee", roles: ["employee"], employee_id: "emp-1" };
const HR = { id: "u-hr", name: "Helen HR", roles: ["hr"], employee_id: "hr-1" };
const ADMIN = { id: "u-admin", name: "Adam Admin", roles: ["admin"], employee_id: "adm-1" };
const ANNUAL_TABLES = ["appraisals", "appraisal_timeline", "workplans", "workplan_items", "appraisal_factor_ratings", "appraisal_technical_competencies"];
const REASON = "Manager rating on the reports objective was entered against the wrong target.";

let db: FakeSupabase;

/** Mirrors reopen_midyear_review (0075) step for step. */
function reopenRpc(args: Record<string, unknown>, fake: FakeSupabase) {
  const fail = (message: string) => ({ data: null, error: { message } });
  const reason = String(args.p_reason ?? "").trim();
  if (!String(args.p_actor ?? "").trim()) return fail("midyear_reopen_actor_required");
  if (!reason) return fail("midyear_reopen_reason_required");
  const checkIn = fake.tables.check_ins.find((c) => c.id === args.p_check_in_id);
  if (!checkIn) return fail("midyear_reopen_not_found");
  if (checkIn.review_mode == null || checkIn.review_mode === "INFORMAL") return fail("midyear_reopen_not_formal");
  if (checkIn.status !== "COMPLETE") return fail("midyear_reopen_not_complete");
  const appraisal = fake.tables.appraisals.find((a) => a.id === checkIn.appraisal_id);
  if (appraisal?.status !== "IN_PROGRESS") return fail("midyear_reopen_appraisal_locked");
  const now = new Date().toISOString();
  const revisions = fake.tables.midyear_review_revisions.filter((r) => r.check_in_id === checkIn.id);
  for (const r of revisions) if (r.completed_at == null) r.completed_at = now;
  const next = Math.max(1, ...revisions.map((r) => Number(r.revision_number))) + 1;
  const current = fake.tables.appraisal_score_snapshots.find(
    (s) => s.appraisal_id === checkIn.appraisal_id && s.score_type === "MIDYEAR" && s.check_in_id === checkIn.id && s.superseded_at == null
  );
  if (current) Object.assign(current, { superseded_at: now, superseded_by: args.p_actor });
  Object.assign(checkIn, { status: "EMPLOYEE_SUBMITTED", updated_at: now });
  const name = String(args.p_actor_name ?? "").trim();
  fake.tables.midyear_review_revisions.push({
    id: fake.newId(),
    check_in_id: checkIn.id,
    appraisal_id: checkIn.appraisal_id,
    revision_number: next,
    reopened_at: now,
    reopened_by: args.p_actor,
    reopened_by_name: name || null,
    reopen_reason: reason,
    previous_score_revision: current ? current.revision : null,
    completed_at: null,
    completed_by: null,
    score_revision: null,
  });
  return { data: { revision_number: next, reopened_at: now, previous_score_revision: current ? current.revision : null }, error: null };
}

function seed({ scoring = true } = {}) {
  db = new FakeSupabase(
    {
      appraisals: [
        { id: APPRAISAL_ID, employee_id: "emp-1", manager_employee_id: "mgr-1", division_id: "d-1", cycle_id: "c-1", status: "IN_PROGRESS", is_management: false },
      ],
      appraisal_cycles: [
        { id: "c-1", name: "FY 2026", fiscal_year: "2026", status: "open", midyear_review_enabled: true, midyear_scoring_enabled: scoring, midyear_window_start: null, midyear_due_date: null },
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
      appraisal_technical_competencies: [
        { id: "t-sql", appraisal_id: APPRAISAL_ID, name: "SQL", weight: 100, display_order: 1 },
      ],
      rating_scale: [{ code: "8", label: "Exceeds", factor: 0.8 }],
      check_ins: [],
      check_in_responses: [],
      check_in_competency_ratings: [],
      appraisal_audit: [],
      appraisal_score_snapshots: [],
      midyear_review_revisions: [],
      app_users: [],
    },
    {
      appraisal_score_snapshots: [["appraisal_id", "score_type", "revision"]],
      midyear_review_revisions: [["check_in_id", "revision_number"]],
    }
  );
  db.rpcHandlers.reopen_midyear_review = reopenRpc;
  mocks.createClient.mockReturnValue(db);
}

const json = (body: unknown) =>
  new Request("http://localhost", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) as unknown as NextRequest;
const as = (user: Record<string, unknown>) => mocks.getCurrentUser.mockResolvedValue(user);
const patch = (checkinId: string, body: Record<string, unknown>) => PATCH(json(body), { params: Promise.resolve({ id: APPRAISAL_ID, checkinId }) });
const reopen = (checkinId: string, user: Record<string, unknown> = HR, reason: unknown = REASON) => {
  as(user);
  return patch(checkinId, { action: "REOPEN", reason });
};
const compIds = () => db.tables.check_in_competency_ratings.map((r) => r.id as string);
const checkInRow = (id: string) => db.tables.check_ins.find((c) => c.id === id)!;
const midyearSnapshots = () => db.tables.appraisal_score_snapshots.filter((s) => s.score_type === "MIDYEAR");
const revisions = () => db.tables.midyear_review_revisions;
const auditTypes = () => db.tables.appraisal_audit.map((a) => a.action_type);
const annualState = () => JSON.stringify(ANNUAL_TABLES.map((t) => db.tables[t] ?? []));
const client = () => db as unknown as SupabaseClient;

async function managerReview(id: string, mgrActual: number) {
  as(MANAGER);
  return patch(id, {
    action: "MANAGER_COMPLETE",
    responses: [{ workplan_item_id: "wi-num", mgr_actual_raw: mgrActual }],
    competencies: compIds().map((cid) => ({ id: cid, manager_rating_code: "8" })),
  });
}

const complete = (id: string) => {
  as(MANAGER);
  return patch(id, { action: "COMPLETE" });
};

/** A formal review the employee has submitted, awaiting the manager. */
async function submittedReview() {
  as(MANAGER);
  expect((await POST(json({ check_in_type: "MIDYEAR" }), { params: Promise.resolve({ id: APPRAISAL_ID }) })).status).toBe(200);
  const id = db.tables.check_ins[0].id as string;
  as(EMPLOYEE);
  const submitted = await patch(id, {
    action: "EMPLOYEE_SUBMIT",
    responses: [
      { workplan_item_id: "wi-num", employee_actual_raw: 8, employee_comment: "On track" },
      { workplan_item_id: "wi-date", employee_completion_date: "2026-06-20" },
    ],
    competencies: compIds().map((cid) => ({ id: cid, employee_rating_code: "8" })),
  });
  expect(submitted.status).toBe(200);
  return id;
}

/** A formal review taken all the way to COMPLETE (MIDYEAR revision 1 recorded when scored). */
async function completedReview() {
  const id = await submittedReview();
  expect((await managerReview(id, 6)).status).toBe(200);
  expect((await complete(id)).status).toBe(200);
  expect(checkInRow(id).status).toBe("COMPLETE");
  return id;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://supabase.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  mocks.notify.mockResolvedValue(undefined);
  mocks.sendEmail.mockResolvedValue(undefined);
  mocks.transitionStatus.mockResolvedValue({ error: null });
});

afterEach(() => vi.unstubAllEnvs());

describe("who can reopen a completed Mid-Year Review", () => {
  it.each([
    ["HR", HR],
    ["an administrator", ADMIN],
  ])("%s can reopen it", async (_label, user) => {
    seed();
    const id = await completedReview();
    const res = await reopen(id, user);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, revision_number: 2 });
    expect(checkInRow(id).status).toBe("EMPLOYEE_SUBMITTED");
  });

  it.each([
    ["the employee", EMPLOYEE, 403],
    ["the employee's own manager", MANAGER, 403],
    ["an unrelated manager", { id: "u-mgr9", roles: ["manager"], employee_id: "mgr-9" }, 403],
    ["HR reviewing their own appraisal", { id: "u-hr-emp", roles: ["hr", "employee"], employee_id: "emp-1" }, 403],
    ["a GM of another division", { id: "u-gm", roles: ["gm"], employee_id: "gm-1", division_id: "d-9" }, 403],
  ])("%s cannot reopen it", async (_label, user, expected) => {
    seed();
    const id = await completedReview();
    const res = await reopen(id, user);
    expect(res.status).toBe(expected);
    expect(db.rpcCalls).toEqual([]);
    expect(checkInRow(id).status).toBe("COMPLETE");
    expect(revisions()).toEqual([]);
    expect(midyearSnapshots().every((s) => s.superseded_at == null)).toBe(true);
  });

  it("a reason for revision is required", async () => {
    seed();
    const id = await completedReview();
    for (const reason of [null, "", "   \n ", 42]) {
      const res = await reopen(id, HR, reason);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("A reason for revision is required.");
    }
    expect((await reopen(id, HR, "x".repeat(REOPEN_REASON_MAX + 1))).status).toBe(400);
    expect(db.rpcCalls).toEqual([]);
    expect(checkInRow(id).status).toBe("COMPLETE");
  });

  it("only a completed formal review can be reopened, and only while the appraisal is In progress", async () => {
    seed();
    const id = await completedReview();
    checkInRow(id).status = "MANAGER_REVIEWED";
    expect((await reopen(id)).status).toBe(409);
    checkInRow(id).status = "COMPLETE";
    db.tables.appraisals[0].status = "SELF_ASSESSMENT";
    const locked = await reopen(id);
    expect(locked.status).toBe(409);
    expect((await locked.json()).error).toBe(MIDYEAR_LOCKED_MESSAGE);
    expect(db.rpcCalls).toEqual([]);
    expect(checkInRow(id).status).toBe("COMPLETE");
  });

  it("an informal check-in cannot be reopened", async () => {
    seed();
    db.tables.check_ins.push({ id: "ci-inf", appraisal_id: APPRAISAL_ID, review_mode: "INFORMAL", status: "MANAGER_REVIEWED" });
    expect((await reopen("ci-inf")).status).toBe(400);
    expect(db.rpcCalls).toEqual([]);
  });

  it("database refusals map to clear errors", async () => {
    seed();
    const id = await completedReview();
    db.rpcHandlers.reopen_midyear_review = () => ({ data: null, error: { message: 'duplicate key value violates unique constraint "idx_midyear_review_revisions_one_open"' } });
    const res = await reopen(id);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("This Mid-Year Review is already being revised.");
    db.rpcHandlers.reopen_midyear_review = () => ({ data: null, error: { message: "connection reset" } });
    expect((await reopen(id)).status).toBe(500);
  });
});

describe("a completed review is editable only through reopen", () => {
  it("rejects direct manager and employee edits while COMPLETE", async () => {
    seed();
    const id = await completedReview();
    const before = JSON.stringify([db.tables.check_in_responses, db.tables.check_in_competency_ratings]);
    as(MANAGER);
    expect((await patch(id, { action: "MANAGER_RESPOND", responses: [{ workplan_item_id: "wi-num", mgr_actual_raw: 10 }] })).status).toBe(400);
    expect((await patch(id, { action: "MANAGER_COMPLETE", responses: [{ workplan_item_id: "wi-num", mgr_actual_raw: 10 }] })).status).toBe(400);
    as(EMPLOYEE);
    expect((await patch(id, { action: "EMPLOYEE_SAVE_DRAFT", responses: [{ workplan_item_id: "wi-num", employee_actual_raw: 10 }] })).status).toBe(400);
    expect(JSON.stringify([db.tables.check_in_responses, db.tables.check_in_competency_ratings])).toBe(before);
  });

  it("after reopen the manager portion is editable again and the employee inputs stay as submitted", async () => {
    seed();
    const id = await completedReview();
    const employeeFields = () =>
      db.tables.check_in_responses.map((r) => [r.employee_status, r.employee_comment, r.employee_actual_raw, r.employee_completion_date, r.employee_result]);
    const employeeBefore = JSON.stringify(employeeFields());
    expect((await reopen(id)).status).toBe(200);

    as(EMPLOYEE);
    expect((await patch(id, { action: "EMPLOYEE_SAVE_DRAFT", responses: [{ workplan_item_id: "wi-num", employee_actual_raw: 1 }] })).status).toBe(400);
    expect((await patch(id, { action: "EMPLOYEE_SUBMIT", responses: [{ workplan_item_id: "wi-num", employee_actual_raw: 1 }] })).status).toBe(400);

    as(MANAGER);
    const draft = await patch(id, { action: "MANAGER_RESPOND", responses: [{ workplan_item_id: "wi-num", mgr_actual_raw: 9 }] });
    expect(draft.status).toBe(200);
    expect(db.tables.check_in_responses.find((r) => r.workplan_item_id === "wi-num")!.mgr_actual_raw).toBe(9);
    expect(JSON.stringify(employeeFields())).toBe(employeeBefore);
  });
});

describe("the manager revises freely until COMPLETE", () => {
  const numRow = () => db.tables.check_in_responses.find((r) => r.workplan_item_id === "wi-num")!;
  const employeeState = () =>
    JSON.stringify([
      db.tables.check_in_responses.map((r) => [r.employee_status, r.employee_comment, r.employee_actual_raw, r.employee_completion_date, r.employee_result, r.progress_pct]),
      db.tables.check_in_competency_ratings.map((c) => [c.employee_rating_code, c.employee_comment]),
    ]);
  const save = (id: string, mgrActual: number, rating: string, comment: string | null = null, notes?: string) => {
    as(MANAGER);
    return patch(id, {
      action: "MANAGER_RESPOND",
      saveOnly: true,
      responses: [{ workplan_item_id: "wi-num", mgr_actual_raw: mgrActual, mgr_comment: comment }],
      competencies: compIds().map((cid) => ({ id: cid, manager_rating_code: rating, manager_comment: comment })),
      ...(notes !== undefined ? { manager_overall_notes: notes } : {}),
    });
  };
  const reviewedReview = async () => {
    const id = await submittedReview();
    expect((await managerReview(id, 6)).status).toBe(200);
    expect(checkInRow(id).status).toBe("MANAGER_REVIEWED");
    return id;
  };

  it("before Submit manager review, Save draft persists each revision and the status does not move", async () => {
    seed();
    const id = await submittedReview();
    expect((await save(id, 5, "4", "First pass")).status).toBe(200);
    expect(numRow().mgr_actual_raw).toBe(5);
    expect((await save(id, 9, "9", "Second pass")).status).toBe(200);
    expect(numRow()).toMatchObject({ mgr_actual_raw: 9, mgr_comment: "Second pass" });
    expect(db.tables.check_in_competency_ratings.every((c) => c.manager_rating_code === "9" && c.manager_comment === "Second pass")).toBe(true);
    expect(checkInRow(id).status).toBe("EMPLOYEE_SUBMITTED");
  });

  it("after Submit manager review, the manager can keep revising results, ratings, comments and notes", async () => {
    seed();
    const id = await reviewedReview();
    const reviewedAt = checkInRow(id).manager_reviewed_at;
    for (const [actual, rating, comment] of [[7, "5", "Revised once"], [10, "10", "Revised twice"], [4, "3", "Revised again"]] as const) {
      const res = await save(id, actual, rating, comment, `Notes: ${comment}`);
      expect(res.status).toBe(200);
      expect(numRow()).toMatchObject({ mgr_actual_raw: actual, mgr_comment: comment });
      expect(db.tables.check_in_competency_ratings.every((c) => c.manager_rating_code === rating && c.manager_comment === comment)).toBe(true);
      expect(checkInRow(id)).toMatchObject({ status: "MANAGER_REVIEWED", manager_overall_notes: `Notes: ${comment}`, manager_reviewed_at: reviewedAt });
    }
    expect(midyearSnapshots()).toEqual([]);
  });

  it("completeness reflects each saved revision, and COMPLETE uses the latest values", async () => {
    seed();
    const id = await reviewedReview();
    as(MANAGER);
    expect((await patch(id, { action: "MANAGER_RESPOND", saveOnly: true, competencies: [{ id: compIds()[0], manager_rating_code: null }] })).status).toBe(200);
    const read = async () =>
      (await GET_CHECKIN(new Request("http://localhost") as unknown as NextRequest, { params: Promise.resolve({ id: APPRAISAL_ID, checkinId: id }) })).json();
    const blocked = await read();
    expect(blocked.midyear_completeness.complete).toBe(false);
    expect(blocked.midyear_completeness.manager.length).toBeGreaterThan(0);
    const refused = await complete(id);
    expect(refused.status).toBe(422);
    expect(checkInRow(id).status).toBe("MANAGER_REVIEWED");

    expect((await save(id, 10, "9")).status).toBe(200);
    expect((await read()).midyear_completeness).toMatchObject({ complete: true, manager: [] });
    expect((await complete(id)).status).toBe(200);
    expect(checkInRow(id).status).toBe("COMPLETE");
    const [snapshot] = midyearSnapshots();
    const built = await buildMidyearSummaryInput(id, client());
    if (!built.ok) throw new Error(built.error.code);
    expect(snapshot.total_points).toBe(calcSummary(built.input).totalPoints);
    expect(snapshot.inputs).toMatchObject({
      workplanItems: [{ weight: 60, actual_result: 100 }, expect.anything()],
      competencies: [{ manager_rating: "9" }],
    });
  });

  it("employee fields stay read-only: the employee cannot write and the manager's save never touches them", async () => {
    seed();
    const id = await reviewedReview();
    const before = employeeState();
    as(EMPLOYEE);
    expect((await patch(id, { action: "EMPLOYEE_SAVE_DRAFT", responses: [{ workplan_item_id: "wi-num", employee_actual_raw: 1 }] })).status).toBe(400);
    expect((await patch(id, { action: "EMPLOYEE_SUBMIT", responses: [{ workplan_item_id: "wi-num", employee_actual_raw: 1 }] })).status).toBe(400);
    expect((await patch(id, { action: "MANAGER_RESPOND", responses: [{ workplan_item_id: "wi-num", mgr_actual_raw: 1 }] })).status).toBe(403);
    as(MANAGER);
    const res = await patch(id, {
      action: "MANAGER_RESPOND",
      saveOnly: true,
      responses: [{ workplan_item_id: "wi-num", mgr_actual_raw: 9, employee_actual_raw: 1, employee_status: "AT_RISK", employee_comment: "x", progress_pct: 1 }],
      competencies: compIds().map((cid) => ({ id: cid, manager_rating_code: "9", employee_rating_code: "1", employee_comment: "x" })),
    });
    expect(res.status).toBe(200);
    expect(numRow().mgr_actual_raw).toBe(9);
    expect(employeeState()).toBe(before);
  });

  it("only the manager may revise; HR and unrelated users cannot", async () => {
    seed();
    const id = await reviewedReview();
    const before = JSON.stringify([db.tables.check_in_responses, db.tables.check_in_competency_ratings]);
    for (const user of [HR, ADMIN, { id: "u-mgr9", roles: ["manager"], employee_id: "mgr-9" }]) {
      as(user);
      expect((await patch(id, { action: "MANAGER_RESPOND", responses: [{ workplan_item_id: "wi-num", mgr_actual_raw: 1 }] })).status).toBe(403);
    }
    expect(JSON.stringify([db.tables.check_in_responses, db.tables.check_in_competency_ratings])).toBe(before);
  });

  it("Submit manager review is not repeated: MANAGER_COMPLETE stays an EMPLOYEE_SUBMITTED-only step", async () => {
    seed();
    const id = await reviewedReview();
    expect((await managerReview(id, 9)).status).toBe(400);
    expect(checkInRow(id).status).toBe("MANAGER_REVIEWED");
  });

  it("COMPLETE locks manager edits; only an HR/Admin reopen makes them editable again", async () => {
    seed();
    const id = await reviewedReview();
    expect((await save(id, 9, "9")).status).toBe(200);
    expect((await complete(id)).status).toBe(200);
    const locked = JSON.stringify([db.tables.check_in_responses, db.tables.check_in_competency_ratings]);
    expect((await save(id, 3, "3")).status).toBe(400);
    expect(JSON.stringify([db.tables.check_in_responses, db.tables.check_in_competency_ratings])).toBe(locked);
    expect((await reopen(id, MANAGER)).status).toBe(403);
    expect((await save(id, 3, "3")).status).toBe(400);

    expect((await reopen(id, HR)).status).toBe(200);
    expect((await save(id, 3, "3")).status).toBe(200);
    expect(numRow().mgr_actual_raw).toBe(3);
  });

  it("an informal check-in keeps the existing rule: no manager response after it is reviewed", async () => {
    seed();
    db.tables.check_ins.push({ id: "ci-inf", appraisal_id: APPRAISAL_ID, check_in_type: "QUARTERLY", review_mode: "INFORMAL", status: "MANAGER_REVIEWED" });
    as(MANAGER);
    expect((await patch("ci-inf", { action: "MANAGER_RESPOND", responses: [] })).status).toBe(400);
  });
});

describe("manager review timestamps", () => {
  const T = {
    employee: "2026-10-12T14:00:00.000Z",
    submitted: "2026-10-20T14:00:00.000Z",
    revised: "2026-10-21T14:00:00.000Z",
    completed: "2026-10-22T14:00:00.000Z",
    reopened: "2026-11-02T14:00:00.000Z",
    draft: "2026-11-03T14:00:00.000Z",
    resubmitted: "2026-11-04T14:00:00.000Z",
    recompleted: "2026-11-05T14:00:00.000Z",
  };
  /** Moves the clock and stamps audit rows as the database default (acted_at = now()) would. */
  const at = (iso: string) => vi.setSystemTime(new Date(iso));
  const stampAudit = () => db.tables.appraisal_audit.forEach((a) => (a.acted_at ??= new Date().toISOString()));
  const step = async <R,>(iso: string, run: () => Promise<R>) => {
    at(iso);
    const out = await run();
    stampAudit();
    return out;
  };
  const viaGet = async (id: string) => {
    as(EMPLOYEE);
    const res = await GET_CHECKIN(new Request("http://localhost") as unknown as NextRequest, { params: Promise.resolve({ id: APPRAISAL_ID, checkinId: id }) });
    return res.json();
  };
  const viaList = async () => {
    as(EMPLOYEE);
    const res = await GET_LIST(new Request("http://localhost") as unknown as NextRequest, { params: Promise.resolve({ id: APPRAISAL_ID }) });
    return (await res.json()).checkIns[0];
  };
  const saveDraft = (id: string, mgrActual: number) => {
    as(MANAGER);
    return patch(id, { action: "MANAGER_RESPOND", saveOnly: true, responses: [{ workplan_item_id: "wi-num", mgr_actual_raw: mgrActual }], competencies: compIds().map((cid) => ({ id: cid, manager_rating_code: "8" })) });
  };

  beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }));
  afterEach(() => vi.useRealTimers());

  it("records each step without overwriting the original submission, and the payload carries what the UI needs", async () => {
    seed();
    const id = await step(T.employee, submittedReview);
    await step(T.submitted, () => managerReview(id, 6));
    expect(midyearReviewTimeline(await viaGet(id))).toEqual({ managerSubmittedAt: T.submitted, lastRevisedAt: null, completedAt: null, revisedCompletion: false });

    await step(T.revised, () => saveDraft(id, 7));
    expect(midyearReviewTimeline(await viaGet(id))).toMatchObject({ managerSubmittedAt: T.submitted, lastRevisedAt: T.revised });

    await step(T.completed, () => complete(id));
    expect(midyearReviewTimeline(await viaList())).toEqual({ managerSubmittedAt: T.submitted, lastRevisedAt: T.revised, completedAt: T.completed, revisedCompletion: false });

    await step(T.reopened, () => reopen(id));
    expect(midyearReviewTimeline(await viaGet(id))).toMatchObject({ managerSubmittedAt: T.submitted, lastRevisedAt: T.revised, completedAt: null });
    await step(T.draft, () => saveDraft(id, 8));
    expect(midyearReviewTimeline(await viaGet(id))).toMatchObject({ managerSubmittedAt: T.submitted, lastRevisedAt: T.draft });

    await step(T.resubmitted, () => managerReview(id, 9));
    expect(checkInRow(id).manager_reviewed_at).toBe(T.resubmitted);
    const resubmitted = await viaGet(id);
    expect(resubmitted.original_manager_reviewed_at).toBe(T.submitted);
    expect(midyearReviewTimeline(resubmitted)).toMatchObject({ managerSubmittedAt: T.submitted, lastRevisedAt: T.resubmitted });

    await step(T.recompleted, () => complete(id));
    const listed = await viaList();
    expect(listed.original_manager_reviewed_at).toBe(T.submitted);
    expect(midyearReviewTimeline(listed)).toEqual({ managerSubmittedAt: T.submitted, lastRevisedAt: T.resubmitted, completedAt: T.recompleted, revisedCompletion: true });

    const managerReviews = db.tables.appraisal_audit.filter((a) => a.action_type === "midyear_manager_reviewed").map((a) => a.acted_at);
    expect(managerReviews).toEqual([T.submitted, T.resubmitted]);
    expect(revisions()[0]).toMatchObject({ reopened_at: T.reopened, completed_at: T.recompleted });
    const first = midyearSnapshots().find((s) => s.revision === 1)!;
    expect(first.superseded_at).toBe(T.reopened);
  });

  it("only reopened reviews carry the original submission; without audit history it is left out rather than guessed", async () => {
    seed();
    const id = await step(T.employee, submittedReview);
    await step(T.submitted, () => managerReview(id, 6));
    await step(T.completed, () => complete(id));
    expect(await viaGet(id)).not.toHaveProperty("original_manager_reviewed_at");
    expect(await viaList()).not.toHaveProperty("original_manager_reviewed_at");

    await step(T.reopened, () => reopen(id));
    await step(T.resubmitted, () => managerReview(id, 9));
    db.tables.appraisal_audit = [];
    const body = await viaGet(id);
    expect(body).not.toHaveProperty("original_manager_reviewed_at");
    expect(midyearReviewTimeline(body)).toMatchObject({ managerSubmittedAt: null, lastRevisedAt: T.resubmitted });
  });
});

describe("reopen state and revision metadata", () => {
  it("records who, when, why and which revision; the appraisal stays IN_PROGRESS", async () => {
    seed();
    const id = await completedReview();
    const before = Date.now();
    expect((await reopen(id, HR, `  ${REASON}  `)).status).toBe(200);
    expect(checkInRow(id).status).toBe("EMPLOYEE_SUBMITTED");
    expect(db.tables.appraisals[0].status).toBe("IN_PROGRESS");
    expect(revisions()).toHaveLength(1);
    const rev = revisions()[0];
    expect(rev).toMatchObject({
      check_in_id: id,
      appraisal_id: APPRAISAL_ID,
      revision_number: 2,
      reopened_by: "u-hr",
      reopened_by_name: "Helen HR",
      reopen_reason: REASON,
      previous_score_revision: 1,
      completed_at: null,
    });
    expect(Date.parse(rev.reopened_at as string)).toBeGreaterThanOrEqual(before - 1000);
    expect(db.rpcCalls).toEqual([
      { name: "reopen_midyear_review", args: { p_check_in_id: id, p_actor: "u-hr", p_actor_name: "Helen HR", p_reason: REASON } },
    ]);
  });

  it("the earlier MIDYEAR score is kept but no longer current", async () => {
    seed();
    const id = await completedReview();
    const original = { ...midyearSnapshots()[0] };
    await reopen(id);
    expect(midyearSnapshots()).toHaveLength(1);
    const kept = midyearSnapshots()[0];
    expect(kept.superseded_at).toEqual(expect.any(String));
    expect(kept.superseded_by).toBe("u-hr");
    const { superseded_at: _a, superseded_by: _b, ...unchanged } = kept;
    expect(unchanged).toEqual(original);
    expect(await findScoreSnapshot(client(), APPRAISAL_ID, "MIDYEAR")).toBeNull();
    expect(await loadScoreSnapshotSummaries(client(), APPRAISAL_ID)).toEqual({});
  });

  it("the GET payload carries the open revision", async () => {
    seed();
    const id = await completedReview();
    await reopen(id);
    as(EMPLOYEE);
    const res = await GET_CHECKIN(new Request("http://localhost") as unknown as NextRequest, { params: Promise.resolve({ id: APPRAISAL_ID, checkinId: id }) });
    const body = await res.json();
    expect(body.status).toBe("EMPLOYEE_SUBMITTED");
    expect(body.midyear_revisions).toEqual([
      expect.objectContaining({ revision_number: 2, reopen_reason: REASON, reopened_by_name: "Helen HR", completed_at: null }),
    ]);
  });

  it("a review being revised cannot be cancelled", async () => {
    seed();
    const id = await completedReview();
    await reopen(id);
    as(HR);
    const res = await patch(id, { action: "CANCEL" });
    expect(res.status).toBe(409);
    expect(checkInRow(id).status).toBe("EMPLOYEE_SUBMITTED");
  });
});

describe("re-completion", () => {
  async function revised(mgrActual = 10) {
    const id = await completedReview();
    expect((await reopen(id)).status).toBe(200);
    expect((await managerReview(id, mgrActual)).status).toBe(200);
    expect(checkInRow(id).status).toBe("MANAGER_REVIEWED");
    const res = await complete(id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, revision_number: 2 });
    return id;
  }

  it("goes back to COMPLETE through the existing steps and records MIDYEAR revision 2 with calcSummary", async () => {
    seed();
    const id = await revised();
    expect(checkInRow(id).status).toBe("COMPLETE");
    expect(db.tables.appraisals[0].status).toBe("IN_PROGRESS");
    const [first, second] = [...midyearSnapshots()].sort((a, b) => Number(a.revision) - Number(b.revision));
    expect(first).toMatchObject({ revision: 1, superseded_at: expect.any(String) });
    expect(second).toMatchObject({ revision: 2, check_in_id: id });
    expect(second.superseded_at ?? null).toBeNull();
    const built = await buildMidyearSummaryInput(id, client());
    if (!built.ok) throw new Error(built.error.code);
    expect(second.total_points).toBe(calcSummary(built.input).totalPoints);
    expect(second.total_points).not.toBe(first.total_points);
  });

  it("keeps revision 1 exactly as recorded and never averages revisions", async () => {
    seed();
    const id = await completedReview();
    const original = { ...midyearSnapshots()[0] };
    await reopen(id);
    await managerReview(id, 10);
    await complete(id);
    const kept = midyearSnapshots().find((s) => s.revision === 1)!;
    expect(kept.total_points).toBe(original.total_points);
    expect(kept.inputs).toEqual(original.inputs);
    const current = midyearSnapshots().find((s) => s.revision === 2)!;
    const average = (Number(original.total_points) + Number(current.total_points)) / 2;
    expect(current.total_points).not.toBe(average);
  });

  it("shows the latest revision as current and keeps earlier ones queryable", async () => {
    seed();
    await revised();
    const summaries = await loadScoreSnapshotSummaries(client(), APPRAISAL_ID);
    expect(summaries.MIDYEAR?.revision).toBe(2);
    const all = await listMidyearScoreRevisions(client(), APPRAISAL_ID);
    expect(all.map((r) => [r.revision, r.superseded_at == null])).toEqual([
      [1, false],
      [2, true],
    ]);
    as(EMPLOYEE);
    const res = await GET_SCORES(new Request("http://localhost") as unknown as NextRequest, { params: Promise.resolve({ id: APPRAISAL_ID }) });
    const body = await res.json();
    expect(body.midyearRevision).toBe(2);
    expect(body.midyear.total).toBe(summaries.MIDYEAR?.total_points);
    expect(body.midyearRevisions.map((r: { revision: number; supersededAt: string | null }) => [r.revision, r.supersededAt == null])).toEqual([
      [1, false],
      [2, true],
    ]);
  });

  it("closes the revision with the new score revision", async () => {
    seed();
    const id = await revised();
    expect(revisions()).toEqual([
      expect.objectContaining({ check_in_id: id, revision_number: 2, completed_by: "u-mgr", score_revision: 2, completed_at: expect.any(String) }),
    ]);
  });

  it("a second reopen creates revision 3 and preserves revisions 1 and 2", async () => {
    seed();
    const id = await revised(10);
    expect((await reopen(id, ADMIN, "Second correction")).status).toBe(200);
    expect(revisions().map((r) => [r.revision_number, r.previous_score_revision])).toEqual([
      [2, 1],
      [3, 2],
    ]);
    await managerReview(id, 7);
    await complete(id);
    expect(midyearSnapshots().map((s) => [s.revision, s.superseded_at == null])).toEqual([
      [1, false],
      [2, false],
      [3, true],
    ]);
  });

  it("still applies the existing completeness checks", async () => {
    seed();
    const id = await completedReview();
    await reopen(id);
    db.tables.check_in_competency_ratings[0].manager_rating_code = null;
    as(MANAGER);
    const res = await patch(id, { action: "MANAGER_COMPLETE", responses: [] });
    expect(res.status).toBe(422);
    expect(checkInRow(id).status).toBe("EMPLOYEE_SUBMITTED");
  });

  it("an unscored formal review can be revised without any score snapshot", async () => {
    seed({ scoring: false });
    const id = await completedReview();
    await reopen(id);
    expect(revisions()[0].previous_score_revision).toBeNull();
    await managerReview(id, 10);
    expect((await complete(id)).status).toBe(200);
    expect(db.tables.appraisal_score_snapshots).toEqual([]);
    expect(revisions()[0]).toMatchObject({ score_revision: null, completed_at: expect.any(String) });
  });
});

describe("annual appraisal and FINAL are unaffected", () => {
  it("writes nothing to annual tables and leaves FINAL untouched", async () => {
    seed();
    const id = await completedReview();
    const final = { id: "snap-final", appraisal_id: APPRAISAL_ID, score_type: "FINAL", revision: 1, total_points: 81.6, check_in_id: null };
    db.tables.appraisal_score_snapshots.push({ ...final });
    const before = annualState();
    const writesBefore = db.writes.length;
    await reopen(id);
    await managerReview(id, 10);
    await complete(id);
    expect(db.tables.appraisal_score_snapshots.find((s) => s.score_type === "FINAL")).toEqual(final);
    expect(db.writes.slice(writesBefore).filter((w) => ANNUAL_TABLES.includes(w.table))).toEqual([]);
    expect(annualState()).toBe(before);
  });
});

describe("Self Assessment while a review is reopened", () => {
  const start = () => START_SELF_ASSESSMENT(new Request("http://localhost", { method: "POST" }), { params: Promise.resolve({ id: APPRAISAL_ID }) });

  it("is blocked until the revised review is completed again", async () => {
    seed();
    const id = await completedReview();
    await reopen(id);
    as(EMPLOYEE);
    const blocked = await start();
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error).toBe("Complete the Mid-Year Review before starting self-assessment.");
    expect(mocks.transitionStatus).not.toHaveBeenCalled();

    await managerReview(id, 10);
    await complete(id);
    as(EMPLOYEE);
    expect((await start()).status).toBe(200);
    expect(mocks.transitionStatus).toHaveBeenCalledTimes(1);
  });
});

describe("notifications", () => {
  const notices = () =>
    mocks.notify.mock.calls.map(([employeeId, n]) => ({ employeeId, ...(n as { title: string; body: string }) }));

  it("reopen notifies the manager and the employee with the reason", async () => {
    seed();
    const id = await completedReview();
    mocks.notify.mockClear();
    mocks.sendEmail.mockClear();
    await reopen(id);
    const sent = notices();
    expect(sent.map((n) => n.employeeId).sort()).toEqual(["emp-1", "mgr-1"]);
    const employee = sent.find((n) => n.employeeId === "emp-1")!;
    expect(employee.title).toBe("Mid-Year Review reopened");
    expect(employee.body).toContain("The Mid-Year Review for FY 2026/27 has been reopened for revision.");
    expect(employee.body).toContain(REASON);
    const manager = sent.find((n) => n.employeeId === "mgr-1")!;
    expect(manager.body).toContain("has been reopened for revision.");
    expect(manager.body).toContain(REASON);
    expect(mocks.sendEmail.mock.calls.map(([e]) => (e as { to: string }).to).sort()).toEqual(["jane@example.test", "mark@example.test"]);
  });

  it("re-completion tells the employee the revised review is complete", async () => {
    seed();
    const id = await completedReview();
    await reopen(id);
    await managerReview(id, 10);
    mocks.notify.mockClear();
    await complete(id);
    const sent = notices();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ employeeId: "emp-1", title: "Revised Mid-Year Review completed" });
  });
});

describe("audit", () => {
  it("records the reopen, the revised completion and the revised score without overwriting earlier events", async () => {
    seed();
    const id = await completedReview();
    const earlier = db.tables.appraisal_audit.map((a) => ({ ...a }));
    await reopen(id);
    await managerReview(id, 10);
    await complete(id);
    expect(db.tables.appraisal_audit.slice(0, earlier.length)).toEqual(earlier);
    expect(db.writes.filter((w) => w.table === "appraisal_audit").every((w) => w.op === "insert")).toBe(true);

    const added = db.tables.appraisal_audit.slice(earlier.length);
    const reopened = added.find((a) => a.action_type === "midyear_reopened")!;
    expect(reopened).toMatchObject({
      actor_id: "u-hr",
      detail: expect.objectContaining({ check_in_id: id, from_status: "COMPLETE", to_status: "EMPLOYEE_SUBMITTED", revision_number: 2, reason: REASON, previous_score_revision: 1 }),
    });
    const revisionDone = added.find((a) => a.action_type === "midyear_revision_completed")!;
    expect(revisionDone).toMatchObject({ actor_id: "u-mgr", detail: expect.objectContaining({ revision_number: 2, score_revision: 2, previous_score_revision: 1 }) });
    const score = added.find((a) => a.action_type === "score_snapshot_recorded")!;
    expect(score.summary).toBe("Revised Mid-Year score recorded (revision 2)");
    expect(score.detail).toMatchObject({ score_type: "MIDYEAR", revision: 2, superseded_revision: 1 });
    expect(added.map((a) => a.action_type)).toEqual(
      expect.arrayContaining(["midyear_reopened", "midyear_manager_reviewed", "score_snapshot_recorded", "midyear_completed", "midyear_revision_completed"])
    );
    expect(JSON.stringify(added)).not.toMatch(/total_points|overall_grade/);
    expect(auditTypes().filter((t) => t === "midyear_completed")).toHaveLength(2);
  });
});
