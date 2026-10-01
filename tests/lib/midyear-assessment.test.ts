import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FakeSupabase } from "../helpers/fake-supabase";
import { calcMetricPercentage, calcMgrResult } from "@/lib/metric-calc";
import {
  buildMidyearSnapshot,
  midyearEmployeeResult,
  midyearManagerResult,
  prepareMidyearWrites,
} from "@/lib/midyear-assessment";

const asClient = (db: FakeSupabase) => db as unknown as SupabaseClient;

describe("Mid-Year workplan results reuse lib/metric-calc.ts", () => {
  const cases = [
    { name: "NUMBER 8 of 10", source: { metric_type: "NUMBER", metric_target: 10 }, input: { actual_raw: 8, completion_date: null }, expected: 80 },
    { name: "NUMBER over target caps at 100", source: { metric_type: "NUMBER", metric_target: "10" }, input: { actual_raw: 14, completion_date: null }, expected: 100 },
    { name: "DATE on time", source: { metric_type: "DATE", metric_deadline: "2026-06-30" }, input: { actual_raw: null, completion_date: "2026-06-15" }, expected: 100 },
    { name: "DATE 45 days late", source: { metric_type: "DATE", metric_deadline: "2026-06-30" }, input: { actual_raw: null, completion_date: "2026-08-14" }, expected: 50 },
    { name: "PERCENT", source: { metric_type: "PERCENT" }, input: { actual_raw: 72, completion_date: null }, expected: 72 },
    { name: "PERCENT is the default type", source: {}, input: { actual_raw: 55, completion_date: null }, expected: 55 },
    { name: "missing actual", source: { metric_type: "NUMBER", metric_target: 10 }, input: { actual_raw: null, completion_date: null }, expected: null },
  ] as const;

  it.each(cases)("$name", ({ source, input, expected }) => {
    expect(midyearEmployeeResult(source, input)).toBe(expected);
    expect(midyearManagerResult(source, input)).toBe(expected);
  });

  it.each(cases)("matches the annual formulas exactly: $name", ({ source, input }) => {
    const item = {
      metric_type: (source as { metric_type?: "NUMBER" | "DATE" | "PERCENT" }).metric_type ?? null,
      metric_target: (source as { metric_target?: number | string }).metric_target != null ? Number((source as { metric_target: number | string }).metric_target) : null,
      metric_deadline: (source as { metric_deadline?: string }).metric_deadline ?? null,
    };
    expect(midyearEmployeeResult(source, input)).toBe(
      calcMetricPercentage({ ...item, metric_actual_raw: input.actual_raw, metric_completion_date: input.completion_date })
    );
    expect(midyearManagerResult(source, input)).toBe(
      calcMgrResult({ ...item, mgr_actual_raw: input.actual_raw, mgr_completion_date: input.completion_date })
    );
  });
});

function snapshotDb(extra: Record<string, Record<string, unknown>[]> = {}) {
  return new FakeSupabase({
    evaluation_categories: [
      { id: "cat-core", category_type: "core", active: true },
      { id: "cat-prod", category_type: "productivity", active: true },
      { id: "cat-lead", category_type: "leadership", active: true },
      { id: "cat-old", category_type: "core", active: false },
    ],
    evaluation_factors: [
      { id: "f-core-2", category_id: "cat-core", name: "Teamwork", weight: 40, display_order: 2, active: true },
      { id: "f-core-1", category_id: "cat-core", name: "Integrity", weight: 60, display_order: 1, active: true },
      { id: "f-core-off", category_id: "cat-core", name: "Retired", weight: 10, display_order: 3, active: false },
      { id: "f-old", category_id: "cat-old", name: "Old", weight: 100, display_order: 1, active: true },
      { id: "f-prod", category_id: "cat-prod", name: "Quality", weight: 100, display_order: 1, active: true },
      { id: "f-lead", category_id: "cat-lead", name: "Vision", weight: 100, display_order: 1, active: true },
    ],
    appraisal_factor_ratings: [
      { appraisal_id: "a-1", factor_id: "f-core-1", weight: 70 },
      { appraisal_id: "a-1", factor_id: "f-core-2", weight: null },
      { appraisal_id: "a-other", factor_id: "f-prod", weight: 5 },
    ],
    appraisal_technical_competencies: [
      { id: "t-excel", appraisal_id: "a-1", name: "Excel", weight: 60, display_order: 2 },
      { id: "t-sql", appraisal_id: "a-1", name: "SQL", weight: 40, display_order: 1 },
      { id: "t-other", appraisal_id: "a-other", name: "Other", weight: 100, display_order: 1 },
    ],
    ...extra,
  });
}

const workplanItems = [
  { id: "wi-1", weight: 60 },
  { id: "wi-2", weight: "40" },
  { id: "wi-3", weight: null },
];

describe("buildMidyearSnapshot", () => {
  it("freezes factor, technical and workplan weights (appraisal weight first, else master)", async () => {
    const s = await buildMidyearSnapshot(asClient(snapshotDb()), {
      appraisalId: "a-1",
      isManagementTrack: false,
      workplanItems,
    });
    expect(s.isManagementTrack).toBe(false);
    expect(s.competencies).toEqual([
      { section: "CORE", factor_id: "f-core-1", technical_competency_id: null, name_snapshot: "Integrity", weight_snapshot: 70, display_order: 0 },
      { section: "CORE", factor_id: "f-core-2", technical_competency_id: null, name_snapshot: "Teamwork", weight_snapshot: 40, display_order: 1 },
      { section: "PRODUCTIVITY", factor_id: "f-prod", technical_competency_id: null, name_snapshot: "Quality", weight_snapshot: 100, display_order: 0 },
      { section: "TECHNICAL", factor_id: null, technical_competency_id: "t-sql", name_snapshot: "SQL", weight_snapshot: 40, display_order: 0 },
      { section: "TECHNICAL", factor_id: null, technical_competency_id: "t-excel", name_snapshot: "Excel", weight_snapshot: 60, display_order: 1 },
    ]);
    expect(s.workplanWeights).toEqual({ "wi-1": 60, "wi-2": 40, "wi-3": 0 });
  });

  it("includes leadership on the management track", async () => {
    const s = await buildMidyearSnapshot(asClient(snapshotDb()), {
      appraisalId: "a-1",
      isManagementTrack: true,
      workplanItems,
    });
    expect(s.isManagementTrack).toBe(true);
    expect(s.competencies.filter((c) => c.section === "LEADERSHIP").map((c) => c.factor_id)).toEqual(["f-lead"]);
  });

  it("only reads the annual tables", async () => {
    const db = snapshotDb();
    await buildMidyearSnapshot(asClient(db), { appraisalId: "a-1", isManagementTrack: true, workplanItems });
    expect(db.writes).toEqual([]);
  });
});

describe("prepareMidyearWrites", () => {
  const db = () =>
    new FakeSupabase({
      check_in_responses: [
        { check_in_id: "ci-1", workplan_item_id: "wi-num", employee_actual_raw: 5, employee_completion_date: null, mgr_actual_raw: null, mgr_completion_date: null },
        { check_in_id: "ci-1", workplan_item_id: "wi-date", employee_actual_raw: null, employee_completion_date: null, mgr_actual_raw: null, mgr_completion_date: "2026-06-01" },
      ],
      workplan_items: [
        { id: "wi-num", metric_type: "NUMBER", metric_target: 10, metric_deadline: null },
        { id: "wi-date", metric_type: "DATE", metric_target: null, metric_deadline: "2026-06-30" },
      ],
      check_in_competency_ratings: [{ id: "cr-1", check_in_id: "ci-1" }, { id: "cr-x", check_in_id: "ci-2" }],
    });

  it("computes the employee result and ignores manager fields", async () => {
    const r = await prepareMidyearWrites(asClient(db()), "ci-1", "employee", [
      { workplan_item_id: "wi-num", employee_actual_raw: 9, mgr_actual_raw: 1 },
    ], [{ id: "cr-1", employee_rating_code: "7", employee_comment: "Good", manager_rating_code: "2" }]);
    expect(r.error).toBeNull();
    expect(r.writes!.responseValues).toEqual({ "wi-num": { employee_actual_raw: 9, employee_result: 90 } });
    expect(r.writes!.competencyUpdates).toEqual([{ id: "cr-1", values: { employee_rating_code: "7", employee_comment: "Good" } }]);
  });

  it("recomputes from stored values when only one field changes", async () => {
    const r = await prepareMidyearWrites(asClient(db()), "ci-1", "manager", [
      { workplan_item_id: "wi-num", mgr_actual_raw: "4" },
      { workplan_item_id: "wi-date", mgr_actual_raw: null },
    ], []);
    expect(r.writes!.responseValues).toEqual({
      "wi-num": { mgr_actual_raw: 4, mgr_result: 40 },
      "wi-date": { mgr_actual_raw: null, mgr_result: 100 },
    });
  });

  it("clearing an input clears the result", async () => {
    const r = await prepareMidyearWrites(asClient(db()), "ci-1", "employee", [{ workplan_item_id: "wi-num", employee_actual_raw: "" }], []);
    expect(r.writes!.responseValues).toEqual({ "wi-num": { employee_actual_raw: null, employee_result: null } });
  });

  it.each([
    [[{ workplan_item_id: "wi-num", employee_actual_raw: "abc" }], [], /must be a number/],
    [[{ workplan_item_id: "wi-date", employee_completion_date: "30/06/2026" }], [], /must be a date/],
    [[], [{ id: "cr-1", employee_rating_code: "11" }], /between 1 and 10/],
    [[], [{ id: "cr-1", employee_comment: 5 }], /must be text/],
    [[], [{ id: "cr-x", employee_rating_code: "5" }], /does not belong/],
  ])("rejects invalid input %#", async (responses, competencies, message) => {
    const r = await prepareMidyearWrites(asClient(db()), "ci-1", "employee", responses, competencies);
    expect(r.error).toMatch(message);
  });

  it("skips objectives that are not part of the check-in", async () => {
    const r = await prepareMidyearWrites(asClient(db()), "ci-1", "employee", [{ workplan_item_id: "wi-foreign", employee_actual_raw: 3 }], []);
    expect(r.writes!.responseValues).toEqual({});
  });
});
