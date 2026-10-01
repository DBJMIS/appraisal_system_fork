import { getCurrentUser } from "@/lib/auth";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { FeedbackReviewForm } from "./feedback-review-form";
import { ArrowLeft } from "lucide-react";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase config required");
  return createClient(url, key);
}

export default async function FeedbackReviewPage({
  params,
}: {
  params: Promise<{ id: string; reviewerId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user?.id || !user?.employee_id) {
    return (
      <div className="w-full px-7 py-6">
        <div className="rounded-ds-panel border border-ds-border bg-white p-6">
          <p className="text-[13px] text-ds-text-secondary">Please sign in to complete this review.</p>
        </div>
      </div>
    );
  }

  const { id: cycleId, reviewerId } = await params;
  const supabase = getSupabase();

  const { data: reviewer, error: revErr } = await supabase
    .from("feedback_reviewer")
    .select("id, cycle_id, participant_employee_id, reviewer_employee_id, reviewer_type, status")
    .eq("id", reviewerId)
    .eq("cycle_id", cycleId)
    .maybeSingle();

  if (revErr || !reviewer) notFound();
  if (reviewer.reviewer_employee_id !== user.employee_id) notFound();

  const { data: cycle } = await supabase
    .from("feedback_cycle")
    .select("cycle_name, status")
    .eq("id", cycleId)
    .maybeSingle();

  const reviewerType = reviewer.reviewer_type as string;
  const { data: questions } = await supabase
    .from("feedback_question")
    .select("id, question_text, competency_group, sort_order")
    .eq("reviewer_type", reviewerType)
    .order("competency_group")
    .order("sort_order");

  const { data: responses } = await supabase
    .from("feedback_response")
    .select("question_id, score, comment, submitted_at")
    .eq("reviewer_id", reviewerId);

  const responseByQuestion = new Map(
    (responses ?? []).map((r) => [r.question_id, { score: r.score, comment: r.comment ?? "", submitted_at: r.submitted_at }])
  );

  const { data: scale } = await supabase
    .from("feedback_rating_scale")
    .select("value, label")
    .order("sort_order");

  const questionsWithResponses = (questions ?? []).map((q) => ({
    id: q.id,
    question_text: q.question_text,
    competency_group: q.competency_group,
    sort_order: q.sort_order,
    score: responseByQuestion.get(q.id)?.score ?? null,
    comment: responseByQuestion.get(q.id)?.comment ?? "",
    submitted_at: responseByQuestion.get(q.id)?.submitted_at ?? null,
  }));

  let participantName: string | null = null;
  let participantJobTitle: string | null = null;
  let participantDepartment: string | null = null;
  if (reviewer.participant_employee_id) {
    const { data: emp } = await supabase
      .from("employees")
      .select("full_name, job_title, department_name")
      .eq("employee_id", reviewer.participant_employee_id)
      .maybeSingle();
    participantName = emp?.full_name ?? null;
    participantJobTitle = emp?.job_title ?? null;
    participantDepartment = emp?.department_name ?? null;
  }

  const title =
    reviewerType === "SELF"
      ? "Your self-assessment"
      : `Reviewing: ${participantName ?? reviewer.participant_employee_id}`;
  const isSubmitted = reviewer.status === "Submitted";

  const reviewee =
    reviewerType !== "SELF" && (participantName || reviewer.participant_employee_id)
      ? {
          full_name: participantName ?? reviewer.participant_employee_id,
          job_title: participantJobTitle ?? undefined,
          department: participantDepartment ?? undefined,
        }
      : undefined;

  return (
    <div className="w-full px-7 py-6">
      <div className="mb-5">
        <Link
          href="/feedback"
          className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-ds-accent hover:text-ds-info transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to 360 Feedback
        </Link>
      </div>
      <FeedbackReviewForm
        cycleId={cycleId}
        reviewerId={reviewerId}
        cycleName={cycle?.cycle_name ?? "Cycle"}
        cycleStatus={cycle?.status ?? ""}
        reviewerType={reviewerType}
        reviewee={reviewee}
        questions={questionsWithResponses}
        scale={scale ?? []}
        isSubmitted={isSubmitted}
      />
    </div>
  );
}
