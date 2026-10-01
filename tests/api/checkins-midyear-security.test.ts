import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { FakeSupabase } from "../helpers/fake-supabase";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), createClient: vi.fn() }));

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
import { GET as GET_ONE, PATCH } from "@/app/api/appraisals/[id]/checkins/[checkinId]/route";
import { PATCH as PATCH_RESPONSES } from "@/app/api/appraisals/[id]/checkins/[checkinId]/responses/route";
import { persistScoreSnapshot } from "@/lib/appraisal-score-snapshot";
import { calcSummary } from "@/lib/summary-calc";

const APPRAISAL_ID = "a-1";
const USERS = {
  EMPLOYEE: { id: "u-emp", roles: ["employee"], employee_id: "emp-1" },
  MANAGER: { id: "u-mgr", roles: ["manager"], employee_id: "mgr-1" },
  DELEGATE: { id: "u-del", roles: ["manager"], employee_id: "del-1" },
  HR: { id: "u-hr", roles: ["hr"], employee_id: "hr-1" },
  ADMIN: { id: "u-admin", roles: ["admin"], employee_id: "adm-1" },
  GM: { id: "u-gm", roles: ["gm"], employee_id: "gm-1", division_id: "d-1" },
  UNRELATED: { id: "u-x", roles: ["manager"], employee_id: "emp-9" },
} as const;
type Actor = keyof typeof USERS;

let db: FakeSupabase;

function seed() {
  db = new FakeSupabase(
    {
      appraisals: [
        { id: APPRAISAL_ID, employee_id: "emp-1", manager_employee_id: "mgr-1", division_id: "d-1", cycle_id: "c-1", status: "IN_PROGRESS", is_management: false },
      ],
      appraisal_cycles: [
        { id: "c-1", name: "FY 2026", fiscal_year: "2026", midyear_review_enabled: true, midyear_scoring_enabled: true, midyear_window_start: "2026-06-01", midyear_due_date: "2026-06-30" },
      ],
      employees: [
        { id: "e-uuid-emp", employee_id: "emp-1", full_name: "Employee", manager_employee_id: "mgr-1" },
        { id: "e-uuid-mgr", employee_id: "mgr-1", full_name: "Manager", manager_employee_id: null },
      ],
      workplans: [{ id: "wp-1", appraisal_id: APPRAISAL_ID, status: "approved" }],
      workplan_items: [
        { id: "wi-num", workplan_id: "wp-1", major_task: "Deliver reports", weight: 100, metric_type: "NUMBER", metric_target: 10, metric_deadline: null, created_at: 1 },
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
      app_users: [],
    },
    { appraisal_score_snapshots: [["appraisal_id", "score_type"]] }
  );
  mocks.createClient.mockReturnValue(db);
}

const json = (body: unknown) =>
  new Request("http://localhost", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) as unknown as NextRequest;
const as = (actor: Actor | null) => mocks.getCurrentUser.mockResolvedValue(actor ? USERS[actor] : null);
const create = (body: Record<string, unknown>) => POST(json(body), { params: Promise.resolve({ id: APPRAISAL_ID }) });
const patch = (checkinId: string, body: Record<string, unknown>) => PATCH(json(body), { params: Promise.resolve({ id: APPRAISAL_ID, checkinId }) });
const patchResponses = (checkinId: string, body: unknown) =>
  PATCH_RESPONSES(json(body), { params: Promise.resolve({ id: APPRAISAL_ID, checkinId }) });
const compIds = () => db.tables.check_in_competency_ratings.map((r) => r.id as string);
const row = (id: string) => db.tables.check_ins.find((c) => c.id === id)!;
const response = () => db.tables.check_in_responses[0];
const checkInWrites = () => db.writes.filter((w) => w.table.startsWith("check_in") || w.table === "appraisal_score_snapshots");

async function formal(status = "OPEN") {
  as("MANAGER");
  expect((await create({ check_in_type: "MIDYEAR" })).status).toBe(200);
  const id = db.tables.check_ins.at(-1)!.id as string;
  row(id).status = status;
  return id;
}

const employeeBody = (action: string) => ({
  action,
  responses: [{ workplan_item_id: "wi-num", employee_actual_raw: 8, mgr_actual_raw: 1, mgr_result: 100, employee_result: 100 }],
  competencies: compIds().map((id) => ({ id, employee_rating_code: "7", manager_rating_code: "1" })),
});
const managerBody = (action: string) => ({
  action,
  responses: [{ workplan_item_id: "wi-num", mgr_actual_raw: 6, employee_actual_raw: 1, employee_result: 100 }],
  competencies: compIds().map((id) => ({ id, manager_rating_code: "7", employee_rating_code: "1" })),
});

async function fillEmployee(id: string) {
  row(id).status = "OPEN";
  as("EMPLOYEE");
  expect((await patch(id, employeeBody("EMPLOYEE_SUBMIT"))).status).toBe(200);
}
async function fillManager(id: string) {
  as("MANAGER");
  expect((await patch(id, managerBody("MANAGER_COMPLETE"))).status).toBe(200);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://supabase.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  seed();
});
afterEach(() => vi.unstubAllEnvs());

describe("authorization matrix for formal Mid-Year actions", () => {
  const ALL: Actor[] = ["EMPLOYEE", "MANAGER", "DELEGATE", "HR", "ADMIN", "GM", "UNRELATED"];
  const cases: { action: string; state: string; allowed: Actor[]; body: (a: string) => Record<string, unknown> }[] = [
    { action: "EMPLOYEE_SAVE_DRAFT", state: "OPEN", allowed: ["EMPLOYEE"], body: employeeBody },
    { action: "EMPLOYEE_SUBMIT", state: "OPEN", allowed: ["EMPLOYEE"], body: employeeBody },
    { action: "MANAGER_RESPOND", state: "EMPLOYEE_SUBMITTED", allowed: ["MANAGER", "DELEGATE"], body: managerBody },
    { action: "MANAGER_COMPLETE", state: "EMPLOYEE_SUBMITTED", allowed: ["MANAGER", "DELEGATE"], body: managerBody },
    { action: "CANCEL", state: "OPEN", allowed: ["MANAGER", "DELEGATE", "HR", "ADMIN"], body: (a) => ({ action: a }) },
  ];

  for (const c of cases) {
    for (const actor of ALL) {
      const ok = c.allowed.includes(actor);
      it(`${c.action}: ${actor} is ${ok ? "allowed" : "denied"}`, async () => {
        const id = await formal();
        if (c.state === "EMPLOYEE_SUBMITTED") await fillEmployee(id);
        const before = checkInWrites().length;
        as(actor);
        const res = await patch(id, c.body(c.action));
        if (ok) {
          expect(res.status).toBe(200);
        } else {
          expect(res.status).toBe(403);
          expect(checkInWrites().length).toBe(before);
        }
      });
    }
  }

  it.each(ALL)("COMPLETE: %s", async (actor) => {
    const id = await formal();
    await fillEmployee(id);
    await fillManager(id);
    as(actor);
    const res = await patch(id, { action: "COMPLETE" });
    expect(res.status).toBe(["MANAGER", "DELEGATE"].includes(actor) ? 200 : 403);
    expect(row(id).status).toBe(["MANAGER", "DELEGATE"].includes(actor) ? "COMPLETE" : "MANAGER_REVIEWED");
  });

  it.each(ALL)("initiating a formal review: %s", async (actor) => {
    as(actor);
    const res = await create({ check_in_type: "MIDYEAR" });
    expect(res.status).toBe(["MANAGER", "DELEGATE", "HR", "ADMIN"].includes(actor) ? 200 : 403);
  });

  it("unauthenticated requests are rejected everywhere", async () => {
    const id = await formal();
    as(null);
    expect((await create({ check_in_type: "MIDYEAR" })).status).toBe(401);
    expect((await patch(id, employeeBody("EMPLOYEE_SUBMIT"))).status).toBe(401);
    expect((await patchResponses(id, [{ workplan_item_id: "wi-num", employee_comment: "x" }])).status).toBe(401);
    expect((await GET(new Request("http://localhost") as unknown as NextRequest, { params: Promise.resolve({ id: APPRAISAL_ID }) })).status).toBe(401);
  });

  it("an unrelated user cannot read the review", async () => {
    const id = await formal();
    as("UNRELATED");
    expect((await GET(new Request("http://localhost") as unknown as NextRequest, { params: Promise.resolve({ id: APPRAISAL_ID }) })).status).toBe(403);
    expect(
      (await GET_ONE(new Request("http://localhost") as unknown as NextRequest, { params: Promise.resolve({ id: APPRAISAL_ID, checkinId: id }) })).status
    ).toBe(403);
  });
});

describe("field ownership", () => {
  it("the employee writes only employee fields, whatever else is sent", async () => {
    const id = await formal();
    await fillEmployee(id);
    expect(response()).toMatchObject({ employee_actual_raw: 8, employee_result: 80 });
    expect(response().mgr_actual_raw ?? null).toBeNull();
    expect(response().mgr_result ?? null).toBeNull();
    for (const c of db.tables.check_in_competency_ratings) {
      expect(c.employee_rating_code).toBe("7");
      expect(c.manager_rating_code ?? null).toBeNull();
    }
  });

  it("the manager writes only manager fields, whatever else is sent", async () => {
    const id = await formal();
    await fillEmployee(id);
    await fillManager(id);
    expect(response()).toMatchObject({ employee_actual_raw: 8, employee_result: 80, mgr_actual_raw: 6, mgr_result: 60 });
    for (const c of db.tables.check_in_competency_ratings) {
      expect(c.employee_rating_code).toBe("7");
      expect(c.manager_rating_code).toBe("7");
    }
  });

  it("HR/admin cannot enter either portion of a formal review", async () => {
    const id = await formal();
    for (const actor of ["HR", "ADMIN"] as const) {
      as(actor);
      expect((await patch(id, employeeBody("EMPLOYEE_SUBMIT"))).status).toBe(403);
      expect((await patchResponses(id, [{ workplan_item_id: "wi-num", employee_comment: "x" }])).status).toBe(403);
    }
    await fillEmployee(id);
    for (const actor of ["HR", "ADMIN"] as const) {
      as(actor);
      expect((await patch(id, managerBody("MANAGER_COMPLETE"))).status).toBe(403);
    }
  });

  it.each([
    ["EMPLOYEE", 200],
    ["HR", 200],
    ["ADMIN", 200],
    ["MANAGER", 403],
    ["DELEGATE", 403],
    ["GM", 403],
    ["UNRELATED", 403],
  ] as const)("informal draft responses: %s → %s", async (actor, expected) => {
    as("MANAGER");
    await create({ title: "Q2", check_in_type: "QUARTERLY" });
    const id = db.tables.check_ins[0].id as string;
    as(actor);
    const res = await patchResponses(id, [{ workplan_item_id: "wi-num", employee_comment: `by ${actor}` }]);
    expect(res.status).toBe(expected);
    expect(response().employee_comment ?? null).toBe(expected === 200 ? `by ${actor}` : null);
  });
});

describe("lifecycle locks", () => {
  const ACTIONS = ["EMPLOYEE_SAVE_DRAFT", "EMPLOYEE_SUBMIT", "MANAGER_RESPOND", "MANAGER_COMPLETE", "COMPLETE", "CANCEL"];
  const actorFor = (action: string): Actor => (action.startsWith("EMPLOYEE") ? "EMPLOYEE" : "MANAGER");

  it.each(ACTIONS)("a COMPLETE review rejects %s and nothing is written", async (action) => {
    const id = await formal();
    await fillEmployee(id);
    await fillManager(id);
    as("MANAGER");
    expect((await patch(id, { action: "COMPLETE" })).status).toBe(200);
    const before = checkInWrites().length;
    as(actorFor(action));
    const res = await patch(id, action.startsWith("EMPLOYEE") ? employeeBody(action) : action.startsWith("MANAGER") ? managerBody(action) : { action });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(row(id).status).toBe("COMPLETE");
    expect(checkInWrites().length).toBe(before);
  });

  it.each(["SELF_ASSESSMENT", "MANAGER_REVIEW", "PENDING_SIGNOFF", "HR_REVIEW", "COMPLETE"])(
    "after the appraisal moves to %s every formal action is rejected with 409",
    async (appraisalStatus) => {
      const id = await formal();
      db.tables.appraisals[0].status = appraisalStatus;
      const before = checkInWrites().length;
      for (const action of ACTIONS) {
        as(actorFor(action));
        const res = await patch(id, { action, responses: [], competencies: [] });
        expect(res.status).toBe(409);
      }
      as("EMPLOYEE");
      expect((await patchResponses(id, [{ workplan_item_id: "wi-num", employee_comment: "late" }])).status).toBe(409);
      as("MANAGER");
      expect((await create({ check_in_type: "MIDYEAR" })).status).toBeGreaterThanOrEqual(400);
      expect(checkInWrites().length).toBe(before);
    }
  );
});

describe("audit", () => {
  it("every material Mid-Year event and the score persistence are audited", async () => {
    const id = await formal();
    await fillEmployee(id);
    await fillManager(id);
    as("MANAGER");
    await patch(id, { action: "COMPLETE" });
    const types = db.tables.appraisal_audit.map((a) => a.action_type);
    expect(types).toEqual([
      "midyear_created",
      "midyear_employee_submitted",
      "midyear_manager_reviewed",
      "score_snapshot_recorded",
      "midyear_completed",
    ]);
    const scoreAudit = db.tables.appraisal_audit.find((a) => a.action_type === "score_snapshot_recorded")!;
    expect(scoreAudit).toMatchObject({ appraisal_id: APPRAISAL_ID, actor_id: "u-mgr", summary: "Mid-Year score recorded" });
    expect(scoreAudit.detail).toMatchObject({ score_type: "MIDYEAR", check_in_id: id, engine_version: "summary-calc/v1" });
    expect(JSON.stringify(scoreAudit.detail)).not.toMatch(/total|grade|points/);
  });

  it("cancellation is audited", async () => {
    const id = await formal();
    as("HR");
    await patch(id, { action: "CANCEL" });
    expect(db.tables.appraisal_audit.map((a) => a.action_type)).toEqual(["midyear_created", "midyear_cancelled"]);
    expect(db.tables.appraisal_audit[1]).toMatchObject({ actor_id: "u-hr" });
  });

  it("FINAL snapshot persistence is audited too", async () => {
    const input = { workplanItems: [{ weight: 100, actual_result: 80 }], competencies: [], technical: [], productivity: [], leadership: [], isManagementTrack: false };
    const result = calcSummary(input as never);
    await persistScoreSnapshot({ supabase: db as never, appraisalId: APPRAISAL_ID, scoreType: "FINAL", isManagementTrack: false, input: input as never, result, actor: "u-mgr" });
    expect(db.tables.appraisal_audit).toEqual([
      expect.objectContaining({ action_type: "score_snapshot_recorded", summary: "Final score recorded", detail: expect.objectContaining({ score_type: "FINAL", check_in_id: null }) }),
    ]);
  });

  it("a failed audit write never blocks score persistence", async () => {
    const realFrom = db.from.bind(db);
    vi.spyOn(db, "from").mockImplementation((table: string) => {
      if (table === "appraisal_audit") throw new Error("audit down");
      return realFrom(table);
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const input = { workplanItems: [{ weight: 100, actual_result: 80 }], competencies: [], technical: [], productivity: [], leadership: [], isManagementTrack: false };
    const outcome = await persistScoreSnapshot({
      supabase: db as never,
      appraisalId: APPRAISAL_ID,
      scoreType: "FINAL",
      isManagementTrack: false,
      input: input as never,
      result: calcSummary(input as never),
      actor: null,
    });
    expect(outcome.written).toBe(true);
    expect(db.tables.appraisal_score_snapshots).toHaveLength(1);
    err.mockRestore();
  });
});
