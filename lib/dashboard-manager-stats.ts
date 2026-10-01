import { createClient } from "@supabase/supabase-js";
import type { AuthUser } from "@/lib/auth";
import { getDirectReports } from "@/lib/dynamics-org-service";
import type { ReportingStructure } from "@/lib/reporting-structure";
import { getReportingStructureFromDynamics } from "@/lib/reporting-structure";
import { loadOfficialScoreTotals } from "@/lib/official-scores";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase URL and key required");
  return createClient(url, key);
}

function normalizeSystemUserId(value: string | null | undefined): string | null {
  if (!value) return null;
  return String(value).replace(/^\{|\}$/g, "").trim() || null;
}

function xrmDisplayName(r: {
  xrm1_fullname?: string | null;
  xrm1_first_name?: string | null;
  xrm1_last_name?: string | null;
}): string {
  if (r.xrm1_fullname) return r.xrm1_fullname;
  const parts = [r.xrm1_first_name, r.xrm1_last_name].filter(Boolean);
  return parts.length ? parts.join(" ").trim() : "—";
}

export interface ManagerDirectReportRow {
  employee_id: string;
  full_name: string;
  division_name: string | null;
  appraisal_id: string | null;
  status: string;
  total_score: number | null;
  updated_at: string | null;
}

export interface ManagerDashboardStats {
  direct_reports: ManagerDirectReportRow[];
  pending_reviews: number;
  team_in_progress: number;
}

/**
 * Manager team + appraisals using HRMIS (Dynamics) direct reports — same source as
 * getAppraisalsForDirectReportsFromDynamics / My Appraisals.
 *
 * @param preloadedStructure Optional result from getReportingStructureFromDynamics to avoid a duplicate call.
 */
export async function fetchManagerDashboardStats(
  user: AuthUser,
  preloadedStructure?: ReportingStructure | null
): Promise<ManagerDashboardStats> {
  const empty: ManagerDashboardStats = {
    direct_reports: [],
    pending_reviews: 0,
    team_in_progress: 0,
  };

  const structure =
    preloadedStructure ??
    (await getReportingStructureFromDynamics(user.employee_id ?? null, user.email ?? null));

  if (!structure.employee_id) {
    return empty;
  }

  const xrmReports = await getDirectReports(structure.employee_id);

  const reportIds: string[] = [];
  const seen = new Set<string>();
  const xrmBySid = new Map<
    string,
    { xrm1_fullname?: string | null; xrm1_first_name?: string | null; xrm1_last_name?: string | null }
  >();

  for (const r of xrmReports) {
    const sid = normalizeSystemUserId(r._xrm1_employee_user_id_value);
    if (!sid || seen.has(sid)) continue;
    seen.add(sid);
    reportIds.push(sid);
    xrmBySid.set(sid, r);
  }

  if (reportIds.length === 0) {
    return empty;
  }

  const supabase = getSupabase();

  const { data: employees } = await supabase
    .from("employees")
    .select("employee_id, full_name, division_name")
    .in("employee_id", reportIds)
    .eq("is_active", true);

  const empById = new Map((employees ?? []).map((e) => [e.employee_id as string, e]));

  const { data: openCycle } = await supabase
    .from("appraisal_cycles")
    .select("id")
    .eq("status", "open")
    .order("end_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const cycleId = openCycle?.id ?? null;

  const { data: appraisals } = await supabase
    .from("appraisals")
    .select("id, employee_id, status, updated_at, cycle_id")
    .in("employee_id", reportIds)
    .eq("is_active", true);

  const list = appraisals ?? [];
  const latestByReport = new Map<string, (typeof list)[0]>();

  for (const rid of reportIds) {
    const inOpen = cycleId ? list.filter((a) => a.employee_id === rid && a.cycle_id === cycleId) : [];
    const pool = inOpen.length > 0 ? inOpen : list.filter((a) => a.employee_id === rid);
    if (pool.length === 0) continue;
    const best = pool.reduce((a, b) =>
      new Date(a.updated_at ?? 0).getTime() >= new Date(b.updated_at ?? 0).getTime() ? a : b
    );
    latestByReport.set(rid, best);
  }

  const appIds = [...latestByReport.values()]
    .map((a) => a.id)
    .filter(Boolean) as string[];

  const scores = await loadOfficialScoreTotals(supabase, appIds);

  const direct_reports: ManagerDirectReportRow[] = reportIds.map((rid) => {
    const emp = empById.get(rid);
    const xrm = xrmBySid.get(rid);
    const ap = latestByReport.get(rid);
    return {
      employee_id: rid,
      full_name: (emp?.full_name as string) ?? (xrm ? xrmDisplayName(xrm) : rid),
      division_name: (emp?.division_name as string) ?? null,
      appraisal_id: ap?.id ?? null,
      status: (ap?.status as string) ?? "DRAFT",
      total_score: ap?.id ? scores.get(ap.id) ?? null : null,
      updated_at: (ap?.updated_at as string) ?? null,
    };
  });

  let pending_reviews = 0;
  let team_in_progress = 0;
  for (const r of direct_reports) {
    if (r.status === "MANAGER_REVIEW") pending_reviews++;
    if (r.status !== "DRAFT" && r.status !== "COMPLETE") team_in_progress++;
  }

  return { direct_reports, pending_reviews, team_in_progress };
}
