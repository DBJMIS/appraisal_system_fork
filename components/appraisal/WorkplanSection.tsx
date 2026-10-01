"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { createPortal } from "react-dom";
import { calcMetricPercentage, calcMgrResult, getDateVariance, type MetricType, type WorkplanMetricItem } from "@/lib/metric-calc";
import { cn } from "@/utils/cn";
import { allowAppraisalTestBypassClient } from "@/lib/appraisal-test-bypass";
import { MetricTypePicker } from "@/components/appraisal/MetricTypePicker";
import { EvidenceBadge } from "@/components/appraisal/workplan/EvidenceBadge";
import { EvidenceModal } from "@/components/appraisal/workplan/EvidenceModal";
import { WorkplanUploadModal } from "@/components/appraisal/workplan/WorkplanUploadModal";
import { MidyearResultValue, MidyearScoreLine, useMidyearFinalReviewContext } from "@/components/appraisal/workplan/MidyearFinalReviewContext";
import { MIDYEAR_BUTTON, MidyearLastSaved } from "@/components/appraisal/checkins/MidyearReviewWorkspace";
import { DRAFT_SAVED_MS } from "@/hooks/useDraftSaveFeedback";
import { NumericDraftInput } from "@/components/appraisal/workplan/NumericDraftInput";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { missingWorkplanItemFields } from "@/lib/appraisal-completion";
import { Search, ChevronRight, Building2, Layers, Briefcase, Copy } from "lucide-react";

export interface PickerObjective {
  id: string;
  type: "CORPORATE" | "DIVISIONAL";
  title: string;
  division?: string;
  external_id: string;
  corporate_objective_id?: string;
  /** Parent corporate's achieveit_id; use for filtering when present */
  parent_external_id?: string;
}

export interface WorkplanItemRow extends WorkplanMetricItem {
  id: string;
  workplan_id: string;
  corporate_objective: string;
  division_objective: string;
  corporate?: { id: string; title: string; external_id: string } | null;
  divisional?: { id: string; title: string; external_id: string; division?: string } | null;
  individual_objective: string;
  major_task: string;
  key_output: string;
  performance_standard: string;
  weight: number;
  actual_result: number | null;
  points: number | null;
}

interface WorkplanData {
  id: string;
  status: string;
  locked_at: string | null;
  submitted_at: string | null;
  rejection_reason: string | null;
  imported_from_file?: string | null;
  imported_sheet?: string | null;
}

const BLANK_ROW = (workplan_id: string): Omit<WorkplanItemRow, "id"> => ({
  workplan_id,
  corporate_objective: "",
  division_objective: "",
  corporate: null,
  divisional: null,
  individual_objective: "",
  major_task: "",
  key_output: "",
  performance_standard: "",
  weight: 0,
  actual_result: null,
  points: null,
  metric_type: "PERCENT",
  metric_target: null,
  metric_deadline: null,
  metric_actual_raw: null,
  metric_completion_date: null,
  mgr_actual_raw: null,
  mgr_completion_date: null,
  mgr_result: null,
});

function calculatePoints(weight: number, actualYTD: number | null | undefined): number | null {
  if (actualYTD === null || actualYTD === undefined || Number.isNaN(actualYTD)) return null;
  return Math.round((actualYTD / 100) * weight * 10) / 10;
}

function getGradeThresholds(weight: number) {
  return {
    A: Math.round(weight * 1.0 * 10) / 10,
    B: Math.round(weight * 0.8 * 10) / 10,
    C: Math.round(weight * 0.6 * 10) / 10,
    D: Math.round(weight * 0.4 * 10) / 10,
    E: Math.round(weight * 0.2 * 10) / 10,
  };
}

function getTotalPoints(items: WorkplanItemRow[]): number {
  return items.reduce((sum, item) => sum + (item.points ?? calculatePoints(item.weight, item.actual_result) ?? 0), 0);
}

const gradeColors: Record<string, { bg: string; text: string }> = {
  A: { bg: "#ecfdf5", text: "#2e7d4f" },
  B: { bg: "#f3f3f3", text: "#3d5a78" },
  C: { bg: "#fffbeb", text: "#8a5a00" },
  D: { bg: "#f1f4f7", text: "#3d5a78" },
  E: { bg: "#fef2f2", text: "#b42318" },
};

function nextNewId() {
  return `new-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

interface WorkplanSectionProps {
  appraisalId: string;
  appraisalStatus: string;
  cyclePhase: string;
  isEmployee: boolean;
  isManager: boolean;
  isHR: boolean;
  /** Optional: notify parent when dirty state changes (for tab navigation guard). */
  onDirtyChange?: (dirty: boolean) => void;
  /** Optional: register save function for parent (e.g. unsaved-changes modal Save). */
  registerSave?: (save: (() => Promise<void>) | null) => void;
  /** Read-only oversight by a manager higher in the reporting line: no editing, no exports. */
  oversight?: boolean;
}

const PlusIcon = () => (
  <svg style={{ width: 14, height: 14 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const SaveIcon = () => (
  <svg style={{ width: 14, height: 14 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <polyline points="17 21 17 13 7 13 7 21" />
    <polyline points="7 3 7 8 15 8" />
  </svg>
);

const SendIcon = () => (
  <svg style={{ width: 14, height: 14 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

const CheckIcon = () => (
  <svg style={{ width: 14, height: 14 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const XIcon = () => (
  <svg style={{ width: 14, height: 14 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const TrashIcon = () => (
  <svg style={{ width: 14, height: 14, display: "block" }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

const ChevronRightIcon = () => (
  <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const ClipboardIcon = () => (
  <svg style={{ width: 16, height: 16 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
  </svg>
);

const LockIcon = () => (
  <svg style={{ width: 16, height: 16 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

const AlertIcon = () => (
  <svg style={{ width: 16, height: 16 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const ClockIcon = () => (
  <svg style={{ width: 16, height: 16 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const TYPE_CONFIG: Record<MetricType, { icon: string; label: string; bg: string; border: string; text: string }> = {
  NUMBER: { icon: "🔢", label: "Number", bg: "bg-ds-info-subtle", border: "border-ds-info-border", text: "text-ds-info" },
  DATE: { icon: "📅", label: "Date", bg: "bg-ds-info-subtle", border: "border-ds-info-border", text: "text-ds-info" },
  PERCENT: { icon: "%", label: "Percent", bg: "bg-ds-success-subtle", border: "border-ds-success-border", text: "text-ds-success" },
};

const inputBase = [
  "border-[1.5px] rounded-lg outline-none transition-all duration-150",
  'font-sans text-[13px] font-semibold',
  "placeholder:text-ds-text-secondary placeholder:font-normal",
].join(" ");

function formatDeadline(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

function getResultPillStyle(percent: number | null | undefined): { bg: string; text: string; border: string } {
  if (percent == null) return { bg: "transparent", text: "#646f79", border: "1px dashed #d0d4d8" };
  if (percent >= 95) return { bg: "#ecfdf5", text: "#2e7d4f", border: "1px solid #bbf0d9" };
  if (percent >= 80) return { bg: "#f3f3f3", text: "#3d5a78", border: "1px solid #d0d4d8" };
  if (percent >= 60) return { bg: "#fffbeb", text: "#8a5a00", border: "1px solid #fbe3a1" };
  return { bg: "#fef2f2", text: "#b42318", border: "1px solid #fbd5d5" };
}

function VarianceBadge({ emp, mgr, type }: { emp: number | string; mgr: number | string; type: string }) {
  if (type === "DATE") {
    const same = emp === mgr;
    return same ? (
      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-ds-badge bg-ds-success-subtle border border-ds-success-border text-ds-success">✓ Same</span>
    ) : (
      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-ds-badge bg-ds-error-subtle border border-ds-error-border text-ds-error">Changed</span>
    );
  }
  const diff = (mgr as number) - (emp as number);
  if (Math.abs(diff) < 0.01) {
    return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-ds-badge bg-ds-success-subtle border border-ds-success-border text-ds-success">✓ Agrees</span>;
  }
  const sign = diff > 0 ? "+" : "";
  return (
    <span
      className={cn(
        "text-[10px] font-semibold px-2 py-0.5 rounded-ds-badge border",
        diff > 0 ? "bg-ds-success-subtle border-ds-success-border text-ds-success" : "bg-ds-error-subtle border-ds-error-border text-ds-error"
      )}
    >
      {sign}
      {type === "NUMBER" ? Math.round(diff) : (diff as number).toFixed(1)}
    </span>
  );
}

const mgrInputBase = [
  "rounded-[6px] border-[1.5px] py-1 outline-none transition-all text-[12px] font-semibold",
  "focus:ring-2",
].join(" ");

function MgrActualInput({
  item,
  value,
  onChange,
  isChanged,
  isConfirmed,
  isDate,
}: {
  item: WorkplanItemRow;
  value: number | string | null;
  onChange: (v: number | string | null) => void;
  isChanged: boolean;
  isConfirmed: boolean;
  isDate: boolean;
}) {
  if (isDate) {
    return (
      <input
        type="date"
        className={cn(
          "text-[11px] px-2 w-[130px]",
          mgrInputBase,
          isChanged && "border-ds-warning-border bg-ds-warning-subtle focus:ring-ds-warning-border",
          isConfirmed && "border-ds-success-border bg-ds-success-subtle",
          !isChanged && !isConfirmed && "border-ds-info-border bg-ds-info-subtle focus:border-ds-info focus:ring-ds-info-border"
        )}
        value={value ?? item.metric_completion_date ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
      />
    );
  }
  const isPercent = (item.metric_type ?? "PERCENT") === "PERCENT";
  if (isPercent) {
    return (
      <div className="relative">
        <NumericDraftInput
          step={0.1}
          min={0}
          max={100}
          showRangeHint={false}
          aria-label="Manager Actual YTD"
          data-mgr-actual
          className={cn(
            "w-16 text-center pr-5 pl-2",
            mgrInputBase,
            isChanged && "border-ds-warning-border bg-ds-warning-subtle focus:ring-ds-warning-border",
            isConfirmed && "border-ds-success-border bg-ds-success-subtle",
            !isChanged && !isConfirmed && "border-ds-info-border bg-ds-info-subtle focus:border-ds-info focus:ring-ds-info-border"
          )}
          value={value == null ? item.metric_actual_raw : Number(value)}
          onValueChange={onChange}
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-ds-text-secondary pointer-events-none">%</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <NumericDraftInput
        min={0}
        max={item.metric_target ?? undefined}
        showRangeHint={false}
        aria-label="Manager Actual YTD"
        data-mgr-actual
        className={cn(
          "w-10 text-center px-1.5",
          mgrInputBase,
          isChanged && "border-ds-warning-border bg-ds-warning-subtle focus:ring-ds-warning-border",
          isConfirmed && "border-ds-success-border bg-ds-success-subtle",
          !isChanged && !isConfirmed && "border-ds-info-border bg-ds-info-subtle focus:border-ds-info focus:ring-ds-info-border"
        )}
        value={value == null ? item.metric_actual_raw : Number(value)}
        onValueChange={onChange}
      />
      <span className="text-[11px] text-ds-text-secondary">/ {item.metric_target ?? "—"}</span>
    </div>
  );
}

function empDisplayValue(row: WorkplanItemRow): string {
  const type = row.metric_type ?? "PERCENT";
  if (type === "NUMBER") return `${row.metric_actual_raw ?? "—"} / ${row.metric_target ?? "—"}`;
  if (type === "DATE") return row.metric_completion_date ? formatDeadline(row.metric_completion_date) : "—";
  return `${row.metric_actual_raw ?? row.actual_result ?? "—"}%`;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  margin: 0,
  padding: "7px 10px",
  borderRadius: "6px",
  border: "1px solid #8b949e",
  fontSize: "13px",
  color: "#0d0d0d",
  background: "white",
  outline: "none",
  transition: "border-color 0.15s, box-shadow 0.15s",
  minWidth: "100px",
  boxSizing: "border-box",
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  minHeight: "56px",
  resize: "vertical",
  lineHeight: 1.45,
  fontFamily: "inherit",
};

const thStyle: React.CSSProperties = {
  boxSizing: "border-box",
  margin: 0,
  padding: "10px 12px",
  textAlign: "left",
  fontSize: "10.5px",
  fontWeight: 600,
  letterSpacing: "0.07em",
  textTransform: "uppercase",
  color: "#646f79",
  background: "#f3f3f3",
  borderBottom: "1px solid #e7e7e7",
  whiteSpace: "nowrap",
  verticalAlign: "top",
};

const tdStyle: React.CSSProperties = {
  boxSizing: "border-box",
  margin: 0,
  padding: "10px 12px",
  fontSize: "13px",
  verticalAlign: "top",
  borderBottom: "1px solid #e7e7e7",
};

const RequiredMark = () => (
  <span title="Required" aria-label="required" data-required-mark style={{ color: "#b42318", marginLeft: "3px" }}>*</span>
);

/** Row hint for the planning structure the completion check requires (same rule, via missingWorkplanItemFields). */
function IncompleteRowHint({ row }: { row: WorkplanItemRow }) {
  const missing = missingWorkplanItemFields(row);
  if (missing.length === 0) return null;
  return (
    <div
      data-workplan-row-incomplete
      style={{ display: "flex", alignItems: "center", gap: "4px", marginTop: "4px", fontSize: "11px", color: "#8a5a00" }}
    >
      <span style={{ color: "#8a5a00", display: "inline-flex", transform: "scale(0.75)" }}><AlertIcon /></span>
      Incomplete: {missing.join(", ")} required
    </div>
  );
}

export function WorkplanSection({
  appraisalId,
  appraisalStatus,
  cyclePhase,
  isEmployee,
  isManager,
  isHR,
  onDirtyChange,
  registerSave,
  oversight = false,
}: WorkplanSectionProps) {
  const [isDirty, setIsDirty] = useState(false);
  useUnsavedChanges(isDirty);

  const [workplan, setWorkplan] = useState<WorkplanData | null>(null);
  const [items, setItems] = useState<WorkplanItemRow[]>([]);
  const [idsToDelete, setIdsToDelete] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [approving, setApproving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [typePickerItemId, setTypePickerItemId] = useState<string | null>(null);
  const [expandedObjective, setExpandedObjective] = useState<Record<string, boolean>>({});
  const [picker, setPicker] = useState<{ open: boolean; field: "corporate" | "divisional" | null; rowId: string | null }>({ open: false, field: null, rowId: null });
  const [pickerSearch, setPickerSearch] = useState("");
  const [objectives, setObjectives] = useState<PickerObjective[]>([]);
  const [dismissedWeightAlert, setDismissedWeightAlert] = useState(false);
  const [dismissedRequiredFieldAlert, setDismissedRequiredFieldAlert] = useState(false);
  const [evidenceCounts, setEvidenceCounts] = useState<Record<string, number>>({});
  const [activeEvidenceItem, setActiveEvidenceItem] = useState<WorkplanItemRow | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);

  const toggleExpand = useCallback((id: string) => {
    setExpandedObjective((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const status = (appraisalStatus ?? "DRAFT").toUpperCase();
  const isLocked = workplan?.locked_at != null;

  // 9-phase workflow: in DRAFT both employee and manager can edit planning (objectives, etc.)
  const canEditPlanningFields = status === "DRAFT" && (isEmployee || isManager) && !isLocked;

  // Actual YTD only in SELF_ASSESSMENT by employee
  const canEditActualResults = status === "SELF_ASSESSMENT" && isEmployee;

  const testBypass = !oversight && allowAppraisalTestBypassClient();
  // Manager can enter/override Actual YTD (and thus points) during MANAGER_REVIEW
  const canEditManagerWorkplanRatings = status === "MANAGER_REVIEW" && (isManager || testBypass);

  // Submit workplan for approval: DRAFT → PENDING_APPROVAL (employee or manager)
  const canSubmitForApproval = status === "DRAFT" && (isEmployee || isManager) && !isLocked;

  // Approval panel (PENDING_APPROVAL) is shown above tabs; no approve buttons here
  const canApproveWorkplan = false;

  // Show actual results from SELF_ASSESSMENT onward
  const showActualResults = ["SELF_ASSESSMENT", "SUBMITTED", "MANAGER_REVIEW", "PENDING_SIGNOFF", "HR_REVIEW", "COMPLETE"].includes(status);
  const showTargetColumn = canEditPlanningFields || showActualResults || status === "IN_PROGRESS";
  const midyearContext = useMidyearFinalReviewContext(appraisalId, showActualResults);
  const showMidyearColumn = showActualResults && midyearContext != null;
  const canSaveAssessment = canEditActualResults || canEditManagerWorkplanRatings;
  const [assessmentJustSaved, setAssessmentJustSaved] = useState(false);
  const [assessmentLastSavedAt, setAssessmentLastSavedAt] = useState<number | null>(null);

  const isPlanningPhase = status === "DRAFT" || status === "PENDING_APPROVAL";
  const canSubmitSelfAssessment = status === "SELF_ASSESSMENT" && isEmployee;
  const canRaiseDispute = status === "PENDING_SIGNOFF" && isEmployee;

  const readOnly = !canEditPlanningFields && !canEditActualResults && !canEditManagerWorkplanRatings;

  const loadWorkplan = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/appraisals/${appraisalId}/workplan`);
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to load workplan");
        setLoading(false);
        return;
      }

      setWorkplan(
        data.workplan
          ? {
              id: data.workplan.id,
              status: data.workplan.status ?? "draft",
              locked_at: data.workplan.locked_at,
              submitted_at: data.workplan.submitted_at,
              rejection_reason: data.workplan.rejection_reason,
              imported_from_file: data.workplan.imported_from_file ?? null,
              imported_sheet: data.workplan.imported_sheet ?? null,
            }
          : null
      );

      const mapped: WorkplanItemRow[] = (data.items ?? []).map((r: Record<string, unknown>) => {
        const weight = Number(r.weight) || 0;
        const actualYTD = r.actual_result != null && r.actual_result !== "" ? Number(r.actual_result) : null;
        const metricType = (r.metric_type as MetricType) ?? "PERCENT";
        const metricTarget = r.metric_target != null ? Number(r.metric_target) : null;
        const metricDeadline = r.metric_deadline != null && r.metric_deadline !== "" ? String(r.metric_deadline) : null;
        let metricActualRaw = r.metric_actual_raw != null && r.metric_actual_raw !== "" ? Number(r.metric_actual_raw) : null;
        const metricCompletionDate = r.metric_completion_date != null && r.metric_completion_date !== "" ? String(r.metric_completion_date) : null;
        if (metricType === "PERCENT" && metricActualRaw == null && actualYTD != null) metricActualRaw = actualYTD;
        const points = r.points != null ? Number(r.points) : calculatePoints(weight, actualYTD);
        const mgrActualRaw = r.mgr_actual_raw != null && r.mgr_actual_raw !== "" ? Number(r.mgr_actual_raw) : null;
        const mgrCompletionDate = r.mgr_completion_date != null && r.mgr_completion_date !== "" ? String(r.mgr_completion_date) : null;
        const mgrResult = r.mgr_result != null && r.mgr_result !== "" ? Number(r.mgr_result) : null;
        const corpId = r.corporate_objective_id as string | undefined;
        const corpTitle = r.corporate_title as string | undefined;
        const corpEid = r.corporate_external_id as string | undefined;
        const divId = r.divisional_objective_id as string | undefined;
        const divTitle = r.divisional_title as string | undefined;
        const divEid = r.divisional_external_id as string | undefined;
        const divDivision = r.divisional_division as string | undefined;
        return {
          id: r.id,
          workplan_id: r.workplan_id,
          corporate_objective: (r.corporate_objective ?? corpTitle ?? "") as string,
          division_objective: (r.division_objective ?? divTitle ?? "") as string,
          corporate: corpId && (corpTitle != null || corpEid != null) ? { id: corpId, title: corpTitle ?? "", external_id: corpEid ?? "" } : null,
          divisional: divId && (divTitle != null || divEid != null) ? { id: divId, title: divTitle ?? "", external_id: divEid ?? "", division: divDivision } : null,
          individual_objective: (r.individual_objective ?? "") as string,
          major_task: (r.major_task ?? r.task ?? "") as string,
          key_output: (r.key_output ?? r.output ?? "") as string,
          performance_standard: (r.performance_standard ?? "") as string,
          weight,
          actual_result: actualYTD,
          points,
          metric_type: metricType,
          metric_target: metricTarget,
          metric_deadline: metricDeadline,
          metric_actual_raw: metricActualRaw,
          metric_completion_date: metricCompletionDate,
          mgr_actual_raw: mgrActualRaw,
          mgr_completion_date: mgrCompletionDate,
          mgr_result: mgrResult,
        };
      });

      setItems(mapped);
      setIdsToDelete([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workplan");
    } finally {
      setLoading(false);
    }
  }, [appraisalId]);

  const handleDownloadExcel = useCallback(async () => {
    setExportingExcel(true);
    try {
      const res = await fetch(`/api/appraisals/${appraisalId}/workplan/export-excel`);
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error || "Failed to download workplan");
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = /filename="([^"]+)"/i.exec(disposition);
      const filename = match?.[1] ?? "workplan.xlsx";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to download workplan");
    } finally {
      setExportingExcel(false);
    }
  }, [appraisalId]);

  useEffect(() => {
    loadWorkplan();
  }, [loadWorkplan]);

  const hasItems = items.length > 0;
  const fetchEvidenceCounts = useCallback(async () => {
    if (!appraisalId || !hasItems) return;
    try {
      const res = await fetch(`/api/appraisals/${appraisalId}/workplan/evidence-counts`);
      if (!res.ok) return;
      const data = (await res.json()) as { counts?: Record<string, number> };
      setEvidenceCounts(data.counts ?? {});
    } catch {
      /* counts are informational only */
    }
  }, [appraisalId, hasItems]);

  useEffect(() => {
    fetchEvidenceCounts();
  }, [fetchEvidenceCounts]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/appraisals/${appraisalId}/objectives`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (Array.isArray(data) && !cancelled) setObjectives(data);
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, [appraisalId]);

  const addRow = useCallback(() => {
    if (!workplan?.id || !canEditPlanningFields) return;
    setItems((prev) => [
      ...prev,
      { ...BLANK_ROW(workplan.id), id: nextNewId() } as WorkplanItemRow,
    ]);
    setIsDirty(true);
    onDirtyChange?.(true);
  }, [workplan?.id, canEditPlanningFields, onDirtyChange]);

  const updateRow = useCallback(
    (id: string, field: keyof WorkplanItemRow, value: string | number | null | { id: string; title: string; external_id: string; division?: string }) => {
      const planningFields = ["corporate_objective", "division_objective", "individual_objective", "major_task", "key_output", "performance_standard", "weight", "metric_type", "metric_target", "metric_deadline"];
      const actualFields = ["actual_result", "metric_actual_raw", "metric_completion_date"];
      const managerFields = ["mgr_actual_raw", "mgr_completion_date"];
      if (field === "corporate" || field === "divisional") {
        if (!canEditPlanningFields) return;
        setItems((prev) =>
          prev.map((row) => {
            if (row.id !== id) return row;
            const next = { ...row } as WorkplanItemRow;
            if (field === "corporate") {
              next.corporate = value && typeof value === "object" && "id" in value ? { id: value.id, title: value.title, external_id: value.external_id } : null;
              next.corporate_objective = next.corporate?.title ?? "";
            } else {
              next.divisional = value && typeof value === "object" && "id" in value ? { id: value.id, title: value.title, external_id: value.external_id, division: value.division } : null;
              next.division_objective = next.divisional?.title ?? "";
            }
            return next;
          })
        );
        setIsDirty(true);
        onDirtyChange?.(true);
        return;
      }
      if (planningFields.includes(field) && !canEditPlanningFields) return;
      if (field === "actual_result" && !canEditActualResults && !canEditManagerWorkplanRatings) return;
      if ((field === "metric_actual_raw" || field === "metric_completion_date") && !canEditActualResults && !canEditManagerWorkplanRatings) return;
      if (managerFields.includes(field) && !canEditManagerWorkplanRatings) return;
      const val = value as string | number | null;
      setItems((prev) =>
        prev.map((row) => {
          if (row.id !== id) return row;
          const next = { ...row, [field]: val } as WorkplanItemRow;
          const w = next.weight;
          if (field === "actual_result" && (next.metric_type ?? "PERCENT") === "PERCENT") {
            next.metric_actual_raw = val != null && val !== "" ? Number(val) : null;
          }
          if (field === "weight" || field === "actual_result" || planningFields.includes(field) || actualFields.includes(field)) {
            const computed = calcMetricPercentage(next);
            if (computed == null && field === "metric_actual_raw" && val == null) {
              next.actual_result = null;
              next.points = null;
            } else if (computed != null) {
              next.actual_result = computed;
              next.points = calculatePoints(w, computed);
            } else if (field === "actual_result") {
              const ytd = val != null && val !== "" ? Number(val) : null;
              next.actual_result = ytd;
              next.points = calculatePoints(w, ytd);
              if (next.metric_type === "PERCENT") next.metric_actual_raw = ytd;
            } else if (field === "weight") {
              next.points = calculatePoints(typeof val === "number" ? val : Number(val) || 0, row.actual_result);
            } else {
              next.points = calculatePoints(w, next.actual_result);
            }
          }
          if (managerFields.includes(field)) {
            const mgrResult = calcMgrResult(next);
            next.mgr_result = mgrResult ?? null;
          }
          return next;
        })
      );
    setIsDirty(true);
    onDirtyChange?.(true);
    },
    [canEditPlanningFields, canEditActualResults, canEditManagerWorkplanRatings, onDirtyChange]
  );

  const selectObjective = useCallback(
    (obj: PickerObjective) => {
      if (!picker.rowId || !picker.field) return;
      const objDisplay = picker.field === "corporate" ? { id: obj.id, title: obj.title, external_id: obj.external_id } : { id: obj.id, title: obj.title, external_id: obj.external_id, division: obj.division };
      updateRow(picker.rowId, picker.field, objDisplay);
      setPicker({ open: false, field: null, rowId: null });
    },
    [picker.rowId, picker.field, updateRow]
  );

  const clearObjective = useCallback((rowId: string, field: "corporate" | "divisional") => {
    updateRow(rowId, field, null);
  }, [updateRow]);

  const openPicker = useCallback((rowId: string, field: "corporate" | "divisional") => {
    setPicker({ open: true, field, rowId });
    setPickerSearch("");
  }, []);

  const closePicker = useCallback(() => {
    setPicker({ open: false, field: null, rowId: null });
  }, []);

  const filtered = useMemo(() => {
    if (!objectives.length || !picker.field) return [];
    const type = picker.field === "corporate" ? "CORPORATE" : "DIVISIONAL";
    const currentRow = picker.rowId ? items.find((r) => r.id === picker.rowId) : null;
    const q = pickerSearch.toLowerCase().trim();
    return objectives.filter((obj) => {
      if (obj.type !== type) return false;
      if (picker.field === "divisional" && currentRow?.corporate) {
        if (obj.parent_external_id != null) {
          if (obj.parent_external_id !== currentRow.corporate.external_id) return false;
        } else if (obj.corporate_objective_id !== currentRow.corporate.id) {
          return false;
        }
      }
      if (!q) return true;
      return (
        obj.title.toLowerCase().includes(q) ||
        (obj.external_id?.toLowerCase().includes(q)) ||
        (obj.division?.toLowerCase().includes(q))
      );
    });
  }, [objectives, picker.field, picker.rowId, pickerSearch, items]);

  const deleteRow = useCallback((id: string) => {
    if (!canEditPlanningFields) return;
    setItems((prev) => prev.filter((r) => r.id !== id));
    if (!id.startsWith("new-")) {
      setIdsToDelete((prev) => [...prev, id]);
    }
    setIsDirty(true);
    onDirtyChange?.(true);
  }, [canEditPlanningFields, onDirtyChange]);

  const duplicateRow = useCallback((id: string) => {
    if (!canEditPlanningFields) return;
    setItems((prev) => {
      const index = prev.findIndex((r) => r.id === id);
      if (index === -1) return prev;
      const original = prev[index];
      const copy: WorkplanItemRow = {
        ...original,
        id: nextNewId(),
        weight: 0,
        points: null,
      };
      const updated = [...prev];
      updated.splice(index + 1, 0, copy);
      return updated;
    });
    setIsDirty(true);
    onDirtyChange?.(true);
  }, [canEditPlanningFields, onDirtyChange]);

  const totalWeight = items.reduce((sum, r) => sum + (Number(r.weight) || 0), 0);
  const weightValid = Math.abs(totalWeight - 100) < 0.01 || items.length === 0;
  const hasEmptyTask = items.some((r) => !String(r.major_task).trim());

  useEffect(() => {
    if (weightValid) setDismissedWeightAlert(false);
  }, [weightValid]);
  useEffect(() => {
    if (!hasEmptyTask) setDismissedRequiredFieldAlert(false);
  }, [hasEmptyTask]);

  const canSave = (canEditPlanningFields || canEditActualResults || canEditManagerWorkplanRatings) &&
    items.length > 0 && !saving && workplan?.id;
  const canSaveManager = canEditManagerWorkplanRatings && workplan?.id && items.length > 0 && !saving;

  const saveWorkplan = useCallback(async () => {
    if (!canSave || !workplan?.id) return;
    setSaving(true);
    setError(null);
    setSaveSuccess(false);

    try {
      const payloadItems = items.map((row) => ({
        ...row,
        corporate_objective_id: row.corporate?.id ?? null,
        divisional_objective_id: row.divisional?.id ?? null,
        corporate_objective: row.corporate?.title ?? row.corporate_objective ?? "",
        division_objective: row.divisional?.title ?? row.division_objective ?? "",
      }));
      const res = await fetch(`/api/appraisals/${appraisalId}/workplan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workplanId: workplan.id,
          items: payloadItems,
          idsToDelete,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to save workplan");
      }

      setIdsToDelete([]);
      setIsDirty(false);
      onDirtyChange?.(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 4000);
      window.dispatchEvent(new CustomEvent("appraisal-completion-invalidate"));
      await loadWorkplan();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save workplan");
    } finally {
      setSaving(false);
    }
  }, [canSave, workplan?.id, appraisalId, items, idsToDelete, loadWorkplan, onDirtyChange]);

  const saveManagerWorkplan = useCallback(async () => {
    if (!canEditManagerWorkplanRatings || !workplan?.id || items.length === 0) return;
    setSaving(true);
    setError(null);
    setSaveSuccess(false);
    try {
      for (const row of items) {
        if (row.id.startsWith("new-")) continue;
        const body = {
          mgr_actual_raw: row.mgr_actual_raw ?? row.metric_actual_raw ?? null,
          mgr_completion_date: row.mgr_completion_date ?? row.metric_completion_date ?? null,
        };
        const res = await fetch(`/api/workplan-items/${row.id}/manager`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Failed to save manager assessment");
        }
      }
      setIsDirty(false);
      onDirtyChange?.(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 4000);
      window.dispatchEvent(new CustomEvent("appraisal-completion-invalidate"));
      await loadWorkplan();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save manager assessment");
    } finally {
      setSaving(false);
    }
  }, [canEditManagerWorkplanRatings, workplan?.id, appraisalId, items, loadWorkplan, onDirtyChange]);

  useEffect(() => {
    if (!saveSuccess || !canSaveAssessment) return;
    setAssessmentLastSavedAt(Date.now());
    setAssessmentJustSaved(true);
    const timer = setTimeout(() => setAssessmentJustSaved(false), DRAFT_SAVED_MS);
    return () => {
      clearTimeout(timer);
      setAssessmentJustSaved(false);
    };
  }, [saveSuccess, canSaveAssessment]);

  useEffect(() => {
    if (!registerSave) return;
    const save = () => (canEditManagerWorkplanRatings ? saveManagerWorkplan() : saveWorkplan());
    registerSave(save);
    return () => registerSave(null);
  }, [registerSave, canEditManagerWorkplanRatings, saveManagerWorkplan, saveWorkplan]);

  const submitForApproval = useCallback(async () => {
    if (!canSubmitForApproval) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/appraisals/${appraisalId}/submit-for-approval`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit for approval");
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 4000);
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit for approval");
    } finally {
      setSubmitting(false);
    }
  }, [canSubmitForApproval, appraisalId]);

  const approveWorkplan = useCallback(async () => {
    if (!canApproveWorkplan) return;
    setApproving(true);
    setError(null);

    try {
      const res = await fetch(`/api/appraisals/${appraisalId}/workplan/approve`, {
        method: "POST",
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to approve workplan");
      }

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 4000);
      window.dispatchEvent(new CustomEvent("appraisal-completion-invalidate"));
      await loadWorkplan();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to approve workplan");
    } finally {
      setApproving(false);
    }
  }, [canApproveWorkplan, appraisalId, loadWorkplan]);

  const rejectWorkplan = useCallback(async () => {
    if (!canApproveWorkplan || !rejectReason.trim()) return;
    setApproving(true);
    setError(null);

    try {
      const res = await fetch(`/api/appraisals/${appraisalId}/workplan/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to reject workplan");
      }

      setRejectModalOpen(false);
      setRejectReason("");
      await loadWorkplan();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reject workplan");
    } finally {
      setApproving(false);
    }
  }, [canApproveWorkplan, appraisalId, rejectReason, loadWorkplan]);

  if (loading) {
    return <p style={{ color: "#646f79", padding: "16px 0" }}>Loading workplan…</p>;
  }

  const downloadExcelButton = items.length > 0 && !loading && !oversight ? (
    <button
      type="button"
      onClick={handleDownloadExcel}
      disabled={exportingExcel}
      className="inline-flex items-center gap-2 px-3 py-2 rounded-[8px] bg-white text-ds-text-primary border border-ds-border text-[11px] font-semibold hover:bg-ds-surface transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      {exportingExcel ? "Downloading…" : "Download Excel"}
    </button>
  ) : null;

  return (
    <div className="w-full">
      {/* Action buttons */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "10px", marginBottom: "16px", flexWrap: "wrap" }}>
        {/* Planning phase buttons */}
        {/* Add Objective moved to card header beside Save Workplan */}
        {/* Submit for Approval moved to AppraisalTabs so visible on all tabs */}

        {/* Manager approval buttons */}
        {canApproveWorkplan && (
          <>
            <button
              onClick={approveWorkplan}
              disabled={approving}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "7px",
                padding: "9px 20px",
                borderRadius: "8px",
                background: !approving ? "#0d0e10" : "#e7e7e7",
                border: "none",
                fontSize: "13px",
                fontWeight: 600,
                color: !approving ? "white" : "#646f79",
                cursor: !approving ? "pointer" : "not-allowed",
                boxShadow: !approving ? "none" : "none",
                transition: "all 0.16s",
              }}
            >
              <CheckIcon /> {approving ? "Approving…" : "Approve Workplan"}
            </button>
            <button
              onClick={() => setRejectModalOpen(true)}
              disabled={approving}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "7px",
                padding: "9px 20px",
                borderRadius: "8px",
                background: "#fef2f2",
                border: "1px solid #fbd5d5",
                fontSize: "13px",
                fontWeight: 600,
                color: "#b42318",
                cursor: !approving ? "pointer" : "not-allowed",
                transition: "all 0.16s",
              }}
            >
              <XIcon /> Return for Revision
            </button>
          </>
        )}

        {canRaiseDispute && (
          <button
            onClick={async () => {
              const comment = window.prompt("Reason for dispute (optional):");
              if (comment === null) return;
              setSubmitting(true);
              setError(null);
              try {
                const res = await fetch(`/api/appraisals/${appraisalId}/dispute`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ comment: comment ?? "" }),
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || "Failed");
                window.location.reload();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Failed");
              } finally {
                setSubmitting(false);
              }
            }}
            disabled={submitting}
            style={{
              display: "inline-flex", alignItems: "center", gap: "7px",
              padding: "9px 18px", borderRadius: "8px",
              background: "#fef2f2", border: "1px solid #fbd5d5",
              fontSize: "13px", fontWeight: 600, color: "#b42318", cursor: "pointer",
            }}
          >
            Raise Dispute
          </button>
        )}
      </div>

      {/* Alerts */}
      {error && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", padding: "14px 16px", borderRadius: "8px", background: "#fef2f2", border: "1px solid #fbd5d5", marginBottom: "16px" }}>
          <span style={{ color: "#b42318", marginTop: "2px" }}><AlertIcon /></span>
          <div>
            <div style={{ fontWeight: 600, fontSize: "13px", color: "#b42318" }}>Error</div>
            <div style={{ fontSize: "13px", color: "#b42318" }}>{error}</div>
          </div>
        </div>
      )}

      {saveSuccess && !canSaveAssessment && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", padding: "14px 16px", borderRadius: "8px", background: "#ecfdf5", border: "1px solid #bbf0d9", marginBottom: "16px" }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: "13px", color: "#2e7d4f" }}>Success</div>
            <div style={{ fontSize: "13px", color: "#2e7d4f" }}>Changes saved successfully.</div>
          </div>
        </div>
      )}

      {!weightValid && items.length > 0 && canEditPlanningFields && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", padding: "14px 16px", borderRadius: "8px", background: totalWeight > 100 ? "#fef2f2" : "#fffbeb", border: `1px solid ${totalWeight > 100 ? "#fbd5d5" : "#fbe3a1"}`, marginBottom: "16px" }}>
          <span style={{ color: totalWeight > 100 ? "#b42318" : "#8a5a00", marginTop: "2px" }}><AlertIcon /></span>
          <div>
            <div style={{ fontWeight: 600, fontSize: "13px", color: totalWeight > 100 ? "#b42318" : "#8a5a00" }}>Weight validation</div>
            <div style={{ fontSize: "13px", color: totalWeight > 100 ? "#b42318" : "#8a5a00" }}>Total objective weight must equal 100%. Current total: {totalWeight.toFixed(1)}%</div>
          </div>
        </div>
      )}

      {hasEmptyTask && canEditPlanningFields && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: "12px", padding: "14px 16px", borderRadius: "8px", background: "#fffbeb", border: "1px solid #fbe3a1", marginBottom: "16px" }}>
          <span style={{ color: "#8a5a00", marginTop: "2px" }}><AlertIcon /></span>
          <div>
            <div style={{ fontWeight: 600, fontSize: "13px", color: "#8a5a00" }}>Required field</div>
            <div style={{ fontSize: "13px", color: "#8a5a00" }}>Major Tasks cannot be empty. Fill in the Major Tasks column for every row before saving.</div>
          </div>
        </div>
      )}

      {/* Card */}
      <div
        className="w-full overflow-hidden rounded-ds-panel border border-ds-border bg-white"
        style={{
          width: "100%",
          boxShadow: "none",
        }}
      >
        {/* Card header */}
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid #e7e7e7", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ width: "32px", height: "32px", borderRadius: "9px", background: "#f3f3f3", display: "flex", alignItems: "center", justifyContent: "center", color: "#0d0e10" }}>
              <ClipboardIcon />
            </div>
            <div>
              <div style={{ fontFamily: "var(--ds-font-sans)", fontSize: "15px", fontWeight: 600, color: "#0d0d0d", letterSpacing: "-0.01em" }}>
                {isPlanningPhase ? "Workplan Objectives" : "Performance Assessment"}
              </div>
              <div style={{ fontSize: "12px", color: "#646f79", marginTop: "1px" }}>
                {isPlanningPhase 
                  ? (canEditPlanningFields ? "Define objectives, tasks, and expected outputs. Total weight must equal 100%." : "Objectives for this appraisal period")
                  : "Enter actual results achieved against each objective"
                }
              </div>
              {showMidyearColumn && midyearContext.score && <MidyearScoreLine score={midyearContext.score} />}
            </div>
          </div>
          {canEditPlanningFields && (
            <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
              {workplan?.imported_from_file && (
                <span className="text-[11px] text-ds-accent bg-ds-surface border border-ds-border-strong px-3 py-1 rounded-ds-badge">
                  Imported from {workplan.imported_from_file}
                  <button
                    type="button"
                    onClick={() => setShowUploadModal(true)}
                    className="ml-2 underline hover:no-underline"
                  >
                    Re-import
                  </button>
                </span>
              )}
              <button
                type="button"
                onClick={() => setShowUploadModal(true)}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-[8px] bg-ds-surface text-ds-accent border border-ds-border-strong text-[11px] font-semibold hover:bg-ds-success-subtle transition-colors"
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                Import from Excel
              </button>
              <button
                onClick={addRow}
                disabled={!workplan?.id}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "7px",
                  padding: "10px 20px",
                  borderRadius: "8px",
                  background: "#0d0d0d",
                  border: "none",
                  fontSize: "13px",
                  fontWeight: 500,
                  color: "white",
                  cursor: workplan?.id ? "pointer" : "not-allowed",
                  opacity: workplan?.id ? 1 : 0.5,
                  transition: "background-color 0.15s ease, transform 0.1s ease",
                }}
                onMouseEnter={(e) => {
                  if (!workplan?.id) return;
                  e.currentTarget.style.background = "#0d0d0d";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "#0d0d0d";
                  e.currentTarget.style.transform = "scale(1)";
                }}
                onMouseDown={(e) => {
                  if (!workplan?.id) return;
                  e.currentTarget.style.transform = "scale(0.98)";
                }}
                onMouseUp={(e) => {
                  if (!workplan?.id) return;
                  e.currentTarget.style.transform = "scale(1)";
                }}
              >
                <PlusIcon /> Add Objective
              </button>
              <button
                onClick={saveWorkplan}
                disabled={!canSave}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "7px",
                  padding: "9px 20px",
                  borderRadius: "8px",
                  background: canSave ? "#0d0e10" : "#e7e7e7",
                  border: "none",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: canSave ? "white" : "#646f79",
                  cursor: canSave ? "pointer" : "not-allowed",
                  boxShadow: canSave ? "none" : "none",
                  transition: "all 0.16s",
                }}
              >
                <SaveIcon /> Save Workplan
              </button>
            </div>
          )}
          {!canSaveAssessment && downloadExcelButton}
        </div>

        {workplan && workplan.status !== "draft" && (
          <div className="flex items-center gap-2 px-5 py-3 bg-ds-warning-subtle border-b border-ds-warning-border">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8a5a00" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
            <p className="text-[11px] text-ds-warning">
              Workplan is locked — use Check-ins to track progress
            </p>
          </div>
        )}

        {canSaveAssessment && (
          <div data-assessment-actions className="flex flex-col gap-2 border-b border-ds-border px-6 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
              <button
                type="button"
                data-save-assessment
                onClick={canEditManagerWorkplanRatings ? saveManagerWorkplan : saveWorkplan}
                disabled={canEditManagerWorkplanRatings ? !canSaveManager : !canSave}
                aria-live="polite"
                className={MIDYEAR_BUTTON.secondary}
              >
                <SaveIcon /> {saving ? "Saving…" : assessmentJustSaved ? "Saved ✓" : "Save Assessment"}
              </button>
              {assessmentLastSavedAt != null && <MidyearLastSaved at={assessmentLastSavedAt} />}
            </div>
            {downloadExcelButton && <div className="flex sm:justify-end">{downloadExcelButton}</div>}
          </div>
        )}

        {/* Table */}
        {items.length === 0 && workplan?.status === "draft" && canEditPlanningFields ? (
          <div className="border-2 border-dashed border-ds-border rounded-ds-panel p-12 flex flex-col items-center text-center">
            <div className="w-12 h-12 rounded-ds-panel bg-ds-surface border border-ds-border flex items-center justify-center mb-4">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#646f79" strokeWidth="1.5">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="18" x2="12" y2="12" />
                <line x1="9" y1="15" x2="15" y2="15" />
              </svg>
            </div>
            <p className="font-sans text-[14px] font-semibold text-ds-text-primary mb-2">
              No objectives yet
            </p>
            <p className="text-[12px] text-ds-text-secondary max-w-[360px] leading-relaxed mb-6">
              Add objectives manually or import from your Excel workplan template
            </p>
            <div className="grid grid-cols-2 gap-3 w-full max-w-[480px]">
              <button
                type="button"
                onClick={() => setShowUploadModal(true)}
                className="border border-ds-border-strong rounded-ds-panel p-4 bg-ds-surface text-left hover:bg-ds-success-subtle transition-colors group"
              >
                <div className="w-8 h-8 rounded-[9px] bg-white border border-ds-success-border flex items-center justify-center mb-3">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#0d0e10" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                </div>
                <p className="text-[12px] font-semibold text-ds-accent-hover mb-1">Import from Excel</p>
                <p className="text-[10px] text-ds-accent leading-relaxed">
                  Upload .xlsx — AI maps columns automatically
                </p>
                <p className="text-[10px] font-semibold text-ds-accent mt-3 group-hover:underline">
                  Import workplan →
                </p>
              </button>
              <button
                type="button"
                onClick={addRow}
                className="border border-ds-border rounded-ds-panel p-4 bg-ds-surface text-left hover:border-ds-text-primary transition-colors group"
              >
                <div className="w-8 h-8 rounded-[9px] bg-white border border-ds-border flex items-center justify-center mb-3">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#646f79" strokeWidth="2">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </div>
                <p className="text-[12px] font-semibold text-ds-text-primary mb-1">Add manually</p>
                <p className="text-[10px] text-ds-text-secondary leading-relaxed">
                  Enter objectives one by one using the form
                </p>
                <p className="text-[10px] font-semibold text-ds-text-secondary mt-3 group-hover:underline">
                  Add objective →
                </p>
              </button>
            </div>
          </div>
        ) : items.length === 0 ? (
          <div style={{ padding: "32px 24px", textAlign: "center" }}>
            <p style={{ color: "#646f79", fontSize: "13px" }}>
              No objectives defined yet.{" "}
              {canEditPlanningFields && "Click \"Add Objective\" to add your first objective."}
            </p>
          </div>
        ) : (
          <div className="w-full overflow-hidden" style={{ width: "100%" }}>
            <table
              className="w-full table-fixed"
              style={{ width: "100%", tableLayout: "fixed", borderCollapse: "collapse" }}
            >
              <colgroup>
                {!showTargetColumn ? (
                  <>
                    <col style={{ width: "22%" }} />
                    <col style={{ width: "22%" }} />
                    <col style={{ width: "22%" }} />
                    <col style={{ width: "24%" }} />
                    <col style={{ width: "10%" }} />
                  </>
                ) : (
                  <>
                    {canEditPlanningFields ? (
                      <>
                        <col style={{ width: "11.4%" }} />
                        <col style={{ width: "11.4%" }} />
                        <col style={{ width: "14.4%" }} />
                        <col style={{ width: "14.4%" }} />
                        <col style={{ width: "19.4%" }} />
                        <col style={{ width: "7%" }} />
                        <col style={{ width: "7%" }} />
                      </>
                    ) : (
                      <>
                        <col className="w-[16%]" />
                        <col className="w-[13%]" />
                        <col className="w-[13%]" />
                        <col className="w-[18%]" />
                        <col className="w-[14%]" />
                        <col className="w-[7%]" />
                      </>
                    )}
                    {showMidyearColumn && <col className="w-[8%]" />}
                    {showActualResults && <col className="w-[12%]" />}
                    {status === "MANAGER_REVIEW" && <col className="w-[10%]" />}
                    {showActualResults && <col className="w-[7%]" />}
                    {canEditPlanningFields && <col className="w-[4%]" />}
                  </>
                )}
              </colgroup>
              <thead>
                <tr>
                  {canEditPlanningFields ? (
                    <>
                      <th style={thStyle}>Corporate</th>
                      <th style={thStyle}>Divisional</th>
                    </>
                  ) : (
                    <th style={thStyle}>
                      Objective <span style={{ fontWeight: 500, fontSize: "10px", color: "#646f79" }}>(click to expand)</span>
                    </th>
                  )}
                  <th style={thStyle}>Major Tasks{canEditPlanningFields && <RequiredMark />}</th>
                  <th style={thStyle}>Key Outputs{canEditPlanningFields && <RequiredMark />}</th>
                  <th style={thStyle}>Performance Standard{canEditPlanningFields && <RequiredMark />}</th>
                  {showTargetColumn && <th style={thStyle}>Target</th>}
                  <th style={{ ...thStyle, textAlign: "center", paddingRight: "16px" }}>Weighting</th>
                  {showMidyearColumn && <th style={{ ...thStyle, whiteSpace: "normal" }}>Mid-Year Result</th>}
                  {showActualResults && <th style={thStyle}>Actual YTD</th>}
                  {status === "MANAGER_REVIEW" && <th style={thStyle}>Result %</th>}
                  {showActualResults && <th style={thStyle}>Evidence</th>}
                  {showActualResults && <th style={thStyle}>Points</th>}
                  {canEditPlanningFields && <th style={thStyle}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id} style={{ transition: "background 0.13s" }} onMouseEnter={(e) => { e.currentTarget.style.background = "#f3f3f3"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                    {/* Draft: Corporate and Divisional as separate columns; read-only: single Objective column with expand */}
                    {canEditPlanningFields ? (
                      <>
                        <td style={tdStyle} className="w-[120px] max-w-[120px] align-top">
                          {row.corporate ? (
                            <div
                              onClick={() => openPicker(row.id, "corporate")}
                              className="group flex w-full cursor-pointer flex-col gap-[3px] rounded-[8px] border border-ds-border bg-white p-[5px_7px] transition-colors hover:bg-ds-surface"
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span className="inline-flex rounded-ds-button border border-ds-border-strong bg-ds-surface px-[6px] py-[1px] text-[9px] font-semibold text-ds-info">Corporate</span>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); clearObjective(row.id, "corporate"); }}
                                  className="px-[2px] text-[11px] leading-none text-ds-text-secondary opacity-0 transition-opacity hover:text-ds-error group-hover:opacity-100"
                                >
                                  ✕
                                </button>
                              </div>
                              <p className="break-words text-[11px] font-medium leading-[1.35] text-ds-text-primary whitespace-normal">{row.corporate.title}</p>
                              <p className="font-mono text-[9px] text-ds-text-secondary">{row.corporate.external_id}</p>
                            </div>
                          ) : row.corporate_objective?.trim() ? (
                            <div
                              onClick={() => openPicker(row.id, "corporate")}
                              className="group flex w-full cursor-pointer flex-col gap-[3px] rounded-[8px] border border-ds-border bg-white p-[5px_7px] transition-colors hover:bg-ds-surface"
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span className="inline-flex rounded-ds-button border border-ds-border-strong bg-ds-surface px-[6px] py-[1px] text-[9px] font-semibold text-ds-info">Corporate</span>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); clearObjective(row.id, "corporate"); }}
                                  className="px-[2px] text-[11px] leading-none text-ds-text-secondary opacity-0 transition-opacity hover:text-ds-error group-hover:opacity-100"
                                >
                                  ✕
                                </button>
                              </div>
                              <p className="break-words text-[11px] font-medium leading-[1.35] text-ds-text-primary whitespace-normal">{row.corporate_objective}</p>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => openPicker(row.id, "corporate")}
                              className="group flex h-[34px] w-[34px] cursor-pointer items-center justify-center rounded-full border-[1.5px] border-dashed border-ds-border bg-ds-surface transition-all hover:border-ds-accent hover:bg-ds-surface"
                            >
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#646f79" strokeWidth="2" className="transition-colors group-hover:stroke-ds-accent">
                                <circle cx="12" cy="12" r="9" />
                                <line x1="12" y1="8" x2="12" y2="16" />
                                <line x1="8" y1="12" x2="16" y2="12" />
                              </svg>
                            </button>
                          )}
                        </td>
                        <td style={tdStyle} className="w-[120px] max-w-[120px] align-top">
                          {row.divisional ? (
                            <div
                              onClick={() => openPicker(row.id, "divisional")}
                              className="group flex w-full cursor-pointer flex-col gap-[3px] rounded-[8px] border border-ds-border bg-white p-[5px_7px] transition-colors hover:bg-ds-surface"
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span className="inline-flex rounded-ds-button border border-ds-border-strong bg-ds-surface px-[6px] py-[1px] text-[9px] font-semibold text-ds-accent-hover">Divisional</span>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); clearObjective(row.id, "divisional"); }}
                                  className="px-[2px] text-[11px] leading-none text-ds-text-secondary opacity-0 transition-opacity hover:text-ds-error group-hover:opacity-100"
                                >
                                  ✕
                                </button>
                              </div>
                              <p className="break-words text-[11px] font-medium leading-[1.35] text-ds-text-primary whitespace-normal">{row.divisional.title}</p>
                              <p className="font-mono text-[9px] text-ds-text-secondary">{row.divisional.external_id}</p>
                            </div>
                          ) : row.division_objective?.trim() ? (
                            <div
                              onClick={() => openPicker(row.id, "divisional")}
                              className="group flex w-full cursor-pointer flex-col gap-[3px] rounded-[8px] border border-ds-border bg-white p-[5px_7px] transition-colors hover:bg-ds-surface"
                            >
                              <div className="flex items-center justify-between gap-1">
                                <span className="inline-flex rounded-ds-button border border-ds-border-strong bg-ds-surface px-[6px] py-[1px] text-[9px] font-semibold text-ds-accent-hover">Divisional</span>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); clearObjective(row.id, "divisional"); }}
                                  className="px-[2px] text-[11px] leading-none text-ds-text-secondary opacity-0 transition-opacity hover:text-ds-error group-hover:opacity-100"
                                >
                                  ✕
                                </button>
                              </div>
                              <p className="break-words text-[11px] font-medium leading-[1.35] text-ds-text-primary whitespace-normal">{row.division_objective}</p>
                            </div>
                          ) : (
                            <button
                              type="button"
                              disabled={!row.corporate && !row.corporate_objective?.trim()}
                              onClick={() => (row.corporate || row.corporate_objective?.trim()) && openPicker(row.id, "divisional")}
                              className={cn(
                                "group flex h-[34px] w-[34px] items-center justify-center rounded-full border-[1.5px] border-dashed border-ds-border bg-ds-surface transition-all",
                                row.corporate || row.corporate_objective?.trim()
                                  ? "cursor-pointer hover:border-ds-accent hover:bg-ds-surface"
                                  : "cursor-not-allowed opacity-50"
                              )}
                            >
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#646f79" strokeWidth="2" className={cn("transition-colors", (row.corporate || row.corporate_objective?.trim()) && "group-hover:stroke-ds-accent")}>
                                <circle cx="12" cy="12" r="9" />
                                <line x1="12" y1="8" x2="12" y2="16" />
                                <line x1="8" y1="12" x2="16" y2="12" />
                              </svg>
                            </button>
                          )}
                        </td>
                      </>
                    ) : (
                      <td style={tdStyle} className="max-w-[180px]">
                        <button
                          type="button"
                          onClick={() => toggleExpand(row.id)}
                          className="flex items-start gap-1.5 text-left group w-full"
                        >
                          <span className={cn("inline-block text-ds-text-secondary transition-transform flex-shrink-0 mt-0.5", expandedObjective[row.id] && "rotate-90")}>
                            <ChevronRightIcon />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-[12px] font-semibold text-ds-text-primary truncate leading-tight">
                              {row.corporate_objective || "—"}
                            </p>
                            {expandedObjective[row.id] && (
                              <p className="text-[11px] text-ds-text-secondary mt-1 leading-tight">
                                {row.division_objective || "—"}
                              </p>
                            )}
                          </div>
                        </button>
                      </td>
                    )}
                    <td style={tdStyle}>
                      {canEditPlanningFields ? (
                        <>
                          <textarea rows={2} style={{ ...textareaStyle, minWidth: "140px" }} value={row.major_task} onChange={(e) => updateRow(row.id, "major_task", e.target.value)} placeholder="Required" onFocus={(e) => { e.target.style.borderColor = "#0d0e10"; e.target.style.boxShadow = "0 0 0 1px var(--ds-focus)"; }} onBlur={(e) => { e.target.style.borderColor = "#8b949e"; e.target.style.boxShadow = "none"; }} />
                          <IncompleteRowHint row={row} />
                        </>
                      ) : (
                        <span style={{ fontSize: "13px", color: "#0d0d0d", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{row.major_task || "—"}</span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      {canEditPlanningFields ? (
                        <textarea rows={2} style={textareaStyle} value={row.key_output} onChange={(e) => updateRow(row.id, "key_output", e.target.value)} placeholder="Required" onFocus={(e) => { e.target.style.borderColor = "#0d0e10"; e.target.style.boxShadow = "0 0 0 1px var(--ds-focus)"; }} onBlur={(e) => { e.target.style.borderColor = "#8b949e"; e.target.style.boxShadow = "none"; }} />
                      ) : (
                        <span style={{ fontSize: "13px", color: "#0d0d0d", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{row.key_output || "—"}</span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      {canEditPlanningFields ? (
                        <textarea rows={2} style={{ ...textareaStyle, minWidth: "140px" }} value={row.performance_standard} onChange={(e) => updateRow(row.id, "performance_standard", e.target.value)} placeholder="Required" onFocus={(e) => { e.target.style.borderColor = "#0d0e10"; e.target.style.boxShadow = "0 0 0 1px var(--ds-focus)"; }} onBlur={(e) => { e.target.style.borderColor = "#8b949e"; e.target.style.boxShadow = "none"; }} />
                      ) : (
                        <span style={{ fontSize: "13px", color: "#0d0d0d", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{row.performance_standard || "—"}</span>
                      )}
                    </td>
                    {/* Target column: DRAFT = type-specific input; after DRAFT = read-only. When DRAFT, "change type" opens type picker. */}
                    {showTargetColumn && (
                      <td style={tdStyle}>
                        {canEditPlanningFields ? (
                          <>
                            {(row.metric_type ?? "PERCENT") === "NUMBER" ? (
                            <div className="flex flex-col gap-1">
                              <input
                                type="number"
                                min={0}
                                value={row.metric_target ?? ""}
                                placeholder="e.g. 5"
                                onChange={(e) => updateRow(row.id, "metric_target", e.target.value === "" ? null : Number(e.target.value))}
                                className={cn(
                                  inputBase,
                                  "w-20 px-2 py-1.5 text-center",
                                  "border-ds-border focus:border-ds-info-border focus:ring-2 focus:ring-ds-info-border"
                                )}
                              />
                              <span className="text-[10px] text-ds-text-secondary">units to achieve</span>
                            </div>
                          ) : (row.metric_type ?? "PERCENT") === "DATE" ? (
                            <div className="flex flex-col gap-1">
                              <input
                                type="date"
                                value={row.metric_deadline ?? ""}
                                onChange={(e) => updateRow(row.id, "metric_deadline", e.target.value || null)}
                                className={cn(
                                  inputBase,
                                  "px-2.5 py-1.5 text-xs",
                                  "border-ds-info-border bg-ds-info-subtle text-ds-info",
                                  "focus:border-ds-info-border focus:ring-2 focus:ring-ds-info-border"
                                )}
                              />
                            </div>
                          ) : (
                            <div className="flex flex-col gap-1">
                              <div className="relative">
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  step={0.1}
                                  value={row.metric_target ?? row.metric_actual_raw ?? ""}
                                  placeholder="e.g. 99.5"
                                  onChange={(e) => updateRow(row.id, "metric_target", e.target.value === "" ? null : Number(e.target.value))}
                                  className={cn(
                                    inputBase,
                                    "w-20 px-2 py-1.5 pr-6 text-center",
                                    "border-ds-border focus:border-ds-success-border focus:ring-2 focus:ring-ds-success-border"
                                  )}
                                />
                                <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-ds-text-secondary">%</span>
                              </div>
                            </div>
                          )}
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={() => setTypePickerItemId(row.id)}
                              onKeyDown={(e) => e.key === "Enter" && setTypePickerItemId(row.id)}
                              className="cursor-pointer text-[9px] text-ds-text-secondary transition-colors hover:text-ds-info mt-1 block"
                            >
                              change type
                            </span>
                          </>
                        ) : (
                          <span style={{ fontSize: "12px", color: "#646f79", fontWeight: 500 }}>
                            {(row.metric_type ?? "PERCENT") === "NUMBER" && row.metric_target != null
                              ? `Target: ${row.metric_target}`
                              : (row.metric_type ?? "PERCENT") === "DATE" && row.metric_deadline
                                ? `Deadline: ${formatDeadline(row.metric_deadline)}`
                                : row.metric_target != null
                                  ? `Target: ${row.metric_target}%`
                                  : "—"}
                          </span>
                        )}
                      </td>
                    )}
                    <td style={{ ...tdStyle, textAlign: "center", paddingRight: "16px" }}>
                      {canEditPlanningFields ? (
                        <input type="number" min={0} max={100} style={{ ...inputStyle, width: "22px" }} value={row.weight === 0 ? "" : row.weight} onChange={(e) => updateRow(row.id, "weight", e.target.value === "" ? 0 : Number(e.target.value))} onFocus={(e) => { e.target.style.borderColor = "#0d0e10"; e.target.style.boxShadow = "0 0 0 1px var(--ds-focus)"; }} onBlur={(e) => { e.target.style.borderColor = "#8b949e"; e.target.style.boxShadow = "none"; }} />
                      ) : (
                        <div className="flex justify-center">
                          {showActualResults ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex items-center justify-center px-2.5 py-1 rounded-ds-badge bg-ds-text-primary text-white text-[11px] font-semibold cursor-default">
                                  {row.weight}%
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="top" sideOffset={8} className="border-0 bg-ds-text-primary px-3 py-2.5 text-white shadow-ds-popover">
                                <div className="font-semibold text-[11px] mb-1.5 text-white/70 uppercase tracking-wide">
                                  Grade Thresholds
                                </div>
                                {[
                                  { g: "A", mult: 1.0, color: "#2e7d4f" },
                                  { g: "B", mult: 0.8, color: "#8b949e" },
                                  { g: "C", mult: 0.6, color: "#3d5a78" },
                                  { g: "D", mult: 0.4, color: "#8a5a00" },
                                  { g: "E", mult: 0.2, color: "#b42318" },
                                ].map(({ g, mult, color }) => (
                                  <div key={g} className="flex items-center gap-2 py-0.5 text-[10px] whitespace-nowrap">
                                    <span className="font-semibold w-3" style={{ color }}>{g}</span>
                                    <span className="text-white/60">×{mult}</span>
                                    <span className="text-white font-semibold ml-auto">
                                      {(row.weight * mult).toFixed(1)} pts
                                    </span>
                                  </div>
                                ))}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            <span className="inline-flex items-center justify-center px-2.5 py-1 rounded-ds-badge bg-ds-text-primary text-white text-[11px] font-semibold cursor-default">
                              {row.weight}%
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    {showMidyearColumn && (
                      <td style={tdStyle} data-midyear-cell>
                        <MidyearResultValue value={midyearContext.results[row.id]} />
                      </td>
                    )}
                    {showActualResults && (
                      <td style={tdStyle}>
                        {status === "MANAGER_REVIEW" && canEditManagerWorkplanRatings ? (
                          (() => {
                            const type = row.metric_type ?? "PERCENT";
                            const mgrValue = type === "DATE" ? (row.mgr_completion_date ?? row.metric_completion_date) : (row.mgr_actual_raw ?? row.metric_actual_raw);
                            const mgrChanged = type === "DATE"
                              ? row.mgr_completion_date != null && row.mgr_completion_date !== row.metric_completion_date
                              : row.mgr_actual_raw != null && row.mgr_actual_raw !== row.metric_actual_raw;
                            const mgrConfirmed = row.mgr_result != null;
                            const empActual = type === "DATE" ? (row.metric_completion_date ?? "") : (row.metric_actual_raw ?? 0);
                            const mgrActual = type === "DATE" ? (row.mgr_completion_date ?? row.metric_completion_date ?? "") : (row.mgr_actual_raw ?? row.metric_actual_raw ?? 0);
                            return (
                              <div className="flex flex-col gap-[6px]">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-ds-info bg-ds-info-subtle flex-shrink-0">EMP</span>
                                  <span
                                    className={cn(
                                      "text-[11px] font-semibold px-2 py-0.5 rounded-md border bg-ds-info-subtle border-ds-info-border text-ds-info",
                                      mgrChanged && "line-through opacity-50"
                                    )}
                                  >
                                    {empDisplayValue(row)}
                                  </span>
                                  {mgrChanged && <VarianceBadge emp={empActual} mgr={mgrActual} type={type} />}
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className="inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-ds-info bg-ds-info-subtle flex-shrink-0">MGR</span>
                                  <MgrActualInput
                                    item={row}
                                    value={mgrValue ?? null}
                                    onChange={(v) => updateRow(row.id, type === "DATE" ? "mgr_completion_date" : "mgr_actual_raw", v)}
                                    isChanged={mgrChanged}
                                    isConfirmed={mgrConfirmed}
                                    isDate={type === "DATE"}
                                  />
                                </div>
                              </div>
                            );
                          })()
                        ) : status !== "MANAGER_REVIEW" && (canEditActualResults || canEditManagerWorkplanRatings) ? (
                          (row.metric_type ?? "PERCENT") === "NUMBER" ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap" }}>
                                <NumericDraftInput
                                  min={0}
                                  aria-label="Actual YTD"
                                  data-actual-ytd
                                  style={{ ...inputStyle, width: "52px", textAlign: "center" }}
                                  value={row.metric_actual_raw}
                                  onValueChange={(v) => updateRow(row.id, "metric_actual_raw", v)}
                                  onFocus={(e) => { e.target.style.borderColor = "#0d0e10"; e.target.style.boxShadow = "0 0 0 1px var(--ds-focus)"; }}
                                  onBlur={(e) => { e.target.style.borderColor = "#8b949e"; e.target.style.boxShadow = "none"; }}
                                />
                                <span style={{ fontSize: "13px", fontWeight: 600, color: "#0d0d0d" }}>/</span>
                                <span style={{ fontSize: "13px", fontWeight: 600, color: "#646f79" }}>{row.metric_target ?? "—"}</span>
                              </div>
                            </div>
                          ) : (row.metric_type ?? "PERCENT") === "DATE" ? (
                            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                              <input
                                type="date"
                                style={{
                                  ...inputStyle,
                                  width: "100%",
                                  minWidth: "100px",
                                  borderColor: row.metric_completion_date ? (getDateVariance(row)?.isLate ? "#8a5a00" : "#2e7d4f") : "#e7e7e7",
                                  background: row.metric_completion_date ? (getDateVariance(row)?.isLate ? "#fffbeb" : "#ecfdf5") : "white",
                                }}
                                value={row.metric_completion_date ?? ""}
                                onChange={(e) => updateRow(row.id, "metric_completion_date", e.target.value || null)}
                                onFocus={(e) => { e.target.style.boxShadow = "0 0 0 3px rgba(147,51,234,0.15)"; }}
                                onBlur={(e) => { e.target.style.boxShadow = "none"; }}
                              />
                              {getDateVariance(row) && (
                                <span style={{ fontSize: "11px", fontWeight: 600, color: getDateVariance(row)?.isLate ? "#8a5a00" : "#2e7d4f" }}>
                                  {getDateVariance(row)?.isLate ? "⚠️ " : "✅ "}{getDateVariance(row)?.label}
                                </span>
                              )}
                            </div>
                          ) : (
                            <NumericDraftInput
                              min={0}
                              max={100}
                              clamp
                              aria-label="Actual YTD"
                              data-actual-ytd
                              style={{ ...inputStyle, width: "70px" }}
                              value={row.actual_result ?? row.metric_actual_raw}
                              onValueChange={(v) => updateRow(row.id, "actual_result", v)}
                              onFocus={(e) => { e.target.style.borderColor = "#0d0e10"; e.target.style.boxShadow = "0 0 0 1px var(--ds-focus)"; }}
                              onBlur={(e) => { e.target.style.borderColor = "#8b949e"; e.target.style.boxShadow = "none"; }}
                            />
                          )
                        ) : (
                          <>
                            <span
                              style={{
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                minWidth: "44px",
                                padding: "4px 10px",
                                borderRadius: "4px",
                                fontFamily: "var(--ds-font-sans)",
                                fontSize: "12px",
                                fontWeight: 600,
                                ...getResultPillStyle(row.actual_result),
                              }}
                            >
                              {row.actual_result != null ? row.actual_result : "—"}
                            </span>
                            {row.mgr_result != null && row.mgr_result !== row.actual_result && status !== "MANAGER_REVIEW" && (
                              <div className="flex flex-col gap-0.5 mt-1">
                                <span className="text-[9px] font-semibold uppercase text-ds-info">Mgr.</span>
                                <span style={{ display: "inline-flex", alignItems: "center", minWidth: "44px", padding: "4px 10px", borderRadius: "4px", fontFamily: "var(--ds-font-sans)", fontSize: "12px", fontWeight: 600, ...getResultPillStyle(row.mgr_result) }}>
                                  {row.mgr_result}
                                </span>
                                <VarianceBadge emp={row.actual_result ?? 0} mgr={row.mgr_result} type={row.metric_type ?? "PERCENT"} />
                              </div>
                            )}
                          </>
                        )}
                      </td>
                    )}
                    {status === "MANAGER_REVIEW" && (
                      <td style={tdStyle}>
                        <div className="flex flex-col items-center gap-0">
                          <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: "44px", padding: "4px 10px", borderRadius: "4px", fontFamily: "var(--ds-font-sans)", fontSize: "12px", fontWeight: 600, ...getResultPillStyle(row.actual_result) }}>
                            {row.actual_result != null ? row.actual_result : "—"}
                          </span>
                          <div className="w-full border-t border-ds-border my-1.5" style={{ minWidth: "44px" }} />
                          {(row.mgr_result ?? calcMgrResult(row)) != null ? (
                            <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: "44px", padding: "4px 10px", borderRadius: "4px", fontFamily: "var(--ds-font-sans)", fontSize: "12px", fontWeight: 600, ...getResultPillStyle(row.mgr_result ?? calcMgrResult(row)) }}>
                              {row.mgr_result ?? calcMgrResult(row)}
                            </span>
                          ) : (
                            <span className="text-[10px] text-ds-text-secondary italic">pending</span>
                          )}
                        </div>
                      </td>
                    )}
                    {showActualResults && (
                      <td style={tdStyle}>
                        <EvidenceBadge
                          workplanItemId={row.id}
                          appraisalId={appraisalId}
                          evidenceCount={evidenceCounts[row.id] ?? 0}
                          role={isEmployee ? "EMPLOYEE" : isHR ? "HR" : "MANAGER"}
                          onManage={() => setActiveEvidenceItem(row)}
                        />
                      </td>
                    )}
                    {showActualResults && (
                      <td style={tdStyle}>
                        {status === "MANAGER_REVIEW" && (row.mgr_result != null || calcMgrResult(row) != null) ? (() => {
                          const mgrRes = row.mgr_result ?? calcMgrResult(row);
                          const empPts = row.points ?? calculatePoints(row.weight, row.actual_result) ?? 0;
                          const mgrPts = calculatePoints(row.weight, mgrRes ?? null) ?? 0;
                          return (
                            <div className="flex flex-col items-center gap-0.5">
                              {mgrPts !== empPts && (
                                <span className="text-[10px] text-ds-text-secondary line-through">{empPts.toFixed(1)}</span>
                              )}
                              <span className={cn("font-sans text-[14px] font-semibold", mgrPts !== empPts ? "text-ds-info" : "text-ds-text-primary")}>
                                {mgrPts.toFixed(1)}
                              </span>
                            </div>
                          );
                        })() : (
                          <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "3px 10px", borderRadius: "6px", background: "#f3f3f3", border: "1px solid #d0d4d8", color: "#3d5a78", fontSize: "12px", fontWeight: 600 }}>
                            {(row.points ?? calculatePoints(row.weight, row.actual_result)) ?? "—"}
                          </span>
                        )}
                      </td>
                    )}
                    
                    {canEditPlanningFields && (
                      <td style={tdStyle}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                onClick={() => duplicateRow(row.id)}
                                style={{
                                  width: "30px",
                                  height: "30px",
                                  padding: 0,
                                  borderRadius: "8px",
                                  background: "#f3f3f3",
                                  border: "1px solid #d0d4d8",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  color: "#2b2d31",
                                  cursor: "pointer",
                                  transition: "all 0.15s",
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = "#2b2d31"; e.currentTarget.style.color = "white"; e.currentTarget.style.borderColor = "#2b2d31"; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = "#f3f3f3"; e.currentTarget.style.color = "#2b2d31"; e.currentTarget.style.borderColor = "#d0d4d8"; }}
                                aria-label="Duplicate objective"
                              >
                                <Copy size={14} />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="top" sideOffset={8} className="border-0 bg-ds-text-primary px-3 py-2.5 text-white shadow-ds-popover">
                              Duplicate objective
                            </TooltipContent>
                          </Tooltip>
                          <button
                            onClick={() => deleteRow(row.id)}
                            style={{
                              width: "30px",
                              height: "30px",
                              padding: 0,
                              borderRadius: "8px",
                              background: "#fef2f2",
                              border: "1px solid #fbd5d5",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              color: "#b42318",
                              cursor: "pointer",
                              transition: "all 0.15s",
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = "#b42318"; e.currentTarget.style.color = "white"; e.currentTarget.style.borderColor = "#b42318"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = "#fef2f2"; e.currentTarget.style.color = "#b42318"; e.currentTarget.style.borderColor = "#fbd5d5"; }}
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: "#f3f3f3" }}>
                  <td colSpan={canEditPlanningFields ? 6 : !showTargetColumn ? 4 : showActualResults ? 6 : 5} style={{ ...tdStyle, textAlign: "right", border: "none" }}>
                    <span style={{ fontSize: "11.5px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "#646f79" }}>TOTAL</span>
                  </td>
                  <td style={{ ...tdStyle, border: "none", textAlign: "center" }}>
                    <span style={{ fontFamily: "var(--ds-font-sans)", fontSize: "15px", fontWeight: 600, color: totalWeight === 100 ? "#2e7d4f" : "#b42318" }}>{totalWeight.toFixed(1)}%</span>
                  </td>
                  {showMidyearColumn && <td style={{ ...tdStyle, border: "none" }} />}
                  {showActualResults && (
                    <>
                      <td style={{ ...tdStyle, border: "none" }} />
                      {status === "MANAGER_REVIEW" && <td style={{ ...tdStyle, border: "none" }} />}
                      <td style={{ ...tdStyle, border: "none" }} />
                      <td style={{ ...tdStyle, border: "none", textAlign: "right" }}>
                        <span style={{ fontFamily: "var(--ds-font-sans)", fontSize: "15px", fontWeight: 600, color: "#3d5a78" }}>{getTotalPoints(items).toFixed(1)}</span>
                      </td>
                    </>
                  )}
                  {canEditPlanningFields && <td style={{ ...tdStyle, border: "none" }} />}
                </tr>
              </tfoot>
            </table>
            {canEditPlanningFields && items.length > 1 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-start",
                  alignItems: "center",
                  padding: "12px 16px",
                  borderTop: "1px solid #e7e7e7",
                  background: "white",
                }}
              >
                <button
                  type="button"
                  onClick={addRow}
                  disabled={!workplan?.id}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "7px",
                    padding: "10px 20px",
                    borderRadius: "8px",
                    background: "#0d0d0d",
                    border: "none",
                    fontSize: "13px",
                    fontWeight: 500,
                    color: "white",
                    cursor: workplan?.id ? "pointer" : "not-allowed",
                    opacity: workplan?.id ? 1 : 0.5,
                    transition: "background-color 0.15s ease, transform 0.1s ease",
                  }}
                  onMouseEnter={(e) => {
                    if (!workplan?.id) return;
                    e.currentTarget.style.background = "#0d0d0d";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "#0d0d0d";
                    e.currentTarget.style.transform = "scale(1)";
                  }}
                  onMouseDown={(e) => {
                    if (!workplan?.id) return;
                    e.currentTarget.style.transform = "scale(0.98)";
                  }}
                  onMouseUp={(e) => {
                    if (!workplan?.id) return;
                    e.currentTarget.style.transform = "scale(1)";
                  }}
                >
                  <PlusIcon /> Add Objective
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Metric type picker modal */}
      {typePickerItemId && (() => {
        const row = items.find((r) => r.id === typePickerItemId);
        if (!row) return null;
        return (
          <MetricTypePicker
            current={(row.metric_type ?? "PERCENT") as MetricType}
            onSelect={(type) => {
              updateRow(typePickerItemId, "metric_type", type);
              setTypePickerItemId(null);
            }}
            onClose={() => setTypePickerItemId(null)}
          />
        );
      })()}

      {/* Evidence modal */}
      {activeEvidenceItem && (
        <EvidenceModal
          workplanItem={{
            id: activeEvidenceItem.id,
            major_task: activeEvidenceItem.major_task,
            corporate_objective: activeEvidenceItem.corporate_objective ?? "",
          }}
          appraisalId={appraisalId}
          role={isEmployee ? "EMPLOYEE" : isHR ? "HR" : "MANAGER"}
          onClose={() => setActiveEvidenceItem(null)}
          onSaved={() => {
            fetchEvidenceCounts();
            setActiveEvidenceItem(null);
          }}
        />
      )}

      {/* Excel workplan upload modal */}
      {showUploadModal && workplan?.id && (
        <WorkplanUploadModal
          appraisalId={appraisalId}
          workplanId={workplan.id}
          onComplete={() => {
            loadWorkplan();
            setShowUploadModal(false);
          }}
          onClose={() => setShowUploadModal(false)}
        />
      )}

      {/* Reject Modal */}
      {rejectModalOpen && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
          <div style={{ background: "white", borderRadius: "8px", width: "100%", maxWidth: "480px", boxShadow: "var(--ds-shadow-dialog)" }}>
            <div style={{ padding: "20px 24px", borderBottom: "1px solid #e7e7e7" }}>
              <h3 style={{ fontFamily: "var(--ds-font-sans)", fontSize: "18px", fontWeight: 600, color: "#0d0d0d", margin: 0 }}>Return Workplan for Revision</h3>
              <p style={{ fontSize: "13px", color: "#646f79", marginTop: "4px", marginBottom: 0 }}>Please provide feedback for the employee</p>
            </div>
            <div style={{ padding: "20px 24px" }}>
              <label style={{ display: "block", fontSize: "11.5px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "#646f79", marginBottom: "8px" }}>
                Feedback / Reason for Revision
              </label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Explain what needs to be changed..."
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: "8px",
                  border: "1px solid #e7e7e7",
                  fontSize: "13.5px",
                  color: "#0d0d0d",
                  background: "#f3f3f3",
                  resize: "vertical",
                  minHeight: "100px",
                  outline: "none",
                  fontFamily: "var(--ds-font-sans)",
                  lineHeight: 1.6,
                }}
              />
            </div>
            <div style={{ padding: "16px 24px", borderTop: "1px solid #e7e7e7", display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                onClick={() => { setRejectModalOpen(false); setRejectReason(""); }}
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
                onClick={rejectWorkplan}
                disabled={!rejectReason.trim() || approving}
                style={{
                  padding: "9px 20px",
                  borderRadius: "8px",
                  background: rejectReason.trim() && !approving ? "#b42318" : "#e7e7e7",
                  border: "none",
                  fontSize: "13px",
                  fontWeight: 600,
                  color: rejectReason.trim() && !approving ? "white" : "#646f79",
                  cursor: rejectReason.trim() && !approving ? "pointer" : "not-allowed",
                }}
              >
                {approving ? "Returning…" : "Return to Employee"}
              </button>
            </div>
          </div>
        </div>
      )}

      {picker.open && picker.field && typeof document !== "undefined" && createPortal(
        <>
          <div
            className="fixed inset-0 z-[9998] bg-black/40 backdrop-blur-[2px]"
            onClick={closePicker}
            aria-hidden
          />
          <div
            className="fixed left-1/2 top-1/2 z-[9999] flex max-h-[75vh] w-[560px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-ds-panel border border-ds-border bg-white shadow-ds-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="picker-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className={cn(
                "flex items-center gap-3 border-b border-ds-border px-4 py-3.5",
                picker.field === "corporate" ? "bg-ds-surface" : "bg-ds-surface"
              )}
            >
              <div
                className={cn(
                  "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[8px] border",
                  picker.field === "corporate"
                    ? "border-ds-text-muted bg-ds-surface-hover"
                    : "border-ds-border-strong bg-ds-surface"
                )}
              >
                {picker.field === "corporate" ? (
                  <Briefcase className="h-4 w-4 text-ds-info" />
                ) : (
                  <Layers className="h-4 w-4 text-ds-accent-hover" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p id="picker-title" className="font-sans text-[13px] font-semibold text-ds-text-primary">
                  {picker.field === "corporate" ? "Select corporate objective" : "Select divisional objective"}
                </p>
                <p className="text-[11px] text-ds-text-secondary">From the active operational plan</p>
              </div>
              <span
                className={cn(
                  "inline-flex items-center rounded-ds-badge border px-3 py-1 text-[11px] font-semibold",
                  picker.field === "corporate"
                    ? "border-ds-text-muted bg-ds-surface-hover text-ds-info"
                    : "border-ds-border-strong bg-ds-surface text-ds-accent-hover"
                )}
              >
                {picker.field === "corporate" ? "Corporate only" : "Divisional only"}
              </span>
              <button
                type="button"
                onClick={closePicker}
                className="ml-2 text-[16px] text-ds-text-secondary transition-colors hover:text-ds-text-primary"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="flex items-center gap-2 border-b border-ds-border bg-ds-surface px-4 py-2.5">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ds-text-secondary" />
                <input
                  autoFocus
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  placeholder="Search by title, division, or ID…"
                  className="w-full rounded-[8px] border border-ds-border bg-white py-2 pl-8 pr-3 text-[12px] outline-none focus:border-ds-accent"
                />
              </div>
            </div>
            <div className="border-b border-ds-border px-4 py-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-[.06em] text-ds-text-secondary">
                {filtered.length} {picker.field} objective{filtered.length !== 1 ? "s" : ""}
                {pickerSearch && ` matching "${pickerSearch}"`}
              </p>
            </div>
            <div className="flex-1 divide-y divide-ds-border overflow-y-auto">
              {filtered.map((obj) => {
                return (
                  <button
                    key={obj.id}
                    type="button"
                    onClick={() => selectObjective(obj)}
                    className="flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-ds-surface"
                  >
                    {obj.type === "CORPORATE" ? (
                      <span className="mt-0.5 flex-shrink-0 inline-flex rounded-ds-badge border border-ds-border-strong bg-ds-surface px-2 py-0.5 text-[9px] font-semibold text-ds-info">Corp</span>
                    ) : (
                      <span className="mt-0.5 flex-shrink-0 inline-flex rounded-ds-badge border border-ds-border-strong bg-ds-surface px-2 py-0.5 text-[9px] font-semibold text-ds-accent-hover">Div</span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-semibold leading-snug text-ds-text-primary">{obj.title}</p>
                      <div className="mt-1 flex items-center gap-2">
                        {obj.division && (
                          <span className="text-[11px] text-ds-text-secondary">{obj.division}</span>
                        )}
                        <span className="rounded-[4px] border border-ds-border bg-ds-surface px-1.5 py-0.5 font-mono text-[10px] text-ds-text-secondary">
                          {obj.external_id}
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-ds-border" />
                  </button>
                );
              })}
            </div>
          </div>
        </>,
        document.body
      )}

    </div>
  );
}
