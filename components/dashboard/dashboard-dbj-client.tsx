"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { ScoreDistributionChart } from "@/components/dashboard/ScoreDistributionChart";
import type { HrDashboardStats } from "@/lib/dashboard-hr-stats";
import type { ManagerDashboardStats } from "@/lib/dashboard-manager-stats";
import type { EmployeeDashboardStrip } from "@/lib/dashboard-employee-strip";
import { DASHBOARD_WORKFLOW_ORDER } from "@/lib/dashboard-employee-strip";
import { statusToneStyle, type StatusTone } from "@/lib/appraisal-status-display";
import { avatarAccent } from "@/lib/avatar-accent";

const NAVY = "#0d0d0d";
const TEAL = "#0d0e10";
const SURFACE = "#f3f3f3";
const BORDER = "#e7e7e7";
const MUTED = "#646f79";

/** Accent left borders for insight cards (cycle); recommended-actions section uses red. */
const AI_INSIGHT_ACCENTS = ["#0d0e10", "#0d0e10", "#3d5a78", "#8a5a00"] as const;
const AI_RECOMMENDED_ACTION_ACCENT = "#b42318";

type ParsedAiInsight = { title: string; body: string };

function stripAiBulletPrefix(line: string): string {
  return line.replace(/^[•\-\*]\s*/, "").trim();
}

/**
 * Strip markdown asterisks, split insights vs recommended actions, parse bullets into title/body.
 */
function parseHRAiInsights(raw: string | null): { insights: ParsedAiInsight[]; actions: string[] } | null {
  if (!raw?.trim()) return null;
  const text = raw.replace(/\*\*/g, "").trim();
  const lines = text.split(/\r?\n/).map((l) => l.trim());

  const headerRe =
    /^(#{1,3}\s*)?(Recommended actions|Actions HR should consider|Suggested actions|Next steps)\s*:\s*(.*)$/i;
  let splitIdx = -1;
  let firstActionInline: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!l) continue;
    const m = l.match(headerRe);
    if (m) {
      splitIdx = i;
      if (m[3]?.trim()) firstActionInline = m[3].trim();
      break;
    }
    const headerOnly =
      /^(#{1,3}\s*)?(Recommended actions|Actions HR should consider|Suggested actions|Next steps)\s*:?\s*$/i;
    if (headerOnly.test(l)) {
      splitIdx = i;
      break;
    }
  }

  let insightLines: string[];
  let actionLines: string[];
  if (splitIdx >= 0) {
    insightLines = lines.slice(0, splitIdx).filter((l) => l.length > 0);
    const rest = lines.slice(splitIdx + 1);
    actionLines = [...(firstActionInline ? [firstActionInline] : []), ...rest].filter((l) => l.length > 0);
  } else {
    insightLines = lines.filter((l) => l.length > 0);
    actionLines = [];
  }

  function splitTitleBody(chunk: string): ParsedAiInsight {
    const c = chunk.trim();
    if (!c) return { title: "", body: "" };
    const colon = c.indexOf(": ");
    if (colon > 0 && colon <= 90) {
      const title = c.slice(0, colon).trim();
      const body = c.slice(colon + 2).trim();
      const titleLooksShort = title.length <= 80 && !title.includes(". ");
      if (body && titleLooksShort) {
        return { title, body };
      }
    }
    return { title: "", body: c };
  }

  const insights: ParsedAiInsight[] = [];
  let current: string[] = [];

  const flushInsight = () => {
    if (current.length === 0) return;
    const chunk = current.map((s) => s.trim()).join(" ").replace(/\s+/g, " ").trim();
    current = [];
    if (!chunk) return;
    insights.push(splitTitleBody(chunk));
  };

  for (const line of insightLines) {
    const stripped = stripAiBulletPrefix(line);
    const bulletLine = /^[•\*]\s*\S/.test(line) || /^-\s+\S/.test(line);
    if (bulletLine) {
      flushInsight();
      current.push(stripped);
    } else {
      if (current.length > 0) current.push(line.trim());
      else {
        // No leading bullet: treat as standalone paragraph insight
        current.push(stripped);
      }
    }
  }
  flushInsight();

  // If nothing parsed as bullets, use whole insight block as one body
  if (insights.length === 0 && insightLines.length > 0) {
    const fallback = insightLines.map(stripAiBulletPrefix).join(" ").replace(/\s+/g, " ").trim();
    if (fallback) insights.push(splitTitleBody(fallback));
  }

  const actions: string[] = [];
  for (const line of actionLines) {
    const s = stripAiBulletPrefix(line).replace(/^\d+[.)]\s*/, "").trim();
    if (s) actions.push(s);
  }

  return { insights, actions };
}

type TopBarTone = "teal" | "navy" | "amber" | "green" | "red" | "blue" | "purple";

type StatAccent = "coral" | "mint" | "lavender" | "amber";

const STAT_ACCENT_DOT: Record<StatAccent, string> = {
  coral: "bg-ds-coral",
  mint: "bg-ds-mint",
  lavender: "bg-ds-lavender",
  amber: "bg-ds-amber",
};

function StatCardDbj(props: {
  label: string;
  value: React.ReactNode;
  sub: string;
  tone: TopBarTone;
  accent?: StatAccent;
  valueSize?: "lg" | "md";
}) {
  return (
    <div data-tone={props.tone} className="bg-ds-background px-5 py-4">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-ds-text-secondary">
        {props.accent && <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${STAT_ACCENT_DOT[props.accent]}`} />}
        {props.label}
      </div>
      <div
        className={`font-semibold leading-[1.2] tabular-nums text-ds-text-primary ${props.valueSize === "md" ? "text-[18px]" : "text-[26px] tracking-[-0.01em]"}`}
      >
        {props.value}
      </div>
      <div className="mt-1 text-xs text-ds-text-secondary">{props.sub}</div>
    </div>
  );
}

const STATUS_PILL_STYLES: Record<string, (typeof statusToneStyle)[StatusTone]> = {
  DRAFT: statusToneStyle.neutral,
  PENDING_APPROVAL: statusToneStyle.warning,
  SELF_ASSESSMENT: statusToneStyle.progress,
  SUBMITTED: statusToneStyle.success,
  MANAGER_REVIEW: statusToneStyle.warning,
  PENDING_SIGNOFF: statusToneStyle.warning,
  HOD_REVIEW: statusToneStyle.warning,
  HR_REVIEW: statusToneStyle.warning,
  COMPLETE: statusToneStyle.success,
};

function PillDot({ color }: { color: string }) {
  return <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 9999, background: color, marginRight: 6, flexShrink: 0 }} />;
}

function StatusPill({ status }: { status: string }) {
  const cfg = STATUS_PILL_STYLES[status] ?? statusToneStyle.neutral;
  const label =
    status === "MANAGER_REVIEW"
      ? "Manager review"
      : status === "SELF_ASSESSMENT"
        ? "Self assessment"
        : status === "PENDING_SIGNOFF"
          ? "Pending sign-off"
          : status.replace(/_/g, " ");
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "4px 10px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        color: cfg.color,
        fontFamily: "var(--ds-font-sans)",
      }}
    >
      <PillDot color={cfg.dot} />
      {label}
    </span>
  );
}

function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 45) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

/** 8-step bar: DRAFT … COMPLETE (matches spec). */
function teamWorkflowStageNumber(status: string): number {
  const s = status || "DRAFT";
  if (s === "HOD_REVIEW" || s === "HR_REVIEW") return 7;
  const order: Record<string, number> = {
    DRAFT: 1,
    PENDING_APPROVAL: 2,
    SUBMITTED: 3,
    SELF_ASSESSMENT: 4,
    MANAGER_REVIEW: 5,
    PENDING_SIGNOFF: 6,
    COMPLETE: 8,
  };
  return order[s] ?? 3;
}

const TEAM_STAGE_PILL: Record<
  string,
  (typeof statusToneStyle)[StatusTone] & { label: string }
> = {
  IN_PROGRESS: { ...statusToneStyle.progress, label: "In progress" },
  PENDING_APPROVAL: { ...statusToneStyle.warning, label: "Pending approval" },
  MANAGER_REVIEW: { ...statusToneStyle.warning, label: "Manager review" },
  SELF_ASSESSMENT: { ...statusToneStyle.progress, label: "Self assessment" },
  PENDING_SIGNOFF: { ...statusToneStyle.warning, label: "Pending sign-off" },
  HR_REVIEW: { ...statusToneStyle.warning, label: "HR review" },
  COMPLETE: { ...statusToneStyle.success, label: "Complete" },
  DRAFT: { ...statusToneStyle.neutral, label: "Draft" },
};

function teamOverviewStagePill(status: string) {
  if (status === "PENDING_APPROVAL") {
    const m = TEAM_STAGE_PILL.PENDING_APPROVAL;
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          padding: "4px 12px",
          borderRadius: 4,
          fontSize: 11,
          fontWeight: 600,
          background: m.bg,
          border: `1px solid ${m.border}`,
          color: m.color,
          fontFamily: "var(--ds-font-sans)",
          flexShrink: 0,
        }}
      >
        <PillDot color={m.dot} />
        Pending approval
      </span>
    );
  }
  if (status === "HOD_REVIEW" || status === "HR_REVIEW") {
    const m = TEAM_STAGE_PILL.HR_REVIEW;
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          padding: "4px 12px",
          borderRadius: 4,
          fontSize: 11,
          fontWeight: 600,
          background: m.bg,
          border: `1px solid ${m.border}`,
          color: m.color,
          fontFamily: "var(--ds-font-sans)",
          flexShrink: 0,
        }}
      >
        <PillDot color={m.dot} />
        {m.label}
      </span>
    );
  }
  if (TEAM_STAGE_PILL[status]) {
    const m = TEAM_STAGE_PILL[status];
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          padding: "4px 12px",
          borderRadius: 4,
          fontSize: 11,
          fontWeight: 600,
          background: m.bg,
          border: `1px solid ${m.border}`,
          color: m.color,
          fontFamily: "var(--ds-font-sans)",
          flexShrink: 0,
        }}
      >
        <PillDot color={m.dot} />
        {m.label}
      </span>
    );
  }
  const m = TEAM_STAGE_PILL.IN_PROGRESS;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "4px 12px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        background: m.bg,
        border: `1px solid ${m.border}`,
        color: m.color,
        fontFamily: "var(--ds-font-sans)",
        flexShrink: 0,
      }}
    >
      <PillDot color={m.dot} />
      {m.label}
    </span>
  );
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  if (name.length >= 2) return name.slice(0, 2).toUpperCase();
  return name.slice(0, 2).toUpperCase() || "?";
}

const PIPELINE_STAGES: { key: string; label: string; query: string }[] = [
  { key: "DRAFT", label: "Draft", query: "DRAFT" },
  { key: "PENDING_APPROVAL", label: "Approval", query: "PENDING_APPROVAL" },
  { key: "SUBMITTED", label: "In progress", query: "SUBMITTED" },
  { key: "SELF_ASSESSMENT", label: "Self assess", query: "SELF_ASSESSMENT" },
  { key: "MANAGER_REVIEW", label: "Mgr review", query: "MANAGER_REVIEW" },
  { key: "PENDING_SIGNOFF", label: "Sign-off", query: "PENDING_SIGNOFF" },
  { key: "HR_PIPELINE", label: "HR review", query: "HR_REVIEW" },
  { key: "COMPLETE", label: "Complete", query: "COMPLETE" },
];

function divisionScorePill(score: number | null) {
  if (score == null)
    return (
      <span style={{ fontSize: 12, color: MUTED }}>—</span>
    );
  let bg = "#fef2f2";
  let border = "#fbd5d5";
  let color = "#b42318";
  if (score >= 70) {
    bg = "#ecfdf5";
    border = "#bbf0d9";
    color = "#2e7d4f";
  } else if (score >= 50) {
    bg = "#fffbeb";
    border = "#fbe3a1";
    color = "#8a5a00";
  }
  return (
    <span
      style={{
        display: "inline-flex",
        padding: "2px 8px",
        borderRadius: 20,
        fontSize: 11,
        fontWeight: 600,
        background: bg,
        border: `1px solid ${border}`,
        color,
      }}
    >
      {score}%
    </span>
  );
}

function QuickActionsGrid({ pending360 }: { pending360: number }) {
  const tiles: {
    href: string;
    title: string;
    subtitle: string;
    iconBg: string;
    iconColor: string;
    badge?: boolean;
    icon: ReactNode;
  }[] = [
    {
      href: "/appraisals",
      title: "My Appraisals",
      subtitle: "View and complete your appraisals",
      iconBg: "#f1f4f7",
      iconColor: "#0d0e10",
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>
      ),
    },
    {
      href: "/feedback",
      title: "360 Feedback",
      subtitle: pending360 > 0 ? `${pending360} review(s) waiting` : "Peer and upward feedback",
      iconBg: "#f1f4f7",
      iconColor: "#3d5a78",
      badge: pending360 > 0,
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ),
    },
    {
      href: "/workplans",
      title: "My Workplan",
      subtitle: "Goals and objectives",
      iconBg: "#ecfdf5",
      iconColor: "#2e7d4f",
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 11l3 3L22 4" />
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
        </svg>
      ),
    },
    {
      href: "/development",
      title: "Development Profile",
      subtitle: "Skills and career planning",
      iconBg: "#fffbeb",
      iconColor: "#8a5a00",
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
          <polyline points="17 6 23 6 23 12" />
        </svg>
      ),
    },
  ];

  return (
    <div
      style={{
        background: "#fff",
        border: `1px solid ${BORDER}`,
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "16px 20px", borderBottom: `1px solid ${BORDER}`, background: SURFACE }}>
        <h3 className="font-display" style={{ fontSize: 15, fontWeight: 600, color: NAVY }}>
          Quick actions
        </h3>
      </div>
      <div style={{ padding: 16, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {tiles.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="group flex items-center gap-[14px] rounded-ds-panel border border-ds-border bg-white px-[18px] py-4 no-underline transition-all duration-150 hover:border-ds-accent"
          >
            <div style={{ position: "relative", flexShrink: 0 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  background: t.iconBg,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: t.iconColor,
                }}
              >
                {t.icon}
              </div>
              {t.badge && (
                <span
                  style={{
                    position: "absolute",
                    top: -2,
                    right: -2,
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "#8a5a00",
                    border: "2px solid #fff",
                  }}
                />
              )}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: NAVY, fontFamily: "var(--ds-font-sans)" }}>
                {t.title}
              </div>
              <div style={{ fontSize: 11, fontWeight: 400, color: MUTED, marginTop: 2, fontFamily: "var(--ds-font-sans)" }}>
                {t.subtitle}
              </div>
            </div>
            <span
              className="ml-auto shrink-0 text-base text-ds-border transition-colors group-hover:text-ds-accent"
            >
              →
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function scoreBandColor(score: number): string {
  if (score >= 80) return "#2e7d4f";
  if (score >= 70) return "#0d0e10";
  if (score >= 50) return "#8a5a00";
  return "#b42318";
}

function RecentScoresCard({
  rows,
}: {
  rows: EmployeeDashboardStrip["recent_scores"];
}) {
  return (
    <div
      style={{
        background: "#fff",
        border: `1px solid ${BORDER}`,
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "16px 20px", borderBottom: `1px solid ${BORDER}`, background: SURFACE }}>
        <h3 className="font-display" style={{ fontSize: 15, fontWeight: 600, color: NAVY }}>
          Recent appraisal scores
        </h3>
        <p style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>Past completed cycles</p>
      </div>
      <div style={{ padding: 16 }}>
        {rows.length === 0 ? (
          <div style={{ textAlign: "center", padding: "12px 8px" }}>
            <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>No completed cycles yet</p>
            <p style={{ fontSize: 11, color: MUTED, marginTop: 6, marginBottom: 0 }}>
              Scores will appear here after your first appraisal
            </p>
          </div>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {rows.map((r) => {
              const pct = r.total_score != null ? Math.min(100, Math.max(0, r.total_score)) : 0;
              const fill = r.total_score != null ? scoreBandColor(r.total_score) : "#e7e7e7";
              return (
                <li
                  key={r.appraisal_id}
                  style={{
                    background: SURFACE,
                    border: `1px solid ${BORDER}`,
                    borderRadius: 8,
                    padding: "14px 16px",
                    marginBottom: 8,
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                  }}
                >
                  <div style={{ width: 140, flexShrink: 0 }}>
                    <div className="font-display" style={{ fontSize: 13, fontWeight: 600, color: NAVY }}>
                      {r.cycle_name}
                    </div>
                    <div style={{ fontSize: 11, color: MUTED, marginTop: 4 }}>
                      {r.final_rating ?? "—"}
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        height: 6,
                        background: "#f3f3f3",
                        borderRadius: 3,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${pct}%`,
                          height: "100%",
                          background: fill,
                          borderRadius: 3,
                        }}
                      />
                    </div>
                  </div>
                  <div
                    className="font-display"
                    style={{
                      fontSize: 22,
                      fontWeight: 600,
                      color: r.total_score != null ? fill : MUTED,
                      flexShrink: 0,
                      minWidth: 56,
                      textAlign: "right",
                    }}
                  >
                    {r.total_score != null ? `${r.total_score}%` : "—"}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function TeamOverviewDirectReports({
  reports,
}: {
  reports: ManagerDashboardStats["direct_reports"];
}) {
  return (
    <div style={{ padding: "0 20px 20px" }}>
      {reports.map((r) => {
        const stageNum = teamWorkflowStageNumber(r.status);
        const barPct = (stageNum / 8) * 100;
        const isMgrRev = r.status === "MANAGER_REVIEW";
        return (
          <div
            key={r.employee_id}
            style={{
              background: "#fff",
              border: `1px solid ${BORDER}`,
              borderLeft: isMgrRev ? "3px solid #8a5a00" : `1px solid ${BORDER}`,
              borderRadius: isMgrRev ? "0 12px 12px 0" : 12,
              padding: "14px 20px",
              display: "flex",
              alignItems: "center",
              gap: 16,
              marginBottom: 8,
            }}
          >
            <div
              className="font-display"
              style={{
                width: 40,
                height: 40,
                borderRadius: "50%",
                ...avatarAccent(r.full_name).style,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 13,
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              {initialsFromName(r.full_name)}
            </div>
            <div style={{ width: 200, flexShrink: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              <span className="font-display" style={{ fontSize: 14, fontWeight: 600, color: NAVY }}>
                {r.full_name}
              </span>
              <span style={{ fontSize: 11, fontWeight: 400, color: MUTED, fontFamily: "var(--ds-font-sans)" }}>
                {r.division_name ?? "—"}
              </span>
            </div>
            {teamOverviewStagePill(r.status)}
            <div
              style={{
                flex: 1,
                textAlign: "center",
                fontFamily: "var(--ds-font-sans)",
                fontSize: 16,
                fontWeight: 600,
                color: r.total_score != null ? NAVY : "#e7e7e7",
              }}
            >
              {r.total_score != null ? `${r.total_score}%` : "—"}
            </div>
            <div style={{ flex: 1, minWidth: 80 }}>
              <div
                style={{
                  height: 4,
                  background: "#f3f3f3",
                  borderRadius: 2,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${barPct}%`,
                    height: "100%",
                    background: TEAL,
                    borderRadius: 2,
                  }}
                />
              </div>
            </div>
            <div
              style={{
                width: 80,
                flexShrink: 0,
                fontSize: 11,
                color: MUTED,
                textAlign: "right",
                fontFamily: "var(--ds-font-sans)",
              }}
            >
              {formatRelativeTime(r.updated_at)}
            </div>
            <div style={{ flexShrink: 0 }}>
              {r.appraisal_id ? (
                <Link
                  href={`/appraisals/${r.appraisal_id}`}
                  style={{
                    display: "inline-block",
                    background: isMgrRev ? NAVY : SURFACE,
                    color: isMgrRev ? "#fff" : MUTED,
                    border: isMgrRev ? "none" : `1px solid ${BORDER}`,
                    borderRadius: 8,
                    padding: "6px 14px",
                    fontSize: 12,
                    fontWeight: 500,
                    textDecoration: "none",
                    fontFamily: "var(--ds-font-sans)",
                  }}
                >
                  {isMgrRev ? "Review" : "View"}
                </Link>
              ) : (
                <span style={{ color: MUTED, fontSize: 11 }}>—</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export interface DashboardDbjClientProps {
  strip: EmployeeDashboardStrip;
  isHR: boolean;
  isManager: boolean;
  isBoth: boolean;
  hrStats: HrDashboardStats | null;
  managerStats: ManagerDashboardStats | null;
}

export function DashboardDbjClient({
  strip,
  isHR,
  isManager,
  isBoth,
  hrStats,
  managerStats,
}: DashboardDbjClientProps) {
  const mgr =
    managerStats ?? {
      direct_reports: [] as ManagerDashboardStats["direct_reports"],
      pending_reviews: 0,
      team_in_progress: 0,
    };
  const router = useRouter();
  const [view, setView] = useState<"org" | "team">("org");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiText, setAiText] = useState<string | null>(null);

  const showOrg = isHR && (!isBoth || view === "org");
  const showTeam = isManager && (!isBoth || view === "team");
  const showEmployee = !isHR && !isManager;

  const generateAi = useCallback(async () => {
    if (!hrStats) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await fetch("/api/dashboard/ai-insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scoreDistribution: hrStats.score_distribution,
          meanScore: hrStats.mean_score,
          stdDeviation: hrStats.std_deviation,
          stagePipeline: hrStats.appraisals_by_stage,
          divisionBreakdown: hrStats.division_breakdown,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAiError(data.error ?? "Unable to generate insights. Try again.");
        return;
      }
      setAiText(typeof data.insights === "string" ? data.insights : "");
    } catch {
      setAiError("Unable to generate insights. Try again.");
    } finally {
      setAiLoading(false);
    }
  }, [hrStats]);

  const parsedAiInsights = useMemo(() => parseHRAiInsights(aiText), [aiText]);

  const myAppraisalBar = (
    <div
      style={{
        background: "#fff",
        border: `1px solid ${BORDER}`,
        borderRadius: 8,
        padding: "12px 20px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 20,
        flexWrap: "wrap",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: "0.07em",
            textTransform: "uppercase",
            color: MUTED,
            fontFamily: "var(--ds-font-sans)",
          }}
        >
          My appraisal
        </span>
        <span className="font-display" style={{ fontSize: 14, fontWeight: 600, color: NAVY }}>
          {strip.full_name ?? "—"}
        </span>
        <StatusPill status={strip.status} />
        <span className="font-display" style={{ fontSize: 20, fontWeight: 600, color: TEAL }}>
          {strip.latestScore != null ? `${strip.latestScore}%` : "—"}
        </span>
      </div>
      <Link
        href="/appraisals"
        style={{ fontSize: 12, color: TEAL, fontWeight: 500, fontFamily: "var(--ds-font-sans)" }}
      >
        Go to my appraisal →
      </Link>
    </div>
  );

  return (
    <div className="mx-auto max-w-7xl" style={{ fontFamily: "var(--ds-font-sans)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          marginBottom: 8,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ marginBottom: 6 }}>
            <h1 className="m-0 text-ds-page-title text-ds-text-primary">Dashboard</h1>
            <p className="m-0 mt-1 text-[13px] text-ds-text-secondary">
              DBJ Performance Appraisal Portal — overview
            </p>
          </div>
        </div>
        {isBoth && (
          <div
            style={{
              display: "flex",
              background: SURFACE,
              border: `1px solid ${BORDER}`,
              borderRadius: 8,
              padding: 3,
              gap: 3,
            }}
          >
            <button
              type="button"
              onClick={() => setView("org")}
              style={{
                padding: "6px 16px",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                fontFamily: "var(--ds-font-sans)",
                fontSize: 13,
                fontWeight: 500,
                background: view === "org" ? NAVY : "transparent",
                color: view === "org" ? "#fff" : MUTED,
              }}
            >
              Organisation
            </button>
            <button
              type="button"
              onClick={() => setView("team")}
              style={{
                padding: "6px 16px",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                fontFamily: "var(--ds-font-sans)",
                fontSize: 13,
                fontWeight: 500,
                background: view === "team" ? NAVY : "transparent",
                color: view === "team" ? "#fff" : MUTED,
              }}
            >
              My team
            </button>
          </div>
        )}
      </div>

      {myAppraisalBar}

      {/* Employee */}
      {showEmployee && (
        <>
          <div className="mb-5 grid grid-cols-1 gap-px overflow-hidden rounded-ds-panel border border-ds-border bg-ds-border md:grid-cols-2 lg:grid-cols-4">
            <StatCardDbj
              label="My appraisal status"
              value={strip.stageLabel}
              sub={`Stage ${strip.stageIndex + 1} of ${DASHBOARD_WORKFLOW_ORDER.length}`}
              tone="teal"
              valueSize="md"
            />
            <StatCardDbj
              label="Latest score"
              value={strip.latestScore != null ? `${strip.latestScore}%` : "—"}
              sub={strip.ratingLabel ?? "Not yet scored"}
              tone="blue"
            />
            <StatCardDbj
              label="360 reviews pending"
              accent="amber"
              value={strip.feedback_pending_count}
              sub="Reviews to complete"
              tone="amber"
            />
            <StatCardDbj
              label="Development profile"
              accent="mint"
              value={`${strip.development_profile_percent}%`}
              sub="Complete profile"
              tone="purple"
            />
          </div>
          <div className="mb-6 grid grid-cols-1 gap-5 md:grid-cols-2">
            <QuickActionsGrid pending360={strip.feedback_pending_count} />
            <RecentScoresCard rows={strip.recent_scores} />
          </div>
        </>
      )}

      {/* Manager (team view only when isBoth + team; or pure manager) */}
      {showTeam && (
        <>
          <div className="mb-5 grid grid-cols-1 gap-px overflow-hidden rounded-ds-panel border border-ds-border bg-ds-border md:grid-cols-2 lg:grid-cols-4">
            <StatCardDbj
              label="My appraisal"
              value={strip.stageLabel}
              sub={`Stage ${strip.stageIndex + 1} of ${DASHBOARD_WORKFLOW_ORDER.length}`}
              tone="teal"
              valueSize="md"
            />
            <StatCardDbj
              label="Pending reviews"
              accent="amber"
              value={mgr.pending_reviews}
              sub="Awaiting your review"
              tone="amber"
            />
            <StatCardDbj
              label="Team in progress"
              accent="lavender"
              value={mgr.team_in_progress}
              sub="Active appraisals"
              tone="navy"
            />
            <StatCardDbj
              label="Latest score"
              value={strip.latestScore != null ? `${strip.latestScore}%` : "—"}
              sub={strip.ratingLabel ?? "Not yet scored"}
              tone="blue"
            />
          </div>

          <div
            style={{
              background: "#fff",
              border: `1px solid ${BORDER}`,
              borderRadius: 8,
              marginBottom: 20,
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${BORDER}`, background: SURFACE }}>
              <h3 className="font-display" style={{ fontSize: 15, fontWeight: 600, color: NAVY }}>
                Team overview — direct reports
              </h3>
            </div>
            <TeamOverviewDirectReports reports={mgr.direct_reports} />
          </div>

          <div className="mb-6 grid grid-cols-1 gap-5 md:grid-cols-2">
            <QuickActionsGrid pending360={strip.feedback_pending_count} />
            <RecentScoresCard rows={strip.recent_scores} />
          </div>
        </>
      )}

      {/* HR org */}
      {showOrg && isHR && !hrStats && (
        <div
          className="mb-6 rounded-ds-panel px-5 py-4"
          style={{ background: "#fef2f2", border: "1px solid #fbd5d5", color: "#b42318", fontSize: 13 }}
        >
          Unable to load organisation metrics. Refresh the page or try again later.
        </div>
      )}

      {showOrg && hrStats && (
        <>
          <div className="mb-4 grid grid-cols-1 gap-px overflow-hidden rounded-ds-panel border border-ds-border bg-ds-border md:grid-cols-2 lg:grid-cols-3">
            <StatCardDbj
              label="Total employees"
              value={hrStats.total_employees}
              sub={hrStats.total_employees_subtitle}
              tone="navy"
            />
            <StatCardDbj
              label="Appraisals completed"
              accent="mint"
              value={hrStats.appraisals_complete}
              sub="Status complete"
              tone="green"
            />
            <StatCardDbj
              label="Pending manager reviews"
              accent="amber"
              value={hrStats.pending_manager_reviews}
              sub="Awaiting manager action"
              tone="amber"
            />
          </div>
          <div className="mb-5 grid grid-cols-1 gap-px overflow-hidden rounded-ds-panel border border-ds-border bg-ds-border md:grid-cols-2 lg:grid-cols-3">
            <StatCardDbj
              label="In progress"
              accent="lavender"
              value={hrStats.in_progress_appraisals}
              sub="Non-draft, not complete"
              tone="navy"
            />
            <StatCardDbj
              label="Average overall score"
              value={hrStats.mean_score != null ? `${hrStats.mean_score}%` : "—"}
              sub="From recorded scores"
              tone="blue"
            />
            <StatCardDbj
              label="360 reviews active"
              accent="lavender"
              value={hrStats.active_360_cycles}
              sub="Active feedback cycles"
              tone="red"
            />
          </div>

          <div
            style={{
              background: "#fff",
              border: `1px solid ${BORDER}`,
              borderRadius: 8,
              padding: "16px 20px",
              marginBottom: 20,
            }}
          >
            <h3 className="font-display" style={{ fontSize: 15, fontWeight: 600, color: NAVY, marginBottom: 4 }}>
              Appraisal stage pipeline
            </h3>
            <p style={{ fontSize: 11, color: MUTED, marginBottom: 12 }}>Click to filter</p>
            <div style={{ display: "flex", width: "100%", overflowX: "auto" }}>
              {PIPELINE_STAGES.map((stage, idx) => {
                const count = hrStats.appraisals_by_stage[stage.key] ?? 0;
                const isFirst = idx === 0;
                const isLast = idx === PIPELINE_STAGES.length - 1;
                return (
                  <button
                    key={stage.key}
                    type="button"
                    onClick={() => router.push(`/admin/appraisals?status=${encodeURIComponent(stage.query)}`)}
                    style={{
                      flex: 1,
                      background: SURFACE,
                      border: `1px solid ${BORDER}`,
                      borderRight: isLast ? `1px solid ${BORDER}` : "none",
                      borderRadius: isFirst ? "10px 0 0 10px" : isLast ? "0 10px 10px 0" : 0,
                      padding: "10px 8px",
                      textAlign: "center",
                      cursor: "pointer",
                      fontFamily: "var(--ds-font-sans)",
                    }}
                    className="pipeline-box"
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = NAVY;
                      const c = e.currentTarget.querySelector(".pc");
                      const l = e.currentTarget.querySelector(".pl");
                      if (c) (c as HTMLElement).style.color = "#fff";
                      if (l) (l as HTMLElement).style.color = "rgba(255,255,255,0.6)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = SURFACE;
                      const c = e.currentTarget.querySelector(".pc");
                      const l = e.currentTarget.querySelector(".pl");
                      if (c) (c as HTMLElement).style.color = NAVY;
                      if (l) (l as HTMLElement).style.color = MUTED;
                    }}
                  >
                    <div
                      className="pc font-display"
                      style={{ fontSize: 16, fontWeight: 600, color: NAVY, lineHeight: 1.2 }}
                    >
                      {count}
                    </div>
                    <div
                      className="pl"
                      style={{
                        fontSize: 9,
                        fontWeight: 600,
                        letterSpacing: "0.06em",
                        textTransform: "uppercase",
                        color: MUTED,
                        marginTop: 4,
                      }}
                    >
                      {stage.label}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mb-5 grid grid-cols-1 gap-5 md:grid-cols-2">
            <div
              style={{
                background: "#fff",
                border: `1px solid ${BORDER}`,
                borderRadius: 8,
                padding: "18px 20px",
              }}
            >
              <h3 className="font-display" style={{ fontSize: 15, fontWeight: 600, color: NAVY, marginBottom: 12 }}>
                Score distribution
              </h3>
              <ScoreDistributionChart
                buckets={hrStats.score_distribution}
                meanScore={hrStats.mean_score}
              />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 14 }}>
                {[
                  { c: "#2e7d4f", t: "Exceptional (90+)" },
                  { c: "#0d0e10", t: "Meets/exceeds (70–89)" },
                  { c: "#8a5a00", t: "Approaching (40–69)" },
                  { c: "#b42318", t: "Below (0–39)" },
                ].map((x) => (
                  <div key={x.t} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#0d0d0d" }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: x.c }} />
                    {x.t}
                  </div>
                ))}
              </div>
            </div>

            <div
              style={{
                background: "#fff",
                border: `1px solid ${BORDER}`,
                borderRadius: 8,
                padding: "18px 20px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 16,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div
                    style={{
                      width: 28,
                      height: 28,
                      background: "#fffbeb",
                      border: "1px solid #fbe3a1",
                      borderRadius: 8,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <span style={{ fontSize: 14, color: "#8a5a00", lineHeight: 1 }} aria-hidden>
                      ★
                    </span>
                  </div>
                  <span className="font-display" style={{ fontFamily: "var(--ds-font-sans)", fontSize: 13, fontWeight: 600, color: NAVY }}>
                    AI insights
                  </span>
                </div>
                <span style={{ fontSize: 10, color: MUTED }}>Powered by Claude</span>
              </div>
              {!aiText && (
                <button
                  type="button"
                  disabled={aiLoading}
                  onClick={generateAi}
                  style={{
                    background: NAVY,
                    color: "#fff",
                    border: "none",
                    borderRadius: 8,
                    padding: "8px 16px",
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: aiLoading ? "wait" : "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    fontFamily: "var(--ds-font-sans)",
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
                  </svg>
                  {aiLoading ? "Analysing…" : "Generate insights"}
                </button>
              )}
              {aiError && <p style={{ color: "#b42318", fontSize: 12, marginTop: 8 }}>{aiError}</p>}
              {aiLoading && (
                <div style={{ marginTop: 12 }}>
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="hr-ai-insights-skeleton"
                      style={{
                        height: 60,
                        background: "#f3f3f3",
                        borderRadius: 8,
                        marginBottom: 8,
                      }}
                    />
                  ))}
                </div>
              )}
              {!aiLoading && parsedAiInsights && parsedAiInsights.insights.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  {parsedAiInsights.insights.map((ins, i) => {
                    const accentColor = AI_INSIGHT_ACCENTS[i % AI_INSIGHT_ACCENTS.length];
                    return (
                      <div
                        key={i}
                        style={{
                          background: SURFACE,
                          border: `1px solid ${BORDER}`,
                          borderLeft: `3px solid ${accentColor}`,
                          borderRadius: "0 10px 10px 0",
                          padding: "12px 16px",
                          marginBottom: 8,
                        }}
                      >
                        {ins.title ? (
                          <div
                            style={{
                              fontSize: 12,
                              fontWeight: 600,
                              color: NAVY,
                              marginBottom: 3,
                            }}
                          >
                            {ins.title}
                          </div>
                        ) : null}
                        <div style={{ fontSize: 12, color: "#646f79", lineHeight: 1.6 }}>{ins.body}</div>
                      </div>
                    );
                  })}
                </div>
              )}
              {!aiLoading && parsedAiInsights && parsedAiInsights.actions.length > 0 && (
                <div>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      color: MUTED,
                      marginTop: 16,
                      marginBottom: 8,
                      letterSpacing: "0.04em",
                    }}
                  >
                    Recommended actions
                  </div>
                  {parsedAiInsights.actions.map((action, i) => (
                    <div
                      key={i}
                      style={{
                        background: "#fff",
                        border: `1px solid ${BORDER}`,
                        borderLeft: `3px solid ${AI_RECOMMENDED_ACTION_ACCENT}`,
                        borderRadius: 8,
                        padding: "10px 14px",
                        display: "flex",
                        gap: 12,
                        alignItems: "flex-start",
                        marginBottom: 8,
                      }}
                    >
                      <div
                        style={{
                          width: 20,
                          height: 20,
                          minWidth: 20,
                          background: NAVY,
                          color: "#fff",
                          borderRadius: "50%",
                          fontSize: 10,
                          fontWeight: 600,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        {i + 1}
                      </div>
                      <div style={{ fontSize: 12, color: "#0d0d0d", lineHeight: 1.5 }}>{action}</div>
                    </div>
                  ))}
                </div>
              )}
              {!aiLoading &&
                parsedAiInsights &&
                parsedAiInsights.insights.length === 0 &&
                parsedAiInsights.actions.length === 0 &&
                aiText && (
                  <div
                    style={{
                      marginTop: 12,
                      background: SURFACE,
                      border: `1px solid ${BORDER}`,
                      borderLeft: `3px solid ${AI_INSIGHT_ACCENTS[0]}`,
                      borderRadius: "0 10px 10px 0",
                      padding: "12px 16px",
                      fontSize: 12,
                      color: "#646f79",
                      lineHeight: 1.6,
                    }}
                  >
                    {aiText.replace(/\*\*/g, "").trim()}
                  </div>
                )}
            </div>
          </div>

          <div className="mb-6 grid grid-cols-1 gap-5 md:grid-cols-2">
            <div
              style={{
                background: "#fff",
                border: `1px solid ${BORDER}`,
                borderRadius: 8,
                overflow: "hidden",
              }}
            >
              <div style={{ padding: "16px 20px", borderBottom: `1px solid ${BORDER}`, background: SURFACE }}>
                <h3 className="font-display" style={{ fontSize: 15, fontWeight: 600, color: NAVY }}>
                  Division breakdown
                </h3>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {["Division", "Employees", "Avg score", "Completed", "In progress"].map((h) => (
                        <th
                          key={h}
                          style={{
                            textAlign: "left",
                            padding: "10px 16px",
                            fontSize: 10,
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                            color: MUTED,
                            background: SURFACE,
                            borderBottom: `1px solid ${BORDER}`,
                          }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {hrStats.division_breakdown.map((row) => (
                      <tr key={row.rowKey}>
                        <td style={{ padding: "10px 16px", fontSize: 12, color: NAVY, borderTop: "1px solid #f3f3f3" }}>
                          {row.division}
                        </td>
                        <td style={{ padding: "10px 16px", fontSize: 12, borderTop: "1px solid #f3f3f3" }}>{row.employees}</td>
                        <td style={{ padding: "10px 16px", borderTop: "1px solid #f3f3f3" }}>
                          {divisionScorePill(row.avgScore)}
                        </td>
                        <td style={{ padding: "10px 16px", fontSize: 12, borderTop: "1px solid #f3f3f3" }}>{row.completed}</td>
                        <td style={{ padding: "10px 16px", fontSize: 12, borderTop: "1px solid #f3f3f3" }}>
                          {row.inProgress}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div
              style={{
                background: "#fff",
                border: `1px solid ${BORDER}`,
                borderRadius: 8,
                overflow: "hidden",
              }}
            >
              <div style={{ padding: "16px 20px", borderBottom: `1px solid ${BORDER}`, background: SURFACE }}>
                <h3 className="font-display" style={{ fontSize: 15, fontWeight: 600, color: NAVY }}>
                  Recent activity
                </h3>
              </div>
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {hrStats.recent_activity.map((item, idx) => (
                  <li
                    key={`${item.at}-${idx}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "12px 16px",
                      borderBottom: idx === hrStats.recent_activity.length - 1 ? "none" : "1px solid #f3f3f3",
                    }}
                  >
                    <div
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: "50%",
                        ...avatarAccent(item.employeeName).style,
                        fontSize: 11,
                        fontWeight: 600,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      {item.initials}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: NAVY }}>
                        <strong>{item.employeeName}</strong>
                        <span style={{ color: MUTED }}> → </span>
                        <strong>{item.toStatus.replace(/_/g, " ")}</strong>
                        <span style={{ color: MUTED }}> · {item.cycleName}</span>
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: MUTED, flexShrink: 0 }}>{formatRelativeTime(item.at)}</div>
                  </li>
                ))}
                {hrStats.recent_activity.length === 0 && (
                  <li style={{ padding: 16, fontSize: 13, color: MUTED }}>No recent status changes.</li>
                )}
              </ul>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
