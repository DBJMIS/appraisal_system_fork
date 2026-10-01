/**
 * Adobe Sign API client for appraisal e-signature flow.
 * Uses integration key (Bearer) auth; configure ADOBE_SIGN_INTEGRATION_KEY and ADOBE_SIGN_API_BASE.
 */

/** Match your Adobe shard (na2 if you use na2.documents.adobe.com). Set ADOBE_SIGN_API_BASE on Vercel if different. */
const BASE = process.env.ADOBE_SIGN_API_BASE ?? "https://api.na2.adobesign.com/api/rest/v6";
const KEY = process.env.ADOBE_SIGN_INTEGRATION_KEY ?? "";

const headers: Record<string, string> = {
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
};

/** Upload a PDF as a transient document; returns transientDocumentId. */
export async function uploadTransientDocument(
  pdfBuffer: Buffer,
  filename: string
): Promise<string> {
  const form = new FormData();
  form.append("File", new Blob([new Uint8Array(pdfBuffer)], { type: "application/pdf" }), filename);
  form.append("File-Name", filename);

  const res = await fetch(`${BASE}/transientDocuments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KEY}`,
    },
    body: form,
  });

  const data = (await res.json()) as { transientDocumentId?: string; [k: string]: unknown };
  if (!data.transientDocumentId) {
    throw new Error(`Adobe Sign upload failed: ${JSON.stringify(data)}`);
  }
  return data.transientDocumentId as string;
}

export interface CreateAgreementParams {
  transientDocumentId: string;
  agreementName: string;
  signers: { email: string; name: string }[];
  webhookUrl: string;
}

/** Create agreement with signers in the provided order. */
export async function createAgreement(params: CreateAgreementParams): Promise<string> {
  const {
    transientDocumentId,
    agreementName,
    signers,
    webhookUrl,
  } = params;
  void webhookUrl;

  const participantSetsInfo = signers.map((signer, idx) => ({
    order: idx + 1,
    role: "SIGNER",
    memberInfos: [{ email: signer.email, name: signer.name }],
  }));

  const body = {
    fileInfos: [{ transientDocumentId }],
    name: agreementName,
    participantSetsInfo,
    signatureType: "ESIGN",
    state: "IN_PROCESS",
    expirationTime: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    reminderFrequency: "WEEKLY_UNTIL_SIGNED",
    emailOption: {
      sendOptions: {
        initEmails: "ALL",
        inFlightEmails: "ALL",
        completionEmails: "ALL",
      },
    },
  };

  const res = await fetch(`${BASE}/agreements`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as { id?: string; [k: string]: unknown };
  if (!data.id) {
    throw new Error(`Adobe Sign agreement creation failed: ${JSON.stringify(data)}`);
  }
  return data.id as string;
}

/** Cancel an agreement. */
export async function cancelAgreement(agreementId: string, reason: string): Promise<void> {
  const res = await fetch(`${BASE}/agreements/${agreementId}/state`, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      state: "CANCELLED",
      agreementCancellationInfo: { comment: reason },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Adobe Sign cancel failed: ${res.status} ${text}`);
  }
}

/** Download the combined signed PDF. */
export async function downloadSignedPDF(agreementId: string): Promise<Buffer> {
  const res = await fetch(`${BASE}/agreements/${agreementId}/combinedDocument`, {
    headers: { Authorization: `Bearer ${KEY}` },
  });
  if (!res.ok) throw new Error(`Adobe Sign download failed: ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/** Get agreement details/status (GET /agreements/{id}). */
export async function getAgreementStatus(agreementId: string): Promise<Record<string, unknown>> {
  const url = `${BASE}/agreements/${agreementId}`;
  const res = await fetch(url, { headers });
  const bodyText = await res.text();
  let data: Record<string, unknown>;
  try {
    data = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {};
  } catch {
    throw new Error(`Adobe Sign get status: invalid JSON (HTTP ${res.status}): ${bodyText.slice(0, 240)}`);
  }
  if (!res.ok) {
    const code = data.code as string | undefined;
    const msg = (data.message as string | undefined) ?? bodyText.slice(0, 400);
    throw new Error(
      `Adobe Sign get status failed: HTTP ${res.status}${code ? ` code=${code}` : ""} — ${msg}. Verify ADOBE_SIGN_API_BASE matches your shard (e.g. https://api.na2.adobesign.com/api/rest/v6).`
    );
  }
  return data;
}

export type AdobeAgreementLifecycle =
  | "SIGNED"
  | "OUT_FOR_SIGNATURE"
  | "CANCELLED"
  | "DECLINED"
  | "EXPIRED"
  | "OTHER";

/** Same status mapping as the manual reconcile in check-adobe-status. */
export function adobeAgreementLifecycle(adobe: Record<string, unknown>): AdobeAgreementLifecycle {
  const nested = adobe.agreement as Record<string, unknown> | undefined;
  const raw = adobe.status ?? adobe.agreementStatus ?? adobe.state ?? nested?.status ?? nested?.state;
  const key = String(raw ?? "").trim().toUpperCase().replace(/-/g, "_");
  if (key === "SIGNED" || key === "COMPLETED" || key === "APPROVED" || key.includes("SIGNED")) return "SIGNED";
  if (key === "OUT_FOR_SIGNATURE" || key.includes("SIGNATURE")) return "OUT_FOR_SIGNATURE";
  if (key.includes("CANCEL")) return "CANCELLED";
  if (key === "DECLINED" || key === "REJECTED" || key.includes("DECLIN")) return "DECLINED";
  if (key.includes("EXPIR")) return "EXPIRED";
  return "OTHER";
}

/** Webhook payloads are unauthenticated, so state changes are confirmed against Adobe first. */
export async function fetchAgreementLifecycle(agreementId: string): Promise<AdobeAgreementLifecycle> {
  return adobeAgreementLifecycle(await getAgreementStatus(agreementId));
}

/** Send a reminder to the next signer(s). */
export async function sendReminder(agreementId: string): Promise<void> {
  const res = await fetch(`${BASE}/agreements/${agreementId}/reminders`, {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Adobe Sign reminder failed: ${res.status} ${text}`);
  }
}
