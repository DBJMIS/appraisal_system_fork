/**
 * Read-only presentation of the stored MIDYEAR and FINAL score snapshots. FINAL is the official
 * appraisal result; MIDYEAR is a checkpoint. The two are compared, never combined or averaged.
 */

export interface StoredScore {
  total: number;
  grade: string | null;
  gradeLabel: string | null;
}

export interface ScoreComparison {
  midyear: StoredScore | null;
  final: StoredScore | null;
  /** Final − Mid-Year using the one-decimal values shown; null unless both exist. */
  change: number | null;
  /** The score type that is the official appraisal result, if it has been recorded. */
  official: "FINAL" | null;
}

export const roundScore = (n: number): number => Math.round(n * 10) / 10;

export function compareScores(midyear: StoredScore | null, final: StoredScore | null): ScoreComparison {
  return {
    midyear,
    final,
    change: midyear && final ? roundScore(roundScore(final.total) - roundScore(midyear.total)) : null,
    official: final ? "FINAL" : null,
  };
}

export const formatScore = (n: number): string => roundScore(n).toFixed(1);

/** "+9.2", "-3.0", "0.0". */
export function formatScoreChange(change: number): string {
  const value = roundScore(change);
  if (value === 0) return "0.0";
  return `${value > 0 ? "+" : "-"}${Math.abs(value).toFixed(1)}`;
}
