"use client";

import { useEffect, useState } from "react";
import { formatScore } from "@/lib/score-comparison";
import type { MidyearFinalReviewContext, MidyearFinalReviewScore } from "@/lib/midyear-final-review-context";

/** Stored Mid-Year context for the Final Review, or null while loading, when off, or on any failure. */
export function useMidyearFinalReviewContext(appraisalId: string, enabled: boolean): MidyearFinalReviewContext | null {
  const [context, setContext] = useState<MidyearFinalReviewContext | null>(null);
  useEffect(() => {
    if (!enabled) {
      setContext(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/appraisals/${appraisalId}/midyear-context`)
      .then(async (res) => (res.ok ? ((await res.json()) as MidyearFinalReviewContext) : null))
      .then((data) => {
        if (!cancelled) setContext(data?.available ? data : null);
      })
      .catch(() => {
        if (!cancelled) setContext(null);
      });
    return () => {
      cancelled = true;
    };
  }, [appraisalId, enabled]);
  return context;
}

/** 60 → "60%", 72.5 → "72.5%", missing → "—". */
export function formatMidyearResult(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Math.round(value * 10) / 10}%`;
}

export function MidyearResultValue({ value }: { value: number | null | undefined }) {
  const text = formatMidyearResult(value);
  return (
    <span
      data-midyear-result
      aria-label={`Mid-Year result: ${text === "—" ? "not available" : text}`}
      className="text-[12px] font-normal tabular-nums text-ds-text-secondary"
    >
      {text}
    </span>
  );
}

export function MidyearScoreLine({ score }: { score: MidyearFinalReviewScore }) {
  return (
    <div data-midyear-score className="mt-1 text-[11px] text-ds-text-muted">
      Mid-Year score: <span className="font-normal tabular-nums text-ds-text-secondary">{formatScore(score.total)}</span>
      {score.grade && <> · Grade {score.grade}</>}
    </div>
  );
}
