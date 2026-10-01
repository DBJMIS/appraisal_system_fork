/**
 * Read-only Mid-Year context for the annual Final Review: the completed formal Mid-Year Review's
 * result per workplan item and its current MIDYEAR score, exactly as stored. Nothing is recalculated
 * and nothing here feeds annual results, completion or scoring. Server-only: callers pass a
 * service-role client.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadScoreSnapshotSummaries } from "@/lib/appraisal-score-snapshot";
import type { CompletenessResponse } from "@/lib/midyear-lifecycle";
import { midyearWorkplanItem } from "@/lib/midyear-summary-input";

export interface MidyearFinalReviewScore {
  total: number;
  grade: string | null;
  gradeLabel: string | null;
  revision: number;
}

export interface MidyearFinalReviewContext {
  /** True when the cycle has Mid-Year Review enabled and a formal Mid-Year Review is complete. */
  available: boolean;
  /** Effective Mid-Year result keyed by workplan_item_id: the value Mid-Year scoring used. */
  results: Record<string, number | null>;
  /** The current (not superseded) MIDYEAR snapshot of that review, or null. */
  score: MidyearFinalReviewScore | null;
}

export const NO_MIDYEAR_FINAL_REVIEW_CONTEXT: MidyearFinalReviewContext = { available: false, results: {}, score: null };

type ResponseRow = CompletenessResponse & { workplan_item_id: string };

export async function loadMidyearFinalReviewContext(
  supabase: SupabaseClient,
  appraisalId: string,
  midyearEnabled: boolean
): Promise<MidyearFinalReviewContext> {
  if (!midyearEnabled) return NO_MIDYEAR_FINAL_REVIEW_CONTEXT;

  // A reopened review is back in EMPLOYEE_SUBMITTED, so its in-progress revision is never read here.
  const { data: reviews, error } = await supabase
    .from("check_ins")
    .select("id, updated_at")
    .eq("appraisal_id", appraisalId)
    .eq("check_in_type", "MIDYEAR")
    .in("review_mode", ["FORMAL", "FORMAL_SCORED"])
    .eq("status", "COMPLETE")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`Mid-Year Review lookup failed: ${error.message}`);
  const completed = (reviews ?? []) as { id: string }[];
  if (completed.length === 0) return NO_MIDYEAR_FINAL_REVIEW_CONTEXT;

  const snapshot = (await loadScoreSnapshotSummaries(supabase, appraisalId)).MIDYEAR;
  const review = completed.find((r) => r.id === snapshot?.check_in_id) ?? completed[0];

  const { data: responses, error: rErr } = await supabase
    .from("check_in_responses")
    .select("workplan_item_id, weight_snapshot, employee_result, mgr_result")
    .eq("check_in_id", review.id);
  if (rErr) throw new Error(`Mid-Year results lookup failed: ${rErr.message}`);

  const results: Record<string, number | null> = {};
  for (const row of (responses ?? []) as ResponseRow[]) {
    if (row.workplan_item_id) results[row.workplan_item_id] = midyearWorkplanItem(row).actual_result ?? null;
  }

  return {
    available: true,
    results,
    score:
      snapshot && snapshot.check_in_id === review.id
        ? { total: snapshot.total_points, grade: snapshot.overall_grade, gradeLabel: snapshot.grade_label, revision: snapshot.revision }
        : null,
  };
}
