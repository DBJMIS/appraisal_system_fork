"use client";

import { useEffect, useState } from "react";
import { formatScore, formatScoreChange, type ScoreComparison, type StoredScore } from "@/lib/score-comparison";
import { formatCheckInDate } from "@/lib/midyear-config";

/** One stored MIDYEAR revision as returned by the score-snapshots route. */
export interface MidyearRevisionEntry {
  revision: number;
  total: number;
  grade: string | null;
  gradeLabel: string | null;
  recordedAt: string;
  supersededAt: string | null;
}

type ScorePanelData = ScoreComparison & { midyearRevision?: number | null; midyearRevisions?: MidyearRevisionEntry[] };

const TAG_CLASS =
  "text-[10px] font-semibold uppercase tracking-[.07em] px-2 py-0.5 rounded-full border border-ds-border text-ds-text-secondary bg-white";

function ScoreCell({
  label,
  score,
  kind,
  official,
  revision,
}: {
  label: string;
  score: StoredScore;
  kind: "midyear" | "final";
  official?: boolean;
  revision?: number | null;
}) {
  return (
    <div className="px-5 py-4" data-score-cell={kind}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-ds-text-secondary">{label}</span>
        {official && (
          <span data-score-official className={TAG_CLASS}>
            Official result
          </span>
        )}
        {revision != null && revision > 1 && (
          <span data-score-revision className={TAG_CLASS}>
            Revision {revision}
          </span>
        )}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span data-score-value={kind} className="text-[24px] font-semibold leading-none tabular-nums text-ds-text-primary">
          {formatScore(score.total)}
        </span>
        {score.grade && (
          <span data-score-grade={kind} className="text-[13px] text-ds-text-secondary">
            {score.grade}
            {score.gradeLabel ? ` · ${score.gradeLabel}` : ""}
          </span>
        )}
      </div>
    </div>
  );
}

/** Stored MIDYEAR / FINAL scores side by side. Nothing is recalculated or combined. */
export function ScoreSnapshotsView({
  comparison,
  midyearRevision = null,
  midyearRevisions = [],
}: {
  comparison: ScoreComparison;
  midyearRevision?: number | null;
  midyearRevisions?: MidyearRevisionEntry[];
}) {
  const { midyear, final, change } = comparison;
  const earlier = midyearRevisions.filter((r) => r.supersededAt != null);
  if (!midyear && !final && earlier.length === 0) return null;
  return (
    <section data-score-snapshots aria-label="Mid-Year and Final scores" className="rounded-ds-panel border border-ds-border bg-ds-background mb-4">
      <div className="grid grid-cols-1 divide-y divide-ds-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {midyear && <ScoreCell label="Mid-Year Score" score={midyear} kind="midyear" revision={midyearRevision} />}
        {!midyear && earlier.length > 0 && (
          <div className="px-5 py-4" data-score-cell="midyear-revising">
            <span className="text-xs font-medium text-ds-text-secondary">Mid-Year Score</span>
            <p className="mt-1 text-[13px] font-semibold text-ds-text-primary">Revision in progress</p>
            <p className="mt-0.5 text-[11px] text-ds-text-secondary">A new score is recorded when the revised review is completed.</p>
          </div>
        )}
        {final && <ScoreCell label="Final Score" score={final} kind="final" official />}
        {change !== null && (
          <div className="px-5 py-4" data-score-cell="change">
            <span className="text-xs font-medium text-ds-text-secondary">Change from Mid-Year</span>
            <div className="mt-1">
              <span data-score-change className="text-[24px] font-semibold leading-none tabular-nums text-ds-text-primary">
                {formatScoreChange(change)}
              </span>
            </div>
          </div>
        )}
      </div>
      {earlier.length > 0 && (
        <div data-score-revision-history className="border-t border-ds-border px-5 py-3">
          <p className="m-0 text-[11px] font-semibold text-ds-text-secondary">Earlier Mid-Year scores (superseded, kept for history)</p>
          <ul className="m-0 mt-1 list-none space-y-0.5 p-0">
            {earlier.map((r) => (
              <li key={r.revision} data-score-revision-entry={r.revision} className="text-[12px] text-ds-text-secondary">
                Revision {r.revision}: <span className="tabular-nums text-ds-text-primary">{formatScore(r.total)}</span>
                {r.grade ? ` · ${r.grade}${r.gradeLabel ? ` · ${r.gradeLabel}` : ""}` : ""}
                {formatCheckInDate(r.recordedAt) ? ` · recorded ${formatCheckInDate(r.recordedAt)}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p data-score-note className="m-0 border-t border-ds-border px-5 py-2 text-[11px] text-ds-text-secondary">
        {final
          ? "The Final Score is the official appraisal result. The Mid-Year Score is a checkpoint and is not averaged into it."
          : "The Mid-Year Score is a checkpoint. The official result is the Final Score recorded at sign-off."}
      </p>
    </section>
  );
}

export function ScoreSnapshotsPanel({ appraisalId, refreshKey }: { appraisalId: string; refreshKey?: number }) {
  const [data, setData] = useState<ScorePanelData | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/appraisals/${appraisalId}/score-snapshots`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (!cancelled) setData(json && ("midyear" in json || "final" in json) ? (json as ScorePanelData) : null);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [appraisalId, refreshKey]);

  return data ? (
    <ScoreSnapshotsView comparison={data} midyearRevision={data.midyearRevision ?? null} midyearRevisions={data.midyearRevisions ?? []} />
  ) : null;
}
