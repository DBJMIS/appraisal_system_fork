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
    hasManagerAccess: currentEmployeeId === "mgr-1",
  })),
}));
vi.mock("@/lib/appraisal-test-bypass", () => ({ allowAppraisalTestBypass: () => false }));
vi.mock("@/lib/notifications/create", () => ({ createNotificationForEmployeeId: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/notifications", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
  sendCheckInSubmittedToManager: vi.fn().mockResolvedValue(undefined),
  sendCheckInReviewedToEmployee: vi.fn().mockResolvedValue(undefined),
}));

import { fakeHr } from "../helpers/fake-dynamics-org";
import { GET, POST } from "@/app/api/appraisals/[id]/checkins/route";
import { PATCH } from "@/app/api/appraisals/[id]/checkins/[checkinId]/route";

const APPRAISAL_ID = "a-1";
const MANAGER = { id: "u-mgr", roles: ["manager"], employee_id: "mgr-1" };
const EMPLOYEE = { id: "u-emp", roles: ["employee"], employee_id: "emp-1" };
const ANNUAL_TABLES = ["appraisal_factor_ratings", "appraisal_technical_competencies", "workplan_items"];

let db: FakeSupabase;

function seed({ midyear = true, scoring = false, isManagement = false } = {}) {
  db = new FakeSupabase({
    appraisals: [
      {
        id: APPRAISAL_ID,
        employee_id: "emp-1",
        manager_employee_id: "mgr-1",
        division_id: "d-1",
        cycle_id: "c-1",
        status: "IN_PROGRESS",
        is_management: isManagement,
      },
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
      { id: "wi-num", workplan_id: "wp-1", major_task: "Deliver reports", weight: 60, metric_type: "NUMBER", metric_target: 10, metric_deadline: null, actual_result: null, mgr_result: null, created_at: 1 },
      { id: "wi-date", workplan_id: "wp-1", major_task: "Launch portal", weight: 40, metric_type: "DATE", metric_target: null, metric_deadline: "2026-06-30", actual_result: null, mgr_result: null, created_at: 2 },
    ],
    evaluation_categories: [
      { id: "cat-core", category_type: "core", active: true },
      { id: "cat-prod", category_type: "productivity", active: true },
      { id: "cat-lead", category_type: "leadership", active: true },
    ],
    evaluation_factors: [
      { id: "f-core", category_id: "cat-core", name: "Integrity", weight: 100, display_order: 1, active: true },
      { id: "f-prod", category_id: "cat-prod", name: "Quality", weight: 100, display_order: 1, active: true },
      { id: "f-lead", category_id: "cat-lead", name: "Vision", weight: 100, display_order: 1, active: true },
    ],
    appraisal_factor_ratings: [
      { id: "afr-1", appraisal_id: APPRAISAL_ID, factor_id: "f-core", weight: 100, self_rating_code: null, manager_rating_code: null },
    ],
    appraisal_technical_competencies: [
      { id: "t-sql", appraisal_id: APPRAISAL_ID, name: "SQL", weight: 100, display_order: 1, self_rating: null, manager_rating: null },
    ],
    rating_scale: [
      { code: "7", label: "Meets expectations well", factor: 0.7 },
      { code: "8", label: "Exceeds expectations", factor: 0.8 },
    ],
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

const create = (body: Record<string, unknown>) => POST(json(body), { params: Promise.resolve({ id: APPRAISAL_ID }) });
const patch = (checkinId: string, body: Record<string, unknown>) =>
  PATCH(json(body), { params: Promise.resolve({ id: APPRAISAL_ID, checkinId }) });
const list = () => GET(new Request("http://localhost") as unknown as NextRequest, { params: Promise.resolve({ id: APPRAISAL_ID }) });

const annualState = () => JSON.stringify(ANNUAL_TABLES.map((t) => db.tables[t]));
const annualWrites = () => db.writes.filter((w) => ANNUAL_TABLES.includes(w.table));

async function createFormal() {
  const res = await create({ check_in_type: "MIDYEAR" });
  expect(res.status).toBe(200);
  return db.tables.check_ins[0].id as string;
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeHr.reset();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://supabase.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  mocks.getCurrentUser.mockResolvedValue(MANAGER);
});

afterEach(() => vi.unstubAllEnvs());

describe("formal Mid-Year creation", () => {
  it("snapshots workplan weights onto the responses", async () => {
    seed();
    await createFormal();
    expect(db.tables.check_in_responses.map((r) => [r.workplan_item_id, r.weight_snapshot])).toEqual([
      ["wi-num", 60],
      ["wi-date", 40],
    ]);
  });

  it("creates competency rows with frozen names and weights (non-management: no leadership)", async () => {
    seed();
    const id = await createFormal();
    expect(db.tables.check_in_competency_ratings.map((r) => ({ ...r, id: undefined }))).toEqual([
      { id: undefined, check_in_id: id, section: "CORE", factor_id: "f-core", technical_competency_id: null, name_snapshot: "Integrity", weight_snapshot: 100, display_order: 0 },
      { id: undefined, check_in_id: id, section: "PRODUCTIVITY", factor_id: "f-prod", technical_competency_id: null, name_snapshot: "Quality", weight_snapshot: 100, display_order: 0 },
      { id: undefined, check_in_id: id, section: "TECHNICAL", factor_id: null, technical_competency_id: "t-sql", name_snapshot: "SQL", weight_snapshot: 100, display_order: 0 },
    ]);
  });

  it("freezes the management track on the check-in and includes leadership", async () => {
    seed({ isManagement: true, scoring: true });
    await createFormal();
    expect(db.tables.check_ins[0]).toMatchObject({ review_mode: "FORMAL_SCORED", is_management_track: true });
    expect(db.tables.check_in_competency_ratings.some((r) => r.section === "LEADERSHIP")).toBe(true);
  });

  it("freezes non-management as false", async () => {
    seed();
    await createFormal();
    expect(db.tables.check_ins[0].is_management_track).toBe(false);
    expect(db.tables.check_in_competency_ratings.some((r) => r.section === "LEADERSHIP")).toBe(false);
  });

  it("an employee with direct reports in HR (not flagged management) is frozen as true with leadership", async () => {
    seed({ isManagement: false });
    fakeHr.directReports["emp-1"] = 3;
    await createFormal();
    expect(db.tables.check_ins[0].is_management_track).toBe(true);
    expect(db.tables.check_in_competency_ratings.filter((r) => r.section === "LEADERSHIP").map((r) => r.factor_id)).toEqual(["f-lead"]);
    expect(fakeHr.calls).toEqual(["employee:emp-1", "reports:hr-emp-1"]);
  });

  it("a failed management-track lookup returns a controlled error and creates nothing", async () => {
    seed();
    fakeHr.error = new Error("Dataverse unavailable");
    const res = await create({ check_in_type: "MIDYEAR" });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Could not determine management track: HR lookup failed (Dataverse unavailable)");
    expect(db.tables.check_ins).toEqual([]);
    expect(db.tables.check_in_competency_ratings).toEqual([]);
  });

  it("informal check-ins do not look up the management track", async () => {
    seed();
    const res = await create({ title: "Q2", check_in_type: "QUARTERLY" });
    expect(res.status).toBe(200);
    expect(fakeHr.calls).toEqual([]);
    expect(db.tables.check_ins[0].is_management_track).toBeUndefined();
  });

  it("the frozen track and weights do not follow later annual changes", async () => {
    seed();
    const id = await createFormal();
    db.tables.appraisals[0].is_management = true;
    db.tables.appraisal_factor_ratings[0].weight = 20;
    db.tables.workplan_items[0].weight = 10;
    mocks.getCurrentUser.mockResolvedValue(EMPLOYEE);
    await patch(id, {
      action: "EMPLOYEE_SAVE_DRAFT",
      responses: [{ workplan_item_id: "wi-num", employee_actual_raw: 5 }],
      competencies: [{ id: db.tables.check_in_competency_ratings[0].id, employee_rating_code: "7" }],
    });
    const body = await (await list()).json();
    const ci = body.checkIns[0];
    expect(ci.is_management_track).toBe(false);
    expect(ci.competency_ratings.map((r: { weight_snapshot: number }) => r.weight_snapshot)).toEqual([100, 100, 100]);
    expect(ci.competency_ratings.some((r: { section: string }) => r.section === "LEADERSHIP")).toBe(false);
    expect(ci.responses.map((r: { weight_snapshot: number }) => r.weight_snapshot)).toEqual([60, 40]);
  });

  it("does not write to the annual assessment tables", async () => {
    seed({ isManagement: true });
    const before = annualState();
    await createFormal();
    expect(annualWrites()).toEqual([]);
    expect(annualState()).toBe(before);
  });

  it("leaves the appraisal IN_PROGRESS", async () => {
    seed();
    await createFormal();
    expect(db.tables.appraisals[0].status).toBe("IN_PROGRESS");
  });
});

describe("informal check-ins are unchanged", () => {
  it.each([
    [{ midyear: false }, { title: "Mid-year check-in", check_in_type: "MIDYEAR" }],
    [{ midyear: true }, { title: "Q2", check_in_type: "QUARTERLY" }],
    [{ midyear: true }, { title: "Chat", check_in_type: "ADHOC" }],
  ])("%j %j writes the same rows as before", async (cycle, body) => {
    seed(cycle);
    const res = await create(body);
    expect(res.status).toBe(200);
    expect(Object.keys(db.tables.check_ins[0]).sort()).toEqual(
      ["appraisal_id", "check_in_type", "due_date", "id", "initiated_by", "note_to_employee", "status", "title", "updated_at"].sort()
    );
    for (const r of db.tables.check_in_responses) {
      expect(Object.keys(r).sort()).toEqual(["check_in_id", "id", "updated_at", "workplan_item_id"]);
    }
    expect(db.tables.check_in_competency_ratings).toEqual([]);
    expect(db.writes.map((w) => w.table)).toEqual(["check_ins", "appraisal_audit", "check_in_responses"]);
  });

  it("ignores Mid-Year fields sent for an informal check-in", async () => {
    seed({ midyear: false });
    await create({ title: "Q2", check_in_type: "QUARTERLY" });
    const id = db.tables.check_ins[0].id as string;
    mocks.getCurrentUser.mockResolvedValue(EMPLOYEE);
    db.writes = [];
    const res = await patch(id, {
      action: "EMPLOYEE_SAVE_DRAFT",
      responses: [{ workplan_item_id: "wi-num", employee_status: "ON_TRACK", progress_pct: 50, employee_comment: "ok", employee_actual_raw: 9 }],
      competencies: [{ id: "anything", employee_rating_code: "7" }],
    });
    expect(res.status).toBe(200);
    expect(db.writes).toHaveLength(1);
    expect(db.writes[0].table).toBe("check_in_responses");
    expect(Object.keys(db.writes[0].payload as object).sort()).toEqual(
      ["employee_comment", "employee_status", "employee_updated_at", "progress_pct", "updated_at"]
    );
  });

  it("GET adds no Mid-Year payload when there is no formal review", async () => {
    seed({ midyear: false });
    await create({ title: "Q2", check_in_type: "QUARTERLY" });
    const body = await (await list()).json();
    expect("competency_ratings" in body.checkIns[0]).toBe(false);
    expect("ratingScale" in body).toBe(false);
  });
});

describe("saving Mid-Year inputs", () => {
  it("employee workplan actuals are stored with results from metric-calc", async () => {
    seed();
    const id = await createFormal();
    mocks.getCurrentUser.mockResolvedValue(EMPLOYEE);
    const res = await patch(id, {
      action: "EMPLOYEE_SAVE_DRAFT",
      responses: [
        { workplan_item_id: "wi-num", employee_status: "ON_TRACK", progress_pct: 80, employee_actual_raw: 8, mgr_actual_raw: 1 },
        { workplan_item_id: "wi-date", employee_status: "AT_RISK", employee_completion_date: "2026-08-14" },
      ],
    });
    expect(res.status).toBe(200);
    const [num, date] = db.tables.check_in_responses;
    expect(num).toMatchObject({ employee_actual_raw: 8, employee_result: 80, employee_status: "ON_TRACK", progress_pct: 80 });
    expect(num.mgr_actual_raw).toBeUndefined();
    expect(date).toMatchObject({ employee_completion_date: "2026-08-14", employee_result: 50 });
  });

  it("employee competency ratings and comments are stored; manager fields are ignored", async () => {
    seed();
    const id = await createFormal();
    const [core] = db.tables.check_in_competency_ratings;
    mocks.getCurrentUser.mockResolvedValue(EMPLOYEE);
    await patch(id, {
      action: "EMPLOYEE_SUBMIT",
      responses: [],
      competencies: [{ id: core.id, employee_rating_code: "8", employee_comment: "Consistent", manager_rating_code: "2" }],
    });
    expect(db.tables.check_in_competency_ratings[0]).toMatchObject({ employee_rating_code: "8", employee_comment: "Consistent" });
    expect(db.tables.check_in_competency_ratings[0].manager_rating_code).toBeUndefined();
    expect(db.tables.check_ins[0].status).toBe("EMPLOYEE_SUBMITTED");
  });

  it("manager workplan assessment and competency ratings are stored on completion", async () => {
    seed();
    const id = await createFormal();
    const [core] = db.tables.check_in_competency_ratings;
    mocks.getCurrentUser.mockResolvedValue(EMPLOYEE);
    await patch(id, { action: "EMPLOYEE_SUBMIT", responses: [{ workplan_item_id: "wi-num", employee_actual_raw: 8 }] });
    mocks.getCurrentUser.mockResolvedValue(MANAGER);
    const res = await patch(id, {
      action: "MANAGER_COMPLETE",
      responses: [{ workplan_item_id: "wi-num", mgr_actual_raw: 6, employee_actual_raw: 10 }],
      competencies: [{ id: core.id, manager_rating_code: "7", manager_comment: "Agree", employee_rating_code: "1" }],
    });
    expect(res.status).toBe(200);
    expect(db.tables.check_in_responses[0]).toMatchObject({ employee_actual_raw: 8, employee_result: 80, mgr_actual_raw: 6, mgr_result: 60 });
    expect(db.tables.check_in_competency_ratings[0]).toMatchObject({ manager_rating_code: "7", manager_comment: "Agree" });
    expect(db.tables.check_in_competency_ratings[0].employee_rating_code).toBeUndefined();
    expect(db.tables.check_ins[0].status).toBe("MANAGER_REVIEWED");
  });

  it("rejects an invalid rating without writing anything", async () => {
    seed();
    const id = await createFormal();
    const [core] = db.tables.check_in_competency_ratings;
    mocks.getCurrentUser.mockResolvedValue(EMPLOYEE);
    db.writes = [];
    const res = await patch(id, {
      action: "EMPLOYEE_SAVE_DRAFT",
      responses: [{ workplan_item_id: "wi-num", employee_actual_raw: 8 }],
      competencies: [{ id: core.id, employee_rating_code: "12" }],
    });
    expect(res.status).toBe(400);
    expect(db.writes).toEqual([]);
  });

  it("the full Mid-Year flow never writes to the annual assessment tables", async () => {
    seed({ isManagement: true });
    const before = annualState();
    const id = await createFormal();
    const comps = db.tables.check_in_competency_ratings;
    mocks.getCurrentUser.mockResolvedValue(EMPLOYEE);
    await patch(id, {
      action: "EMPLOYEE_SUBMIT",
      responses: [{ workplan_item_id: "wi-num", employee_actual_raw: 8 }, { workplan_item_id: "wi-date", employee_completion_date: "2026-06-20" }],
      competencies: comps.map((c) => ({ id: c.id, employee_rating_code: "8", employee_comment: "x" })),
    });
    mocks.getCurrentUser.mockResolvedValue(MANAGER);
    await patch(id, {
      action: "MANAGER_RESPOND",
      responses: [{ workplan_item_id: "wi-num", mgr_actual_raw: 7 }],
      competencies: comps.map((c) => ({ id: c.id, manager_rating_code: "7" })),
    });
    await patch(id, {
      action: "MANAGER_COMPLETE",
      responses: [{ workplan_item_id: "wi-date", mgr_completion_date: "2026-07-30" }],
      competencies: comps.map((c) => ({ id: c.id, manager_comment: "done" })),
    });
    expect(annualWrites()).toEqual([]);
    expect(annualState()).toBe(before);
    expect([...new Set(db.writes.map((w) => w.table))].sort()).toEqual(
      ["appraisal_audit", "check_in_competency_ratings", "check_in_responses", "check_ins"]
    );
  });

  it("GET returns the competency inputs and rating scale for a formal review", async () => {
    seed();
    await createFormal();
    const body = await (await list()).json();
    expect(body.checkIns[0].competency_ratings).toHaveLength(3);
    expect(body.ratingScale).toEqual([
      { code: "7", label: "Meets expectations well" },
      { code: "8", label: "Exceeds expectations" },
    ]);
    expect(body.checkIns[0].responses[1].workplan_item.metric_deadline).toBe("2026-06-30");
  });
});
