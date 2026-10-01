import { createClient } from "@supabase/supabase-js";
import { loadOfficialScoreTotals } from "@/lib/official-scores";

/**
 * HR Performance Trends: long-term score trends, division trends over cycles,
 * and promotion readiness. Supports filters by cycle, division, department.
 */

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase URL and key required");
  return createClient(url, key);
}

export interface HRTrendsFilters {
  cycleId?: string | null;
  divisionId?: string | null;
  departmentId?: string | null;
}

/** One point per cycle: average score across filtered appraisals. */
export interface EmployeeScoreTrendPoint {
  cycleId: string;
  cycleName: string;
  endDate: string;
  avgScore: number;
  appraisalCount: number;
}

/** Per-cycle, per-division average score (for line chart: one line per division). */
export interface DivisionTrendPoint {
  cycleName: string;
  endDate: string;
  divisionName: string;
  divisionId: string | null;
  avgScore: number;
  count: number;
}

/** Recommendation type and count; plus list of promotion-ready employees. */
export interface PromotionReadinessItem {
  recommendation: string;
  count: number;
}

export interface PromotionReadyEmployee {
  employeeId: string;
  employeeName: string;
  divisionName: string | null;
  recommendation: string;
  cycleName: string;
  totalScore: number | null;
}

export interface HRTrendsData {
  employeeScoreTrend: EmployeeScoreTrendPoint[];
  divisionPerformanceTrend: DivisionTrendPoint[];
  promotionReadinessCounts: PromotionReadinessItem[];
  promotionReadyEmployees: PromotionReadyEmployee[];
}

const TREND_CYCLES_LIMIT = 10;

export async function getHRTrendsData(
  filters: HRTrendsFilters = {}
): Promise<HRTrendsData> {
  const supabase = getSupabase();

  let appraisalQuery = supabase
    .from("appraisals")
    .select("id, employee_id, cycle_id, division_id")
    .in("status", ["employee_acknowledged", "hr_in_review", "closed"]);

  if (filters.cycleId) {
    appraisalQuery = appraisalQuery.eq("cycle_id", filters.cycleId);
  }
  if (filters.divisionId) {
    appraisalQuery = appraisalQuery.eq("division_id", filters.divisionId);
  }

  const { data: appraisals, error: appError } = await appraisalQuery.order(
    "manager_completed_at",
    { ascending: false }
  );

  if (appError || !appraisals?.length) {
    return {
      employeeScoreTrend: [],
      divisionPerformanceTrend: [],
      promotionReadinessCounts: [],
      promotionReadyEmployees: [],
    };
  }

  const appraisalIds = appraisals.map((a) => a.id);
  const employeeIds = [...new Set(appraisals.map((a) => a.employee_id))];
  const cycleIds = [...new Set(appraisals.map((a) => a.cycle_id))];

  const [{ data: employees }, { data: cycles }, scoreMap, { data: recs }] =
    await Promise.all([
      supabase
        .from("employees")
        .select("employee_id, full_name, division_id, division_name, department_id, department_name")
        .in("employee_id", employeeIds),
      supabase
        .from("appraisal_cycles")
        .select("id, name, end_date")
        .in("id", cycleIds)
        .order("end_date", { ascending: true }),
      loadOfficialScoreTotals(supabase, appraisalIds),
      supabase
        .from("appraisal_recommendations")
        .select("appraisal_id, system_recommendation")
        .in("appraisal_id", appraisalIds),
    ]);

  const employeeMap = new Map(
    (employees ?? []).map((e) => [
      e.employee_id,
      {
        full_name: e.full_name ?? "—",
        division_id: e.division_id ?? null,
        division_name: e.division_name ?? "—",
        department_id: e.department_id ?? null,
        department_name: e.department_name ?? null,
      },
    ])
  );

  if (filters.departmentId) {
    const allowedEmployees = new Set(
      [...employeeMap.entries()]
        .filter(([, e]) => e.department_id === filters.departmentId)
        .map(([id]) => id)
    );
    if (allowedEmployees.size === 0) {
      return {
        employeeScoreTrend: [],
        divisionPerformanceTrend: [],
        promotionReadinessCounts: [],
        promotionReadyEmployees: [],
      };
    }
    appraisals.splice(
      0,
      appraisals.length,
      ...appraisals.filter((a) => allowedEmployees.has(a.employee_id))
    );
  }

  const recMap = new Map(
    (recs ?? []).map((r) => [r.appraisal_id, r.system_recommendation ?? ""])
  );

  const cycleList = (cycles ?? []).slice(-TREND_CYCLES_LIMIT);
  const cycleMap = new Map(cycleList.map((c) => [c.id, c]));

  const appraisalByCycle = new Map<string, typeof appraisals>();
  for (const a of appraisals) {
    if (!cycleMap.has(a.cycle_id)) continue;
    const list = appraisalByCycle.get(a.cycle_id) ?? [];
    list.push(a);
    appraisalByCycle.set(a.cycle_id, list);
  }

  const employeeScoreTrend: EmployeeScoreTrendPoint[] = cycleList.map((c) => {
    const list = appraisalByCycle.get(c.id) ?? [];
    const withScores = list
      .map((a) => scoreMap.get(a.id))
      .filter((s): s is number => s != null);
    const avgScore =
      withScores.length > 0
        ? Math.round((withScores.reduce((a, b) => a + b, 0) / withScores.length) * 10) / 10
        : 0;
    return {
      cycleId: c.id,
      cycleName: c.name,
      endDate: c.end_date ?? "",
      avgScore,
      appraisalCount: list.length,
    };
  });

  const divisionTrendMap = new Map<
    string,
    { cycleName: string; endDate: string; divisionName: string; divisionId: string | null; sum: number; count: number }
  >();
  for (const c of cycleList) {
    const list = appraisalByCycle.get(c.id) ?? [];
    const byDiv = new Map<string, { sum: number; count: number; name: string; id: string | null }>();
    for (const a of list) {
      const score = scoreMap.get(a.id);
      if (score == null) continue;
      const emp = employeeMap.get(a.employee_id);
      const divId = (a as { division_id?: string }).division_id ?? emp?.division_id ?? "unknown";
      const divName = emp?.division_name ?? divId;
      const cur = byDiv.get(divId) ?? { sum: 0, count: 0, name: divName, id: divId === "unknown" ? null : divId };
      cur.sum += score;
      cur.count += 1;
      byDiv.set(divId, cur);
    }
    for (const [divId, v] of byDiv.entries()) {
      const key = `${c.id}-${divId}`;
      divisionTrendMap.set(key, {
        cycleName: c.name,
        endDate: c.end_date ?? "",
        divisionName: v.name,
        divisionId: v.id,
        sum: v.sum,
        count: v.count,
      });
    }
  }

  const divisionPerformanceTrend: DivisionTrendPoint[] = [];
  for (const v of divisionTrendMap.values()) {
    divisionPerformanceTrend.push({
      cycleName: v.cycleName,
      endDate: v.endDate,
      divisionName: v.divisionName,
      divisionId: v.divisionId,
      avgScore: Math.round((v.sum / v.count) * 10) / 10,
      count: v.count,
    });
  }
  divisionPerformanceTrend.sort(
    (a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime()
  );

  const recommendationCounts = new Map<string, number>();
  const promotionReadyEmployees: PromotionReadyEmployee[] = [];
  const promotionKeywords = ["promotion", "promote", "advancement"];

  for (const a of appraisals) {
    const rec = recMap.get(a.id) ?? "";
    if (rec) {
      recommendationCounts.set(rec, (recommendationCounts.get(rec) ?? 0) + 1);
      const isPromotion =
        promotionKeywords.some((k) => rec.toLowerCase().includes(k));
      if (isPromotion) {
        const emp = employeeMap.get(a.employee_id);
        const cycle = cycleMap.get(a.cycle_id);
        promotionReadyEmployees.push({
          employeeId: a.employee_id,
          employeeName: emp?.full_name ?? a.employee_id,
          divisionName: emp?.division_name ?? null,
          recommendation: rec,
          cycleName: cycle?.name ?? "—",
          totalScore: scoreMap.get(a.id) ?? null,
        });
      }
    }
  }

  const promotionReadinessCounts: PromotionReadinessItem[] = [
    ...recommendationCounts.entries(),
  ].map(([recommendation, count]) => ({ recommendation, count }));

  return {
    employeeScoreTrend,
    divisionPerformanceTrend,
    promotionReadinessCounts,
    promotionReadyEmployees,
  };
}

export async function getHRTrendsFilterOptions(): Promise<{
  cycles: { id: string; name: string }[];
  divisions: { id: string; name: string }[];
  departments: { id: string; name: string }[];
}> {
  const supabase = getSupabase();

  const { data: cycles } = await supabase
    .from("appraisal_cycles")
    .select("id, name")
    .in("status", ["open", "closed", "archived"])
    .order("end_date", { ascending: false })
    .limit(20);

  const { data: divRows } = await supabase
    .from("employees")
    .select("division_id, division_name")
    .not("division_id", "is", null);
  const divisionSet = new Map<string, string>();
  for (const d of divRows ?? []) {
    if (d.division_id)
      divisionSet.set(d.division_id, d.division_name ?? d.division_id);
  }

  const { data: deptRows } = await supabase
    .from("employees")
    .select("department_id, department_name")
    .not("department_id", "is", null);
  const departmentSet = new Map<string, string>();
  for (const d of deptRows ?? []) {
    if (d.department_id)
      departmentSet.set(d.department_id, d.department_name ?? d.department_id);
  }

  return {
    cycles: (cycles ?? []).map((c) => ({ id: c.id, name: c.name })),
    divisions: [...divisionSet.entries()].map(([id, name]) => ({ id, name })),
    departments: [...departmentSet.entries()].map(([id, name]) => ({ id, name })),
  };
}
