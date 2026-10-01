import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "../helpers/fake-supabase";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  createClient: vi.fn(),
  transitionStatus: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/appraisal-workflow", () => ({ transitionStatus: mocks.transitionStatus }));
vi.mock("@/lib/appraisal-test-bypass", () => ({ allowAppraisalTestBypass: () => false }));

import { POST } from "@/app/api/appraisals/[id]/start-self-assessment/route";

const EMPLOYEE = { id: "u-emp", roles: ["employee"], employee_id: "emp-1" };
let db: FakeSupabase;

function seed(midyearEnabled: boolean, checkIns: Array<{ review_mode: string; status: string }> = [], appraisalStatus = "IN_PROGRESS") {
  db = new FakeSupabase({
    appraisals: [{ id: "a-1", employee_id: "emp-1", cycle_id: "c-1", status: appraisalStatus }],
    appraisal_cycles: [
      {
        id: "c-1",
        fiscal_year: "2026",
        midyear_review_enabled: midyearEnabled,
        midyear_scoring_enabled: false,
        midyear_window_start: null,
        midyear_due_date: null,
      },
    ],
    check_ins: checkIns.map((c, i) => ({ id: `ci-${i}`, appraisal_id: "a-1", check_in_type: "MIDYEAR", ...c })),
  });
  mocks.createClient.mockReturnValue(db);
}

const start = () => POST(new Request("http://localhost", { method: "POST" }), { params: Promise.resolve({ id: "a-1" }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://supabase.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  mocks.getCurrentUser.mockResolvedValue(EMPLOYEE);
  mocks.transitionStatus.mockResolvedValue({ error: null });
});

afterEach(() => vi.unstubAllEnvs());

describe("Start Self Assessment and the Mid-Year Review", () => {
  it("is unchanged when Mid-Year Review is disabled for the cycle", async () => {
    seed(false);
    const res = await start();
    expect(res.status).toBe(200);
    expect(mocks.transitionStatus).toHaveBeenCalledWith(db, "a-1", "SELF_ASSESSMENT", "u-emp", "Start self-assessment");
  });

  it("is unchanged when disabled even if an unfinished formal review exists", async () => {
    seed(false, [{ review_mode: "FORMAL", status: "OPEN" }]);
    expect((await start()).status).toBe(200);
  });

  it("is blocked when enabled and no formal review exists", async () => {
    seed(true);
    const res = await start();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("A completed Mid-Year Review is required for this cycle before self-assessment can start.");
    expect(mocks.transitionStatus).not.toHaveBeenCalled();
  });

  it.each(["OPEN", "EMPLOYEE_SUBMITTED", "MANAGER_REVIEWED"])("is blocked when enabled and the formal review is %s", async (status) => {
    seed(true, [{ review_mode: "FORMAL_SCORED", status }]);
    const res = await start();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Complete the Mid-Year Review before starting self-assessment.");
    expect(mocks.transitionStatus).not.toHaveBeenCalled();
  });

  it("is blocked when only a cancelled formal review or an informal Mid-Year check-in exists", async () => {
    seed(true, [
      { review_mode: "FORMAL", status: "CANCELLED" },
      { review_mode: "INFORMAL", status: "COMPLETE" },
    ]);
    expect((await start()).status).toBe(409);
  });

  it("proceeds when enabled and the formal review is COMPLETE", async () => {
    seed(true, [
      { review_mode: "FORMAL", status: "CANCELLED" },
      { review_mode: "FORMAL", status: "COMPLETE" },
    ]);
    expect((await start()).status).toBe(200);
    expect(mocks.transitionStatus).toHaveBeenCalledTimes(1);
  });

  it("keeps the existing status and employee checks ahead of the Mid-Year check", async () => {
    seed(true, [], "DRAFT");
    expect((await start()).status).toBe(400);
    seed(true);
    mocks.getCurrentUser.mockResolvedValue({ id: "u-mgr", roles: ["manager"], employee_id: "mgr-1" });
    expect((await start()).status).toBe(403);
  });
});
