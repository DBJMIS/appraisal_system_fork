"use client";

const AlertIcon = () => (
  <svg style={{ width: 16, height: 16, flexShrink: 0 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

interface SubmitForApprovalActionProps {
  /** `canSubmit` from the completion endpoint (null while loading). */
  canSubmit: boolean | null;
  /** `blockers` from the completion endpoint, shown verbatim. */
  blockers: string[];
  submitting: boolean;
  onSubmit: () => void;
}

export function SubmitForApprovalAction({ canSubmit, blockers, submitting, onSubmit }: SubmitForApprovalActionProps) {
  const showBlockers = canSubmit === false && blockers.length > 0;
  const enabled = !submitting && canSubmit === true;

  return (
    <div className="mb-4 flex flex-wrap items-start justify-end gap-3" data-submit-for-approval>
      {showBlockers && (
        <div
          id="submit-for-approval-blockers"
          role="status"
          className="flex max-w-[560px] items-start gap-2.5 rounded-ds-panel border border-ds-warning-border bg-ds-warning-subtle px-3 py-2 text-ds-warning"
        >
          <span className="mt-px"><AlertIcon /></span>
          <div>
            <div className="text-xs font-semibold leading-[1.4]">
              Appraisal incomplete — resolve the following to submit for approval
            </div>
            <ul className="m-0 mt-0.5 list-none p-0 text-xs leading-[1.45]">
              {blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting || !canSubmit}
        aria-describedby={showBlockers ? "submit-for-approval-blockers" : undefined}
        className={`inline-flex h-9 shrink-0 items-center rounded-ds-button border px-4 text-[13px] font-medium transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus focus-visible:ring-offset-2 ${
          enabled
            ? "cursor-pointer border-ds-accent bg-ds-accent text-ds-on-primary hover:border-ds-accent-hover hover:bg-ds-accent-hover"
            : "cursor-not-allowed border-ds-border bg-ds-surface text-ds-text-secondary"
        }`}
      >
        {submitting ? "Submitting…" : "Submit for Approval"}
      </button>
    </div>
  );
}
