import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import { fetchCompletionReport } from "@/lib/appraisal-completion-report";
import { withRetry } from "@/lib/retry-transient";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase config");
  return createClient(url, key);
}

function canAccessAppraisal(
  user: { roles?: string[]; employee_id?: string | null; division_id?: string | null },
  appraisal: { employee_id: string; manager_employee_id: string | null; division_id?: string | null }
): boolean {
  const roles = user.roles ?? [];
  const empId = user.employee_id != null ? String(user.employee_id) : null;
  const divId = user.division_id ?? null;
  const appraisalEmpId = appraisal.employee_id != null ? String(appraisal.employee_id) : null;
  const appraisalMgrId = appraisal.manager_employee_id != null ? String(appraisal.manager_employee_id) : null;
  const appraisalDivId = appraisal.division_id != null ? String(appraisal.division_id) : null;
  return (
    roles.includes("hr") ||
    roles.includes("admin") ||
    (empId != null && appraisalEmpId === empId) ||
    (empId != null && appraisalMgrId === empId) ||
    (roles.includes("gm") && divId != null && appraisalDivId === String(divId))
  );
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: appraisalId } = await params;
    const supabase = getSupabaseAdmin();

    const result = await withRetry(async () => {
      const { data: appraisal, error: appErr } = await supabase
        .from("appraisals")
        .select("id, employee_id, manager_employee_id, status, is_management")
        .eq("id", appraisalId)
        .single();

      if (appErr || !appraisal) {
        return NextResponse.json({ error: "Appraisal not found" }, { status: 404 });
      }

      if (!canAccessAppraisal(user, appraisal)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const { searchParams } = new URL(req.url);
      const showLeadershipParam = searchParams.get("showLeadership") === "true" || appraisal.is_management;

      const report = await fetchCompletionReport(supabase, appraisalId, {
        showLeadershipParam: !!showLeadershipParam,
      });
      return report;
    });

    if (result instanceof NextResponse) return result;
    if (!result) {
      return NextResponse.json({ error: "Failed to compute completion" }, { status: 500 });
    }
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
