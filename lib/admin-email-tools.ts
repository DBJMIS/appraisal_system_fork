/**
 * Request validation, Graph error sanitising and audit logging for the HR/Admin email preview and
 * test-send routes. Server-only.
 */

import { isEmailKind, type EmailKind } from "@/lib/email-templates";

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function parseId(value: unknown, label: string): Parsed<string> {
  const id = typeof value === "string" ? value.trim() : "";
  if (!id) return { ok: false, error: `Select ${label}.` };
  if (!ID_PATTERN.test(id)) return { ok: false, error: `Invalid ${label}.` };
  return { ok: true, value: id };
}

export function parseKind(value: unknown): Parsed<EmailKind> {
  return isEmailKind(value) ? { ok: true, value } : { ok: false, error: "Select a valid notification type." };
}

const EMAIL_PATTERN =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

const EXTRA_RECIPIENT_FIELDS = ["cc", "bcc", "recipients", "toRecipients", "ccRecipients", "bccRecipients"];

/**
 * Test-send recipients: one explicit address on an allowed domain. The allowed domains come from
 * APPRAISAL_TEST_EMAIL_ALLOWED_DOMAINS (comma-separated) or, when that is unset, the domain of the
 * AZURE_FROM_EMAIL sending mailbox. With neither configured, test sends are refused.
 */
export function allowedTestDomains(): string[] {
  const configured = (process.env.APPRAISAL_TEST_EMAIL_ALLOWED_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
  if (configured.length) return configured;
  const fromDomain = (process.env.AZURE_FROM_EMAIL ?? "").trim().toLowerCase().split("@")[1];
  return fromDomain ? [fromDomain] : [];
}

export function parseTestRecipient(body: Record<string, unknown>): Parsed<string> & { config?: boolean } {
  if (EXTRA_RECIPIENT_FIELDS.some((f) => body[f] !== undefined)) {
    return { ok: false, error: "CC, BCC and additional recipients are not supported. Send to one test address." };
  }
  if (Array.isArray(body.to)) return { ok: false, error: "Send to exactly one test address." };
  const to = typeof body.to === "string" ? body.to.trim() : "";
  if (!to) return { ok: false, error: "Enter a test email address." };
  if (/[,;\s<>]/.test(to)) return { ok: false, error: "Send to exactly one test address." };
  if (to.length > 254 || !EMAIL_PATTERN.test(to)) return { ok: false, error: "Enter a valid email address." };

  const domains = allowedTestDomains();
  if (domains.length === 0) {
    return { ok: false, config: true, error: "Test email is not configured. Set APPRAISAL_TEST_EMAIL_ALLOWED_DOMAINS." };
  }
  const domain = to.split("@")[1].toLowerCase();
  if (!domains.includes(domain)) {
    return { ok: false, error: `Test emails can only be sent to: ${domains.map((d) => `@${d}`).join(", ")}.` };
  }
  return { ok: true, value: to };
}

/** Maps a lib/email.ts transport error to a message that is safe to show; never echoes Graph bodies. */
export function sanitizeGraphError(error: string | undefined): { message: string; code: string } {
  const e = error ?? "";
  if (/AZURE_FROM_EMAIL is not set/.test(e)) {
    return { code: "SENDER_NOT_CONFIGURED", message: "The sending mailbox (AZURE_FROM_EMAIL) is not configured." };
  }
  if (/^Missing AZURE_AD_/.test(e)) {
    return { code: "CREDENTIALS_NOT_CONFIGURED", message: "Microsoft Graph credentials are not configured." };
  }
  const token = /^Token request failed \((\d+)\)/.exec(e);
  if (token || /access_token/.test(e)) {
    const status = token ? ` (HTTP ${token[1]})` : "";
    return {
      code: token ? `TOKEN_${token[1]}` : "TOKEN_FAILED",
      message: `Could not authenticate with Microsoft Graph${status}. Check the Azure app registration credentials.`,
    };
  }
  const send = /^Graph sendMail failed \((\d+)\)/.exec(e);
  if (send) {
    const status = Number(send[1]);
    const message =
      status === 403
        ? "Microsoft Graph refused to send (HTTP 403). Check the Mail.Send application permission and mailbox access."
        : status === 404
          ? "The sending mailbox was not found (HTTP 404)."
          : status === 429
            ? "Microsoft Graph is throttling requests (HTTP 429). Try again shortly."
            : `Microsoft Graph rejected the message (HTTP ${status}).`;
    return { code: `GRAPH_${status}`, message };
  }
  return { code: "SEND_FAILED", message: "The email could not be sent." };
}

export interface TestSendLogEntry {
  actorId: string;
  actorEmail: string | null;
  recipient: string;
  kind: EmailKind;
  appraisalId: string;
  success: boolean;
  errorCode?: string;
}

/** Structured server log for a test send. Never includes the email body, scores or transport secrets. */
export function logTestSend(entry: TestSendLogEntry): void {
  const line = JSON.stringify({
    event: "appraisal_test_email",
    actor_id: entry.actorId,
    actor_email: entry.actorEmail,
    recipient: entry.recipient,
    kind: entry.kind,
    appraisal_id: entry.appraisalId,
    success: entry.success,
    ...(entry.errorCode ? { error_code: entry.errorCode } : {}),
    timestamp: new Date().toISOString(),
  });
  if (entry.success) console.info("[admin-test-email]", line);
  else console.warn("[admin-test-email]", line);
}

export async function readJsonObject(req: Request): Promise<Record<string, unknown> | null> {
  const body = await req.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}
