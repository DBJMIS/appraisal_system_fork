"use client";

import React, { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { REOPEN_REASON_MAX } from "@/lib/midyear-revisions";

interface ReopenMidyearDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Reopens the review; resolves null on success, else the error to show. */
  onConfirm: (reason: string) => Promise<string | null>;
}

export function ReopenMidyearDialog({ open, onOpenChange, onConfirm }: ReopenMidyearDialogProps) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setReason("");
      setError(null);
    }
  }, [open]);

  const trimmed = reason.trim();

  const handleConfirm = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!trimmed) {
      setError("Enter a reason for revision.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const failure = await onConfirm(trimmed);
      if (failure) setError(failure);
      else onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!submitting) onOpenChange(next);
      }}
    >
      <AlertDialogContent
        data-reopen-midyear-dialog
        className="max-w-[440px] gap-0 rounded-ds-modal border-ds-border bg-white p-6 shadow-ds-popover"
        onEscapeKeyDown={(e) => {
          if (submitting) e.preventDefault();
        }}
      >
        <AlertDialogHeader className="space-y-2 text-left">
          <AlertDialogTitle className="text-[15px] font-semibold text-ds-accent">Reopen Mid-Year Review?</AlertDialogTitle>
          <AlertDialogDescription className="text-[13px] leading-relaxed text-ds-text-secondary">
            This will reopen the completed Mid-Year Review for revision. The existing Mid-Year score will no longer be
            treated as current until the review is completed again.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="mt-4 space-y-1.5">
          <label htmlFor="midyear-reopen-reason" className="block text-[12px] font-semibold text-ds-text-primary">
            Reason for revision <span className="text-ds-error">*</span>
          </label>
          <textarea
            id="midyear-reopen-reason"
            data-reopen-midyear-reason
            required
            aria-required="true"
            maxLength={REOPEN_REASON_MAX}
            rows={3}
            value={reason}
            disabled={submitting}
            onChange={(e) => {
              setReason(e.target.value);
              if (error) setError(null);
            }}
            className="w-full rounded-[8px] border border-ds-border px-3 py-2 text-[13px] text-ds-text-primary focus:outline-none focus:ring-2 focus:ring-ds-accent/30"
          />
          {error && (
            <p data-reopen-midyear-error role="alert" className="text-[12px] text-ds-error">
              {error}
            </p>
          )}
        </div>
        <AlertDialogFooter className="mt-6 gap-2 sm:space-x-0">
          <AlertDialogCancel
            disabled={submitting}
            className="mt-0 h-auto rounded-[8px] border-ds-border bg-white px-4 py-2 text-[12px] font-semibold text-ds-text-secondary hover:border-ds-text-primary hover:bg-white hover:text-ds-text-primary"
          >
            Keep completed
          </AlertDialogCancel>
          <AlertDialogAction
            data-reopen-midyear-confirm
            disabled={submitting || !trimmed}
            onClick={handleConfirm}
            className="h-auto rounded-[8px] bg-ds-accent px-4 py-2 text-[12px] font-semibold text-white hover:bg-ds-accent-hover disabled:opacity-50"
          >
            {submitting ? "Reopening…" : "Reopen review"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
