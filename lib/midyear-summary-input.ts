/**
 * Builds calcSummary() input for a formal Mid-Year Review, from its own frozen inputs only.
 * Mirrors buildSummaryInput() (annual) field-for-field so the canonical engine scores both the same
 * way. It never reads annual assessment tables, live weights, or the live management flag.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BuildSummaryInputResult } from "@/lib/appraisal-summary-input";
import type { WeightedRatingItem, WorkplanItemSummary } from "@/lib/summary-calc";
import { calcMidyearCompleteness, type CompletenessCompetency, type CompletenessResponse } from "@/lib/midyear-lifecycle";

export type MidyearScoringErrorCode =
  | "NOT_FOUND"
  | "NOT_SCORED"
  | "CANCELLED"
  | "TRACK_NOT_FROZEN"
  | "INCOMPLETE"
  | "LOAD_FAILED";

export interface MidyearScoringError {
  code: MidyearScoringErrorCode;
  message: string;
  blockers: string[];
}

export type MidyearSummaryInputResult =
  | { ok: true; input: BuildSummaryInputResult; appraisalId: string }
  | { ok: false; error: MidyearScoringError };

type ResponseRow = CompletenessResponse & { workplan_item_id: string };
type CompetencyRow = CompletenessCompetency & { display_order?: number | null };

const fail = (code: MidyearScoringErrorCode, message: string, blockers: string[] = []): MidyearSummaryInputResult => ({
  ok: false,
  error: { code, message, blockers },
});

const toNumber = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Same precedence as the annual engine input: manager result when present, else the employee's own result. */
export function midyearWorkplanItem(r: CompletenessResponse): WorkplanItemSummary {
  return {
    weight: toNumber(r.weight_snapshot) ?? 0,
    actual_result: toNumber(r.mgr_result) ?? toNumber(r.employee_result),
  };
}

/** Same shape as the annual factor/technical items: manager rating is final, self rating kept alongside. */
export function midyearRatingItem(c: CompletenessCompetency): WeightedRatingItem {
  return {
    manager_rating: c.manager_rating_code ?? null,
    self_rating: c.employee_rating_code ?? null,
    weight: toNumber(c.weight_snapshot) ?? 0,
  };
}

/**
 * Loads the calcSummary() input for a formal scored Mid-Year Review. Returns a controlled error instead
 * of an input whenever the review is not scoreable from its own data.
 */
export async function buildMidyearSummaryInput(
  checkInId: string,
  supabase: SupabaseClient
): Promise<MidyearSummaryInputResult> {
  const { data: checkIn, error: ciErr } = await supabase
    .from("check_ins")
    .select("id, appraisal_id, review_mode, is_management_track, status")
    .eq("id", checkInId)
    .maybeSingle();
  if (ciErr) return fail("LOAD_FAILED", ciErr.message);
  if (!checkIn) return fail("NOT_FOUND", "Mid-Year Review not found.");

  const row = checkIn as {
    appraisal_id: string;
    review_mode?: string | null;
    is_management_track?: boolean | null;
    status?: string | null;
  };
  if (row.review_mode !== "FORMAL_SCORED") {
    return fail("NOT_SCORED", "Only a scored formal Mid-Year Review can be scored.");
  }
  if (row.status === "CANCELLED") return fail("CANCELLED", "A cancelled Mid-Year Review cannot be scored.");
  if (row.is_management_track == null) {
    return fail("TRACK_NOT_FROZEN", "The Mid-Year Review has no frozen management track.");
  }
  const isManagementTrack = row.is_management_track;

  const [{ data: responses, error: rErr }, { data: competencies, error: cErr }] = await Promise.all([
    supabase
      .from("check_in_responses")
      .select("workplan_item_id, weight_snapshot, employee_result, mgr_result")
      .eq("check_in_id", checkInId),
    supabase
      .from("check_in_competency_ratings")
      .select("section, weight_snapshot, employee_rating_code, manager_rating_code, display_order")
      .eq("check_in_id", checkInId)
      .order("display_order", { ascending: true }),
  ]);
  if (rErr || cErr) return fail("LOAD_FAILED", (rErr ?? cErr)!.message);

  const responseRows = (responses ?? []) as ResponseRow[];
  const competencyRows = (competencies ?? []) as CompetencyRow[];

  const completeness = calcMidyearCompleteness({
    reviewMode: row.review_mode,
    responses: responseRows,
    competencies: competencyRows,
    isManagementTrack,
  });
  const blockers = [...completeness.weights, ...completeness.manager];
  if (blockers.length > 0) {
    return fail("INCOMPLETE", "The Mid-Year Review is not complete enough to score.", blockers);
  }

  const bySection = (section: string) =>
    competencyRows.filter((c) => c.section === section).map(midyearRatingItem);

  return {
    ok: true,
    appraisalId: row.appraisal_id,
    input: {
      workplanItems: responseRows.map(midyearWorkplanItem),
      competencies: bySection("CORE"),
      technical: bySection("TECHNICAL"),
      productivity: bySection("PRODUCTIVITY"),
      leadership: isManagementTrack ? bySection("LEADERSHIP") : [],
      isManagementTrack,
    },
  };
}
