"use client";

import type { ReactNode } from "react";
import type { CompetencyGap } from "@/lib/feedback-gap-analysis";

const ROLE_LABELS: Record<string, string> = {
  self: "Self",
  manager: "Manager",
  peer: "Peer",
  direct_report: "Direct reports",
};

const ROLE_COLORS: Record<string, string> = {
  self: "#3d5a78",
  manager: "#0d0e10",
  peer: "#8a5a00",
  direct_report: "#3d5a78",
};

const GAP_CONFIG: Record<
  CompetencyGap["gap_label"],
  { color: string; bg: string; dot: string }
> = {
  Aligned: { color: "#2b2d31", bg: "#f3f3f3", dot: "#34d399" },
  "Slight Gap": { color: "#8a5a00", bg: "#fffbeb", dot: "#fbbf24" },
  "Significant Gap": { color: "#b42318", bg: "#fef2f2", dot: "#f87171" },
};

function externalOthersAverage(g: CompetencyGap): number | null {
  const others = [g.manager, g.peer, g.direct_report].filter((s): s is number => s !== null);
  if (others.length === 0) return null;
  return Math.round((others.reduce((a, b) => a + b, 0) / others.length) * 10) / 10;
}

function ScoreBar({
  role,
  score,
  max = 5,
}: {
  role: string;
  score: number | null;
  max?: number;
}) {
  if (score === null)
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ width: 96, fontSize: 11, color: "var(--color-text-secondary)" }}>
          {ROLE_LABELS[role]}
        </span>
        <span style={{ fontSize: 11, color: "var(--color-text-secondary)", fontStyle: "italic" }}>
          No responses
        </span>
      </div>
    );

  const pct = (score / max) * 100;
  const color = ROLE_COLORS[role];

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
      <span
        style={{ width: 96, fontSize: 11, color: "var(--color-text-secondary)", flexShrink: 0 }}
      >
        {ROLE_LABELS[role]}
      </span>
      <div
        style={{
          flex: 1,
          height: 6,
          background: "var(--color-border-tertiary)",
          borderRadius: 3,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: color,
            borderRadius: 3,
            transition: "width 0.7s cubic-bezier(.4,0,.2,1)",
          }}
        />
      </div>
      <span
        style={{
          width: 28,
          fontSize: 12,
          fontWeight: 500,
          color: "var(--color-text-primary)",
          textAlign: "right",
          flexShrink: 0,
        }}
      >
        {score.toFixed(1)}
      </span>
    </div>
  );
}

function GapAnalysisCardShell({
  children,
  headerExtra,
}: {
  children: ReactNode;
  headerExtra?: ReactNode;
}) {
  return (
    <div
      style={{
        background: "var(--color-background-primary)",
        border: "0.5px solid var(--color-border-tertiary)",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "18px 20px 14px",
          borderBottom: "0.5px solid var(--color-border-tertiary)",
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
        }}
      >
        <div>
          <p
            style={{
              margin: 0,
              fontSize: 14,
              fontWeight: 600,
              color: "var(--color-text-primary)",
              fontFamily: "var(--ds-font-sans)",
            }}
          >
            Feedback gap analysis
          </p>
          <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--color-text-secondary)" }}>
            How your self-perception compares to others&apos; ratings
          </p>
        </div>
        {headerExtra}
      </div>
      {children}
    </div>
  );
}

export function GapAnalysisCard({ gaps }: { gaps: CompetencyGap[] }) {
  if (!gaps.length) {
    return (
      <GapAnalysisCardShell>
        <div style={{ padding: "16px 20px 18px" }}>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.45, color: "var(--color-text-secondary)" }}>
            There isn&apos;t enough submitted feedback by competency to compare roles yet. This section
            will fill in once ratings are in.
          </p>
        </div>
      </GapAnalysisCardShell>
    );
  }

  const significantCount = gaps.filter((g) => g.gap_label === "Significant Gap").length;
  const blindSpots = gaps.filter((g) => g.blind_spot);
  const hiddenStrengths = gaps.filter((g) => g.hidden_strength);

  return (
    <GapAnalysisCardShell
      headerExtra={
        significantCount > 0 ? (
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              flexShrink: 0,
              marginLeft: 12,
              padding: "4px 10px",
              borderRadius: 20,
              color: "#b42318",
              background: "#fef2f2",
            }}
          >
            {significantCount} significant gap{significantCount > 1 ? "s" : ""}
          </span>
        ) : undefined
      }
    >
      {(blindSpots.length > 0 || hiddenStrengths.length > 0) && (
        <div
          style={{
            padding: "12px 20px",
            borderBottom: "0.5px solid var(--color-border-tertiary)",
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {blindSpots.map((g) => {
            const extAvg = externalOthersAverage(g);
            return (
              <div
                key={`bs-${g.competency}`}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  padding: "10px 12px",
                  borderRadius: 8,
                  background: "#fef2f2",
                  border: "0.5px solid #fbd5d5",
                }}
              >
                <div
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "#b42318",
                    marginTop: 4,
                    flexShrink: 0,
                  }}
                />
                <div>
                  <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "#b42318" }}>
                    Possible blind spot — {g.competency}
                  </p>
                  <p style={{ margin: "2px 0 0", fontSize: 11, color: "#b42318" }}>
                    You rated yourself {g.self?.toFixed(1)} but others averaged{" "}
                    {extAvg != null ? extAvg.toFixed(1) : "—"} — consider seeking feedback in this area
                  </p>
                </div>
              </div>
            );
          })}
          {hiddenStrengths.map((g) => (
            <div
              key={`hs-${g.competency}`}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: "10px 12px",
                borderRadius: 8,
                background: "#f3f3f3",
                border: "0.5px solid #bbf0d9",
              }}
            >
              <div
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#0d0e10",
                  marginTop: 4,
                  flexShrink: 0,
                }}
              />
              <div>
                <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: "#2e7d4f" }}>
                  Hidden strength — {g.competency}
                </p>
                <p style={{ margin: "2px 0 0", fontSize: 11, color: "#2b2d31" }}>
                  Others rate you higher than you rate yourself — you may be underselling this strength
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ padding: "8px 0" }}>
        {gaps.map((gap, i) => {
          const cfg = GAP_CONFIG[gap.gap_label];
          const isLast = i === gaps.length - 1;

          return (
            <div
              key={gap.competency}
              style={{
                padding: "14px 20px",
                borderBottom: isLast ? "none" : "0.5px solid var(--color-border-tertiary)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 12,
                }}
              >
                <p
                  style={{
                    margin: 0,
                    fontSize: 13,
                    fontWeight: 500,
                    color: "var(--color-text-primary)",
                  }}
                >
                  {gap.competency}
                </p>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {gap.max_gap > 0 && (
                    <span style={{ fontSize: 10, color: "var(--color-text-secondary)" }}>
                      {gap.max_gap.toFixed(1)} pt gap
                    </span>
                  )}
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      padding: "3px 8px",
                      borderRadius: 20,
                      color: cfg.color,
                      background: cfg.bg,
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <span
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: "50%",
                        background: cfg.dot,
                        display: "inline-block",
                      }}
                    />
                    {gap.gap_label}
                  </span>
                </div>
              </div>

              <div>
                {(["self", "manager", "peer", "direct_report"] as const).map((role) => (
                  <ScoreBar key={role} role={role} score={gap[role]} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div
        style={{
          padding: "12px 20px",
          borderTop: "0.5px solid var(--color-border-tertiary)",
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        {Object.entries(GAP_CONFIG).map(([label, cfg]) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: cfg.dot,
                display: "inline-block",
              }}
            />
            <span style={{ fontSize: 10, color: "var(--color-text-secondary)" }}>{label}</span>
          </div>
        ))}
        <span style={{ fontSize: 10, color: "var(--color-text-secondary)", marginLeft: "auto" }}>
          Scale: 1–5
        </span>
      </div>
    </GapAnalysisCardShell>
  );
}
