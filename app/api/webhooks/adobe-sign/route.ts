import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { downloadSignedPDF, fetchAgreementLifecycle } from "@/lib/adobe-sign";
import { sendNotification, type SupabaseLike } from "@/lib/notifications";
import { resolveDepartmentHeadSystemUserId } from "@/lib/hrmis-approval-auth";
import { allowAppraisalTestBypass } from "@/lib/appraisal-test-bypass";

// Adobe Sign webhook verification expects client ID echoed in response header.
export async function GET(req: NextRequest) {
  const verificationCode = req.nextUrl.searchParams.get("verificationCode");
  if (verificationCode) {
    return new NextResponse(verificationCode, { status: 200 });
  }

  const clientId = req.headers.get("x-adobesign-clientid");
  const response = new NextResponse("Webhook received", { status: 200 });
  response.headers.set("X-AdobeSign-ClientId", clientId ?? "");
  return response;
}

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

/** Adobe webhook payloads vary by account/version — try several paths. */
function extractAgreementId(body: Record<string, unknown>): string | undefined {
  const agreement = body.agreement as { id?: string } | undefined;
  if (agreement?.id) return agreement.id;
  const resource = body.resource as { id?: string } | undefined;
  if (resource?.id) return resource.id;
  const rid = body.resourceId ?? body.agreementId;
  if (typeof rid === "string" && rid) return rid;
  return undefined;
}

function extractWebhookEvent(body: Record<string, unknown>): string | undefined {
  const e = body.event;
  if (typeof e === "string" && e) return e;
  const nested = body.webhookNotificationInfo as { event?: string } | undefined;
  if (typeof nested?.event === "string" && nested.event) return nested.event;
  const webhookEvent = body.webhookEvent;
  if (typeof webhookEvent === "string" && webhookEvent) return webhookEvent;
  return undefined;
}

function extractParticipantEmail(body: Record<string, unknown>): string | undefined {
  const actionInfo = body.actionInfo as { participantEmail?: string } | undefined;
  if (actionInfo?.participantEmail) return actionInfo.participantEmail;
  const candidates = [
    body.participantUserEmail,
    body.actingUserEmail,
    body.participantEmail,
    (body.participantUserDetails as { email?: string } | undefined)?.email,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return undefined;
}

export async function POST(req: NextRequest) {
  // Adobe treats a notification as failed unless the client id is echoed back.
  const clientId = req.headers.get("x-adobesign-clientid");
  const reply = (status = 200) => {
    const response = NextResponse.json({ ok: status === 200 }, { status });
    if (clientId) response.headers.set("X-AdobeSign-ClientId", clientId);
    return response;
  };

  try {
    return await handleNotification(req, reply);
  } catch (err) {
    console.error("[webhook] adobe-sign", err);
    return reply(500);
  }
}

async function handleNotification(
  req: NextRequest,
  reply: (status?: number) => NextResponse
): Promise<NextResponse> {
  const supabase = getSupabaseAdmin();
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return reply();
  }

  const event = extractWebhookEvent(body);
  const agreementId = extractAgreementId(body);

  if (!agreementId) return reply();

  const { data: agreement, error: aggErr } = await supabase
    .from("appraisal_agreements")
    .select("id, appraisal_id, status, employee_signed_at, manager_signed_at, hr_signed_at")
    .eq("adobe_agreement_id", agreementId)
    .maybeSingle();

  if (aggErr || !agreement) return reply();

  const { data: appraisal, error: appErr } = await supabase
    .from("appraisals")
    .select("employee_id, manager_employee_id")
    .eq("id", agreement.appraisal_id)
    .single();

  if (appErr || !appraisal) return reply();

  const { data: emp } = await supabase
    .from("employees")
    .select("id, employee_id, email, full_name")
    .eq("employee_id", appraisal.employee_id)
    .single();
  const { data: mgr } = await supabase
    .from("employees")
    .select("id, employee_id, email, full_name")
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
        .select("employee_id, email, full_name")
        .eq("employee_id", hodEmployeeId)
        .single()
    : { data: null };

  const managerActsAsFinalApprover =
    appraisal.manager_employee_id === hodEmployeeId || !!managerUser;
  const testOnlyEmployeeSigner = allowAppraisalTestBypass();
  const managerIsInChain = !testOnlyEmployeeSigner && !managerActsAsFinalApprover;
  const finalSignerEmployeeId = testOnlyEmployeeSigner
    ? appraisal.employee_id
    : (managerActsAsFinalApprover ? appraisal.manager_employee_id : hodEmployeeId);

  const actionInfo = body.actionInfo as { participantEmail?: string; comment?: string } | undefined;
  const signerEmail = extractParticipantEmail(body);

  const normalizedEvent =
    event === "AGREEMENT_WORKFLOW_COMPLETED" || event === "WORKFLOW_COMPLETED"
      ? "AGREEMENT_COMPLETED"
      : event === "AGREEMENT_REJECTED"
        ? "AGREEMENT_DECLINED"
        : event;

  switch (normalizedEvent) {
    case "AGREEMENT_ACTION_COMPLETED": {
      const updates: Record<string, string> = { updated_at: new Date().toISOString() };
      const now = new Date().toISOString();

      if (emailsMatch(signerEmail, emp?.email)) {
        updates.employee_signed_at = now;
        if (managerIsInChain && mgr?.employee_id) {
          await sendNotification(
            {
              recipientEmployeeId: mgr.employee_id,
              type: "SIGNOFF_ACTION_REQUIRED",
              message: `${emp?.full_name ?? "Employee"} has signed their appraisal. Check your email from Adobe Sign to add your signature.`,
              appraisalId: agreement.appraisal_id,
            },
            supabase as unknown as SupabaseLike
          );
        } else if (!testOnlyEmployeeSigner && !managerActsAsFinalApprover && hod?.employee_id) {
          await sendNotification(
            {
              recipientEmployeeId: hod.employee_id,
              type: "SIGNOFF_ACTION_REQUIRED",
              message: `${emp?.full_name ?? "Employee"} has signed their appraisal. Check your email from Adobe Sign to complete sign-off.`,
              appraisalId: agreement.appraisal_id,
            },
            supabase as unknown as SupabaseLike
          );
        }
      } else if (managerIsInChain && emailsMatch(signerEmail, mgr?.email)) {
        updates.manager_signed_at = now;
        if (hod?.employee_id) {
          await sendNotification(
            {
              recipientEmployeeId: hod.employee_id,
              type: "SIGNOFF_ACTION_REQUIRED",
              message: `Manager has signed the appraisal for ${emp?.full_name ?? "Employee"}. Check your email from Adobe Sign to complete sign-off.`,
              appraisalId: agreement.appraisal_id,
            },
            supabase as unknown as SupabaseLike
          );
        }
      } else {
        updates.hr_signed_at = now;
      }

      await supabase.from("appraisal_agreements").update(updates).eq("id", agreement.id);
      break;
    }

    case "AGREEMENT_COMPLETED": {
      if (agreement.status === "SIGNED") break;
      if ((await fetchAgreementLifecycle(agreementId)) !== "SIGNED") break;

      const signedPdfBuffer = await downloadSignedPDF(agreementId);
      const signedPath = `${agreement.appraisal_id}/signed-${Date.now()}.pdf`;

      await supabase.storage
        .from("appraisal-pdfs")
        .upload(signedPath, signedPdfBuffer, { contentType: "application/pdf" });

      const { data: urlData } = await supabase.storage
        .from("appraisal-pdfs")
        .createSignedUrl(signedPath, 60 * 60 * 24 * 365);

      const completedAt = new Date().toISOString();
      const completionUpdate: Record<string, string | null> = {
        status: "SIGNED",
        signed_pdf_url: urlData?.signedUrl ?? null,
        signed_pdf_path: signedPath,
        hr_signed_at: completedAt,
        updated_at: completedAt,
      };
      if (testOnlyEmployeeSigner && !agreement.employee_signed_at) {
        completionUpdate.employee_signed_at = completedAt;
      }

      const { data: claimed } = await supabase
        .from("appraisal_agreements")
        .update(completionUpdate)
        .eq("id", agreement.id)
        .neq("status", "SIGNED")
        .select("id");
      if (!claimed?.length) break;

      await supabase
        .from("appraisals")
        .update({ status: "HR_REVIEW" })
        .eq("id", agreement.appraisal_id)
        .eq("status", "PENDING_SIGNOFF");

      const recipients = Array.from(
        new Set(
          [appraisal.employee_id, managerIsInChain ? appraisal.manager_employee_id : null, finalSignerEmployeeId]
            .filter((v): v is string => Boolean(v))
        )
      );

      for (const recipientEmployeeId of recipients) {
        await sendNotification(
          {
            recipientEmployeeId,
            type: "SIGNOFF_COMPLETE",
            message: `Sign-off is complete for ${emp?.full_name ?? "Employee"}'s FY 2026 appraisal. The appraisal is now moving to HR Review.`,
            appraisalId: agreement.appraisal_id,
          },
          supabase as unknown as SupabaseLike
        );
      }
      break;
    }

    case "AGREEMENT_DECLINED": {
      if ((await fetchAgreementLifecycle(agreementId)) !== "DECLINED") break;
      const declinerEmail = extractParticipantEmail(body) ?? (actionInfo?.participantEmail as string) ?? "";
      const declineReason = (actionInfo?.comment as string) ?? "";

      await supabase
        .from("appraisal_agreements")
        .update({
          status: "DECLINED",
          declined_by_email: declinerEmail,
          decline_reason: declineReason,
          declined_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", agreement.id);

      await supabase
        .from("appraisals")
        .update({ status: "MANAGER_REVIEW" })
        .eq("id", agreement.appraisal_id)
        .eq("status", "PENDING_SIGNOFF");

      if (mgr?.employee_id) {
        await sendNotification(
          {
            recipientEmployeeId: mgr.employee_id,
            type: "SIGNOFF_DECLINED",
            message: `${declinerEmail} has declined to sign the appraisal for ${emp?.full_name ?? "Employee"}. Reason: "${declineReason}". Please review and resubmit for sign-off.`,
            appraisalId: agreement.appraisal_id,
          },
          supabase as unknown as SupabaseLike
        );
      }
      break;
    }

    case "AGREEMENT_EXPIRED": {
      if ((await fetchAgreementLifecycle(agreementId)) !== "EXPIRED") break;
      await supabase
        .from("appraisal_agreements")
        .update({ status: "EXPIRED", updated_at: new Date().toISOString() })
        .eq("id", agreement.id);

      await supabase
        .from("appraisals")
        .update({ status: "MANAGER_REVIEW" })
        .eq("id", agreement.appraisal_id)
        .eq("status", "PENDING_SIGNOFF");

      if (finalSignerEmployeeId) {
        await sendNotification(
          {
            recipientEmployeeId: finalSignerEmployeeId,
            type: "SIGNOFF_EXPIRED",
            message: `The sign-off agreement for ${emp?.full_name ?? "Employee"}'s appraisal has expired after 30 days. The appraisal has been returned to Manager Review.`,
            appraisalId: agreement.appraisal_id,
          },
          supabase as unknown as SupabaseLike
        );
      }
      break;
    }

    case "AGREEMENT_RECALLED": {
      if ((await fetchAgreementLifecycle(agreementId)) !== "CANCELLED") break;
      await supabase
        .from("appraisal_agreements")
        .update({ status: "CANCELLED", updated_at: new Date().toISOString() })
        .eq("id", agreement.id);
      break;
    }

    default:
      break;
  }

  return reply();
}
