"use client";

import { useCallback } from "react";

const PaperclipIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
);

const EyeIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export interface EvidenceBadgeProps {
  workplanItemId: string;
  appraisalId: string;
  evidenceCount: number;
  role: "EMPLOYEE" | "MANAGER" | "HR";
  onManage: () => void;
}

export function EvidenceBadge({
  workplanItemId,
  appraisalId,
  evidenceCount,
  role,
  onManage,
}: EvidenceBadgeProps) {
  const openFileDirect = useCallback(async () => {
    const res = await fetch(
      `/api/appraisals/${appraisalId}/workplan/${workplanItemId}/evidence`
    );
    const data = await res.json();
    if (!res.ok || !Array.isArray(data?.evidence)) return;
    const first = data.evidence.find(
      (e: { evidence_type: string; signed_url?: string }) =>
        e.evidence_type === "FILE" && e.signed_url
    );
    if (first?.signed_url) window.open(first.signed_url, "_blank");
  }, [appraisalId, workplanItemId]);

  const isEmployee = role === "EMPLOYEE";

  if (isEmployee) {
    if (evidenceCount === 0) {
      return (
        <button
          type="button"
          onClick={onManage}
          className="inline-flex items-center gap-1.5 rounded-[6px] border border-ds-border bg-ds-surface px-2.5 py-1 text-[10px] font-semibold text-ds-text-secondary transition-colors hover:border-ds-accent hover:bg-ds-surface hover:text-ds-accent"
        >
          <PaperclipIcon />
          Attach
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={onManage}
        className="inline-flex items-center gap-1.5 rounded-[6px] border border-ds-border-strong bg-ds-surface px-2.5 py-1 text-[10px] font-semibold text-ds-accent transition-colors hover:bg-ds-success-subtle"
      >
        <PaperclipIcon />
        {evidenceCount === 1 ? "1 file" : `${evidenceCount} files`}
      </button>
    );
  }

  if (evidenceCount === 0) {
    return (
      <span className="text-[10px] italic text-ds-text-secondary">None</span>
    );
  }

  if (evidenceCount === 1) {
    return (
      <button
        type="button"
        onClick={openFileDirect}
        className="inline-flex items-center gap-1.5 rounded-[6px] border border-ds-border-strong bg-ds-surface px-2.5 py-1 text-[10px] font-semibold text-ds-accent transition-colors hover:bg-ds-success-subtle"
        title="View evidence"
      >
        <EyeIcon />
        View
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onManage}
      className="inline-flex items-center gap-1.5 rounded-[6px] border border-ds-border-strong bg-ds-surface px-2.5 py-1 text-[10px] font-semibold text-ds-accent transition-colors hover:bg-ds-success-subtle"
    >
      <EyeIcon />
      {evidenceCount} files
    </button>
  );
}
