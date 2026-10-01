/**
 * Mid-Year Review assessment inputs: frozen weights/track at creation, workplan results via
 * lib/metric-calc.ts, and validated employee/manager inputs. Reads the annual tables only to
 * take the snapshot; all Mid-Year writes go to check_ins, check_in_responses and
 * check_in_competency_ratings.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { calcMetricPercentage, calcMgrResult, type MetricType } from "@/lib/metric-calc";

export const COMPETENCY_SECTIONS = ["CORE", "PRODUCTIVITY", "TECHNICAL", "LEADERSHIP"] as const;
export type CompetencySection = (typeof COMPETENCY_SECTIONS)[number];

export const RATING_CODES = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"] as const;

export type AssessmentOwner = "employee" | "manager";

const CATEGORY_SECTION: Record<string, CompetencySection> = {
  core: "CORE",
  productivity: "PRODUCTIVITY",
  leadership: "LEADERSHIP",
};

export interface CompetencyRatingSeed {
  section: CompetencySection;
  factor_id: string | null;
  technical_competency_id: string | null;
  name_snapshot: string;
  weight_snapshot: number;
  display_order: number;
}

export interface MidyearSnapshot {
  isManagementTrack: boolean;
  competencies: CompetencyRatingSeed[];
  /** workplan_item_id -> frozen weight */
  workplanWeights: Record<string, number>;
}

export interface WorkplanMetricSource {
  metric_type?: string | null;
  metric_target?: number | string | null;
  metric_deadline?: string | null;
}

export interface WorkplanActualInput {
  actual_raw: number | null;
  completion_date: string | null;
}

const toWeight = (value: unknown): number => {
  const n = Number(value);
  return value != null && value !== "" && Number.isFinite(n) ? n : 0;
};

const toNumberOrNull = (value: unknown): number | null => {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * Freeze the track, competency list and weights for a formal Mid-Year Review.
 * The track is resolved by the caller (lib/management-track.ts, server-only).
 * Factor weights use the appraisal's own weight when set, else the master weight (as the annual
 * sections display them). Leadership is included only on the management track.
 */
export async function buildMidyearSnapshot(
  supabase: SupabaseClient,
  params: {
    appraisalId: string;
    isManagementTrack: boolean;
    workplanItems: Array<{ id: string; weight?: number | string | null }>;
  }
): Promise<MidyearSnapshot> {
  const { isManagementTrack } = params;

  const { data: categories, error: catErr } = await supabase
    .from("evaluation_categories")
    .select("id, category_type")
    .in("category_type", ["core", "productivity", "leadership"])
    .eq("active", true);
  if (catErr) throw new Error(`Could not load competency categories: ${catErr.message}`);
  const sectionByCategory = new Map<string, CompetencySection>(
    ((categories ?? []) as { id: string; category_type: string }[]).map((c) => [c.id, CATEGORY_SECTION[c.category_type]])
  );

  type FactorRow = { id: string; category_id: string; name: string; weight: number | string | null; display_order: number | null };
  let factors: FactorRow[] = [];
  if (sectionByCategory.size > 0) {
    const { data, error } = await supabase
      .from("evaluation_factors")
      .select("id, category_id, name, weight, display_order")
      .in("category_id", [...sectionByCategory.keys()])
      .eq("active", true)
      .order("display_order");
    if (error) throw new Error(`Could not load competencies: ${error.message}`);
    factors = (data ?? []) as FactorRow[];
  }

  const { data: annualRows, error: ratingErr } = await supabase
    .from("appraisal_factor_ratings")
    .select("factor_id, weight")
    .eq("appraisal_id", params.appraisalId);
  if (ratingErr) throw new Error(`Could not load competency weights: ${ratingErr.message}`);
  const annualWeight = new Map<string, number | string | null>(
    ((annualRows ?? []) as { factor_id: string; weight: number | string | null }[]).map((r) => [r.factor_id, r.weight])
  );

  const { data: techRows, error: techErr } = await supabase
    .from("appraisal_technical_competencies")
    .select("id, name, weight, display_order")
    .eq("appraisal_id", params.appraisalId)
    .order("display_order");
  if (techErr) throw new Error(`Could not load technical competencies: ${techErr.message}`);

  const competencies: CompetencyRatingSeed[] = [];
  const orderIn: Record<CompetencySection, number> = { CORE: 0, PRODUCTIVITY: 0, TECHNICAL: 0, LEADERSHIP: 0 };
  for (const f of factors) {
    const section = sectionByCategory.get(f.category_id);
    if (!section || (section === "LEADERSHIP" && !isManagementTrack)) continue;
    const stored = annualWeight.get(f.id);
    competencies.push({
      section,
      factor_id: f.id,
      technical_competency_id: null,
      name_snapshot: f.name,
      weight_snapshot: toWeight(stored ?? f.weight),
      display_order: orderIn[section]++,
    });
  }
  for (const t of (techRows ?? []) as { id: string; name: string; weight: number | string | null }[]) {
    competencies.push({
      section: "TECHNICAL",
      factor_id: null,
      technical_competency_id: t.id,
      name_snapshot: t.name,
      weight_snapshot: toWeight(t.weight),
      display_order: orderIn.TECHNICAL++,
    });
  }

  competencies.sort((a, b) => COMPETENCY_SECTIONS.indexOf(a.section) - COMPETENCY_SECTIONS.indexOf(b.section));
  const workplanWeights = Object.fromEntries(params.workplanItems.map((wi) => [wi.id, toWeight(wi.weight)]));
  return { isManagementTrack, competencies, workplanWeights };
}

function metricItem(source: WorkplanMetricSource) {
  return {
    metric_type: (source.metric_type ?? null) as MetricType | null,
    metric_target: toNumberOrNull(source.metric_target),
    metric_deadline: source.metric_deadline ?? null,
  };
}

/** Employee Mid-Year result (0-100) using the annual employee formula in lib/metric-calc.ts. */
export function midyearEmployeeResult(source: WorkplanMetricSource, input: WorkplanActualInput): number | null {
  return calcMetricPercentage({
    ...metricItem(source),
    metric_actual_raw: input.actual_raw,
    metric_completion_date: input.completion_date,
  });
}

/** Manager Mid-Year result (0-100) using the annual manager formula in lib/metric-calc.ts. */
export function midyearManagerResult(source: WorkplanMetricSource, input: WorkplanActualInput): number | null {
  return calcMgrResult({
    ...metricItem(source),
    mgr_actual_raw: input.actual_raw,
    mgr_completion_date: input.completion_date,
  });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const WORKPLAN_FIELDS: Record<AssessmentOwner, { actual: string; date: string; result: string }> = {
  employee: { actual: "employee_actual_raw", date: "employee_completion_date", result: "employee_result" },
  manager: { actual: "mgr_actual_raw", date: "mgr_completion_date", result: "mgr_result" },
};

const COMPETENCY_FIELDS: Record<AssessmentOwner, { rating: string; comment: string }> = {
  employee: { rating: "employee_rating_code", comment: "employee_comment" },
  manager: { rating: "manager_rating_code", comment: "manager_comment" },
};

type Parsed<T> = { value: T; error: null } | { value: null; error: string };

function parseActual(value: unknown, label: string): Parsed<number | null> {
  if (value == null || value === "") return { value: null, error: null };
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? { value: n, error: null } : { value: null, error: `${label} must be a number.` };
}

function parseDate(value: unknown, label: string): Parsed<string | null> {
  if (value == null || value === "") return { value: null, error: null };
  return typeof value === "string" && isValidDate(value)
    ? { value, error: null }
    : { value: null, error: `${label} must be a date (YYYY-MM-DD).` };
}

function parseRating(value: unknown): Parsed<string | null> {
  if (value == null || value === "") return { value: null, error: null };
  const code = String(value);
  return (RATING_CODES as readonly string[]).includes(code)
    ? { value: code, error: null }
    : { value: null, error: "Rating must be between 1 and 10." };
}

function parseComment(value: unknown): Parsed<string | null> {
  if (value == null || value === "") return { value: null, error: null };
  return typeof value === "string" ? { value, error: null } : { value: null, error: "Comment must be text." };
}

export interface MidyearWrites {
  /** workplan_item_id -> extra check_in_responses columns for this owner */
  responseValues: Record<string, Record<string, unknown>>;
  competencyUpdates: Array<{ id: string; values: Record<string, unknown> }>;
}

/**
 * Validate the owner's Mid-Year inputs and compute workplan results from the stored and incoming
 * values. Only the owner's columns are produced; the other party's fields are ignored.
 */
export async function prepareMidyearWrites(
  supabase: SupabaseClient,
  checkInId: string,
  owner: AssessmentOwner,
  responses: unknown,
  competencies: unknown
): Promise<{ writes: MidyearWrites; error: null } | { writes: null; error: string }> {
  const wf = WORKPLAN_FIELDS[owner];
  const cf = COMPETENCY_FIELDS[owner];

  const incoming = new Map<string, { actual?: number | null; date?: string | null }>();
  for (const r of Array.isArray(responses) ? responses : []) {
    if (!r || typeof r !== "object") continue;
    const row = r as Record<string, unknown>;
    if (typeof row.workplan_item_id !== "string") continue;
    const entry: { actual?: number | null; date?: string | null } = {};
    if (wf.actual in row) {
      const p = parseActual(row[wf.actual], "Actual value");
      if (p.error) return { writes: null, error: p.error };
      entry.actual = p.value;
    }
    if (wf.date in row) {
      const p = parseDate(row[wf.date], "Completion date");
      if (p.error) return { writes: null, error: p.error };
      entry.date = p.value;
    }
    if (Object.keys(entry).length > 0) incoming.set(row.workplan_item_id, entry);
  }

  const competencyUpdates: MidyearWrites["competencyUpdates"] = [];
  for (const c of Array.isArray(competencies) ? competencies : []) {
    if (!c || typeof c !== "object") continue;
    const row = c as Record<string, unknown>;
    if (typeof row.id !== "string") continue;
    const values: Record<string, unknown> = {};
    if (cf.rating in row) {
      const p = parseRating(row[cf.rating]);
      if (p.error) return { writes: null, error: p.error };
      values[cf.rating] = p.value;
    }
    if (cf.comment in row) {
      const p = parseComment(row[cf.comment]);
      if (p.error) return { writes: null, error: p.error };
      values[cf.comment] = p.value;
    }
    if (Object.keys(values).length > 0) competencyUpdates.push({ id: row.id, values });
  }

  if (competencyUpdates.length > 0) {
    const { data: rows, error } = await supabase
      .from("check_in_competency_ratings")
      .select("id")
      .eq("check_in_id", checkInId);
    if (error) return { writes: null, error: error.message };
    const known = new Set(((rows ?? []) as { id: string }[]).map((r) => r.id));
    if (competencyUpdates.some((u) => !known.has(u.id))) {
      return { writes: null, error: "Competency does not belong to this Mid-Year Review." };
    }
  }

  const responseValues: MidyearWrites["responseValues"] = {};
  if (incoming.size > 0) {
    const { data: stored, error: storedErr } = await supabase
      .from("check_in_responses")
      .select("workplan_item_id, employee_actual_raw, employee_completion_date, mgr_actual_raw, mgr_completion_date")
      .eq("check_in_id", checkInId);
    if (storedErr) return { writes: null, error: storedErr.message };
    const storedByItem = new Map(
      ((stored ?? []) as unknown as Record<string, unknown>[]).map((s) => [s.workplan_item_id as string, s])
    );
    const itemIds = [...incoming.keys()].filter((id) => storedByItem.has(id));
    const { data: items, error: itemsErr } = itemIds.length
      ? await supabase.from("workplan_items").select("id, metric_type, metric_target, metric_deadline").in("id", itemIds)
      : { data: [], error: null };
    if (itemsErr) return { writes: null, error: itemsErr.message };
    const itemById = new Map(((items ?? []) as (WorkplanMetricSource & { id: string })[]).map((i) => [i.id, i]));

    for (const id of itemIds) {
      const change = incoming.get(id)!;
      const prev = storedByItem.get(id)!;
      const actual = "actual" in change ? change.actual ?? null : toNumberOrNull(prev[wf.actual]);
      const date = "date" in change ? change.date ?? null : ((prev[wf.date] as string | null) ?? null);
      const source = itemById.get(id) ?? {};
      const input = { actual_raw: actual, completion_date: date };
      const values: Record<string, unknown> = {
        [wf.result]: owner === "employee" ? midyearEmployeeResult(source, input) : midyearManagerResult(source, input),
      };
      if ("actual" in change) values[wf.actual] = actual;
      if ("date" in change) values[wf.date] = date;
      responseValues[id] = values;
    }
  }

  return { writes: { responseValues, competencyUpdates }, error: null };
}

export async function applyCompetencyUpdates(
  supabase: SupabaseClient,
  checkInId: string,
  updates: MidyearWrites["competencyUpdates"],
  now: string
): Promise<string | null> {
  for (const u of updates) {
    const { error } = await supabase
      .from("check_in_competency_ratings")
      .update({ ...u.values, updated_at: now })
      .eq("id", u.id)
      .eq("check_in_id", checkInId);
    if (error) return error.message;
  }
  return null;
}
