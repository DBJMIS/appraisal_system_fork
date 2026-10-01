"use client";

import { ReportingPerson } from "@/lib/reporting-structure";

interface DivisionCardProps {
  divisionName: string | null;
  departmentName: string | null;
  divisionHead: ReportingPerson | null;
  isActive: boolean;
}

const BuildingIcon = () => (
  <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
    <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
    <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
    <path d="M10 6h4" />
    <path d="M10 10h4" />
    <path d="M10 14h4" />
    <path d="M10 18h4" />
  </svg>
);

interface FieldRowProps {
  label: string;
  children: React.ReactNode;
  isLast?: boolean;
}

function FieldRow({ label, children, isLast }: FieldRowProps) {
  return (
    <div
      className="flex items-start gap-3 px-[22px] py-2.5 transition-colors hover:bg-surface"
      style={{
        borderBottom: isLast ? undefined : "1px solid var(--border-color)",
      }}
    >
      <span
        className="shrink-0 text-[11.5px] font-semibold uppercase tracking-wide text-text-muted"
        style={{ minWidth: "110px", letterSpacing: "0.03em" }}
      >
        {label}
      </span>
      <div className="flex-1 text-[13.5px] text-text-primary">{children}</div>
    </div>
  );
}

export function DivisionCard({
  divisionName,
  departmentName,
  divisionHead,
  isActive,
}: DivisionCardProps) {
  return (
    <div
      className="overflow-hidden rounded-ds-panel bg-white"
      style={{
        boxShadow: "var(--shadow-card)",
        border: "1px solid var(--border-color)",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 px-[22px] py-4"
        style={{ borderBottom: "1px solid var(--border-color)" }}
      >
        <div
          className="flex h-8 w-8 items-center justify-center rounded-[9px]"
          style={{ backgroundColor: "#f3f3f3" }}
        >
          <span style={{ color: "var(--teal)" }}>
            <BuildingIcon />
          </span>
        </div>
        <h2 className="font-display text-[15px] font-semibold text-text-primary">
          Division &amp; Department
        </h2>
      </div>

      {/* Fields */}
      <div className="mt-2">
        <FieldRow label="Division">
          <span className="font-semibold">
            {divisionName || <span className="text-text-muted italic font-normal">Not assigned</span>}
          </span>
        </FieldRow>
        <FieldRow label="Division Head" isLast>
          {divisionHead ? (
            <div>
              <span className="font-medium">{divisionHead.full_name}</span>
              {divisionHead.job_title && (
                <span className="text-text-muted text-xs block">{divisionHead.job_title}</span>
              )}
            </div>
          ) : (
            <span className="text-text-muted italic">Not assigned</span>
          )}
        </FieldRow>
      </div>
    </div>
  );
}
