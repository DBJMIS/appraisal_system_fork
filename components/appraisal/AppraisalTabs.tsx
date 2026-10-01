"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { WorkplanSection } from "./WorkplanSection";
import { allowAppraisalTestBypassClient } from "@/lib/appraisal-test-bypass";
import { EvidenceBuilder } from "./EvidenceBuilder";
import { CoreCompetenciesSection } from "./CoreCompetenciesSection";
import { TechnicalCompetenciesSection } from "./TechnicalCompetenciesSection";
import { ProductivitySection } from "./ProductivitySection";
import { LeadershipSection } from "./LeadershipSection";
import { SummaryTab } from "./SummaryTab";
import { SignoffsTab } from "./SignoffsTab";
import { HRActionsTab } from "./HRActionsTab";
import { AuditTrailTab } from "./AuditTrailTab";
import { CheckInTab } from "./checkins/CheckInTab";
import { ScoreSnapshotsPanel } from "./ScoreSnapshotsPanel";
import { isFormalReviewMode } from "@/lib/midyear-config";
import { DelegationTab } from "./DelegationTab";
import { SubmitForApprovalAction } from "./SubmitForApprovalAction";
import { useDraftSubmitReadiness } from "@/hooks/useDraftSubmitReadiness";
import { canEditField, type WorkflowRole } from "@/lib/appraisal-workflow";
import type { SummaryResult } from "@/lib/summary-calc";
import type { AppraisalStatus } from "@/types/appraisal";
import { statusToneClasses } from "@/lib/appraisal-status-display";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface AppraisalAgreement {
  id: string;
  status: string;
  employee_signed_at?: string | null;
  manager_signed_at?: string | null;
  hr_signed_at?: string | null;
  declined_by_email?: string | null;
  decline_reason?: string | null;
  declined_at?: string | null;
  created_at?: string;
  updated_at?: string;
  draft_pdf_path?: string | null;
  signed_pdf_path?: string | null;
}

export interface AppraisalData {
  id: string;
  employee_id: string;
  manager_employee_id: string | null;
  cycle_id: string;
  status: string;
  is_management: boolean;
  employeeName: string;
  employeeEmail?: string | null;
  managerName?: string;
  managerEmail?: string | null;
  hrOfficerName?: string;
  hrOfficerEmail?: string | null;
  cycleName: string;
  cycleStartDate?: string;
  cycleEndDate?: string;
  approvals?: { role: string }[];
  signoffs?: { role: string; stage: string; signed_at?: string; comment?: string }[];
  agreement?: AppraisalAgreement | null;
}

interface AppraisalTabsProps {
  appraisal: AppraisalData;
  cyclePhase: string;
  currentUserId: string | null;
  currentUserEmployeeId: string | null;
  isManager: boolean;
  isDelegated?: boolean;
  isPrimaryManager?: boolean;
  delegatedByName?: string | null;
  isHR: boolean;
  isHOD?: boolean;
  showLeadership?: boolean;
  approvals?: { role: string }[];
  signoffs?: { role: string; stage: string; signed_at?: string; comment?: string }[];
  hrRecommendationsSaved?: boolean;
  /** The cycle has Mid-Year Review enabled; only changes the Check-ins tab label. */
  midyearEnabled?: boolean;
  /** Read-only oversight by a manager higher in the reporting line: content only, no actions. */
  readOnly?: boolean;
}

type TabValue = "workplan" | "checkins" | "core" | "technical" | "productivity" | "leadership" | "summary" | "signoffs" | "hractions" | "delegation" | "audit";

const START_FINAL_REVIEW_HELP = "Begin your year-end self-assessment and final appraisal review.";

const SendIcon = () => (
  <svg style={{ width: 15, height: 15 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

interface Tab {
  id: TabValue;
  label: string;
}

function ApprovalSignoffPanel({
  variant,
  appraisalId,
  statusLabel,
  subLabel,
  badges,
  actionButtonLabel,
  showActionButton,
  onAction,
  requestChangesLabel,
  onRequestChanges,
  bypassMode,
  primaryActionLabel,
  primaryActionEnabled,
  onPrimaryAction,
  secondaryActionLabel,
  secondaryActionEnabled,
  onSecondaryAction,
}: {
  variant: "approval" | "signoff";
  appraisalId: string;
  statusLabel: string;
  subLabel: string;
  badges: { label: string; done: boolean }[];
  actionButtonLabel: string;
  showActionButton: boolean;
  onAction: () => void | Promise<void>;
  requestChangesLabel?: string;
  onRequestChanges?: () => void | Promise<void>;
  bypassMode?: boolean;
  primaryActionLabel?: string;
  primaryActionEnabled?: boolean;
  onPrimaryAction?: () => void | Promise<void>;
  secondaryActionLabel?: string;
  secondaryActionEnabled?: boolean;
  onSecondaryAction?: () => void | Promise<void>;
}) {
  // Same primary CTA treatment as SubmitForApprovalAction.
  const primaryBtnClass = (enabled: boolean) =>
    `inline-flex h-9 shrink-0 items-center rounded-ds-button border px-4 text-[13px] font-medium transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus focus-visible:ring-offset-2 ${
      enabled
        ? "cursor-pointer border-ds-accent bg-ds-accent text-ds-on-primary hover:border-ds-accent-hover hover:bg-ds-accent-hover"
        : "cursor-not-allowed border-ds-border bg-ds-surface text-ds-text-secondary"
    }`;

  const renderActionButtons = () => {
    if (bypassMode && primaryActionLabel != null && secondaryActionLabel != null && onPrimaryAction && onSecondaryAction) {
      return (
        <>
          <button
            type="button"
            onClick={() => onPrimaryAction()}
            disabled={!primaryActionEnabled}
            className={primaryBtnClass(!!primaryActionEnabled)}
          >
            {primaryActionLabel}
          </button>
          <button
            type="button"
            onClick={() => onSecondaryAction()}
            disabled={!secondaryActionEnabled}
            className={primaryBtnClass(!!secondaryActionEnabled)}
          >
            {secondaryActionLabel}
          </button>
        </>
      );
    }
    if (showActionButton) {
      return (
        <button type="button" onClick={() => onAction()} className={primaryBtnClass(true)}>
          {actionButtonLabel}
        </button>
      );
    }
    return null;
  };

  return (
    <div
      data-approval-panel={variant}
      className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-ds-panel border border-ds-border bg-ds-background px-4 py-3"
    >
      <div className="min-w-0">
        <div className="text-[13px] font-semibold leading-[1.4] text-ds-text-primary">{statusLabel}</div>
        <div className="mt-0.5 text-xs leading-[1.45] text-ds-text-secondary">{subLabel}</div>
      </div>
      <div data-approval-actions className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div data-approval-status-group className="flex items-center gap-2">
          {badges.map((b) => {
            const tone = b.done ? "success" : "warning";
            return (
              <span
                key={b.label}
                data-approval-badge={b.label}
                data-tone={tone}
                title={`${b.label} ${b.done ? "approved" : "pending"}`}
                className={`inline-flex items-center gap-1 whitespace-nowrap rounded-ds-badge border px-[5px] py-0.5 text-xs font-medium leading-4 ${statusToneClasses[tone].badge}`}
              >
                <span aria-hidden="true">{b.done ? "✓" : "○"}</span> {b.label}
              </span>
            );
          })}
        </div>
        <div data-approval-button-group className="flex flex-wrap items-center gap-2">
          {renderActionButtons()}
          {variant === "approval" && onRequestChanges && (
            <Button type="button" variant="outline" size="sm" className="shrink-0 text-[13px]" onClick={() => onRequestChanges()}>
              {requestChangesLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function AppraisalTabs({
  appraisal,
  cyclePhase,
  currentUserId,
  currentUserEmployeeId,
  isManager,
  isDelegated = false,
  isPrimaryManager = false,
  delegatedByName = null,
  isHR,
  isHOD = false,
  showLeadership: showLeadershipProp,
  approvals = [],
  signoffs = [],
  hrRecommendationsSaved = false,
  midyearEnabled = false,
  readOnly = false,
}: AppraisalTabsProps) {
  const [activeTab, setActiveTab] = useState<TabValue>("workplan");
  const [summaryRefreshKey, setSummaryRefreshKey] = useState(0);
  const [dirtyTabs, setDirtyTabs] = useState<Set<string>>(new Set());
  const [unsavedModalOpen, setUnsavedModalOpen] = useState(false);
  const [unsavedModalAction, setUnsavedModalAction] = useState<"tab" | "leave" | null>(null);
  const [unsavedModalPayload, setUnsavedModalPayload] = useState<string | null>(null);
  const [unsavedModalSaving, setUnsavedModalSaving] = useState(false);
  const saveCurrentTabRef = useRef<(() => Promise<void>) | null>(null);
  const router = useRouter();

  const markDirty = useCallback((tab: string) => {
    setDirtyTabs((prev) => new Set(prev).add(tab));
  }, []);
  const markClean = useCallback((tab: string) => {
    setDirtyTabs((prev) => {
      const next = new Set(prev);
      next.delete(tab);
      return next;
    });
  }, []);
  const hasAnyUnsaved = dirtyTabs.size > 0;

  const handleTabChange = useCallback(
    (newTab: string) => {
      if (newTab === activeTab) return;
      if (hasAnyUnsaved) {
        setUnsavedModalAction("tab");
        setUnsavedModalPayload(newTab);
        setUnsavedModalOpen(true);
        return;
      }
      setActiveTab(newTab as TabValue);
      if (newTab === "summary") setSummaryRefreshKey((k) => k + 1);
    },
    [activeTab, hasAnyUnsaved]
  );

  const safeNavigate = useCallback(
    (href: string) => {
      if (hasAnyUnsaved) {
        setUnsavedModalAction("leave");
        setUnsavedModalPayload(href);
        setUnsavedModalOpen(true);
        return;
      }
      router.push(href);
    },
    [hasAnyUnsaved, router]
  );

  const closeUnsavedModal = useCallback(() => {
    setUnsavedModalOpen(false);
    setUnsavedModalAction(null);
    setUnsavedModalPayload(null);
  }, []);

  const handleUnsavedModalSave = useCallback(async () => {
    setUnsavedModalSaving(true);
    try {
      await saveCurrentTabRef.current?.();
      markClean(activeTab);
      if (unsavedModalAction === "tab" && unsavedModalPayload) {
        setActiveTab(unsavedModalPayload as TabValue);
        if (unsavedModalPayload === "summary") setSummaryRefreshKey((k) => k + 1);
      } else if (unsavedModalAction === "leave" && unsavedModalPayload) {
        router.push(unsavedModalPayload);
      }
      closeUnsavedModal();
    } finally {
      setUnsavedModalSaving(false);
    }
  }, [activeTab, unsavedModalAction, unsavedModalPayload, router, markClean]);
  const [submitSelfAssessmentSubmitting, setSubmitSelfAssessmentSubmitting] = useState(false);
  const [selfAssessmentCanSubmit, setSelfAssessmentCanSubmit] = useState<boolean | null>(null);
  const [submitForApprovalSubmitting, setSubmitForApprovalSubmitting] = useState(false);
  const [requestChangesModalOpen, setRequestChangesModalOpen] = useState(false);
  const [requestChangesReason, setRequestChangesReason] = useState("");
  const [requestChangesSubmitting, setRequestChangesSubmitting] = useState(false);
  const [managerReviewRecallModalOpen, setManagerReviewRecallModalOpen] = useState(false);
  const [managerReviewSubmitting, setManagerReviewSubmitting] = useState(false);
  const [managerReviewCanSubmit, setManagerReviewCanSubmit] = useState<boolean | null>(null);
  const [summaryTotalPoints, setSummaryTotalPoints] = useState<number>(0);

  const handleSummaryResult = useCallback((result: SummaryResult) => {
    setSummaryTotalPoints(result.totalPoints);
  }, []);

  const isEmployee = currentUserEmployeeId === appraisal.employee_id;
  const isAppraisalManager = isManager;
  const showLeadership = showLeadershipProp ?? appraisal.is_management;
  const testBypass = !readOnly && allowAppraisalTestBypassClient();

  // Troubleshooting: employee / Self Assessment editability
  console.log("[AppraisalTabs] employee check", {
    currentUserEmployeeId,
    appraisalEmployeeId: appraisal.employee_id,
    match: currentUserEmployeeId === appraisal.employee_id,
    isEmployee,
    currentUserLength: currentUserEmployeeId?.length,
    appraisalLength: appraisal.employee_id?.length,
    currentUserJson: JSON.stringify(currentUserEmployeeId),
    appraisalJson: JSON.stringify(appraisal.employee_id),
  });

  const status = ((appraisal.status ?? "DRAFT") as string).toUpperCase() as AppraisalStatus;
  const userRole: WorkflowRole = isHR ? "HR" : isAppraisalManager ? "MANAGER" : isEmployee ? "EMPLOYEE" : "MANAGER";
  const isInProgress = status === "IN_PROGRESS";

  // When employee can submit self-assessment, fetch completion to enable/disable the Submit button
  const showSelfAssessmentSubmit = status === "SELF_ASSESSMENT" && isEmployee;
  useEffect(() => {
    if (!showSelfAssessmentSubmit || !appraisal.id) {
      setSelfAssessmentCanSubmit(null);
      return;
    }
    let cancelled = false;
    const fetchCompletion = () => {
      fetch(`/api/appraisals/${appraisal.id}/completion?showLeadership=${showLeadership ? "true" : "false"}`)
        .then((res) => res.ok ? res.json() : null)
        .then((data) => {
          if (!cancelled && data && typeof data.canSubmit === "boolean") {
            setSelfAssessmentCanSubmit(data.canSubmit);
          } else if (!cancelled) {
            setSelfAssessmentCanSubmit(false);
          }
        })
        .catch(() => { if (!cancelled) setSelfAssessmentCanSubmit(false); });
    };
    fetchCompletion();
    const onInvalidate = () => fetchCompletion();
    window.addEventListener("appraisal-completion-invalidate", onInvalidate);
    return () => {
      cancelled = true;
      window.removeEventListener("appraisal-completion-invalidate", onInvalidate);
    };
  }, [showSelfAssessmentSubmit, appraisal.id, showLeadership]);

  // Listen for completion panel blocker clicks to navigate to tab
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ tabKey: string }>).detail;
      if (detail?.tabKey) handleTabChange(detail.tabKey);
    };
    window.addEventListener("appraisal-navigate-to-tab", handler);
    return () => window.removeEventListener("appraisal-navigate-to-tab", handler);
  }, [handleTabChange]);

  // When DRAFT and employee/manager, fetch full completion so Submit for Approval requires all sections
  const showSubmitForApproval = status === "DRAFT" && (isEmployee || isAppraisalManager);
  const { canSubmit: canSubmitForApproval, blockers: submitForApprovalBlockers } = useDraftSubmitReadiness(
    appraisal.id,
    showSubmitForApproval,
    showLeadership
  );

  // When manager can submit review, fetch completion so Recall/Submit bar can enable/disable the Submit button
  const showManagerReviewActions = status === "MANAGER_REVIEW" && (isAppraisalManager || testBypass);
  useEffect(() => {
    if (!showManagerReviewActions || !appraisal.id) {
      setManagerReviewCanSubmit(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/appraisals/${appraisal.id}/completion?showLeadership=${showLeadership ? "true" : "false"}`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (!cancelled && data && typeof data.canSubmit === "boolean") {
          setManagerReviewCanSubmit(data.canSubmit);
        } else {
          setManagerReviewCanSubmit(false);
        }
      })
      .catch(() => { if (!cancelled) setManagerReviewCanSubmit(false); });
    const onInvalidate = () => fetch(`/api/appraisals/${appraisal.id}/completion?showLeadership=${showLeadership ? "true" : "false"}`)
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data && typeof data.canSubmit === "boolean") setManagerReviewCanSubmit(data.canSubmit);
      });
    window.addEventListener("appraisal-completion-invalidate", onInvalidate);
    return () => {
      cancelled = true;
      window.removeEventListener("appraisal-completion-invalidate", onInvalidate);
    };
  }, [showManagerReviewActions, appraisal.id, showLeadership]);

  const [hasFormalMidyearHistory, setHasFormalMidyearHistory] = useState(false);
  useEffect(() => {
    if (isInProgress || !appraisal.id) {
      setHasFormalMidyearHistory(false);
      return;
    }
    let cancelled = false;
    fetch(`/api/appraisals/${appraisal.id}/checkins`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { checkIns?: { review_mode?: string | null }[] } | null) => {
        if (cancelled) return;
        const list = Array.isArray(data?.checkIns) ? data!.checkIns : [];
        setHasFormalMidyearHistory(list.some((c) => isFormalReviewMode(c.review_mode)));
      })
      .catch(() => { if (!cancelled) setHasFormalMidyearHistory(false); });
    return () => { cancelled = true; };
  }, [isInProgress, appraisal.id]);

  useEffect(() => {
    if (!isInProgress && !hasFormalMidyearHistory && activeTab === "checkins") {
      setActiveTab("workplan");
    }
  }, [isInProgress, hasFormalMidyearHistory, activeTab]);

  const canEditSelfRatings =
    !readOnly &&
    ((status === "SELF_ASSESSMENT" && isEmployee) ||
      canEditField("self_rating", status, userRole) ||
      canEditField("self_comments", status, userRole));
  const canEditManagerRatings =
    !readOnly && (canEditField("manager_rating", status, userRole) || canEditField("manager_comments", status, userRole));
  const effectiveCanEditManagerRatings = canEditManagerRatings || (testBypass && status === "MANAGER_REVIEW");
  const canEditWeights = !readOnly && status === "DRAFT";
  const canEditTechnicalSetup = !readOnly && status === "DRAFT" && (isEmployee || isAppraisalManager || isHR);

  const checkInsLabel = midyearEnabled ? "Reviews & Check-ins" : "Check-ins";
  const tabs: Tab[] = isInProgress
    ? [
        { id: "workplan", label: "Workplan" },
        { id: "checkins", label: checkInsLabel },
      ]
    : [
        { id: "workplan", label: "Workplan" },
        ...(hasFormalMidyearHistory ? [{ id: "checkins" as const, label: checkInsLabel }] : []),
        { id: "core", label: "Core Competencies" },
        { id: "technical", label: "Technical" },
        { id: "productivity", label: "Productivity" },
        ...(showLeadership ? [{ id: "leadership" as const, label: "Leadership" }] : []),
        ...((isHR || isAppraisalManager) && ["MANAGER_REVIEW", "PENDING_SIGNOFF", "HR_REVIEW", "COMPLETE"].includes(status) ? [{ id: "hractions" as const, label: "HR Actions" }] : []),
        { id: "summary", label: "Summary" },
        ...(!readOnly && ((status === "MANAGER_REVIEW" && (isAppraisalManager || isHR)) || status === "PENDING_SIGNOFF" || status === "HR_REVIEW" || status === "COMPLETE") ? [{ id: "signoffs" as const, label: "Sign-offs" }] : []),
        ...(isPrimaryManager ? [{ id: "delegation" as const, label: "Delegation" }] : []),
        ...(readOnly ? [] : [{ id: "audit" as const, label: "Audit trail" }]),
      ];

  const renderContent = () => {
    switch (activeTab) {
      case "workplan":
        return (
          <>
            {!readOnly && status === "SELF_ASSESSMENT" && appraisal.cycleStartDate && appraisal.cycleEndDate && (
              <EvidenceBuilder
                appraisalId={appraisal.id}
                employeeId={appraisal.employee_id}
                reviewStart={appraisal.cycleStartDate}
                reviewEnd={appraisal.cycleEndDate}
                status={appraisal.status}
              />
            )}
            {isInProgress && !readOnly && (
              <p className="text-[12px] text-ds-text-secondary mb-4">Reference only — objectives are locked. Use Check-ins to track progress, then Start Final Review when ready.</p>
            )}
            <WorkplanSection
              appraisalId={appraisal.id}
              appraisalStatus={appraisal.status}
              cyclePhase={cyclePhase}
              isEmployee={isEmployee}
              isManager={isAppraisalManager}
              isHR={isHR}
              oversight={readOnly}
              onDirtyChange={(dirty) => (dirty ? markDirty("workplan") : markClean("workplan"))}
              registerSave={(fn) => { saveCurrentTabRef.current = fn; }}
            />
          </>
        );
      case "core":
        return (
          <CoreCompetenciesSection
            appraisalId={appraisal.id}
            appraisalStatus={status}
            canEditSelfRatings={canEditSelfRatings}
            canEditManagerRatings={effectiveCanEditManagerRatings}
            canEditWeights={canEditWeights}
            onDirtyChange={(dirty) => (dirty ? markDirty("core") : markClean("core"))}
            registerSave={(fn) => { saveCurrentTabRef.current = fn; }}
          />
        );
      case "technical":
        return (
          <TechnicalCompetenciesSection
            appraisalId={appraisal.id}
            appraisalStatus={status}
            canEditSetup={canEditTechnicalSetup}
            canDeleteCompetencies={canEditTechnicalSetup}
            canEditSelfRatings={canEditSelfRatings}
            canEditManagerRatings={effectiveCanEditManagerRatings}
            onDirtyChange={(dirty) => (dirty ? markDirty("technical") : markClean("technical"))}
          />
        );
      case "productivity":
        return (
          <ProductivitySection
            appraisalId={appraisal.id}
            appraisalStatus={status}
            canEditSelfRatings={canEditSelfRatings}
            canEditManagerRatings={effectiveCanEditManagerRatings}
            canEditWeights={canEditWeights}
            onDirtyChange={(dirty) => (dirty ? markDirty("productivity") : markClean("productivity"))}
            registerSave={(fn) => { saveCurrentTabRef.current = fn; }}
          />
        );
      case "leadership":
        return showLeadership ? (
          <LeadershipSection
            appraisalId={appraisal.id}
            appraisalStatus={status}
            canEditSelfRatings={canEditSelfRatings}
            canEditManagerRatings={effectiveCanEditManagerRatings}
            canEditWeights={canEditWeights}
            onDirtyChange={(dirty) => (dirty ? markDirty("leadership") : markClean("leadership"))}
            registerSave={(fn) => { saveCurrentTabRef.current = fn; }}
          />
        ) : null;
      case "summary":
        return (
          <>
          <ScoreSnapshotsPanel appraisalId={appraisal.id} refreshKey={summaryRefreshKey} />
          <SummaryTab
            appraisalId={appraisal.id}
            appraisal={appraisal}
            showLeadership={showLeadership}
            isHR={isHR}
            isManager={isAppraisalManager}
            isEmployee={isEmployee}
            currentUserEmployeeId={currentUserEmployeeId}
            onSummaryResult={handleSummaryResult}
            refreshKey={summaryRefreshKey}
          />
          </>
        );
      case "signoffs":
        return (
          <SignoffsTab
            appraisalId={appraisal.id}
            appraisal={appraisal}
            signoffs={signoffs}
            isEmployee={isEmployee}
            isAppraisalManager={isAppraisalManager}
            isHOD={isHOD}
            isHR={isHR}
            showLeadership={showLeadership}
          />
        );
      case "hractions":
        return (
          <HRActionsTab
            appraisalId={appraisal.id}
            status={status}
            isHR={isHR}
            isManager={isAppraisalManager}
          />
        );
      case "audit":
        return <AuditTrailTab appraisalId={appraisal.id} />;
      case "delegation":
        return <DelegationTab appraisalId={appraisal.id} />;
      case "checkins":
        return (
          <CheckInTab
            appraisalId={appraisal.id}
            isManager={isAppraisalManager}
            isHR={isHR}
            isEmployee={isEmployee}
            testBypass={testBypass}
            readOnly={readOnly || !isInProgress}
          />
        );
      default:
        return null;
    }
  };

  const isPendingApproval = status === "PENDING_APPROVAL";
  const isPendingSignoff = status === "PENDING_SIGNOFF";
  const approvedEmployee = approvals.some((a) => a.role === "EMPLOYEE");
  const approvedManager = approvals.some((a) => a.role === "MANAGER");
  const agreement = appraisal.agreement as { status?: string; employee_signed_at?: string | null; manager_signed_at?: string | null; hr_signed_at?: string | null } | undefined | null;
  const signedEmployee = !!agreement?.employee_signed_at;
  const signedManager = !!agreement?.manager_signed_at;
  const signedHR = !!agreement?.hr_signed_at;
  const allSignoffsComplete = agreement?.status === "SIGNED";
  const managerSignoff = signoffs.find((s) => s.role === "MANAGER");
  const employeeSignoff = signoffs.find((s) => s.role === "EMPLOYEE");
  const canManagerSign = false;
  const canEmployeeSign = false;
  const currentUserRoleForApproval: "EMPLOYEE" | "MANAGER" | null = isEmployee ? "EMPLOYEE" : isAppraisalManager ? "MANAGER" : null;
  const currentUserHasNotApproved = currentUserRoleForApproval && !approvals.some((a) => a.role === currentUserRoleForApproval);
  const currentUserHasNotSigned = false;

  return (
    <div>
      {isDelegated && (
        <div
          className="mb-4 w-full rounded-ds-panel px-4 py-3 text-[13px]"
          style={{
            background: "#f3f3f3",
            borderLeft: "2px solid var(--ds-lavender)",
            color: "#2b2d31",
          }}
        >
          You are managing this appraisal as a delegate for {delegatedByName ?? appraisal.managerName ?? "the manager"}. You have full access to review and action this appraisal.
        </div>
      )}

      {/* Approval panel (PENDING_APPROVAL) */}
      {isPendingApproval && (
        <ApprovalSignoffPanel
          variant="approval"
          appraisalId={appraisal.id}
          statusLabel="Awaiting Workplan Approval"
          subLabel={`${approvedEmployee ? "Employee ✓" : "Employee ○"} · ${approvedManager ? "Manager ✓" : "Manager ○"} — both must approve to proceed`}
          badges={[
            { label: "Employee", done: approvedEmployee },
            { label: "Manager", done: approvedManager },
          ]}
          actionButtonLabel="Approve Workplan"
          showActionButton={!testBypass && !!currentUserHasNotApproved}
          onAction={async () => {
            if (!currentUserRoleForApproval) return;
            const res = await fetch(`/api/appraisals/${appraisal.id}/approve`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ role: currentUserRoleForApproval }),
            });
            const data = await res.json();
            if (res.ok) window.location.reload();
            else alert(data.error || "Failed to approve");
          }}
          requestChangesLabel="Request Changes"
          onRequestChanges={readOnly ? undefined : () => setRequestChangesModalOpen(true)}
          bypassMode={testBypass}
          primaryActionLabel={testBypass ? "Approve as Employee" : undefined}
          primaryActionEnabled={testBypass ? !approvedEmployee : undefined}
          onPrimaryAction={testBypass ? async () => {
            const res = await fetch(`/api/appraisals/${appraisal.id}/approve`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ role: "EMPLOYEE" }),
            });
            const data = await res.json();
            if (res.ok) window.location.reload();
            else alert(data.error || "Failed to approve");
          } : undefined}
          secondaryActionLabel={testBypass ? "Approve as Manager" : undefined}
          secondaryActionEnabled={testBypass ? !!approvedEmployee && !approvedManager : undefined}
          onSecondaryAction={testBypass ? async () => {
            const res = await fetch(`/api/appraisals/${appraisal.id}/approve`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ role: "MANAGER" }),
            });
            const data = await res.json();
            if (res.ok) window.location.reload();
            else alert(data.error || "Failed to approve");
          } : undefined}
        />
      )}

      {/* Unsaved changes confirmation — modal with full-page overlay (replaces browser confirm) */}
      <Dialog open={unsavedModalOpen} onOpenChange={(open) => { if (!open) closeUnsavedModal(); }}>
        <DialogContent className="sm:max-w-[425px]" showClose={false}>
          <DialogHeader>
            <DialogTitle>Unsaved changes</DialogTitle>
            <DialogDescription>
              {unsavedModalAction === "tab"
                ? "You have unsaved changes. Switch tabs without saving?"
                : "You have unsaved changes. Leave without saving?"}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={closeUnsavedModal} disabled={unsavedModalSaving}>
              Cancel
            </Button>
            <Button onClick={() => void handleUnsavedModalSave()} disabled={unsavedModalSaving}>
              {unsavedModalSaving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Request Changes modal (replaces browser prompt) */}
      <Dialog open={requestChangesModalOpen} onOpenChange={(open) => { if (!open) { setRequestChangesModalOpen(false); setRequestChangesReason(""); } }}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Request Changes</DialogTitle>
            <DialogDescription>Provide a reason for requesting revision. The employee will return the workplan to draft.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="request-changes-reason">Reason for revision (optional)</Label>
              <Input
                id="request-changes-reason"
                value={requestChangesReason}
                onChange={(e) => setRequestChangesReason(e.target.value)}
                placeholder="Enter reason..."
                className="w-full"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setRequestChangesModalOpen(false); setRequestChangesReason(""); }}
              disabled={requestChangesSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={async () => {
                setRequestChangesSubmitting(true);
                try {
                  const res = await fetch(`/api/appraisals/${appraisal.id}/request-changes`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ reason: requestChangesReason ?? "" }),
                  });
                  if (res.ok) {
                    setRequestChangesModalOpen(false);
                    setRequestChangesReason("");
                    window.location.reload();
                  } else {
                    const data = await res.json();
                    alert(data.error || "Failed");
                  }
                } finally {
                  setRequestChangesSubmitting(false);
                }
              }}
              disabled={requestChangesSubmitting}
            >
              {requestChangesSubmitting ? "Submitting…" : "OK"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* HR: Mark as Complete (HR_REVIEW) */}
      {status === "HR_REVIEW" && isHR && (
        <div
          style={{
            background: "#f3f3f3",
            border: "1px solid #d0d4d8",
            borderRadius: "8px",
            padding: "16px 24px",
            marginBottom: "20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ fontSize: "14px", fontWeight: 600, color: "#2b2d31" }}>
            HR Review — Review the appraisal and close when complete.
          </div>
          <button
            type="button"
            onClick={async () => {
              const res = await fetch(`/api/appraisals/${appraisal.id}/complete`, { method: "POST" });
              const data = await res.json();
              if (res.ok) window.location.reload();
              else alert(data.error || "Failed");
            }}
            style={{
              padding: "9px 20px",
              borderRadius: "8px",
              background: "#0d0e10",
              border: "none",
              fontSize: "13px",
              fontWeight: 600,
              color: "white",
              cursor: "pointer",
            }}
          >
            Mark as Complete
          </button>
        </div>
      )}

      {/* Adobe Sign strip (PENDING_SIGNOFF): three signers + status */}
      {isPendingSignoff && agreement && agreement.status !== "SIGNED" && (
        <div
          className="flex items-center gap-3 px-5 py-3 bg-ds-warning-subtle border border-ds-warning-border rounded-ds-panel mb-4"
        >
          <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor" style={{ color: "#8a5a00" }} aria-hidden>
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15h2v-6h-2v6zm0-8h2V7h-2v2z" />
          </svg>
          <p className="text-[12px] font-semibold text-ds-warning">Sign-off sent via Adobe Sign</p>
          <p className="text-[11px] text-ds-warning">· Check the Sign-offs tab for status</p>
          <div className="flex items-center gap-1.5 ml-auto">
            {[signedEmployee, signedManager, signedHR].map((signed, i) => (
              <div key={i} className="flex items-center gap-1.5" title={["Employee", "Manager", "HR"][i] + (signed ? " — signed" : " — pending")}>
                <span className={`w-2 h-2 rounded-full ${signed ? "bg-ds-success" : "bg-ds-border"}`} aria-hidden />
              </div>
            ))}
          </div>
        </div>
      )}
      {(status === "PENDING_SIGNOFF" || status === "HR_REVIEW" || status === "COMPLETE") &&
        agreement?.status === "SIGNED" && (
          <div
            className="flex items-center gap-3 px-5 py-3 bg-ds-success-subtle border border-ds-success-border rounded-ds-panel"
            style={{ marginBottom: 12 }}
          >
            <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span className="text-[12px] font-semibold text-ds-success">Sign-off complete · All signatures collected</span>
          </div>
        )}

      {/* Tab bar — flat text tabs, active tab underlined */}
      <div className="mb-4 flex w-full items-center gap-4 shadow-[inset_0_-1px_0_var(--ds-border)]">
        <div className="flex min-w-0 flex-1 items-center gap-5 overflow-x-auto overflow-y-hidden" role="tablist">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => handleTabChange(tab.id)}
                className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 py-2.5 text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ds-focus ${
                  isActive ? "border-ds-accent text-ds-text-primary" : "border-transparent text-ds-text-secondary hover:text-ds-text-primary"
                }`}
              >
                {tab.id === "summary" && (
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${summaryTotalPoints > 0 ? "bg-ds-success" : "bg-ds-text-muted"}`}
                    aria-hidden
                  />
                )}
                {tab.id === "signoffs" && (
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      status !== "PENDING_SIGNOFF" && status !== "HR_REVIEW" && status !== "COMPLETE"
                        ? "bg-ds-text-muted"
                        : allSignoffsComplete
                          ? "bg-ds-success"
                          : "bg-ds-warning"
                    }`}
                    aria-hidden
                  />
                )}
                {tab.id === "hractions" && (
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${hrRecommendationsSaved ? "bg-ds-success" : "bg-ds-warning"}`}
                    aria-hidden
                  />
                )}
                {tab.label}
              </button>
            );
          })}
        </div>
        {hasAnyUnsaved && (
          <div className="flex shrink-0 items-center gap-1.5 rounded-ds-badge border border-ds-warning-border bg-ds-warning-subtle px-1.5 py-0.5" role="status">
            <span className="h-1.5 w-1.5 rounded-full bg-ds-amber" aria-hidden />
            <span className="text-xs font-medium text-ds-warning">Unsaved changes</span>
          </div>
        )}
      </div>

      {/* Submit for Approval — below tabs, visible on all tabs when DRAFT (employee or manager) */}
      {showSubmitForApproval && (
        <SubmitForApprovalAction
          canSubmit={canSubmitForApproval}
          blockers={submitForApprovalBlockers}
          submitting={submitForApprovalSubmitting}
          onSubmit={async () => {
              setSubmitForApprovalSubmitting(true);
              try {
                const res = await fetch(`/api/appraisals/${appraisal.id}/submit-for-approval`, { method: "POST" });
                const data = await res.json();
                if (!res.ok) {
                  if (res.status === 422 && Array.isArray(data.blockers) && data.blockers.length > 0) {
                    window.dispatchEvent(new CustomEvent("appraisal-completion-invalidate"));
                    const msg = [data.error || "Cannot submit for approval — not all sections are complete.", "", ...data.blockers].join("\n");
                    throw new Error(msg);
                  }
                  throw new Error(data.error || "Failed to submit for approval");
                }
                window.location.reload();
              } catch (e) {
                alert(e instanceof Error ? e.message : "Failed to submit for approval");
              } finally {
                setSubmitForApprovalSubmitting(false);
              }
            }}
        />
      )}

      {/* Start Final Review — visible when in IN_PROGRESS (employee only); moves the appraisal to SELF_ASSESSMENT */}
      {isInProgress && isEmployee && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "10px", marginBottom: "16px", flexWrap: "wrap" }}>
          <button
            type="button"
            data-start-final-review
            title={START_FINAL_REVIEW_HELP}
            aria-describedby="start-final-review-help"
            onClick={async () => {
              try {
                const res = await fetch(`/api/appraisals/${appraisal.id}/start-self-assessment`, { method: "POST" });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Failed");
                window.location.reload();
              } catch (e) {
                alert(e instanceof Error ? e.message : "Failed to start self-assessment");
              }
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "7px",
              padding: "9px 20px",
              borderRadius: "8px",
              background: "#0d0e10",
              border: "none",
              fontSize: "13px",
              fontWeight: 600,
              color: "white",
              cursor: "pointer",
              boxShadow: "none",
              transition: "all 0.16s",
            }}
          >
            <SendIcon /> Start Final Review
          </button>
          <span id="start-final-review-help" className="sr-only">
            {START_FINAL_REVIEW_HELP}
          </span>
        </div>
      )}

      {/* Submit Self-Assessment — below tabs, visible on all tabs when in SELF_ASSESSMENT */}
      {status === "SELF_ASSESSMENT" && isEmployee && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "10px", marginBottom: "16px", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={async () => {
              setSubmitSelfAssessmentSubmitting(true);
              try {
                const res = await fetch(`/api/appraisals/${appraisal.id}/submit-self-assessment`, { method: "POST" });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Failed");
                window.location.reload();
              } catch (e) {
                alert(e instanceof Error ? e.message : "Failed to submit");
              } finally {
                setSubmitSelfAssessmentSubmitting(false);
              }
            }}
            disabled={submitSelfAssessmentSubmitting || selfAssessmentCanSubmit !== true}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "7px",
              padding: "9px 20px",
              borderRadius: "8px",
              background: !submitSelfAssessmentSubmitting && selfAssessmentCanSubmit === true ? "#0d0e10" : "#e7e7e7",
              border: "none",
              fontSize: "13px",
              fontWeight: 600,
              color: !submitSelfAssessmentSubmitting && selfAssessmentCanSubmit === true ? "white" : "#646f79",
              cursor: !submitSelfAssessmentSubmitting && selfAssessmentCanSubmit === true ? "pointer" : "not-allowed",
            }}
          >
            <SendIcon /> {submitSelfAssessmentSubmitting ? "Submitting…" : "Submit Self-Assessment"}
          </button>
        </div>
      )}

      {/* Recall Submission + Proceed to Sign-off (the Sign-offs tab carries its own Generate PDF action) */}
      {status === "MANAGER_REVIEW" && (isEmployee || ((isAppraisalManager || testBypass) && activeTab !== "signoffs")) && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "10px", marginBottom: "16px", flexWrap: "wrap" }}>
          {(status === "MANAGER_REVIEW" || status === "SUBMITTED") && isEmployee && (
            <button
              type="button"
              onClick={() => setManagerReviewRecallModalOpen(true)}
              disabled={managerReviewSubmitting}
              style={{
                display: "inline-flex", alignItems: "center", gap: "7px",
                padding: "9px 18px", borderRadius: "8px",
                background: "#fef2f2", border: "1px solid #fbd5d5",
                fontSize: "13px", fontWeight: 600, color: "#b42318", cursor: "pointer",
              }}
            >
              Recall Submission
            </button>
          )}
          {status === "MANAGER_REVIEW" && (isAppraisalManager || testBypass) && activeTab !== "signoffs" && (
              <button
                type="button"
                onClick={() => handleTabChange("signoffs")}
                disabled={managerReviewCanSubmit !== true}
                style={{
                  display: "inline-flex", alignItems: "center", gap: "7px",
                  padding: "9px 20px", borderRadius: "8px",
                  background: managerReviewCanSubmit === true ? "#0d0e10" : "#e7e7e7",
                  border: "none", fontSize: "13px", fontWeight: 600,
                  color: managerReviewCanSubmit === true ? "white" : "#646f79",
                  cursor: managerReviewCanSubmit === true ? "pointer" : "not-allowed",
                }}
              >
                <SendIcon /> Proceed to Sign-off →
              </button>
          )}
        </div>
      )}

      {/* Tab content with animation */}
      <div
        key={activeTab}
        className="w-full"
        style={{ animation: "fadeUp 0.3s ease both" }}
      >
        {renderContent()}
      </div>

      {/* Recall Submission confirmation modal — portaled so overlay covers full screen */}
      {managerReviewRecallModalOpen && typeof document !== "undefined" && createPortal(
        <div style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000 }}>
          <div style={{ background: "white", borderRadius: "8px", width: "100%", maxWidth: "400px", boxShadow: "var(--ds-shadow-dialog)" }}>
            <div style={{ padding: "20px 24px", borderBottom: "1px solid #e7e7e7" }}>
              <h3 style={{ fontFamily: "var(--ds-font-sans)", fontSize: "18px", fontWeight: 600, color: "#0d0d0d", margin: 0 }}>Recall submission?</h3>
              <p style={{ fontSize: "13px", color: "#646f79", marginTop: "8px", marginBottom: 0 }}>You can edit and resubmit.</p>
            </div>
            <div style={{ padding: "16px 24px", display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                type="button"
                onClick={() => setManagerReviewRecallModalOpen(false)}
                style={{
                  padding: "9px 20px",
                  borderRadius: "8px",
                  background: "white",
                  border: "1px solid #e7e7e7",
                  fontSize: "13px",
                  fontWeight: 500,
                  color: "#646f79",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  setManagerReviewRecallModalOpen(false);
                  setManagerReviewSubmitting(true);
                  try {
                    const res = await fetch(`/api/appraisals/${appraisal.id}/recall`, { method: "POST" });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error || "Failed");
                    window.location.reload();
                  } finally {
                    setManagerReviewSubmitting(false);
                  }
                }}
                disabled={managerReviewSubmitting}
                style={{
                  padding: "9px 20px",
                  borderRadius: "8px",
                  background: "#0d0e10",
                  border: "none",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "white",
                  cursor: "pointer",
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
