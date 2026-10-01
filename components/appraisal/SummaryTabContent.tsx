"use client";

import React from "react";
import { cn } from "@/utils/cn";
import { AppraisalData } from "./AppraisalTabs";
import { GRADE_BANDS, type GradeLetter, type SummaryResult } from "@/lib/summary-calc";
import { statusConfig, statusToneClasses } from "@/lib/appraisal-status-display";
import { dedupeFiscalYearPrefix } from "@/lib/midyear-config";

export interface SummaryTabContentProps {
  employee: { full_name: string | null; employee_id: string; division_name: string | null } | null;
  cycle: { name: string; fiscal_year: string } | null;
  appraisal: AppraisalData;
  summaryResult: SummaryResult;
  isEmptyScore: boolean;
}

function formatReviewType(reviewType?: string): string {
  if (reviewType === "mid_year") return "Mid Year";
  if (reviewType === "quarterly") return "Quarterly";
  return "Annual";
}

const GRADE_LETTERS = ["A", "B", "C", "D", "E"] as const;
const GRADE_MULTIPLIER: Record<GradeLetter, string> = { A: "×1.0", B: "×0.8", C: "×0.6", D: "×0.4", E: "×0.2" };

/** Semantic support for the grade letter only; surfaces stay neutral. */
const GRADE_TEXT: Record<GradeLetter, string> = {
  A: "text-ds-success",
  B: "text-ds-success",
  C: "text-ds-text-primary",
  D: "text-ds-warning",
  E: "text-ds-error",
};

const thClass = "border-b border-ds-border bg-ds-surface px-3 py-2 text-xs font-medium text-ds-text-secondary whitespace-nowrap";
const tdClass = "border-b border-ds-border px-3 py-2.5 align-top text-[13px]";

function ResultLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-medium text-ds-text-secondary">{children}</div>;
}

export default function SummaryTabContent({
  employee,
  cycle,
  appraisal,
  summaryResult,
  isEmptyScore,
}: SummaryTabContentProps) {
  const status = statusConfig[appraisal.status] ?? statusConfig.DRAFT;
  const trackLabel = summaryResult.isManagementTrack ? "Management Track" : "Non-Management Track";
  const metadata: { label: string; value: string }[] = [
    { label: "Employee", value: employee?.full_name ?? "—" },
    { label: "Division", value: employee?.division_name ?? "—" },
    { label: "Fiscal year", value: dedupeFiscalYearPrefix(`FY ${cycle?.fiscal_year ?? "—"}`) },
    { label: "Review", value: formatReviewType((appraisal as { review_type?: string }).review_type) },
    { label: "Track", value: trackLabel },
  ];

  return (
    <div className="flex w-full flex-col gap-6">
      {/* Overall result */}
      <section aria-labelledby="summary-overall-heading" className="rounded-ds-panel border border-ds-border bg-ds-background">
        <h2 id="summary-overall-heading" className="sr-only">Overall appraisal result</h2>
        <div className="grid grid-cols-1 divide-y divide-ds-border sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] sm:divide-x sm:divide-y-0">
          <div className="px-5 py-4">
            <ResultLabel>Overall score</ResultLabel>
            {isEmptyScore ? (
              <p className="m-0 mt-2 text-[13px] text-ds-text-secondary">Scores will appear here once ratings are entered</p>
            ) : (
              <div className="mt-1 flex items-baseline gap-1.5">
                <span data-summary-total className="text-[40px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-ds-text-primary">
                  {summaryResult.totalPoints.toFixed(1)}
                </span>
                <span className="text-[13px] text-ds-text-secondary">/ 100</span>
              </div>
            )}
          </div>
          <div className="px-5 py-4">
            <ResultLabel>Grade</ResultLabel>
            {isEmptyScore ? (
              <p className="m-0 mt-2 text-[13px] text-ds-text-secondary">—</p>
            ) : (
              <div className="mt-1 flex items-baseline gap-2">
                <span data-summary-grade className={cn("text-[28px] font-semibold leading-none", GRADE_TEXT[summaryResult.overallGrade])}>
                  {summaryResult.overallGrade}
                </span>
                <span className="text-[14px] font-medium text-ds-text-primary">{summaryResult.gradeBand}</span>
              </div>
            )}
          </div>
          <div className="px-5 py-4">
            <ResultLabel>Status</ResultLabel>
            <span
              className={cn(
                "mt-2 inline-flex items-center rounded-ds-badge border px-2 py-0.5 text-xs font-medium",
                statusToneClasses[status.tone].badge
              )}
            >
              {status.label}
            </span>
          </div>
        </div>
        <dl className="m-0 flex flex-wrap gap-x-6 gap-y-1 border-t border-ds-border px-5 py-3 text-[13px]">
          {metadata.map((item) => (
            <div key={item.label} className="flex items-baseline gap-1.5">
              <dt className="text-ds-text-secondary">{item.label}</dt>
              <dd className="m-0 font-medium text-ds-text-primary">{item.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Section results */}
      <section aria-labelledby="summary-sections-heading">
        <div className="mb-3">
          <h2 id="summary-sections-heading" className="m-0 text-ds-section text-ds-text-primary">
            Section A — Overall Performance Score
          </h2>
          <p className="m-0 mt-0.5 text-[13px] text-ds-text-secondary">
            {summaryResult.isManagementTrack ? "Management" : "Non-Management"} track · Weighted score calculation
          </p>
        </div>
        <div className="overflow-hidden rounded-ds-panel border border-ds-border bg-ds-background">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th rowSpan={2} className={cn(thClass, "min-w-[200px] text-left align-bottom")}>Component</th>
                  <th rowSpan={2} className={cn(thClass, "text-right align-bottom")}>Weight</th>
                  <th rowSpan={2} className={cn(thClass, "border-l text-right align-bottom")}>Actual %</th>
                  <th rowSpan={2} className={cn(thClass, "text-right align-bottom")}>Points</th>
                  <th rowSpan={2} className={cn(thClass, "text-left align-bottom")}>Grade</th>
                  <th colSpan={5} className={cn(thClass, "border-b-0 border-l pb-0 text-center")}>Grade thresholds (points)</th>
                </tr>
                <tr>
                  {GRADE_LETTERS.map((letter, i) => (
                    <th key={letter} className={cn(thClass, "pt-1 text-right font-normal text-ds-text-secondary", i === 0 && "border-l")}>
                      {letter} ({GRADE_MULTIPLIER[letter]})
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {summaryResult.components.map((c) => (
                  <tr key={c.key}>
                    <td className={tdClass}>
                      <div className="text-[14px] font-medium leading-[1.4] text-ds-text-primary">{c.name}</div>
                      <div className="mt-0.5 text-xs text-ds-text-secondary">{c.sub}</div>
                    </td>
                    <td className={cn(tdClass, "text-right tabular-nums text-ds-text-primary")}>{c.weight}</td>
                    <td className={cn(tdClass, "border-l text-right tabular-nums text-ds-text-primary")}>
                      {isEmptyScore ? <span className="text-ds-text-secondary">—</span> : `${c.actual}%`}
                    </td>
                    <td className={cn(tdClass, "text-right font-semibold tabular-nums text-ds-text-primary")}>
                      {isEmptyScore ? <span className="font-normal text-ds-text-secondary">—</span> : c.points.toFixed(1)}
                    </td>
                    <td className={tdClass}>
                      {isEmptyScore ? (
                        <span className="text-ds-text-secondary">—</span>
                      ) : (
                        <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
                          <span className={cn("font-semibold", GRADE_TEXT[c.grade])}>{c.grade}</span>
                          <span className="text-xs text-ds-text-secondary">{GRADE_BANDS[c.grade].short}</span>
                        </span>
                      )}
                    </td>
                    {GRADE_LETTERS.map((letter, i) => (
                      <td key={letter} className={cn(tdClass, "text-right text-xs tabular-nums text-ds-text-secondary", i === 0 && "border-l")}>
                        {c.gradeThresholds[letter].toFixed(1)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-ds-surface">
                  <td className="px-3 py-2.5 text-[13px] font-semibold text-ds-text-primary">Total</td>
                  <td className="px-3 py-2.5 text-right text-[13px] font-semibold tabular-nums text-ds-text-primary">{summaryResult.totalWeight}</td>
                  <td className="border-l border-ds-border px-3 py-2.5 text-right text-[13px] font-semibold tabular-nums text-ds-text-primary">
                    {isEmptyScore ? "—" : `${summaryResult.totalPoints.toFixed(1)}%`}
                  </td>
                  <td className="px-3 py-2.5 text-right text-[15px] font-semibold tabular-nums text-ds-text-primary">
                    {isEmptyScore ? "—" : summaryResult.totalPoints.toFixed(1)}
                  </td>
                  <td className="px-3 py-2.5 text-[13px]">
                    {isEmptyScore ? (
                      <span className="text-ds-text-secondary">—</span>
                    ) : (
                      <span className={cn("font-semibold", GRADE_TEXT[summaryResult.overallGrade])}>{summaryResult.overallGrade}</span>
                    )}
                  </td>
                  <td colSpan={5} className="border-l border-ds-border px-3 py-2.5" />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </section>

      {/* Grade scale */}
      <section aria-labelledby="summary-scale-heading">
        <h2 id="summary-scale-heading" className="m-0 mb-2 text-[14px] font-semibold text-ds-text-primary">
          Rating definitions
        </h2>
        <ol className="m-0 list-none divide-y divide-ds-border rounded-ds-panel border border-ds-border bg-ds-background p-0">
          {GRADE_LETTERS.map((letter) => {
            const band = GRADE_BANDS[letter];
            const isActive = !isEmptyScore && summaryResult.overallGrade === letter;
            return (
              <li
                key={letter}
                aria-current={isActive ? "true" : undefined}
                className={cn(
                  "grid grid-cols-[32px_minmax(0,1fr)_auto] items-baseline gap-3 px-4 py-2 text-[13px]",
                  isActive && "bg-ds-surface"
                )}
              >
                <span className={cn("font-semibold", GRADE_TEXT[letter])}>{letter}</span>
                <span className={cn("text-ds-text-primary", isActive ? "font-semibold" : "font-medium")}>
                  {band.label}
                  {isActive && <span className="ml-2 text-xs font-medium text-ds-text-secondary">Current grade</span>}
                </span>
                <span className="tabular-nums text-ds-text-secondary">{band.range}</span>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
