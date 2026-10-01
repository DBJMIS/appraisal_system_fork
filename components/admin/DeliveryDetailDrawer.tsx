"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { APP_HEADER_OFFSET, formatSyncTime } from "./SyncDetailDrawer";
import { DeliveryStatusBadge } from "./DeliveryStatusBadge";
import { formatMidyearDate } from "@/lib/midyear-config";

export type DeliveryDetailResponse = {
  id: string;
  appraisal: { id: string; employeeName: string; cycleName: string | null; statusLabel: string | null };
  kind: string;
  kindLabel: string;
  recipientRole: string;
  recipientName: string;
  recipientEmail: string | null;
  recipientEmailSource: "recorded" | "current" | null;
  scheduledFor: string | null;
  dueDate: string | null;
  timing: string;
  status: string;
  statusLabel: string;
  statusTone: string;
  attemptCount: number;
  maxAttempts: number;
  firstAttemptAt: string | null;
  firstAttemptRecorded: boolean;
  lastAttemptAt: string | null;
  sentAt: string | null;
  nextRetryAt: string | null;
  errorCode: string | null;
  reason: string | null;
  createdAt: string;
  stillRequired: boolean;
  currentStateReason: string | null;
  retry: { allowed: boolean; blockCode: string | null; message: string | null };
};

type PreviewResponse = {
  subject: string;
  html: string;
  notice: string;
  stateChanged: boolean;
  stateChangeReason: string | null;
};

type RetryResponse = { status: string; statusLabel: string; reason: string | null };

type LoadState = { status: "loading" } | { status: "error" } | { status: "ready"; data: DeliveryDetailResponse };

const roleLabel = (role: string) => (role === "manager" ? "Manager" : "Employee");
const dateLabel = (iso: string | null) => (iso ? formatMidyearDate(iso) ?? iso : "—");

const errorMessage = async (res: Response, fallback: string) => {
  const data = await res.json().catch(() => ({}));
  return typeof data.error === "string" && data.error ? data.error : fallback;
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-ds-text-secondary">{label}</dt>
      <dd className="mt-0.5 break-words text-[13px] text-ds-text-primary">{children}</dd>
    </div>
  );
}

export function DeliveryDetailDrawer({
  deliveryId,
  onClose,
  onChanged,
}: {
  deliveryId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "retry" | null>(null);
  const [confirmingRetry, setConfirmingRetry] = useState(false);
  const [retryMessage, setRetryMessage] = useState<{ tone: "success" | "error" | "muted"; text: string } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/reminder-deliveries/${encodeURIComponent(deliveryId)}`, { cache: "no-store" }).catch(() => null);
    const data = res?.ok ? ((await res.json().catch(() => null)) as DeliveryDetailResponse | null) : null;
    setState(data && typeof data === "object" ? { status: "ready", data } : { status: "error" });
  }, [deliveryId]);

  useEffect(() => {
    setState({ status: "loading" });
    setPreview(null);
    setPreviewError(null);
    setRetryMessage(null);
    setConfirmingRetry(false);
    void load();
  }, [load]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const runPreview = async () => {
    setBusy("preview");
    setPreviewError(null);
    try {
      const res = await fetch(`/api/admin/reminder-deliveries/${encodeURIComponent(deliveryId)}/preview`, { cache: "no-store" });
      if (!res.ok) throw new Error(await errorMessage(res, "Could not generate the preview."));
      setPreview((await res.json()) as PreviewResponse);
    } catch (e) {
      setPreview(null);
      setPreviewError(e instanceof Error ? e.message : "Could not generate the preview.");
    } finally {
      setBusy(null);
    }
  };

  const runRetry = async () => {
    setConfirmingRetry(false);
    setBusy("retry");
    setRetryMessage(null);
    try {
      const res = await fetch(`/api/admin/reminder-deliveries/${encodeURIComponent(deliveryId)}/retry`, { method: "POST" });
      if (!res.ok) throw new Error(await errorMessage(res, "Could not retry the reminder."));
      const result = (await res.json()) as RetryResponse;
      setRetryMessage(
        result.status === "SENT"
          ? { tone: "success", text: "Reminder sent." }
          : result.status === "SKIPPED"
            ? { tone: "muted", text: `Not sent: ${result.reason ?? "no longer required"}. Marked as skipped.` }
            : { tone: "error", text: `Retry failed: ${result.reason ?? "delivery error"}.` }
      );
      onChanged();
    } catch (e) {
      setRetryMessage({ tone: "error", text: e instanceof Error ? e.message : "Could not retry the reminder." });
    } finally {
      setBusy(null);
      void load();
    }
  };

  const d = state.status === "ready" ? state.data : null;

  return createPortal(
    <>
      <div
        data-delivery-drawer-overlay
        onClick={onClose}
        className="fixed inset-x-0 bottom-0 z-[45] bg-[rgba(13,14,16,0.12)]"
        style={{ top: APP_HEADER_OFFSET }}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="delivery-detail-title"
        data-delivery-drawer
        className="fixed bottom-0 right-0 z-[45] flex w-[min(520px,100vw)] flex-col border-l border-ds-border bg-white shadow-[-4px_0_16px_rgba(13,14,16,0.06)]"
        style={{ top: APP_HEADER_OFFSET }}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-ds-border px-5 pb-3 pt-3.5">
          <div className="min-w-0">
            <h2 id="delivery-detail-title" className="text-[15px] font-semibold text-ds-text-primary">
              Reminder delivery
            </h2>
            {d && (
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ds-text-secondary">
                <span className="text-ds-text-primary">{d.kindLabel}</span>
                <DeliveryStatusBadge label={d.statusLabel} tone={d.statusTone} />
              </p>
            )}
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="h-7 w-7 rounded-md text-lg leading-none text-ds-text-secondary hover:bg-ds-surface"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4" data-delivery-drawer-body>
          {state.status === "loading" && <p className="text-xs text-ds-text-secondary">Loading reminder…</p>}
          {state.status === "error" && (
            <p role="alert" className="text-[12.5px] text-ds-error" data-delivery-detail-error>
              Could not load this reminder. Please try again.
            </p>
          )}

          {d && (
            <>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3" data-delivery-fields>
                <Field label="Employee">{d.appraisal.employeeName}</Field>
                <Field label="Appraisal">
                  {[d.appraisal.cycleName, d.appraisal.statusLabel].filter(Boolean).join(" · ") || "—"}
                </Field>
                <Field label="Recipient">
                  {d.recipientName} <span className="text-ds-text-secondary">({roleLabel(d.recipientRole)})</span>
                </Field>
                <Field label="Recipient address">
                  {d.recipientEmail ?? "Not on record"}
                  {d.recipientEmailSource === "current" && <span className="block text-[11px] text-ds-text-secondary">Current address</span>}
                </Field>
                <Field label="Reminder type">{d.kindLabel}</Field>
                <Field label="Timing">{d.timing}</Field>
                <Field label="Scheduled date">{dateLabel(d.scheduledFor)}</Field>
                <Field label="Due date">{dateLabel(d.dueDate)}</Field>
                <Field label="Attempts">
                  {d.attemptCount} of {d.maxAttempts}
                </Field>
                <Field label="First attempt">
                  {d.firstAttemptRecorded ? (d.firstAttemptAt ? formatSyncTime(d.firstAttemptAt) : "—") : "Not recorded"}
                </Field>
                <Field label="Last attempt">{d.lastAttemptAt ? formatSyncTime(d.lastAttemptAt) : "—"}</Field>
                <Field label="Sent">{d.sentAt ? formatSyncTime(d.sentAt) : "—"}</Field>
                {d.status === "FAILED" && (
                  <Field label="Error">
                    {d.reason ?? "—"}
                    {d.errorCode && <span className="block font-mono text-[11px] text-ds-text-secondary">{d.errorCode}</span>}
                  </Field>
                )}
                {d.status === "SKIPPED" && <Field label="Skip reason">{d.reason ?? "—"}</Field>}
                {d.nextRetryAt && <Field label="Next automatic retry">{formatSyncTime(d.nextRetryAt)}</Field>}
              </dl>

              {!d.stillRequired && d.status !== "SENT" && d.status !== "SKIPPED" && (
                <p className="rounded-md border border-ds-border bg-ds-surface px-3 py-2 text-xs text-ds-text-secondary" data-delivery-state-note>
                  This reminder would no longer be sent: {d.currentStateReason ?? "no longer required"}.
                </p>
              )}

              <div className="space-y-2 border-t border-ds-border pt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={runPreview} disabled={busy !== null} data-delivery-preview-action>
                    {busy === "preview" ? "Generating…" : "Preview email"}
                  </Button>
                  {d.status === "FAILED" &&
                    (!confirmingRetry ? (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => setConfirmingRetry(true)}
                        disabled={busy !== null || !d.retry.allowed}
                        data-delivery-retry-action
                      >
                        {busy === "retry" ? "Retrying…" : "Retry delivery"}
                      </Button>
                    ) : (
                      <span className="flex flex-wrap items-center gap-2 rounded-md border border-ds-border px-2.5 py-1.5 text-xs" data-delivery-retry-confirm>
                        <span className="text-ds-text-primary">Send this reminder to {d.recipientName} now?</span>
                        <Button type="button" size="sm" onClick={runRetry} data-delivery-retry-confirm-action>
                          Retry
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => setConfirmingRetry(false)}>
                          Cancel
                        </Button>
                      </span>
                    ))}
                </div>
                {d.status === "FAILED" && !d.retry.allowed && d.retry.message && (
                  <p className="text-xs text-ds-text-secondary" data-delivery-retry-blocked>
                    {d.retry.message}
                  </p>
                )}
                {retryMessage && (
                  <p
                    role="status"
                    data-delivery-retry-result
                    className={
                      retryMessage.tone === "success"
                        ? "text-xs text-ds-success"
                        : retryMessage.tone === "error"
                          ? "text-xs text-ds-error"
                          : "text-xs text-ds-text-secondary"
                    }
                  >
                    {retryMessage.text}
                  </p>
                )}
                {previewError && (
                  <p className="text-xs text-ds-error" data-delivery-preview-error>
                    {previewError}
                  </p>
                )}
              </div>

              {preview && (
                <div className="space-y-2" data-delivery-preview>
                  <p className="text-xs text-ds-text-secondary" data-delivery-preview-notice>
                    {preview.notice}
                  </p>
                  {preview.stateChanged && (
                    <p className="rounded-md border border-ds-warning-border bg-ds-warning-subtle px-3 py-2 text-xs text-ds-warning" data-delivery-preview-changed>
                      The appraisal has changed since this reminder was scheduled
                      {preview.stateChangeReason ? `: ${preview.stateChangeReason}` : ""}. It would not be sent as recorded.
                    </p>
                  )}
                  <p className="text-[13px] font-semibold text-ds-text-primary">{preview.subject}</p>
                  <iframe
                    title="Reminder email preview"
                    sandbox=""
                    srcDoc={preview.html}
                    className="h-[420px] w-full rounded-md border border-ds-border bg-white"
                  />
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </>,
    document.body
  );
}
