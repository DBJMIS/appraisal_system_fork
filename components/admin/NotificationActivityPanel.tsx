"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { CardWrapper } from "./admin-shared";
import { formatSyncTime } from "./SyncDetailDrawer";
import { DeliveryStatusBadge } from "./DeliveryStatusBadge";
import { DeliveryDetailDrawer } from "./DeliveryDetailDrawer";

type DeliveryItem = {
  id: string;
  activityAt: string;
  employeeName: string;
  kindLabel: string;
  recipientRole: string;
  recipientName: string;
  recipientEmail: string | null;
  dueDateLabel: string | null;
  status: string;
  statusLabel: string;
  statusTone: string;
  attemptCount: number;
  errorCode: string | null;
  reason: string | null;
};

type Metrics = { sent: number; failed: number; pending: number; sending: number; skipped: number; successRate: number | null };

type ListResponse = {
  items: DeliveryItem[];
  total: number;
  page: number;
  pageSize: number;
  metrics: Metrics;
  cycles: { id: string; name: string; status: string | null }[];
  cycleId: string | null;
  reminderKinds: { kind: string; label: string }[];
};

const STATUS_OPTIONS = [
  ["SENT", "Sent"],
  ["FAILED", "Failed"],
  ["PENDING", "Pending"],
  ["SENDING", "Sending"],
  ["SKIPPED", "Skipped"],
] as const;

const roleLabel = (role: string) => (role === "manager" ? "Manager" : "Employee");

const ActivityIcon = () => (
  <svg style={{ width: 16, height: 16 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
  </svg>
);

const selectClass = "h-8 rounded-md border border-ds-border bg-white px-2 text-xs text-ds-text-primary";

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-[88px] rounded-md border border-ds-border px-3 py-2" data-delivery-metric={label}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ds-text-secondary">{label}</p>
      <p className={`mt-0.5 text-base font-semibold ${tone ?? "text-ds-text-primary"}`}>{value}</p>
    </div>
  );
}

export function NotificationActivityPanel() {
  const [cycleId, setCycleId] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [role, setRole] = useState("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [cycleId, status, kind, role, q, from, to]);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (cycleId !== undefined) params.set("cycleId", cycleId);
    if (status) params.set("status", status);
    if (kind) params.set("kind", kind);
    if (role) params.set("role", role);
    if (q) params.set("q", q);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    params.set("page", String(page));
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/reminder-deliveries?${params.toString()}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" && body.error ? body.error : "Could not load reminder activity.");
      setData(body as ListResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load reminder activity.");
    } finally {
      setLoading(false);
    }
  }, [cycleId, status, kind, role, q, from, to, page]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const m = data?.metrics;
  const total = data?.total ?? 0;
  const pageSize = data?.pageSize ?? 25;
  const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = Math.min(page * pageSize, total);
  const selectedCycle = cycleId ?? data?.cycleId ?? "all";

  return (
    <CardWrapper
      title="Notification activity"
      subtitle="Scheduled appraisal reminders and their delivery status. Select a row for details, a preview, or to retry a failed reminder."
      icon={<ActivityIcon />}
      iconBg="#f1f4f7"
      iconColor="#3d5a78"
    >
      <div className="space-y-4 px-6 py-5" data-notification-activity>
        {m && (
          <div className="flex flex-wrap gap-2" data-delivery-metrics>
            <Metric label="Sent" value={String(m.sent)} tone="text-ds-success" />
            <Metric label="Failed" value={String(m.failed)} tone={m.failed > 0 ? "text-ds-error" : undefined} />
            <Metric label="Pending" value={String(m.pending + m.sending)} />
            <Metric label="Skipped" value={String(m.skipped)} tone="text-ds-text-secondary" />
            <Metric label="Success rate" value={m.successRate == null ? "—" : `${Math.round(m.successRate * 100)}%`} />
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2" data-delivery-filters>
          <label className="flex flex-col gap-1 text-[11px] font-medium text-ds-text-secondary">
            Cycle
            <select className={selectClass} value={selectedCycle} onChange={(e) => setCycleId(e.target.value)} data-filter="cycle">
              <option value="all">All cycles</option>
              {(data?.cycles ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-medium text-ds-text-secondary">
            Status
            <select className={selectClass} value={status} onChange={(e) => setStatus(e.target.value)} data-filter="status">
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-medium text-ds-text-secondary">
            Reminder type
            <select className={selectClass} value={kind} onChange={(e) => setKind(e.target.value)} data-filter="kind">
              <option value="">All types</option>
              {(data?.reminderKinds ?? []).map((k) => (
                <option key={k.kind} value={k.kind}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-medium text-ds-text-secondary">
            Recipient
            <select className={selectClass} value={role} onChange={(e) => setRole(e.target.value)} data-filter="role">
              <option value="">Employees and managers</option>
              <option value="employee">Employee</option>
              <option value="manager">Manager</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-medium text-ds-text-secondary">
            Employee
            <input
              type="search"
              className={`${selectClass} w-40`}
              placeholder="Search name"
              maxLength={80}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-filter="search"
            />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-medium text-ds-text-secondary">
            From
            <input type="date" className={selectClass} value={from} onChange={(e) => setFrom(e.target.value)} data-filter="from" />
          </label>
          <label className="flex flex-col gap-1 text-[11px] font-medium text-ds-text-secondary">
            To
            <input type="date" className={selectClass} value={to} onChange={(e) => setTo(e.target.value)} data-filter="to" />
          </label>
        </div>

        {error && (
          <p className="text-sm text-ds-error" data-delivery-list-error>
            {error}
          </p>
        )}

        <div className="overflow-x-auto rounded-ds-panel border border-ds-border">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-ds-surface text-[11px] uppercase tracking-wide text-ds-text-secondary">
              <tr>
                <th className="px-3 py-2 font-semibold">Date/time</th>
                <th className="px-3 py-2 font-semibold">Employee</th>
                <th className="px-3 py-2 font-semibold">Reminder type</th>
                <th className="px-3 py-2 font-semibold">Recipient role</th>
                <th className="px-3 py-2 font-semibold">Recipient</th>
                <th className="px-3 py-2 font-semibold">Due date</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Attempts</th>
                <th className="px-3 py-2 font-semibold">Last error</th>
              </tr>
            </thead>
            <tbody>
              {(data?.items ?? []).map((d) => (
                <tr
                  key={d.id}
                  tabIndex={0}
                  onClick={() => setSelectedId(d.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedId(d.id);
                    }
                  }}
                  className="cursor-pointer border-t border-ds-border hover:bg-ds-surface focus:bg-ds-surface focus:outline-none"
                  data-delivery-row={d.id}
                >
                  <td className="whitespace-nowrap px-3 py-2 text-ds-text-secondary">{formatSyncTime(d.activityAt)}</td>
                  <td className="px-3 py-2 text-ds-text-primary">{d.employeeName}</td>
                  <td className="px-3 py-2 text-ds-text-primary">{d.kindLabel}</td>
                  <td className="px-3 py-2 text-ds-text-secondary">{roleLabel(d.recipientRole)}</td>
                  <td className="px-3 py-2 text-ds-text-secondary">
                    {d.recipientName}
                    {d.recipientEmail && <span className="block text-[11px]">{d.recipientEmail}</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-ds-text-secondary">{d.dueDateLabel ?? "—"}</td>
                  <td className="px-3 py-2">
                    <DeliveryStatusBadge label={d.statusLabel} tone={d.statusTone} />
                  </td>
                  <td className="px-3 py-2 text-ds-text-secondary">{d.attemptCount}</td>
                  <td className="px-3 py-2 text-ds-text-secondary" data-delivery-last-error>
                    {d.status === "FAILED" || d.status === "SKIPPED" ? d.reason ?? "—" : "—"}
                  </td>
                </tr>
              ))}
              {!loading && data && data.items.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-sm text-ds-text-secondary" data-delivery-empty>
                    No reminders match these filters.
                  </td>
                </tr>
              )}
              {loading && !data && (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-sm text-ds-text-secondary">
                    Loading reminder activity…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ds-text-secondary" data-delivery-pagination>
          <span data-delivery-range>
            {total === 0 ? "No reminders" : `Showing ${firstRow}–${lastRow} of ${total}`}
          </span>
          <span className="flex gap-2">
            <Button type="button" size="sm" variant="outline" disabled={loading || page <= 1} onClick={() => setPage((p) => p - 1)} data-delivery-prev>
              Previous
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={loading || lastRow >= total} onClick={() => setPage((p) => p + 1)} data-delivery-next>
              Next
            </Button>
          </span>
        </div>
      </div>

      {selectedId && (
        <DeliveryDetailDrawer deliveryId={selectedId} onClose={() => setSelectedId(null)} onChanged={() => setRefreshKey((k) => k + 1)} />
      )}
    </CardWrapper>
  );
}
