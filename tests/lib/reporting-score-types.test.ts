import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "../helpers/fake-supabase";

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));

vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/dynamics-divisions", () => ({ resolveDivisionNames: vi.fn(async () => new Map([["d-1", "Finance"]])) }));
vi.mock("@/lib/reporting-structure", () => ({ getReportingStructureFromDynamics: vi.fn(async () => ({ employee_id: "mgr-1" })) }));
vi.mock("@/lib/dynamics-org-service", () => ({
  getDirectReports: vi.fn(async () => ["emp-1", "emp-2", "emp-3", "emp-4"].map((id) => ({ _xrm1_employee_user_id_value: id, xrm1_fullname: id }))),
}));

import { loadOfficialScores } from "@/lib/official-scores";
import { getHRAnalyticsData } from "@/lib/hr-analytics-data";
import { getHRTrendsData } from "@/lib/hr-trends-data";
import { fetchHrDashboardStats } from "@/lib/dashboard-hr-stats";
import { fetchManagerDashboardStats } from "@/lib/dashboard-manager-stats";
import { getMidyearReportData, midyearCompletionState } from "@/lib/midyear-report-data";
import type { AuthUser } from "@/lib/auth";

const snap = (appraisal_id: string, score_type: "MIDYEAR" | "FINAL", total_points: number, overall_grade = "C") => ({
  id: `s-${appraisal_id}-${score_type}`,
  appraisal_id,
  score_type,
  total_points,
  overall_grade,
  grade_label: "Label",
  check_in_id: score_type === "MIDYEAR" ? `ci-${appraisal_id}` : null,
  is_management_track: false,
  calculated_at: "2026-07-01T00:00:00Z",
});

/**
 * a-1: FINAL 85 (legacy 40 and MIDYEAR 30 must be ignored)
 * a-2: legacy 65 only (MIDYEAR 95 must be ignored)
 * a-3: MIDYEAR 50 only → no official score
 * a-4: FINAL 92, no legacy
 */
function seed(status = "closed") {
  const db = new FakeSupabase({
    appraisals: ["a-1", "a-2", "a-3", "a-4"].map((id, i) => ({
      id,
      employee_id: `emp-${i + 1}`,
      cycle_id: "c-1",
      division_id: "d-1",
      status,
      is_active: true,
      updated_at: "2026-09-01",
      manager_completed_at: "2026-09-01",
    })),
    appraisal_cycles: [{ id: "c-1", name: "FY 2026", end_date: "2027-03-31", status: "open", midyear_review_enabled: true }],
    employees: ["emp-1", "emp-2", "emp-3", "emp-4"].map((id) => ({
      employee_id: id,
      full_name: `Name ${id}`,
      division_id: "d-1",
      division_name: "Finance",
      department_id: "dep-1",
      department_name: "Dept",
      is_active: true,
    })),
    appraisal_section_scores: [
      { appraisal_id: "a-1", total_score: 40 },
      { appraisal_id: "a-2", total_score: 65 },
    ],
    appraisal_score_snapshots: [
      snap("a-1", "FINAL", 85, "B"),
      snap("a-1", "MIDYEAR", 30, "E"),
      snap("a-2", "MIDYEAR", 95, "A"),
      snap("a-3", "MIDYEAR", 50, "D"),
      snap("a-4", "FINAL", 92, "A"),
    ],
    appraisal_recommendations: [],
    appraisal_timeline: [],
    feedback_cycle: [],
    check_ins: [],
  });
  mocks.createClient.mockReturnValue(db);
  return db;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://supabase.test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
});
afterEach(() => vi.unstubAllEnvs());

describe("loadOfficialScores", () => {
  it("uses FINAL where available, legacy otherwise, never MIDYEAR; one entry per appraisal", async () => {
    const db = seed();
    const scores = await loadOfficialScores(db as never, ["a-1", "a-2", "a-3", "a-4", "a-1"]);
    expect([...scores.values()]).toEqual([
      { appraisalId: "a-1", total: 85, source: "FINAL_SNAPSHOT" },
      { appraisalId: "a-4", total: 92, source: "FINAL_SNAPSHOT" },
      { appraisalId: "a-2", total: 65, source: "LEGACY_SECTION_SCORES" },
    ]);
    expect(scores.has("a-3")).toBe(false);
  });

  it("a duplicated legacy row still yields one score", async () => {
    const db = seed();
    db.tables.appraisal_section_scores.push({ appraisal_id: "a-2", total_score: 10 });
    const scores = await loadOfficialScores(db as never, ["a-2"]);
    expect(scores.size).toBe(1);
    expect(scores.get("a-2")!.total).toBe(65);
  });

  it("falls back to legacy scores when snapshots cannot be read (table not yet migrated)", async () => {
    const db = seed();
    const realFrom = db.from.bind(db);
    vi.spyOn(db, "from").mockImplementation((table: string) => {
      if (table === "appraisal_score_snapshots") {
        const q = realFrom(table);
        (q as unknown as { then: unknown }).then = (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: null, error: { message: 'relation "appraisal_score_snapshots" does not exist' } }).then(resolve);
        return q;
      }
      return realFrom(table);
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const scores = await loadOfficialScores(db as never, ["a-1", "a-2"]);
    expect([...scores.values()].map((s) => [s.appraisalId, s.total, s.source])).toEqual([
      ["a-1", 40, "LEGACY_SECTION_SCORES"],
      ["a-2", 65, "LEGACY_SECTION_SCORES"],
    ]);
    warn.mockRestore();
  });
});

describe("final dashboards use FINAL only (migrated readers)", () => {
  it("HR analytics: distribution, divisions and rankings", async () => {
    seed();
    const data = await getHRAnalyticsData();
    expect(data.scoreDistribution).toEqual([
      { band: "0-60", count: 0 },
      { band: "60-70", count: 1 },
      { band: "70-80", count: 0 },
      { band: "80-90", count: 1 },
      { band: "90-100", count: 1 },
    ]);
    expect(data.scoreDistribution.reduce((n, b) => n + b.count, 0)).toBe(3);
    expect(data.divisionPerformance).toEqual([{ divisionId: "d-1", divisionName: "Finance", avgScore: 80.7, count: 3 }]);
    expect(data.topPerformers.map((r) => r.totalScore)).toEqual([92, 85, 65]);
  });

  it("HR trends: cycle and division averages", async () => {
    seed();
    const data = await getHRTrendsData();
    expect(data.employeeScoreTrend).toEqual([
      { cycleId: "c-1", cycleName: "FY 2026", endDate: "2027-03-31", avgScore: 80.7, appraisalCount: 4 },
    ]);
    expect(data.divisionPerformanceTrend).toEqual([
      expect.objectContaining({ divisionId: "d-1", avgScore: 80.7, count: 3 }),
    ]);
  });

  it("HR dashboard: distribution, mean and division breakdown", async () => {
    seed("COMPLETE");
    const stats = await fetchHrDashboardStats();
    const counted = Object.fromEntries(stats.score_distribution.filter((b) => b.count > 0).map((b) => [b.label, b.count]));
    expect(counted).toEqual({ "60": 1, "80": 1, "90+": 1 });
    expect(stats.mean_score).toBe(80.7);
    expect(stats.division_breakdown).toEqual([expect.objectContaining({ division: "Finance", employees: 4, avgScore: 80.7 })]);
  });

  it("manager dashboard: each direct report shows the official score", async () => {
    seed("COMPLETE");
    const stats = await fetchManagerDashboardStats({ employee_id: "mgr-1", email: "m@x", roles: ["manager"] } as unknown as AuthUser);
    expect(Object.fromEntries(stats.direct_reports.map((r) => [r.appraisal_id, r.total_score]))).toEqual({
      "a-1": 85,
      "a-2": 65,
      "a-3": null,
      "a-4": 92,
    });
  });
});

describe("Mid-Year reporting uses MIDYEAR only", () => {
  it("distribution and grades come from MIDYEAR snapshots; each appraisal once", async () => {
    const db = seed("SELF_ASSESSMENT");
    const data = await getMidyearReportData(db as never);
    expect(data.appraisalCount).toBe(4);
    expect(data.scoredCount).toBe(3);
    expect(data.distribution).toEqual([
      { band: "0-60", count: 2 },
      { band: "60-70", count: 0 },
      { band: "70-80", count: 0 },
      { band: "80-90", count: 0 },
      { band: "90-100", count: 1 },
    ]);
    expect(data.gradeDistribution).toEqual({ E: 1, A: 1, D: 1 });
    expect(data.meanMidyear).toBe(58.3);
  });

  it("Mid-Year vs Final pairs each appraisal's own MIDYEAR and FINAL once", async () => {
    const db = seed("COMPLETE");
    const data = await getMidyearReportData(db as never);
    expect(data.change.rows).toEqual([
      expect.objectContaining({ appraisalId: "a-1", midyear: 30, final: 85, change: 55, employeeName: "Name emp-1" }),
    ]);
    expect(data.change).toMatchObject({ improved: 1, declined: 0, unchanged: 0, meanChange: 55 });
  });

  it("completion status counts each appraisal exactly once", async () => {
    const db = seed("IN_PROGRESS");
    db.tables.check_ins.push(
      { id: "x1", appraisal_id: "a-1", review_mode: "FORMAL_SCORED", status: "CANCELLED", created_at: 1 },
      { id: "x2", appraisal_id: "a-1", review_mode: "FORMAL_SCORED", status: "COMPLETE", created_at: 2 },
      { id: "x3", appraisal_id: "a-2", review_mode: "FORMAL", status: "EMPLOYEE_SUBMITTED", created_at: 3 },
      { id: "x4", appraisal_id: "a-3", review_mode: "FORMAL_SCORED", status: "CANCELLED", created_at: 4 },
      { id: "x5", appraisal_id: "a-4", review_mode: "INFORMAL", status: "OPEN", created_at: 5 }
    );
    const data = await getMidyearReportData(db as never);
    expect(data.completion).toEqual({ NOT_STARTED: 1, OPEN: 0, EMPLOYEE_SUBMITTED: 1, MANAGER_REVIEWED: 0, COMPLETE: 1, CANCELLED: 1 });
    expect(Object.values(data.completion).reduce((a, b) => a + b, 0)).toBe(data.appraisalCount);
  });

  it("excludes cancelled appraisals and cycles without Mid-Year", async () => {
    const db = seed("IN_PROGRESS");
    db.tables.appraisals[0].status = "CANCELLED";
    expect((await getMidyearReportData(db as never)).appraisalCount).toBe(3);
    db.tables.appraisal_cycles[0].midyear_review_enabled = false;
    expect((await getMidyearReportData(db as never)).appraisalCount).toBe(0);
  });

  it("completion state helper", () => {
    expect(midyearCompletionState([])).toBe("NOT_STARTED");
    expect(midyearCompletionState([{ status: "CANCELLED" }])).toBe("CANCELLED");
    expect(midyearCompletionState([{ status: "CANCELLED" }, { status: "OPEN" }])).toBe("OPEN");
  });

  it("MIDYEAR never leaks into official reporting and FINAL never into the Mid-Year distribution", async () => {
    const db = seed("COMPLETE");
    const official = await loadOfficialScores(db as never, ["a-1", "a-2", "a-3", "a-4"]);
    const midyear = await getMidyearReportData(db as never);
    expect([...official.values()].map((s) => s.total)).not.toContain(30);
    expect([...official.values()].map((s) => s.total)).not.toContain(95);
    expect(midyear.distribution.find((b) => b.band === "80-90")!.count).toBe(0);
  });
});
