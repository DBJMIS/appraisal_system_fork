/**
 * Server-side completion report: loads the appraisal's data and runs calcCompletion.
 * Kept apart from lib/appraisal-completion.ts, which the Workplan editor imports in the browser,
 * because the management track is resolved from Dynamics HR.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { calcCompletion, type CompletionReport } from "@/lib/appraisal-completion";
import { resolveManagementTrack } from "@/lib/management-track";

/**
 * Fetches all data needed for completion and returns CompletionReport.
 * Used by GET /api/appraisals/[id]/completion and by submit APIs for validation.
 */
export async function fetchCompletionReport(
  supabase: SupabaseClient,
  appraisalId: string,
  options?: { showLeadershipParam?: boolean }
): Promise<CompletionReport | null> {
  const { data: appraisal, error: appErr } = await supabase
    .from("appraisals")
    .select("id, employee_id, status, is_management")
    .eq("id", appraisalId)
    .single();

  if (appErr || !appraisal) return null;

  const showLeadershipParam = options?.showLeadershipParam ?? false;
  const finalShowLeadership =
    showLeadershipParam ||
    (await resolveManagementTrack({ employee_id: appraisal.employee_id, is_management: appraisal.is_management }));

  let workplanItems: Array<Record<string, unknown>> = [];
  const { data: wpData } = await supabase
    .from("workplans")
    .select("id")
    .eq("appraisal_id", appraisalId)
    .maybeSingle();
  if (wpData?.id) {
    const { data: items } = await supabase
      .from("workplan_items")
      .select("*")
      .eq("workplan_id", wpData.id)
      .order("created_at", { ascending: true });
    workplanItems = (items ?? []) as Array<Record<string, unknown>>;
  }

  const { data: ratingData } = await supabase
    .from("appraisal_factor_ratings")
    .select("factor_id, self_rating_code, manager_rating_code, weight")
    .eq("appraisal_id", appraisalId);
  const factorRatings = (ratingData ?? []) as Array<{ factor_id: string; self_rating_code?: string | null; manager_rating_code?: string | null; weight?: number | null }>;

  const { data: coreCat } = await supabase
    .from("evaluation_categories")
    .select("id")
    .eq("category_type", "core")
    .eq("active", true);
  const coreCatIds = (coreCat ?? []).map((c: { id: string }) => c.id);
  const { data: prodCat } = await supabase
    .from("evaluation_categories")
    .select("id")
    .eq("category_type", "productivity")
    .eq("active", true);
  const prodCatIds = (prodCat ?? []).map((c: { id: string }) => c.id);
  const { data: leadCat } = await supabase
    .from("evaluation_categories")
    .select("id")
    .eq("category_type", "leadership")
    .eq("active", true);
  const leadCatIds = (leadCat ?? []).map((c: { id: string }) => c.id);

  const coreFactorIds: string[] = [];
  const productivityFactorIds: string[] = [];
  const leadershipFactorIds: string[] = [];
  if (coreCatIds.length > 0) {
    const { data: factors } = await supabase
      .from("evaluation_factors")
      .select("id")
      .in("category_id", coreCatIds)
      .eq("active", true);
    (factors ?? []).forEach((f: { id: string }) => coreFactorIds.push(f.id));
  }
  if (prodCatIds.length > 0) {
    const { data: prodFactors } = await supabase
      .from("evaluation_factors")
      .select("id")
      .in("category_id", prodCatIds)
      .eq("active", true);
    (prodFactors ?? []).forEach((f: { id: string }) => productivityFactorIds.push(f.id));
  }
  if (leadCatIds.length > 0 && finalShowLeadership) {
    const { data: leadFactors } = await supabase
      .from("evaluation_factors")
      .select("id")
      .in("category_id", leadCatIds)
      .eq("active", true);
    (leadFactors ?? []).forEach((f: { id: string }) => leadershipFactorIds.push(f.id));
  }

  const { data: techData } = await supabase
    .from("appraisal_technical_competencies")
    .select("id, self_rating, manager_rating, weight")
    .eq("appraisal_id", appraisalId)
    .order("display_order");
  const technicalCompetencies = (techData ?? []) as Array<{ id: string; self_rating?: string | null; manager_rating?: string | null; weight?: number | null }>;

  return calcCompletion({
    workplanItems: workplanItems as Array<{
      id: string;
      major_task?: string | null;
      key_output?: string | null;
      performance_standard?: string | null;
      weight?: number | null;
      actual_result?: number | null;
      corporate_objective?: string | null;
      division_objective?: string | null;
      individual_objective?: string | null;
    }>,
    appraisalStatus: appraisal.status ?? "DRAFT",
    factorRatings,
    coreFactorIds,
    productivityFactorIds,
    leadershipFactorIds,
    technicalCompetencies,
    showLeadership: finalShowLeadership,
  });
}
