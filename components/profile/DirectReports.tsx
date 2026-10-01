"use client";

import { useState, useCallback } from "react";
import { ReportingPerson } from "@/lib/reporting-structure";
import { avatarAccent } from "@/lib/avatar-accent";

interface DirectReportsProps {
  reports: ReportingPerson[];
}

function getInitials(fullname: string): string {
  return fullname
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

const UsersIcon = () => (
  <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const ChevronRightIcon = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const EmptyUsersIcon = () => (
  <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

interface PersonCardProps {
  person: ReportingPerson;
  index: number;
  isDropdownOpen?: boolean;
  indirectReports?: ReportingPerson[] | null;
  isLoadingIndirect?: boolean;
  onChevronClick?: () => void;
}

function PersonCard({
  person,
  index,
  isDropdownOpen,
  indirectReports,
  isLoadingIndirect,
  onChevronClick,
}: PersonCardProps) {
  const initials = getInitials(person.full_name || "??");
  const showDropdown = !!isDropdownOpen;

  return (
    <div className="space-y-1.5">
      <div
        className="group flex cursor-pointer items-center gap-3 rounded-ds-panel px-4 py-3 transition-all duration-200 hover:translate-x-1 hover:bg-white"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border-color)",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = "var(--accent-bright)";
          e.currentTarget.style.boxShadow = "var(--shadow-hover)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = "var(--border-color)";
          e.currentTarget.style.boxShadow = "none";
        }}
      >
        {/* Avatar */}
        <div
          className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full text-[13px] font-semibold"
          style={avatarAccent(person.full_name).style}
        >
          {initials}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-[13.5px] font-semibold text-text-primary truncate">
            {person.full_name || "Unknown"}
          </p>
          {person.job_title && (
            <p className="text-[11.5px] text-text-secondary truncate">
              {person.job_title}
            </p>
          )}
          {person.email && (
            <p className="text-[11px] text-text-muted truncate">{person.email}</p>
          )}
        </div>

        {/* Chevron - opens dropdown of who reports to this person */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onChevronClick?.();
          }}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-muted transition-all group-hover:bg-accent group-hover:text-white"
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border-color)",
          }}
          aria-expanded={isDropdownOpen}
          aria-label={isDropdownOpen ? "Close" : "See who reports to this person"}
        >
          {isLoadingIndirect ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />
          ) : (
            <ChevronRightIcon />
          )}
        </button>
      </div>

      {/* Dropdown: who reports to this person */}
      {showDropdown && (
        <div
          className="rounded-ds-panel border pl-4 pr-3 py-2 ml-2"
          style={{
            background: "var(--surface)",
            borderColor: "var(--border-color)",
            borderLeftWidth: "2px",
            borderLeftColor: "var(--accent-bright)",
          }}
        >
          {isLoadingIndirect ? (
            <p className="text-[12px] text-text-muted py-2">Loading…</p>
          ) : indirectReports == null || indirectReports.length === 0 ? (
            <p className="text-[12px] text-text-muted py-2">No direct reports.</p>
          ) : (
            <ul className="space-y-1.5">
              {(indirectReports ?? []).map((sub, subIdx) => {
                const subInitials = getInitials(sub.full_name || "??");
                return (
                  <li
                    key={sub.employee_id}
                    className="flex items-center gap-3 py-2 px-2 rounded-md"
                    style={{ background: "var(--surface-2)" }}
                  >
                    <div
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold"
                      style={avatarAccent(sub.full_name).style}
                    >
                      {subInitials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12.5px] font-medium text-text-primary truncate">
                        {sub.full_name || "Unknown"}
                      </p>
                      {sub.job_title && (
                        <p className="text-[11px] text-text-secondary truncate">{sub.job_title}</p>
                      )}
                      {sub.email && (
                        <p className="text-[10.5px] text-text-muted truncate">{sub.email}</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function DirectReports({ reports }: DirectReportsProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [indirectCache, setIndirectCache] = useState<Record<string, ReportingPerson[] | null>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const handleChevronClick = useCallback(async (employeeId: string) => {
    if (expandedId === employeeId) {
      setExpandedId(null);
      return;
    }
    if (indirectCache[employeeId] !== undefined) {
      setExpandedId(employeeId);
      return;
    }
    setLoadingId(employeeId);
    setExpandedId(employeeId);
    try {
      const res = await fetch(
        `/api/reporting/direct-reports?employeeId=${encodeURIComponent(employeeId)}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to load");
      setIndirectCache((prev) => ({
        ...prev,
        [employeeId]: Array.isArray(data) ? data : null,
      }));
    } catch {
      setIndirectCache((prev) => ({ ...prev, [employeeId]: null }));
    } finally {
      setLoadingId(null);
    }
  }, [expandedId, indirectCache]);

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
        className="flex items-center justify-between px-[22px] py-4"
        style={{ borderBottom: "1px solid var(--border-color)" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-[9px]"
            style={{ backgroundColor: "#f1f4f7" }}
          >
            <span style={{ color: "#3d5a78" }}>
              <UsersIcon />
            </span>
          </div>
          <h2 className="font-display text-[15px] font-semibold text-text-primary">
            People Reporting to You
          </h2>
        </div>

        {/* Count badge */}
        <span
          className="inline-flex items-center gap-1.5 rounded-ds-badge px-2.5 py-1 text-xs font-semibold"
          style={{
            backgroundColor: "var(--surface-2)",
            border: "1px solid var(--border-color)",
          }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: "#3d5a78" }}
          />
          {reports.length}
        </span>
      </div>

      {/* Content */}
      <div className="p-2">
        {reports.length === 0 ? (
          <div className="flex flex-col items-center py-8 px-6 text-center">
            <div
              className="flex h-[52px] w-[52px] items-center justify-center rounded-full"
              style={{ backgroundColor: "var(--surface-2)" }}
            >
              <span className="text-text-muted">
                <EmptyUsersIcon />
              </span>
            </div>
            <h3 className="mt-4 text-sm font-semibold text-text-primary">
              No direct reports
            </h3>
            <p className="mt-1 max-w-[220px] text-[12.5px] leading-relaxed text-text-muted">
              You have no employees currently reporting to you.
            </p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {reports.map((person, idx) => (
              <PersonCard
                key={person.employee_id}
                person={person}
                index={idx}
                isDropdownOpen={expandedId === person.employee_id}
                indirectReports={indirectCache[person.employee_id]}
                isLoadingIndirect={loadingId === person.employee_id}
                onChevronClick={() => handleChevronClick(person.employee_id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
