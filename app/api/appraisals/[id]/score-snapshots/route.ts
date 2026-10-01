import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import { resolveManagerAccessForAppraisal } from "@/lib/appraisal-manager-access";
import { hasOversightReadAccess } from "@/lib/appraisal-oversight";
import { listMidyearScoreRevisions, loadScoreSnapshotSummaries, type ScoreSnapshotSummary } from "@/lib/appraisal-score-snapshot";
import { compareScores, type StoredScore } from "@/lib/score-comparison";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase URL and service role key required");
  return createClient(url, key);
}

type RouteContext = { params: Promise<{ id: string }> };

const stored = (s: ScoreSnapshotSummary | undefined): StoredScore | null =>
  s ? { total: s.total_points, grade: s.overall_grade, gradeLabel: s.grade_label } : null;

/**
 * GET /api/appraisals/[id]/score-snapshots
 * Read-only MIDYEAR and FINAL scores as stored, with the change between them. No recalculation.
 * Visible to the same people as the appraisal's check-ins.
 */
export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: appraisalId } = await context.params;
    const supabase = getSupabaseAdmin();

    const { data: appraisal, error: appErr } = await supabase
      .from("appraisals")
      .select("id, employee_id, manager_employee_id, division_id")
      .eq("id", appraisalId)
      .single();
    if (appErr || !appraisal) return NextResponse.json({ error: "Appraisal not found" }, { status: 404 });

    const managerAccess = await resolveManagerAccessForAppraisal({
      supabase,
      appraisalId,
      appraisalEmployeeId: appraisal.employee_id,
      appraisalManagerEmployeeId: appraisal.manager_employee_id,
      currentEmployeeId: user.employee_id ?? null,
    });
    const allowed =
      user.roles?.some((r) => r === "hr" || r === "admin") ||
      appraisal.employee_id === user.employee_id ||
      managerAccess.hasManagerAccess ||
      (user.roles?.includes("gm") && appraisal.division_id === user.division_id);
    if (!allowed && !(await hasOversightReadAccess(user, appraisal))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const snapshots = await loadScoreSnapshotSummaries(supabase, appraisalId);
    const comparison = compareScores(stored(snapshots.MIDYEAR), stored(snapshots.FINAL));
    const midyearRevisions = await listMidyearScoreRevisions(supabase, appraisalId);
    return NextResponse.json({
      ...comparison,
      midyearRecordedAt: snapshots.MIDYEAR?.calculated_at ?? null,
      finalRecordedAt: snapshots.FINAL?.calculated_at ?? null,
      midyearRevision: snapshots.MIDYEAR?.revision ?? null,
      midyearRevisions: midyearRevisions.map((r) => ({
        revision: r.revision,
        total: r.total_points,
        grade: r.overall_grade,
        gradeLabel: r.grade_label,
        recordedAt: r.calculated_at,
        supersededAt: r.superseded_at,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
