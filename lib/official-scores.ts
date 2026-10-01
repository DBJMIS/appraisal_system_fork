/**
 * Official (annual) appraisal score for reporting: the FINAL score snapshot where one exists, otherwise
 * the legacy appraisal_section_scores.total_score the reports used before snapshots. MIDYEAR snapshots are
 * never read here. Exactly one score per appraisal.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { listScoreSnapshotsByType } from "@/lib/appraisal-score-snapshot";

export type OfficialScoreSource = "FINAL_SNAPSHOT" | "LEGACY_SECTION_SCORES";

export interface OfficialScore {
  appraisalId: string;
  total: number;
  source: OfficialScoreSource;
}

const ID_CHUNK = 200;

export async function loadOfficialScores(supabase: SupabaseClient, appraisalIds: string[]): Promise<Map<string, OfficialScore>> {
  const ids = [...new Set(appraisalIds.filter(Boolean))];
  const out = new Map<string, OfficialScore>();
  if (ids.length === 0) return out;

  try {
    const finals = await listScoreSnapshotsByType(supabase, "FINAL", ids);
    for (const [appraisalId, s] of finals) {
      if (Number.isFinite(s.total_points)) out.set(appraisalId, { appraisalId, total: s.total_points, source: "FINAL_SNAPSHOT" });
    }
  } catch (err) {
    // Before the snapshot table exists every appraisal falls back to the legacy score, as before.
    console.warn("[official-scores] FINAL snapshots unavailable; using legacy scores:", err instanceof Error ? err.message : err);
  }

  const missing = ids.filter((id) => !out.has(id));
  for (let i = 0; i < missing.length; i += ID_CHUNK) {
    const { data } = await supabase
      .from("appraisal_section_scores")
      .select("appraisal_id, total_score")
      .in("appraisal_id", missing.slice(i, i + ID_CHUNK));
    for (const row of (data ?? []) as { appraisal_id: string; total_score: number | string | null }[]) {
      if (row.total_score == null || out.has(row.appraisal_id)) continue;
      const total = Number(row.total_score);
      if (Number.isFinite(total)) out.set(row.appraisal_id, { appraisalId: row.appraisal_id, total, source: "LEGACY_SECTION_SCORES" });
    }
  }
  return out;
}

/** appraisal id → official total, the shape the reports already use. */
export async function loadOfficialScoreTotals(supabase: SupabaseClient, appraisalIds: string[]): Promise<Map<string, number>> {
  const scores = await loadOfficialScores(supabase, appraisalIds);
  return new Map([...scores].map(([id, s]) => [id, s.total]));
}
