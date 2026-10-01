"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CardWrapper } from "./admin-shared";
import { formatSyncTime } from "./SyncDetailDrawer";
import { DeliveryStatusBadge } from "./DeliveryStatusBadge";

type EscalationTarget = {
  type: "DIRECT_MANAGER" | "SECOND_LEVEL_MANAGER" | "HR";
  employeeId: string | null;
  name: string | null;
  basis: string;
};

type ActionItem = {
  appraisalId: string;
  employeeName: string;
  reviewStage: string;
  requiredAction: string;
  responsibleRole: string;
  responsibleName: string | null;
  dueDate: string;
  dueDateLabel: string | null;
  daysOverdue: number;
  lastReminderSentAt: string | null;
  escalationCandidate: boolean;
  escalationKey: string;
  escalationTarget: EscalationTarget | null;
};

type ActionsResponse = {
  items: ActionItem[];
  total: number;
  page: number;
  pageSize: number;
  summary: { overdue: number; employeeActions: number; managerActions: number; escalationCandidates: number };
  escalationDaysOverdue: number;
  warnings: string[];
  cycles: { id: string; name: string; status: string | null }[];
  cycleId: string | null;
};

const TARGET_LABELS: Record<EscalationTarget["type"], string> = {
  DIRECT_MANAGER: "Manager",
  SECOND_LEVEL_MANAGER: "Manager's manager",
  HR: "HR follow-up",
};

export function escalationTargetLabel(t: EscalationTarget): string {
  if (t.type === "HR") return TARGET_LABELS.HR;
  return t.name ? `${t.name} (${TARGET_LABELS[t.type]})` : TARGET_LABELS[t.type];
}

const roleLabel = (role: string) => (role === "manager" ? "Manager" : "Employee");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const ClockIcon = () => (
  <svg style={{ width: 16, height: 16 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v6l4 2" />
  </svg>
);

const selectClass = "h-8 rounded-md border border-ds-border bg-white px-2 text-xs text-ds-text-primary";

export function OutstandingActionsPanel() {
  const [cycleId, setCycleId] = useState<string | undefined>(undefined);
  const [candidatesOnly, setCandidatesOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ActionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [cycleId, candidatesOnly]);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (cycleId !== undefined) params.set("cycleId", cycleId);
    if (candidatesOnly) params.set("candidatesOnly", "1");
    params.set("page", String(page));
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/outstanding-appraisal-actions?${params.toString()}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" && body.error ? body.error : "Could not load outstanding actions.");
      setData(body as ActionsResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load outstanding actions.");
    } finally {
      setLoading(false);
    }
  }, [cycleId, candidatesOnly, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const s = data?.summary;
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 25;
  const lastRow = Math.min(page * pageSize, total);
  const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1;

  return (
    <CardWrapper
      title="Outstanding appraisal actions"
      subtitle="Overdue steps on open cycles, using the same rules as the reminders. Escalation candidates are listed for follow-up only; no escalation emails are sent."
      icon={<ClockIcon />}
      iconBg="#f1f4f7"
      iconColor="#3d5a78"
    >
      <div className="space-y-4 px-6 py-5" data-outstanding-actions>
        <div className="flex flex-wrap items-end justify-between gap-3">
          {s ? (
            <p className="text-sm text-ds-text-primary" data-outstanding-summary>
              {plural(s.overdue, "overdue action")} · {s.employeeActions} employee · {s.managerActions} manager ·{" "}
              <span className={s.escalationCandidates > 0 ? "font-semibold text-ds-error" : undefined}>
                {plural(s.escalationCandidates, "escalation candidate")}
              </span>
            </p>
          ) : (
            <span />
          )}
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-[11px] font-medium text-ds-text-secondary">
              Cycle
              <select
                className={selectClass}
                value={cycleId ?? data?.cycleId ?? "all"}
                onChange={(e) => setCycleId(e.target.value)}
                data-outstanding-filter="cycle"
              >
                <option value="all">All open cycles</option>
                {(data?.cycles ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex h-8 items-center gap-2 text-xs text-ds-text-primary">
              <input type="checkbox" checked={candidatesOnly} onChange={(e) => setCandidatesOnly(e.target.checked)} data-outstanding-filter="candidates" />
              Escalation candidates only
            </label>
          </div>
        </div>

        {data && (
          <p className="text-xs text-ds-text-secondary" data-escalation-rule>
            Escalation candidate: {plural(data.escalationDaysOverdue, "day")} or more overdue, overdue reminders already attempted, and still
            outstanding.
          </p>
        )}
        {data && data.warnings.length > 0 && (
          <ul className="space-y-1 rounded-md border border-ds-warning-border bg-ds-warning-subtle px-3 py-2 text-xs text-ds-warning">
            {data.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        {error && (
          <p className="text-sm text-ds-error" data-outstanding-error>
            {error}
          </p>
        )}

        <div className="overflow-x-auto rounded-ds-panel border border-ds-border">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-ds-surface text-[11px] uppercase tracking-wide text-ds-text-secondary">
              <tr>
                <th className="px-3 py-2 font-semibold">Employee</th>
                <th className="px-3 py-2 font-semibold">Review stage</th>
                <th className="px-3 py-2 font-semibold">Required action</th>
                <th className="px-3 py-2 font-semibold">Responsible</th>
                <th className="px-3 py-2 font-semibold">Due date</th>
                <th className="px-3 py-2 font-semibold">Days overdue</th>
                <th className="px-3 py-2 font-semibold">Last reminder sent</th>
                <th className="px-3 py-2 font-semibold">Escalation</th>
              </tr>
            </thead>
            <tbody>
              {(data?.items ?? []).map((a) => (
                <tr key={`${a.appraisalId}-${a.escalationKey}`} className="border-t border-ds-border" data-outstanding-row={a.escalationKey}>
                  <td className="px-3 py-2 text-ds-text-primary">{a.employeeName}</td>
                  <td className="px-3 py-2 text-ds-text-secondary">{a.reviewStage}</td>
                  <td className="px-3 py-2 text-ds-text-primary">{a.requiredAction}</td>
                  <td className="px-3 py-2 text-ds-text-secondary">
                    {roleLabel(a.responsibleRole)}
                    {a.responsibleName && <span className="block text-[11px]">{a.responsibleName}</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-ds-text-secondary">{a.dueDateLabel ?? a.dueDate}</td>
                  <td className="px-3 py-2 font-semibold text-ds-text-primary" data-days-overdue>
                    {a.daysOverdue}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-ds-text-secondary">
                    {a.lastReminderSentAt ? formatSyncTime(a.lastReminderSentAt) : "None sent"}
                  </td>
                  <td className="px-3 py-2" data-escalation-cell>
                    {a.escalationCandidate ? (
                      <span className="flex flex-col items-start gap-1">
                        <DeliveryStatusBadge label="Escalation candidate" tone="error" />
                        {a.escalationTarget && (
                          <span className="text-[11px] text-ds-text-secondary" title={a.escalationTarget.basis} data-escalation-target>
                            Suggested: {escalationTargetLabel(a.escalationTarget)}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-ds-text-secondary">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && data && data.items.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-sm text-ds-text-secondary" data-outstanding-empty>
                    {candidatesOnly ? "No escalation candidates." : "No overdue appraisal actions."}
                  </td>
                </tr>
              )}
              {loading && !data && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-sm text-ds-text-secondary">
                    Loading outstanding actions…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {total > pageSize && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ds-text-secondary">
            <span>
              Showing {firstRow}–{lastRow} of {total}
            </span>
            <span className="flex gap-2">
              <Button type="button" size="sm" variant="outline" disabled={loading || page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={loading || lastRow >= total} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </span>
          </div>
        )}
      </div>
    </CardWrapper>
  );
}
