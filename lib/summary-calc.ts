/**
 * Summary tab calculation engine.
 * Computes overall score from workplan, core, productivity, leadership (and optional technical).
 */

export type GradeLetter = "A" | "B" | "C" | "D" | "E";

export interface ComponentScore {
  key: string;
  name: string;
  sub: string;
  weight: number;
  actual: number;
  points: number;
  grade: GradeLetter;
  gradeThresholds: { A: number; B: number; C: number; D: number; E: number };
}

export interface SummaryResult {
  components: ComponentScore[];
  totalWeight: number;
  totalPoints: number;
  overallPct: number;
  overallGrade: GradeLetter;
  gradeBand: string;
  isManagementTrack: boolean;
}

export interface WorkplanItemSummary {
  weight: number;
  actual_result?: number | null;
}

export interface RatingItem {
  manager_rating?: string | null;
  self_rating?: string | null;
}

/** Optional weight per item for weighted section scoring (weight × factor). */
export interface WeightedRatingItem extends RatingItem {
  weight?: number | null;
}

export interface SummaryCalcProps {
  workplanItems: WorkplanItemSummary[];
  competencies: WeightedRatingItem[];
  technical: WeightedRatingItem[];
  productivity: WeightedRatingItem[];
  leadership?: WeightedRatingItem[];
  isManagementTrack: boolean;
}

// ── Points interpolation (matches the Excel formula exactly) ──
export function calcPoints(weight: number, actual: number): number {
  if (actual >= 100) return weight * 1.0;
  if (actual >= 80) return weight * 0.8 + (actual - 80) * ((weight * 1.0 - weight * 0.8) / 20);
  if (actual >= 60) return weight * 0.6 + (actual - 60) * ((weight * 0.8 - weight * 0.6) / 20);
  if (actual >= 40) return weight * 0.4 + (actual - 40) * ((weight * 0.6 - weight * 0.4) / 20);
  if (actual >= 20) return weight * 0.2 + (actual - 20) * ((weight * 0.4 - weight * 0.2) / 20);
  return weight * 0.2;
}

// ── Grade from percentage ──
export function deriveGrade(pct: number): GradeLetter {
  if (pct >= 95) return "A";
  if (pct >= 90) return "B";
  if (pct >= 80) return "C";
  if (pct >= 70) return "D";
  return "E";
}

export const GRADE_BANDS: Record<GradeLetter, { label: string; range: string; short: string }> = {
  A: { label: "Highly Exceeds Expectations", short: "Highly Exceeds", range: "95–100%" },
  B: { label: "Exceeds Expectations", short: "Exceeds", range: "90–95%" },
  C: { label: "Meets Expectations", short: "Meets", range: "80–90%" },
  D: { label: "Below Expectations", short: "Below", range: "70–79%" },
  E: { label: "Far Below Expectations", short: "Far Below", range: "<70%" },
};

export const GRADE_STYLES: Record<
  GradeLetter,
  { bg: string; border: string; text: string; barColor: string; ringStroke: string }
> = {
  A: { bg: "bg-ds-success-subtle", border: "border-ds-success-border", text: "text-ds-success", barColor: "#059669", ringStroke: "#34d399" },
  B: { bg: "bg-ds-info-subtle", border: "border-ds-info-border", text: "text-ds-info", barColor: "#2563eb", ringStroke: "#60a5fa" },
  C: { bg: "bg-ds-info-subtle", border: "border-ds-info-border", text: "text-ds-info", barColor: "#0284c7", ringStroke: "#38bdf8" },
  D: { bg: "bg-ds-warning-subtle", border: "border-ds-warning-border", text: "text-ds-warning", barColor: "#d97706", ringStroke: "#fbbf24" },
  E: { bg: "bg-ds-error-subtle", border: "border-ds-error-border", text: "text-ds-error", barColor: "#dc2626", ringStroke: "#f87171" },
};

// ── Average ratings from tab data (fallback when no weights) ──
function avgRating(items: RatingItem[]): number {
  const RATING_MAP: Record<string, number> = {
    A: 97.5, B: 92.5, C: 85, D: 74.5, E: 50,
    "1": 10, "2": 20, "3": 30, "4": 40, "5": 50,
    "6": 60, "7": 70, "8": 80, "9": 90, "10": 100,
  };
  const rated = items
    .map((i) => RATING_MAP[i.manager_rating ?? i.self_rating ?? ""] ?? null)
    .filter((v): v is number => v !== null);
  if (!rated.length) return 0;
  return rated.reduce((a, b) => a + b, 0) / rated.length;
}

// ── Factor for grade (A–E legacy; 1–10 matches rating_scale table after migration 0054) ──
const GRADE_FACTOR: Record<string, number> = {
  A: 1, B: 0.8, C: 0.6, D: 0.4, E: 0.2,
  "1": 0.1, "2": 0.2, "3": 0.3, "4": 0.4, "5": 0.5,
  "6": 0.6, "7": 0.7, "8": 0.8, "9": 0.9, "10": 1,
};

/** Weighted section score 0–100: sum(weight × factor(grade)) / totalWeight × 100. */
function weightedSectionScore(items: WeightedRatingItem[]): number {
  let sum = 0;
  let totalWeight = 0;
  for (const i of items) {
    const w = Number(i.weight) || 0;
    if (w <= 0) continue;
    const code = i.manager_rating ?? i.self_rating ?? "";
    const factor = GRADE_FACTOR[code] ?? 0;
    sum += w * factor;
    totalWeight += w;
  }
  if (totalWeight <= 0) return 0;
  return (sum / totalWeight) * 100;
}

/** Section actual: weighted score when weights present, else average rating. */
function sectionActual(items: WeightedRatingItem[]): number {
  const hasWeights = items.some((i) => i.weight != null && Number(i.weight) > 0);
  if (hasWeights) return Math.round(weightedSectionScore(items));
  return Math.round(avgRating(items));
}

// ── Main calculation ──
export function calcSummary(props: SummaryCalcProps): SummaryResult {
  const { workplanItems, competencies, technical, productivity, leadership, isManagementTrack } = props;

  // Workplan actual = weighted average of all item actual_results
  const totalW = workplanItems.reduce((s, i) => s + i.weight, 0) || 1;
  const wpActual = workplanItems.length
    ? workplanItems.reduce((s, i) => s + ((i.actual_result ?? 0) * i.weight) / 100, 0) / (totalW / 100)
    : 0;

  const components: Omit<ComponentScore, "points" | "grade" | "gradeThresholds">[] = isManagementTrack
    ? [
        { key: "cc", name: "Core Competencies", sub: "Value-based & soft skill ratings", weight: 10, actual: sectionActual(competencies) },
        { key: "prod", name: "Productivity Rating", sub: "Output and efficiency assessment", weight: 10, actual: sectionActual(productivity) },
        { key: "technical", name: "Technical Competency", sub: "Role-specific technical skills", weight: 10, actual: sectionActual(technical) },
        { key: "leadership", name: "Leadership & Management", sub: "Team management effectiveness", weight: 10, actual: sectionActual(leadership ?? []) },
        { key: "workplan", name: "Workplan Achievement", sub: "KPI results vs. agreed targets", weight: 60, actual: Math.round(wpActual) },
      ]
    : [
        { key: "cc", name: "Core Competencies", sub: "Value-based & soft skill ratings", weight: 10, actual: sectionActual(competencies) },
        { key: "prod", name: "Productivity Rating", sub: "Output and efficiency assessment", weight: 10, actual: sectionActual(productivity) },
        { key: "technical", name: "Technical Competency", sub: "Role-specific technical skills", weight: 10, actual: sectionActual(technical) },
        { key: "workplan", name: "Workplan Achievement", sub: "KPI results vs. agreed targets", weight: 70, actual: Math.round(wpActual) },
      ];

  const withScores: ComponentScore[] = components.map((c) => ({
    ...c,
    points: Math.round(calcPoints(c.weight, c.actual) * 10) / 10,
    grade: deriveGrade(c.actual),
    gradeThresholds: { A: c.weight * 1.0, B: c.weight * 0.8, C: c.weight * 0.6, D: c.weight * 0.4, E: c.weight * 0.2 },
  }));

  const totalPoints = Math.round(withScores.reduce((s, c) => s + c.points, 0) * 10) / 10;
  const overallGrade = deriveGrade(totalPoints);

  return {
    components: withScores,
    totalWeight: 100,
    totalPoints,
    overallPct: totalPoints,
    overallGrade,
    gradeBand: GRADE_BANDS[overallGrade].label,
    isManagementTrack,
  };
}
