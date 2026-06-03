import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import { resolveManagerAccessForAppraisal } from "@/lib/appraisal-manager-access";
import {
  buildWorkplanExportBuffer,
  sanitizeWorkplanExportFilename,
  type WorkplanExportItem,
  type WorkplanExportMeta,
} from "@/lib/workplan-excel-export";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase config required");
  return createClient(url, key);
}

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, context: RouteContext) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: appraisalId } = await context.params;
    const supabase = getSupabaseAdmin();

    const { data: appraisal, error: appErr } = await supabase
      .from("appraisals")
      .select("id, employee_id, manager_employee_id, division_id, cycle_id")
      .eq("id", appraisalId)
      .single();

    if (appErr || !appraisal) {
      return NextResponse.json({ error: "Appraisal not found" }, { status: 404 });
    }

    const managerAccess = await resolveManagerAccessForAppraisal({
      supabase,
      appraisalId,
      appraisalEmployeeId: appraisal.employee_id,
      appraisalManagerEmployeeId: appraisal.manager_employee_id,
      currentEmployeeId: user.employee_id ?? null,
    });
    const canAccess =
      user.roles?.some((r) => r === "hr" || r === "admin") ||
      appraisal.employee_id === user.employee_id ||
      managerAccess.hasManagerAccess ||
      (user.roles?.includes("gm") && appraisal.division_id === user.division_id);

    if (!canAccess) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: workplan, error: wpErr } = await supabase
      .from("workplans")
      .select("id")
      .eq("appraisal_id", appraisalId)
      .maybeSingle();

    if (wpErr) {
      return NextResponse.json({ error: wpErr.message }, { status: 500 });
    }
    if (!workplan?.id) {
      return NextResponse.json({ error: "No workplan found" }, { status: 404 });
    }

    const { data: rawItems, error: itemsErr } = await supabase
      .from("workplan_items")
      .select(
        "corporate_objective, division_objective, individual_objective, major_task, key_output, performance_standard, weight, metric_type, metric_target, metric_deadline, created_at"
      )
      .eq("workplan_id", workplan.id)
      .order("created_at", { ascending: true });

    if (itemsErr) {
      return NextResponse.json({ error: itemsErr.message }, { status: 500 });
    }

    const items: WorkplanExportItem[] = (rawItems ?? []).map((r) => ({
      corporate_objective: String(r.corporate_objective ?? ""),
      division_objective: String(r.division_objective ?? ""),
      individual_objective: String(r.individual_objective ?? ""),
      major_task: String(r.major_task ?? ""),
      key_output: String(r.key_output ?? ""),
      performance_standard: String(r.performance_standard ?? ""),
      weight: Number(r.weight) || 0,
      metric_type: r.metric_type != null ? String(r.metric_type) : null,
      metric_target: r.metric_target != null ? Number(r.metric_target) : null,
      metric_deadline: r.metric_deadline != null ? String(r.metric_deadline) : null,
    }));

    if (items.length === 0) {
      return NextResponse.json({ error: "No workplan objectives to export" }, { status: 404 });
    }

    const [empRes, cycleRes] = await Promise.all([
      supabase
        .from("employees")
        .select("full_name, job_title, division_name, department_name")
        .eq("employee_id", appraisal.employee_id)
        .maybeSingle(),
      appraisal.cycle_id
        ? supabase
            .from("appraisal_cycles")
            .select("fiscal_year, name")
            .eq("id", appraisal.cycle_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const emp = empRes.data;
    const meta: WorkplanExportMeta = {
      employeeName: emp?.full_name ?? "",
      position: emp?.job_title ?? "",
      unit: emp?.department_name ?? "",
      division: emp?.division_name ?? "",
      fiscalYear: cycleRes.data?.fiscal_year ?? cycleRes.data?.name ?? "",
    };

    const buffer = buildWorkplanExportBuffer(meta, items);
    const yearPart = cycleRes.data?.fiscal_year ?? cycleRes.data?.name ?? "";
    const namePart = (emp?.full_name ?? "Employee").trim();
    const filename = sanitizeWorkplanExportFilename(
      `Workplan_${namePart}${yearPart ? `_${yearPart}` : ""}`
    );

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[workplan/export-excel]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Export failed" },
      { status: 500 }
    );
  }
}
