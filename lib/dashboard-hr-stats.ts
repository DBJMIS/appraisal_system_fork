import { createClient } from "@supabase/supabase-js";
import { resolveDivisionNames } from "@/lib/dynamics-divisions";
import { loadOfficialScoreTotals } from "@/lib/official-scores";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase URL and key required");
  return createClient(url, key);
}

export interface ScoreDistributionBucket {
  label: string;
  min: number;
  max: number;
  count: number;
  barColor?: string;
  anomaly?: boolean;
}

export interface DivisionBreakdownRow {
  /** Stable id for React keys (division GUID or internal sentinel); not shown in UI. */
  rowKey: string;
  division: string;
  employees: number;
  avgScore: number | null;
  completed: number;
  inProgress: number;
}

export interface RecentActivityItem {
  employeeName: string;
  initials: string;
  toStatus: string;
  cycleName: string;
  at: string;
}

export interface HrDashboardStats {
  total_employees: number;
  /** Subtitle for the total employees stat (e.g. enrolled-in-cycle copy). */
  total_employees_subtitle: string;
  appraisals_by_stage: Record<string, number>;
  score_distribution: ScoreDistributionBucket[];
  mean_score: number | null;
  std_deviation: number;
  division_breakdown: DivisionBreakdownRow[];
  recent_activity: RecentActivityItem[];
  active_360_cycles: number;
  appraisals_complete: number;
  pending_manager_reviews: number;
  in_progress_appraisals: number;
}

const STAGE_FILTERS = [
  "DRAFT",
  "PENDING_APPROVAL",
  "SELF_ASSESSMENT",
  "SUBMITTED",
  "MANAGER_REVIEW",
  "PENDING_SIGNOFF",
  "HR_PIPELINE",
  "COMPLETE",
] as const;

function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const v = values.reduce((s, x) => s + (x - mean) ** 2, 0) / values.length;
  return Math.sqrt(v);
}

function bucketColor(min: number): string {
  if (min >= 90) return "#10b981";
  if (min >= 70) return "#0d9488";
  if (min >= 40) return "#f59e0b";
  return "#ef4444";
}

const UNASSIGNED_DIV = "__unassigned__";

/** Prefer the open appraisal cycle; else the cycle with the most active appraisals. */
async function resolveBreakdownCycleId(
  supabase: ReturnType<typeof getSupabase>,
  apps: { cycle_id: string }[]
): Promise<string | null> {
  const { data: openRow } = await supabase
    .from("appraisal_cycles")
    .select("id")
    .eq("status", "open")
    .order("end_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (openRow?.id) return openRow.id as string;

  let best: string | null = null;
  let bestN = 0;
  const counts = new Map<string, number>();
  for (const a of apps) {
    const c = a.cycle_id as string;
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  for (const [cid, n] of counts) {
    if (n > bestN) {
      best = cid;
      bestN = n;
    }
  }
  return best;
}

export async function fetchHrDashboardStats(): Promise<HrDashboardStats> {
  const supabase = getSupabase();

  const { data: appraisals } = await supabase
    .from("appraisals")
    .select("id, employee_id, status, cycle_id, updated_at, division_id")
    .eq("is_active", true);

  const apps = appraisals ?? [];

  const breakdownCycleId = await resolveBreakdownCycleId(supabase, apps);
  let enrolledCycleName: string | null = null;
  if (breakdownCycleId) {
    const { data: cyc } = await supabase
      .from("appraisal_cycles")
      .select("name")
      .eq("id", breakdownCycleId)
      .maybeSingle();
    enrolledCycleName = (cyc?.name as string | undefined)?.trim() || null;
  }

  const appsForBreakdown = apps.filter((a) => {
    const st = String(a.status ?? "").toUpperCase();
    if (st === "CANCELLED") return false;
    if (breakdownCycleId && a.cycle_id !== breakdownCycleId) return false;
    return true;
  });

  const totalEmployees = new Set(appsForBreakdown.map((a) => String(a.employee_id))).size;
  const totalEmployeesSubtitle = enrolledCycleName
    ? `Enrolled in ${enrolledCycleName}`
    : breakdownCycleId
      ? "Enrolled in appraisal cycle"
      : "Enrolled in appraisal program (all cycles)";
  const byStage: Record<string, number> = {};
  for (const s of STAGE_FILTERS) {
    byStage[s] = 0;
  }

  for (const a of apps) {
    const st = (a.status as string) || "DRAFT";
    if (st === "HOD_REVIEW" || st === "HR_REVIEW") {
      byStage.HR_PIPELINE = (byStage.HR_PIPELINE ?? 0) + 1;
    } else if (Object.prototype.hasOwnProperty.call(byStage, st)) {
      byStage[st] = (byStage[st] ?? 0) + 1;
    }
    /* unknown legacy statuses omitted from pipeline */
  }

  const appraisalsComplete = apps.filter((a) => a.status === "COMPLETE").length;
  const pendingManager = apps.filter((a) => a.status === "MANAGER_REVIEW").length;
  const inProgress = apps.filter(
    (a) => a.status !== "DRAFT" && a.status !== "COMPLETE"
  ).length;

  const { count: active360 } = await supabase
    .from("feedback_cycle")
    .select("id", { count: "exact", head: true })
    .eq("status", "Active");

  const appraisalIds = apps.map((a) => a.id);
  const scoreByAppraisal = await loadOfficialScoreTotals(supabase, appraisalIds);
  const scores: number[] = [...scoreByAppraisal.values()];

  const meanScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const stdDeviation = stdDev(scores);

  const buckets: ScoreDistributionBucket[] = [];
  for (let min = 0; min <= 90; min += 10) {
    const max = min === 90 ? 100 : min + 9;
    const label = min === 90 ? "90+" : String(min);
    let count = 0;
    for (const sc of scores) {
      if (min === 90) {
        if (sc >= 90) count++;
      } else if (sc >= min && sc <= max) {
        count++;
      }
    }
    buckets.push({ label, min, max: min === 90 ? 100 : max, count });
  }

  const bucketCounts = buckets.map((b) => b.count);
  const meanBuckets =
    bucketCounts.length > 0
      ? bucketCounts.reduce((a, b) => a + b, 0) / bucketCounts.length
      : 0;
  const stdBuckets = stdDev(bucketCounts);

  for (const b of buckets) {
    b.barColor = bucketColor(b.min);
    if (b.count > meanBuckets + 2 * stdBuckets && bucketCounts.some((c) => c > 0)) {
      b.anomaly = true;
    }
  }

  const empIdsMissingDiv = [
    ...new Set(
      appsForBreakdown
        .filter((a) => !(a as { division_id?: string | null }).division_id?.toString().trim())
        .map((a) => a.employee_id as string)
    ),
  ];
  const employeeDivisionById = new Map<string, string>();
  if (empIdsMissingDiv.length > 0) {
    const { data: empRows } = await supabase
      .from("employees")
      .select("employee_id, division_id")
      .in("employee_id", empIdsMissingDiv);
    for (const e of empRows ?? []) {
      const did = (e.division_id as string | null)?.trim();
      if (did) employeeDivisionById.set(e.employee_id as string, did);
    }
  }

  type DivAgg = { divisionKey: string; appraisalIds: string[]; statuses: string[] };
  const divisionMap = new Map<string, DivAgg>();
  for (const a of appsForBreakdown) {
    const rowDiv = (a as { division_id?: string | null }).division_id?.toString().trim();
    const fallbackDiv = employeeDivisionById.get(a.employee_id as string)?.trim();
    const divisionKey =
      rowDiv || fallbackDiv || UNASSIGNED_DIV;
    let agg = divisionMap.get(divisionKey);
    if (!agg) {
      agg = { divisionKey, appraisalIds: [], statuses: [] };
      divisionMap.set(divisionKey, agg);
    }
    agg.appraisalIds.push(a.id as string);
    agg.statuses.push((a.status as string) || "DRAFT");
  }

  const guidKeys = [...divisionMap.keys()].filter((k) => k !== UNASSIGNED_DIV);
  let nameByGuid = new Map<string, string>();
  try {
    nameByGuid = await resolveDivisionNames(guidKeys);
  } catch (e) {
    console.error("[dashboard-hr-stats] Dynamics division names failed:", e);
  }

  const division_breakdown: DivisionBreakdownRow[] = [];
  for (const agg of divisionMap.values()) {
    let completed = 0;
    let inProg = 0;
    for (const st of agg.statuses) {
      const u = String(st ?? "").toUpperCase();
      if (u === "COMPLETE") completed++;
      else if (u !== "DRAFT" && u !== "COMPLETE" && u !== "CANCELLED") inProg++;
    }
    let sum = 0;
    let n = 0;
    for (const aid of agg.appraisalIds) {
      const ts = scoreByAppraisal.get(aid);
      if (ts != null && !Number.isNaN(ts)) {
        sum += ts;
        n++;
      }
    }
    const displayName =
      agg.divisionKey === UNASSIGNED_DIV
        ? "Unassigned"
        : nameByGuid.get(agg.divisionKey) ?? "Unknown division";
    division_breakdown.push({
      rowKey: agg.divisionKey,
      division: displayName,
      employees: agg.appraisalIds.length,
      avgScore: n > 0 ? Math.round((sum / n) * 10) / 10 : null,
      completed,
      inProgress: inProg,
    });
  }
  division_breakdown.sort((a, b) => b.employees - a.employees || a.division.localeCompare(b.division));

  const { data: timeline } = await supabase
    .from("appraisal_timeline")
    .select("appraisal_id, to_status, changed_at, changed_by")
    .order("changed_at", { ascending: false })
    .limit(10);

  const recent_activity: RecentActivityItem[] = [];
  const tidAppraisalIds = [...new Set((timeline ?? []).map((t) => t.appraisal_id))];
  if (tidAppraisalIds.length > 0) {
    const { data: tApps } = await supabase
      .from("appraisals")
      .select("id, employee_id, cycle_id")
      .in("id", tidAppraisalIds);
    const { data: tEmps } = await supabase
      .from("employees")
      .select("employee_id, full_name")
      .in(
        "employee_id",
        (tApps ?? []).map((a) => a.employee_id)
      );
    const { data: tCycles } = await supabase
      .from("appraisal_cycles")
      .select("id, name")
      .in("id", [...new Set((tApps ?? []).map((a) => a.cycle_id).filter(Boolean))]);

    const nameByEmp = new Map((tEmps ?? []).map((e) => [e.employee_id, e.full_name as string]));
    const cycleName = new Map((tCycles ?? []).map((c) => [c.id, c.name as string]));
    const appById = new Map((tApps ?? []).map((a) => [a.id, a]));

    for (const row of timeline ?? []) {
      const ap = appById.get(row.appraisal_id);
      if (!ap) continue;
      const nm = nameByEmp.get(ap.employee_id) ?? ap.employee_id;
      const parts = nm.split(/\s+/).filter(Boolean);
      const initials =
        parts.length >= 2
          ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
          : nm.slice(0, 2).toUpperCase();
      recent_activity.push({
        employeeName: nm,
        initials,
        toStatus: row.to_status as string,
        cycleName: cycleName.get(ap.cycle_id) ?? "—",
        at: row.changed_at as string,
      });
    }
  }

  return {
    total_employees: totalEmployees,
    total_employees_subtitle: totalEmployeesSubtitle,
    appraisals_by_stage: byStage as unknown as Record<string, number>,
    score_distribution: buckets,
    mean_score: meanScore != null ? Math.round(meanScore * 10) / 10 : null,
    std_deviation: Math.round(stdDeviation * 100) / 100,
    division_breakdown,
    recent_activity,
    active_360_cycles: active360 ?? 0,
    appraisals_complete: appraisalsComplete,
    pending_manager_reviews: pendingManager,
    in_progress_appraisals: inProgress,
  };
}

export { STAGE_FILTERS };
