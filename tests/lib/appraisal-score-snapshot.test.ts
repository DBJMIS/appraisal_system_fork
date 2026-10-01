import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { calcSummary, type SummaryCalcProps } from "@/lib/summary-calc";
import {
  buildScoreSnapshotRow,
  findScoreSnapshot,
  listMidyearScoreRevisions,
  listScoreSnapshotsByType,
  loadScoreSnapshotSummaries,
  persistScoreSnapshot,
  SUMMARY_ENGINE_VERSION,
  type ScoreSnapshotType,
} from "@/lib/appraisal-score-snapshot";
import { FakeSupabase } from "../helpers/fake-supabase";
import { MGMT_INPUT, NON_MGMT_INPUT } from "../helpers/score-fixtures";
import type { SupabaseClient } from "@supabase/supabase-js";

const APPRAISAL_ID = "a-1";

describe("calcSummary is unchanged", () => {
  it("non-management golden values", () => {
    const r = calcSummary(NON_MGMT_INPUT);
    expect(r.components.map((c) => [c.key, c.weight, c.actual, c.points])).toEqual([
      ["cc", 10, 90, 9],
      ["prod", 10, 72, 7.2],
      ["technical", 10, 70, 7],
      ["workplan", 70, 82, 57.4],
    ]);
    expect(r.totalPoints).toBe(80.6);
    expect(r.overallGrade).toBe("C");
    expect(r.gradeBand).toBe("Meets Expectations");
  });

  it("management golden values", () => {
    const r = calcSummary(MGMT_INPUT);
    expect(r.components.map((c) => [c.key, c.weight, c.actual, c.points])).toEqual([
      ["cc", 10, 90, 9],
      ["prod", 10, 72, 7.2],
      ["technical", 10, 70, 7],
      ["leadership", 10, 50, 5],
      ["workplan", 60, 82, 49.2],
    ]);
    expect(r.totalPoints).toBe(77.4);
    expect(r.overallGrade).toBe("D");
  });

  it("lib/summary-calc.ts calculation source matches the version recorded as SUMMARY_ENGINE_VERSION", () => {
    // If calcSummary changes intentionally, bump SUMMARY_ENGINE_VERSION and update this hash.
    // GRADE_STYLES (presentation only) is excluded.
    const src = readFileSync(join(__dirname, "..", "..", "lib", "summary-calc.ts"), "utf8")
      .replace(/\r\n/g, "\n")
      .replace(/export const GRADE_STYLES[\s\S]*?\n};\n/, "");
    const hash = createHash("sha256").update(src).digest("hex");
    expect({ version: SUMMARY_ENGINE_VERSION, hash }).toEqual({
      version: "summary-calc/v1",
      hash: EXPECTED_SUMMARY_CALC_HASH,
    });
  });
});

const EXPECTED_SUMMARY_CALC_HASH = "3cca1e303aa71713f7dc049481c4b627f778f48db35de0da7ac4b65009afab8f";

describe("buildScoreSnapshotRow", () => {
  it("stores section actuals/points, grade and track for the non-management track", () => {
    const result = calcSummary(NON_MGMT_INPUT);
    const row = buildScoreSnapshotRow({
      appraisalId: APPRAISAL_ID,
      scoreType: "FINAL",
      isManagementTrack: false,
      input: NON_MGMT_INPUT,
      result,
      actor: "u-mgr",
    });
    expect(row).toMatchObject({
      appraisal_id: APPRAISAL_ID,
      score_type: "FINAL",
      check_in_id: null,
      is_management_track: false,
      total_points: 80.6,
      overall_grade: "C",
      grade_label: "Meets Expectations",
      cc_actual: 90,
      cc_points: 9,
      prod_actual: 72,
      prod_points: 7.2,
      technical_actual: 70,
      technical_points: 7,
      leadership_actual: null,
      leadership_points: null,
      workplan_actual: 82,
      workplan_points: 57.4,
      engine_version: SUMMARY_ENGINE_VERSION,
      calculated_by: "u-mgr",
    });
  });

  it("stores leadership and the management track", () => {
    const row = buildScoreSnapshotRow({
      appraisalId: APPRAISAL_ID,
      scoreType: "FINAL",
      isManagementTrack: true,
      input: MGMT_INPUT,
      result: calcSummary(MGMT_INPUT),
      actor: null,
    });
    expect(row).toMatchObject({
      is_management_track: true,
      leadership_actual: 50,
      leadership_points: 5,
      workplan_points: 49.2,
      total_points: 77.4,
      overall_grade: "D",
      grade_label: "Below Expectations",
    });
  });

  it("persists the full components and inputs JSON, enough to reproduce the score", () => {
    const result = calcSummary(MGMT_INPUT);
    const row = buildScoreSnapshotRow({
      appraisalId: APPRAISAL_ID,
      scoreType: "FINAL",
      isManagementTrack: true,
      input: MGMT_INPUT,
      result,
      actor: null,
    });
    expect(row.components).toEqual(result.components);
    expect(row.inputs).toEqual(MGMT_INPUT);
    const roundTrip = JSON.parse(JSON.stringify(row));
    expect(calcSummary(roundTrip.inputs)).toEqual(result);
  });

  it("rejects score types other than MIDYEAR and FINAL", () => {
    expect(() =>
      buildScoreSnapshotRow({
        appraisalId: APPRAISAL_ID,
        scoreType: "INTERIM" as ScoreSnapshotType,
        isManagementTrack: false,
        input: NON_MGMT_INPUT,
        result: calcSummary(NON_MGMT_INPUT),
        actor: null,
      })
    ).toThrow(/Invalid score snapshot type/);
  });

  it("rejects a track flag that differs from the calculation it is storing", () => {
    expect(() =>
      buildScoreSnapshotRow({
        appraisalId: APPRAISAL_ID,
        scoreType: "FINAL",
        isManagementTrack: true,
        input: NON_MGMT_INPUT,
        result: calcSummary(NON_MGMT_INPUT),
        actor: null,
      })
    ).toThrow(/track does not match/);
  });
});

describe("persistScoreSnapshot", () => {
  let db: FakeSupabase;
  const client = () => db as unknown as SupabaseClient;

  function seed(status: string) {
    db = new FakeSupabase(
      { appraisals: [{ id: APPRAISAL_ID, status }], appraisal_score_snapshots: [] },
      { appraisal_score_snapshots: [["appraisal_id", "score_type", "revision"]] }
    );
  }

  const persist = (input = NON_MGMT_INPUT, scoreType: ScoreSnapshotType = "FINAL") =>
    persistScoreSnapshot({
      supabase: client(),
      appraisalId: APPRAISAL_ID,
      scoreType,
      isManagementTrack: input.isManagementTrack,
      input,
      result: calcSummary(input),
      actor: "u-mgr",
    });

  beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("writes one FINAL row", async () => {
    seed("MANAGER_REVIEW");
    const out = await persist();
    expect(out.written).toBe(true);
    expect(db.tables.appraisal_score_snapshots).toHaveLength(1);
    expect(db.tables.appraisal_score_snapshots[0]).toMatchObject({ score_type: "FINAL", total_points: 80.6 });
  });

  it("upserts FINAL on repeat instead of adding a second row", async () => {
    seed("MANAGER_REVIEW");
    await persist(NON_MGMT_INPUT);
    await persist(MGMT_INPUT);
    const rows = db.tables.appraisal_score_snapshots;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ score_type: "FINAL", total_points: 77.4, is_management_track: true });
  });

  it("keeps MIDYEAR and FINAL as separate rows for the same appraisal", async () => {
    seed("IN_PROGRESS");
    await persist(NON_MGMT_INPUT, "MIDYEAR");
    await persist(MGMT_INPUT, "FINAL");
    expect(db.tables.appraisal_score_snapshots.map((r) => r.score_type).sort()).toEqual(["FINAL", "MIDYEAR"]);
  });

  it("does not overwrite an existing FINAL once the appraisal is COMPLETE, and says so", async () => {
    seed("MANAGER_REVIEW");
    await persist(NON_MGMT_INPUT);
    db.tables.appraisals[0].status = "COMPLETE";
    const out = await persist(MGMT_INPUT);
    expect(out).toEqual({ written: false, reason: "appraisal_complete" });
    expect(db.tables.appraisal_score_snapshots).toHaveLength(1);
    expect(db.tables.appraisal_score_snapshots[0]).toMatchObject({ total_points: 80.6, is_management_track: false });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("not overwritten: appraisal is COMPLETE"));
  });

  it("throws when the appraisal does not exist", async () => {
    seed("MANAGER_REVIEW");
    db.tables.appraisals = [];
    await expect(persist()).rejects.toThrow(/appraisal not found/);
  });
});

describe("MIDYEAR score revisions", () => {
  let db: FakeSupabase;
  const client = () => db as unknown as SupabaseClient;

  function seed(status = "IN_PROGRESS") {
    db = new FakeSupabase(
      { appraisals: [{ id: APPRAISAL_ID, status }], appraisal_score_snapshots: [], appraisal_audit: [] },
      { appraisal_score_snapshots: [["appraisal_id", "score_type", "revision"]] }
    );
  }

  const persist = (input: SummaryCalcProps, scoreType: ScoreSnapshotType = "MIDYEAR") =>
    persistScoreSnapshot({
      supabase: client(),
      appraisalId: APPRAISAL_ID,
      scoreType,
      checkInId: scoreType === "MIDYEAR" ? "ci-1" : null,
      isManagementTrack: input.isManagementTrack,
      input,
      result: calcSummary(input),
      actor: "u-mgr",
    });

  beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it("adds a new revision and keeps the earlier one, superseded, unchanged", async () => {
    seed();
    await persist(NON_MGMT_INPUT);
    const first = { ...db.tables.appraisal_score_snapshots[0] };
    const out = await persist(MGMT_INPUT);
    expect(out.written && out.row.revision).toBe(2);
    const rows = db.tables.appraisal_score_snapshots;
    expect(rows.map((r) => [r.revision, r.superseded_at == null])).toEqual([
      [1, false],
      [2, true],
    ]);
    const { superseded_at: _a, superseded_by: _b, ...kept } = rows[0];
    expect(kept).toEqual(first);
    expect(rows[1]).toMatchObject({ total_points: 77.4 });
  });

  it("reads only the current revision, while every revision stays queryable", async () => {
    seed();
    await persist(NON_MGMT_INPUT);
    await persist(MGMT_INPUT);
    expect(await findScoreSnapshot(client(), APPRAISAL_ID, "MIDYEAR")).toMatchObject({ revision: 2 });
    const summaries = await loadScoreSnapshotSummaries(client(), APPRAISAL_ID);
    expect(summaries.MIDYEAR).toMatchObject({ revision: 2, total_points: 77.4 });
    const byType = await listScoreSnapshotsByType(client(), "MIDYEAR", [APPRAISAL_ID]);
    expect(byType.get(APPRAISAL_ID)).toMatchObject({ revision: 2, total_points: 77.4 });
    const all = await listMidyearScoreRevisions(client(), APPRAISAL_ID);
    expect(all.map((r) => [r.revision, r.total_points])).toEqual([
      [1, 80.6],
      [2, 77.4],
    ]);
  });

  it("FINAL stays a single revision-1 row and is never mixed with MIDYEAR revisions", async () => {
    seed();
    await persist(NON_MGMT_INPUT);
    await persist(MGMT_INPUT);
    await persist(NON_MGMT_INPUT, "FINAL");
    await persist(MGMT_INPUT, "FINAL");
    const finals = db.tables.appraisal_score_snapshots.filter((r) => r.score_type === "FINAL");
    expect(finals).toHaveLength(1);
    expect(finals[0]).toMatchObject({ revision: 1, total_points: 77.4 });
    expect(finals[0].superseded_at ?? null).toBeNull();
    const finalByType = await listScoreSnapshotsByType(client(), "FINAL", [APPRAISAL_ID]);
    expect(finalByType.get(APPRAISAL_ID)).toMatchObject({ score_type: "FINAL", total_points: 77.4 });
  });

  it("audits a revised score as a revision, without the score itself", async () => {
    seed();
    await persist(NON_MGMT_INPUT);
    await persist(MGMT_INPUT);
    const audits = db.tables.appraisal_audit;
    expect(audits.map((a) => a.summary)).toEqual(["Mid-Year score recorded", "Revised Mid-Year score recorded (revision 2)"]);
    expect(audits[1].detail).toMatchObject({ score_type: "MIDYEAR", revision: 2, superseded_revision: 1 });
    expect(JSON.stringify(audits)).not.toMatch(/total_points|overall_grade/);
  });

  it("does not add a revision once the appraisal is COMPLETE", async () => {
    seed();
    await persist(NON_MGMT_INPUT);
    db.tables.appraisals[0].status = "COMPLETE";
    expect(await persist(MGMT_INPUT)).toEqual({ written: false, reason: "appraisal_complete" });
    expect(db.tables.appraisal_score_snapshots).toHaveLength(1);
  });
});
