"use client";

import React, { useState } from "react";
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

interface CancelCheckInDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Runs the cancellation; resolves true when it succeeded. */
  onConfirm: () => Promise<boolean>;
}

export function CancelCheckInDialog({ open, onOpenChange, onConfirm }: CancelCheckInDialogProps) {
  const [submitting, setSubmitting] = useState(false);

  const handleConfirm = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const ok = await onConfirm();
      if (ok) onOpenChange(false);
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
        data-cancel-checkin-dialog
        className="max-w-[400px] gap-0 rounded-ds-modal border-ds-border bg-white p-6 shadow-ds-popover"
        onEscapeKeyDown={(e) => {
          if (submitting) e.preventDefault();
        }}
      >
        <AlertDialogHeader className="space-y-2 text-left">
          <AlertDialogTitle className="text-[15px] font-semibold text-ds-accent">Cancel check-in?</AlertDialogTitle>
          <AlertDialogDescription className="text-[13px] leading-relaxed text-ds-text-secondary">
            This check-in will be cancelled and can no longer be completed. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="mt-6 gap-2 sm:space-x-0">
          <AlertDialogCancel
            disabled={submitting}
            className="mt-0 h-auto rounded-[8px] border-ds-border bg-white px-4 py-2 text-[12px] font-semibold text-ds-text-secondary hover:border-ds-text-primary hover:bg-white hover:text-ds-text-primary"
          >
            Keep check-in
          </AlertDialogCancel>
          <AlertDialogAction
            data-cancel-checkin-confirm
            disabled={submitting}
            onClick={handleConfirm}
            className="h-auto rounded-[8px] bg-ds-error px-4 py-2 text-[12px] font-semibold text-white hover:bg-ds-error hover:opacity-90"
          >
            {submitting ? "Cancelling…" : "Cancel check-in"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
