"use client";

import { useState, useEffect, useLayoutEffect, useCallback, useRef, type TextareaHTMLAttributes } from "react";
import { Check, Clock, Info, FileText, Download, XCircle, AlertCircle, Shield, RefreshCw, ChevronRight } from "lucide-react";
import { cn } from "@/utils/cn";
import type { AppraisalData, AppraisalAgreement } from "./AppraisalTabs";

export interface SignoffsTabProps {
  appraisalId: string;
  appraisal: AppraisalData;
  signoffs: { role: string; stage: string; signed_at?: string; comment?: string }[];
  isEmployee: boolean;
  isAppraisalManager: boolean;
  isHOD?: boolean;
  isHR?: boolean;
  /** Same as Summary tab: used so signoff score matches Summary (management track = leadership component). */
  showLeadership?: boolean;
}

function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
  } catch {
    return String(iso);
  }
}

function signerRoleLabel(role: "EMPLOYEE" | "MANAGER" | "HOD"): string {
  return role === "HOD" ? "HOD" : role === "MANAGER" ? "Manager" : "Employee";
}

function SignerFlow({ chain }: { chain: { role: "EMPLOYEE" | "MANAGER" | "HOD"; name: string; email: string | null }[] }) {
  return (
    <ol data-signer-flow aria-label="Signing order" className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center sm:gap-y-1.5">
      {chain.map((s, idx) => (
        <li key={`${s.role}-${idx}`} data-signer-step={idx + 1} className="flex items-center gap-1.5">
          <span
            className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-full border border-ds-border bg-ds-surface py-1 pl-1 pr-3 text-[12px]"
            title={s.email ?? undefined}
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white text-[11px] font-semibold text-ds-text-primary">
              {idx + 1}
            </span>
            <span data-signer-role className="font-semibold text-ds-text-primary">{signerRoleLabel(s.role)}</span>
            {s.name && s.name !== "—" && <span className="truncate text-ds-text-secondary">{s.name}</span>}
          </span>
          {idx < chain.length - 1 && (
            <ChevronRight aria-hidden="true" className="hidden h-3.5 w-3.5 shrink-0 text-ds-text-secondary sm:block" />
          )}
        </li>
      ))}
    </ol>
  );
}

function ResultSummary({ scores }: { scores: { workplan: number; competency: number; overall: number; ratingLabel: string } }) {
  const metrics = [
    { id: "overall", label: "Overall Score", value: scores.overall.toFixed(1) },
    { id: "workplan", label: "Workplan Points", value: scores.workplan.toFixed(1) },
    { id: "competency", label: "Competencies", value: scores.competency.toFixed(1) },
    { id: "rating", label: "Rating", value: scores.ratingLabel },
  ];
  return (
    <dl
      data-result-summary
      className="grid grid-cols-2 gap-px overflow-hidden rounded-[8px] border border-ds-border bg-ds-border sm:grid-cols-4"
    >
      {metrics.map((m) => (
        <div key={m.id} data-result-metric={m.id} className="flex min-w-0 flex-col-reverse justify-end bg-white px-4 py-3">
          <dt className="mt-0.5 text-[11px] text-ds-text-secondary">{m.label}</dt>
          <dd
            className={cn(
              "font-semibold text-ds-text-primary",
              m.id === "rating" ? "text-[14px] leading-snug" : "text-[20px] leading-tight tabular-nums"
            )}
          >
            {m.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function AutoGrowTextarea({
  value,
  onChange,
  minRows = 3,
  maxHeight = 240,
  ...rest
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value" | "rows"> & {
  value: string;
  onChange: (v: string) => void;
  minRows?: number;
  maxHeight?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    if (el.scrollHeight > 0) el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, [value, maxHeight]);
  return (
    <textarea
      {...rest}
      ref={ref}
      rows={minRows}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ maxHeight }}
    />
  );
}

interface SignerRowProps {
  order: number;
  role: string;
  name: string;
  email: string | null;
  signedAt?: string | null;
  isCurrent: boolean;
  totalSigners: number;
}

function SignerRow({ order, role, name, email, signedAt, isCurrent, totalSigners }: SignerRowProps) {
  const signed = !!signedAt;
  const waiting = !signed && !isCurrent;
  const borderColor = signed ? "border-l-ds-success" : isCurrent ? "border-l-ds-warning" : "border-l-transparent";
  const bgStyle = isCurrent && !signed ? "bg-ds-warning-subtle" : "";

  return (
    <div
      className={cn(
        "flex items-center gap-4 px-5 py-4 border-l-[3px]",
        borderColor,
        bgStyle,
        waiting && "opacity-60"
      )}
    >
      <div
        className={cn(
          "w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0",
          signed && "bg-ds-success-subtle border border-ds-success-border",
          isCurrent && "bg-ds-warning-subtle border border-ds-warning-border",
          waiting && "bg-ds-surface border border-ds-border"
        )}
      >
        {signed ? (
          <Check className="w-4 h-4 text-ds-success" />
        ) : isCurrent ? (
          <Clock className="w-4 h-4 text-ds-warning animate-pulse" />
        ) : (
          <span className="text-[12px] font-semibold text-ds-text-secondary">{order}</span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-ds-text-primary truncate">{name}</p>
        <p className="text-[10px] text-ds-text-secondary">{role} · {email ?? "—"}</p>
      </div>
      {signed && (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-ds-badge bg-ds-success-subtle border border-ds-success-border text-[10px] font-semibold text-ds-success">
          <span className="w-1.5 h-1.5 rounded-full bg-ds-mint" />
          Signed
        </span>
      )}
      {isCurrent && (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-ds-badge bg-ds-warning-subtle border border-ds-warning-border text-[10px] font-semibold text-ds-warning">
          <span className="w-1.5 h-1.5 rounded-full bg-ds-amber animate-pulse" />
          Awaiting signature
        </span>
      )}
      {waiting && (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-ds-badge bg-ds-surface border border-ds-border text-[10px] font-semibold text-ds-text-secondary">
          Waiting
        </span>
      )}
      <p className="text-[10px] text-ds-text-secondary flex-shrink-0 text-right min-w-[110px]">
        {signed ? formatDate(signedAt) : isCurrent ? `Signer ${order} of ${totalSigners}` : ""}
      </p>
    </div>
  );
}

/** Mirrors the sections rendered by lib/pdf/appraisal-template.html; Leadership is only rendered for management track. */
export function signedDocumentItems(showLeadership: boolean): string[] {
  return [
    "Employee details & cover page",
    "Workplan objectives & actuals",
    "Core competency ratings",
    "Technical competencies",
    "Productivity assessment",
    ...(showLeadership ? ["Leadership assessment"] : []),
    "Summary score & HR recommendation",
    "Signature block",
  ];
}

export function SignoffsTab({
  appraisalId,
  appraisal,
  signoffs,
  isEmployee,
  isAppraisalManager,
  isHOD = false,
  isHR = false,
  showLeadership = false,
}: SignoffsTabProps) {
  const status = (appraisal.status ?? "DRAFT") as string;
  const [statusData, setStatusData] = useState<{
    agreement: AppraisalAgreement | null;
    signers: { employee: { full_name: string; email: string | null }; manager: { full_name: string; email: string | null }; hrOfficer: { full_name: string; email: string | null } };
    signerChain?: { role: "EMPLOYEE" | "MANAGER" | "HOD"; name: string; email: string | null; signedAt: string | null }[];
    scores: { workplan: number; competency: number; overall: number; ratingLabel: string };
  } | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [managerComments, setManagerComments] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [isSyncingAdobe, setIsSyncingAdobe] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const refetchStatus = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const r = await fetch(
        `/api/appraisals/${appraisalId}/signoff/status?showLeadership=${showLeadership ? "true" : "false"}`,
        { cache: "no-store" }
      );
      const data = r.ok ? await r.json() : null;
      if (data) setStatusData(data);
    } finally {
      setIsRefreshing(false);
    }
  }, [appraisalId, showLeadership]);

  useEffect(() => {
    void refetchStatus();
  }, [refetchStatus]);

  const pollAdobeStatus = useCallback(async () => {
    setSyncError(null);
    setIsSyncingAdobe(true);
    try {
      const res = await fetch(`/api/appraisals/${appraisalId}/check-adobe-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSyncError(typeof data.error === "string" ? data.error : "Sync failed");
        return;
      }
      await refetchStatus();
    } catch (err) {
      console.error("[SignoffsTab] Poll error:", err);
      setSyncError("Sync failed");
    } finally {
      setIsSyncingAdobe(false);
    }
  }, [appraisalId, refetchStatus]);

  useEffect(() => {
    const agreementStatus = statusData?.agreement?.status;
    if (agreementStatus !== "OUT_FOR_SIGNATURE") return;
    void pollAdobeStatus();
    const id = setInterval(() => {
      void pollAdobeStatus();
    }, 15000);
    return () => clearInterval(id);
  }, [statusData?.agreement?.status, pollAdobeStatus]);

  const agreement = (statusData?.agreement ?? appraisal.agreement) as AppraisalAgreement | undefined | null;
  const employee = statusData?.signers?.employee ?? { full_name: appraisal.employeeName, email: appraisal.employeeEmail ?? null };
  const manager = statusData?.signers?.manager ?? { full_name: appraisal.managerName ?? "—", email: appraisal.managerEmail ?? null };
  const hrOfficer = statusData?.signers?.hrOfficer ?? { full_name: appraisal.hrOfficerName ?? "—", email: appraisal.hrOfficerEmail ?? null };
  const scores = statusData?.scores ?? { workplan: 0, competency: 0, overall: 0, ratingLabel: "—" };
  const signerChain = statusData?.signerChain ?? [
    { role: "EMPLOYEE" as const, name: employee.full_name, email: employee.email, signedAt: agreement?.employee_signed_at ?? null },
    { role: "MANAGER" as const, name: manager.full_name, email: manager.email, signedAt: agreement?.manager_signed_at ?? null },
    { role: "HOD" as const, name: hrOfficer.full_name, email: hrOfficer.email, signedAt: agreement?.hr_signed_at ?? null },
  ];

  const uiState = (() => {
    if (status === "MANAGER_REVIEW") return "READY_TO_SUBMIT";
    if (status === "PENDING_SIGNOFF") {
      if (agreement?.status === "SIGNED") return "COMPLETE";
      if (agreement?.status === "DECLINED") return "DECLINED";
      if (agreement?.status === "CANCELLED" || agreement?.status === "EXPIRED") return "CANCELLED";
      return "IN_PROGRESS";
    }
    if (agreement?.status === "SIGNED") return "COMPLETE";
    return "READY_TO_SUBMIT";
  })();

  const canSubmit = (isAppraisalManager || isHR) && status === "MANAGER_REVIEW";
  const signaturesCollected = signerChain.filter((s) => !!s.signedAt).length;
  const totalSigners = signerChain.length;
  const currentSignerIndex = signerChain.findIndex((s) => !s.signedAt);
  const currentSigner = currentSignerIndex >= 0 ? signerChain[currentSignerIndex] : null;
  const currentRoleByUser = isEmployee ? "EMPLOYEE" : isAppraisalManager ? "MANAGER" : isHOD ? "HOD" : isHR ? "HR" : null;
  const isCurrentSignersTurn =
    uiState === "IN_PROGRESS" &&
    agreement &&
    !!currentSigner &&
    ((currentRoleByUser === "HOD" && currentSigner.role === "HOD") || currentRoleByUser === currentSigner.role);
  const canCancel = uiState === "IN_PROGRESS" && (isAppraisalManager || isHR);
  const expiryDate = agreement?.created_at
    ? new Date(new Date(agreement.created_at).getTime() + 30 * 24 * 60 * 60 * 1000)
    : null;
  const daysRemaining = expiryDate ? Math.max(0, Math.ceil((expiryDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000))) : 0;

  const handleSubmitForSignoff = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/appraisals/${appraisalId}/signoff/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ managerComments: managerComments || undefined }),
      });
      const data = await res.json();
      if (res.ok) window.location.reload();
      else alert(data.error ?? "Failed to submit for sign-off");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownload = async (type: "draft" | "signed") => {
    const res = await fetch(`/api/appraisals/${appraisalId}/signoff/download?type=${type}`);
    const data = await res.json();
    if (data?.url) window.open(data.url, "_blank");
    else alert(type === "draft" ? "Draft PDF not available" : "Signed PDF not available");
  };

  const handleResendEmail = async () => {
    setResending(true);
    try {
      const res = await fetch(`/api/appraisals/${appraisalId}/signoff/resend`, { method: "POST" });
      const data = await res.json();
      if (res.ok) alert("Reminder sent. Check your email.");
      else alert(data.error ?? "Failed to send reminder");
    } finally {
      setResending(false);
    }
  };

  const handleCancelSignoff = async () => {
    setCancelling(true);
    try {
      const res = await fetch(`/api/appraisals/${appraisalId}/signoff/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: cancelReason || "Cancelled by reviewer" }),
      });
      const data = await res.json();
      if (res.ok) {
        setShowCancelModal(false);
        window.location.reload();
      } else alert(data.error ?? "Failed to cancel");
    } finally {
      setCancelling(false);
    }
  };

  const canSyncWithAdobe = isHR || isEmployee || isAppraisalManager;

  const generatePdfButton = uiState === "READY_TO_SUBMIT" && (isAppraisalManager || isHR) ? (
    <button
      type="button"
      data-signoff-cta
      onClick={handleSubmitForSignoff}
      disabled={submitting || !canSubmit}
      className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-[8px] bg-ds-text-primary px-4 text-[12px] font-semibold text-white transition-colors duration-150 hover:bg-ds-accent-hover disabled:opacity-50 max-sm:w-full"
    >
      {submitting ? (
        <>
          <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
          Generating PDF & sending…
        </>
      ) : (
        <>
          <Shield className="w-4 h-4" aria-hidden="true" />
          Generate PDF & send via Adobe Sign
        </>
      )}
    </button>
  ) : null;

  const documentItems = signedDocumentItems(showLeadership);

  return (
    <div className="flex flex-col gap-5">
      {/* State A — Ready to submit */}
      {uiState === "READY_TO_SUBMIT" && (
        <>
          <section data-signoff-result aria-labelledby="signoff-result-heading" className="space-y-2">
            <h3 id="signoff-result-heading" className="text-[13px] font-semibold text-ds-text-primary">
              Final result
            </h3>
            <ResultSummary scores={scores} />
          </section>

          <section
            data-signoff-section
            aria-labelledby="signoff-section-heading"
            className="overflow-hidden rounded-[8px] border border-ds-border bg-white"
          >
            <div
              data-signoff-header
              className="flex flex-col gap-3 border-b border-ds-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <h3 id="signoff-section-heading" className="text-[13px] font-semibold text-ds-text-primary">
                  Sign-off via Adobe Sign
                </h3>
                <p className="mt-0.5 text-[12px] text-ds-text-secondary">Signatures are collected in sequence.</p>
              </div>
              {generatePdfButton}
            </div>
            <div className="space-y-3 px-4 py-3">
              <SignerFlow chain={signerChain} />
              <div data-document-contents className="rounded-[8px] bg-ds-surface px-3 py-2.5">
                <h4 className="text-[12px] font-semibold text-ds-text-primary">Included in the signed appraisal</h4>
                <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
                  {documentItems.map((item) => (
                    <li key={item} data-document-item className="flex items-center gap-1.5 text-[12px] text-ds-text-secondary">
                      <Check aria-hidden="true" className="h-3 w-3 shrink-0 text-ds-success" strokeWidth={2.5} />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>

          <section data-manager-comments aria-labelledby="signoff-comments-heading" className="space-y-2">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <h3 id="signoff-comments-heading" className="text-[13px] font-semibold text-ds-text-primary">
                Manager comments
              </h3>
              <p className="text-[12px] text-ds-text-secondary">Optional · Saved with the appraisal</p>
            </div>
            <AutoGrowTextarea
              value={managerComments}
              onChange={setManagerComments}
              minRows={3}
              aria-labelledby="signoff-comments-heading"
              placeholder="Add overall comments for this appraisal…"
              className="w-full resize-none overflow-y-auto rounded-[8px] border border-ds-border bg-white px-3 py-2 text-[12px] leading-relaxed text-ds-text-primary outline-none transition-colors duration-150 focus:border-ds-accent focus:ring-2 focus:ring-[#0d0e10]/10"
            />
          </section>
        </>
      )}

      {/* State B/C — In progress */}
      {uiState === "IN_PROGRESS" && agreement && (
        <div className="space-y-3">
          <div className="bg-white border border-ds-border rounded-ds-panel overflow-hidden" style={{ boxShadow: "none" }}>
            <div
              data-signoff-header
              className="flex flex-col gap-2 border-b border-ds-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <h3 className="text-[13px] font-semibold text-ds-text-primary">Sign-off via Adobe Sign</h3>
                <p className="mt-0.5 text-[12px] text-ds-text-secondary">
                  Sign-off in progress · {signaturesCollected} of {totalSigners} signed
                </p>
                <p className="mt-0.5 text-[11px] text-ds-text-secondary">
                  Sent {formatDate(agreement.created_at)} · Expires {formatDate(expiryDate?.toISOString())} · Weekly reminders active
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span
                  data-signoff-status
                  className="inline-flex items-center gap-1.5 rounded-ds-badge border border-ds-warning-border bg-ds-warning-subtle px-2.5 py-1 text-[11px] font-semibold text-ds-warning"
                >
                  <Clock aria-hidden="true" className="h-3 w-3" />
                  Awaiting signatures
                </span>
                <button
                  type="button"
                  onClick={() => void refetchStatus()}
                  disabled={isRefreshing}
                  className="flex items-center gap-1.5 text-xs text-ds-text-secondary hover:text-ds-text-primary transition-colors disabled:opacity-50"
                >
                  <RefreshCw size={12} className={isRefreshing ? "animate-spin" : ""} />
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </button>
                <div className="flex items-center gap-1.5">
                  {signerChain.map((s, i) => (
                    <div
                      key={i}
                      className={cn(
                        "w-2.5 h-2.5 rounded-full transition-colors",
                        s.signedAt ? "bg-ds-success" : i === signaturesCollected ? "bg-ds-warning animate-pulse" : "bg-ds-border"
                      )}
                    />
                  ))}
                </div>
              </div>
            </div>
            {signerChain.map((s, idx) => (
              <div key={`${s.role}-${idx}`}>
                {idx > 0 && <div className="h-px bg-ds-border" />}
                <SignerRow
                  order={idx + 1}
                  role={s.role === "HOD" ? "HOD" : s.role === "MANAGER" ? "Manager" : "Employee"}
                  name={s.name}
                  email={s.email}
                  signedAt={s.signedAt}
                  isCurrent={idx === currentSignerIndex}
                  totalSigners={totalSigners}
                />
              </div>
            ))}
            {agreement.status === "OUT_FOR_SIGNATURE" && (
              <p className="text-xs text-ds-text-secondary flex items-center gap-1.5 mt-2 px-5 pb-4">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-ds-accent animate-pulse" />
                Checking for updates every 15 seconds
              </p>
            )}
          </div>

          {isCurrentSignersTurn && (
            <div className="flex items-start gap-3 px-4 py-3.5 bg-ds-warning-subtle border border-ds-warning-border rounded-ds-panel">
              <Info className="w-4 h-4 text-ds-warning flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-[12px] font-semibold text-ds-warning">It&apos;s your turn to sign</p>
                <p className="text-[11px] text-ds-warning mt-0.5">
                  Check your email for a message from Adobe Sign. The link expires in {daysRemaining} days.
                </p>
              </div>
              <button
                type="button"
                onClick={handleResendEmail}
                disabled={resending}
                className="flex-shrink-0 text-[11px] font-semibold text-ds-warning border border-ds-warning-border bg-white px-3 py-1.5 rounded-[7px] hover:bg-ds-warning-subtle transition-colors disabled:opacity-50"
              >
                {resending ? "Sending…" : "Resend email"}
              </button>
            </div>
          )}

          <div className="flex items-center gap-3 px-4 py-3.5 bg-white border border-ds-border rounded-ds-panel">
            <div className="w-9 h-9 rounded-[9px] bg-ds-error-subtle border border-ds-error-border flex items-center justify-center flex-shrink-0">
              <FileText className="w-5 h-5 text-ds-error" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-semibold text-ds-text-primary truncate">
                FY2026_Appraisal_{employee.full_name.replace(/\s/g, "_")}.pdf
              </p>
              <p className="text-[10px] text-ds-text-secondary mt-0.5">
                Generated {formatDate(agreement.created_at)} · {signaturesCollected} of {totalSigners} signatures collected
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleDownload("draft")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] border border-ds-border text-[11px] font-semibold text-ds-text-secondary hover:border-ds-text-primary hover:text-ds-text-primary transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Download draft
            </button>
          </div>

          {(canSyncWithAdobe || canCancel) && (
            <div className="flex flex-col items-end gap-1.5">
              <div className="flex flex-wrap items-center justify-end gap-4">
                {canSyncWithAdobe && (
                  <button
                    type="button"
                    onClick={() => void pollAdobeStatus()}
                    disabled={isSyncingAdobe}
                    className="flex items-center gap-1.5 text-[11px] text-ds-text-secondary hover:text-ds-text-primary transition-colors disabled:opacity-50"
                  >
                    <RefreshCw size={12} className={isSyncingAdobe ? "animate-spin" : ""} />
                    {isSyncingAdobe ? "Syncing..." : "Sync with Adobe Sign"}
                  </button>
                )}
                {canCancel && (
                  <button type="button" onClick={() => setShowCancelModal(true)} className="text-[11px] text-ds-error hover:underline">
                    Cancel sign-off
                  </button>
                )}
              </div>
              {syncError && <p className="text-[10px] text-ds-error max-w-md text-right">{syncError}</p>}
            </div>
          )}
        </div>
      )}

      {/* State D — Complete */}
      {uiState === "COMPLETE" && agreement && (
        <div className="space-y-3">
          <div className="flex items-center gap-4 px-5 py-4 bg-ds-success-subtle border border-ds-success-border rounded-ds-panel">
            <div className="w-11 h-11 rounded-full bg-white border-[1.5px] border-ds-success-border flex items-center justify-center flex-shrink-0">
              <Check className="w-5 h-5 text-ds-success" strokeWidth={2.5} />
            </div>
            <div>
              <p className="font-sans text-[14px] font-semibold text-ds-success">Sign-off complete</p>
              <p className="text-[11px] text-ds-accent mt-0.5">
                All signatures collected · {formatDate(agreement.hr_signed_at)} · Appraisal advancing to HOD Review
              </p>
            </div>
          </div>

          <div className="bg-white border border-ds-border rounded-ds-panel overflow-hidden" style={{ boxShadow: "none" }}>
            <div className="px-5 py-3.5 bg-ds-surface border-b border-ds-border flex items-center justify-between">
              <p className="text-[13px] font-semibold text-ds-text-primary">Signatures collected</p>
              <div className="flex gap-1.5">
                {Array.from({ length: totalSigners }).map((_, i) => (
                  <div key={i} className="w-2.5 h-2.5 rounded-full bg-ds-success" />
                ))}
              </div>
            </div>
            {signerChain.map((s, idx) => (
              <div key={`${s.role}-complete-${idx}`}>
                {idx > 0 && <div className="h-px bg-ds-border" />}
                <SignerRow
                  order={idx + 1}
                  role={s.role === "HOD" ? "HOD" : s.role === "MANAGER" ? "Manager" : "Employee"}
                  name={s.name}
                  email={s.email}
                  signedAt={s.signedAt}
                  isCurrent={false}
                  totalSigners={totalSigners}
                />
              </div>
            ))}
          </div>

          <div className="bg-white border border-ds-border rounded-ds-panel overflow-hidden" style={{ boxShadow: "none" }}>
            <div className="flex items-center justify-between gap-4 px-5 py-4 bg-ds-surface border-b border-ds-border-strong">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-ds-panel bg-ds-error-subtle border border-ds-error-border flex items-center justify-center flex-shrink-0">
                  <FileText className="w-5 h-5 text-ds-error" />
                </div>
                <div>
                  <p className="text-[13px] font-semibold text-ds-text-primary">Signed appraisal document</p>
                  <p className="text-[10px] text-ds-accent mt-0.5">
                    All signatures collected · Legally binding · {formatDate(agreement.hr_signed_at)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleDownload("signed")}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-[8px] bg-ds-text-primary text-white text-[12px] font-semibold hover:bg-ds-accent-hover transition-colors flex-shrink-0"
              >
                <Download className="w-4 h-4" />
                Download signed PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {/* State E — Declined */}
      {uiState === "DECLINED" && agreement && (
        <div className="space-y-3">
          <div className="flex items-start gap-4 px-5 py-4 bg-ds-error-subtle border border-ds-error-border rounded-ds-panel">
            <div className="w-10 h-10 rounded-full bg-white border-[1.5px] border-ds-error-border flex items-center justify-center flex-shrink-0">
              <XCircle className="w-5 h-5 text-ds-error" />
            </div>
            <div className="flex-1">
              <p className="text-[13px] font-semibold text-ds-error">Sign-off declined</p>
              <p className="text-[12px] text-ds-error mt-1.5">
                <strong>{agreement.declined_by_email}</strong> declined to sign on {formatDate(agreement.declined_at)}
              </p>
              {agreement.decline_reason && (
                <div className="mt-3 px-3 py-2.5 bg-white border border-ds-error-border rounded-[8px]">
                  <p className="text-[9px] font-semibold text-ds-error uppercase tracking-[.07em] mb-1.5">Reason given</p>
                  <p className="text-[12px] text-ds-text-primary leading-relaxed">&quot;{agreement.decline_reason}&quot;</p>
                </div>
              )}
            </div>
          </div>
          <div className="px-5 py-4 bg-ds-surface border border-ds-border rounded-ds-panel text-center">
            <p className="text-[12px] text-ds-text-secondary">
              The appraisal has been returned to <strong className="text-ds-text-primary">Manager Review</strong>.
            </p>
            <p className="text-[11px] text-ds-text-secondary mt-1">
              Review the feedback above, make any necessary changes, and resubmit for sign-off.
            </p>
          </div>
        </div>
      )}

      {/* State F — Cancelled or Expired */}
      {uiState === "CANCELLED" && (
        <div className="px-5 py-10 bg-ds-surface border border-ds-border rounded-ds-panel text-center">
          <div className="w-12 h-12 rounded-ds-panel bg-white border border-ds-border flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-6 h-6 text-ds-text-secondary" />
          </div>
          <p className="text-[13px] font-semibold text-ds-text-primary mb-1.5">
            Sign-off {agreement?.status === "EXPIRED" ? "expired" : "cancelled"}
          </p>
          <p className="text-[12px] text-ds-text-secondary leading-relaxed">
            {agreement?.status === "EXPIRED"
              ? "The 30-day signing window expired. The appraisal has been returned to Manager Review."
              : `Cancelled on ${formatDate(agreement?.updated_at)}. The appraisal has been returned to Manager Review.`}
          </p>
        </div>
      )}

      {/* Cancel modal */}
      {showCancelModal && (
        <div className="mt-4 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.38)", borderRadius: 8, padding: 24, minHeight: 280 }}>
          <div className="bg-white rounded-ds-panel border border-ds-border w-full max-w-[440px] overflow-hidden">
            <div className="px-5 py-4 bg-ds-surface border-b border-ds-border">
              <p className="text-[13px] font-semibold text-ds-text-primary">Cancel sign-off?</p>
              <p className="text-[11px] text-ds-text-secondary mt-0.5">This will recall the Adobe Sign agreement</p>
            </div>
            <div className="px-5 py-4">
              <p className="text-[12px] text-ds-text-secondary mb-3 leading-relaxed">
                The agreement will be recalled and the appraisal returned to Manager Review. All signers will be notified by email.
              </p>
              <label className="text-[10px] font-semibold uppercase tracking-[.07em] text-ds-text-secondary block mb-1.5">Reason (optional)</label>
              <textarea
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                rows={3}
                placeholder="e.g. Workplan targets need revision before sign-off..."
                className="w-full border border-ds-border rounded-[8px] px-3 py-2.5 text-[12px] resize-none outline-none focus:border-ds-accent focus:ring-2 focus:ring-[#0d0e10]/10"
              />
            </div>
            <div className="flex justify-end gap-2 px-5 py-3.5 border-t border-ds-border">
              <button
                type="button"
                onClick={() => setShowCancelModal(false)}
                className="px-4 py-2 rounded-[8px] border border-ds-border text-[12px] font-semibold text-ds-text-secondary hover:border-ds-text-primary transition-colors"
              >
                Keep sign-off
              </button>
              <button
                type="button"
                onClick={handleCancelSignoff}
                disabled={cancelling}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-[8px] bg-ds-error-subtle text-ds-error border border-ds-error-border text-[12px] font-semibold hover:bg-ds-error-subtle disabled:opacity-50 transition-colors"
              >
                {cancelling ? "Cancelling…" : "Cancel sign-off"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
