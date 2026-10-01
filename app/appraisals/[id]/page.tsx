import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@supabase/supabase-js";
import { getReportingStructureFromDynamics, getReportingStructure } from "@/lib/reporting-structure";
import { resolveDepartmentHeadSystemUserId } from "@/lib/hrmis-approval-auth";
import { resolveManagerAccessForAppraisal } from "@/lib/appraisal-manager-access";
import { hasOversightReadAccess } from "@/lib/appraisal-oversight";
import type { AppraisalStatus } from "@/types/appraisal";
import { AppraisalTabs, AppraisalData, type AppraisalAgreement } from "@/components/appraisal/AppraisalTabs";
import { CompletionBarWrapperClient } from "@/components/appraisal/CompletionBarWrapperClient";
import { statusConfig, statusToneClasses } from "@/lib/appraisal-status-display";
import { AppraisalWorkflowSteps, WORKFLOW_STEPS } from "@/components/appraisal/AppraisalWorkflowSteps";
import { MidyearSubStatus } from "@/components/appraisal/MidyearSubStatus";
import { midyearConfigFromRow, type MidyearConfig, type MidyearCycleFields } from "@/lib/midyear-config";
import { pickCurrentFormalReview, type FormalReviewLike } from "@/lib/midyear-display";

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase URL and key required");
  return createClient(url, key);
}

async function getAppraisalDetail(
  appraisalId: string
): Promise<(AppraisalData & { review_type?: string; cyclePhase: string; midyear: MidyearConfig }) | null> {
  const supabase = getSupabase();

  const { data: appraisal, error: appError } = await supabase
    .from("appraisals")
    .select("id, employee_id, manager_employee_id, division_id, cycle_id, status, is_management, review_type")
    .eq("id", appraisalId)
    .single();

  if (appError || !appraisal) return null;

  const { data: emp } = await supabase
    .from("employees")
    .select("full_name, email")
    .eq("employee_id", appraisal.employee_id)
    .single();

  const { data: cycle } = await supabase
    .from("appraisal_cycles")
    .select("*")
    .eq("id", appraisal.cycle_id)
    .single();

  const status = (appraisal.status as string) ?? "DRAFT";
  const needApprovals = status === "PENDING_APPROVAL";
  const needSignoffs = status === "PENDING_SIGNOFF" || status === "HR_REVIEW" || status === "COMPLETE";

  let approvals: { role: string }[] = [];
  let signoffs: { role: string; stage: string }[] = [];
  if (needApprovals) {
    const { data: a } = await supabase.from("appraisal_approvals").select("role").eq("appraisal_id", appraisal.id);
    approvals = a ?? [];
  }
  if (needSignoffs) {
    const { data: s } = await supabase
      .from("appraisal_signoffs")
      .select("role, stage, signed_at, comment")
      .eq("appraisal_id", appraisal.id);
    signoffs = (s ?? []).map((row: { role: string; stage: string; signed_at?: string; comment?: string | null }) => ({
      role: row.role,
      stage: row.stage,
      signed_at: row.signed_at ?? undefined,
      comment: row.comment ?? undefined,
    }));
  }

  let agreement: AppraisalAgreement | null = null;
  let managerName = "—";
  let managerEmail: string | null = null;
  let employeeEmail: string | null = emp?.email ?? null;
  let hrOfficerName = "—";
  let hrOfficerEmail: string | null = null;

  const needAgreement =
    status === "MANAGER_REVIEW" ||
    status === "PENDING_SIGNOFF" ||
    status === "HR_REVIEW" ||
    status === "COMPLETE";
  if (needAgreement) {
    const { data: agg } = await supabase
      .from("appraisal_agreements")
      .select("*")
      .eq("appraisal_id", appraisal.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (agg) agreement = agg as AppraisalAgreement;

    if (appraisal.manager_employee_id) {
      const { data: mgrRow } = await supabase
        .from("employees")
        .select("full_name, email")
        .eq("employee_id", appraisal.manager_employee_id)
        .single();
      if (mgrRow) {
        managerName = mgrRow.full_name ?? "—";
        managerEmail = mgrRow.email ?? null;
      }
    }
    const { data: hrRow } = await supabase
      .from("app_users")
      .select("employee_id, email, display_name")
      .in("role", ["hr", "admin"])
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (hrRow) {
      hrOfficerEmail = hrRow.email ?? null;
      hrOfficerName = hrRow.display_name ?? hrRow.email ?? "—";
      if (hrRow.employee_id) {
        const { data: hrEmp } = await supabase
          .from("employees")
          .select("full_name")
          .eq("employee_id", hrRow.employee_id)
          .single();
        if (hrEmp?.full_name) hrOfficerName = hrEmp.full_name;
      }
    }
  }

  const cycleData = cycle as Record<string, unknown> | null;
  return {
    id: appraisal.id,
    employee_id: appraisal.employee_id,
    manager_employee_id: appraisal.manager_employee_id ?? null,
    cycle_id: appraisal.cycle_id,
    status,
    is_management: appraisal.is_management ?? false,
    employeeName: emp?.full_name ?? "—",
    employeeEmail,
    managerName,
    managerEmail,
    hrOfficerName,
    hrOfficerEmail,
    cycleName: cycle?.name ?? "—",
    cycleStartDate: cycleData?.start_date != null ? String(cycleData.start_date) : undefined,
    cycleEndDate: cycleData?.end_date != null ? String(cycleData.end_date) : undefined,
    review_type: appraisal.review_type ?? undefined,
    cyclePhase: cycleData?.phase != null ? String(cycleData.phase) : "",
    midyear: midyearConfigFromRow(cycleData as Partial<MidyearCycleFields> | null),
    approvals,
    signoffs,
    agreement,
  };
}

function canAccessAppraisal(
  user: { roles?: string[]; employee_id?: string | null; division_id?: string | null } | null,
  appraisal: { employee_id: string; manager_employee_id: string | null; division_id?: string | null },
  hrmisEmployeeId: string | null,
  hasManagerAccess: boolean
): boolean {
  if (!user) return false;
  const roles = user.roles ?? [];
  const empId = hrmisEmployeeId ?? user.employee_id ?? null;
  const divId = user.division_id ?? null;

  if (roles.includes("hr") || roles.includes("admin")) return true;
  if (appraisal.employee_id === empId) return true;
  if (appraisal.manager_employee_id === empId) return true;
  if (hasManagerAccess) return true;
  if (roles.includes("gm") && divId && appraisal.division_id === divId) return true;

  return false;
}

function formatReviewType(type?: string): string {
  if (!type) return "Review";
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) + " Review";
}

function formatCycleDate(value?: string): string | null {
  if (!value) return null;
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

const ArrowLeftIcon = () => (
  <svg style={{ width: 14, height: 14 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
);

export default async function AppraisalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: appraisalId } = await params;
  const [user, appraisal] = await Promise.all([
    getCurrentUser(),
    getAppraisalDetail(appraisalId),
  ]);

  let currentUserStructure;
  try {
    currentUserStructure = await getReportingStructureFromDynamics(null, user?.email ?? null);
  } catch {
    currentUserStructure = await getReportingStructure(user?.employee_id ?? null);
  }
  const currentUserEmployeeId = currentUserStructure.currentUserSystemUserId ?? currentUserStructure.employee_id ?? user?.employee_id ?? null;

  // Troubleshooting: employee id resolution (server log — check terminal)
  console.log("[Appraisal page] employee id resolution", {
    appraisalEmployeeId: appraisal?.employee_id,
    currentUserSystemUserId: currentUserStructure.currentUserSystemUserId,
    currentUserXrmEmployeeId: currentUserStructure.employee_id,
    userEmployeeId: user?.employee_id,
    resolvedCurrentUserEmployeeId: currentUserEmployeeId,
    match: appraisal ? currentUserEmployeeId === appraisal.employee_id : null,
  });

  if (!appraisal) {
    notFound();
  }

  const supabase = getSupabase();
  const managerAccess = await resolveManagerAccessForAppraisal({
    supabase,
    appraisalId: appraisal.id,
    appraisalEmployeeId: appraisal.employee_id,
    appraisalManagerEmployeeId: appraisal.manager_employee_id,
    currentEmployeeId: currentUserEmployeeId,
  });
  const directAccess = canAccessAppraisal(user, appraisal, currentUserEmployeeId, managerAccess.hasManagerAccess);
  const oversight = !directAccess && (await hasOversightReadAccess(user, appraisal));
  if (!directAccess && !oversight) {
    notFound();
  }

  const roles = user?.roles ?? [];
  const isManager = !oversight && (managerAccess.hasManagerAccess || roles.includes("manager"));
  const isHR = !oversight && (roles.includes("hr") || roles.includes("admin"));
  const hodSystemUserId = oversight ? null : await resolveDepartmentHeadSystemUserId(appraisal.employee_id);
  const isHOD =
    !oversight &&
    ((hodSystemUserId != null && hodSystemUserId === currentUserEmployeeId) ||
      roles.includes("gm") ||
      roles.includes("admin"));
  const tabsAppraisal: typeof appraisal = oversight
    ? {
        ...appraisal,
        agreement: appraisal.agreement
          ? {
              id: appraisal.agreement.id,
              status: appraisal.agreement.status,
              employee_signed_at: appraisal.agreement.employee_signed_at ?? null,
              manager_signed_at: appraisal.agreement.manager_signed_at ?? null,
              hr_signed_at: appraisal.agreement.hr_signed_at ?? null,
            }
          : null,
        signoffs: (appraisal.signoffs ?? []).map(({ role, stage, signed_at }) => ({ role, stage, signed_at })),
      }
    : appraisal;

  let structure;
  try {
    structure = await getReportingStructureFromDynamics(appraisal.employee_id, user?.email ?? null);
  } catch {
    structure = await getReportingStructure(appraisal.employee_id);
  }
  const hasDirectReports = (structure.directReports?.length ?? 0) > 0;
  const showLeadership = appraisal.is_management || hasDirectReports;

  let hrRecommendationsSaved = false;
  if (appraisal.status === "HR_REVIEW" && isHR) {
    const supabase = getSupabase();
    const { data } = await supabase
      .from("appraisal_hr_recommendations")
      .select("id")
      .eq("appraisal_id", appraisal.id)
      .maybeSingle();
    hrRecommendationsSaved = !!data;
  }

  let formalMidyearReview: FormalReviewLike | null = null;
  if (appraisal.midyear.enabled) {
    const { data: formalRows } = await supabase
      .from("check_ins")
      .select("status, review_mode, created_at")
      .eq("appraisal_id", appraisal.id)
      .in("review_mode", ["FORMAL", "FORMAL_SCORED"])
      .order("created_at", { ascending: false });
    const current = pickCurrentFormalReview((formalRows ?? []) as FormalReviewLike[]);
    formalMidyearReview = current ? { status: current.status, review_mode: current.review_mode ?? null } : null;
  }

  const status = statusConfig[appraisal.status] ?? statusConfig.DRAFT;
  const statusTone = statusToneClasses[status.tone];
  const effectiveStatus = appraisal.status === "SUBMITTED" ? "MANAGER_REVIEW" : appraisal.status;
  const currentStepIndex = WORKFLOW_STEPS.findIndex((s) => s.status === effectiveStatus);
  const safeStepIndex = currentStepIndex >= 0 ? currentStepIndex : 0;

  const periodStart = formatCycleDate(appraisal.cycleStartDate);
  const periodEnd = formatCycleDate(appraisal.cycleEndDate);
  const metadata: { label: string; value: string }[] = [
    { label: "Review", value: formatReviewType(appraisal.review_type) },
    { label: "Cycle", value: appraisal.cycleName },
    ...(periodStart && periodEnd ? [{ label: "Period", value: `${periodStart} – ${periodEnd}` }] : []),
    ...(appraisal.managerName && appraisal.managerName !== "—" ? [{ label: "Manager", value: appraisal.managerName }] : []),
  ];

  return (
    <div className="w-full">
      <Link
        href="/appraisals"
        className="mb-3 inline-flex items-center gap-1.5 rounded-[4px] text-[13px] font-medium text-ds-text-secondary no-underline transition-colors duration-100 hover:text-ds-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus focus-visible:ring-offset-2"
      >
        <ArrowLeftIcon />
        Back to Appraisals
      </Link>

      <header className="mb-4 border-b border-ds-border pb-4" data-appraisal-header>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="m-0 text-ds-page-title tracking-[-0.01em] text-ds-text-primary">{appraisal.employeeName}</h1>
          <span
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-ds-badge border px-1.5 py-0.5 text-xs font-medium leading-4 ${statusTone.badge}`}
            data-appraisal-status
          >
            <span className={`h-1.5 w-1.5 rounded-full ${statusTone.dot}`} aria-hidden="true" />
            <span className="sr-only">Status: </span>
            {status.label}
          </span>
        </div>
        <dl className="mt-2 flex flex-wrap items-center gap-y-1 text-[13px] leading-[1.45]">
          {metadata.map((item, i) => (
            <div
              key={item.label}
              className={`flex items-baseline gap-1.5 ${i > 0 ? "ml-3 border-l border-ds-border pl-3" : ""}`}
            >
              <dt className="text-ds-text-secondary">{item.label}</dt>
              <dd className="m-0 font-medium text-ds-text-primary">{item.value}</dd>
            </div>
          ))}
        </dl>
      </header>

      {oversight && (
        <div
          data-oversight-banner
          role="note"
          className="mb-4 rounded-ds-panel border border-ds-border bg-ds-surface px-4 py-3 text-[13px] leading-[1.45]"
        >
          <p className="m-0 font-medium text-ds-text-primary">Read-only oversight</p>
          <p className="m-0 mt-0.5 text-ds-text-secondary">
            You can view this appraisal because this employee is within your reporting hierarchy.
          </p>
        </div>
      )}

      <div className="w-full">
        <AppraisalWorkflowSteps
          currentStepIndex={safeStepIndex}
          inProgressMilestone={
            appraisal.midyear.enabled ? (
              <MidyearSubStatus
                appraisalId={appraisal.id}
                scoringEnabled={appraisal.midyear.scoringEnabled}
                initialReview={formalMidyearReview}
              />
            ) : undefined
          }
        />

        {!oversight && (
          <CompletionBarWrapperClient
            appraisalId={appraisal.id}
            status={appraisal.status as AppraisalStatus}
            userRole={isHR ? "HR" : roles.includes("gm") ? "HOD" : appraisal.manager_employee_id === currentUserEmployeeId ? "MANAGER" : currentUserEmployeeId === appraisal.employee_id ? "EMPLOYEE" : "MANAGER"}
            showLeadership={showLeadership}
            isEmployee={currentUserEmployeeId === appraisal.employee_id}
            isManager={appraisal.manager_employee_id === currentUserEmployeeId}
            isHR={isHR}
            approvals={appraisal.approvals}
            signoffs={appraisal.signoffs}
          />
        )}

        <AppraisalTabs
        appraisal={tabsAppraisal}
        cyclePhase={appraisal.cyclePhase}
        currentUserId={user?.id ?? null}
        currentUserEmployeeId={currentUserEmployeeId}
        isManager={isManager}
        isDelegated={!oversight && managerAccess.isDelegated}
        isPrimaryManager={!oversight && managerAccess.isPrimaryManager}
        delegatedByName={appraisal.managerName ?? null}
        isHR={isHR}
        isHOD={isHOD}
        showLeadership={showLeadership}
        approvals={appraisal.approvals}
        signoffs={tabsAppraisal.signoffs}
        hrRecommendationsSaved={hrRecommendationsSaved}
        midyearEnabled={appraisal.midyear.enabled}
        readOnly={oversight}
      />
      </div>
    </div>
  );
}
