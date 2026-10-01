import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import { buildSummaryInput } from "@/lib/appraisal-summary-input";
import { calcSummary, GRADE_BANDS } from "@/lib/summary-calc";
import { resolveDepartmentHeadSystemUserId } from "@/lib/hrmis-approval-auth";
import { allowAppraisalTestBypass } from "@/lib/appraisal-test-bypass";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase config");
  return createClient(url, key);
}

function canAccess(
  user: { roles?: string[]; employee_id?: string | null; division_id?: string | null },
  appraisal: { employee_id: string; manager_employee_id: string | null; division_id?: string | null }
): boolean {
  const roles = user.roles ?? [];
  const empId = user.employee_id ?? null;
  return Boolean(
    roles.includes("hr") ||
    roles.includes("admin") ||
    appraisal.employee_id === empId ||
    appraisal.manager_employee_id === empId ||
    (roles.includes("gm") && user.division_id && appraisal.division_id === user.division_id)
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

    const { data: appraisal, error: appErr } = await supabase
      .from("appraisals")
      .select("id, employee_id, manager_employee_id, division_id, status, is_management")
      .eq("id", appraisalId)
      .single();

    if (appErr || !appraisal) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!canAccess(user, appraisal)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { data: agreement } = await supabase
      .from("appraisal_agreements")
      .select("*")
      .eq("appraisal_id", appraisalId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: emp } = await supabase
      .from("employees")
      .select("full_name, email")
      .eq("employee_id", appraisal.employee_id)
      .single();
    const { data: mgr } = await supabase
      .from("employees")
      .select("full_name, email")
      .eq("employee_id", appraisal.manager_employee_id)
      .single();
    const { data: managerUser } = await supabase
      .from("app_users")
      .select("role")
      .eq("employee_id", appraisal.manager_employee_id)
      .in("role", ["gm", "admin"])
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    const hodEmployeeId = await resolveDepartmentHeadSystemUserId(appraisal.employee_id);
    const { data: hod } = hodEmployeeId
      ? await supabase
          .from("employees")
          .select("employee_id, full_name, email")
          .eq("employee_id", hodEmployeeId)
          .single()
      : { data: null };

    const signers = {
      employee: { full_name: emp?.full_name ?? "—", email: emp?.email ?? null },
      manager: { full_name: mgr?.full_name ?? "—", email: mgr?.email ?? null },
      hrOfficer: { full_name: hod?.full_name ?? "—", email: hod?.email ?? null },
    };

    const testOnlyEmployeeSigner = allowAppraisalTestBypass();
    const managerActsAsFinalApprover =
      appraisal.manager_employee_id === hodEmployeeId || !!managerUser;
    const managerIsInChain = !testOnlyEmployeeSigner && !managerActsAsFinalApprover;

    const signerChain: { role: "EMPLOYEE" | "MANAGER" | "HOD"; name: string; email: string | null; signedAt: string | null }[] = [
      {
        role: "EMPLOYEE",
        name: emp?.full_name ?? "—",
        email: emp?.email ?? null,
        signedAt: agreement?.employee_signed_at ?? null,
      },
    ];

    if (!testOnlyEmployeeSigner) {
      if (managerIsInChain) {
        signerChain.push({
          role: "MANAGER",
          name: mgr?.full_name ?? "—",
          email: mgr?.email ?? null,
          signedAt: agreement?.manager_signed_at ?? null,
        });
      }

      signerChain.push({
        role: managerActsAsFinalApprover ? "MANAGER" : "HOD",
        name: managerActsAsFinalApprover ? (mgr?.full_name ?? "—") : (hod?.full_name ?? "—"),
        email: managerActsAsFinalApprover ? (mgr?.email ?? null) : (hod?.email ?? null),
        signedAt: agreement?.hr_signed_at ?? null,
      });
    }

    let scores: { workplan: number; competency: number; overall: number; ratingLabel: string } = {
      workplan: 0,
      competency: 0,
      overall: 0,
      ratingLabel: "—",
    };
    try {
      const showLeadershipParam = req.nextUrl.searchParams.get("showLeadership");
      const showLeadership = showLeadershipParam === "true" || (showLeadershipParam !== "false" && !!appraisal.is_management);
      const input = await buildSummaryInput(appraisalId, supabase, { showLeadership });
      const result = calcSummary(input);
      const workplanComp = result.components.find((c) => c.key === "workplan");
      const ccComp = result.components.find((c) => c.key === "cc");
      scores = {
        workplan: workplanComp?.points ?? 0,
        competency: (ccComp?.points ?? 0) + (result.components.find((c) => c.key === "prod")?.points ?? 0) + (result.components.find((c) => c.key === "technical")?.points ?? 0) + (result.components.find((c) => c.key === "leadership")?.points ?? 0),
        overall: result.totalPoints,
        ratingLabel: GRADE_BANDS[result.overallGrade]?.label ?? result.overallGrade,
      };
    } catch {
      // leave scores as default
    }

    return NextResponse.json({
      agreement: agreement ?? null,
      signers,
      signerChain,
      scores,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
