import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import { isAppraisalStatus } from "@/types/appraisal";
import { allowAppraisalTestBypass } from "@/lib/appraisal-test-bypass";
import { fetchCompletionReport } from "@/lib/appraisal-completion-report";
import { notifyEmployee } from "@/lib/notifications";
import { resolveManagerAccessForAppraisal } from "@/lib/appraisal-manager-access";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase config");
  return createClient(url, key);
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: appraisalId } = await params;
    const supabase = getSupabaseAdmin();

    const { data: appraisal, error: appErr } = await supabase
      .from("appraisals")
      .select("id, status, employee_id, manager_employee_id, cycle_id")
      .eq("id", appraisalId)
      .single();

    if (appErr || !appraisal) {
      return NextResponse.json({ error: "Appraisal not found" }, { status: 404 });
    }

    const status = appraisal.status as string;
    if (!isAppraisalStatus(status) || status !== "MANAGER_REVIEW") {
      return NextResponse.json(
        { error: "Appraisal must be in MANAGER_REVIEW to submit" },
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
    if (!allowAppraisalTestBypass() && !managerAccess.hasManagerAccess) {
      return NextResponse.json({ error: "Only the manager can submit manager review" }, { status: 403 });
    }

    const report = await fetchCompletionReport(supabase, appraisalId);
    if (!report?.canSubmit) {
      const message = report?.blockers?.length
        ? `Complete all required fields: ${report.blockers.join("; ")}`
        : "Complete all required fields before submitting.";
      return NextResponse.json({ error: message, blockers: report?.blockers }, { status: 400 });
    }

    // Do not change status here. The only path to PENDING_SIGNOFF is via Sign-offs tab → "Generate PDF & send via Adobe Sign" (signoff/submit).
    try {
      const { createNotificationForEmployeeId } = await import("@/lib/notifications/create");
      await createNotificationForEmployeeId(appraisal.employee_id, {
        type: "appraisal.manager_reviewed",
        title: "Manager review complete",
        body: "Your manager has completed their review of your appraisal.",
        link: `/appraisals/${appraisalId}`,
        metadata: { appraisal_id: appraisalId },
      });
    } catch {
      /* non-blocking */
    }

    try {
      const { data: cycle } = await supabase
        .from("appraisal_cycles")
        .select("name")
        .eq("id", appraisal.cycle_id)
        .maybeSingle();
      const { data: emp } = await supabase
        .from("employees")
        .select("email, full_name")
        .eq("employee_id", appraisal.employee_id)
        .maybeSingle();
      if (emp?.email?.trim()) {
        await notifyEmployee(
          { email: emp.email.trim(), name: emp.full_name ?? undefined },
          "manager_review_complete",
          {
            cycleName: (cycle?.name as string) ?? "Appraisal",
            employeeName: emp.full_name ?? emp.email,
            appraisalId,
          }
        );
      }
    } catch {
      /* non-blocking */
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
