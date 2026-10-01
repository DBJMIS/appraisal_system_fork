import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import { transitionStatus } from "@/lib/appraisal-workflow";
import { isAppraisalStatus } from "@/types/appraisal";
import { allowAppraisalTestBypass } from "@/lib/appraisal-test-bypass";
import { resolveManagerAccessForAppraisal } from "@/lib/appraisal-manager-access";

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
    const user = await getCurrentUser();
    if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const reason = (body?.reason ?? body?.comment ?? "") as string;

    const { id: appraisalId } = await params;
    const supabase = getSupabaseAdmin();

    const { data: appraisal, error: appErr } = await supabase
      .from("appraisals")
      .select("id, status, employee_id, manager_employee_id")
      .eq("id", appraisalId)
      .single();

    if (appErr || !appraisal) {
      return NextResponse.json({ error: "Appraisal not found" }, { status: 404 });
    }

    const status = appraisal.status as string;
    if (!isAppraisalStatus(status) || status !== "PENDING_APPROVAL") {
      return NextResponse.json(
        { error: "Appraisal must be in PENDING_APPROVAL to request changes" },
        { status: 400 }
      );
    }

    const managerAccess = await resolveManagerAccessForAppraisal({
      supabase,
      appraisalId,
      appraisalEmployeeId: appraisal.employee_id,
      appraisalManagerEmployeeId: appraisal.manager_employee_id,
      currentEmployeeId: user.employee_id ?? null,
    });
    const isManager = managerAccess.hasManagerAccess;
    const isEmployee = appraisal.employee_id === user.employee_id;
    if (!allowAppraisalTestBypass() && !isManager && !isEmployee) {
      return NextResponse.json({ error: "Only employee or manager can request changes" }, { status: 403 });
    }

    const { error: transErr } = await transitionStatus(
      supabase,
      appraisalId,
      "DRAFT",
      user.id,
      reason ? `Request changes: ${reason}` : "Returned for revision"
    );

    if (transErr) {
      return NextResponse.json({ error: transErr }, { status: 400 });
    }

    // A revised workplan needs fresh approval from both parties.
    const { error: clearErr } = await supabase
      .from("appraisal_approvals")
      .delete()
      .eq("appraisal_id", appraisalId);
    if (clearErr) {
      console.error("[request-changes] failed to clear approvals", { appraisalId, code: clearErr.code });
    }

    return NextResponse.json({ success: true, status: "DRAFT" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
