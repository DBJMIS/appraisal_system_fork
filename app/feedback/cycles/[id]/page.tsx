import { getCurrentUser } from "@/lib/auth";
import Link from "next/link";
import { createClient } from "@supabase/supabase-js";
import { notFound } from "next/navigation";
import { ensureParticipantIfLeader } from "@/lib/feedback-ensure-participant";
import { avatarAccent } from "@/lib/avatar-accent";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase config required");
  return createClient(url, key);
}

function getInitials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
}

function capitalize(str: string) {
  return str.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function TypeBadge({ type }: { type: string }) {
  const map: Record<string, string> = {
    ANNUAL: "bg-ds-info-subtle border-ds-info-border text-ds-info",
    MID_YEAR: "bg-ds-warning-subtle border-ds-warning-border text-ds-warning",
    PEER: "bg-ds-surface border-ds-border-strong text-ds-info",
    DIRECT_REPORT: "bg-ds-info-subtle border-ds-info-border text-ds-info",
    MANAGER: "bg-ds-warning-subtle border-ds-warning-border text-ds-warning",
    SELF: "bg-ds-success-subtle border-ds-success-border text-ds-success",
  };
  const label = type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-ds-badge border text-[10px] font-semibold ${map[type] ?? map.PEER}`}>
      {label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; dot: string; className: string }> = {
    SUBMITTED: { label: "Submitted", dot: "#34d399", className: "bg-ds-success-subtle border-ds-success-border text-ds-success" },
    PENDING: { label: "Pending", dot: "#fbbf24", className: "bg-ds-warning-subtle border-ds-warning-border text-ds-warning" },
    IN_PROGRESS: { label: "In progress", dot: "#a78bfa", className: "bg-ds-lavender-subtle border-ds-lavender-border text-ds-lavender-text" },
    COMPLETED: { label: "Completed", dot: "#34d399", className: "bg-ds-success-subtle border-ds-success-border text-ds-success" },
    DRAFT: { label: "Draft", dot: "#646f79", className: "bg-ds-surface border-ds-border text-ds-text-secondary" },
    Active: { label: "Active", dot: "#34d399", className: "bg-ds-success-subtle border-ds-success-border text-ds-success" },
    Closed: { label: "Closed", dot: "#646f79", className: "bg-ds-surface border-ds-border text-ds-text-secondary" },
  };
  const s = map[status] ?? map.PENDING;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-ds-badge border text-[10px] font-semibold ${s.className}`}>
      <span className="w-[5px] h-[5px] rounded-full flex-shrink-0" style={{ background: s.dot }} />
      {s.label}
    </span>
  );
}

interface ReviewerForCycle {
  id: string;
  name: string;
  department: string | null;
  reviewType: string;
  status: string;
  score: number | null;
}

export default async function FeedbackCyclePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user?.id) {
    return (
      <div className="w-full px-7 py-6">
        <div className="rounded-ds-panel border border-ds-border bg-white p-6">
          <p className="text-[13px] text-ds-text-secondary">Please sign in to view this cycle.</p>
        </div>
      </div>
    );
  }

  const { id: cycleId } = await params;
  const supabase = getSupabase();

  const { data: cycle, error } = await supabase
    .from("feedback_cycle")
    .select("id, cycle_name, start_date, end_date, status, peer_feedback_visible_to_reviewee, direct_report_feedback_visible_to_reviewee")
    .eq("id", cycleId)
    .maybeSingle();

  if (error || !cycle) {
    notFound();
  }

  const isActive = cycle.status === "Active";
  if (isActive && user.employee_id) {
    await ensureParticipantIfLeader(cycleId, user.employee_id, user.email);
  }

  // Reviewers assigned to this participant (people reviewing me), including SELF
  const { data: reviewerRows } = await supabase
    .from("feedback_reviewer")
    .select("id, reviewer_employee_id, reviewer_type, status")
    .eq("cycle_id", cycleId)
    .eq("participant_employee_id", user.employee_id ?? "");

  const allReviewers = reviewerRows ?? [];
  const selfRow = allReviewers.find((r) => (r.reviewer_type as string) === "SELF");
  const others = allReviewers.filter((r) => (r.reviewer_type as string) !== "SELF");
  const managerReviewer = others.find((r) => (r.reviewer_type as string) === "MANAGER");

  // Average score per reviewer from feedback_response
  const reviewerIds = allReviewers.map((r) => r.id);
  let scoreByReviewerId = new Map<string, number>();
  if (reviewerIds.length > 0) {
    const { data: responses } = await supabase
      .from("feedback_response")
      .select("reviewer_id, score")
      .in("reviewer_id", reviewerIds)
      .not("submitted_at", "is", null);
    const sumByReviewer = new Map<string, { sum: number; count: number }>();
    for (const row of responses ?? []) {
      if (row.score == null) continue;
      const cur = sumByReviewer.get(row.reviewer_id) ?? { sum: 0, count: 0 };
      cur.sum += row.score;
      cur.count += 1;
      sumByReviewer.set(row.reviewer_id, cur);
    }
    sumByReviewer.forEach((v, reviewerId) => {
      if (v.count > 0) scoreByReviewerId.set(reviewerId, v.sum / v.count);
    });
  }

  const byTypeScores: Record<string, number[]> = {};
  for (const r of others) {
    const score = scoreByReviewerId.get(r.id);
    if (score == null) continue;
    const type = (r.reviewer_type as string) ?? "PEER";
    if (!byTypeScores[type]) byTypeScores[type] = [];
    byTypeScores[type].push(score);
  }
  const avg = (vals: number[]) => (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null);
  const managerAvg = avg(byTypeScores.MANAGER ?? []);
  const peerAvg = avg(byTypeScores.PEER ?? []);
  const directAvg = avg(byTypeScores.DIRECT_REPORT ?? []);
  const weightedOverall = (() => {
    let total = 0;
    let used = 0;
    if (managerAvg != null) {
      total += managerAvg * 0.4;
      used += 0.4;
    }
    if (peerAvg != null) {
      total += peerAvg * 0.35;
      used += 0.35;
    }
    if (directAvg != null) {
      total += directAvg * 0.25;
      used += 0.25;
    }
    return used > 0 ? total / used : null;
  })();

  let managerResponses: { question: string; score: number | null; comment: string | null }[] = [];
  if (managerReviewer) {
    const { data: mgrResp } = await supabase
      .from("feedback_response")
      .select("score, comment, question_id")
      .eq("reviewer_id", managerReviewer.id)
      .not("submitted_at", "is", null);
    const qIds = [...new Set((mgrResp ?? []).map((r) => r.question_id))];
    const { data: qRows } = qIds.length
      ? await supabase.from("feedback_question").select("id, question_text").in("id", qIds)
      : { data: [] as { id: string; question_text: string }[] };
    const qById = new Map((qRows ?? []).map((q) => [q.id, q.question_text]));
    managerResponses = (mgrResp ?? []).map((r) => ({
      question: qById.get(r.question_id) ?? "Question",
      score: r.score == null ? null : Number(r.score),
      comment: r.comment ?? null,
    }));
  }

  // When closed, get reviewer names (all others — anonymity lifted)
  let nameByReviewerId = new Map<string, string>();
  let departmentByReviewerId = new Map<string, string | null>();
  if (cycle.status === "Closed" && others.length > 0) {
    const empIds = others.map((r) => r.reviewer_employee_id);
    const { data: employees } = await supabase
      .from("employees")
      .select("employee_id, full_name, department_name")
      .in("employee_id", empIds);
    const byEmpId = new Map((employees ?? []).map((e) => [e.employee_id, e]));
    others.forEach((r) => {
      const emp = byEmpId.get(r.reviewer_employee_id);
      nameByReviewerId.set(r.id, emp?.full_name ?? r.reviewer_employee_id);
      departmentByReviewerId.set(r.id, emp?.department_name ?? null);
    });
  }

  const selfAssessment = selfRow
    ? {
        id: selfRow.id,
        status: selfRow.status === "Submitted" ? "SUBMITTED" : "PENDING",
        score: scoreByReviewerId.get(selfRow.id) ?? null,
      }
    : null;

  // Show all assigned reviewers in table (anonymous when active, names when closed)
  const reviewersForTable: ReviewerForCycle[] = others.map((r) => ({
    id: r.id,
    name: nameByReviewerId.get(r.id) ?? "",
    department: departmentByReviewerId.get(r.id) ?? null,
    reviewType: (r.reviewer_type as string) ?? "—",
    status: r.status === "Submitted" ? (cycle.status === "Closed" ? "COMPLETED" : "SUBMITTED") : "PENDING",
    score: scoreByReviewerId.get(r.id) ?? null,
  }));

  const allForKpi = allReviewers.map((r) => ({
    status: r.status === "Submitted" ? "COMPLETED" : "PENDING",
  }));
  const submittedCount = allForKpi.filter((r) => r.status === "COMPLETED").length;
  const pendingCount = allForKpi.filter((r) => r.status === "PENDING").length;

  const cycleStatusBadge = cycle.status === "Active" ? "Active" : "Closed";

  return (
    <div className="w-full px-7 py-6 space-y-6">
      <div className="mb-5">
        <Link
          href="/feedback"
          className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-ds-accent hover:text-ds-info transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to 360 Feedback
        </Link>
      </div>

      {/* Cycle info card header */}
      <div className="bg-white border border-ds-border rounded-ds-panel overflow-hidden mb-4">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-ds-border bg-ds-surface">
          <div className="w-9 h-9 rounded-ds-panel bg-ds-info-subtle border border-ds-info-border flex items-center justify-center flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3d5a78" strokeWidth="2">
              <circle cx="12" cy="12" r="4" />
              <path d="M16 8v5a3 3 0 006 0v-1a10 10 0 10-3.92 7.94" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="font-sans text-[15px] font-semibold text-ds-text-primary">{cycle.cycle_name}</p>
            <p className="text-[11px] text-ds-text-secondary mt-0.5">
              {formatDate(cycle.start_date)} – {formatDate(cycle.end_date)} · {cycle.status}
            </p>
          </div>
          <StatusBadge status={cycleStatusBadge} />
        </div>
        <div className="grid grid-cols-3 divide-x divide-ds-border">
          <div className="flex flex-col items-center py-4 gap-0.5">
            <span className="font-sans text-[22px] font-semibold text-ds-success">{submittedCount}</span>
            <span className="text-[10px] uppercase tracking-[.06em] text-ds-text-secondary">Submitted</span>
          </div>
          <div className="flex flex-col items-center py-4 gap-0.5">
            <span className="font-sans text-[22px] font-semibold text-ds-warning">{pendingCount}</span>
            <span className="text-[10px] uppercase tracking-[.06em] text-ds-text-secondary">Pending</span>
          </div>
          <div className="flex flex-col items-center py-4 gap-0.5">
            <span className="font-sans text-[22px] font-semibold text-ds-text-primary">{allForKpi.length}</span>
            <span className="text-[10px] uppercase tracking-[.06em] text-ds-text-secondary">Total reviewers</span>
          </div>
        </div>
        {weightedOverall != null && (
          <div className="px-5 py-3 border-t border-ds-border bg-ds-surface flex items-center justify-between">
            <p className="text-[11px] font-semibold text-ds-text-primary">Overall 360 score</p>
            <p className="text-[16px] font-semibold text-ds-accent">{weightedOverall.toFixed(2)} / 5.00</p>
          </div>
        )}
      </div>

      {/* Self-assessment section */}
      <div className="bg-white border border-ds-border rounded-ds-panel overflow-hidden mb-4">
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-ds-border bg-ds-surface">
          <p className="text-[10px] font-semibold uppercase tracking-[.07em] text-ds-text-secondary">Your self-assessment</p>
        </div>
        <div className="flex items-center gap-3 px-5 py-4">
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-[12px] font-semibold flex-shrink-0" style={avatarAccent(user.name ?? user.email).style}>
            {getInitials(user.name ?? user.email ?? "U")}
          </div>
          <div className="flex-1">
            <p className="text-[13px] font-semibold text-ds-text-primary">Your self-assessment</p>
            <p className="text-[11px] text-ds-text-secondary mt-0.5">
              {selfAssessment?.status === "SUBMITTED" ? "Completed and submitted" : "Not yet submitted"}
            </p>
          </div>
          {selfAssessment?.score != null && (
            <div className="flex items-center gap-2 mr-4">
              <div className="w-20 h-1.5 rounded-full bg-ds-border overflow-hidden">
                <div
                  className="h-full rounded-full bg-ds-accent"
                  style={{ width: `${(selfAssessment.score / 5) * 100}%` }}
                />
              </div>
              <span className="text-[13px] font-semibold text-ds-text-primary">{selfAssessment.score.toFixed(1)}</span>
            </div>
          )}
          <StatusBadge status={selfAssessment?.status ?? "PENDING"} />
          {selfRow && (
            <Link
              href={`/feedback/cycles/${cycleId}/review/${selfRow.id}`}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[8px] border border-ds-border text-[11px] font-semibold text-ds-text-secondary hover:border-ds-text-primary hover:text-ds-text-primary transition-colors ml-2"
            >
              {selfAssessment?.status === "SUBMITTED" ? "View" : "Start"}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </Link>
          )}
        </div>
      </div>

      {/* Reviewers section — anonymous when active, revealed when closed */}
      <div className="bg-white border border-ds-border rounded-ds-panel overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-ds-border bg-ds-surface">
          <p className="text-[10px] font-semibold uppercase tracking-[.07em] text-ds-text-secondary">Reviewers</p>
          {isActive && (
            <div className="flex items-center gap-1.5">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#646f79" strokeWidth="2">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0110 0v4" />
              </svg>
              <span className="text-[10px] text-ds-text-secondary">Reviewer names are hidden until the cycle closes</span>
            </div>
          )}
        </div>
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-ds-surface">
              <th className="px-5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[.06em] text-ds-text-secondary border-b border-ds-border w-[35%]">
                Reviewer
              </th>
              <th className="px-5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[.06em] text-ds-text-secondary border-b border-ds-border w-[18%]">
                Type
              </th>
              <th className="px-5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[.06em] text-ds-text-secondary border-b border-ds-border w-[20%]">
                Status
              </th>
              <th className="px-5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-[.06em] text-ds-text-secondary border-b border-ds-border w-[15%]">
                Score
              </th>
              <th className="px-5 py-2.5 border-b border-ds-border" />
            </tr>
          </thead>
          <tbody>
            {reviewersForTable.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-[12px] text-ds-text-secondary">
                  No other reviewers assigned for this cycle.
                </td>
              </tr>
            ) : (
              reviewersForTable.map((reviewer, i) => {
              const sameTypeIndex = reviewersForTable
                .slice(0, i + 1)
                .filter((r) => r.reviewType === reviewer.reviewType).length;
              const anonymousLabel = `${capitalize(reviewer.reviewType)} reviewer ${sameTypeIndex}`;

              return (
                <tr key={reviewer.id} className="border-t border-ds-border hover:bg-ds-surface transition-colors">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2.5">
                      {isActive ? (
                        <div className="w-8 h-8 rounded-full bg-ds-surface border border-ds-border flex items-center justify-center flex-shrink-0">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#646f79" strokeWidth="2">
                            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                            <circle cx="12" cy="7" r="4" />
                          </svg>
                        </div>
                      ) : (
                        <div
                          className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold flex-shrink-0"
                          style={avatarAccent(reviewer.name).style}
                        >
                          {getInitials(reviewer.name || "?")}
                        </div>
                      )}
                      <div>
                        <p className="text-[12px] font-semibold text-ds-text-primary">
                          {isActive ? anonymousLabel : reviewer.name}
                        </p>
                        {!isActive && reviewer.department && (
                          <p className="text-[10px] text-ds-text-secondary mt-0.5">{reviewer.department}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <TypeBadge type={reviewer.reviewType} />
                  </td>
                  <td className="px-5 py-3.5">
                    <StatusBadge status={reviewer.status} />
                  </td>
                  <td className="px-5 py-3.5">
                    {!isActive && reviewer.score != null ? (
                      <div className="flex items-center gap-2">
                        <div className="w-14 h-1.5 rounded-full bg-ds-border overflow-hidden">
                          <div
                            className="h-full rounded-full bg-ds-accent"
                            style={{ width: `${(reviewer.score / 5) * 100}%` }}
                          />
                        </div>
                        <span className="text-[12px] font-semibold text-ds-text-primary">{reviewer.score.toFixed(1)}</span>
                      </div>
                    ) : (
                      <span className="text-[12px] text-ds-text-secondary">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    {!isActive && reviewer.status === "COMPLETED" && (
                      <Link
                        href={`/feedback/cycles/${cycleId}/report`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] border border-ds-border text-[11px] font-semibold text-ds-text-secondary hover:border-ds-text-primary hover:text-ds-text-primary transition-colors"
                      >
                        View
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })
            )}
          </tbody>
        </table>
      </div>

      <div className="bg-white border border-ds-border rounded-ds-panel overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-ds-border bg-ds-surface">
          <p className="text-[10px] font-semibold uppercase tracking-[.07em] text-ds-text-secondary">Visibility Summary</p>
        </div>
        <div className="p-5 space-y-2">
          <p className="text-[12px] text-ds-text-primary">Peers — {(byTypeScores.PEER ?? []).length} reviewer(s), average: {peerAvg != null ? peerAvg.toFixed(2) : "—"}</p>
          <p className="text-[12px] text-ds-text-primary">Direct reports — {(byTypeScores.DIRECT_REPORT ?? []).length} reviewer(s), average: {directAvg != null ? directAvg.toFixed(2) : "—"}</p>
          <p className="text-[12px] text-ds-text-primary">Manager average: {managerAvg != null ? managerAvg.toFixed(2) : "—"}</p>
          {managerResponses.length > 0 ? (
            <div className="mt-3">
              <p className="text-[11px] font-semibold text-ds-text-primary mb-2">Manager feedback (attributed)</p>
              <div className="space-y-2">
                {managerResponses.map((r, idx) => (
                  <div key={idx} className="border border-ds-border rounded-[8px] p-3">
                    <p className="text-[11px] text-ds-text-secondary">{r.question}</p>
                    <p className="text-[11px] text-ds-text-primary mt-1">Score: {r.score != null ? r.score.toFixed(1) : "—"}</p>
                    {r.comment && <p className="text-[11px] text-ds-text-secondary mt-1">{r.comment}</p>}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-ds-text-secondary mt-2">Manager feedback will appear after submission.</p>
          )}
        </div>
      </div>
    </div>
  );
}
