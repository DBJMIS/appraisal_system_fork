import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { getCurrentUser } from "@/lib/auth";
import { downloadSignedPDF, getAgreementStatus } from "@/lib/adobe-sign";
import { resolveDepartmentHeadSystemUserId } from "@/lib/hrmis-approval-auth";
import { allowAppraisalTestBypass } from "@/lib/appraisal-test-bypass";

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase config");
  return createClient(url, key);
}

function normEmail(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

function emailsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normEmail(a);
  const nb = normEmail(b);
  return na.length > 0 && nb.length > 0 && na === nb;
}

function canSyncAdobe(
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

function adobeStatusKey(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/-/g, "_");
}

/** Adobe REST v6 may expose lifecycle in `status`, `agreementStatus`, or `state`. */
function extractRawAdobeStatus(adobe: Record<string, unknown>): unknown {
  const nested = adobe.agreement as Record<string, unknown> | undefined;
  return adobe.status ?? adobe.agreementStatus ?? adobe.state ?? nested?.status ?? nested?.state;
}

function memberSignedStatus(status: string | undefined): boolean {
  const s = (status ?? "").toUpperCase();
  return (
    s === "COMPLETED" ||
    s === "ESIGNED" ||
    s === "SIGNED" ||
    s === "APPROVED" ||
    s.includes("COMPLETED") ||
    s.includes("SIGNED")
  );
}

type ParticipantSet = {
  order?: number;
  memberInfos?: { email?: string; status?: string }[];
};

function applyParticipantSignatures(
  adobe: Record<string, unknown>,
  ctx: {
    empEmail: string | null | undefined;
    mgrEmail: string | null | undefined;
    hodEmail: string | null | undefined;
    managerIsInChain: boolean;
    testOnlyEmployeeSigner: boolean;
  },
  existing: { employee_signed_at: string | null; manager_signed_at: string | null; hr_signed_at: string | null }
): { employee_signed_at?: string; manager_signed_at?: string; hr_signed_at?: string } {
  const sets = (adobe.participantSetsInfo as ParticipantSet[] | undefined) ?? [];
  const sorted = [...sets].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const now = new Date().toISOString();
  const out: { employee_signed_at?: string; manager_signed_at?: string; hr_signed_at?: string } = {};

  for (const set of sorted) {
    const members = set.memberInfos ?? [];
    if (!members.length) continue;
    const allSigned = members.every((m) => memberSignedStatus(m.status));
    if (!allSigned) continue;
    const email = members[0]?.email;
    if (ctx.testOnlyEmployeeSigner) {
      if (emailsMatch(email, ctx.empEmail)) {
        out.employee_signed_at = existing.employee_signed_at ?? now;
      }
      continue;
    }
    if (emailsMatch(email, ctx.empEmail)) {
      out.employee_signed_at = existing.employee_signed_at ?? now;
    } else if (emailsMatch(email, ctx.mgrEmail)) {
      if (ctx.managerIsInChain) {
        out.manager_signed_at = existing.manager_signed_at ?? now;
      } else {
        out.hr_signed_at = existing.hr_signed_at ?? now;
      }
    } else if (emailsMatch(email, ctx.hodEmail)) {
      out.hr_signed_at = existing.hr_signed_at ?? now;
    }
  }

  return out;
}

/**
 * Manual reconcile with Adobe Sign (backup when webhooks lag or miss events).
 * Auth: NextAuth session via getCurrentUser (same pattern as signoff APIs).
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await getCurrentUser();
    if (!user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: appraisalId } = await params;
    const supabase = getSupabaseAdmin();

    const { data: appraisal, error: appErr } = await supabase
      .from("appraisals")
      .select("id, employee_id, manager_employee_id, division_id, status")
      .eq("id", appraisalId)
      .single();

    if (appErr || !appraisal) {
      return NextResponse.json({ error: "Appraisal not found" }, { status: 404 });
    }

    if (!canSyncAdobe(user, appraisal)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: agreementRow, error: aggErr } = await supabase
      .from("appraisal_agreements")
      .select("*")
      .eq("appraisal_id", appraisalId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (aggErr || !agreementRow?.adobe_agreement_id) {
      return NextResponse.json(
        { error: "No Adobe agreement found for this appraisal", adobeStatus: null, adobeRawStatus: null },
        { status: 404 }
      );
    }

    const adobeApiBase =
      process.env.ADOBE_SIGN_API_BASE ?? "https://api.na2.adobesign.com/api/rest/v6";

    const adobe = await getAgreementStatus(agreementRow.adobe_agreement_id);
    const rawStatus = extractRawAdobeStatus(adobe);
    const adobeStatus = adobeStatusKey(rawStatus);

    console.log("[check-adobe-status]", {
      appraisalId,
      adobeAgreementId: agreementRow.adobe_agreement_id,
      adobeApiBase,
      rawStatus: rawStatus != null ? String(rawStatus) : null,
      adobeStatusNormalized: adobeStatus,
      topLevelKeys: Object.keys(adobe).slice(0, 40),
    });

    const { data: emp } = await supabase
      .from("employees")
      .select("email")
      .eq("employee_id", appraisal.employee_id)
      .single();
    const { data: mgr } = await supabase
      .from("employees")
      .select("email")
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
      ? await supabase.from("employees").select("email").eq("employee_id", hodEmployeeId).single()
      : { data: null };

    const managerActsAsFinalApprover =
      appraisal.manager_employee_id === hodEmployeeId || !!managerUser;
    const testOnlyEmployeeSigner = allowAppraisalTestBypass();
    const managerIsInChain = !testOnlyEmployeeSigner && !managerActsAsFinalApprover;

    const now = new Date().toISOString();

    if (
      adobeStatus === "SIGNED" ||
      adobeStatus === "COMPLETED" ||
      adobeStatus === "APPROVED" ||
      adobeStatus.includes("SIGNED")
    ) {
      const partial = applyParticipantSignatures(adobe, {
        empEmail: emp?.email,
        mgrEmail: mgr?.email,
        hodEmail: hod?.email,
        managerIsInChain,
        testOnlyEmployeeSigner,
      }, {
        employee_signed_at: agreementRow.employee_signed_at,
        manager_signed_at: agreementRow.manager_signed_at,
        hr_signed_at: agreementRow.hr_signed_at,
      });

      let signedPdfPath = agreementRow.signed_pdf_path as string | null;
      let signedPdfUrl = agreementRow.signed_pdf_url as string | null;

      if (!signedPdfPath) {
        const signedPdfBuffer = await downloadSignedPDF(agreementRow.adobe_agreement_id);
        const path = `${appraisalId}/signed-${Date.now()}.pdf`;
        await supabase.storage.from("appraisal-pdfs").upload(path, signedPdfBuffer, { contentType: "application/pdf" });
        const { data: urlData } = await supabase.storage.from("appraisal-pdfs").createSignedUrl(path, 60 * 60 * 24 * 365);
        signedPdfPath = path;
        signedPdfUrl = urlData?.signedUrl ?? null;
      }

      let employeeSigned = partial.employee_signed_at ?? agreementRow.employee_signed_at ?? null;
      let managerSigned = partial.manager_signed_at ?? agreementRow.manager_signed_at ?? null;
      let hrSigned = partial.hr_signed_at ?? agreementRow.hr_signed_at ?? null;

      if (!employeeSigned) employeeSigned = now;
      if (managerIsInChain && !managerSigned) managerSigned = now;
      if (!hrSigned) hrSigned = now;

      const completionUpdate: Record<string, string | null> = {
        status: "SIGNED",
        signed_pdf_path: signedPdfPath,
        signed_pdf_url: signedPdfUrl,
        employee_signed_at: employeeSigned,
        manager_signed_at: managerSigned,
        hr_signed_at: hrSigned,
        updated_at: now,
      };

      await supabase.from("appraisal_agreements").update(completionUpdate).eq("id", agreementRow.id);

      if (appraisal.status === "PENDING_SIGNOFF") {
        await supabase.from("appraisals").update({ status: "HR_REVIEW" }).eq("id", appraisalId);
      }
    } else if (adobeStatus === "OUT_FOR_SIGNATURE" || adobeStatus.includes("SIGNATURE")) {
      const partial = applyParticipantSignatures(adobe, {
        empEmail: emp?.email,
        mgrEmail: mgr?.email,
        hodEmail: hod?.email,
        managerIsInChain,
        testOnlyEmployeeSigner,
      }, {
        employee_signed_at: agreementRow.employee_signed_at,
        manager_signed_at: agreementRow.manager_signed_at,
        hr_signed_at: agreementRow.hr_signed_at,
      });

      if (Object.keys(partial).length > 0) {
        await supabase
          .from("appraisal_agreements")
          .update({
            ...partial,
            updated_at: now,
          })
          .eq("id", agreementRow.id);
      }
    } else if (
      adobeStatus === "CANCELLED" ||
      adobeStatus === "CANCELED" ||
      adobeStatus.includes("CANCEL")
    ) {
      await supabase
        .from("appraisal_agreements")
        .update({
          status: "CANCELLED",
          updated_at: now,
        })
        .eq("id", agreementRow.id);

      await supabase.from("appraisals").update({ status: "MANAGER_REVIEW" }).eq("id", appraisalId).eq("status", "PENDING_SIGNOFF");
    } else if (adobeStatus === "DECLINED" || adobeStatus === "REJECTED" || adobeStatus.includes("DECLIN")) {
      const reason =
        (adobe.message as string | undefined) ??
        (adobe.agreementCancellationInfo as { comment?: string } | undefined)?.comment ??
        null;
      await supabase
        .from("appraisal_agreements")
        .update({
          status: "DECLINED",
          decline_reason: reason,
          declined_at: now,
          updated_at: now,
        })
        .eq("id", agreementRow.id);

      await supabase.from("appraisals").update({ status: "MANAGER_REVIEW" }).eq("id", appraisalId).eq("status", "PENDING_SIGNOFF");
    } else if (adobeStatus === "EXPIRED" || adobeStatus.includes("EXPIR")) {
      await supabase
        .from("appraisal_agreements")
        .update({
          status: "EXPIRED",
          updated_at: now,
        })
        .eq("id", agreementRow.id);

      await supabase.from("appraisals").update({ status: "MANAGER_REVIEW" }).eq("id", appraisalId).eq("status", "PENDING_SIGNOFF");
    }

    const { data: updated, error: readErr } = await supabase
      .from("appraisal_agreements")
      .select("*")
      .eq("id", agreementRow.id)
      .single();

    if (readErr || !updated) {
      return NextResponse.json(
        {
          error: readErr?.message ?? "Failed to read agreement",
          adobeStatus: adobeStatus || null,
          adobeRawStatus: rawStatus != null ? String(rawStatus) : null,
          adobeApiBase,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      agreement: updated,
      adobeStatus: adobeStatus || String(rawStatus ?? ""),
      adobeRawStatus: rawStatus != null ? String(rawStatus) : "",
      adobeApiBase,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: message, adobeStatus: null, adobeRawStatus: null },
      { status: 500 }
    );
  }
}
