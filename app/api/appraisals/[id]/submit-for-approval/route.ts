import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import { transitionStatus } from "@/lib/appraisal-workflow";
import { allowAppraisalTestBypass } from "@/lib/appraisal-test-bypass";
import { isAppraisalStatus } from "@/types/appraisal";
import { fetchCompletionReport } from "@/lib/appraisal-completion-report";
import { notifyEmployee, notifyManager } from "@/lib/notifications";
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
      .select("id, status, employee_id, manager_employee_id, is_management, cycle_id")
      .eq("id", appraisalId)
      .single();

    if (appErr || !appraisal) {
      return NextResponse.json({ error: "Appraisal not found" }, { status: 404 });
    }

    const status = appraisal.status as string;
    if (!isAppraisalStatus(status) || status !== "DRAFT") {
      return NextResponse.json(
        { error: "Appraisal must be in DRAFT to submit for approval" },
        { status: 400 }
      );
    }

    const isEmployee = appraisal.employee_id === user.employee_id;
    const managerAccess = await resolveManagerAccessForAppraisal({
      supabase,
      appraisalId,
      appraisalEmployeeId: appraisal.employee_id,
      appraisalManagerEmployeeId: appraisal.manager_employee_id,
      currentEmployeeId: user.employee_id ?? null,
    });
    const isManager = managerAccess.hasManagerAccess;
    if (!allowAppraisalTestBypass() && !isEmployee && !isManager) {
      return NextResponse.json({ error: "Only the employee or manager can submit the workplan for approval" }, { status: 403 });
    }

    const report = await fetchCompletionReport(supabase, appraisalId, {
      showLeadershipParam: appraisal.is_management ?? false,
    });
    if (!report?.canSubmit) {
      return NextResponse.json(
        {
          error: "Cannot submit for approval — not all sections are complete.",
          blockers: report?.blockers ?? [],
        },
        { status: 422 }
      );
    }

    const { data: workplan } = await supabase
      .from("workplans")
      .select("id")
      .eq("appraisal_id", appraisalId)
      .maybeSingle();

    if (!workplan) {
      return NextResponse.json({ error: "Workplan not found" }, { status: 404 });
    }

    const { data: items } = await supabase
      .from("workplan_items")
      .select("weight")
      .eq("workplan_id", workplan.id);

    const totalWeight = (items ?? []).reduce((s, i) => s + (Number(i.weight) || 0), 0);
    if ((items?.length ?? 0) === 0 || Math.abs(totalWeight - 100) >= 0.01) {
      return NextResponse.json(
        { error: "Workplan must have at least one objective and total weight must equal 100%" },
        { status: 400 }
      );
    }

    const { error: transErr } = await transitionStatus(
      supabase,
      appraisalId,
      "PENDING_APPROVAL",
      user.id,
      "Submitted for approval"
    );

    if (transErr) {
      return NextResponse.json({ error: transErr }, { status: 400 });
    }

    try {
      const { data: cycle } = await supabase
        .from("appraisal_cycles")
        .select("name, end_date")
        .eq("id", appraisal.cycle_id)
        .maybeSingle();
      const { data: emp } = await supabase
        .from("employees")
        .select("email, full_name")
        .eq("employee_id", appraisal.employee_id)
        .maybeSingle();
      const { data: mgr } = await supabase
        .from("employees")
        .select("email, full_name")
        .eq("employee_id", appraisal.manager_employee_id)
        .maybeSingle();
      const cycleName = (cycle?.name as string) ?? "Appraisal";
      const dueDate = (cycle?.end_date as string | null) ?? null;
      const employeeName = emp?.full_name ?? "Employee";
      const managerName = mgr?.full_name ?? null;
      const payload = {
        cycleName,
        employeeName,
        managerName,
        appraisalId,
        dueDate,
      };
      if (isEmployee && mgr?.email?.trim()) {
        await notifyManager(
          { email: mgr.email.trim(), name: mgr.full_name ?? undefined },
          "workplan_pending_approval",
          payload
        );
      } else if (isManager && emp?.email?.trim()) {
        await notifyEmployee(
          { email: emp.email.trim(), name: emp.full_name ?? undefined },
          "workplan_pending_approval",
          payload
        );
      }

      const { createNotificationForEmployeeId } = await import("@/lib/notifications/create");
      if (isEmployee) {
        await createNotificationForEmployeeId(appraisal.manager_employee_id, {
          type: "appraisal.workplan_pending",
          title: "Work plan pending your approval",
          body: `${employeeName}'s work plan for "${cycleName}" was submitted. Please review and approve.`,
          link: `/appraisals/${appraisalId}`,
          metadata: { appraisal_id: appraisalId, cycle_id: appraisal.cycle_id },
        });
      } else if (isManager) {
        await createNotificationForEmployeeId(appraisal.employee_id, {
          type: "appraisal.workplan_pending",
          title: "Work plan pending your approval",
          body: managerName
            ? `${managerName} submitted the work plan for "${cycleName}". Please review and approve.`
            : `Your manager submitted the work plan for "${cycleName}". Please review and approve.`,
          link: `/appraisals/${appraisalId}`,
          metadata: { appraisal_id: appraisalId, cycle_id: appraisal.cycle_id },
        });
      }
    } catch {
      /* non-blocking */
    }

    return NextResponse.json({ success: true, status: "PENDING_APPROVAL" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
