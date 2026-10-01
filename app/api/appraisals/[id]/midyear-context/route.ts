import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import { resolveManagerAccessForAppraisal } from "@/lib/appraisal-manager-access";
import { hasOversightReadAccess } from "@/lib/appraisal-oversight";
import { loadCycleMidyearConfig } from "@/lib/midyear-config";
import { loadMidyearFinalReviewContext } from "@/lib/midyear-final-review-context";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase URL and service role key required");
  return createClient(url, key);
}

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/appraisals/[id]/midyear-context
 * Read-only Mid-Year results per workplan item and the current Mid-Year score, for reference in the
 * Final Review. Visible to the same people as the appraisal's check-ins. Writes nothing.
 */
export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: appraisalId } = await context.params;
    const supabase = getSupabaseAdmin();

    const { data: appraisal, error: appErr } = await supabase
      .from("appraisals")
      .select("id, employee_id, manager_employee_id, division_id, cycle_id")
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

    const { config } = await loadCycleMidyearConfig(supabase, (appraisal as { cycle_id?: string | null }).cycle_id);
    return NextResponse.json(await loadMidyearFinalReviewContext(supabase, appraisalId, config.enabled));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
