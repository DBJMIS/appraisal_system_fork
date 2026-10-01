"use client";

import { useEffect, useState } from "react";
import type { CheckInWithResponses, CheckIn, CheckInAccess } from "@/types/checkins";
import { ActiveCheckInCard } from "./ActiveCheckInCard";
import { HistoryCheckInCard } from "./HistoryCheckInCard";
import { NewCheckInModal } from "./NewCheckInModal";
import { MidyearReviewBanner } from "./MidyearReviewBanner";
import { ReopenMidyearDialog } from "./ReopenMidyearDialog";
import { ScoreSnapshotsPanel } from "../ScoreSnapshotsPanel";
import { formalMidyearCreateBody, isFormalReviewMode, type MidyearConfig } from "@/lib/midyear-config";
import {
  MIDYEAR_REVIEW_UPDATED_EVENT,
  pickCurrentFormalReview,
  type MidyearReviewUpdatedDetail,
} from "@/lib/midyear-display";

interface PageData {
  checkIns: CheckInWithResponses[];
  appraisal: {
    id: string;
    employee_id: string;
    manager_employee_id: string | null;
    employeeName: string;
    cycleLabel: string;
    fiscalYear?: string | null;
    status: string;
  };
  workplanItems: Array<{
    id: string;
    major_task: string;
    corporate_objective: string;
    division_objective: string;
    key_output: string;
    weight: number;
    metric_target: number | null;
  }>;
  currentUser: { employee_id: string | null; roles: string[] };
  access?: CheckInAccess;
  midyear?: MidyearConfig;
  ratingScale?: Array<{ code: string; label: string }>;
}

interface CheckInTabProps {
  appraisalId: string;
  isManager: boolean;
  isHR: boolean;
  isEmployee: boolean;
  onStatusChange?: () => void;
  testBypass?: boolean;
  /** After IN_PROGRESS: every check-in is shown as history and nothing can be started or edited. */
  readOnly?: boolean;
}

export function CheckInTab({
  appraisalId,
  isManager,
  isHR,
  isEmployee,
  onStatusChange,
  testBypass = false,
  readOnly = false,
}: CheckInTabProps) {
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [startingMidyear, setStartingMidyear] = useState(false);
  const [startMidyearError, setStartMidyearError] = useState<string | null>(null);
  const [showReopen, setShowReopen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/appraisals/${appraisalId}/checkins`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setData(json);
      if (json.midyear?.enabled && typeof window !== "undefined") {
        const current = pickCurrentFormalReview((json.checkIns ?? []) as CheckIn[]);
        const detail: MidyearReviewUpdatedDetail = {
          appraisalId,
          review: current ? { status: current.status, review_mode: current.review_mode ?? null } : null,
        };
        window.dispatchEvent(new CustomEvent(MIDYEAR_REVIEW_UPDATED_EVENT, { detail }));
      }
      onStatusChange?.();
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [appraisalId]);

  const startMidyear = async () => {
    if (startingMidyear) return;
    setStartingMidyear(true);
    setStartMidyearError(null);
    try {
      const res = await fetch(`/api/appraisals/${appraisalId}/checkins`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formalMidyearCreateBody(data?.midyear)),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Failed to start the Mid-Year Review");
      await load();
    } catch (e) {
      setStartMidyearError(e instanceof Error ? e.message : "Failed to start the Mid-Year Review");
    } finally {
      setStartingMidyear(false);
    }
  };

  const reopenMidyear = async (reason: string): Promise<string | null> => {
    const review = pickCurrentFormalReview(data?.checkIns ?? []);
    if (!review) return "No completed Mid-Year Review to reopen.";
    try {
      const res = await fetch(`/api/appraisals/${appraisalId}/checkins/${review.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "REOPEN", reason }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return json.error || "Failed to reopen the Mid-Year Review";
      await load();
      return null;
    } catch {
      return "Failed to reopen the Mid-Year Review";
    }
  };

  if (loading && !data) {
    return (
      <div className="py-6">
        <p className="text-[13px] text-ds-text-secondary">Loading check-ins…</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="py-6">
        <p className="text-[13px] text-ds-error">Failed to load check-ins.</p>
      </div>
    );
  }

  const { checkIns, appraisal, workplanItems, currentUser, access } = data;
  const currentEmployeeId = currentUser.employee_id ?? null;
  const isThisMyAppraisal = appraisal.employee_id === currentEmployeeId;
  // Delegates are resolved server-side; they act as the manager.
  const isIAmTheManager =
    (appraisal.manager_employee_id != null &&
      appraisal.manager_employee_id === currentEmployeeId) ||
    access?.hasManagerAccess === true;
  const isIAmHR = (currentUser.roles ?? []).includes("hr");
  const workplanApproved = workplanItems.length > 0 || appraisal.status === "IN_PROGRESS";
  // A formal Mid-Year Review stays active until COMPLETE; informal check-ins end at MANAGER_REVIEWED.
  const isActive = (c: CheckInWithResponses) =>
    !readOnly &&
    (c.status === "OPEN" ||
      c.status === "EMPLOYEE_SUBMITTED" ||
      (c.status === "MANAGER_REVIEWED" && isFormalReviewMode(c.review_mode)));
  const activeCheckIns = checkIns.filter(isActive);
  const hasActiveCheckIn = activeCheckIns.length > 0;
  const activeCheckIn = activeCheckIns[0];
  const showManagerViewForBypass =
    testBypass && (activeCheckIn?.status === "EMPLOYEE_SUBMITTED" || activeCheckIn?.status === "MANAGER_REVIEWED");
  // Priority: when testBypass and check-in is EMPLOYEE_SUBMITTED, show manager view so user can complete as manager. Else: employee ownership > manager > HR.
  const role: "MANAGER" | "EMPLOYEE" | "HR" = showManagerViewForBypass
    ? "MANAGER"
    : isThisMyAppraisal
      ? "EMPLOYEE"
      : isIAmTheManager || testBypass
        ? "MANAGER"
          : isIAmHR
          ? "HR"
          : "EMPLOYEE";
  // General appraisal viewers get a read-only formal Mid-Year Review, never the employee inputs.
  const cardRole: "MANAGER" | "EMPLOYEE" | "HR" | "VIEWER" =
    isFormalReviewMode(activeCheckIn?.review_mode) && role === "EMPLOYEE" && !isThisMyAppraisal ? "VIEWER" : role;
  const canCreateCheckin = !readOnly && (isIAmTheManager || isIAmHR || testBypass);
  const pastCheckIns = readOnly
    ? checkIns
    : checkIns.filter(
        (c) => !isActive(c) && (c.status === "COMPLETE" || c.status === "MANAGER_REVIEWED" || c.status === "CANCELLED")
      );
  // A scored review being revised keeps its earlier score revisions visible.
  const scoredMidyearComplete = checkIns.some(
    (c) => c.review_mode === "FORMAL_SCORED" && (c.status === "COMPLETE" || (c.midyear_revisions?.length ?? 0) > 0)
  );
  // Must stay in line with canInitiateFormal on the server; the employee never gets the Start action.
  const formalMidyearExists = checkIns.some((c) => isFormalReviewMode(c.review_mode) && c.status !== "CANCELLED");
  const canStartMidyear =
    !readOnly &&
    appraisal.status === "IN_PROGRESS" &&
    data.midyear?.enabled === true &&
    !isThisMyAppraisal &&
    (isIAmTheManager || isIAmHR || access?.isHrAdmin === true || testBypass) &&
    !formalMidyearExists;
  const startMidyearBlockedReason = hasActiveCheckIn ? "Complete or cancel the current check-in first." : null;
  const currentFormal = pickCurrentFormalReview(checkIns);
  const scoreRevisionKey = `${currentFormal?.status ?? ""}:${currentFormal?.midyear_revisions?.length ?? 0}`;
  // Must stay in line with the REOPEN rule on the server: HR or admin only, never the employee.
  const canReopenMidyear =
    !readOnly &&
    appraisal.status === "IN_PROGRESS" &&
    access?.isHrAdmin === true &&
    !isThisMyAppraisal &&
    currentFormal?.status === "COMPLETE";
  const completedCount = pastCheckIns.length;

  return (
    <div className="py-4">
      {!readOnly && !workplanApproved && (
        <div className="flex items-center gap-3 px-4 py-3 bg-ds-warning-subtle border border-ds-warning-border rounded-ds-panel mb-4">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#8a5a00" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p className="text-[12px] text-ds-warning">
            Check-ins are available once the workplan has been approved by the manager.
          </p>
        </div>
      )}

      {data.midyear?.enabled && (
        <MidyearReviewBanner
          midyear={data.midyear}
          fiscalYear={appraisal.fiscalYear ?? null}
          checkIns={checkIns}
          {...(canStartMidyear
            ? {
                onStart: startMidyear,
                starting: startingMidyear,
                startBlockedReason: startMidyearBlockedReason,
                startError: startMidyearError,
              }
            : {})}
          {...(canReopenMidyear ? { onReopen: () => setShowReopen(true) } : {})}
        />
      )}

      {canReopenMidyear && (
        <ReopenMidyearDialog open={showReopen} onOpenChange={setShowReopen} onConfirm={reopenMidyear} />
      )}

      {scoredMidyearComplete && <ScoreSnapshotsPanel key={scoreRevisionKey} appraisalId={appraisalId} />}

      {readOnly && (
        <p data-checkins-readonly className="text-[12px] text-ds-text-secondary mb-3">
          Check-ins are read-only once the appraisal has moved past the in-progress stage.
        </p>
      )}

      {hasActiveCheckIn && (
        <ActiveCheckInCard
          appraisalId={appraisalId}
          checkIn={activeCheckIns[0]}
          appraisal={appraisal}
          currentUser={currentUser}
          role={cardRole}
          onUpdate={load}
          ratingScale={data.ratingScale}
        />
      )}

      <div className="flex items-center justify-between mt-6 mb-3">
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[.07em] text-ds-text-secondary">
            Past check-ins
          </p>
          {completedCount > 0 && (
            <span className="text-[10px] text-ds-text-secondary">· {completedCount}</span>
          )}
        </div>
        {canCreateCheckin && !hasActiveCheckIn && (
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-[8px] bg-ds-text-primary text-white text-[11px] font-semibold hover:bg-ds-accent-hover transition-colors"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New check-in
          </button>
        )}
        {canCreateCheckin && hasActiveCheckIn && (
          <span className="text-[11px] text-ds-text-secondary">
            Complete the current check-in before starting a new one
          </span>
        )}
      </div>

      {pastCheckIns.length > 0 ? (
        <div className="space-y-2">
          {pastCheckIns.map((c) => (
            <HistoryCheckInCard key={c.id} checkIn={c} ratingScale={data.ratingScale} />
          ))}
        </div>
      ) : (
        !hasActiveCheckIn && (
          <div
            className="flex flex-col items-center py-12 gap-3 border border-ds-border rounded-ds-panel bg-white"
            style={{ boxShadow: "none" }}
          >
            <div className="w-10 h-10 rounded-ds-panel bg-ds-surface border border-ds-border flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#646f79" strokeWidth="1.5">
                <path d="M9 11l3 3L22 4" />
                <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
              </svg>
            </div>
            <p className="text-[13px] font-semibold text-ds-text-primary">No check-ins this year</p>
            <p className="text-[12px] text-ds-text-secondary text-center max-w-[280px]">
              {readOnly
                ? "No check-ins were recorded during the in-progress stage"
                : canCreateCheckin
                ? "Use the button above to initiate a check-in"
                : "Managers can initiate a check-in at any time during the in-progress stage"}
            </p>
          </div>
        )
      )}

      {showModal && (
        <NewCheckInModal
          appraisalId={appraisalId}
          employeeName={appraisal.employeeName}
          cycleLabel={appraisal.cycleLabel}
          workplanItems={workplanItems}
          midyear={data.midyear}
          fiscalYear={appraisal.fiscalYear ?? null}
          formalMidyearExists={formalMidyearExists}
          onCreated={(checkIn: CheckIn) => {
            load();
            setShowModal(false);
          }}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}
