import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FakeSupabase } from "../helpers/fake-supabase";
import { fakeHr } from "../helpers/fake-dynamics-org";

vi.mock("@/lib/dynamics-org-service", async (orig) => ({ ...(await orig<object>()), ...(await import("../helpers/fake-dynamics-org")).fakeDynamicsOrg }));

import { fetchCompletionReport } from "@/lib/appraisal-completion-report";

const APPRAISAL_ID = "a-1";

function seed(isManagement: boolean, status = "SELF_ASSESSMENT") {
  return new FakeSupabase({
    appraisals: [{ id: APPRAISAL_ID, employee_id: "emp-1", status, is_management: isManagement }],
    workplans: [{ id: "wp-1", appraisal_id: APPRAISAL_ID }],
    workplan_items: [
      { id: "wi-1", workplan_id: "wp-1", major_task: "Task", key_output: "Output", performance_standard: "Std", weight: 100, actual_result: 80, created_at: 1 },
    ],
    evaluation_categories: [
      { id: "cat-core", category_type: "core", active: true },
      { id: "cat-prod", category_type: "productivity", active: true },
      { id: "cat-lead", category_type: "leadership", active: true },
    ],
    evaluation_factors: [
      { id: "f-core", category_id: "cat-core", active: true },
      { id: "f-prod", category_id: "cat-prod", active: true },
      { id: "f-lead", category_id: "cat-lead", active: true },
    ],
    appraisal_factor_ratings: [
      { appraisal_id: APPRAISAL_ID, factor_id: "f-core", self_rating_code: "7", manager_rating_code: null, weight: 100 },
      { appraisal_id: APPRAISAL_ID, factor_id: "f-prod", self_rating_code: "7", manager_rating_code: null, weight: 100 },
      { appraisal_id: APPRAISAL_ID, factor_id: "f-lead", self_rating_code: null, manager_rating_code: null, weight: 100 },
    ],
    appraisal_technical_competencies: [{ id: "t-1", appraisal_id: APPRAISAL_ID, self_rating: "7", manager_rating: null, weight: 100, display_order: 1 }],
  });
}

const report = (db: FakeSupabase, options?: { showLeadershipParam?: boolean }) =>
  fetchCompletionReport(db as unknown as SupabaseClient, APPRAISAL_ID, options);
const leadership = (r: Awaited<ReturnType<typeof report>>) => r!.sections.find((s) => s.key === "leadership");

beforeEach(() => fakeHr.reset());

describe("fetchCompletionReport management track", () => {
  it("is_management = true: Leadership is required, with no HR lookup", async () => {
    const r = await report(seed(true));
    expect(leadership(r)).toEqual({ key: "leadership", label: "Leadership", completed: 0, total: 1, required: true });
    expect(r!.blockers).toContain("Leadership: 1 rating(s) missing");
    expect(fakeHr.calls).toEqual([]);
  });

  it("is_management = false with direct reports in Dynamics HR: Leadership is required", async () => {
    fakeHr.directReports["emp-1"] = 2;
    const r = await report(seed(false));
    expect(leadership(r)?.total).toBe(1);
    expect(r!.blockers).toContain("Leadership: 1 rating(s) missing");
    expect(r!.canSubmit).toBe(false);
  });

  it("no direct reports: no Leadership section and the other rules are unchanged", async () => {
    const r = await report(seed(false));
    expect(leadership(r)).toBeUndefined();
    expect(r!.sections).toHaveLength(4);
    expect(r!.blockers).toEqual([]);
    expect(r!.canSubmit).toBe(true);
  });

  it("a caller that already knows Leadership applies skips the HR lookup", async () => {
    const r = await report(seed(false), { showLeadershipParam: true });
    expect(leadership(r)?.total).toBe(1);
    expect(fakeHr.calls).toEqual([]);
  });

  it("a failed Dynamics lookup is a controlled error, not a silent non-management result", async () => {
    fakeHr.error = new Error("Dataverse unavailable");
    await expect(report(seed(false))).rejects.toThrow("Could not determine management track: HR lookup failed (Dataverse unavailable)");
  });

  it("a missing appraisal still returns null", async () => {
    const db = seed(false);
    db.tables.appraisals = [];
    expect(await report(db)).toBeNull();
    expect(fakeHr.calls).toEqual([]);
  });
});
