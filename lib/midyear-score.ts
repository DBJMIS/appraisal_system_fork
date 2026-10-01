/**
 * MIDYEAR score: buildMidyearSummaryInput() → calcSummary() → persistScoreSnapshot('MIDYEAR').
 * Writes only the score snapshot table. Server-only: callers pass a service-role client.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { calcSummary, type SummaryResult } from "@/lib/summary-calc";
import { findScoreSnapshot, persistScoreSnapshot, type ScoreSnapshotRow } from "@/lib/appraisal-score-snapshot";
import { buildMidyearSummaryInput, type MidyearScoringError } from "@/lib/midyear-summary-input";

export type MidyearScoreOutcome =
  | { ok: true; written: true; row: ScoreSnapshotRow; result: SummaryResult }
  /** A MIDYEAR snapshot for this check-in already exists; it is left untouched. */
  | { ok: true; written: false; reason: "already_scored" }
  | { ok: false; error: MidyearScoringError | { code: "SNAPSHOT_CONFLICT"; message: string; blockers: string[] } };

export async function recordMidyearScore(
  supabase: SupabaseClient,
  params: { checkInId: string; actor: string | null }
): Promise<MidyearScoreOutcome> {
  const { checkInId, actor } = params;
  const built = await buildMidyearSummaryInput(checkInId, supabase);
  if (!built.ok) return built;

  const existing = await findScoreSnapshot(supabase, built.appraisalId, "MIDYEAR");
  if (existing) {
    const existingCheckIn = existing.check_in_id;
    if (existingCheckIn === checkInId) return { ok: true, written: false, reason: "already_scored" };
    if (existingCheckIn != null) {
      return {
        ok: false,
        error: {
          code: "SNAPSHOT_CONFLICT",
          message: "A Mid-Year score is already recorded for another Mid-Year Review on this appraisal.",
          blockers: [],
        },
      };
    }
  }

  const result = calcSummary(built.input);
  const outcome = await persistScoreSnapshot({
    supabase,
    appraisalId: built.appraisalId,
    scoreType: "MIDYEAR",
    checkInId,
    isManagementTrack: built.input.isManagementTrack,
    input: built.input,
    result,
    actor,
  });
  if (!outcome.written) {
    return {
      ok: false,
      error: { code: "SNAPSHOT_CONFLICT", message: "The appraisal is complete; its Mid-Year score cannot change.", blockers: [] },
    };
  }
  return { ok: true, written: true, row: outcome.row, result };
}
