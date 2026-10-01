import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import { generateAppraisalPDFWithScore } from "@/lib/appraisal-pdf";
import { persistScoreSnapshot } from "@/lib/appraisal-score-snapshot";
import { uploadTransientDocument, createAgreement } from "@/lib/adobe-sign";
import { resolveDepartmentHeadSystemUserId } from "@/lib/hrmis-approval-auth";
import { resolveManagerAccessForAppraisal } from "@/lib/appraisal-manager-access";
import { allowAppraisalTestBypass } from "@/lib/appraisal-test-bypass";
import { fetchCompletionReport } from "@/lib/appraisal-completion-report";

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
    if (!currentUser?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: appraisalId } = await params;
    const supabase = getSupabaseAdmin();

    const { data: appraisal, error: appErr } = await supabase
      .from("appraisals")
      .select("id, employee_id, manager_employee_id, status, manager_comments")
      .eq("id", appraisalId)
      .single();

    if (appErr || !appraisal) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const managerAccess = await resolveManagerAccessForAppraisal({
      supabase,
      appraisalId,
      appraisalEmployeeId: appraisal.employee_id,
      appraisalManagerEmployeeId: appraisal.manager_employee_id,
      currentEmployeeId: currentUser.employee_id ?? null,
    });
    const isManager = managerAccess.hasManagerAccess;
    const isHR = currentUser.roles?.some((r) => r === "hr" || r === "admin");
    if (!isManager && !isHR) {
      return NextResponse.json({ error: "Only the manager or HR may submit for sign-off" }, { status: 403 });
    }
    if (appraisal.status !== "MANAGER_REVIEW") {
      return NextResponse.json({ error: "Appraisal must be in MANAGER_REVIEW status" }, { status: 400 });
    }

    const { data: existing } = await supabase
      .from("appraisal_agreements")
      .select("id")
      .eq("appraisal_id", appraisalId)
      .in("status", ["OUT_FOR_SIGNATURE"])
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ error: "An active sign-off agreement already exists" }, { status: 400 });
    }

    const report = await fetchCompletionReport(supabase, appraisalId);
    if (!report?.canSubmit) {
      const message = report?.blockers?.length
        ? `Complete all required fields before sign-off: ${report.blockers.join("; ")}`
        : "Complete all required fields before sign-off.";
      return NextResponse.json({ error: message, blockers: report?.blockers }, { status: 400 });
    }

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

    if (!emp?.email) return NextResponse.json({ error: "Employee email not found" }, { status: 400 });
    if (!mgr?.email) return NextResponse.json({ error: "Manager email not found" }, { status: 400 });

    const { data: managerUser } = await supabase
      .from("app_users")
      .select("role")
      .eq("employee_id", appraisal.manager_employee_id)
      .in("role", ["gm", "admin"])
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    const hodEmployeeId = await resolveDepartmentHeadSystemUserId(appraisal.employee_id);
    let hod = null as { full_name: string | null; email: string | null } | null;
    if (hodEmployeeId) {
      const { data: hodEmp } = await supabase
        .from("employees")
        .select("full_name, email")
        .eq("employee_id", hodEmployeeId)
        .single();
      hod = hodEmp ?? null;
    }

    const managerActsAsFinalApprover =
      appraisal.manager_employee_id === hodEmployeeId || !!managerUser;

    const testOnlyEmployeeSigner = allowAppraisalTestBypass();

    const signers: { email: string; name: string }[] = [
      { email: emp.email, name: emp.full_name ?? "Employee" },
    ];

    if (!testOnlyEmployeeSigner) {
      if (!managerActsAsFinalApprover) {
        signers.push({ email: mgr.email, name: mgr.full_name ?? "Manager" });
      }

      if (managerActsAsFinalApprover) {
        signers.push({ email: mgr.email, name: mgr.full_name ?? "Manager" });
      } else {
        if (!hod?.email) return NextResponse.json({ error: "No HOD configured" }, { status: 500 });
        signers.push({ email: hod.email, name: hod.full_name ?? "Head of Department" });
      }
    }

    const body = await req.json().catch(() => ({}));
    if (body.managerComments != null) {
      await supabase
        .from("appraisals")
        .update({ manager_comments: body.managerComments })
        .eq("id", appraisalId);
    }

    const { pdf: pdfBuffer, scoreSource } = await generateAppraisalPDFWithScore(appraisalId);

    const draftPath = `${appraisalId}/draft-${Date.now()}.pdf`;
    const { error: storageError } = await supabase.storage
      .from("appraisal-pdfs")
      .upload(draftPath, pdfBuffer, { contentType: "application/pdf" });

    if (storageError) {
      return NextResponse.json({ error: `Storage upload failed: ${storageError.message}` }, { status: 500 });
    }

    const filename = `Appraisal_${(emp.full_name ?? "Employee").replace(/\s/g, "_")}_FY2026.pdf`;
    const transientId = await uploadTransientDocument(pdfBuffer, filename);

    const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/webhooks/adobe-sign`;
    const agreementId = await createAgreement({
      transientDocumentId: transientId,
      agreementName: `FY 2026 Annual Appraisal — ${emp.full_name ?? "Employee"}`,
      signers,
      webhookUrl,
    });

    await supabase.from("appraisal_agreements").insert({
      appraisal_id: appraisalId,
      adobe_agreement_id: agreementId,
      status: "OUT_FOR_SIGNATURE",
      draft_pdf_path: draftPath,
      initiated_by: currentUser.employee_id ?? null,
    });

    await supabase
      .from("appraisals")
      .update({ status: "PENDING_SIGNOFF" })
      .eq("id", appraisalId);

    if (scoreSource) {
      try {
        await persistScoreSnapshot({
          supabase,
          appraisalId,
          scoreType: "FINAL",
          isManagementTrack: scoreSource.isManagementTrack,
          input: scoreSource.input,
          result: scoreSource.result,
          actor: currentUser.id,
        });
      } catch (snapshotErr) {
        console.error("[signoff/submit] FINAL score snapshot not stored:", snapshotErr);
      }
    }

    try {
      const { createNotificationForEmployeeId } = await import("@/lib/notifications/create");
      await createNotificationForEmployeeId(appraisal.employee_id, {
        type: "appraisal.sign_off_ready",
        title: "Sign-off started",
        body: "Your appraisal is ready for sign-off. Check your email from Adobe Sign to add your signature.",
        link: `/appraisals/${appraisalId}`,
        metadata: { appraisal_id: appraisalId },
      });
    } catch {
      /* non-blocking */
    }

    return NextResponse.json({ success: true, agreementId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
