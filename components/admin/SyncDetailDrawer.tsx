"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  SYNC_DETAIL_SECTIONS,
  SYNC_DETAIL_SECTION_LABELS,
  syncReasonLabel,
  type EmployeeSyncDetails,
  type SyncDetailSection,
} from "@/lib/employee-sync-details";

export type SyncDetailResponse = {
  id: string;
  triggered_at: string | null;
  completed_at: string | null;
  triggered_by: string;
  status: string | null;
  employees_synced: number | null;
  employees_added: number | null;
  employees_deactivated: number | null;
  duration_ms: number | null;
  details: EmployeeSyncDetails | null;
  details_recorded: boolean;
  details_capture_enabled?: boolean;
};

/** Values already shown in the history row; used so the header and summary render even if the detail request fails. */
export type SyncRowSummary = {
  triggered_at: string | null;
  triggered_by: string;
  status: string | null;
  employees_synced: number | null;
  employees_added: number | null;
  employees_deactivated: number | null;
  no_appraisal: number | null;
  duration_ms: number | null;
};

type LoadState = { status: "loading" } | { status: "error" } | { status: "ready"; data: SyncDetailResponse };

export const APP_HEADER_OFFSET = "var(--ds-app-header-height, 3.5rem)";

export function formatSyncTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-JM", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatSyncDuration(ms: number | null | undefined): string {
  return ms ? `${(ms / 1000).toFixed(1)}s` : "—";
}

const muted = "#646f79";

function SummaryGrid({ summary }: { summary: SyncRowSummary }) {
  const items: Array<[string, string]> = [
    ["Synced", summary.employees_synced != null ? String(summary.employees_synced) : "—"],
    ["Added", summary.employees_added != null ? String(summary.employees_added) : "—"],
    ["Deactivated", summary.employees_deactivated != null ? String(summary.employees_deactivated) : "—"],
    ["No appraisal", summary.no_appraisal != null ? String(summary.no_appraisal) : "—"],
    ["Duration", formatSyncDuration(summary.duration_ms)],
  ];
  return (
    <dl
      data-sync-summary
      style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: "8px", margin: "12px 0 0" }}
    >
      {items.map(([label, value]) => (
        <div key={label} style={{ minWidth: 0 }}>
          <dt style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.07em", color: muted }}>
            {label}
          </dt>
          <dd style={{ margin: "2px 0 0", fontSize: "13px", fontWeight: 600, color: "#0d0d0d" }}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SyncDetailDrawer({
  syncId,
  section,
  summary,
  onClose,
}: {
  syncId: string;
  section: SyncDetailSection | null;
  summary: SyncRowSummary;
  onClose: () => void;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const closeRef = useRef<HTMLButtonElement>(null);
  const sectionRefs = useRef<Partial<Record<SyncDetailSection, HTMLElement | null>>>({});
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetch(`/api/sync/employees/${encodeURIComponent(syncId)}`, { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as SyncDetailResponse) : null))
      .catch(() => null)
      .then((data) => {
        if (!cancelled) setState(data && typeof data === "object" ? { status: "ready", data } : { status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [syncId]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const ready = state.status === "ready" ? state.data : null;
  const details = ready?.details_recorded && ready.details ? ready.details : null;
  const notRecorded = !!ready && !details;
  const captureEnabled = ready?.details_capture_enabled !== false;

  useEffect(() => {
    if (!details || !section) return;
    sectionRefs.current[section]?.scrollIntoView?.({ block: "start" });
  }, [details, section]);

  const header = {
    triggered_at: ready?.triggered_at ?? summary.triggered_at,
    triggered_by: ready?.triggered_by ?? summary.triggered_by,
    status: ready?.status ?? summary.status,
    duration_ms: ready?.duration_ms ?? summary.duration_ms,
  };

  return createPortal(
    <>
      <div
        data-sync-drawer-overlay
        onClick={onClose}
        style={{
          position: "fixed",
          top: APP_HEADER_OFFSET,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(13, 14, 16, 0.12)",
          zIndex: 45,
        }}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-detail-title"
        data-sync-drawer
        style={{
          position: "fixed",
          top: APP_HEADER_OFFSET,
          right: 0,
          bottom: 0,
          width: "min(460px, 100vw)",
          background: "#ffffff",
          borderLeft: "1px solid #e7e7e7",
          boxShadow: "-4px 0 16px rgba(13, 14, 16, 0.06)",
          zIndex: 45,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          data-sync-drawer-header
          style={{
            position: "sticky",
            top: 0,
            flexShrink: 0,
            background: "#ffffff",
            padding: "14px 20px 12px",
            borderBottom: "1px solid #e7e7e7",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
            <h2 id="sync-detail-title" style={{ fontSize: "15px", fontWeight: 600, color: "#0d0d0d", margin: 0 }}>
              Sync details
            </h2>
            <button
              ref={closeRef}
              type="button"
              aria-label="Close"
              onClick={onClose}
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "6px",
                border: "1px solid transparent",
                background: "none",
                color: muted,
                fontSize: "18px",
                lineHeight: 1,
                cursor: "pointer",
              }}
            >
              ×
            </button>
          </div>
          <div style={{ marginTop: "4px", fontSize: "12px", color: muted, display: "flex", flexWrap: "wrap", gap: "4px 10px" }}>
            <span style={{ color: "#0d0d0d" }}>{formatSyncTime(header.triggered_at)}</span>
            <span>{header.triggered_by}</span>
            <span style={{ color: header.status === "failed" ? "#b42318" : "#0d0e10", fontWeight: 600 }}>{header.status ?? "—"}</span>
            <span>{formatSyncDuration(header.duration_ms)}</span>
          </div>
        </div>

        <div data-sync-drawer-body style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 20px 20px" }}>
          {state.status === "loading" && <p style={{ fontSize: "12px", color: muted, marginTop: "12px" }}>Loading sync details…</p>}
          {state.status === "error" && (
            <p data-sync-detail-error role="alert" style={{ fontSize: "12.5px", color: "#b42318", marginTop: "12px" }}>
              Could not load sync details. Please try again.
            </p>
          )}
          {notRecorded && (
            <div
              data-details-not-recorded
              style={{ marginTop: "12px", padding: "10px 12px", border: "1px solid #e7e7e7", borderRadius: "8px" }}
            >
              <div style={{ fontSize: "13px", fontWeight: 600, color: "#0d0d0d" }}>
                {captureEnabled ? "Historical sync" : "Details not recorded"}
              </div>
              <div style={{ fontSize: "12px", color: muted, marginTop: "2px" }}>
                Employee-level details were not recorded for this run.
                {!captureEnabled && " Detail capture is not yet enabled in this environment."}
              </div>
              <SummaryGrid
                summary={{
                  ...summary,
                  employees_synced: ready!.employees_synced ?? summary.employees_synced,
                  employees_added: ready!.employees_added ?? summary.employees_added,
                  employees_deactivated: ready!.employees_deactivated ?? summary.employees_deactivated,
                  duration_ms: ready!.duration_ms ?? summary.duration_ms,
                }}
              />
            </div>
          )}
          {details &&
            SYNC_DETAIL_SECTIONS.map((key) => {
              const items = details[key] as Array<{ employee_id?: string; full_name?: string | null; reason?: string }>;
              return (
                <section
                  key={key}
                  ref={(el) => {
                    sectionRefs.current[key] = el;
                  }}
                  data-sync-section={key}
                  data-active-section={section === key ? "true" : undefined}
                  style={{ paddingTop: "14px", scrollMarginTop: "8px" }}
                >
                  <h3
                    style={{
                      margin: 0,
                      fontSize: "10px",
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.07em",
                      color: section === key ? "#0d0d0d" : muted,
                    }}
                  >
                    {SYNC_DETAIL_SECTION_LABELS[key]} <span style={{ fontWeight: 500 }}>· {items.length}</span>
                  </h3>
                  {key === "deactivated" && items.length > 0 && (
                    <p style={{ margin: "4px 0 0", fontSize: "11.5px", color: muted }}>
                      {syncReasonLabel("not_in_active_dynamics_sync")}
                    </p>
                  )}
                  {items.length === 0 ? (
                    <p data-empty-section style={{ margin: "6px 0 0", fontSize: "12.5px", color: muted }}>None</p>
                  ) : (
                    <ul style={{ listStyle: "none", margin: "4px 0 0", padding: 0 }}>
                      {items.map((item, i) => (
                        <li key={`${item.employee_id ?? "unknown"}-${i}`} style={{ padding: "7px 0", borderBottom: "1px solid #f3f3f3" }}>
                          <div style={{ fontSize: "13px", color: "#0d0d0d" }}>{item.full_name || "Name not recorded"}</div>
                          {item.employee_id && (
                            <div style={{ fontSize: "11px", color: muted, fontFamily: "ui-monospace, monospace", marginTop: "1px" }}>
                              {item.employee_id}
                            </div>
                          )}
                          {key === "skipped" && item.reason && (
                            <div style={{ fontSize: "11.5px", color: muted, marginTop: "2px" }}>{syncReasonLabel(item.reason)}</div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              );
            })}
        </div>
      </aside>
    </>,
    document.body
  );
}
