import { createClient } from "@supabase/supabase-js";
import { loadOfficialScoreTotals } from "@/lib/official-scores";

/**
 * HR Analytics: aggregates for score distribution, division performance,
 * top performers, and improvement candidates. Uses closed/HR-completed appraisals
 * with their official score (FINAL snapshot, else the legacy section score).
 */

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase URL and key required");
  return createClient(url, key);
}

const SCORE_BANDS = [
  { label: "0-60", min: 0, max: 60 },
  { label: "60-70", min: 60, max: 70 },
  { label: "70-80", min: 70, max: 80 },
  { label: "80-90", min: 80, max: 90 },
  { label: "90-100", min: 90, max: 101 },
] as const;

export interface ScoreDistributionBucket {
  band: string;
  count: number;
}

export interface DivisionPerformance {
  divisionId: string | null;
  divisionName: string;
  avgScore: number;
  count: number;
}

export interface PerformerRow {
  employeeId: string;
  employeeName: string;
  divisionName: string | null;
  totalScore: number;
  cycleName: string;
}

export interface HRAnalyticsData {
  scoreDistribution: ScoreDistributionBucket[];
  divisionPerformance: DivisionPerformance[];
  topPerformers: PerformerRow[];
  improvementCandidates: PerformerRow[];
}

export async function getHRAnalyticsData(
  options: { cycleId?: string | null; limit?: number } = {}
): Promise<HRAnalyticsData> {
  const { cycleId = null, limit = 10 } = options;
  const supabase = getSupabase();

  let appraisalQuery = supabase
    .from("appraisals")
    .select("id, employee_id, cycle_id, division_id")
    .in("status", ["employee_acknowledged", "hr_in_review", "closed"]);

  if (cycleId) {
    appraisalQuery = appraisalQuery.eq("cycle_id", cycleId);
  }

  const { data: appraisals, error: appError } = await appraisalQuery;

  if (appError || !appraisals?.length) {
    return {
      scoreDistribution: SCORE_BANDS.map((b) => ({ band: b.label, count: 0 })),
      divisionPerformance: [],
      topPerformers: [],
      improvementCandidates: [],
    };
  }

  const appraisalIds = appraisals.map((a) => a.id);
  const scoreByAppraisal = await loadOfficialScoreTotals(supabase, appraisalIds);

  const employeeIds = [...new Set(appraisals.map((a) => a.employee_id))];
  const cycleIds = [...new Set(appraisals.map((a) => a.cycle_id))];

  const [{ data: employees }, { data: cycles }] = await Promise.all([
    supabase
      .from("employees")
      .select("employee_id, full_name, division_id, division_name")
      .in("employee_id", employeeIds),
    supabase.from("appraisal_cycles").select("id, name").in("id", cycleIds),
  ]);

  const employeeMap = new Map(
    (employees ?? []).map((e) => [
      e.employee_id,
      {
        full_name: e.full_name ?? "—",
        division_id: e.division_id ?? null,
        division_name: e.division_name ?? "—",
      },
    ])
  );
  const cycleMap = new Map((cycles ?? []).map((c) => [c.id, c.name]));

  // Score distribution
  const bandCounts = SCORE_BANDS.map((b) => ({ band: b.label, count: 0 }));
  for (const a of appraisals) {
    const total = scoreByAppraisal.get(a.id);
    if (total == null) continue;
    const bucket = SCORE_BANDS.find((b) => total >= b.min && total < b.max);
    if (bucket) {
      const entry = bandCounts.find((x) => x.band === bucket.label);
      if (entry) entry.count++;
    }
  }

  // Division performance (use appraisal.division_id or fallback to employee)
  const divisionScores: Map<string, { sum: number; count: number; name: string }> = new Map();
  for (const a of appraisals) {
    const total = scoreByAppraisal.get(a.id);
    if (total == null) continue;
    const emp = employeeMap.get(a.employee_id);
    const divId = (a as { division_id?: string }).division_id ?? emp?.division_id ?? "unknown";
    const divName = emp?.division_name ?? divId;
    const cur = divisionScores.get(divId) ?? { sum: 0, count: 0, name: divName };
    cur.sum += total;
    cur.count += 1;
    divisionScores.set(divId, cur);
  }
  const divisionPerformance: DivisionPerformance[] = Array.from(
    divisionScores.entries()
  ).map(([divisionId, v]) => ({
    divisionId: divisionId === "unknown" ? null : divisionId,
    divisionName: v.name,
    avgScore: Math.round((v.sum / v.count) * 10) / 10,
    count: v.count,
  }));

  // Rows with score for ranking
  const rows: Array<{
    appraisalId: string;
    employeeId: string;
    employeeName: string;
    divisionName: string | null;
    totalScore: number;
    cycleName: string;
  }> = [];
  for (const a of appraisals) {
    const total = scoreByAppraisal.get(a.id);
    if (total == null) continue;
    const emp = employeeMap.get(a.employee_id);
    const cycleName = cycleMap.get(a.cycle_id) ?? "—";
    rows.push({
      appraisalId: a.id,
      employeeId: a.employee_id,
      employeeName: emp?.full_name ?? a.employee_id,
      divisionName: emp?.division_name ?? null,
      totalScore: total,
      cycleName,
    });
  }

  const sorted = [...rows].sort((x, y) => y.totalScore - x.totalScore);
  const topPerformers: PerformerRow[] = sorted.slice(0, limit).map((r) => ({
    employeeId: r.employeeId,
    employeeName: r.employeeName,
    divisionName: r.divisionName,
    totalScore: r.totalScore,
    cycleName: r.cycleName,
  }));
  const improvementCandidates: PerformerRow[] = sorted
    .slice(-limit)
    .reverse()
    .map((r) => ({
      employeeId: r.employeeId,
      employeeName: r.employeeName,
      divisionName: r.divisionName,
      totalScore: r.totalScore,
      cycleName: r.cycleName,
    }));

  return {
    scoreDistribution: bandCounts,
    divisionPerformance,
    topPerformers,
    improvementCandidates,
  };
}

export async function getHRAnalyticsCycleOptions(): Promise<
  Array<{ id: string; name: string }>
> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("appraisal_cycles")
    .select("id, name")
    .in("status", ["open", "closed", "archived"])
    .order("end_date", { ascending: false })
    .limit(20);
  return (data ?? []).map((r) => ({ id: r.id, name: r.name }));
}
