"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface CheckInsLinkProps {
  appraisalId: string;
  isManager: boolean;
  isEmployee: boolean;
  isHR: boolean;
}

export function CheckInsLink({ appraisalId, isManager, isEmployee, isHR }: CheckInsLinkProps) {
  const [openCheckInCount, setOpenCheckInCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/appraisals/${appraisalId}/checkins`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled || !data.checkIns) return;
        const list = data.checkIns as Array<{ status: string }>;
        const managerOrHR = isManager || isHR;
        let count = 0;
        for (const c of list) {
          if (c.status === "OPEN" && isEmployee) count++;
          if (c.status === "EMPLOYEE_SUBMITTED" && managerOrHR) count++;
        }
        setOpenCheckInCount(count);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [appraisalId, isManager, isEmployee, isHR]);

  return (
    <Link href={`/appraisals/${appraisalId}/checkins`}>
      <button
        type="button"
        className="inline-flex items-center gap-2 px-4 py-2 rounded-[8px] border border-ds-border text-[11px] font-semibold text-ds-text-secondary hover:border-ds-accent hover:text-ds-accent transition-colors"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
        </svg>
        Check-ins
        {openCheckInCount > 0 && (
          <span className="w-4 h-4 rounded-full bg-ds-warning text-white text-[9px] font-semibold flex items-center justify-center flex-shrink-0">
            {openCheckInCount}
          </span>
        )}
      </button>
    </Link>
  );
}
