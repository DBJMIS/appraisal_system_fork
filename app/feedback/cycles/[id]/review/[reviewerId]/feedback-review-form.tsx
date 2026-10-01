"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send, UserCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { avatarAccent } from "@/lib/avatar-accent";

interface QuestionRow {
  id: string;
  question_text: string;
  competency_group: string;
  sort_order: number;
  score: number | null;
  comment: string;
  submitted_at: string | null;
}

interface ScaleRow {
  value: number;
  label: string;
}

interface RevieweeInfo {
  full_name: string;
  job_title?: string;
  department?: string;
}

interface FeedbackReviewFormProps {
  cycleId: string;
  reviewerId: string;
  cycleName: string;
  cycleStatus: string;
  reviewerType: string;
  reviewee?: RevieweeInfo;
  questions: QuestionRow[];
  scale: ScaleRow[];
  isSubmitted: boolean;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((s) => s[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function FeedbackReviewForm({
  cycleId,
  reviewerId,
  cycleName,
  cycleStatus,
  reviewerType,
  reviewee,
  questions,
  scale,
  isSubmitted,
}: FeedbackReviewFormProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<null | "submitted" | "updated">(null);
  const [state, setState] = useState<Record<string, { score: number | null; comment: string }>>(() => {
    const out: Record<string, { score: number | null; comment: string }> = {};
    for (const q of questions) {
      out[q.id] = { score: q.score, comment: q.comment };
    }
    return out;
  });

  const update = (questionId: string, score: number | null, comment: string) => {
    setState((prev) => ({ ...prev, [questionId]: { score, comment } }));
  };

  const saveDraft = async () => {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/feedback/cycles/${cycleId}/review/${reviewerId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responses: state, submit: false }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Save failed");
        return;
      }
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    setError(null);
    setSubmitSuccess(null);
    const amendingSubmitted = isSubmitted;
    setSaving(true);
    try {
      const res = await fetch(`/api/feedback/cycles/${cycleId}/review/${reviewerId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responses: state, submit: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Submit failed");
        return;
      }
      setSubmitSuccess(amendingSubmitted ? "updated" : "submitted");
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const byGroup = new Map<string, QuestionRow[]>();
  for (const q of questions) {
    const g = q.competency_group || "Other";
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push(q);
  }
  const groups = Array.from(byGroup.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  const answeredCount = questions.filter((q) => {
    const s = state[q.id];
    return s ? s.score != null : q.score != null;
  }).length;
  const totalCount = questions.length;
  const isComplete = totalCount > 0 && answeredCount === totalCount;
  const statusClass = isSubmitted ? "text-ds-success" : "text-ds-warning";
  const allowEdit = !isSubmitted || cycleStatus === "Active";

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.1em] text-ds-text-secondary mb-1">
            {reviewerType === "SELF" ? "Self-Assessment" : "Peer Review"}
          </p>
          <h1 className="font-sans text-[20px] font-semibold text-ds-text-primary">
            {reviewerType === "SELF" ? cycleName : `Reviewing: ${reviewee?.full_name ?? "Unknown"}`}
          </h1>
          <p className="text-[13px] text-ds-text-secondary mt-1">
            {reviewerType === "SELF" ? (
              <>
                {cycleName} · {isSubmitted ? <span className={statusClass}>Submitted</span> : <span className={statusClass}>Pending</span>}
              </>
            ) : (
              <>
                {cycleName}
                {reviewee?.job_title ? ` · ${reviewee.job_title}` : ""}
                {" · "}
                {isSubmitted ? <span className={statusClass}>Submitted</span> : <span className={statusClass}>Pending</span>}
              </>
            )}
          </p>
        </div>
        {allowEdit && totalCount > 0 && (
          <div className="flex flex-col items-end gap-1">
            <span className="text-[11px] font-semibold text-ds-text-secondary">
              {answeredCount} of {totalCount} answered
            </span>
            <div className="w-[140px] h-[6px] rounded-full bg-ds-surface overflow-hidden">
              <div
                className="h-full rounded-full bg-ds-info transition-all"
                style={{ width: `${(answeredCount / totalCount) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Reviewee identity card (peer/direct report) */}
      {reviewee && reviewerType !== "SELF" && (
        <div className="flex items-center gap-4 p-4 mb-6 bg-white border border-ds-border rounded-ds-panel">
          <div
            className="w-11 h-11 rounded-ds-panel flex items-center justify-center text-[13px] font-semibold flex-shrink-0"
            style={avatarAccent(reviewee.full_name).style}
          >
            {initials(reviewee.full_name)}
          </div>
          <div>
            <p className="font-sans text-[14px] font-semibold text-ds-text-primary">{reviewee.full_name}</p>
            <p className="text-[12px] text-ds-text-secondary">
              {[reviewee.job_title, reviewee.department].filter(Boolean).join(" · ") || "—"}
            </p>
          </div>
          <div className="ml-auto">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-ds-badge bg-ds-info-subtle border border-ds-info-border text-ds-info text-[10px] font-semibold">
              <UserCheck className="w-3 h-3" />
              Peer Review
            </span>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-[8px] border border-ds-error-border bg-ds-error-subtle px-4 py-2 text-[13px] text-ds-error">
          {error}
        </div>
      )}

      {submitSuccess && (
        <div className="rounded-[8px] border border-ds-success-border bg-ds-success-subtle px-4 py-2 text-[13px] text-ds-success">
          {submitSuccess === "updated"
            ? "Your updates were saved successfully."
            : "Your assessment was submitted successfully."}
        </div>
      )}

      {groups.map(([groupName, qs]) => (
        <div key={groupName} className="space-y-4">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="w-1 h-5 rounded-full bg-ds-info" />
            <h2 className="font-sans text-[15px] font-semibold text-ds-text-primary">{groupName}</h2>
          </div>
          <ul className="space-y-0">
            {qs.map((q, questionIndex) => {
              const { score, comment } = state[q.id] ?? { score: q.score, comment: q.comment };
              return (
                <li key={q.id} className="mb-4 last:mb-0">
                  <div className="bg-white border border-ds-border rounded-ds-panel overflow-hidden">
                    <div className="px-5 pt-5 pb-4 border-b border-ds-border">
                      <div className="flex items-start gap-2.5">
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-ds-info-subtle border border-ds-info-border text-[10px] font-semibold text-ds-info flex-shrink-0 mt-0.5">
                          {questionIndex + 1}
                        </span>
                        <p className="text-[14px] font-medium text-ds-text-primary leading-relaxed">{q.question_text}</p>
                      </div>
                    </div>
                    <div className="px-5 py-4 grid grid-cols-[240px_1fr] gap-4">
                      <div className="flex flex-col gap-2">
                        <p className="text-[10px] font-semibold uppercase tracking-[.07em] text-ds-text-secondary">Rating</p>
                        {!allowEdit ? (
                          <p className="text-[13px] text-ds-text-secondary">
                            {score != null && scale.find((s) => s.value === score)
                              ? `${score} – ${scale.find((s) => s.value === score)!.label}`
                              : "—"}
                          </p>
                        ) : (
                          <div className="flex flex-col gap-1.5">
                            {scale.map((opt) => (
                              <button
                                key={opt.value}
                                type="button"
                                onClick={() => update(q.id, opt.value, comment)}
                                className={cn(
                                  "flex items-center gap-2.5 px-3 py-2 rounded-[8px] border-[1.5px] text-[12px] font-semibold text-left transition-all",
                                  score === opt.value
                                    ? "bg-ds-info-subtle border-ds-info text-ds-info"
                                    : "bg-white border-ds-border text-ds-text-secondary hover:border-[#3d5a78]/40"
                                )}
                              >
                                <span
                                  className={cn(
                                    "w-4 h-4 rounded-full border-2 flex-shrink-0 transition-all",
                                    score === opt.value ? "border-ds-info bg-ds-info" : "border-ds-border"
                                  )}
                                />
                                {opt.value} – {opt.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col gap-2">
                        <p className="text-[10px] font-semibold uppercase tracking-[.07em] text-ds-text-secondary">
                          Comment <span className="font-normal normal-case">(optional)</span>
                        </p>
                        {!allowEdit ? (
                          <p className="text-[13px] text-ds-text-secondary">{comment || "—"}</p>
                        ) : (
                          <textarea
                            value={comment}
                            onChange={(e) => update(q.id, score, e.target.value)}
                            placeholder="Add context or an example to support your rating..."
                            rows={4}
                            className="w-full border-[1.5px] border-ds-border rounded-[8px] p-3 text-[13px] text-ds-text-primary resize-none outline-none placeholder:text-ds-text-secondary transition-colors focus:border-ds-info focus:ring-2 focus:ring-[#3d5a78]/10"
                          />
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {allowEdit && (
        <div className="sticky bottom-0 left-0 right-0 z-10 bg-white border-t border-ds-border shadow-[0_-4px_16px_rgba(13,13,13,0.06)] flex items-center justify-between px-6 py-3.5">
          <span className="text-[11px] text-ds-text-secondary">
            {answeredCount} of {totalCount} questions answered
          </span>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={saveDraft}
              disabled={saving}
              className="px-5 py-2 rounded-[8px] border-[1.5px] border-ds-border bg-white text-[12px] font-semibold text-ds-text-secondary hover:border-ds-text-primary transition-all disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Draft"}
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!isComplete || saving}
              className="flex items-center gap-2 px-5 py-2 rounded-[8px] bg-ds-info text-white font-sans text-[12px] font-semibold hover:bg-ds-info transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="w-3.5 h-3.5" />
              {saving ? "Submitting..." : "Submit Assessment"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
