"use client";

import { useEffect, useRef, useState } from "react";
import { RATING_LABELS } from "./RatingButtons";
import { VarianceChip, isGrade } from "./RatingPillGroup";
import { competencyCommentDisplay } from "@/lib/competency-comment-display";
import { MIDYEAR_BUTTON, MidyearLastSaved } from "@/components/appraisal/checkins/MidyearReviewWorkspace";
import { DRAFT_SAVED_MS } from "@/hooks/useDraftSaveFeedback";

export type CompetencyGridField = "self_rating_code" | "manager_rating_code" | "self_comments" | "manager_comments" | "weight";

export interface CompetencyGridRow {
  id: string;
  name: string;
  description: string | null;
  weight: number;
  selfRating: string | null;
  managerRating: string | null;
  selfComments: string | null;
  managerComments: string | null;
  /** Pre-formatted row score from the section's own calculation; null renders "—". */
  score: string | null;
  /** Replaces the default name/description cell content (e.g. an editable name). */
  nameCell?: React.ReactNode;
  /** Content of the "Required" column; only rendered when `showRequiredLevel` is set. */
  requiredLevelCell?: React.ReactNode;
  /** Content of the trailing actions column; only rendered when `showRowActions` is set. */
  actionsCell?: React.ReactNode;
}

interface CompetencyAssessmentGridProps {
  title: string;
  subtitle: React.ReactNode;
  factorLabel: string;
  selfCommentLabel?: string;
  selfCommentPlaceholder?: string;
  emptyMessage: string;
  rows: CompetencyGridRow[];
  canEdit: boolean;
  canEditSelfRatings: boolean;
  canEditManagerRatings: boolean;
  canEditWeights: boolean;
  onChange: (factorId: string, field: CompetencyGridField, value: string | number | null) => void;
  onSave: () => void;
  saveDisabled: boolean;
  /** True while the section's save request is in flight; drives the "Saving…" label. */
  saving?: boolean;
  error: string | null;
  saveSuccess: boolean;
  totalWeight: number;
  /** Pre-formatted total score; null renders "—". */
  totalScore: string | null;
  showRequiredLevel?: boolean;
  showRowActions?: boolean;
  /** Secondary actions rendered before Save Ratings. */
  headerActions?: React.ReactNode;
  /** Appraisal status; drives which comment fields are displayed (see competencyCommentDisplay). */
  workflowStatus?: string | null;
  /** Save button label in DRAFT, where only configuration is editable. */
  draftSaveLabel?: string;
}

const RATING_SCALE = [
  { range: "1–2", label: "Far below" },
  { range: "3–4", label: "Below" },
  { range: "5–6", label: "Meets" },
  { range: "7–8", label: "Exceeds" },
  { range: "9–10", label: "Highly exceeds" },
];

const RATING_CODES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

// Desktop: one compact table row per competency. Below md each row stacks into a two-column card.
const thClass =
  "border-b border-ds-border bg-ds-surface px-2.5 py-1.5 text-left align-bottom text-xs font-medium leading-tight text-ds-text-secondary";
const tdClass = "border-b border-ds-border px-2.5 py-2 align-top max-md:block max-md:border-0 max-md:p-0";
const wideCell = "max-md:col-span-2";
const controlFocus = "focus:border-ds-focus focus:outline-none focus:ring-1 focus:ring-ds-focus";
const selectClass = `block h-8 w-full min-w-0 cursor-pointer truncate rounded-[6px] border border-ds-border-control bg-ds-background px-2 text-[13px] transition-colors duration-100 hover:border-ds-text-secondary ${controlFocus}`;
const commentClass = `block w-full min-h-[32px] max-h-40 resize-none overflow-y-auto rounded-[6px] border border-ds-border-control bg-ds-background px-2 py-1.5 text-[13px] leading-[1.35] text-ds-text-primary placeholder:text-ds-text-muted transition-colors duration-100 hover:border-ds-text-secondary ${controlFocus}`;

function MobileLabel({ children }: { children: React.ReactNode }) {
  return (
    <span data-mobile-label className="mb-0.5 block text-[11px] font-medium text-ds-text-muted md:hidden">
      {children}
    </span>
  );
}

function RatingSelect({ value, onChange, label }: { value: string | null; onChange: (code: string) => void; label: string }) {
  const selected = isGrade(value) ? value : "";
  return (
    <select
      data-rating-select
      aria-label={label}
      value={selected}
      onChange={(e) => {
        if (e.target.value) onChange(e.target.value);
      }}
      className={`${selectClass} ${selected ? "text-ds-text-primary" : "text-ds-text-muted"}`}
    >
      <option value="" disabled>
        Select rating
      </option>
      {RATING_CODES.map((n) => (
        <option key={n} value={String(n)}>
          {n} – {RATING_LABELS[n]}
        </option>
      ))}
    </select>
  );
}

function RatingValue({ value }: { value: string | null }) {
  if (!isGrade(value)) {
    return <span data-not-rated className="text-[12px] text-ds-text-muted">Not rated</span>;
  }
  const n = parseInt(value, 10);
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1.5">
      <span className="text-[13px] font-semibold tabular-nums text-ds-text-primary">{value}</span>
      <span className="truncate text-xs text-ds-text-secondary">{RATING_LABELS[n]}</span>
    </span>
  );
}

/** One-line comment box that grows with its content instead of reserving a large empty block. */
function CommentInput({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  label: string;
  placeholder: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      aria-label={label}
      className={commentClass}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      placeholder={placeholder}
    />
  );
}

function CommentValue({ value }: { value: string | null }) {
  return <p className="m-0 whitespace-pre-wrap text-[12.5px] leading-[1.4] text-ds-text-primary">{value}</p>;
}

function RatingScaleHelper() {
  return (
    <p data-rating-scale className="m-0 mt-1 text-[11.5px] leading-4 text-ds-text-muted">
      {RATING_SCALE.map((b, i) => (
        <span key={b.range}>
          {i > 0 && " · "}
          <span className="tabular-nums text-ds-text-secondary">{b.range}</span> {b.label}
        </span>
      ))}
    </p>
  );
}

/** "Saving…" while in flight, "Saved ✓" briefly after success, then the idle label; plus the last-saved time. */
function useSaveFeedback(saveSuccess: boolean) {
  const [justSaved, setJustSaved] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  useEffect(() => {
    if (!saveSuccess) return;
    setLastSavedAt(Date.now());
    setJustSaved(true);
    const timer = setTimeout(() => setJustSaved(false), DRAFT_SAVED_MS);
    return () => {
      clearTimeout(timer);
      setJustSaved(false);
    };
  }, [saveSuccess]);
  return { justSaved, lastSavedAt };
}

export function CompetencyAssessmentGrid({
  title,
  subtitle,
  factorLabel,
  selfCommentLabel = "Comment",
  selfCommentPlaceholder = "Optional comment",
  emptyMessage,
  rows,
  canEdit,
  canEditSelfRatings,
  canEditManagerRatings,
  canEditWeights,
  onChange,
  onSave,
  saveDisabled,
  saving = false,
  error,
  saveSuccess,
  totalWeight,
  totalScore,
  showRequiredLevel = false,
  showRowActions = false,
  headerActions,
  workflowStatus,
  draftSaveLabel = "Save Weights",
}: CompetencyAssessmentGridProps) {
  // DRAFT configures weights only; assessment ratings belong to SELF_ASSESSMENT / MANAGER_REVIEW.
  const isDraft = (workflowStatus ?? "").toUpperCase() === "DRAFT";
  const selfRatingEditable = canEditSelfRatings && !isDraft;
  const managerRatingEditable = canEditManagerRatings && !isDraft;
  const showCommentColumn = !isDraft;
  const owner = selfRatingEditable ? "Your" : "Employee";
  const selfRatingHeader = `${owner} Rating`;
  const selfCommentHeader = `${owner} ${selfCommentLabel}`;
  const { justSaved, lastSavedAt } = useSaveFeedback(saveSuccess);
  const saveLabel = saving ? "Saving…" : justSaved ? "Saved ✓" : isDraft ? draftSaveLabel : "Save Ratings";

  return (
    <section data-competency-grid>
      {error && (
        <div role="alert" className="mb-3 rounded-ds-panel border border-ds-error-border bg-ds-error-subtle px-3 py-2 text-[13px] text-ds-error">
          <span className="font-semibold">Error</span> · {error}
        </div>
      )}

      <div data-competency-header className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h2 className="m-0 text-ds-section text-ds-text-primary">{title}</h2>
          <p className="m-0 mt-0.5 text-[12.5px] leading-[1.4] text-ds-text-secondary">{subtitle}</p>
          {rows.length > 0 && <RatingScaleHelper />}
        </div>
        {(headerActions || canEdit) && (
          <div className="flex shrink-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
            {canEdit && lastSavedAt != null && (
              <span role="status">
                <MidyearLastSaved at={lastSavedAt} />
              </span>
            )}
            {headerActions}
            {canEdit && (
              <button type="button" data-save-ratings onClick={onSave} disabled={saveDisabled} className={MIDYEAR_BUTTON.secondary}>
                {saveLabel}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-[8px] border border-ds-border bg-ds-background">
        {rows.length === 0 ? (
          <p className="m-0 px-4 py-6 text-center text-[13px] text-ds-text-secondary">{emptyMessage}</p>
        ) : (
          <table data-competency-table className="w-full border-collapse max-md:block md:table-fixed">
            <colgroup className="max-md:hidden">
              <col className={showCommentColumn ? "w-[26%]" : "w-[40%]"} />
              {showRequiredLevel && <col className="w-[8%]" />}
              <col className="w-[7%]" />
              <col className="w-[18%]" />
              {showCommentColumn && <col className="w-[20%]" />}
              <col className="w-[18%]" />
              <col className="w-[7%]" />
              {showRowActions && <col className="w-[7%]" />}
            </colgroup>
            <thead className="max-md:hidden">
              <tr>
                <th className={thClass}>{factorLabel}</th>
                {showRequiredLevel && <th className={thClass}>Required</th>}
                <th className={`${thClass} text-right`}>Weight</th>
                <th className={thClass}>{selfRatingHeader}</th>
                {showCommentColumn && <th className={thClass}>{selfCommentHeader}</th>}
                <th className={thClass}>Manager Rating</th>
                <th className={`${thClass} text-right`}>Score</th>
                {showRowActions && (
                  <th className={thClass}>
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="max-md:block">
              {rows.map((row) => {
                const selfCommentDisplay = competencyCommentDisplay(workflowStatus, selfRatingEditable, row.selfComments);
                const managerCommentDisplay = competencyCommentDisplay(workflowStatus, managerRatingEditable, row.managerComments);
                return (
                  <tr
                    key={row.id}
                    data-competency-row
                    className="max-md:grid max-md:grid-cols-2 max-md:gap-x-4 max-md:gap-y-2 max-md:border-b max-md:border-ds-border max-md:px-3 max-md:py-3"
                  >
                    <td className={`${tdClass} ${wideCell}`}>
                      {row.nameCell ?? (
                        <>
                          <div className="text-[13.5px] font-medium leading-[1.3] text-ds-text-primary">{row.name}</div>
                          {row.description && (
                            <div data-competency-description title={row.description} className="mt-0.5 line-clamp-2 text-xs leading-[1.35] text-ds-text-secondary">
                              {row.description}
                            </div>
                          )}
                        </>
                      )}
                    </td>
                    {showRequiredLevel && (
                      <td className={tdClass} data-required-cell>
                        <MobileLabel>Required</MobileLabel>
                        {row.requiredLevelCell}
                      </td>
                    )}
                    <td className={`${tdClass} text-right max-md:text-left`}>
                      <MobileLabel>Weight</MobileLabel>
                      {canEditWeights ? (
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          aria-label={`${row.name} weight`}
                          className={`h-8 w-full max-w-[72px] rounded-[6px] border border-ds-border-control bg-ds-background px-2 text-right text-[13px] tabular-nums text-ds-text-primary transition-colors duration-100 hover:border-ds-text-muted ${controlFocus}`}
                          value={row.weight}
                          onChange={(e) => {
                            const v = e.target.value === "" ? 0 : parseFloat(e.target.value);
                            onChange(row.id, "weight", Number.isNaN(v) ? 0 : v);
                          }}
                        />
                      ) : (
                        <span data-weight className="text-[12.5px] tabular-nums text-ds-text-secondary">{row.weight}%</span>
                      )}
                    </td>
                    <td className={`${tdClass} ${wideCell}`} data-self-rating>
                      <MobileLabel>{selfRatingHeader}</MobileLabel>
                      {selfRatingEditable ? (
                        <RatingSelect
                          label={`${row.name} employee rating`}
                          value={row.selfRating}
                          onChange={(code) => onChange(row.id, "self_rating_code", code)}
                        />
                      ) : (
                        <RatingValue value={row.selfRating} />
                      )}
                    </td>
                    {showCommentColumn && (
                      <td className={`${tdClass} ${wideCell} ${selfCommentDisplay === "hidden" ? "max-md:hidden" : ""}`}>
                        {selfCommentDisplay !== "hidden" && (
                          <div data-comment="self">
                            <MobileLabel>{selfCommentHeader}</MobileLabel>
                            {selfCommentDisplay === "edit" ? (
                              <CommentInput
                                label={`${row.name} employee ${selfCommentLabel.toLowerCase()}`}
                                value={row.selfComments}
                                onChange={(v) => onChange(row.id, "self_comments", v)}
                                placeholder={selfCommentPlaceholder}
                              />
                            ) : (
                              <CommentValue value={row.selfComments} />
                            )}
                          </div>
                        )}
                      </td>
                    )}
                    <td className={`${tdClass} ${wideCell}`} data-manager-rating>
                      <MobileLabel>Manager Rating</MobileLabel>
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="min-w-0 flex-1">
                          {managerRatingEditable ? (
                            <RatingSelect
                              label={`${row.name} manager rating`}
                              value={row.managerRating}
                              onChange={(code) => onChange(row.id, "manager_rating_code", code)}
                            />
                          ) : (
                            <RatingValue value={row.managerRating} />
                          )}
                        </div>
                        {row.managerRating != null && (
                          <span className="shrink-0" title="Difference from employee self-rating">
                            <VarianceChip selfRating={row.selfRating} managerRating={row.managerRating} />
                          </span>
                        )}
                      </div>
                      {managerCommentDisplay !== "hidden" && (
                        <div className="mt-1.5" data-comment="manager">
                          {managerCommentDisplay === "edit" ? (
                            <CommentInput
                              label={`${row.name} manager comment`}
                              value={row.managerComments}
                              onChange={(v) => onChange(row.id, "manager_comments", v)}
                              placeholder="Optional comment"
                            />
                          ) : (
                            <CommentValue value={row.managerComments} />
                          )}
                        </div>
                      )}
                    </td>
                    <td className={`${tdClass} text-right max-md:text-left`} data-score>
                      <MobileLabel>Score</MobileLabel>
                      <span className={`text-[13px] font-medium tabular-nums ${row.score != null ? "text-ds-text-primary" : "text-ds-text-secondary"}`}>
                        {row.score ?? "—"}
                      </span>
                    </td>
                    {showRowActions && <td className={`${tdClass} text-right max-md:text-left`}>{row.actionsCell}</td>}
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="max-md:block">
              <tr className="bg-ds-surface max-md:flex max-md:items-center max-md:gap-4 max-md:px-3 max-md:py-2">
                <td className="px-2.5 py-1.5 text-[13px] font-semibold text-ds-text-primary max-md:flex-1 max-md:p-0">Total</td>
                {showRequiredLevel && <td className="px-2.5 py-1.5 max-md:hidden" />}
                <td className="px-2.5 py-1.5 text-right text-[13px] font-semibold tabular-nums text-ds-text-primary max-md:p-0">
                  <MobileLabel>Weight</MobileLabel>
                  {totalWeight}%
                </td>
                <td className="px-2.5 py-1.5 max-md:hidden" />
                {showCommentColumn && <td className="px-2.5 py-1.5 max-md:hidden" />}
                <td className="px-2.5 py-1.5 max-md:hidden" />
                <td className="px-2.5 py-1.5 text-right max-md:p-0" data-total-score>
                  <MobileLabel>Score</MobileLabel>
                  <span className={`text-[13px] font-semibold tabular-nums ${totalScore != null ? "text-ds-text-primary" : "text-ds-text-secondary"}`}>
                    {totalScore ?? "—"}
                  </span>
                </td>
                {showRowActions && <td className="px-2.5 py-1.5 max-md:hidden" />}
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </section>
  );
}
