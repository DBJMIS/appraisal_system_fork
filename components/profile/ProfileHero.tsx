"use client";

import { avatarAccent } from "@/lib/avatar-accent";

interface ProfileHeroProps {
  fullName: string;
  jobTitle: string | null;
  divisionName: string | null;
  isActive: boolean;
  directReportsCount: number;
}

function getInitials(fullname: string): string {
  return fullname
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function ProfileHero({
  fullName,
  jobTitle,
  divisionName,
  isActive,
  directReportsCount,
}: ProfileHeroProps) {
  const initials = getInitials(fullName);

  return (
    <div className="border-b border-ds-border px-8 py-6">
      <div className="flex items-center gap-5">
        <div className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full border text-[22px] font-semibold ${avatarAccent(fullName).className}`}>
          {initials}
        </div>

        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-[24px] font-medium leading-[1.2] text-ds-text-primary">{fullName}</h1>
          <p className="m-0 mt-1 text-[14px] text-ds-text-secondary">{jobTitle || "No job title assigned"}</p>

          <div className="mt-3 flex flex-wrap gap-2">
            {divisionName && (
              <span className="inline-flex items-center rounded-ds-badge border border-ds-border bg-ds-surface px-2 py-0.5 text-xs font-medium text-ds-text-secondary">
                {divisionName}
              </span>
            )}
            <span
              className={
                isActive
                  ? "inline-flex items-center rounded-ds-badge border border-ds-success-border bg-ds-success-subtle px-2 py-0.5 text-xs font-medium text-ds-success"
                  : "inline-flex items-center rounded-ds-badge border border-ds-error-border bg-ds-error-subtle px-2 py-0.5 text-xs font-medium text-ds-error"
              }
            >
              {isActive ? "Active" : "Inactive"}
            </span>
            {directReportsCount > 0 && (
              <span className="inline-flex items-center rounded-ds-badge border border-ds-border bg-ds-surface px-2 py-0.5 text-xs font-medium text-ds-text-secondary">
                {directReportsCount} Report{directReportsCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
