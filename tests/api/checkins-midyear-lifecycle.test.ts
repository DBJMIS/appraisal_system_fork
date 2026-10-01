import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { FakeSupabase } from "../helpers/fake-supabase";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/dynamics-org-service", async (orig) => ({ ...(await orig<object>()), ...(await import("../helpers/fake-dynamics-org")).fakeDynamicsOrg }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/appraisal-manager-access", () => ({
  resolveManagerAccessForAppraisal: vi.fn(async ({ currentEmployeeId }: { currentEmployeeId: string | null }) => ({
    isPrimaryManager: currentEmployeeId === "mgr-1",
    isDelegated: currentEmployeeId === "del-1",
    hasManagerAccess: currentEmployeeId === "mgr-1" || currentEmployeeId === "del-1",
  })),
}));
vi.mock("@/lib/appraisal-test-bypass", () => ({ allowAppraisalTestBypass: () => false }));
vi.mock("@/lib/notifications/create", () => ({ createNotificationForEmployeeId: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/notifications", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
  sendCheckInSubmittedToManager: vi.fn().mockResolvedValue(undefined),
  sendCheckInReviewedToEmployee: vi.fn().mockResolvedValue(undefined),
}));

import { GET, POST } from "@/app/api/appraisals/[id]/checkins/route";
import { PATCH } from "@/app/api/appraisals/[id]/checkins/[checkinId]/route";
import { PATCH as PATCH_RESPONSES } from "@/app/api/appraisals/[id]/checkins/[checkinId]/responses/route";
import { MIDYEAR_LOCKED_MESSAGE } from "@/lib/midyear-lifecycle";

const APPRAISAL_ID = "a-1";
const MANAGER = { id: "u-mgr", roles: ["manager"], employee_id: "mgr-1" };
const DELEGATE = { id: "u-del", roles: ["manager"], employee_id: "del-1" };
const EMPLOYEE = { id: "u-emp", roles: ["employee"], employee_id: "emp-1" };
const HR = { id: "u-hr", roles: ["hr"], employee_id: "hr-1" };
const GM = { id: "u-gm", roles: ["gm"], employee_id: "gm-1", division_id: "d-1" };

let db: FakeSupabase;

function seed({ midyear = true, scoring = true } = {}) {
  db = new FakeSupabase({
    appraisals: [
      { id: APPRAISAL_ID, employee_id: "emp-1", manager_employee_id: "mgr-1", division_id: "d-1", cycle_id: "c-1", status: "IN_PROGRESS", is_management: false },
    ],
    appraisal_cycles: [
      {
        id: "c-1",
        name: "FY 2026",
        fiscal_year: "2026",
        midyear_review_enabled: midyear,
        midyear_scoring_enabled: midyear && scoring,
        midyear_window_start: "2026-06-01",
        midyear_due_date: "2026-06-30",
      },
    ],
    employees: [
      { id: "e-uuid-emp", employee_id: "emp-1", full_name: "Employee", manager_employee_id: "mgr-1" },
      { id: "e-uuid-mgr", employee_id: "mgr-1", full_name: "Manager", manager_employee_id: null },
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
    app_users: [],
  });
  mocks.createClient.mockReturnValue(db);
}

const json = (body: unknown) =>
  new Request("http://localhost", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;

const as = (user: Record<string, unknown>) => mocks.getCurrentUser.mockResolvedValue(user);
const create = (body: Record<string, unknown>) => POST(json(body), { params: Promise.resolve({ id: APPRAISAL_ID }) });
const patch = (checkinId: string, body: Record<string, unknown>) =>
  PATCH(json(body), { params: Promise.resolve({ id: APPRAISAL_ID, checkinId }) });
const patchResponses = (checkinId: string, body: unknown) =>
  PATCH_RESPONSES(json(body), { params: Promise.resolve({ id: APPRAISAL_ID, checkinId }) });
const list = () => GET(new Request("http://localhost") as unknown as NextRequest, { params: Promise.resolve({ id: APPRAISAL_ID }) });

const checkInRow = (id: string) => db.tables.check_ins.find((c) => c.id === id)!;
const compIds = () => db.tables.check_in_competency_ratings.map((r) => r.id as string);
const auditTypes = () => db.tables.appraisal_audit.map((a) => a.action_type);

async function createFormal(user: Record<string, unknown> = MANAGER) {
  as(user);
  const res = await create({ check_in_type: "MIDYEAR" });
  expect(res.status).toBe(200);
  return db.tables.check_ins.at(-1)!.id as string;
}

function employeeSubmit(id: string, complete = true) {
  as(EMPLOYEE);
  return patch(id, {
    action: "EMPLOYEE_SUBMIT",
    responses: complete
      ? [
          { workplan_item_id: "wi-num", employee_actual_raw: 8 },
          { workplan_item_id: "wi-date", employee_completion_date: "2026-06-20" },
        ]
      : [],
    competencies: complete ? compIds().map((cid) => ({ id: cid, employee_rating_code: "7" })) : [],
  });
}

function managerReview(id: string, user: Record<string, unknown> = MANAGER, complete = true) {
  as(user);
  return patch(id, {
    action: "MANAGER_COMPLETE",
    responses: [],
    competencies: complete ? compIds().map((cid) => ({ id: cid, manager_rating_code: "8" })) : [],
  });
}

async function reviewedFormal() {
  const id = await createFormal();
  expect((await employeeSubmit(id)).status).toBe(200);
  expect((await managerReview(id)).status).toBe(200);
  return id;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://supabase.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  as(MANAGER);
});

afterEach(() => vi.unstubAllEnvs());

describe("lifecycle: OPEN → EMPLOYEE_SUBMITTED → MANAGER_REVIEWED → COMPLETE", () => {
  it("COMPLETE is actually set and the appraisal stays IN_PROGRESS", async () => {
    seed();
    const id = await createFormal();
    expect(checkInRow(id).status).toBe("OPEN");
    await employeeSubmit(id);
    expect(checkInRow(id).status).toBe("EMPLOYEE_SUBMITTED");
    await managerReview(id);
    expect(checkInRow(id).status).toBe("MANAGER_REVIEWED");
    as(MANAGER);
    const res = await patch(id, { action: "COMPLETE" });
    expect(res.status).toBe(200);
    expect(checkInRow(id).status).toBe("COMPLETE");
    expect(db.tables.appraisals[0].status).toBe("IN_PROGRESS");
  });

  it("an active delegate can review and complete", async () => {
    seed();
    const id = await createFormal(DELEGATE);
    await employeeSubmit(id);
    expect((await managerReview(id, DELEGATE)).status).toBe(200);
    as(DELEGATE);
    expect((await patch(id, { action: "COMPLETE" })).status).toBe(200);
    expect(checkInRow(id).status).toBe("COMPLETE");
  });

  it("COMPLETE requires MANAGER_REVIEWED", async () => {
    seed();
    const id = await createFormal();
    as(MANAGER);
    expect((await patch(id, { action: "COMPLETE" })).status).toBe(400);
    await employeeSubmit(id);
    as(MANAGER);
    expect((await patch(id, { action: "COMPLETE" })).status).toBe(400);
    expect(checkInRow(id).status).toBe("EMPLOYEE_SUBMITTED");
  });

  it("COMPLETE is not available for informal check-ins", async () => {
    seed();
    await create({ title: "Q2", check_in_type: "QUARTERLY" });
    const id = db.tables.check_ins[0].id as string;
    db.tables.check_ins[0].status = "MANAGER_REVIEWED";
    expect((await patch(id, { action: "COMPLETE" })).status).toBe(400);
    expect(checkInRow(id).status).toBe("MANAGER_REVIEWED");
  });

  it("a COMPLETE review is locked: no edits and no cancellation", async () => {
    seed();
    const id = await reviewedFormal();
    as(MANAGER);
    await patch(id, { action: "COMPLETE" });
    as(EMPLOYEE);
    expect((await patch(id, { action: "EMPLOYEE_SAVE_DRAFT", responses: [] })).status).toBe(400);
    as(MANAGER);
    expect((await patch(id, { action: "MANAGER_RESPOND", responses: [] })).status).toBe(400);
    expect((await patch(id, { action: "CANCEL" })).status).toBe(409);
    expect(checkInRow(id).status).toBe("COMPLETE");
  });

  it("GET keeps a formal MANAGER_REVIEWED review in the payload with its completeness", async () => {
    seed();
    const id = await reviewedFormal();
    as(MANAGER);
    const body = await (await list()).json();
    const ci = body.checkIns.find((c: { id: string }) => c.id === id);
    expect(ci.status).toBe("MANAGER_REVIEWED");
    expect(ci.midyear_completeness).toMatchObject({ required: true, complete: true });
    expect(body.access).toEqual({ isEmployee: false, hasManagerAccess: true, isDelegate: false, isHrAdmin: false });
  });
});

describe("appraisal status gate", () => {
  const lock = () => (db.tables.appraisals[0].status = "SELF_ASSESSMENT");

  it.each([
    ["EMPLOYEE_SAVE_DRAFT", EMPLOYEE],
    ["EMPLOYEE_SUBMIT", EMPLOYEE],
    ["MANAGER_RESPOND", MANAGER],
    ["MANAGER_COMPLETE", MANAGER],
    ["COMPLETE", MANAGER],
    ["CANCEL", MANAGER],
    ["CANCEL", HR],
  ])("%s is blocked once the appraisal leaves IN_PROGRESS", async (action, user) => {
    seed();
    const id = await createFormal();
    lock();
    as(user);
    const res = await patch(id, { action, responses: [] });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(MIDYEAR_LOCKED_MESSAGE);
    expect(checkInRow(id).status).toBe("OPEN");
  });

  it("the draft responses endpoint is blocked for a formal review once locked", async () => {
    seed();
    const id = await createFormal();
    lock();
    as(EMPLOYEE);
    const res = await patchResponses(id, [{ workplan_item_id: "wi-num", employee_comment: "late" }]);
    expect(res.status).toBe(409);
  });

  it("a formal review cannot be created outside IN_PROGRESS", async () => {
    seed();
    lock();
    expect((await create({ check_in_type: "MIDYEAR" })).status).toBe(400);
    expect(db.tables.check_ins).toHaveLength(0);
  });

  it("informal check-ins keep their existing behaviour after the appraisal moves on", async () => {
    seed();
    await create({ title: "Q2", check_in_type: "QUARTERLY" });
    const id = db.tables.check_ins[0].id as string;
    lock();
    as(EMPLOYEE);
    expect((await patch(id, { action: "EMPLOYEE_SAVE_DRAFT", responses: [] })).status).toBe(200);
    as(MANAGER);
    expect((await patch(id, { action: "CANCEL" })).status).toBe(200);
  });
});

describe("role gates", () => {
  it("the employee cannot initiate a formal review but can still create an informal check-in", async () => {
    seed();
    as(EMPLOYEE);
    expect((await create({ check_in_type: "MIDYEAR" })).status).toBe(403);
    expect(db.tables.check_ins).toHaveLength(0);
    expect((await create({ title: "Q2", check_in_type: "QUARTERLY" })).status).toBe(200);
  });

  it.each([
    ["manager", MANAGER],
    ["delegate", DELEGATE],
    ["HR", HR],
  ])("the %s can initiate a formal review", async (_label, user) => {
    seed();
    await createFormal(user);
    expect(db.tables.check_ins[0].review_mode).toBe("FORMAL_SCORED");
  });

  it("a general appraisal viewer (GM) cannot initiate", async () => {
    seed();
    as(GM);
    expect((await create({ check_in_type: "MIDYEAR" })).status).toBe(403);
  });

  it.each([
    ["manager", MANAGER],
    ["delegate", DELEGATE],
    ["HR", HR],
    ["GM viewer", GM],
  ])("the %s cannot edit or submit the employee portion", async (_label, user) => {
    seed();
    const id = await createFormal();
    as(user);
    for (const action of ["EMPLOYEE_SAVE_DRAFT", "EMPLOYEE_SUBMIT"]) {
      const res = await patch(id, { action, responses: [{ workplan_item_id: "wi-num", employee_actual_raw: 3 }] });
      expect(res.status).toBe(403);
    }
    expect(db.tables.check_in_responses.every((r) => r.employee_actual_raw == null)).toBe(true);
    expect(checkInRow(id).status).toBe("OPEN");
  });

  it("the GM viewer cannot write employee fields through the draft responses endpoint", async () => {
    seed();
    const id = await createFormal();
    as(GM);
    expect((await patchResponses(id, [{ workplan_item_id: "wi-num", employee_comment: "x" }])).status).toBe(403);
    expect(db.tables.check_in_responses.every((r) => r.employee_comment == null)).toBe(true);
  });

  it("the employee can still save drafts through the draft responses endpoint", async () => {
    seed();
    const id = await createFormal();
    as(EMPLOYEE);
    expect((await patchResponses(id, [{ workplan_item_id: "wi-num", employee_comment: "On it" }])).status).toBe(200);
  });

  it.each([
    ["employee", EMPLOYEE],
    ["HR", HR],
    ["GM viewer", GM],
  ])("the %s cannot enter the manager portion or complete", async (_label, user) => {
    seed();
    const id = await createFormal();
    await employeeSubmit(id);
    as(user);
    for (const action of ["MANAGER_RESPOND", "MANAGER_COMPLETE"]) {
      expect((await patch(id, { action, responses: [] })).status).toBe(403);
    }
    expect(checkInRow(id).status).toBe("EMPLOYEE_SUBMITTED");
    as(MANAGER);
    await managerReview(id);
    as(user);
    expect((await patch(id, { action: "COMPLETE" })).status).toBe(403);
    expect(checkInRow(id).status).toBe("MANAGER_REVIEWED");
  });

  it("HR can cancel a formal review; the employee cannot", async () => {
    seed();
    const id = await createFormal();
    as(EMPLOYEE);
    expect((await patch(id, { action: "CANCEL" })).status).toBe(403);
    as(HR);
    expect((await patch(id, { action: "CANCEL" })).status).toBe(200);
    expect(checkInRow(id).status).toBe("CANCELLED");
  });

  it("HR keeps the existing informal permissions", async () => {
    seed();
    await create({ title: "Q2", check_in_type: "QUARTERLY" });
    const id = db.tables.check_ins[0].id as string;
    as(HR);
    expect((await patch(id, { action: "EMPLOYEE_SUBMIT", responses: [] })).status).toBe(200);
    expect((await patch(id, { action: "MANAGER_COMPLETE", responses: [] })).status).toBe(200);
  });
});

describe("one active formal Mid-Year Review per appraisal", () => {
  it.each(["OPEN", "EMPLOYEE_SUBMITTED", "MANAGER_REVIEWED", "COMPLETE"])(
    "a second formal review is rejected while one is %s",
    async (status) => {
      seed();
      const id = await createFormal();
      checkInRow(id).status = status;
      as(MANAGER);
      const res = await create({ check_in_type: "MIDYEAR" });
      expect(res.status).toBe(409);
      expect(db.tables.check_ins).toHaveLength(1);
    }
  );

  it("a new formal review is allowed after cancellation", async () => {
    seed();
    const id = await createFormal();
    as(MANAGER);
    await patch(id, { action: "CANCEL" });
    await createFormal();
    expect(db.tables.check_ins.map((c) => c.status)).toEqual(["CANCELLED", "OPEN"]);
  });

  it("a concurrent create that loses the database unique index returns 409 and leaves nothing behind", async () => {
    seed();
    db = new FakeSupabase(db.tables, { check_ins: [["appraisal_id", "review_mode"]] });
    mocks.createClient.mockReturnValue(db);
    const originalFrom = db.from.bind(db);
    // The competing request commits between the server pre-check and this insert.
    vi.spyOn(db, "from").mockImplementation((table: string) => {
      const query = originalFrom(table);
      if (table === "check_ins") {
        const insert = query.insert.bind(query);
        query.insert = (payload: Record<string, unknown> | Record<string, unknown>[]) => {
          db.tables.check_ins.push({ id: "ci-race", appraisal_id: APPRAISAL_ID, review_mode: "FORMAL_SCORED", status: "OPEN" });
          return insert(payload);
        };
      }
      return query;
    });
    as(MANAGER);
    const res = await create({ check_in_type: "MIDYEAR" });
    expect(res.status).toBe(409);
    expect(db.tables.check_ins.map((c) => c.id)).toEqual(["ci-race"]);
    expect(db.tables.check_in_responses).toHaveLength(0);
    expect(db.tables.check_in_competency_ratings).toHaveLength(0);
  });
});

describe("completeness blockers (scored reviews)", () => {
  it("employee submission is blocked until every required item has an employee result/rating", async () => {
    seed();
    const id = await createFormal();
    const res = await employeeSubmit(id, false);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("The Mid-Year Review is incomplete.");
    expect(body.blockers).toEqual([
      "Workplan: 2 objective(s) missing an employee Mid-Year result.",
      "Core competencies: 1 employee rating(s) missing.",
      "Productivity: 1 employee rating(s) missing.",
      "Technical competencies: 1 employee rating(s) missing.",
    ]);
    expect(checkInRow(id).status).toBe("OPEN");
  });

  it("values sent with a blocked submission are kept as a draft", async () => {
    seed();
    const id = await createFormal();
    as(EMPLOYEE);
    const res = await patch(id, { action: "EMPLOYEE_SUBMIT", responses: [{ workplan_item_id: "wi-num", employee_actual_raw: 8 }] });
    expect(res.status).toBe(422);
    expect(db.tables.check_in_responses.find((r) => r.workplan_item_id === "wi-num")!.employee_result).toBe(80);
    expect(checkInRow(id).status).toBe("OPEN");
  });

  it("manager review is blocked until every required competency has a manager rating", async () => {
    seed();
    const id = await createFormal();
    await employeeSubmit(id);
    const res = await managerReview(id, MANAGER, false);
    expect(res.status).toBe(422);
    expect((await res.json()).blockers).toEqual([
      "Core competencies: 1 manager rating(s) missing.",
      "Productivity: 1 manager rating(s) missing.",
      "Technical competencies: 1 manager rating(s) missing.",
    ]);
    expect(checkInRow(id).status).toBe("EMPLOYEE_SUBMITTED");
  });

  it("the employee result is scoreable when the manager enters no actuals; comments are not required", async () => {
    seed();
    const id = await createFormal();
    await employeeSubmit(id);
    expect((await managerReview(id)).status).toBe(200);
    expect(db.tables.check_in_responses.every((r) => r.mgr_result == null && r.employee_comment == null)).toBe(true);
  });

  it("zero-weight competencies are not required", async () => {
    seed();
    const id = await createFormal();
    const rated = compIds();
    db.tables.check_in_competency_ratings.push({
      id: "cr-zero",
      check_in_id: id,
      section: "TECHNICAL",
      name_snapshot: "Legacy skill",
      weight_snapshot: 0,
      employee_rating_code: null,
      manager_rating_code: null,
    });
    as(EMPLOYEE);
    const res = await patch(id, {
      action: "EMPLOYEE_SUBMIT",
      responses: [
        { workplan_item_id: "wi-num", employee_actual_raw: 8 },
        { workplan_item_id: "wi-date", employee_completion_date: "2026-06-20" },
      ],
      competencies: rated.map((cid) => ({ id: cid, employee_rating_code: "7" })),
    });
    expect(res.status).toBe(200);
  });

  it("missing weights block progress", async () => {
    seed();
    const id = await createFormal();
    db.tables.check_in_responses[0].weight_snapshot = null;
    const res = await employeeSubmit(id);
    expect(res.status).toBe(422);
    expect((await res.json()).blockers).toEqual(["Workplan: 1 objective weight(s) missing."]);
  });

  it("COMPLETE re-checks completeness", async () => {
    seed();
    const id = await reviewedFormal();
    db.tables.check_in_competency_ratings[0].manager_rating_code = null;
    as(MANAGER);
    const res = await patch(id, { action: "COMPLETE" });
    expect(res.status).toBe(422);
    expect(checkInRow(id).status).toBe("MANAGER_REVIEWED");
  });

  it("unscored formal reviews are not blocked by completeness", async () => {
    seed({ scoring: false });
    const id = await createFormal();
    expect(checkInRow(id).review_mode).toBe("FORMAL");
    expect((await employeeSubmit(id, false)).status).toBe(200);
    expect((await managerReview(id, MANAGER, false)).status).toBe(200);
    as(MANAGER);
    expect((await patch(id, { action: "COMPLETE" })).status).toBe(200);
    expect(checkInRow(id).status).toBe("COMPLETE");
  });
});

describe("audit", () => {
  it("records created, employee submitted, manager reviewed and completed", async () => {
    seed();
    const id = await reviewedFormal();
    as(MANAGER);
    await patch(id, { action: "COMPLETE" });
    expect(auditTypes()).toEqual([
      "midyear_created",
      "midyear_employee_submitted",
      "midyear_manager_reviewed",
      "score_snapshot_recorded",
      "midyear_completed",
    ]);
    expect(db.tables.appraisal_audit.map((a) => a.actor_id)).toEqual(["u-mgr", "u-emp", "u-mgr", "u-mgr", "u-mgr"]);
    for (const a of db.tables.appraisal_audit.filter((row) => row.action_type !== "score_snapshot_recorded")) {
      expect(a.appraisal_id).toBe(APPRAISAL_ID);
      expect(a.summary).toMatch(/^Mid-Year Review .+: Mid-Year Review/);
      expect(a.detail).toMatchObject({ check_in_id: id, review_mode: "FORMAL_SCORED" });
    }
    expect(db.tables.appraisal_audit.at(-1)!.detail).toMatchObject({ from_status: "MANAGER_REVIEWED", to_status: "COMPLETE" });
  });

  it("records cancellation with the status it was cancelled from", async () => {
    seed();
    const id = await createFormal();
    as(HR);
    await patch(id, { action: "CANCEL" });
    expect(auditTypes()).toEqual(["midyear_created", "midyear_cancelled"]);
    expect(db.tables.appraisal_audit[1]).toMatchObject({ actor_id: "u-hr", detail: { from_status: "OPEN", to_status: "CANCELLED" } });
  });

  it("blocked or rejected actions write no audit", async () => {
    seed();
    const id = await createFormal();
    await employeeSubmit(id, false);
    as(HR);
    await patch(id, { action: "EMPLOYEE_SUBMIT", responses: [] });
    expect(auditTypes()).toEqual(["midyear_created"]);
  });

  it("informal check-ins keep the single existing check_in_created audit", async () => {
    seed();
    await create({ title: "Q2", check_in_type: "QUARTERLY" });
    const id = db.tables.check_ins[0].id as string;
    as(EMPLOYEE);
    await patch(id, { action: "EMPLOYEE_SUBMIT", responses: [] });
    as(MANAGER);
    await patch(id, { action: "MANAGER_COMPLETE", responses: [] });
    await patch(id, { action: "CANCEL" });
    expect(auditTypes()).toEqual(["check_in_created"]);
  });
});
