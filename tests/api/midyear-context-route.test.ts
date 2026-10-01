import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { FakeSupabase } from "../helpers/fake-supabase";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), createClient: vi.fn() }));

vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/appraisal-manager-access", () => ({
  resolveManagerAccessForAppraisal: vi.fn(async ({ currentEmployeeId }: { currentEmployeeId: string | null }) => ({
    hasManagerAccess: currentEmployeeId === "mgr-1",
  })),
}));

import { GET } from "@/app/api/appraisals/[id]/midyear-context/route";

const review = (overrides: Record<string, unknown> = {}) => ({
  id: "ci-1",
  appraisal_id: "a-1",
  check_in_type: "MIDYEAR",
  review_mode: "FORMAL_SCORED",
  status: "COMPLETE",
  updated_at: "2026-07-10T10:00:00Z",
  ...overrides,
});

const response = (workplan_item_id: string, employee_result: number | null, mgr_result: number | null, check_in_id = "ci-1") => ({
  id: `r-${check_in_id}-${workplan_item_id}`,
  check_in_id,
  workplan_item_id,
  weight_snapshot: 50,
  employee_result,
  mgr_result,
});

const snapshot = (revision: number, total_points: number, overall_grade: string, superseded_at: string | null, check_in_id = "ci-1") => ({
  id: `s-${revision}`,
  appraisal_id: "a-1",
  score_type: "MIDYEAR",
  revision,
  check_in_id,
  total_points,
  overall_grade,
  grade_label: overall_grade === "B" ? "Very good" : "Good",
  is_management_track: false,
  calculated_at: "2026-07-10T10:00:00Z",
  superseded_at,
});

let db: FakeSupabase;
function seed(tables: { check_ins?: unknown[]; check_in_responses?: unknown[]; appraisal_score_snapshots?: unknown[]; midyearEnabled?: boolean }) {
  db = new FakeSupabase({
    appraisals: [
      { id: "a-1", employee_id: "emp-1", manager_employee_id: "mgr-1", division_id: "d-1", cycle_id: "cy-1", status: "SELF_ASSESSMENT" },
    ],
    appraisal_cycles: [{ id: "cy-1", fiscal_year: "2026", midyear_review_enabled: tables.midyearEnabled ?? true, midyear_scoring_enabled: true }],
    check_ins: (tables.check_ins ?? []) as Record<string, unknown>[],
    check_in_responses: (tables.check_in_responses ?? []) as Record<string, unknown>[],
    appraisal_score_snapshots: (tables.appraisal_score_snapshots ?? []) as Record<string, unknown>[],
  });
  mocks.createClient.mockReturnValue(db);
}

const as = (user: Record<string, unknown>) => mocks.getCurrentUser.mockResolvedValue(user);
const get = async () => {
  const res = await GET(new Request("http://localhost") as unknown as NextRequest, { params: Promise.resolve({ id: "a-1" }) });
  return { status: res.status, body: await res.json() };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://supabase.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  as({ id: "u-emp", roles: ["employee"], employee_id: "emp-1" });
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/appraisals/[id]/midyear-context", () => {
  it("a completed scored review: the effective result per workplan item and the current Mid-Year score", async () => {
    seed({
      check_ins: [review()],
      check_in_responses: [response("i-1", 50, 60), response("i-2", 85, null), response("i-3", null, null)],
      appraisal_score_snapshots: [snapshot(1, 74.56, "B", null)],
    });
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body).toEqual({
      available: true,
      results: { "i-1": 60, "i-2": 85, "i-3": null },
      score: { total: 74.56, grade: "B", gradeLabel: "Very good", revision: 1 },
    });
    expect(db.writes).toEqual([]);
  });

  it("uses the latest current Mid-Year revision and ignores superseded ones", async () => {
    seed({
      check_ins: [review()],
      check_in_responses: [response("i-1", 50, 70)],
      appraisal_score_snapshots: [snapshot(1, 61.2, "C", "2026-07-05T09:00:00Z"), snapshot(2, 74.6, "B", null)],
    });
    const { body } = await get();
    expect(body.score).toEqual({ total: 74.6, grade: "B", gradeLabel: "Very good", revision: 2 });
    expect(JSON.stringify(body)).not.toContain("61.2");
  });

  it("a review reopened for revision is not read as current: no context until it is completed again", async () => {
    seed({
      check_ins: [review({ status: "EMPLOYEE_SUBMITTED" })],
      check_in_responses: [response("i-1", 50, 95)],
      appraisal_score_snapshots: [snapshot(1, 61.2, "C", "2026-07-05T09:00:00Z")],
    });
    expect((await get()).body).toEqual({ available: false, results: {}, score: null });
  });

  it("a completed review whose only snapshot is superseded shows results but no score", async () => {
    seed({
      check_ins: [review()],
      check_in_responses: [response("i-1", 50, 60)],
      appraisal_score_snapshots: [snapshot(1, 61.2, "C", "2026-07-05T09:00:00Z")],
    });
    const { body } = await get();
    expect(body.available).toBe(true);
    expect(body.score).toBeNull();
  });

  it("a completed unscored formal review shows results without a score", async () => {
    seed({ check_ins: [review({ review_mode: "FORMAL" })], check_in_responses: [response("i-1", 40, null)] });
    expect((await get()).body).toEqual({ available: true, results: { "i-1": 40 }, score: null });
  });

  it.each([
    ["Mid-Year Review disabled for the cycle", { midyearEnabled: false, check_ins: [review()] }],
    ["no Mid-Year Review", { check_ins: [] }],
    ["Mid-Year Review not yet completed", { check_ins: [review({ status: "MANAGER_REVIEWED" })] }],
    ["an informal Mid-Year check-in", { check_ins: [review({ review_mode: "INFORMAL" })] }],
    ["a completed quarterly check-in", { check_ins: [review({ check_in_type: "QUARTERLY", review_mode: "INFORMAL" })] }],
    ["a cancelled review", { check_ins: [review({ status: "CANCELLED" })] }],
  ])("%s → no context", async (_label, tables) => {
    seed({ ...tables, check_in_responses: [response("i-1", 50, 60)], appraisal_score_snapshots: [snapshot(1, 74.6, "B", null)] });
    expect((await get()).body).toEqual({ available: false, results: {}, score: null });
  });

  it("matches only by workplan item id: an objective with no Mid-Year response is simply absent", async () => {
    seed({ check_ins: [review()], check_in_responses: [response("i-1", 50, 60), response("i-9", 10, 10, "ci-other")] });
    const { body } = await get();
    expect(body.results).toEqual({ "i-1": 60 });
  });

  it.each([
    ["employee", { id: "u-emp", roles: ["employee"], employee_id: "emp-1" }, 200],
    ["manager", { id: "u-mgr", roles: ["manager"], employee_id: "mgr-1" }, 200],
    ["HR", { id: "u-hr", roles: ["hr"], employee_id: "hr-1" }, 200],
    ["unrelated employee", { id: "u-x", roles: ["employee"], employee_id: "emp-9" }, 403],
  ])("access: %s → %s", async (_label, user, expected) => {
    seed({ check_ins: [review()], check_in_responses: [response("i-1", 50, 60)] });
    as(user);
    const { status, body } = await get();
    expect(status).toBe(expected);
    if (expected === 403) expect(body.results).toBeUndefined();
  });

  it("401 without a session", async () => {
    seed({});
    mocks.getCurrentUser.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
  });
});
