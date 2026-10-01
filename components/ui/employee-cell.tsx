"use client";

import { cn } from "@/lib/utils";
import { avatarAccent } from "@/lib/avatar-accent";

interface EmployeeCellProps {
  name: string;
  email?: string;
  className?: string;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function EmployeeCell({ name, email, className }: EmployeeCellProps) {
  const initials = getInitials(name);

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <div
        className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-medium", avatarAccent(name).className)}
        aria-hidden="true"
      >
        {initials}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ds-text-primary">{name}</p>
        {email && <p className="truncate text-xs text-ds-text-secondary">{email}</p>}
      </div>
    </div>
  );
}
