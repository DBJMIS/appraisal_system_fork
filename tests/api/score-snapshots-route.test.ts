import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { FakeSupabase } from "../helpers/fake-supabase";

const mocks = vi.hoisted(() => ({ getCurrentUser: vi.fn(), createClient: vi.fn() }));

vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/appraisal-manager-access", () => ({
  resolveManagerAccessForAppraisal: vi.fn(async ({ currentEmployeeId }: { currentEmployeeId: string | null }) => ({
    hasManagerAccess: currentEmployeeId === "mgr-1" || currentEmployeeId === "del-1",
  })),
}));

import { GET } from "@/app/api/appraisals/[id]/score-snapshots/route";

const snap = (score_type: "MIDYEAR" | "FINAL", total_points: number, overall_grade: string, grade_label: string, appraisal_id = "a-1") => ({
  id: `s-${appraisal_id}-${score_type}`,
  appraisal_id,
  score_type,
  total_points,
  overall_grade,
  grade_label,
  check_in_id: score_type === "MIDYEAR" ? "ci-1" : null,
  is_management_track: false,
  calculated_at: "2026-07-01T00:00:00Z",
  inputs: {},
  components: [],
});

let db: FakeSupabase;
function seed(snapshots: Record<string, unknown>[], status = "COMPLETE") {
  db = new FakeSupabase({
    appraisals: [
      { id: "a-1", employee_id: "emp-1", manager_employee_id: "mgr-1", division_id: "d-1", status },
      { id: "a-2", employee_id: "emp-2", manager_employee_id: "mgr-2", division_id: "d-2", status },
    ],
    appraisal_score_snapshots: snapshots,
  });
  mocks.createClient.mockReturnValue(db);
}

const as = (user: Record<string, unknown>) => mocks.getCurrentUser.mockResolvedValue(user);
const get = async (id = "a-1") => {
  const res = await GET(new Request("http://localhost") as unknown as NextRequest, { params: Promise.resolve({ id }) });
  return { status: res.status, body: await res.json() };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://supabase.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  as({ id: "u-emp", roles: ["employee"], employee_id: "emp-1" });
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/appraisals/[id]/score-snapshots", () => {
  it("MIDYEAR only", async () => {
    seed([snap("MIDYEAR", 72.4, "C", "Good")], "SELF_ASSESSMENT");
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body).toMatchObject({ midyear: { total: 72.4, grade: "C", gradeLabel: "Good" }, final: null, change: null, official: null });
  });

  it("FINAL only", async () => {
    seed([snap("FINAL", 81.6, "B", "Very good")]);
    const { body } = await get();
    expect(body).toMatchObject({ midyear: null, final: { total: 81.6, grade: "B", gradeLabel: "Very good" }, change: null, official: "FINAL" });
  });

  it("both: Final is official and the change is shown, never an average", async () => {
    seed([snap("MIDYEAR", 72.4, "C", "Good"), snap("FINAL", 81.6, "B", "Very good")]);
    const { body } = await get();
    expect(body.final).toEqual({ total: 81.6, grade: "B", gradeLabel: "Very good" });
    expect(body.midyear).toEqual({ total: 72.4, grade: "C", gradeLabel: "Good" });
    expect(body.change).toBe(9.2);
    expect(body.official).toBe("FINAL");
    expect(JSON.stringify(body)).not.toContain("77");
  });

  it("returns only this appraisal's snapshots and writes nothing", async () => {
    seed([snap("FINAL", 81.6, "B", "Very good"), snap("MIDYEAR", 50, "D", "Fair", "a-2"), snap("FINAL", 55, "D", "Fair", "a-2")]);
    const { body } = await get();
    expect(body.midyear).toBeNull();
    expect(body.final.total).toBe(81.6);
    expect(db.writes).toEqual([]);
  });

  it.each(["SELF_ASSESSMENT", "MANAGER_REVIEW", "PENDING_SIGNOFF", "HR_REVIEW", "COMPLETE"])("Mid-Year stays visible in %s", async (status) => {
    seed([snap("MIDYEAR", 72.4, "C", "Good")], status);
    expect((await get()).body.midyear.total).toBe(72.4);
  });

  it.each([
    ["employee", { id: "u-emp", roles: ["employee"], employee_id: "emp-1" }, 200],
    ["manager", { id: "u-mgr", roles: ["manager"], employee_id: "mgr-1" }, 200],
    ["delegate", { id: "u-del", roles: ["manager"], employee_id: "del-1" }, 200],
    ["HR", { id: "u-hr", roles: ["hr"], employee_id: "hr-1" }, 200],
    ["GM of the division", { id: "u-gm", roles: ["gm"], employee_id: "gm-1", division_id: "d-1" }, 200],
    ["GM of another division", { id: "u-gm2", roles: ["gm"], employee_id: "gm-2", division_id: "d-9" }, 403],
    ["unrelated employee", { id: "u-x", roles: ["employee"], employee_id: "emp-9" }, 403],
  ])("access: %s → %s", async (_label, user, expected) => {
    seed([snap("MIDYEAR", 72.4, "C", "Good")]);
    as(user);
    const { status, body } = await get();
    expect(status).toBe(expected);
    if (expected === 403) expect(body.midyear).toBeUndefined();
  });

  it("401 without a session, 404 for an unknown appraisal", async () => {
    seed([]);
    mocks.getCurrentUser.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
    as({ id: "u-hr", roles: ["hr"], employee_id: "hr-1" });
    expect((await get("missing")).status).toBe(404);
  });
});
