"use client";

import { useEffect, useState } from "react";

/**
 * Readiness for Submit for Approval, taken from GET /api/appraisals/[id]/completion.
 * `canSubmit` and `blockers` are exactly what the completion endpoint returns; nothing is recalculated here.
 * Re-fetches whenever a section dispatches "appraisal-completion-invalidate".
 */
export function useDraftSubmitReadiness(appraisalId: string, enabled: boolean, showLeadership: boolean) {
  const [canSubmit, setCanSubmit] = useState<boolean | null>(null);
  const [blockers, setBlockers] = useState<string[]>([]);

  useEffect(() => {
    if (!enabled || !appraisalId) {
      setCanSubmit(null);
      setBlockers([]);
      return;
    }
    let cancelled = false;
    const fetchCanSubmit = () => {
      fetch(`/api/appraisals/${appraisalId}/completion?showLeadership=${showLeadership ? "true" : "false"}`, { cache: "no-store" })
        .then((res) => res.ok ? res.json() : null)
        .then((data) => {
          if (!cancelled && data && typeof data.canSubmit === "boolean") {
            setCanSubmit(data.canSubmit);
            setBlockers(Array.isArray(data.blockers) ? data.blockers.filter((b: unknown): b is string => typeof b === "string") : []);
          } else {
            setCanSubmit(false);
            setBlockers([]);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setCanSubmit(false);
            setBlockers([]);
          }
        });
    };
    fetchCanSubmit();
    const onInvalidate = () => fetchCanSubmit();
    window.addEventListener("appraisal-completion-invalidate", onInvalidate);
    return () => {
      cancelled = true;
      window.removeEventListener("appraisal-completion-invalidate", onInvalidate);
    };
  }, [enabled, appraisalId, showLeadership]);

  return { canSubmit, blockers };
}
