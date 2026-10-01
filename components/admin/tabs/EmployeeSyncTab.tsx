"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CardWrapper,
  UsersIcon,
  RefreshIcon
} from "../admin-shared";
import { SyncDetailDrawer } from "../SyncDetailDrawer";
import { parseSyncDetails, type SyncDetailSection } from "@/lib/employee-sync-details";

type SyncLogEntry = {
  id: string;
  triggered_by: "cron" | "manual" | string;
  triggered_at: string;
  status: "running" | "completed" | "failed" | string;
  employees_synced: number | null;
  employees_added: number | null;
  employees_deactivated: number | null;
  new_employee_ids: string[] | null;
  duration_ms: number | null;
  details?: unknown;
};

const linkButtonStyle = {
  background: "none",
  border: "none",
  padding: 0,
  font: "inherit",
  color: "inherit",
  cursor: "pointer",
  textDecoration: "underline",
  textDecorationStyle: "dotted",
  textUnderlineOffset: "3px",
} as const;

function CountCell({
  value,
  clickable,
  label,
  onOpen,
}: {
  value: number | null;
  clickable: boolean;
  label: string;
  onOpen: () => void;
}) {
  if (value == null) return <>—</>;
  if (!clickable || value <= 0) return <>{value}</>;
  return (
    <button type="button" data-count-link={label} aria-label={`View ${value} ${label}`} onClick={onOpen} style={linkButtonStyle}>
      {value}
    </button>
  );
}

type SyncResult = {
  ok?: boolean;
  employees_synced?: number;
  employees_added?: number;
  employees_deactivated?: number;
  new_without_appraisal?: number;
  duration_ms?: number;
  error?: string;
};

export function EmployeeSyncTab() {
  const [syncing, setSyncing] = useState(false);
  const [loadingLog, setLoadingLog] = useState(true);
  const [syncLog, setSyncLog] = useState<SyncLogEntry[]>([]);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [drawer, setDrawer] = useState<{ id: string; section: SyncDetailSection | null } | null>(null);
  const closeDrawer = useCallback(() => setDrawer(null), []);
  const drawerEntry = drawer ? syncLog.find((e) => e.id === drawer.id) ?? null : null;

  const loadLog = useCallback(async () => {
    setLoadingLog(true);
    try {
      const res = await fetch("/api/sync/employees", { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as { log?: SyncLogEntry[] };
      setSyncLog(Array.isArray(data.log) ? data.log : []);
    } finally {
      setLoadingLog(false);
    }
  }, []);

  useEffect(() => {
    void loadLog();
  }, [loadLog]);

  const runManualSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/sync/employees", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as SyncResult;
      setSyncResult(data);
      await loadLog();
    } catch {
      setSyncResult({ error: "Sync failed" });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <CardWrapper
      title="Employee Sync"
      subtitle="Auto-syncs nightly from Dynamics 365 (active @dbankjm.com users)"
      icon={<UsersIcon />}
      iconBg="#f3f3f3"
      iconColor="#0d0e10"
      delay="0.28s"
    >
      <div style={{ padding: "16px 24px 20px" }}>
        <button
          onClick={runManualSync}
          disabled={syncing}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            padding: "10px 20px",
            borderRadius: "8px",
            background: !syncing ? "#0d0e10" : "#e7e7e7",
            border: "none",
            fontSize: "14px",
            fontWeight: 600,
            color: !syncing ? "white" : "#646f79",
            cursor: !syncing ? "pointer" : "not-allowed",
            boxShadow: !syncing ? "none" : "none",
            transition: "all 0.16s",
          }}
        >
          <RefreshIcon spinning={syncing} />
          {syncing ? "Syncing…" : "Sync now"}
        </button>

        {syncResult && !syncResult.error && (
          <div
            style={{
              marginTop: "14px",
              padding: "10px 12px",
              borderRadius: "8px",
              background: "#ecfdf5",
              border: "1px solid #d0d4d8",
              fontSize: "12px",
              color: "#0d0d0d",
              display: "flex",
              gap: "14px",
              flexWrap: "wrap",
            }}
          >
            <span style={{ color: "#0d0e10", fontWeight: 600 }}>Sync complete</span>
            <span>{syncResult.employees_synced ?? 0} synced</span>
            <span style={{ color: "#2e7d4f", fontWeight: 600 }}>+{syncResult.employees_added ?? 0} new</span>
            <span style={{ color: "#b42318", fontWeight: 600 }}>-{syncResult.employees_deactivated ?? 0} deactivated</span>
            <span style={{ color: "#8a5a00", fontWeight: 600 }}>
              {syncResult.new_without_appraisal ?? 0} without appraisal
            </span>
          </div>
        )}

        {syncResult?.error && (
          <div
            style={{
              marginTop: "14px",
              padding: "10px 12px",
              borderRadius: "8px",
              background: "#fef2f2",
              border: "1px solid #fbd5d5",
              fontSize: "12px",
              color: "#b42318",
            }}
          >
            {syncResult.error}
          </div>
        )}

        <div style={{ marginTop: "18px" }}>
          <p style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: "#646f79", marginBottom: "8px" }}>
            Sync history
          </p>
          {loadingLog ? (
            <p style={{ fontSize: "12px", color: "#646f79" }}>Loading sync history…</p>
          ) : syncLog.length === 0 ? (
            <p style={{ fontSize: "12px", color: "#646f79" }}>No sync runs recorded yet.</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid #f1f4f7", color: "#646f79", fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                  <th style={{ padding: "8px 6px" }}>Time</th>
                  <th style={{ padding: "8px 6px" }}>By</th>
                  <th style={{ padding: "8px 6px" }}>Status</th>
                  <th style={{ padding: "8px 6px", textAlign: "right" }}>Synced</th>
                  <th style={{ padding: "8px 6px", textAlign: "right" }}>Added</th>
                  <th style={{ padding: "8px 6px", textAlign: "right" }}>Deactivated</th>
                  <th style={{ padding: "8px 6px", textAlign: "right" }}>No appraisal</th>
                  <th style={{ padding: "8px 6px", textAlign: "right" }}>Duration</th>
                  <th style={{ padding: "8px 6px", textAlign: "right", width: "84px" }}>Details</th>
                </tr>
              </thead>
              <tbody>
                {syncLog.map((entry) => {
                  const hasDetails = parseSyncDetails(entry.details) !== null;
                  const open = (section: SyncDetailSection | null) => setDrawer({ id: entry.id, section });
                  return (
                  <tr key={entry.id} style={{ borderBottom: "1px solid #f3f3f3" }}>
                    <td style={{ padding: "9px 6px", color: "#0d0d0d" }}>
                      {new Date(entry.triggered_at).toLocaleString("en-JM", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td style={{ padding: "9px 6px", color: "#646f79" }}>{entry.triggered_by === "cron" ? "Auto" : "Manual"}</td>
                    <td style={{ padding: "9px 6px", color: entry.status === "failed" ? "#b42318" : entry.status === "completed" ? "#0d0e10" : "#646f79", fontWeight: 600 }}>
                      {entry.status}
                    </td>
                    <td style={{ padding: "9px 6px", textAlign: "right", color: "#0d0d0d" }}>{entry.employees_synced ?? "—"}</td>
                    <td style={{ padding: "9px 6px", textAlign: "right", color: "#2e7d4f", fontWeight: 600 }}>
                      <CountCell value={entry.employees_added} clickable={hasDetails} label="added" onOpen={() => open("added")} />
                    </td>
                    <td style={{ padding: "9px 6px", textAlign: "right", color: "#b42318", fontWeight: 600 }}>
                      <CountCell value={entry.employees_deactivated} clickable={hasDetails} label="deactivated" onOpen={() => open("deactivated")} />
                    </td>
                    <td style={{ padding: "9px 6px", textAlign: "right", color: "#8a5a00", fontWeight: 600 }}>
                      <CountCell
                        value={Array.isArray(entry.new_employee_ids) ? entry.new_employee_ids.length : null}
                        clickable={hasDetails}
                        label="without appraisal"
                        onOpen={() => open("no_appraisal")}
                      />
                    </td>
                    <td style={{ padding: "9px 6px", textAlign: "right", color: "#646f79" }}>
                      {entry.duration_ms ? `${(entry.duration_ms / 1000).toFixed(1)}s` : "—"}
                    </td>
                    <td style={{ padding: "9px 6px", textAlign: "right", color: "#646f79" }}>
                      {entry.status === "running" ? (
                        "—"
                      ) : (
                        <button
                          type="button"
                          data-view-details={entry.id}
                          onClick={() => open(null)}
                          style={{ ...linkButtonStyle, color: hasDetails ? "#0d0e10" : "#646f79", fontWeight: 500, whiteSpace: "nowrap" }}
                        >
                          View details
                        </button>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {drawer && drawerEntry && (
        <SyncDetailDrawer
          syncId={drawer.id}
          section={drawer.section}
          summary={{
            triggered_at: drawerEntry.triggered_at,
            triggered_by: drawerEntry.triggered_by === "cron" ? "Auto" : "Manual",
            status: drawerEntry.status,
            employees_synced: drawerEntry.employees_synced,
            employees_added: drawerEntry.employees_added,
            employees_deactivated: drawerEntry.employees_deactivated,
            no_appraisal: Array.isArray(drawerEntry.new_employee_ids) ? drawerEntry.new_employee_ids.length : null,
            duration_ms: drawerEntry.duration_ms,
          }}
          onClose={closeDrawer}
        />
      )}
    </CardWrapper>
  );
}
