import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import { hasOversightReadAccess } from "@/lib/appraisal-oversight";
import { buildSummaryInput } from "@/lib/appraisal-summary-input";
import { calcSummary } from "@/lib/summary-calc";

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
  const empId = user.employee_id ?? null;
  const divId = user.division_id ?? null;
  return (
    roles.includes("hr") ||
    roles.includes("admin") ||
    appraisal.employee_id === empId ||
    appraisal.manager_employee_id === empId ||
    (roles.includes("gm") && divId != null && appraisal.division_id === divId)
  );
}

/** GET: return summary result (manager review = final score) for this appraisal. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: appraisalId } = await params;
    const supabase = getSupabaseAdmin();

    const { data: appraisal, error: appErr } = await supabase
      .from("appraisals")
      .select("id, employee_id, manager_employee_id, division_id, is_management")
      .eq("id", appraisalId)
      .single();

    if (appErr || !appraisal) {
      return NextResponse.json({ error: "Appraisal not found" }, { status: 404 });
    }
    if (!canAccessAppraisal(user, appraisal) && !(await hasOversightReadAccess(user, appraisal))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const showLeadership = req.nextUrl.searchParams.get("showLeadership") === "true";
    const input = await buildSummaryInput(appraisalId, supabase, { showLeadership });
    const summaryResult = calcSummary(input);

    return NextResponse.json(summaryResult);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
