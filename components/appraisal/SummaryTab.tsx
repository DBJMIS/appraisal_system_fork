"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import { AppraisalData } from "./AppraisalTabs";
import type { SummaryResult } from "@/lib/summary-calc";
import SummaryTabContent from "./SummaryTabContent";
import { AppraisalSectionSkeleton } from "./AppraisalSectionSkeleton";

interface SummaryTabProps {
  appraisalId: string;
  appraisal: AppraisalData;
  showLeadership: boolean;
  isHR: boolean;
  isManager: boolean;
  isEmployee: boolean;
  currentUserEmployeeId: string | null;
  /** Optional: called when summary result is available (e.g. for tab indicator dot). */
  onSummaryResult?: (result: SummaryResult) => void;
  /** Incremented when user switches to Summary tab; triggers refetch. */
  refreshKey?: number;
}

export function SummaryTab({
  appraisalId,
  appraisal,
  showLeadership,
  isHR,
  isManager,
  isEmployee,
  currentUserEmployeeId,
  onSummaryResult,
  refreshKey = 0,
}: SummaryTabProps) {
  const [loading, setLoading] = useState(true);
  const [employee, setEmployee] = useState<{
    full_name: string | null;
    employee_id: string;
    division_name: string | null;
  } | null>(null);
  const [cycle, setCycle] = useState<{ name: string; fiscal_year: string } | null>(null);
  const [summaryResult, setSummaryResult] = useState<SummaryResult | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    try {
      const { data: appData } = await supabase
        .from("appraisals")
        .select("employee_id, cycle_id")
        .eq("id", appraisalId)
        .single();
      const app = appData ?? { employee_id: appraisal.employee_id, cycle_id: appraisal.cycle_id };

      const [empRes, cycleRes, summaryRes] = await Promise.all([
        supabase.from("employees").select("full_name, employee_id, division_name").eq("employee_id", app.employee_id).single(),
        supabase.from("appraisal_cycles").select("name, fiscal_year").eq("id", app.cycle_id).single(),
        fetch(`/api/appraisals/${appraisalId}/summary?showLeadership=${showLeadership ? "true" : "false"}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
      ]);

      if (empRes.data) setEmployee(empRes.data);
      else setEmployee({ full_name: appraisal.employeeName, employee_id: appraisal.employee_id, division_name: null });
      if (cycleRes.data) setCycle(cycleRes.data);
      else setCycle({ name: appraisal.cycleName, fiscal_year: "" });
      if (summaryRes && !summaryRes.error) setSummaryResult(summaryRes as SummaryResult);
      else setSummaryResult(null);
    } finally {
      setLoading(false);
    }
  }, [appraisalId, showLeadership, appraisal]);

  useEffect(() => {
    loadData();
  }, [loadData, refreshKey]);

  useEffect(() => {
    const handler = () => loadData();
    window.addEventListener("appraisal-completion-invalidate", handler);
    return () => window.removeEventListener("appraisal-completion-invalidate", handler);
  }, [loadData]);

  const displayResult: SummaryResult = summaryResult ?? {
    components: [],
    totalWeight: 100,
    totalPoints: 0,
    overallPct: 0,
    overallGrade: "E",
    gradeBand: "—",
    isManagementTrack: showLeadership,
  };
  const isEmptyScore = displayResult.totalPoints === 0 || displayResult.components.every((c) => c.actual === 0);

  useEffect(() => {
    if (onSummaryResult) onSummaryResult(displayResult);
  }, [displayResult, onSummaryResult]);

  return loading ? (
    <AppraisalSectionSkeleton variant="summary" label="Loading summary…" />
  ) : (
    <SummaryTabContent
      employee={employee}
      cycle={cycle}
      appraisal={appraisal}
      summaryResult={displayResult}
      isEmptyScore={isEmptyScore}
    />
  );
}
