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
vi.mock("@/lib/notifications", () => ({ sendEmail: vi.fn().mockResolvedValue(undefined) }));

import { GET, POST } from "@/app/api/appraisals/[id]/checkins/route";

const APPRAISAL_ID = "a-1";
const MANAGER = { id: "u-mgr", roles: ["manager"], employee_id: "mgr-1" };
let db: FakeSupabase;

type CycleSettings = Partial<{
  midyear_review_enabled: boolean;
  midyear_scoring_enabled: boolean;
  midyear_window_start: string | null;
  midyear_due_date: string | null;
}>;

function seed(cycle: CycleSettings = {}, checkIns: Record<string, unknown>[] = []) {
  db = new FakeSupabase({
    appraisals: [
      { id: APPRAISAL_ID, employee_id: "emp-1", manager_employee_id: "mgr-1", division_id: "d-1", cycle_id: "c-1", status: "IN_PROGRESS" },
    ],
    appraisal_cycles: [{ id: "c-1", name: "FY 2026", fiscal_year: "2026", ...cycle }],
    employees: [
      { id: "e-uuid-emp", employee_id: "emp-1", full_name: "Employee" },
      { id: "e-uuid-mgr", employee_id: "mgr-1", full_name: "Manager" },
    ],
    workplans: [{ id: "wp-1", appraisal_id: APPRAISAL_ID, status: "approved" }],
    workplan_items: [{ id: "wi-1", workplan_id: "wp-1", major_task: "Task", weight: 100, created_at: 1 }],
    check_ins: checkIns,
    check_in_responses: [],
    appraisal_audit: [],
  });
  mocks.createClient.mockReturnValue(db);
}

const ctx = { params: Promise.resolve({ id: APPRAISAL_ID }) };
const get = () => GET(new Request("http://localhost") as unknown as NextRequest, ctx);
const post = (body: Record<string, unknown>) =>
  POST(
    new Request("http://localhost", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }) as unknown as NextRequest,
    { params: Promise.resolve({ id: APPRAISAL_ID }) }
  );

const ENABLED: CycleSettings = {
  midyear_review_enabled: true,
  midyear_scoring_enabled: false,
  midyear_window_start: "2026-06-01",
  midyear_due_date: "2026-06-30",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://supabase.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  mocks.getCurrentUser.mockResolvedValue(MANAGER);
});

afterEach(() => vi.unstubAllEnvs());

describe("GET /api/appraisals/[id]/checkins — midyear", () => {
  it("is off when the cycle has no Mid-Year settings", async () => {
    seed();
    const body = await (await get()).json();
    expect(body.midyear).toEqual({ enabled: false, scoringEnabled: false, windowStart: null, dueDate: null });
    expect(body.appraisal.cycleLabel).toBe("FY 2026 · FY 2026");
  });

  it("returns the cycle settings", async () => {
    seed({ ...ENABLED, midyear_scoring_enabled: true });
    const body = await (await get()).json();
    expect(body.midyear).toEqual({ enabled: true, scoringEnabled: true, windowStart: "2026-06-01", dueDate: "2026-06-30" });
    expect(body.appraisal.fiscalYear).toBe("2026");
  });
});

describe("POST /api/appraisals/[id]/checkins — review mode", () => {
  it("Mid-Year in a cycle without formal review stays informal, exactly as before", async () => {
    seed();
    const res = await post({ title: "Mid-year check-in", check_in_type: "MIDYEAR", due_date: "2026-07-01" });
    expect(res.status).toBe(200);
    const row = db.tables.check_ins[0];
    expect(row).toMatchObject({ title: "Mid-year check-in", check_in_type: "MIDYEAR", due_date: "2026-07-01" });
    expect("review_mode" in row).toBe(false);
    expect((await res.json()).checkIn.review_mode).toBe("INFORMAL");
  });

  it("rejects a formal Mid-Year request when the cycle has formal review off", async () => {
    seed();
    const res = await post({ check_in_type: "MIDYEAR", review_mode: "FORMAL" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/not enabled/);
    expect(db.tables.check_ins).toHaveLength(0);
  });

  it("enabled + scoring off → FORMAL, with title and due date from the cycle", async () => {
    seed(ENABLED);
    const res = await post({ check_in_type: "MIDYEAR", title: "typed by manager", due_date: "2026-12-01" });
    expect(res.status).toBe(200);
    expect(db.tables.check_ins[0]).toMatchObject({
      review_mode: "FORMAL",
      title: "Mid-Year Review – 2026",
      due_date: "2026-06-30",
      status: "OPEN",
    });
  });

  it("enabled + scoring on → FORMAL_SCORED", async () => {
    seed({ ...ENABLED, midyear_scoring_enabled: true });
    const res = await post({ check_in_type: "MIDYEAR" });
    expect(res.status).toBe(200);
    expect(db.tables.check_ins[0]).toMatchObject({ review_mode: "FORMAL_SCORED", title: "Mid-Year Review – 2026" });
  });

  it("uses the manager's due date when the cycle has none", async () => {
    seed({ ...ENABLED, midyear_due_date: null });
    await post({ check_in_type: "MIDYEAR", due_date: "2026-07-15" });
    expect(db.tables.check_ins[0]).toMatchObject({ review_mode: "FORMAL", due_date: "2026-07-15" });
  });

  it.each(["QUARTERLY", "ADHOC"])("%s stays informal even when formal Mid-Year is on", async (type) => {
    seed({ ...ENABLED, midyear_scoring_enabled: true });
    const res = await post({ title: "Progress", check_in_type: type, review_mode: "FORMAL_SCORED" });
    expect(res.status).toBe(200);
    const row = db.tables.check_ins[0];
    expect(row).toMatchObject({ title: "Progress", check_in_type: type });
    expect("review_mode" in row).toBe(false);
  });

  it("Quarterly/Ad hoc still require a title", async () => {
    seed(ENABLED);
    const res = await post({ check_in_type: "QUARTERLY" });
    expect(res.status).toBe(400);
  });

  it("allows only one formal Mid-Year Review per appraisal", async () => {
    seed(ENABLED, [{ id: "ci-1", appraisal_id: APPRAISAL_ID, check_in_type: "MIDYEAR", review_mode: "FORMAL", status: "COMPLETE" }]);
    const res = await post({ check_in_type: "MIDYEAR" });
    expect(res.status).toBe(409);
    expect(db.tables.check_ins).toHaveLength(1);
  });

  it("a cancelled formal Mid-Year Review does not block a new one", async () => {
    seed(ENABLED, [{ id: "ci-1", appraisal_id: APPRAISAL_ID, check_in_type: "MIDYEAR", review_mode: "FORMAL", status: "CANCELLED" }]);
    const res = await post({ check_in_type: "MIDYEAR" });
    expect(res.status).toBe(200);
  });

  it("leaves the appraisal IN_PROGRESS", async () => {
    seed({ ...ENABLED, midyear_scoring_enabled: true });
    await post({ check_in_type: "MIDYEAR" });
    expect(db.tables.appraisals[0].status).toBe("IN_PROGRESS");
  });

  it("still only creates check-ins while IN_PROGRESS", async () => {
    seed(ENABLED);
    db.tables.appraisals[0].status = "SELF_ASSESSMENT";
    const res = await post({ check_in_type: "MIDYEAR" });
    expect(res.status).toBe(400);
    expect(db.tables.check_ins).toHaveLength(0);
  });
});
