/**
 * Fetches all data required to render the DBJ appraisal PDF.
 * Used by lib/appraisal-pdf.ts only; does not affect UI or other APIs.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildSummaryInput } from "@/lib/appraisal-summary-input";
import { resolveManagementTrack } from "@/lib/management-track";
import { getReportingStructure, getReportingStructureFromDynamics } from "@/lib/reporting-structure";
import { calcSummary, GRADE_BANDS, type SummaryCalcProps, type SummaryResult } from "@/lib/summary-calc";

export interface WorkplanItemRow {
  corporate_objective: string;
  division_objective: string;
  individual_objective: string;
  major_task: string;
  key_output: string;
  performance_standard: string;
  weight: number;
  metric_target: string | null;
  employee_actual_result: string | null;
  actual_result: string | null;
  employee_points: number | null;
  points: number | null;
}

export interface FactorRatingRow {
  factor_name: string;
  description: string | null;
  weight: number | null;
  self_rating_code: string | null;
  manager_rating_code: string | null;
  self_comments: string | null;
  manager_comments: string | null;
}

export interface AppraisalPDFData {
  appraisal: { id: string; is_management: boolean; showLeadership: boolean };
  employee: { full_name: string | null; job_title: string | null; division_name: string | null; department_name?: string | null };
  manager: { full_name: string | null; job_title: string | null } | null;
  hrOfficer: { full_name: string | null } | null;
  cycle: { name: string; start_date: string | null; end_date: string | null; fiscal_year: string | null } | null;
  workplanItems: WorkplanItemRow[];
  coreRatings: FactorRatingRow[];
  technicalRatings: FactorRatingRow[];
  productivityRatings: FactorRatingRow[];
  leadershipRatings: FactorRatingRow[];
  scores: {
    workplan: number | string;
    competency: number | string;
    overall: number | string;
    ratingLabel: string;
    coreScore: number | string;
    technicalScore: number | string;
    productivityScore: number | string;
    leadershipScore: number | string;
    coreSelfScore: number | string;
    coreMgrScore: number | string;
    productivitySelfScore: number | string;
    productivityMgrScore: number | string;
    leadershipSelfScore?: number | string;
    leadershipMgrScore?: number | string;
    workplanTotal: number | string;
    selfWorkplanTotal: number | string;
  };
  /** Summary components (key, name, weight, points) for Section F table; order matches calcSummary. */
  summaryComponents: { key: string; name: string; weight: number; points: number }[];
  hrRecommendation: { recommendation: string; comments: string };
  /** The exact calcSummary input and result behind the printed scores; null when the calculation failed. Not rendered. */
  scoreSource: PDFScoreSource | null;
}

export interface PDFScoreSource {
  isManagementTrack: boolean;
  input: SummaryCalcProps;
  result: SummaryResult;
}

function weightTimesFactor(code: string | null): number {
  const map: Record<string, number> = {
    A: 1, B: 0.8, C: 0.6, D: 0.4, E: 0.2,
    "1": 0.1, "2": 0.2, "3": 0.3, "4": 0.4, "5": 0.5,
    "6": 0.6, "7": 0.7, "8": 0.8, "9": 0.9, "10": 1,
  };
  return code ? map[code] ?? 0 : 0;
}

function sectionScore(items: FactorRatingRow[], useManager: boolean): number {
  let sum = 0;
  let totalWeight = 0;
  for (const r of items) {
    const w = Number(r.weight) || 0;
    if (w <= 0) continue;
    const code = useManager ? r.manager_rating_code : r.self_rating_code;
    const factor = weightTimesFactor(code);
    sum += w * factor;
    totalWeight += w;
  }
  if (totalWeight <= 0) return 0;
  return Math.round((sum / totalWeight) * 100);
}

export async function fetchAppraisalPDFData(
  appraisalId: string,
  supabase: SupabaseClient
): Promise<AppraisalPDFData> {
  const { data: appraisal, error: appErr } = await supabase
    .from("appraisals")
    .select("id, employee_id, manager_employee_id, cycle_id, is_management")
    .eq("id", appraisalId)
    .single();

  if (appErr || !appraisal) throw new Error("Appraisal not found");

  let structure;
  try {
    structure = await getReportingStructureFromDynamics(appraisal.employee_id, null);
  } catch {
    structure = await getReportingStructure(appraisal.employee_id);
  }
  const showLeadership = await resolveManagementTrack({
    employee_id: appraisal.employee_id,
    is_management: appraisal.is_management,
  });

  const [empRes, mgrRes, cycleRes, hrRes] = await Promise.all([
    supabase.from("employees").select("full_name, job_title, division_name, department_name").eq("employee_id", appraisal.employee_id).single(),
    appraisal.manager_employee_id
      ? supabase.from("employees").select("full_name, job_title").eq("employee_id", appraisal.manager_employee_id).single()
      : Promise.resolve({ data: null }),
    supabase.from("appraisal_cycles").select("name, start_date, end_date, fiscal_year").eq("id", appraisal.cycle_id).single(),
    supabase.from("app_users").select("employee_id, display_name").in("role", ["hr", "admin"]).eq("is_active", true).limit(1).maybeSingle(),
  ]);

  const empFromDb = empRes.data ?? { full_name: "—", job_title: null, division_name: null, department_name: null };
  const profile = structure.currentUserProfile;
  const employee = {
    ...empFromDb,
    job_title: empFromDb.job_title ?? profile?.job_title ?? null,
    division_name: empFromDb.division_name ?? profile?.division_name ?? null,
    department_name: (empFromDb as { department_name?: string | null }).department_name ?? profile?.department_name ?? null,
  };
  const manager = mgrRes.data ?? null;
  const cycle = cycleRes.data ?? null;

  let hrOfficer: { full_name: string | null } | null = null;
  if (hrRes.data) {
    if (hrRes.data.employee_id) {
      const { data: hrEmp } = await supabase.from("employees").select("full_name").eq("employee_id", hrRes.data.employee_id).single();
      hrOfficer = { full_name: hrEmp?.full_name ?? hrRes.data.display_name ?? "HR Officer" };
    } else {
      hrOfficer = { full_name: hrRes.data.display_name ?? "HR Officer" };
    }
  }

  const { data: workplan } = await supabase.from("workplans").select("id").eq("appraisal_id", appraisalId).single();
  let workplanItems: WorkplanItemRow[] = [];
  if (workplan?.id) {
    const { data: items } = await supabase
      .from("workplan_items")
      .select("corporate_objective, division_objective, individual_objective, major_task, key_output, performance_standard, weight, metric_target, actual_result, mgr_result, employee_actual_result, employee_points, points")
      .eq("workplan_id", workplan.id)
      .order("created_at", { ascending: true });

    workplanItems = (items ?? []).map((i: Record<string, unknown>) => {
      const effectiveResult = i.mgr_result != null && i.mgr_result !== "" ? Number(i.mgr_result) : i.actual_result != null ? Number(i.actual_result) : null;
      const selfResult = i.employee_actual_result != null ? Number(i.employee_actual_result) : null;
      return {
        corporate_objective: String(i.corporate_objective ?? ""),
        division_objective: String(i.division_objective ?? ""),
        individual_objective: String(i.individual_objective ?? ""),
        major_task: String((i.major_task ?? i.task) ?? ""),
        key_output: String((i.key_output ?? i.output) ?? ""),
        performance_standard: String(i.performance_standard ?? ""),
        weight: Number(i.weight ?? 0),
        metric_target: i.metric_target != null ? String(i.metric_target) : null,
        employee_actual_result: selfResult != null ? String(selfResult) : null,
        actual_result: effectiveResult != null ? String(effectiveResult) : null,
        employee_points: i.employee_points != null ? Number(i.employee_points) : null,
        points: i.points != null ? Number(i.points) : null,
      };
    });
  }

  const { data: categories } = await supabase
    .from("evaluation_categories")
    .select("id, category_type")
    .in("category_type", ["core", "productivity", "leadership"])
    .eq("active", true);

  const catIds = (categories ?? []).map((c: { id: string }) => c.id);
  let factorRows: { id: string; category_id: string; name: string; description: string | null; weight: number | null; display_order: number }[] = [];
  if (catIds.length > 0) {
    const { data: factors } = await supabase
      .from("evaluation_factors")
      .select("id, category_id, name, description, weight, display_order")
      .in("category_id", catIds)
      .eq("active", true);
    factorRows = (factors ?? []) as { id: string; category_id: string; name: string; description: string | null; weight: number | null; display_order: number }[];
  }

  const categoryTypes: Record<string, string> = Object.fromEntries(
    (categories ?? []).map((c: { id: string; category_type: string }) => [c.id, c.category_type])
  );
  const factorMeta = Object.fromEntries(factorRows.map((f) => [f.id, { category_id: f.category_id, name: f.name, description: f.description, weight: f.weight, display_order: f.display_order ?? 0 }]));

  const { data: ratingRows } = await supabase
    .from("appraisal_factor_ratings")
    .select("factor_id, self_rating_code, manager_rating_code, self_comments, manager_comments, weight")
    .eq("appraisal_id", appraisalId);

  const toRating = (r: { factor_id: string; self_rating_code: string | null; manager_rating_code: string | null; self_comments: string | null; manager_comments: string | null; weight?: number | null }) => {
    const meta = factorMeta[r.factor_id];
    return {
      factor_name: meta?.name ?? "—",
      description: meta?.description ?? null,
      weight: (r as { weight?: number | null }).weight ?? meta?.weight ?? null,
      self_rating_code: r.self_rating_code,
      manager_rating_code: r.manager_rating_code,
      self_comments: r.self_comments,
      manager_comments: r.manager_comments,
    };
  };

  const byCategory = (type: string): FactorRatingRow[] => {
    return (ratingRows ?? [])
      .filter((r: { factor_id: string }) => {
        const meta = factorMeta[r.factor_id];
        return meta && categoryTypes[meta.category_id] === type;
      })
      .sort((a: { factor_id: string }, b: { factor_id: string }) => (factorMeta[a.factor_id]?.display_order ?? 0) - (factorMeta[b.factor_id]?.display_order ?? 0))
      .map((r: { factor_id: string; self_rating_code: string | null; manager_rating_code: string | null; self_comments: string | null; manager_comments: string | null; weight?: number | null }) => toRating(r));
  };

  const coreRatings = byCategory("core");
  const productivityRatings = byCategory("productivity");
  const leadershipRatings = showLeadership ? byCategory("leadership") : [];

  const { data: techRows } = await supabase
    .from("appraisal_technical_competencies")
    .select("name, self_rating, manager_rating, self_comments, manager_comments, display_order")
    .eq("appraisal_id", appraisalId)
    .order("display_order");

  const technicalRatings: FactorRatingRow[] = (techRows ?? []).map((r: Record<string, unknown>) => ({
    factor_name: String(r.name ?? ""),
    description: null,
    weight: null,
    self_rating_code: r.self_rating != null ? String(r.self_rating) : null,
    manager_rating_code: r.manager_rating != null ? String(r.manager_rating) : null,
    self_comments: r.self_comments != null ? String(r.self_comments) : null,
    manager_comments: r.manager_comments != null ? String(r.manager_comments) : null,
  }));

  let summaryResult: SummaryResult | null = null;
  let scoreSource: PDFScoreSource | null = null;
  try {
    const input = await buildSummaryInput(appraisalId, supabase, { showLeadership });
    summaryResult = calcSummary(input);
    scoreSource = { isManagementTrack: input.isManagementTrack, input, result: summaryResult };
  } catch {
    // leave scores as defaults
  }

  const workplanTotal = workplanItems.reduce((s, i) => s + (i.points ?? 0), 0);
  const selfWorkplanTotal = workplanItems.reduce((s, i) => s + (i.employee_points ?? 0), 0);

  const workplanComp = summaryResult?.components.find((c) => c.key === "workplan");
  const ccComp = summaryResult?.components.find((c) => c.key === "cc");
  const prodComp = summaryResult?.components.find((c) => c.key === "prod");
  const techComp = summaryResult?.components.find((c) => c.key === "technical");
  const leadComp = summaryResult?.components.find((c) => c.key === "leadership");

  const coreMgrScore = sectionScore(coreRatings, true);
  const coreSelfScore = sectionScore(coreRatings, false);
  const productivityMgrScore = sectionScore(productivityRatings, true);
  const productivitySelfScore = sectionScore(productivityRatings, false);
  const leadershipMgrScore = sectionScore(leadershipRatings, true);
  const leadershipSelfScore = sectionScore(leadershipRatings, false);

  const technicalScore = technicalRatings.length
    ? Math.round(
        (technicalRatings.reduce((s, r) => s + weightTimesFactor(r.manager_rating_code ?? r.self_rating_code) * 100, 0) / technicalRatings.length)
      )
    : 0;

  const ratingLabel = summaryResult ? GRADE_BANDS[summaryResult.overallGrade as keyof typeof GRADE_BANDS]?.label ?? "—" : "—";

  const { data: hrRec } = await supabase
    .from("appraisal_hr_recommendations")
    .select("recommendations, other_notes")
    .eq("appraisal_id", appraisalId)
    .maybeSingle();

  const rec = (hrRec?.recommendations as Record<string, boolean> | null) ?? {};
  const recLabels: string[] = [];
  const labels: Record<string, string> = {
    pay_increment: "Pay Increment",
    withhold_increment: "Withhold Increment",
    suitable_for_promotion: "Suitable for Promotion",
    remedial_action: "Remedial Action",
    probation: "Probation",
    eligible_for_award: "Eligible for Award",
    not_eligible_for_award: "Not Eligible for Award",
    job_enrichment: "Job Enrichment",
    reassignment: "Reassignment",
    separation: "Separation",
  };
  for (const [k, v] of Object.entries(rec)) {
    if (v && labels[k]) recLabels.push(labels[k]);
  }

  return {
    appraisal: { id: appraisal.id, is_management: !!appraisal.is_management, showLeadership },
    employee: { ...employee },
    manager,
    hrOfficer,
    cycle,
    workplanItems,
    coreRatings,
    technicalRatings,
    productivityRatings,
    leadershipRatings,
    scores: {
      workplan: workplanComp?.points ?? workplanTotal.toFixed(1) ?? "—",
      competency: summaryResult ? (ccComp?.points ?? 0) + (prodComp?.points ?? 0) + (techComp?.points ?? 0) + (leadComp?.points ?? 0) : "—",
      overall: summaryResult?.totalPoints ?? "—",
      ratingLabel,
      coreScore: ccComp?.points ?? coreMgrScore,
      technicalScore: summaryResult && techComp != null ? techComp.points : (technicalRatings.length ? technicalScore : "—"),
      productivityScore: prodComp?.points ?? productivityMgrScore,
      leadershipScore: leadComp?.points ?? leadershipMgrScore,
      coreSelfScore,
      coreMgrScore,
      productivitySelfScore,
      productivityMgrScore,
      leadershipSelfScore,
      leadershipMgrScore,
      workplanTotal: workplanTotal > 0 ? workplanTotal.toFixed(1) : "—",
      selfWorkplanTotal: selfWorkplanTotal > 0 ? selfWorkplanTotal.toFixed(1) : "—",
    },
    summaryComponents: (summaryResult?.components ?? []).map((c) => ({
      key: c.key,
      name: c.name,
      weight: c.weight,
      points: c.points,
    })),
    hrRecommendation: {
      recommendation: recLabels.length ? recLabels.join(", ") : "—",
      comments: (hrRec?.other_notes as string) ?? "",
    },
    scoreSource,
  };
}
