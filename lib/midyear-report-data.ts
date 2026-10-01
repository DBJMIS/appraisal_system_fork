/**
 * Mid-Year reporting, separate from official (FINAL) reporting: completion status of formal Mid-Year
 * Reviews, the MIDYEAR score distribution, and Mid-Year vs Final change. Each appraisal is counted once
 * per measure. MIDYEAR scores come only from MIDYEAR snapshots and FINAL only from FINAL snapshots.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { listScoreSnapshotsByType } from "@/lib/appraisal-score-snapshot";
import { compareScores } from "@/lib/score-comparison";

export const MIDYEAR_SCORE_BANDS = [
  { label: "0-60", min: 0, max: 60 },
  { label: "60-70", min: 60, max: 70 },
  { label: "70-80", min: 70, max: 80 },
  { label: "80-90", min: 80, max: 90 },
  { label: "90-100", min: 90, max: 101 },
] as const;

export const MIDYEAR_COMPLETION_STATES = ["NOT_STARTED", "OPEN", "EMPLOYEE_SUBMITTED", "MANAGER_REVIEWED", "COMPLETE", "CANCELLED"] as const;
export type MidyearCompletionState = (typeof MIDYEAR_COMPLETION_STATES)[number];

export interface MidyearChangeRow {
  appraisalId: string;
  employeeId: string;
  employeeName: string;
  divisionName: string | null;
  midyear: number;
  final: number;
  change: number;
}

export interface MidyearReportData {
  /** Appraisals in Mid-Year enabled cycles (excluding cancelled appraisals). */
  appraisalCount: number;
  completion: Record<MidyearCompletionState, number>;
  scoredCount: number;
  distribution: { band: string; count: number }[];
  gradeDistribution: Record<string, number>;
  meanMidyear: number | null;
  change: {
    rows: MidyearChangeRow[];
    improved: number;
    declined: number;
    unchanged: number;
    /** Mean of the per-appraisal changes (Final − Mid-Year). */
    meanChange: number | null;
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

function emptyCompletion(): Record<MidyearCompletionState, number> {
  return Object.fromEntries(MIDYEAR_COMPLETION_STATES.map((s) => [s, 0])) as Record<MidyearCompletionState, number>;
}

/** One state per appraisal: its live formal review, else a cancelled one, else NOT_STARTED. */
export function midyearCompletionState(reviews: { status: string }[]): MidyearCompletionState {
  const live = reviews.find((r) => r.status !== "CANCELLED");
  if (live) return (MIDYEAR_COMPLETION_STATES as readonly string[]).includes(live.status) ? (live.status as MidyearCompletionState) : "OPEN";
  return reviews.length > 0 ? "CANCELLED" : "NOT_STARTED";
}

export async function getMidyearReportData(
  supabase: SupabaseClient,
  options: { cycleId?: string | null; divisionId?: string | null } = {}
): Promise<MidyearReportData> {
  const result: MidyearReportData = {
    appraisalCount: 0,
    completion: emptyCompletion(),
    scoredCount: 0,
    distribution: MIDYEAR_SCORE_BANDS.map((b) => ({ band: b.label, count: 0 })),
    gradeDistribution: {},
    meanMidyear: null,
    change: { rows: [], improved: 0, declined: 0, unchanged: 0, meanChange: null },
  };

  let cycleQuery = supabase.from("appraisal_cycles").select("id").eq("midyear_review_enabled", true);
  if (options.cycleId) cycleQuery = cycleQuery.eq("id", options.cycleId);
  const { data: cycles, error: cycleErr } = await cycleQuery;
  if (cycleErr) throw new Error(cycleErr.message);
  const cycleIds = ((cycles ?? []) as { id: string }[]).map((c) => c.id);
  if (cycleIds.length === 0) return result;

  let appraisalQuery = supabase.from("appraisals").select("id, employee_id, division_id, status, cycle_id").in("cycle_id", cycleIds);
  if (options.divisionId) appraisalQuery = appraisalQuery.eq("division_id", options.divisionId);
  const { data: appraisalRows, error: appErr } = await appraisalQuery;
  if (appErr) throw new Error(appErr.message);
  const byId = new Map<string, { id: string; employee_id: string; division_id: string | null }>();
  for (const a of (appraisalRows ?? []) as { id: string; employee_id: string; division_id: string | null; status: string }[]) {
    if (String(a.status).toUpperCase() === "CANCELLED" || byId.has(a.id)) continue;
    byId.set(a.id, a);
  }
  const ids = [...byId.keys()];
  result.appraisalCount = ids.length;
  if (ids.length === 0) return result;

  const { data: reviews, error: reviewErr } = await supabase
    .from("check_ins")
    .select("appraisal_id, status, created_at")
    .in("appraisal_id", ids)
    .in("review_mode", ["FORMAL", "FORMAL_SCORED"])
    .order("created_at", { ascending: false });
  if (reviewErr) throw new Error(reviewErr.message);
  const reviewsByAppraisal = new Map<string, { status: string }[]>();
  for (const r of (reviews ?? []) as { appraisal_id: string; status: string }[]) {
    const list = reviewsByAppraisal.get(r.appraisal_id) ?? [];
    list.push(r);
    reviewsByAppraisal.set(r.appraisal_id, list);
  }
  for (const id of ids) result.completion[midyearCompletionState(reviewsByAppraisal.get(id) ?? [])]++;

  const [midyear, final] = await Promise.all([
    listScoreSnapshotsByType(supabase, "MIDYEAR", ids),
    listScoreSnapshotsByType(supabase, "FINAL", ids),
  ]);

  let sum = 0;
  for (const s of midyear.values()) {
    const band = MIDYEAR_SCORE_BANDS.find((b) => s.total_points >= b.min && s.total_points < b.max);
    if (band) result.distribution.find((d) => d.band === band.label)!.count++;
    if (s.overall_grade) result.gradeDistribution[s.overall_grade] = (result.gradeDistribution[s.overall_grade] ?? 0) + 1;
    sum += s.total_points;
  }
  result.scoredCount = midyear.size;
  result.meanMidyear = midyear.size > 0 ? round1(sum / midyear.size) : null;

  const paired = ids.filter((id) => midyear.has(id) && final.has(id));
  if (paired.length > 0) {
    const employeeIds = [...new Set(paired.map((id) => byId.get(id)!.employee_id))];
    const { data: employees } = await supabase
      .from("employees")
      .select("employee_id, full_name, division_name")
      .in("employee_id", employeeIds);
    const empMap = new Map(
      ((employees ?? []) as { employee_id: string; full_name?: string | null; division_name?: string | null }[]).map((e) => [e.employee_id, e])
    );
    let changeSum = 0;
    for (const id of paired) {
      const m = midyear.get(id)!;
      const f = final.get(id)!;
      const change = compareScores(
        { total: m.total_points, grade: m.overall_grade, gradeLabel: m.grade_label },
        { total: f.total_points, grade: f.overall_grade, gradeLabel: f.grade_label }
      ).change as number;
      const a = byId.get(id)!;
      const emp = empMap.get(a.employee_id);
      result.change.rows.push({
        appraisalId: id,
        employeeId: a.employee_id,
        employeeName: emp?.full_name ?? a.employee_id,
        divisionName: emp?.division_name ?? null,
        midyear: m.total_points,
        final: f.total_points,
        change,
      });
      if (change > 0) result.change.improved++;
      else if (change < 0) result.change.declined++;
      else result.change.unchanged++;
      changeSum += change;
    }
    result.change.rows.sort((x, y) => y.change - x.change);
    result.change.meanChange = round1(changeSum / paired.length);
  }
  return result;
}
