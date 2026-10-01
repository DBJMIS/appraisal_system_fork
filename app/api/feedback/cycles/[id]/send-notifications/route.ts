import { NextRequest, NextResponse } from "next/server";
import { requireHrOrAdmin } from "@/lib/route-guards";
import { createClient } from "@supabase/supabase-js";
import { sendFeedbackReviewRequest } from "@/lib/feedback-email";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase config required");
  return createClient(url, key);
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

/**
 * POST /api/feedback/cycles/[id]/send-notifications
 * Manually send 360 review request emails to all reviewers for this cycle.
 * Uses Microsoft Graph (AZURE_AD_* and AZURE_FROM_EMAIL).
 * For testing: call this after activating a cycle that has participants/reviewers.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await requireHrOrAdmin();
    if (!guard.ok) return guard.response;

    const { id: cycleId } = await params;
    if (!cycleId) {
      return NextResponse.json({ error: "cycle id required" }, { status: 400 });
    }

    const supabase = getSupabase();

    const { data: cycle, error: cycleErr } = await supabase
      .from("feedback_cycle")
      .select("id, cycle_name, end_date")
      .eq("id", cycleId)
      .maybeSingle();

    if (cycleErr || !cycle) {
      return NextResponse.json({ error: "Cycle not found" }, { status: 404 });
    }

    const deadline = formatDate(cycle.end_date);

    const { data: reviewers, error: revErr } = await supabase
      .from("feedback_reviewer")
      .select("participant_employee_id, reviewer_employee_id")
      .eq("cycle_id", cycleId);

    if (revErr) {
      return NextResponse.json({ error: revErr.message }, { status: 500 });
    }

    if (!reviewers?.length) {
      return NextResponse.json({
        sent: 0,
        message: "No reviewers found for this cycle. Activate the cycle to generate participants and reviewers.",
      });
    }

    const participantIds = [...new Set(reviewers.map((r) => r.participant_employee_id))];
    const { data: participantNames } = await supabase
      .from("employees")
      .select("employee_id, full_name")
      .in("employee_id", participantIds);
    const nameMap = new Map((participantNames ?? []).map((p) => [p.employee_id, p.full_name ?? p.employee_id]));

    const reviewerIds = [...new Set(reviewers.map((r) => r.reviewer_employee_id))];
    const { data: reviewerEmails } = await supabase
      .from("employees")
      .select("employee_id, email")
      .in("employee_id", reviewerIds);
    const emailMap = new Map((reviewerEmails ?? []).map((e) => [e.employee_id, e.email]));

    let sent = 0;
    const failures: { reviewer_employee_id: string; error: string }[] = [];

    const { data: reviewerAppUsers } = await supabase
      .from("app_users")
      .select("id, employee_id")
      .in("employee_id", reviewerIds)
      .eq("is_active", true);
    const appUserIdByReviewer = new Map(
      (reviewerAppUsers ?? []).map((r) => [r.employee_id as string, r.id as string])
    );
    const inAppByReviewer = new Set<string>();
    const { createNotification } = await import("@/lib/notifications/create");

    for (const row of reviewers) {
      const toEmail = emailMap.get(row.reviewer_employee_id);
      if (!toEmail || !toEmail.trim()) {
        failures.push({ reviewer_employee_id: row.reviewer_employee_id, error: "No email for reviewer" });
        continue;
      }
      const participantName = nameMap.get(row.participant_employee_id) ?? row.participant_employee_id;
      try {
        await sendFeedbackReviewRequest({
          toEmail: toEmail.trim(),
          participantName,
          cycleName: cycle.cycle_name,
          deadline,
        });
        sent++;
        const uid = appUserIdByReviewer.get(row.reviewer_employee_id);
        if (uid && !inAppByReviewer.has(row.reviewer_employee_id)) {
          inAppByReviewer.add(row.reviewer_employee_id);
          try {
            await createNotification({
              user_id: uid,
              type: "feedback.assigned",
              title: "360 review assigned",
              body: `You have been asked to complete a feedback review for ${participantName}.`,
              link: "/feedback",
              metadata: { cycle_id: cycleId, participant_employee_id: row.participant_employee_id },
            });
          } catch {
            /* non-blocking */
          }
        }
      } catch (err) {
        failures.push({
          reviewer_employee_id: row.reviewer_employee_id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return NextResponse.json({
      sent,
      total: reviewers.length,
      failures: failures.length ? failures : undefined,
      message: `Sent ${sent} of ${reviewers.length} review request notification(s).`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Send failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
