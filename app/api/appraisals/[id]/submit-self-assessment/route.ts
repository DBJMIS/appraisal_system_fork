import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import { transitionStatus } from "@/lib/appraisal-workflow";
import { allowAppraisalTestBypass } from "@/lib/appraisal-test-bypass";
import { isAppraisalStatus } from "@/types/appraisal";
import { fetchCompletionReport } from "@/lib/appraisal-completion-report";
import { notifyManager } from "@/lib/notifications";

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
    if (!isAppraisalStatus(status) || status !== "SELF_ASSESSMENT") {
      return NextResponse.json(
        { error: "Appraisal must be in SELF_ASSESSMENT to submit" },
        { status: 400 }
      );
    }

    if (!allowAppraisalTestBypass() && appraisal.employee_id !== user.employee_id) {
      return NextResponse.json({ error: "Only the employee can submit self-assessment" }, { status: 403 });
    }

    const report = await fetchCompletionReport(supabase, appraisalId);
    if (!report?.canSubmit) {
      const message = report?.blockers?.length
        ? `Complete all required fields: ${report.blockers.join("; ")}`
        : "Complete all required fields before submitting.";
      return NextResponse.json({ error: message, blockers: report?.blockers }, { status: 400 });
    }

    const { error: transErr } = await transitionStatus(
      supabase,
      appraisalId,
      "MANAGER_REVIEW",
      user.id,
      "Self-assessment submitted"
    );

    if (transErr) {
      return NextResponse.json({ error: transErr }, { status: 400 });
    }

    // Snapshot work plan: preserve employee's actual_result and points for manager view
    const { data: workplan } = await supabase
      .from("workplans")
      .select("id")
      .eq("appraisal_id", appraisalId)
      .maybeSingle();

    if (workplan?.id) {
      const { data: items } = await supabase
        .from("workplan_items")
        .select("id, actual_result, points")
        .eq("workplan_id", workplan.id);
      if (items?.length) {
        for (const item of items) {
          await supabase
            .from("workplan_items")
            .update({
              employee_actual_result: item.actual_result,
              employee_points: item.points,
            })
            .eq("id", item.id);
        }
      }
    }

    // Snapshot development profile at submission time for manager/HOD/HR to see as-of submission
    const { data: devProfile } = await supabase
      .from("employee_development_profiles")
      .select("*")
      .eq("employee_id", appraisal.employee_id)
      .maybeSingle();
    if (devProfile) {
      await supabase.from("development_profile_snapshots").upsert(
        {
          appraisal_id: appraisalId,
          employee_id: appraisal.employee_id,
          snapshot_data: devProfile as Record<string, unknown>,
          snapshotted_at: new Date().toISOString(),
        },
        { onConflict: "appraisal_id" }
      );
    }

    const { data: empRow } = await supabase
      .from("employees")
      .select("full_name")
      .eq("employee_id", appraisal.employee_id)
      .maybeSingle();
    const { data: cycleRow } = await supabase
      .from("appraisal_cycles")
      .select("name, end_date")
      .eq("id", appraisal.cycle_id)
      .maybeSingle();
    const { data: mgrEmp } = await supabase
      .from("employees")
      .select("email, full_name")
      .eq("employee_id", appraisal.manager_employee_id)
      .maybeSingle();
    const employeeName = empRow?.full_name ?? "An employee";

    try {
      const { createNotificationForEmployeeId } = await import("@/lib/notifications/create");
      await createNotificationForEmployeeId(appraisal.manager_employee_id, {
        type: "appraisal.submitted",
        title: "Appraisal submitted",
        body: `${employeeName} has submitted their self-assessment for review.`,
        link: `/appraisals/${appraisalId}`,
        metadata: { appraisal_id: appraisalId },
      });
    } catch {
      /* non-blocking */
    }

    try {
      if (mgrEmp?.email?.trim()) {
        await notifyManager(
          { email: mgrEmp.email.trim(), name: mgrEmp.full_name ?? undefined },
          "manager_review_due",
          {
            cycleName: (cycleRow?.name as string) ?? "Appraisal",
            employeeName,
            managerName: mgrEmp.full_name ?? null,
            dueDate: (cycleRow?.end_date as string | null) ?? null,
            appraisalId,
          }
        );
      }
    } catch {
      /* non-blocking */
    }

    return NextResponse.json({ success: true, status: "MANAGER_REVIEW" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
