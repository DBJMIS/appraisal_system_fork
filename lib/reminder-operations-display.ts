/**
 * Labels and rules for the HR/Admin notification operations view. Pure and client-safe.
 * Stored delivery codes stay machine-safe (e.g. NO_LONGER_REQUIRED, GRAPH_503); this module maps
 * them to short human-readable copy. Raw provider errors are never stored, so never shown.
 */

import { MAX_DELIVERY_ATTEMPTS } from "@/lib/appraisal-reminder-policy";

export const DELIVERY_STATUSES = ["PENDING", "SENDING", "SENT", "FAILED", "SKIPPED"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const isDeliveryStatus = (value: unknown): value is DeliveryStatus =>
  typeof value === "string" && (DELIVERY_STATUSES as readonly string[]).includes(value);

export type StatusTone = "success" | "error" | "warning" | "neutral" | "muted";

export const DELIVERY_STATUS_DISPLAY: Record<DeliveryStatus, { label: string; tone: StatusTone }> = {
  SENT: { label: "Sent", tone: "success" },
  FAILED: { label: "Failed", tone: "error" },
  PENDING: { label: "Pending", tone: "warning" },
  SENDING: { label: "Sending", tone: "neutral" },
  SKIPPED: { label: "Skipped", tone: "muted" },
};

/** Provider responses that will not succeed on retry (the recipient address is rejected). */
export const PERMANENT_FAILURE_CODES = new Set(["GRAPH_400"]);
export const isPermanentFailure = (code: string | null | undefined) => !!code && PERMANENT_FAILURE_CODES.has(code);

const SKIP_REASONS: Record<string, string> = {
  NO_LONGER_REQUIRED: "Action already completed",
  SUPERSEDED: "Reminder superseded (due date changed)",
  RECIPIENT_CHANGED: "Recipient changed",
  NO_RECIPIENT_EMAIL: "Missing recipient email",
  APPRAISAL_NOT_FOUND: "Appraisal no longer exists",
  UNSUPPORTED_KIND: "No longer eligible",
};

const FAILURE_REASONS: Record<string, string> = {
  GRAPH_400: "Invalid recipient",
  GRAPH_401: "Mail service sign-in rejected",
  GRAPH_403: "Mail sending not permitted",
  GRAPH_404: "Sending mailbox not found",
  GRAPH_429: "Mail service busy",
  SENDER_NOT_CONFIGURED: "Sending mailbox not configured",
  CREDENTIALS_NOT_CONFIGURED: "Mail credentials not configured",
  TOKEN_FAILED: "Could not sign in to the mail service",
  INTERRUPTED: "Previous attempt was interrupted",
  CONTEXT_UNAVAILABLE: "Temporary processing error",
  PROCESSING_ERROR: "Temporary processing error",
  SEND_FAILED: "Email could not be sent",
};

/** Friendly copy for a stored skip or failure code; null when there is no code. */
export function deliveryReasonLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  if (SKIP_REASONS[code]) return SKIP_REASONS[code];
  if (FAILURE_REASONS[code]) return FAILURE_REASONS[code];
  if (/^GRAPH_5\d\d$/.test(code)) return "Mail service unavailable";
  if (/^TOKEN_\d+$/.test(code)) return "Could not sign in to the mail service";
  if (/^GRAPH_\d+$/.test(code)) return "Mail service rejected the message";
  return "Delivery error";
}

export type RetryBlockCode = "ALREADY_SENT" | "NOT_FAILED" | "INVALID_RECIPIENT" | "MAX_ATTEMPTS" | "NO_RECIPIENT_EMAIL" | "NO_LONGER_REQUIRED";

export interface RetryBlock {
  code: RetryBlockCode;
  message: string;
}

/**
 * Why a delivery cannot be retried manually, or null when it can. A retry is only for a FAILED
 * reminder that can still succeed; there is no override past the attempt limit.
 */
export function retryBlockReason(d: {
  status: string;
  attemptCount: number;
  errorCode: string | null;
  hasRecipientEmail: boolean;
  stillRequired: boolean;
}): RetryBlock | null {
  if (d.status === "SENT") return { code: "ALREADY_SENT", message: "This reminder has already been sent." };
  if (d.status !== "FAILED") return { code: "NOT_FAILED", message: "Only failed reminders can be retried." };
  if (isPermanentFailure(d.errorCode)) {
    return { code: "INVALID_RECIPIENT", message: "The mail server rejected this recipient, so a retry would fail again." };
  }
  if (d.attemptCount >= MAX_DELIVERY_ATTEMPTS) {
    return { code: "MAX_ATTEMPTS", message: `The maximum of ${MAX_DELIVERY_ATTEMPTS} attempts has been reached.` };
  }
  if (!d.hasRecipientEmail) return { code: "NO_RECIPIENT_EMAIL", message: "The recipient has no email address on record." };
  if (!d.stillRequired) {
    return { code: "NO_LONGER_REQUIRED", message: "The action has been completed or this reminder no longer applies." };
  }
  return null;
}

/** Sent / (sent + failed); skipped and pending are not attempts. Null when nothing was attempted. */
export function deliverySuccessRate(sent: number, failed: number): number | null {
  const attempted = sent + failed;
  return attempted > 0 ? sent / attempted : null;
}
