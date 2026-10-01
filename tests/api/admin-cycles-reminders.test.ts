import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { FakeSupabase } from "../helpers/fake-supabase";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

import { POST } from "@/app/api/admin/cycles/route";
import { PATCH } from "@/app/api/admin/cycles/[cycleId]/route";

const HR = { id: "u-hr", roles: ["hr"], employee_id: "hr-1" };
const REMINDER_KEYS = ["reminder_days_before", "overdue_reminder_days", "final_review_notice_days"];
const DEFAULTS = { reminder_days_before: [7, 3, 1, 0], overdue_reminder_days: [1, 3, 7], final_review_notice_days: 30 };
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

const cycleWrites = () => db.writes.filter((w) => w.table === "appraisal_cycles");

/** Simulates the database before migration 0078: writing a reminder column fails. */
function withoutReminderColumns() {
  const realFrom = db.from.bind(db);
  const missing = { data: null, error: { code: "PGRST204", message: "Could not find the 'reminder_days_before' column of 'appraisal_cycles'" } };
  (db as unknown as { from: (t: string) => unknown }).from = (table: string) => {
    const query = realFrom(table) as unknown as Record<string, (...args: unknown[]) => unknown>;
    if (table !== "appraisal_cycles") return query;
    const failsOn = (row: unknown) => REMINDER_KEYS.some((k) => row && typeof row === "object" && k in row);
    const realInsert = query.insert.bind(query);
    const realUpdate = query.update.bind(query);
    query.insert = (row: unknown) =>
      failsOn(row) ? { select: () => ({ single: () => Promise.resolve(missing) }) } : realInsert(row);
    query.update = (row: unknown) => (failsOn(row) ? { eq: () => Promise.resolve(missing) } : realUpdate(row));
    return query;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://supabase.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
  mocks.getCurrentUser.mockResolvedValue(HR);
  seed();
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/admin/cycles — reminder settings", () => {
  it("writes no reminder columns for the default settings, so the column defaults apply", async () => {
    for (const body of [{}, DEFAULTS]) {
      seed();
      const res = await create(body);
      expect(res.status).toBe(200);
      expect(Object.keys(db.tables.appraisal_cycles[0]).filter((k) => REMINDER_KEYS.includes(k))).toEqual([]);
    }
  });

  it("stores custom settings, sorted, and only the ones that differ from the defaults", async () => {
    const res = await create({ reminder_days_before: [1, 14, 7], overdue_reminder_days: [1, 3, 7], final_review_notice_days: 21 });
    expect(res.status).toBe(200);
    const row = db.tables.appraisal_cycles[0];
    expect(row.reminder_days_before).toEqual([14, 7, 1]);
    expect(row.final_review_notice_days).toBe(21);
    expect("overdue_reminder_days" in row).toBe(false);
  });

  it.each([
    [{ reminder_days_before: [7, 7] }, /Due reminders/],
    [{ reminder_days_before: [1.5] }, /Due reminders/],
    [{ reminder_days_before: [61] }, /Due reminders/],
    [{ reminder_days_before: [-1] }, /Due reminders/],
    [{ reminder_days_before: [] }, /Due reminders/],
    [{ reminder_days_before: "7,3" }, /Due reminders/],
    [{ reminder_days_before: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }, /Due reminders/],
    [{ overdue_reminder_days: [0, 3] }, /Overdue reminders/],
    [{ overdue_reminder_days: ["3"] }, /Overdue reminders/],
    [{ final_review_notice_days: 0 }, /Final Review notice/],
    [{ final_review_notice_days: 91 }, /Final Review notice/],
    [{ final_review_notice_days: "30" }, /Final Review notice/],
  ])("rejects %j", async (body, message) => {
    const res = await create(body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(message);
    expect(db.tables.appraisal_cycles).toHaveLength(0);
  });

  it("explains when custom settings cannot be saved before migration 0078", async () => {
    withoutReminderColumns();
    const res = await create({ reminder_days_before: [5] });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Reminder settings can't be saved until database migration 0078 is applied.");
  });

  it("still creates a cycle with the default settings before migration 0078", async () => {
    withoutReminderColumns();
    const res = await create(DEFAULTS);
    expect(res.status).toBe(200);
    expect(db.tables.appraisal_cycles).toHaveLength(1);
  });
});

describe("PATCH /api/admin/cycles/[cycleId] — reminder settings", () => {
  it("does not write when the settings sent match what the cycle already uses", async () => {
    seed([{ ...OPEN_CYCLE }]);
    expect((await patch("c-1", DEFAULTS)).status).toBe(200);
    seed([{ ...OPEN_CYCLE, ...DEFAULTS, reminder_days_before: [10, 2] }]);
    expect((await patch("c-1", { ...DEFAULTS, reminder_days_before: [2, 10] })).status).toBe(200);
    expect(cycleWrites()).toEqual([]);
  });

  it("writes only the changed settings, sorted", async () => {
    seed([{ ...OPEN_CYCLE, ...DEFAULTS }]);
    const res = await patch("c-1", { ...DEFAULTS, overdue_reminder_days: [5, 2], final_review_notice_days: 14 });
    expect(res.status).toBe(200);
    expect(db.tables.appraisal_cycles[0]).toMatchObject({
      reminder_days_before: [7, 3, 1, 0],
      overdue_reminder_days: [2, 5],
      final_review_notice_days: 14,
      status: "open",
    });
  });

  it("can change reminder settings alongside unchanged Mid-Year settings, as the cycle modal sends both", async () => {
    seed([{ ...OPEN_CYCLE, midyear_review_enabled: true, midyear_window_start: "2026-06-01", midyear_due_date: "2026-06-30" }]);
    const res = await patch("c-1", {
      midyear_review_enabled: true,
      midyear_scoring_enabled: false,
      midyear_window_start: "2026-06-01",
      midyear_due_date: "2026-06-30",
      ...DEFAULTS,
      reminder_days_before: [5],
    });
    expect(res.status).toBe(200);
    expect(db.tables.appraisal_cycles[0]).toMatchObject({
      midyear_review_enabled: true,
      midyear_due_date: "2026-06-30",
      reminder_days_before: [5],
    });
  });

  it("rejects invalid settings without writing", async () => {
    seed([{ ...OPEN_CYCLE }]);
    for (const body of [{ reminder_days_before: [3, 3] }, { overdue_reminder_days: [0] }, { final_review_notice_days: 1.5 }]) {
      expect((await patch("c-1", body)).status).toBe(400);
    }
    expect(cycleWrites()).toEqual([]);
  });

  it.each(["closed", "archived"])("rejects reminder changes on a %s cycle but accepts unchanged values", async (status) => {
    seed([{ ...OPEN_CYCLE, status }]);
    const res = await patch("c-1", { reminder_days_before: [5] });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(`Reminder settings cannot be changed on a ${status} cycle.`);
    expect((await patch("c-1", DEFAULTS)).status).toBe(200);
    expect(cycleWrites()).toEqual([]);
  });

  it("returns 404 for an unknown cycle", async () => {
    seed([]);
    expect((await patch("missing", { reminder_days_before: [5] })).status).toBe(404);
  });

  it("explains when custom settings cannot be saved before migration 0078", async () => {
    seed([{ ...OPEN_CYCLE }]);
    withoutReminderColumns();
    const res = await patch("c-1", { reminder_days_before: [5] });
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Reminder settings can't be saved until database migration 0078 is applied.");
  });

  it("status-only updates behave as before", async () => {
    seed([{ ...OPEN_CYCLE }]);
    const res = await patch("c-1", { status: "closed" });
    expect(res.status).toBe(200);
    expect(db.tables.appraisal_cycles[0].status).toBe("closed");
    expect(Object.keys(db.tables.appraisal_cycles[0]).filter((k) => REMINDER_KEYS.includes(k))).toEqual([]);
  });

  it("is limited to HR/admin", async () => {
    mocks.getCurrentUser.mockResolvedValue({ id: "u-mgr", roles: ["manager"], employee_id: "mgr-1" });
    seed([{ ...OPEN_CYCLE }]);
    expect((await patch("c-1", { reminder_days_before: [5] })).status).toBe(403);
    expect(cycleWrites()).toEqual([]);
  });
});
