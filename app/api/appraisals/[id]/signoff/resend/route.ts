import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import { sendReminder } from "@/lib/adobe-sign";
import { resolveDepartmentHeadSystemUserId } from "@/lib/hrmis-approval-auth";
import { resolveManagerAccessForAppraisal } from "@/lib/appraisal-manager-access";
import { allowAppraisalTestBypass } from "@/lib/appraisal-test-bypass";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase config");
  return createClient(url, key);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: appraisalId } = await params;
    const supabase = getSupabaseAdmin();

    const { data: appraisal } = await supabase
      .from("appraisals")
      .select("id, employee_id, manager_employee_id")
      .eq("id", appraisalId)
      .single();

    if (!appraisal) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const isEmployee = appraisal.employee_id === currentUser.employee_id;
    const managerAccess = await resolveManagerAccessForAppraisal({
      supabase,
      appraisalId,
      appraisalEmployeeId: appraisal.employee_id,
      appraisalManagerEmployeeId: appraisal.manager_employee_id,
      currentEmployeeId: currentUser.employee_id ?? null,
    });
    const isManager = managerAccess.hasManagerAccess;
    const isHR = currentUser.roles?.some((r) => r === "hr" || r === "admin");
    const isHOD = currentUser.roles?.some((r) => r === "gm" || r === "admin");

    const { data: agreement } = await supabase
      .from("appraisal_agreements")
      .select("id, adobe_agreement_id, employee_signed_at, manager_signed_at, hr_signed_at")
      .eq("appraisal_id", appraisalId)
      .eq("status", "OUT_FOR_SIGNATURE")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!agreement) return NextResponse.json({ error: "No active agreement" }, { status: 404 });

    const { data: managerUser } = await supabase
      .from("app_users")
      .select("role")
      .eq("employee_id", appraisal.manager_employee_id)
      .in("role", ["gm", "admin"])
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    const hodEmployeeId = await resolveDepartmentHeadSystemUserId(appraisal.employee_id);
    const managerActsAsFinalApprover =
      appraisal.manager_employee_id === hodEmployeeId || !!managerUser;
    const testOnlyEmployeeSigner = allowAppraisalTestBypass();
    const managerIsInChain = !testOnlyEmployeeSigner && !managerActsAsFinalApprover;
    const currentFinalSignerIsRequester =
      (managerActsAsFinalApprover && isManager) ||
      (!managerActsAsFinalApprover && currentUser.employee_id === hodEmployeeId);

    const isCurrentSigner =
      (isEmployee && !agreement.employee_signed_at) ||
      (managerIsInChain && isManager && !!agreement.employee_signed_at && !agreement.manager_signed_at) ||
      (!testOnlyEmployeeSigner &&
        !!agreement.employee_signed_at &&
        (managerIsInChain ? !!agreement.manager_signed_at : true) &&
        !agreement.hr_signed_at &&
        (currentFinalSignerIsRequester || isHOD || isHR));

    if (!isCurrentSigner) {
      return NextResponse.json({ error: "Only the current signer may resend the email" }, { status: 403 });
    }

    await sendReminder(agreement.adobe_agreement_id);

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
