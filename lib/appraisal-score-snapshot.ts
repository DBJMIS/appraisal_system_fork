/**
 * Durable score snapshots (appraisal_score_snapshots). Server-only: callers pass a service-role client.
 * Stores the output of the canonical engine (lib/summary-calc.ts calcSummary) without recalculating it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SummaryCalcProps, SummaryResult } from "@/lib/summary-calc";

export const SCORE_SNAPSHOT_TYPES = ["MIDYEAR", "FINAL"] as const;
export type ScoreSnapshotType = (typeof SCORE_SNAPSHOT_TYPES)[number];

/** Identifies the calculation rules behind a snapshot. Bump when calcSummary's formula changes. */
export const SUMMARY_ENGINE_VERSION = "summary-calc/v1";

export interface PersistScoreSnapshotParams {
  supabase: SupabaseClient;
  appraisalId: string;
  scoreType: ScoreSnapshotType;
  checkInId?: string | null;
  isManagementTrack: boolean;
  input: SummaryCalcProps;
  result: SummaryResult;
  /** Who triggered the calculation (app user id). */
  actor: string | null;
}

export interface ScoreSnapshotRow {
  appraisal_id: string;
  score_type: ScoreSnapshotType;
  /** FINAL is always 1. MIDYEAR counts up with each completion of a reopened review. */
  revision: number;
  check_in_id: string | null;
  is_management_track: boolean;
  total_points: number;
  overall_grade: string | null;
  grade_label: string | null;
  cc_actual: number | null;
  cc_points: number | null;
  prod_actual: number | null;
  prod_points: number | null;
  technical_actual: number | null;
  technical_points: number | null;
  leadership_actual: number | null;
  leadership_points: number | null;
  workplan_actual: number | null;
  workplan_points: number | null;
  components: SummaryResult["components"];
  inputs: SummaryCalcProps;
  engine_version: string;
  calculated_at: string;
  calculated_by: string | null;
}

export type PersistScoreSnapshotOutcome =
  | { written: true; row: ScoreSnapshotRow }
  | { written: false; reason: "appraisal_complete" };

const SECTION_COLUMNS = {
  cc: ["cc_actual", "cc_points"],
  prod: ["prod_actual", "prod_points"],
  technical: ["technical_actual", "technical_points"],
  leadership: ["leadership_actual", "leadership_points"],
  workplan: ["workplan_actual", "workplan_points"],
} as const;

function toJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function buildScoreSnapshotRow(
  params: Omit<PersistScoreSnapshotParams, "supabase">,
  calculatedAt: string = new Date().toISOString()
): ScoreSnapshotRow {
  const { appraisalId, scoreType, checkInId, isManagementTrack, input, result, actor } = params;

  if (!SCORE_SNAPSHOT_TYPES.includes(scoreType)) {
    throw new Error(`Invalid score snapshot type: ${String(scoreType)}`);
  }
  if (input.isManagementTrack !== isManagementTrack || result.isManagementTrack !== isManagementTrack) {
    throw new Error("Score snapshot track does not match the calculation input/result");
  }

  const sections: Record<string, number | null> = {};
  for (const [key, [actualCol, pointsCol]] of Object.entries(SECTION_COLUMNS)) {
    const component = result.components.find((c) => c.key === key);
    sections[actualCol] = component ? component.actual : null;
    sections[pointsCol] = component ? component.points : null;
  }

  return {
    appraisal_id: appraisalId,
    score_type: scoreType,
    revision: 1,
    check_in_id: checkInId ?? null,
    is_management_track: isManagementTrack,
    total_points: result.totalPoints,
    overall_grade: result.overallGrade ?? null,
    grade_label: result.gradeBand ?? null,
    cc_actual: sections.cc_actual,
    cc_points: sections.cc_points,
    prod_actual: sections.prod_actual,
    prod_points: sections.prod_points,
    technical_actual: sections.technical_actual,
    technical_points: sections.technical_points,
    leadership_actual: sections.leadership_actual,
    leadership_points: sections.leadership_points,
    workplan_actual: sections.workplan_actual,
    workplan_points: sections.workplan_points,
    components: toJson(result.components),
    inputs: toJson({
      workplanItems: input.workplanItems,
      competencies: input.competencies,
      technical: input.technical,
      productivity: input.productivity,
      leadership: input.leadership ?? [],
      isManagementTrack: input.isManagementTrack,
    }),
    engine_version: SUMMARY_ENGINE_VERSION,
    calculated_at: calculatedAt,
    calculated_by: actor,
  };
}

/** The current (not superseded) snapshot of a type for an appraisal, or null. */
export async function findScoreSnapshot(
  supabase: SupabaseClient,
  appraisalId: string,
  scoreType: ScoreSnapshotType
): Promise<{ id: string; check_in_id: string | null; revision: number } | null> {
  const { data, error } = await supabase
    .from("appraisal_score_snapshots")
    .select("id, check_in_id, revision")
    .eq("appraisal_id", appraisalId)
    .eq("score_type", scoreType)
    .is("superseded_at", null)
    .maybeSingle();
  if (error) throw new Error(`Score snapshot lookup failed: ${error.message}`);
  if (!data) return null;
  const row = data as { id: string; check_in_id: string | null; revision?: number | null };
  return { id: row.id, check_in_id: row.check_in_id, revision: Number(row.revision ?? 1) || 1 };
}

/** Read-only headline fields of a stored snapshot, for presentation and reporting. */
export interface ScoreSnapshotSummary {
  appraisal_id: string;
  score_type: ScoreSnapshotType;
  revision: number;
  total_points: number;
  overall_grade: string | null;
  grade_label: string | null;
  check_in_id: string | null;
  is_management_track: boolean;
  calculated_at: string;
}

const SUMMARY_COLUMNS =
  "appraisal_id, score_type, total_points, overall_grade, grade_label, check_in_id, is_management_track, calculated_at";

function toSummary(row: Record<string, unknown>): ScoreSnapshotSummary {
  return {
    appraisal_id: String(row.appraisal_id),
    score_type: row.score_type as ScoreSnapshotType,
    revision: Number(row.revision ?? 1) || 1,
    total_points: Number(row.total_points),
    overall_grade: (row.overall_grade as string | null) ?? null,
    grade_label: (row.grade_label as string | null) ?? null,
    check_in_id: (row.check_in_id as string | null) ?? null,
    is_management_track: row.is_management_track === true,
    calculated_at: String(row.calculated_at ?? ""),
  };
}

/** The current MIDYEAR and FINAL snapshots of one appraisal, keyed by type (absent when not recorded). */
export async function loadScoreSnapshotSummaries(
  supabase: SupabaseClient,
  appraisalId: string
): Promise<Partial<Record<ScoreSnapshotType, ScoreSnapshotSummary>>> {
  const { data, error } = await supabase
    .from("appraisal_score_snapshots")
    .select(`${SUMMARY_COLUMNS}, revision`)
    .eq("appraisal_id", appraisalId)
    .in("score_type", [...SCORE_SNAPSHOT_TYPES])
    .is("superseded_at", null);
  if (error) throw new Error(`Score snapshot lookup failed: ${error.message}`);
  const out: Partial<Record<ScoreSnapshotType, ScoreSnapshotSummary>> = {};
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const s = toSummary(row);
    if (SCORE_SNAPSHOT_TYPES.includes(s.score_type) && !out[s.score_type]) out[s.score_type] = s;
  }
  return out;
}

/** One recorded MIDYEAR score revision, current or superseded. */
export interface MidyearScoreRevision {
  revision: number;
  total_points: number;
  overall_grade: string | null;
  grade_label: string | null;
  check_in_id: string | null;
  calculated_at: string;
  superseded_at: string | null;
}

/** Every MIDYEAR revision of one appraisal, oldest first. The current one has superseded_at null. */
export async function listMidyearScoreRevisions(supabase: SupabaseClient, appraisalId: string): Promise<MidyearScoreRevision[]> {
  const { data, error } = await supabase
    .from("appraisal_score_snapshots")
    .select("revision, total_points, overall_grade, grade_label, check_in_id, calculated_at, superseded_at")
    .eq("appraisal_id", appraisalId)
    .eq("score_type", "MIDYEAR")
    .order("revision", { ascending: true });
  if (error) throw new Error(`Score snapshot lookup failed: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    revision: Number(row.revision ?? 1) || 1,
    total_points: Number(row.total_points),
    overall_grade: (row.overall_grade as string | null) ?? null,
    grade_label: (row.grade_label as string | null) ?? null,
    check_in_id: (row.check_in_id as string | null) ?? null,
    calculated_at: String(row.calculated_at ?? ""),
    superseded_at: (row.superseded_at as string | null) ?? null,
  }));
}

const ID_CHUNK = 200;

/**
 * Current snapshots of exactly one score type for the given appraisals: one entry per appraisal.
 * Reports call this once per type, so MIDYEAR and FINAL are never mixed. Superseded MIDYEAR
 * revisions are excluded; FINAL has a single revision, so its query is unchanged.
 */
export async function listScoreSnapshotsByType(
  supabase: SupabaseClient,
  scoreType: ScoreSnapshotType,
  appraisalIds: string[]
): Promise<Map<string, ScoreSnapshotSummary>> {
  if (!SCORE_SNAPSHOT_TYPES.includes(scoreType)) throw new Error(`Invalid score snapshot type: ${String(scoreType)}`);
  const out = new Map<string, ScoreSnapshotSummary>();
  const ids = [...new Set(appraisalIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    let query = supabase
      .from("appraisal_score_snapshots")
      .select(scoreType === "MIDYEAR" ? `${SUMMARY_COLUMNS}, revision` : SUMMARY_COLUMNS)
      .eq("score_type", scoreType)
      .in("appraisal_id", ids.slice(i, i + ID_CHUNK));
    if (scoreType === "MIDYEAR") query = query.is("superseded_at", null);
    const { data, error } = await query;
    if (error) throw new Error(`Score snapshot lookup failed: ${error.message}`);
    for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
      const s = toSummary(row);
      if (s.score_type === scoreType && !out.has(s.appraisal_id)) out.set(s.appraisal_id, s);
    }
  }
  return out;
}

/**
 * FINAL: upserts the single row for the appraisal. MIDYEAR: adds the next revision and keeps every
 * earlier one; a current revision still in place is marked superseded first, never overwritten.
 * Once the appraisal is COMPLETE an existing snapshot is never replaced; the skip is logged.
 */
export async function persistScoreSnapshot(
  params: PersistScoreSnapshotParams
): Promise<PersistScoreSnapshotOutcome> {
  const { supabase, ...rest } = params;
  const row = buildScoreSnapshotRow(rest);

  const { data: appraisal, error: appErr } = await supabase
    .from("appraisals")
    .select("status")
    .eq("id", row.appraisal_id)
    .single();
  if (appErr || !appraisal) {
    throw new Error(`Score snapshot: appraisal not found (${appErr?.message ?? "no row"})`);
  }

  if (String(appraisal.status).toUpperCase() === "COMPLETE") {
    const { data: existing, error: existingErr } = await supabase
      .from("appraisal_score_snapshots")
      .select("id")
      .eq("appraisal_id", row.appraisal_id)
      .eq("score_type", row.score_type)
      .is("superseded_at", null)
      .maybeSingle();
    if (existingErr) throw new Error(`Score snapshot lookup failed: ${existingErr.message}`);
    if (existing) {
      console.warn(
        `[score-snapshot] ${row.score_type} snapshot for appraisal ${row.appraisal_id} not overwritten: appraisal is COMPLETE`
      );
      return { written: false, reason: "appraisal_complete" };
    }
  }

  if (row.score_type === "FINAL") {
    const { error } = await supabase
      .from("appraisal_score_snapshots")
      .upsert(row, { onConflict: "appraisal_id,score_type,revision" });
    if (error) throw new Error(`Failed to store score snapshot: ${error.message}`);
  } else {
    const { data: prior, error: priorErr } = await supabase
      .from("appraisal_score_snapshots")
      .select("id, revision, superseded_at")
      .eq("appraisal_id", row.appraisal_id)
      .eq("score_type", row.score_type);
    if (priorErr) throw new Error(`Score snapshot lookup failed: ${priorErr.message}`);
    const revisions = (prior ?? []) as { id: string; revision?: number | null; superseded_at?: string | null }[];
    const current = revisions.find((r) => r.superseded_at == null);
    if (current) {
      const { error: supErr } = await supabase
        .from("appraisal_score_snapshots")
        .update({ superseded_at: row.calculated_at, superseded_by: row.calculated_by })
        .eq("id", current.id);
      if (supErr) throw new Error(`Failed to supersede score snapshot: ${supErr.message}`);
    }
    row.revision = revisions.reduce((max, r) => Math.max(max, Number(r.revision ?? 1) || 1), 0) + 1;
    const { error } = await supabase.from("appraisal_score_snapshots").insert(row);
    if (error) throw new Error(`Failed to store score snapshot: ${error.message}`);
  }

  await recordScoreSnapshotAudit(supabase, row);
  return { written: true, row };
}

const SNAPSHOT_AUDIT_SUMMARY: Record<ScoreSnapshotType, string> = {
  MIDYEAR: "Mid-Year score recorded",
  FINAL: "Final score recorded",
};

/** Non-blocking audit of a stored snapshot. Identifies the calculation, not the score itself. */
async function recordScoreSnapshotAudit(supabase: SupabaseClient, row: ScoreSnapshotRow): Promise<void> {
  const revised = row.score_type === "MIDYEAR" && row.revision > 1;
  try {
    await supabase.from("appraisal_audit").insert({
      appraisal_id: row.appraisal_id,
      action_type: "score_snapshot_recorded",
      actor_id: row.calculated_by,
      summary: revised ? `Revised Mid-Year score recorded (revision ${row.revision})` : SNAPSHOT_AUDIT_SUMMARY[row.score_type],
      detail: {
        score_type: row.score_type,
        check_in_id: row.check_in_id,
        is_management_track: row.is_management_track,
        engine_version: row.engine_version,
        calculated_at: row.calculated_at,
        ...(row.score_type === "MIDYEAR" ? { revision: row.revision, superseded_revision: revised ? row.revision - 1 : null } : {}),
      },
    });
  } catch (err) {
    console.error("[score-snapshot] audit not recorded:", err);
  }
}
