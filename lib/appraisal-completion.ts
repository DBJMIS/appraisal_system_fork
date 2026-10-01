/**
 * Appraisal completion calculation for the CompletionBar.
 * Aggregates workplan, factor ratings, and technical competencies.
 * The server-side loader is fetchCompletionReport in lib/appraisal-completion-report.ts.
 */

export interface CompletionSection {
  key: string;
  label: string;
  completed: number;
  total: number;
  required: boolean;
}

export interface CompletionReport {
  sections: CompletionSection[];
  completedFields: number;
  totalFields: number;
  canSubmit: boolean;
  blockers: string[];
}

interface WorkplanItem {
  id: string;
  major_task?: string | null;
  key_output?: string | null;
  performance_standard?: string | null;
  weight?: number | null;
  actual_result?: number | null;
  corporate_objective?: string | null;
  division_objective?: string | null;
  individual_objective?: string | null;
}

interface FactorRating {
  factor_id: string;
  self_rating_code?: string | null;
  manager_rating_code?: string | null;
  weight?: number | null;
}

interface TechnicalCompetency {
  id: string;
  self_rating?: string | null;
  manager_rating?: string | null;
  weight?: number | null;
}

const WEIGHT_TOLERANCE = 0.01;

/**
 * Workplan objective structure required by completion, returned as the Workplan column labels that are missing.
 * An objective is complete for planning when this returns an empty list. Shared with the Workplan editor's row hints.
 */
export function missingWorkplanItemFields(item: {
  major_task?: string | null;
  key_output?: string | null;
  performance_standard?: string | null;
  weight?: number | null;
}): string[] {
  const missing: string[] = [];
  if ((item.major_task ?? "").trim() === "") missing.push("Major Tasks");
  if ((item.key_output ?? "").trim() === "") missing.push("Key Outputs");
  if ((item.performance_standard ?? "").trim() === "") missing.push("Performance Standard");
  if (!((item.weight ?? 0) > 0)) missing.push("Weighting");
  return missing;
}

function sumWeightForFactorIds(ratings: FactorRating[], factorIds: string[]): number {
  let sum = 0;
  for (const fid of factorIds) {
    const r = ratings.find((x) => x.factor_id === fid);
    const w = r?.weight != null ? Number(r.weight) : 0;
    if (!Number.isNaN(w)) sum += w;
  }
  return sum;
}

export function calcCompletion(params: {
  workplanItems: WorkplanItem[];
  appraisalStatus: string;
  factorRatings: FactorRating[];
  coreFactorIds: string[];
  productivityFactorIds: string[];
  leadershipFactorIds: string[];
  technicalCompetencies: TechnicalCompetency[];
  showLeadership: boolean;
}): CompletionReport {
  const {
    workplanItems,
    appraisalStatus,
    factorRatings,
    coreFactorIds,
    productivityFactorIds,
    leadershipFactorIds,
    technicalCompetencies,
    showLeadership,
  } = params;

  const status = (appraisalStatus ?? "DRAFT").toUpperCase();
  const isManagerPhase = status === "MANAGER_REVIEW" || status === "SUBMITTED";
  const needsActuals = ["SELF_ASSESSMENT", "SUBMITTED", "MANAGER_REVIEW", "PENDING_SIGNOFF", "HOD_REVIEW", "HR_REVIEW", "COMPLETE"].includes(status);

  const ratingsByFactor = new Map<string, FactorRating>();
  for (const r of factorRatings) {
    ratingsByFactor.set(r.factor_id, r);
  }

  // Workplan: structure (objectives + weight) + optionally actual_result
  const wpMinItems = 1;
  const wpTotal = Math.max(wpMinItems, workplanItems.length);
  let wpCompleted = 0;
  for (const item of workplanItems) {
    const hasStructure = missingWorkplanItemFields(item).length === 0;
    const hasActual = !needsActuals || (item.actual_result != null && !Number.isNaN(Number(item.actual_result)));
    if (hasStructure && (needsActuals ? hasActual : true)) {
      wpCompleted++;
    }
  }
  if (workplanItems.length === 0 && !needsActuals) {
    wpCompleted = 0;
  }

  const workplanSection: CompletionSection = {
    key: "workplan",
    label: "Workplan",
    completed: wpCompleted,
    total: wpTotal,
    required: true,
  };

  const isDraft = status === "DRAFT";

  // Core competencies — DRAFT: rows for all factors + weights total 100%; else: rating codes
  const coreTotal = coreFactorIds.length;
  let coreCompleted = 0;
  if (isDraft) {
    const coreRows = coreFactorIds.filter((fid) => ratingsByFactor.has(fid));
    const coreWeightSum = sumWeightForFactorIds(factorRatings, coreFactorIds);
    if (coreTotal > 0 && coreRows.length === coreTotal && Math.abs(coreWeightSum - 100) < WEIGHT_TOLERANCE) {
      coreCompleted = coreTotal;
    }
  } else {
    for (const fid of coreFactorIds) {
      const r = ratingsByFactor.get(fid);
      const code = isManagerPhase ? r?.manager_rating_code : r?.self_rating_code;
      if (code != null && String(code).trim() !== "") coreCompleted++;
    }
  }

  const coreSection: CompletionSection = {
    key: "core_competencies",
    label: "Core Comp.",
    completed: coreCompleted,
    total: coreTotal,
    required: true,
  };

  // Technical — DRAFT: at least one row + weights total 100%; else: rating codes
  const techTotal = technicalCompetencies.length;
  let techCompleted = 0;
  if (isDraft) {
    const techWeightSum = technicalCompetencies.reduce((s, c) => {
      const w = c.weight != null ? Number(c.weight) : 0;
      return s + (Number.isNaN(w) ? 0 : w);
    }, 0);
    if (techTotal > 0 && Math.abs(techWeightSum - 100) < WEIGHT_TOLERANCE) {
      techCompleted = techTotal;
    }
  } else {
    for (const c of technicalCompetencies) {
      const code = isManagerPhase ? c.manager_rating : c.self_rating;
      if (code != null && String(code).trim() !== "") techCompleted++;
    }
  }

  const techSection: CompletionSection = {
    key: "technical",
    label: "Technical",
    completed: techCompleted,
    total: techTotal,
    required: techTotal > 0,
  };

  // Productivity — DRAFT: rows for all factors + weights total 100%; else: rating codes
  const prodTotal = productivityFactorIds.length;
  let prodCompleted = 0;
  if (isDraft) {
    const prodRows = productivityFactorIds.filter((fid) => ratingsByFactor.has(fid));
    const prodWeightSum = sumWeightForFactorIds(factorRatings, productivityFactorIds);
    if (prodTotal > 0 && prodRows.length === prodTotal && Math.abs(prodWeightSum - 100) < WEIGHT_TOLERANCE) {
      prodCompleted = prodTotal;
    }
  } else {
    for (const fid of productivityFactorIds) {
      const r = ratingsByFactor.get(fid);
      const code = isManagerPhase ? r?.manager_rating_code : r?.self_rating_code;
      if (code != null && String(code).trim() !== "") prodCompleted++;
    }
  }

  const prodSection: CompletionSection = {
    key: "productivity",
    label: "Productivity",
    completed: prodCompleted,
    total: prodTotal,
    required: prodTotal > 0,
  };

  // Leadership (only if showLeadership) — DRAFT: rows for all factors + weights total 100%; else: rating codes
  const leadTotal = showLeadership ? leadershipFactorIds.length : 0;
  let leadCompleted = 0;
  if (showLeadership) {
    if (isDraft) {
      const leadRows = leadershipFactorIds.filter((fid) => ratingsByFactor.has(fid));
      const leadWeightSum = sumWeightForFactorIds(factorRatings, leadershipFactorIds);
      if (leadTotal > 0 && leadRows.length === leadTotal && Math.abs(leadWeightSum - 100) < WEIGHT_TOLERANCE) {
        leadCompleted = leadTotal;
      }
    } else {
      for (const fid of leadershipFactorIds) {
        const r = ratingsByFactor.get(fid);
        const code = isManagerPhase ? r?.manager_rating_code : r?.self_rating_code;
        if (code != null && String(code).trim() !== "") leadCompleted++;
      }
    }
  }

  const sections: CompletionSection[] = [
    workplanSection,
    coreSection,
    techSection,
    prodSection,
  ];
  if (showLeadership && leadTotal > 0) {
    sections.push({
      key: "leadership",
      label: "Leadership",
      completed: leadCompleted,
      total: leadTotal,
      required: true,
    });
  }

  const completedFields = sections.reduce((s, x) => s + x.completed, 0);
  const totalFields = sections.reduce((s, x) => s + x.total, 0);

  const blockers: string[] = [];
  if (coreTotal > 0 && coreCompleted < coreTotal) {
    blockers.push(isDraft ? "Core Competencies: set and save weights for all factors. Total weight must equal 100%." : `Core Competencies: ${coreTotal - coreCompleted} rating(s) missing`);
  }
  if (techTotal > 0 && techCompleted < techTotal) {
    blockers.push(isDraft ? "Technical Skills: add competencies and set weights to total 100%" : `Technical Skills: ${techTotal - techCompleted} rating(s) missing`);
  }
  if (prodTotal > 0 && prodCompleted < prodTotal) {
    blockers.push(isDraft ? "Productivity: set and save weights for all factors. Total weight must equal 100%." : `Productivity: ${prodTotal - prodCompleted} rating(s) missing`);
  }
  if (showLeadership && leadTotal > 0 && leadCompleted < leadTotal) {
    blockers.push(isDraft ? "Leadership: set and save weights for all factors. Total weight must equal 100%." : `Leadership: ${leadTotal - leadCompleted} rating(s) missing`);
  }
  if (wpCompleted < wpTotal) {
    blockers.push(`Workplan: ${wpTotal - wpCompleted} objective(s) incomplete`);
  }

  const canSubmit = blockers.length === 0;

  return {
    sections,
    completedFields,
    totalFields,
    canSubmit,
    blockers,
  };
}
