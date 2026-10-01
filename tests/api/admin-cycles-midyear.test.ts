import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { FakeSupabase } from "../helpers/fake-supabase";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

import { GET, POST } from "@/app/api/admin/cycles/route";
import { PATCH } from "@/app/api/admin/cycles/[cycleId]/route";

const HR = { id: "u-hr", roles: ["hr"], employee_id: "hr-1" };
let db: FakeSupabase;

function seed(cycles: Record<string, unknown>[] = []) {
  db = new FakeSupabase({ appraisal_cycles: cycles, cycle_review_types: [], feedback_cycle: [] });
  mocks.createClient.mockReturnValue(db);
}

const req = (body: unknown) =>
  new Request("http://localhost/api/admin/cycles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;

const create = (extra: Record<string, unknown> = {}) =>
  POST(req({ fiscal_year: "2026", start_date: "2026-01-01", end_date: "2026-12-31", ...extra }));

const patch = (cycleId: string, body: unknown) => PATCH(req(body), { params: Promise.resolve({ cycleId }) });

const OPEN_CYCLE = {
  id: "c-1",
  name: "FY 2026",
  fiscal_year: "2026",
  status: "open",
  end_date: "2026-12-31",
  midyear_review_enabled: false,
  midyear_scoring_enabled: false,
  midyear_window_start: null,
  midyear_due_date: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://supabase.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  mocks.getCurrentUser.mockResolvedValue(HR);
  seed();
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/admin/cycles — Mid-Year settings", () => {
  it("defaults to off: no Mid-Year columns are written, so the column defaults apply", async () => {
    const res = await create();
    expect(res.status).toBe(200);
    const row = db.tables.appraisal_cycles[0];
    expect(Object.keys(row).filter((k) => k.startsWith("midyear_"))).toEqual([]);
  });

  it("stores enabled settings", async () => {
    const res = await create({
      midyear_review_enabled: true,
      midyear_scoring_enabled: true,
      midyear_window_start: "2026-06-01",
      midyear_due_date: "2026-06-30",
    });
    expect(res.status).toBe(200);
    expect(db.tables.appraisal_cycles[0]).toMatchObject({
      midyear_review_enabled: true,
      midyear_scoring_enabled: true,
      midyear_window_start: "2026-06-01",
      midyear_due_date: "2026-06-30",
    });
  });

  it("rejects scoring while the review is off", async () => {
    const res = await create({ midyear_review_enabled: false, midyear_scoring_enabled: true });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/scoring cannot be enabled/);
    expect(db.tables.appraisal_cycles).toHaveLength(0);
  });

  it("rejects a due date before the window start", async () => {
    const res = await create({ midyear_review_enabled: true, midyear_window_start: "2026-07-01", midyear_due_date: "2026-06-01" });
    expect(res.status).toBe(400);
    expect(db.tables.appraisal_cycles).toHaveLength(0);
  });
});

describe("PATCH /api/admin/cycles/[cycleId] — partial update", () => {
  it("round-trips Mid-Year settings through GET", async () => {
    seed([{ ...OPEN_CYCLE }]);
    const res = await patch("c-1", {
      midyear_review_enabled: true,
      midyear_scoring_enabled: true,
      midyear_window_start: "2026-06-01",
      midyear_due_date: "2026-06-30",
    });
    expect(res.status).toBe(200);
    const list = await (await GET()).json();
    expect(list[0]).toMatchObject({
      midyear_review_enabled: true,
      midyear_scoring_enabled: true,
      midyear_window_start: "2026-06-01",
      midyear_due_date: "2026-06-30",
      status: "open",
    });
  });

  it("changes only the fields sent", async () => {
    seed([{ ...OPEN_CYCLE, midyear_review_enabled: true, midyear_scoring_enabled: true, midyear_window_start: "2026-06-01", midyear_due_date: "2026-06-30" }]);
    await patch("c-1", { midyear_due_date: "2026-07-10" });
    expect(db.tables.appraisal_cycles[0]).toMatchObject({
      midyear_review_enabled: true,
      midyear_scoring_enabled: true,
      midyear_window_start: "2026-06-01",
      midyear_due_date: "2026-07-10",
      status: "open",
    });
  });

  it("turning the review off turns scoring off", async () => {
    seed([{ ...OPEN_CYCLE, midyear_review_enabled: true, midyear_scoring_enabled: true }]);
    const res = await patch("c-1", { midyear_review_enabled: false });
    expect(res.status).toBe(200);
    expect(db.tables.appraisal_cycles[0]).toMatchObject({ midyear_review_enabled: false, midyear_scoring_enabled: false });
  });

  it("rejects scoring on while the stored review is off", async () => {
    seed([{ ...OPEN_CYCLE }]);
    const res = await patch("c-1", { midyear_scoring_enabled: true });
    expect(res.status).toBe(400);
    expect(db.tables.appraisal_cycles[0].midyear_scoring_enabled).toBe(false);
  });

  it.each(["closed", "archived"])("rejects Mid-Year changes on a %s cycle", async (status) => {
    seed([{ ...OPEN_CYCLE, status }]);
    const res = await patch("c-1", { midyear_review_enabled: true });
    expect(res.status).toBe(409);
    expect(db.tables.appraisal_cycles[0].midyear_review_enabled).toBe(false);
  });

  it("status-only updates behave as before", async () => {
    seed([{ ...OPEN_CYCLE }]);
    const res = await patch("c-1", { status: "closed" });
    expect(res.status).toBe(200);
    expect(db.tables.appraisal_cycles[0]).toMatchObject({ status: "closed", midyear_review_enabled: false });
  });

  it("still requires something to update", async () => {
    seed([{ ...OPEN_CYCLE }]);
    const res = await patch("c-1", { fiscal_year: "2027" });
    expect(res.status).toBe(400);
    expect(db.tables.appraisal_cycles[0].fiscal_year).toBe("2026");
  });

  it("returns 404 for an unknown cycle", async () => {
    seed([]);
    const res = await patch("missing", { midyear_review_enabled: true });
    expect(res.status).toBe(404);
  });

  it("is limited to HR/admin", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: "u-mgr", roles: ["manager"], employee_id: "mgr-1" });
    seed([{ ...OPEN_CYCLE }]);
    const res = await patch("c-1", { midyear_review_enabled: true });
    expect(res.status).toBe(403);
  });
});
