"use client";

import { useEffect, useState } from "react";
import { statusToneClasses } from "@/lib/appraisal-status-display";
import {
  isMidyearScored,
  MIDYEAR_REVIEW_UPDATED_EVENT,
  MIDYEAR_SUB_STATUS,
  midyearSubStatusState,
  type FormalReviewLike,
  type MidyearReviewUpdatedDetail,
} from "@/lib/midyear-display";
import { formatScore } from "@/lib/score-comparison";

interface MidyearSubStatusProps {
  appraisalId: string;
  scoringEnabled: boolean;
  initialReview: FormalReviewLike | null;
}

/** Compact Mid-Year milestone shown under the In progress stage. */
export function MidyearSubStatus({ appraisalId, scoringEnabled, initialReview }: MidyearSubStatusProps) {
  const [review, setReview] = useState<FormalReviewLike | null>(initialReview);
  const [score, setScore] = useState<number | null>(null);

  useEffect(() => {
    const onUpdate = (e: Event) => {
      const detail = (e as CustomEvent<MidyearReviewUpdatedDetail>).detail;
      if (detail?.appraisalId === appraisalId) setReview(detail.review);
    };
    window.addEventListener(MIDYEAR_REVIEW_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(MIDYEAR_REVIEW_UPDATED_EVENT, onUpdate);
  }, [appraisalId]);

  const state = midyearSubStatusState(review);
  const scored = isMidyearScored(review, { scoringEnabled });
  const showScore = state === "COMPLETE" && review?.review_mode === "FORMAL_SCORED";

  useEffect(() => {
    if (!showScore) {
      setScore(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/appraisals/${appraisalId}/score-snapshots`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { midyear?: { total?: number | null } | null } | null) => {
        const total = data?.midyear?.total;
        if (!cancelled) setScore(typeof total === "number" && Number.isFinite(total) ? total : null);
      })
      .catch(() => {
        if (!cancelled) setScore(null);
      });
    return () => {
      cancelled = true;
    };
  }, [appraisalId, showScore]);

  const { label, tone } = MIDYEAR_SUB_STATUS[state];
  const parts = ["Mid-Year", ...(scored ? ["Scored"] : []), label, ...(showScore && score != null ? [formatScore(score)] : [])];

  return (
    <span
      data-midyear-substatus
      data-midyear-substatus-state={state}
      className="inline-flex items-center gap-1.5 text-[11px] leading-4 text-ds-text-muted"
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusToneClasses[tone].dot}`} aria-hidden="true" />
      <span>
        <span className="sr-only">In progress milestone, formal review: </span>
        {parts.join(" · ")}
      </span>
    </span>
  );
}
