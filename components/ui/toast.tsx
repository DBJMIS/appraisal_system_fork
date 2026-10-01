"use client";

import * as React from "react";
import { cn } from "@/utils/cn";

export type ToastTone = "success" | "error";

export interface ToastMessage {
  tone: ToastTone;
  title: string;
  description?: string;
}

const TONE: Record<ToastTone, { border: string; icon: string; role: "status" | "alert" }> = {
  success: { border: "border-ds-success-border", icon: "bg-ds-success-subtle text-ds-success", role: "status" },
  error: { border: "border-ds-error-border", icon: "bg-ds-error-subtle text-ds-error", role: "alert" },
};

/**
 * Small notification pinned below the top navigation on the right. `duration` (ms) dismisses it
 * automatically; omit it to keep the toast until the user closes it.
 */
export function Toast({
  message,
  onDismiss,
  duration,
}: {
  message: ToastMessage | null;
  onDismiss: () => void;
  duration?: number | null;
}) {
  const dismissRef = React.useRef(onDismiss);
  dismissRef.current = onDismiss;

  React.useEffect(() => {
    if (!message || !duration) return;
    const timer = setTimeout(() => dismissRef.current(), duration);
    return () => clearTimeout(timer);
  }, [message, duration]);

  if (!message) return null;
  const tone = TONE[message.tone];
  return (
    <div
      data-toast={message.tone}
      role={tone.role}
      aria-live={message.tone === "error" ? "assertive" : "polite"}
      className={cn(
        "fixed right-4 top-[68px] z-[60] flex w-[min(360px,calc(100vw-2rem))] items-start gap-2.5 rounded-[8px] border bg-white px-3 py-2.5 shadow-ds-popover",
        tone.border
      )}
    >
      <span aria-hidden className={cn("mt-px flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full", tone.icon)}>
        {message.tone === "success" ? (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <line x1="12" y1="7" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p data-toast-title className="text-[13px] font-semibold leading-5 text-ds-text-primary">
          {message.title}
        </p>
        {message.description && (
          <p data-toast-description className="mt-0.5 whitespace-pre-line break-words text-[12px] leading-[18px] text-ds-text-secondary">
            {message.description}
          </p>
        )}
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={onDismiss}
        className="-mr-1 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-[6px] text-ds-text-muted transition-colors hover:bg-ds-surface hover:text-ds-text-primary"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
