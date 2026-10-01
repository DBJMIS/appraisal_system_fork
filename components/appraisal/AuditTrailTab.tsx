"use client";

import { useState, useEffect } from "react";

export interface AuditTrailTabProps {
  appraisalId: string;
}

export interface AuditEvent {
  id: string;
  action_type: string;
  acted_at: string;
  summary: string;
  actor_id: string | null;
  actor_name: string;
}

function formatDateTime(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

const ACTION_LABELS: Record<string, string> = {
  status_change: "Status change",
  approval: "Approval",
  signoff: "Sign-off",
  check_in_created: "Check-in",
  hr_recommendations_saved: "HR recommendations",
  midyear_created: "Mid-Year Review created",
  midyear_employee_submitted: "Mid-Year Review submitted",
  midyear_manager_reviewed: "Mid-Year Review manager reviewed",
  midyear_completed: "Mid-Year Review completed",
  midyear_cancelled: "Mid-Year Review cancelled",
  score_snapshot_recorded: "Score recorded",
};

function formatActionType(actionType: string): string {
  if (ACTION_LABELS[actionType]) return ACTION_LABELS[actionType];
  const text = actionType.replace(/_/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Activity";
}

export function AuditTrailTab({ appraisalId }: AuditTrailTabProps) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!appraisalId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    fetch(`/api/appraisals/${appraisalId}/audit`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        setEvents(Array.isArray(data?.events) ? data.events : []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [appraisalId]);

  if (loading) {
    return <p className="py-4 text-[13px] text-ds-text-secondary">Loading audit trail…</p>;
  }

  return (
    <section aria-labelledby="audit-trail-heading">
      <div className="mb-3">
        <h2 id="audit-trail-heading" className="m-0 text-ds-section text-ds-text-primary">
          Audit trail
        </h2>
        <p className="m-0 mt-0.5 text-[13px] text-ds-text-secondary">Who, when, what</p>
      </div>
      <div className="overflow-hidden rounded-ds-panel border border-ds-border bg-ds-background">
        {events.length === 0 ? (
          <p className="m-0 px-4 py-6 text-center text-[13px] text-ds-text-secondary">No activity recorded yet.</p>
        ) : (
          <ol className="m-0 list-none divide-y divide-ds-border p-0">
            {events.map((evt) => {
              const actionLabel = formatActionType(evt.action_type);
              return (
                <li key={evt.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5 px-4 py-2.5">
                  <p className="m-0 text-[13px] font-medium leading-[1.45] text-ds-text-primary">
                    {evt.summary || actionLabel}
                  </p>
                  <time dateTime={evt.acted_at} className="whitespace-nowrap text-xs tabular-nums text-ds-text-secondary">
                    {formatDateTime(evt.acted_at)}
                  </time>
                  <p className="col-span-2 m-0 text-xs text-ds-text-secondary sm:col-span-1">
                    <span className="font-medium text-ds-text-primary">{evt.actor_name}</span>
                    <span aria-hidden="true"> · </span>
                    <span>{actionLabel}</span>
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
