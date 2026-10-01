import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
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
    isDelegated: false,
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

import { POST } from "@/app/api/appraisals/[id]/checkins/route";
import { PATCH } from "@/app/api/appraisals/[id]/checkins/[checkinId]/route";
import { buildMidyearSummaryInput } from "@/lib/midyear-summary-input";
import { recordMidyearScore } from "@/lib/midyear-score";
import { calcSummary, type SummaryCalcProps } from "@/lib/summary-calc";

const APPRAISAL_ID = "a-1";
const MANAGER = { id: "u-mgr", roles: ["manager"], employee_id: "mgr-1" };
const EMPLOYEE = { id: "u-emp", roles: ["employee"], employee_id: "emp-1" };
const ANNUAL_TABLES = [
  "appraisals",
  "appraisal_timeline",
  "workplans",
  "workplan_items",
  "appraisal_factor_ratings",
  "appraisal_technical_competencies",
  "appraisal_agreements",
];

let db: FakeSupabase;

function seed({ scoring = true, isManagement = false } = {}) {
  db = new FakeSupabase(
    {
      appraisals: [
        { id: APPRAISAL_ID, employee_id: "emp-1", manager_employee_id: "mgr-1", division_id: "d-1", cycle_id: "c-1", status: "IN_PROGRESS", is_management: isManagement },
      ],
      appraisal_cycles: [
        { id: "c-1", name: "FY 2026", fiscal_year: "2026", midyear_review_enabled: true, midyear_scoring_enabled: scoring, midyear_window_start: null, midyear_due_date: null },
      ],
      employees: [
        { id: "e-uuid-emp", employee_id: "emp-1", full_name: "Employee", manager_employee_id: "mgr-1" },
        { id: "e-uuid-mgr", employee_id: "mgr-1", full_name: "Manager", manager_employee_id: null },
      ],
      workplans: [{ id: "wp-1", appraisal_id: APPRAISAL_ID, status: "approved" }],
      workplan_items: [
        { id: "wi-num", workplan_id: "wp-1", major_task: "Deliver reports", weight: 60, metric_type: "NUMBER", metric_target: 10, metric_deadline: null, actual_result: 55, mgr_result: 50, created_at: 1 },
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
        { id: "afr-1", appraisal_id: APPRAISAL_ID, factor_id: "f-core", weight: 100, self_rating_code: "3", manager_rating_code: "2" },
      ],
      appraisal_technical_competencies: [
        { id: "t-sql", appraisal_id: APPRAISAL_ID, name: "SQL", weight: 100, display_order: 1, self_rating: "4", manager_rating: "3" },
      ],
      rating_scale: [{ code: "8", label: "Exceeds", factor: 0.8 }],
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
  new Request("http://localhost", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
const as = (user: Record<string, unknown>) => mocks.getCurrentUser.mockResolvedValue(user);
const patch = (checkinId: string, body: Record<string, unknown>) =>
  PATCH(json(body), { params: Promise.resolve({ id: APPRAISAL_ID, checkinId }) });
const compIds = () => db.tables.check_in_competency_ratings.map((r) => r.id as string);
const checkInRow = (id: string) => db.tables.check_ins.find((c) => c.id === id)!;
const snapshots = () => db.tables.appraisal_score_snapshots;
const annualState = () => JSON.stringify(ANNUAL_TABLES.map((t) => db.tables[t] ?? []));

/** Creates a formal review and takes it to MANAGER_REVIEWED with complete inputs. */
async function reviewed() {
  as(MANAGER);
  expect((await POST(json({ check_in_type: "MIDYEAR" }), { params: Promise.resolve({ id: APPRAISAL_ID }) })).status).toBe(200);
  const id = db.tables.check_ins[0].id as string;
  as(EMPLOYEE);
  const submitted = await patch(id, {
    action: "EMPLOYEE_SUBMIT",
    responses: [
      { workplan_item_id: "wi-num", employee_actual_raw: 8 },
      { workplan_item_id: "wi-date", employee_completion_date: "2026-06-20" },
    ],
    competencies: compIds().map((cid) => ({ id: cid, employee_rating_code: "7" })),
  });
  expect(submitted.status).toBe(200);
  as(MANAGER);
  const review = await patch(id, {
    action: "MANAGER_COMPLETE",
    responses: [{ workplan_item_id: "wi-num", mgr_actual_raw: 6 }],
    competencies: compIds().map((cid, i) => ({ id: cid, manager_rating_code: String(8 + (i % 2)) })),
  });
  expect(review.status).toBe(200);
  return id;
}

const complete = (id: string) => {
  as(MANAGER);
  return patch(id, { action: "COMPLETE" });
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://supabase.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
});

afterEach(() => vi.unstubAllEnvs());

describe("MIDYEAR snapshot on COMPLETE", () => {
  it("stores one MIDYEAR snapshot with totals, grade, sections, components, inputs and track", async () => {
    seed();
    const id = await reviewed();
    expect(snapshots()).toHaveLength(0);
    expect((await complete(id)).status).toBe(200);
    expect(checkInRow(id).status).toBe("COMPLETE");
    expect(snapshots()).toHaveLength(1);
    const snap = snapshots()[0];
    expect(snap).toMatchObject({
      appraisal_id: APPRAISAL_ID,
      score_type: "MIDYEAR",
      is_management_track: false,
      engine_version: "summary-calc/v1",
      calculated_by: "u-mgr",
      leadership_actual: null,
      leadership_points: null,
    });
    expect(typeof snap.total_points).toBe("number");
    expect(snap.overall_grade).toMatch(/^[A-E]$/);
    expect(typeof snap.grade_label).toBe("string");
    for (const col of ["cc", "prod", "technical", "workplan"]) {
      expect(typeof snap[`${col}_actual`]).toBe("number");
      expect(typeof snap[`${col}_points`]).toBe("number");
    }
    expect((snap.components as { key: string }[]).map((c) => c.key)).toEqual(["cc", "prod", "technical", "workplan"]);
    expect((snap.inputs as SummaryCalcProps).workplanItems).toHaveLength(2);
  });

  it("is linked to the check-in", async () => {
    seed();
    const id = await reviewed();
    await complete(id);
    expect(snapshots()[0].check_in_id).toBe(id);
  });

  it("uses the canonical formula on the frozen Mid-Year inputs", async () => {
    seed();
    const id = await reviewed();
    await complete(id);
    const snap = snapshots()[0];
    const built = await buildMidyearSummaryInput(id, db as unknown as SupabaseClient);
    if (!built.ok) throw new Error(built.error.code);
    const expected = calcSummary(built.input);
    expect(snap.inputs).toEqual(built.input);
    expect(snap.components).toEqual(expected.components);
    expect(snap.total_points).toBe(expected.totalPoints);
    expect(snap.overall_grade).toBe(expected.overallGrade);
    // Recomputing from the stored inputs alone reproduces the stored score.
    expect(calcSummary(snap.inputs as SummaryCalcProps).totalPoints).toBe(snap.total_points);
    // The manager result takes precedence; the employee result is used where the manager entered none.
    expect((snap.inputs as SummaryCalcProps).workplanItems.map((w) => w.actual_result)).toEqual([60, 100]);
  });

  it("records the frozen management track and leadership", async () => {
    seed({ isManagement: true });
    const id = await reviewed();
    db.tables.appraisals[0].is_management = false;
    await complete(id);
    const snap = snapshots()[0];
    expect(snap.is_management_track).toBe(true);
    expect(typeof snap.leadership_actual).toBe("number");
    expect((snap.components as { key: string }[]).map((c) => c.key)).toContain("leadership");
  });

  it("does not use annual assessment values", async () => {
    seed();
    const id = await reviewed();
    await complete(id);
    const inputs = snapshots()[0].inputs as SummaryCalcProps;
    // Annual rows carry ratings 2/3 and workplan results 55/50; none of them reach the Mid-Year score.
    expect(inputs.competencies.map((c) => c.manager_rating)).not.toContain("2");
    expect(inputs.technical.map((c) => c.manager_rating)).not.toContain("3");
    expect(inputs.workplanItems.map((w) => w.actual_result)).not.toContain(50);
  });
});

describe("annual isolation", () => {
  it("writes nothing to annual tables and leaves them unchanged", async () => {
    seed();
    const before = annualState();
    const id = await reviewed();
    const writesBefore = db.writes.length;
    await complete(id);
    const completionWrites = db.writes.slice(writesBefore).map((w) => w.table);
    expect(new Set(completionWrites)).toEqual(new Set(["appraisal_score_snapshots", "check_ins", "appraisal_audit"]));
    expect(db.writes.filter((w) => ANNUAL_TABLES.includes(w.table))).toEqual([]);
    expect(annualState()).toBe(before);
  });

  it("the appraisal remains IN_PROGRESS", async () => {
    seed();
    const id = await reviewed();
    await complete(id);
    expect(db.tables.appraisals[0].status).toBe("IN_PROGRESS");
  });

  it("no FINAL snapshot is written", async () => {
    seed();
    await complete(await reviewed());
    expect(snapshots().map((s) => s.score_type)).toEqual(["MIDYEAR"]);
  });
});

describe("idempotency", () => {
  it("completing the same check-in twice does not create a second snapshot", async () => {
    seed();
    const id = await reviewed();
    await complete(id);
    const first = { ...snapshots()[0] };
    expect((await complete(id)).status).toBe(400);
    expect(snapshots()).toEqual([first]);
  });

  it("a retried completion (status write lost) leaves the original snapshot untouched", async () => {
    seed();
    const id = await reviewed();
    await complete(id);
    const first = { ...snapshots()[0] };
    checkInRow(id).status = "MANAGER_REVIEWED";
    expect((await complete(id)).status).toBe(200);
    expect(checkInRow(id).status).toBe("COMPLETE");
    expect(snapshots()).toEqual([first]);
  });

  it("recording the score directly twice writes once", async () => {
    seed();
    const id = await reviewed();
    const client = db as unknown as SupabaseClient;
    expect(await recordMidyearScore(client, { checkInId: id, actor: "u-mgr" })).toMatchObject({ ok: true, written: true });
    expect(await recordMidyearScore(client, { checkInId: id, actor: "u-mgr" })).toEqual({ ok: true, written: false, reason: "already_scored" });
    expect(snapshots()).toHaveLength(1);
  });

  it("a MIDYEAR snapshot for a different review is never overwritten", async () => {
    seed();
    const id = await reviewed();
    db.tables.appraisal_score_snapshots.push({ id: "snap-old", appraisal_id: APPRAISAL_ID, score_type: "MIDYEAR", check_in_id: "ci-other", total_points: 1 });
    const res = await complete(id);
    expect(res.status).toBe(409);
    expect(snapshots()).toEqual([{ id: "snap-old", appraisal_id: APPRAISAL_ID, score_type: "MIDYEAR", check_in_id: "ci-other", total_points: 1 }]);
    expect(checkInRow(id).status).toBe("MANAGER_REVIEWED");
  });
});

describe("failure and non-scored paths", () => {
  it("a failed snapshot write keeps the review MANAGER_REVIEWED so it can be retried", async () => {
    seed();
    const id = await reviewed();
    const originalFrom = db.from.bind(db);
    vi.spyOn(db, "from").mockImplementation((table: string) => {
      const query = originalFrom(table);
      if (table === "appraisal_score_snapshots") {
        const fail = () => Promise.resolve({ data: null, error: { message: "boom" } });
        (query as unknown as { upsert: () => Promise<unknown>; insert: () => Promise<unknown> }).upsert = fail;
        (query as unknown as { insert: () => Promise<unknown> }).insert = fail;
      }
      return query;
    });
    const res = await complete(id);
    expect(res.status).toBe(500);
    expect(checkInRow(id).status).toBe("MANAGER_REVIEWED");
    expect(db.tables.appraisal_audit.map((a) => a.action_type)).not.toContain("midyear_completed");
  });

  it("an incomplete scored review is not scored or completed", async () => {
    seed();
    const id = await reviewed();
    db.tables.check_in_competency_ratings[0].manager_rating_code = null;
    const res = await complete(id);
    expect(res.status).toBe(422);
    expect(snapshots()).toHaveLength(0);
    expect(checkInRow(id).status).toBe("MANAGER_REVIEWED");
  });

  it("an unscored formal review completes without a snapshot", async () => {
    seed({ scoring: false });
    const id = await reviewed();
    expect(checkInRow(id).review_mode).toBe("FORMAL");
    expect((await complete(id)).status).toBe(200);
    expect(checkInRow(id).status).toBe("COMPLETE");
    expect(snapshots()).toHaveLength(0);
  });

  it("the completion audit notes that a score was recorded, without the score itself", async () => {
    seed();
    await complete(await reviewed());
    const audit = db.tables.appraisal_audit.find((a) => a.action_type === "midyear_completed")!;
    expect(audit.detail).toMatchObject({ score_recorded: true });
    expect(JSON.stringify(audit)).not.toMatch(/total_points|overall_grade/);
  });
});
