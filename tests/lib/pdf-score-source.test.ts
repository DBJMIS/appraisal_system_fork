import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FakeSupabase } from "../helpers/fake-supabase";

const mocks = vi.hoisted(() => ({
  getReportingStructureFromDynamics: vi.fn(),
  getReportingStructure: vi.fn(),
}));

vi.mock("@/lib/reporting-structure", () => ({
  getReportingStructureFromDynamics: mocks.getReportingStructureFromDynamics,
  getReportingStructure: mocks.getReportingStructure,
}));
vi.mock("@/lib/dynamics-org-service", async (orig) => ({ ...(await orig<object>()), ...(await import("../helpers/fake-dynamics-org")).fakeDynamicsOrg }));

import { fakeHr } from "../helpers/fake-dynamics-org";
import { fetchAppraisalPDFData } from "@/lib/pdf/fetch-appraisal-pdf-data";
import { buildScoreSnapshotRow } from "@/lib/appraisal-score-snapshot";
import { calcSummary, GRADE_BANDS } from "@/lib/summary-calc";
import { buildSummaryInput } from "@/lib/appraisal-summary-input";

const APPRAISAL_ID = "a-1";

function seed(isManagement: boolean): FakeSupabase {
  return new FakeSupabase({
    appraisals: [
      { id: APPRAISAL_ID, employee_id: "emp-1", manager_employee_id: "mgr-1", cycle_id: "c-1", is_management: isManagement },
    ],
    employees: [
      { employee_id: "emp-1", full_name: "Employee", job_title: null, division_name: null, department_name: null },
      { employee_id: "mgr-1", full_name: "Manager", job_title: null },
    ],
    appraisal_cycles: [{ id: "c-1", name: "FY", start_date: null, end_date: null, fiscal_year: "2026" }],
    app_users: [],
    workplans: [{ id: "wp-1", appraisal_id: APPRAISAL_ID }],
    workplan_items: [
      { workplan_id: "wp-1", weight: 60, actual_result: 80, mgr_result: 90, points: 48, created_at: 1 },
      { workplan_id: "wp-1", weight: 40, actual_result: 70, mgr_result: null, points: 28, created_at: 2 },
    ],
    evaluation_categories: [
      { id: "cat-core", category_type: "core", active: true },
      { id: "cat-prod", category_type: "productivity", active: true },
      { id: "cat-lead", category_type: "leadership", active: true },
    ],
    evaluation_factors: [
      { id: "f-core", category_id: "cat-core", weight: 100, active: true, name: "Core", description: null, display_order: 1 },
      { id: "f-prod", category_id: "cat-prod", weight: 100, active: true, name: "Prod", description: null, display_order: 1 },
      { id: "f-lead", category_id: "cat-lead", weight: 100, active: true, name: "Lead", description: null, display_order: 1 },
    ],
    appraisal_factor_ratings: [
      { appraisal_id: APPRAISAL_ID, factor_id: "f-core", self_rating_code: "7", manager_rating_code: "9", weight: 100 },
      { appraisal_id: APPRAISAL_ID, factor_id: "f-prod", self_rating_code: "6", manager_rating_code: null, weight: 100 },
      { appraisal_id: APPRAISAL_ID, factor_id: "f-lead", self_rating_code: "8", manager_rating_code: "5", weight: 100 },
    ],
    appraisal_technical_competencies: [
      { appraisal_id: APPRAISAL_ID, name: "Tech", self_rating: "7", manager_rating: "8", weight: 100, display_order: 1 },
    ],
    appraisal_hr_recommendations: [],
  });
}

function reportingStructure(directReports: number) {
  mocks.getReportingStructureFromDynamics.mockResolvedValue({
    directReports: Array.from({ length: directReports }, (_, i) => ({ employee_id: `r-${i}` })),
    currentUserProfile: null,
  });
  fakeHr.directReports["emp-1"] = directReports;
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeHr.reset();
});

describe("PDF score source", () => {
  it.each([
    ["non-management", false, 0, false],
    ["management flag", true, 0, true],
    ["direct reports from Dynamics", false, 2, true],
  ])("%s: the stored snapshot equals the scores printed in the PDF", async (_label, isManagement, reports, expectedTrack) => {
    reportingStructure(reports);
    const db = seed(isManagement);
    const data = await fetchAppraisalPDFData(APPRAISAL_ID, db as unknown as SupabaseClient);

    expect(data.scoreSource).not.toBeNull();
    const source = data.scoreSource!;
    expect(source.isManagementTrack).toBe(expectedTrack);
    expect(source.isManagementTrack).toBe(data.appraisal.showLeadership);

    expect(data.scores.overall).toBe(source.result.totalPoints);
    expect(data.scores.ratingLabel).toBe(GRADE_BANDS[source.result.overallGrade].label);
    expect(data.summaryComponents).toEqual(
      source.result.components.map((c) => ({ key: c.key, name: c.name, weight: c.weight, points: c.points }))
    );

    const expectedInput = await buildSummaryInput(APPRAISAL_ID, db as unknown as SupabaseClient, {
      showLeadership: expectedTrack,
    });
    expect(source.input).toEqual(expectedInput);
    expect(source.result).toEqual(calcSummary(expectedInput));

    const row = buildScoreSnapshotRow({
      appraisalId: APPRAISAL_ID,
      scoreType: "FINAL",
      isManagementTrack: source.isManagementTrack,
      input: source.input,
      result: source.result,
      actor: "u-mgr",
    });
    expect(row.total_points).toBe(data.scores.overall);
    expect(row.grade_label).toBe(data.scores.ratingLabel);
    const printed = Object.fromEntries(data.summaryComponents.map((c) => [c.key, c.points]));
    expect(row.cc_points).toBe(printed.cc);
    expect(row.prod_points).toBe(printed.prod);
    expect(row.technical_points).toBe(printed.technical);
    expect(row.workplan_points).toBe(printed.workplan);
    expect(row.leadership_points).toBe(printed.leadership ?? null);
  });
});

describe("PDF Leadership section", () => {
  it.each([
    ["management flag", true, 0, true],
    ["direct reports in Dynamics HR", false, 2, true],
    ["no direct reports", false, 0, false],
  ])("%s", async (_label, isManagement, reports, expected) => {
    reportingStructure(reports);
    const data = await fetchAppraisalPDFData(APPRAISAL_ID, seed(isManagement) as unknown as SupabaseClient);
    expect(data.appraisal.showLeadership).toBe(expected);
    expect(data.leadershipRatings.map((r) => r.factor_name)).toEqual(expected ? ["Lead"] : []);
    expect(data.summaryComponents.some((c) => c.key === "leadership")).toBe(expected);
  });

  it("uses the shared track even when the reporting structure comes back empty", async () => {
    mocks.getReportingStructureFromDynamics.mockResolvedValue({ directReports: [], currentUserProfile: null });
    fakeHr.directReports["emp-1"] = 1;
    const data = await fetchAppraisalPDFData(APPRAISAL_ID, seed(false) as unknown as SupabaseClient);
    expect(data.appraisal.showLeadership).toBe(true);
  });

  it("a failed Dynamics lookup stops the PDF with a controlled error instead of dropping Leadership", async () => {
    reportingStructure(0);
    fakeHr.error = new Error("Dataverse unavailable");
    await expect(fetchAppraisalPDFData(APPRAISAL_ID, seed(false) as unknown as SupabaseClient)).rejects.toThrow(
      "Could not determine management track: HR lookup failed (Dataverse unavailable)"
    );
  });

  it("a failed lookup does not matter when the appraisal is flagged management", async () => {
    reportingStructure(0);
    fakeHr.error = new Error("Dataverse unavailable");
    const data = await fetchAppraisalPDFData(APPRAISAL_ID, seed(true) as unknown as SupabaseClient);
    expect(data.appraisal.showLeadership).toBe(true);
  });
});
