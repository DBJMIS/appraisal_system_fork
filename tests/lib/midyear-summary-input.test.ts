import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FakeSupabase } from "../helpers/fake-supabase";
import { buildSummaryInput } from "@/lib/appraisal-summary-input";
import { buildMidyearSummaryInput } from "@/lib/midyear-summary-input";
import { calcSummary } from "@/lib/summary-calc";

type Code = string | null;
interface Wp { weight: number; employee: number | null; mgr: number | null }
interface Comp { weight: number; self: Code; mgr: Code }
interface Scenario {
  isManagement: boolean;
  workplan: Wp[];
  core: Comp[];
  productivity: Comp[];
  technical: Comp[];
  leadership?: Comp[];
}

const APPRAISAL_ID = "a-1";
const CHECK_IN_ID = "ci-1";

/**
 * Seeds the same normalized values twice: as annual assessment rows (read by buildSummaryInput) and
 * as a formal scored Mid-Year Review (read by buildMidyearSummaryInput).
 */
function seed(s: Scenario, checkIn: Record<string, unknown> = {}) {
  const factorSections: Array<["core" | "productivity" | "leadership", Comp[]]> = [
    ["core", s.core],
    ["productivity", s.productivity],
    ["leadership", s.leadership ?? []],
  ];
  const factors = factorSections.flatMap(([cat, rows]) =>
    rows.map((_, i) => ({ id: `f-${cat}-${i}`, category_id: `cat-${cat}`, weight: 999, active: true }))
  );
  const annualFactorRatings = factorSections.flatMap(([cat, rows]) =>
    rows.map((c, i) => ({ appraisal_id: APPRAISAL_ID, factor_id: `f-${cat}-${i}`, weight: c.weight, self_rating_code: c.self, manager_rating_code: c.mgr }))
  );
  const midyearSections: Array<[string, Comp[]]> = [
    ["CORE", s.core],
    ["PRODUCTIVITY", s.productivity],
    ["TECHNICAL", s.technical],
    ["LEADERSHIP", s.leadership ?? []],
  ];
  return new FakeSupabase({
    appraisals: [{ id: APPRAISAL_ID, employee_id: "emp-1", is_management: s.isManagement }],
    workplans: [{ id: "wp-1", appraisal_id: APPRAISAL_ID }],
    workplan_items: s.workplan.map((w, i) => ({ id: `wi-${i}`, workplan_id: "wp-1", weight: w.weight, actual_result: w.employee, mgr_result: w.mgr })),
    evaluation_categories: [
      { id: "cat-core", category_type: "core", active: true },
      { id: "cat-productivity", category_type: "productivity", active: true },
      { id: "cat-leadership", category_type: "leadership", active: true },
    ],
    evaluation_factors: factors,
    appraisal_factor_ratings: annualFactorRatings,
    appraisal_technical_competencies: s.technical.map((c, i) => ({
      appraisal_id: APPRAISAL_ID,
      weight: c.weight,
      self_rating: c.self,
      manager_rating: c.mgr,
      display_order: i,
    })),
    check_ins: [
      { id: CHECK_IN_ID, appraisal_id: APPRAISAL_ID, review_mode: "FORMAL_SCORED", is_management_track: s.isManagement, status: "COMPLETE", ...checkIn },
    ],
    check_in_responses: s.workplan.map((w, i) => ({
      check_in_id: CHECK_IN_ID,
      workplan_item_id: `wi-${i}`,
      weight_snapshot: w.weight,
      employee_result: w.employee,
      mgr_result: w.mgr,
    })),
    check_in_competency_ratings: midyearSections.flatMap(([section, rows]) =>
      rows.map((c, i) => ({
        check_in_id: CHECK_IN_ID,
        section,
        name_snapshot: `${section} ${i}`,
        weight_snapshot: c.weight,
        employee_rating_code: c.self,
        manager_rating_code: c.mgr,
        display_order: i,
      }))
    ),
  });
}

const asClient = (db: FakeSupabase) => db as unknown as SupabaseClient;

async function midyearInput(db: FakeSupabase) {
  const result = await buildMidyearSummaryInput(CHECK_IN_ID, asClient(db));
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.blockers.join("; ")}`);
  return result.input;
}

const base = (): Scenario => ({
  isManagement: false,
  workplan: [
    { weight: 60, employee: 80, mgr: 70 },
    { weight: 40, employee: 100, mgr: null },
  ],
  core: [
    { weight: 60, self: "8", mgr: "7" },
    { weight: 40, self: "9", mgr: "9" },
  ],
  productivity: [{ weight: 100, self: "7", mgr: "8" }],
  technical: [
    { weight: 50, self: "6", mgr: "6" },
    { weight: 50, self: "10", mgr: "8" },
  ],
});

async function expectEquivalent(s: Scenario) {
  const db = seed(s);
  const annual = await buildSummaryInput(APPRAISAL_ID, asClient(db));
  const midyear = await midyearInput(db);
  expect(midyear).toEqual(annual);
  expect(calcSummary(midyear)).toEqual(calcSummary(annual));
  return calcSummary(midyear);
}

describe("equivalence with the annual input for identical normalized values", () => {
  it("non-management track", async () => {
    const result = await expectEquivalent(base());
    expect(result.isManagementTrack).toBe(false);
    expect(result.components.map((c) => c.key)).toEqual(["cc", "prod", "technical", "workplan"]);
  });

  it("management track includes leadership", async () => {
    const result = await expectEquivalent({
      ...base(),
      isManagement: true,
      leadership: [
        { weight: 70, self: "9", mgr: "8" },
        { weight: 30, self: "7", mgr: "6" },
      ],
    });
    expect(result.components.map((c) => c.key)).toEqual(["cc", "prod", "technical", "leadership", "workplan"]);
  });

  it("uses the employee result when there is no manager result, as annual uses actual_result", async () => {
    await expectEquivalent({ ...base(), workplan: [{ weight: 100, employee: 64, mgr: null }] });
  });

  it("uses the manager result over the employee result", async () => {
    const s = { ...base(), workplan: [{ weight: 100, employee: 100, mgr: 40 }] };
    const result = await expectEquivalent(s);
    expect(result.components.find((c) => c.key === "workplan")!.actual).toBe(40);
  });

  it("fractional results, uneven weights and zero-weight items", async () => {
    await expectEquivalent({
      isManagement: true,
      workplan: [
        { weight: 33.3, employee: 83.5, mgr: null },
        { weight: 66.7, employee: 91.25, mgr: 72.4 },
        { weight: 0, employee: null, mgr: null },
      ],
      core: [
        { weight: 25, self: "5", mgr: "6" },
        { weight: 75, self: "8", mgr: "9" },
        { weight: 0, self: null, mgr: null },
      ],
      productivity: [{ weight: 100, self: "3", mgr: "4" }],
      technical: [{ weight: 100, self: "10", mgr: "10" }],
      leadership: [{ weight: 100, self: "2", mgr: "1" }],
    });
  });

  it("perfect and minimum inputs score the same extremes", async () => {
    const all = (code: string, result: number): Scenario => ({
      isManagement: false,
      workplan: [{ weight: 100, employee: result, mgr: result }],
      core: [{ weight: 100, self: code, mgr: code }],
      productivity: [{ weight: 100, self: code, mgr: code }],
      technical: [{ weight: 100, self: code, mgr: code }],
    });
    expect((await expectEquivalent(all("10", 100))).totalPoints).toBe(100);
    expect((await expectEquivalent(all("1", 0))).totalPoints).toBe(20);
  });

  it("holds for 200 generated scenarios", async () => {
    let state = 20260930;
    const rand = () => ((state = (state * 1103515245 + 12345) % 2147483648) / 2147483648);
    const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
    const code = () => String(int(1, 10));
    const comps = (n: number): Comp[] => Array.from({ length: n }, () => ({ weight: int(1, 100), self: code(), mgr: code() }));
    for (let i = 0; i < 200; i++) {
      const isManagement = rand() < 0.5;
      await expectEquivalent({
        isManagement,
        workplan: Array.from({ length: int(1, 6) }, () => {
          const employee = Math.round(rand() * 12000) / 100;
          return { weight: int(1, 60), employee: Math.min(100, employee), mgr: rand() < 0.5 ? int(0, 100) : null };
        }),
        core: comps(int(1, 5)),
        productivity: comps(int(1, 4)),
        technical: comps(int(1, 4)),
        leadership: isManagement ? comps(int(1, 3)) : [],
      });
    }
  });
});

describe("frozen weights and track", () => {
  it("reads only the Mid-Year tables", async () => {
    const db = seed(base());
    const from = vi.spyOn(db, "from");
    await midyearInput(db);
    expect(new Set(from.mock.calls.map(([t]) => t))).toEqual(new Set(["check_ins", "check_in_responses", "check_in_competency_ratings"]));
  });

  it("ignores later changes to live weights, annual values and the live management flag", async () => {
    const db = seed(base());
    const before = await midyearInput(db);
    db.tables.appraisals[0].is_management = true;
    for (const w of db.tables.workplan_items) Object.assign(w, { weight: 1, actual_result: 0, mgr_result: 0 });
    for (const f of db.tables.appraisal_factor_ratings) Object.assign(f, { weight: 1, manager_rating_code: "1" });
    for (const f of db.tables.evaluation_factors) f.weight = 1;
    for (const t of db.tables.appraisal_technical_competencies) Object.assign(t, { weight: 1, manager_rating: "1" });
    expect(await midyearInput(db)).toEqual(before);
  });

  it("uses the frozen management track, not the appraisal's current flag", async () => {
    const db = seed({ ...base(), isManagement: true, leadership: [{ weight: 100, self: "8", mgr: "8" }] });
    db.tables.appraisals[0].is_management = false;
    const input = await midyearInput(db);
    expect(input.isManagementTrack).toBe(true);
    expect(input.leadership).toHaveLength(1);
  });

  it("drops leadership rows when the frozen track is non-management", async () => {
    const db = seed({ ...base(), leadership: [{ weight: 100, self: "8", mgr: null }] });
    const input = await midyearInput(db);
    expect(input.isManagementTrack).toBe(false);
    expect(input.leadership).toEqual([]);
  });

  it("uses the weight snapshots", async () => {
    const input = await midyearInput(seed(base()));
    expect(input.workplanItems.map((w) => w.weight)).toEqual([60, 40]);
    expect(input.competencies.map((c) => c.weight)).toEqual([60, 40]);
  });

  it("writes nothing", async () => {
    const db = seed(base());
    await midyearInput(db);
    expect(db.writes).toEqual([]);
  });
});

describe("no annual fallback: missing Mid-Year data is a controlled error", () => {
  const errorOf = async (db: FakeSupabase) => {
    const result = await buildMidyearSummaryInput(CHECK_IN_ID, asClient(db));
    expect(result.ok).toBe(false);
    return (result as { ok: false; error: { code: string; message: string; blockers: string[] } }).error;
  };

  it("a missing Mid-Year manager rating is not filled from the annual rating", async () => {
    const db = seed(base());
    db.tables.check_in_competency_ratings[0].manager_rating_code = null;
    expect(db.tables.appraisal_factor_ratings[0].manager_rating_code).toBe("7");
    const error = await errorOf(db);
    expect(error.code).toBe("INCOMPLETE");
    expect(error.blockers).toEqual(["Core competencies: 1 manager rating(s) missing."]);
  });

  it("a missing Mid-Year result is not filled from the annual workplan", async () => {
    const db = seed(base());
    Object.assign(db.tables.check_in_responses[1], { employee_result: null, mgr_result: null });
    expect(db.tables.workplan_items[1].actual_result).toBe(100);
    const error = await errorOf(db);
    expect(error.blockers).toEqual(["Workplan: 1 objective(s) missing a scoreable Mid-Year result."]);
  });

  it("a missing weight snapshot is not filled from live weights", async () => {
    const db = seed(base());
    db.tables.check_in_responses[0].weight_snapshot = null;
    expect((await errorOf(db)).blockers).toEqual(["Workplan: 1 objective weight(s) missing."]);
  });

  it("a scored section with no Mid-Year competencies is an error, not a silent zero", async () => {
    const db = seed({ ...base(), technical: [] });
    expect(db.tables.appraisal_technical_competencies).toHaveLength(0);
    expect((await errorOf(db)).blockers).toEqual(["Technical competencies: no competencies were captured for this Mid-Year Review."]);
  });

  it("the management track requires leadership competencies", async () => {
    const db = seed({ ...base(), isManagement: true, leadership: [] });
    expect((await errorOf(db)).blockers).toEqual(["Leadership: no competencies were captured for this Mid-Year Review."]);
  });

  it("no workplan inputs is an error", async () => {
    const db = seed({ ...base(), workplan: [] });
    expect((await errorOf(db)).blockers).toContain("Workplan: no objectives were captured for this Mid-Year Review.");
  });

  it.each([
    [{ review_mode: "INFORMAL", is_management_track: null }, "NOT_SCORED"],
    [{ review_mode: "FORMAL" }, "NOT_SCORED"],
    [{ status: "CANCELLED" }, "CANCELLED"],
    [{ is_management_track: null }, "TRACK_NOT_FROZEN"],
  ])("%j → %s", async (checkIn, code) => {
    expect((await errorOf(seed(base(), checkIn))).code).toBe(code);
  });

  it("an unknown check-in is NOT_FOUND", async () => {
    const result = await buildMidyearSummaryInput("missing", asClient(seed(base())));
    expect(result).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("the loader source never names an annual assessment table", () => {
    const source = readFileSync(path.join(process.cwd(), "lib", "midyear-summary-input.ts"), "utf8");
    for (const table of ["\"appraisals\"", "\"workplan_items\"", "\"appraisal_factor_ratings\"", "\"appraisal_technical_competencies\"", "\"evaluation_factors\""]) {
      expect(source).not.toContain(table);
    }
  });
});
