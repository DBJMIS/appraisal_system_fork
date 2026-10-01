import { NextRequest, NextResponse } from "next/server";
import { requireHrOrAdmin } from "@/lib/route-guards";
import { allowedTestDomains } from "@/lib/admin-email-tools";
import { sendFeedbackReviewRequest } from "@/lib/feedback-email";

/**
 * POST /api/feedback/test-notification
 * Manually send a single test 360 review request email via Microsoft Graph. HR/Admin only, and only
 * to the allowed test domains (APPRAISAL_TEST_EMAIL_ALLOWED_DOMAINS, else the AZURE_FROM_EMAIL domain).
 * Body: { "toEmail": "recipient@example.com" }
 * Uses sample content: Employee Name "Test Participant", Cycle "Leadership Feedback 2026", Deadline "—".
 * Requires AZURE_AD_* and AZURE_FROM_EMAIL (Mail.Send application permission).
 */
export async function POST(req: NextRequest) {
  try {
    const guard = await requireHrOrAdmin();
    if (!guard.ok) return guard.response;

    const body = await req.json().catch(() => ({}));
    const toEmail = typeof body.toEmail === "string" ? body.toEmail.trim() : "";
    if (!toEmail) {
      return NextResponse.json(
        { error: "Body must include toEmail, e.g. { \"toEmail\": \"you@example.com\" }" },
        { status: 400 }
      );
    }
    const domain = toEmail.includes("@") ? toEmail.split("@").pop()!.toLowerCase() : "";
    if (/[,;\s<>]/.test(toEmail) || !allowedTestDomains().includes(domain)) {
      return NextResponse.json({ error: "Test emails can only be sent to one address on an allowed domain." }, { status: 400 });
    }

    await sendFeedbackReviewRequest({
      toEmail,
      participantName: "Test Participant",
      cycleName: "Leadership Feedback 2026",
      deadline: "—",
    });

    return NextResponse.json({
      ok: true,
      message: "Test notification sent to " + toEmail,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Send failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
