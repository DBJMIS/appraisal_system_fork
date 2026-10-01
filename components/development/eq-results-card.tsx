"use client";

import { useEffect, useRef } from "react";

export interface EqResult {
  sa_total: number;
  me_total: number;
  mo_total: number;
  e_total: number;
  ss_total: number;
  total_score: number;
  taken_at: string;
}

interface Props {
  result: EqResult;
  onViewFull?: () => void;
  onRetake?: () => void;
  daysUntilRetake?: number;
}

const COMPETENCIES = [
  { key: "sa", label: "Self awareness", fullLabel: "Self awareness" },
  { key: "me", label: "Managing emotions", fullLabel: "Managing emotions" },
  { key: "mo", label: "Motivating oneself", fullLabel: "Motivating oneself" },
  { key: "e", label: "Empathy", fullLabel: "Empathy" },
  { key: "ss", label: "Social skills", fullLabel: "Social skills" },
] as const;

function getStatus(score: number) {
  if (score >= 35)
    return {
      label: "Strength",
      color: "#2b2d31",
      bg: "#f3f3f3",
      stroke: "#0d0e10",
    };
  if (score >= 18)
    return {
      label: "Needs attention",
      color: "#8a5a00",
      bg: "#fffbeb",
      stroke: "#8a5a00",
    };
  return {
    label: "Dev. priority",
    color: "#b42318",
    bg: "#fef2f2",
    stroke: "#b42318",
  };
}

function getOverallBand(total: number) {
  if (total >= 175) return { label: "High EQ", color: "#2b2d31", bg: "#f3f3f3" };
  if (total >= 90) return { label: "Developing EQ", color: "#8a5a00", bg: "#fffbeb" };
  return { label: "Building EQ", color: "#b42318", bg: "#fef2f2" };
}

function MiniArc({ score, stroke, delay }: { score: number; stroke: string; delay: number }) {
  const circleRef = useRef<SVGCircleElement>(null);
  const r = 18;
  const circ = 2 * Math.PI * r;
  const pct = score / 50;
  const offset = circ * (1 - pct);

  useEffect(() => {
    const el = circleRef.current;
    if (!el) return;
    el.style.strokeDashoffset = String(circ);
    const timer = setTimeout(() => {
      el.style.transition = `stroke-dashoffset 0.9s cubic-bezier(.4,0,.2,1) ${delay}ms`;
      el.style.strokeDashoffset = String(offset);
    }, 50);
    return () => clearTimeout(timer);
  }, [circ, offset, delay]);

  return (
    <svg
      viewBox="0 0 48 48"
      width="48"
      height="48"
      style={{ transform: "rotate(-90deg)", display: "block", margin: "0 auto 6px" }}
    >
      <circle cx="24" cy="24" r={r} fill="none" stroke="var(--color-border-tertiary, #e7e7e7)" strokeWidth="5" />
      <circle
        ref={circleRef}
        cx="24"
        cy="24"
        r={r}
        fill="none"
        stroke={stroke}
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={circ}
      />
    </svg>
  );
}

function MainRing({ total }: { total: number }) {
  const circleRef = useRef<SVGCircleElement>(null);
  const r = 54;
  const circ = 2 * Math.PI * r;
  const pct = total / 250;
  const offset = circ * (1 - pct);
  const band = getOverallBand(total);

  useEffect(() => {
    const el = circleRef.current;
    if (!el) return;
    el.style.strokeDashoffset = String(circ);
    const timer = setTimeout(() => {
      el.style.transition = "stroke-dashoffset 1s cubic-bezier(.4,0,.2,1) 0.1s";
      el.style.strokeDashoffset = String(offset);
    }, 50);
    return () => clearTimeout(timer);
  }, [circ, offset]);

  return (
    <div style={{ position: "relative", flexShrink: 0, width: 130, height: 130 }}>
      <svg viewBox="0 0 130 130" width="130" height="130" style={{ transform: "rotate(-90deg)" }}>
        <circle cx="65" cy="65" r={r} fill="none" stroke="var(--color-border-tertiary, #e7e7e7)" strokeWidth="10" />
        <circle
          ref={circleRef}
          cx="65"
          cy="65"
          r={r}
          fill="none"
          stroke={band.color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          style={{
            fontSize: 28,
            fontWeight: 600,
            lineHeight: 1,
            color: "var(--color-text-primary)",
            fontFamily: "var(--ds-font-sans)",
          }}
        >
          {total}
        </span>
        <span style={{ fontSize: 10, color: "var(--color-text-secondary)", marginTop: 2 }}>/ 250</span>
      </div>
    </div>
  );
}

export function EqResultsCard({ result, onViewFull, daysUntilRetake = 90 }: Props) {
  const band = getOverallBand(result.total_score);

  const scores: Record<(typeof COMPETENCIES)[number]["key"], number> = {
    sa: result.sa_total,
    me: result.me_total,
    mo: result.mo_total,
    e: result.e_total,
    ss: result.ss_total,
  };

  return (
    <div
      style={{
        background: "var(--color-background-primary, #fff)",
        border: "0.5px solid var(--color-border-tertiary, #e7e7e7)",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "18px 20px 0",
          display: "flex",
          alignItems: "center",
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
            Emotional intelligence
          </p>
          <p style={{ margin: "3px 0 0", fontSize: 11, color: "var(--color-text-secondary)" }}>
            Last assessed{" "}
            {new Date(result.taken_at).toLocaleDateString("en-JM", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </p>
        </div>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: "4px 10px",
            borderRadius: 20,
            color: band.color,
            background: band.bg,
          }}
        >
          {band.label}
        </span>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 24,
          padding: "18px 20px",
        }}
      >
        <MainRing total={result.total_score} />

        <div style={{ flex: 1 }}>
          <p
            style={{
              margin: "0 0 10px",
              fontSize: 11,
              color: "var(--color-text-secondary)",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Competencies
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {COMPETENCIES.map(({ key, fullLabel }) => {
              const score = scores[key];
              const { stroke } = getStatus(score);
              const pct = (score / 50) * 100;
              return (
                <div
                  key={key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    fontSize: 12,
                  }}
                >
                  <span style={{ color: "var(--color-text-secondary)", minWidth: 120 }}>{fullLabel}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div
                      style={{
                        width: 80,
                        height: 4,
                        background: "var(--color-border-tertiary, #e7e7e7)",
                        borderRadius: 2,
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${pct}%`,
                          height: "100%",
                          background: stroke,
                          borderRadius: 2,
                          transition: "width 0.8s cubic-bezier(.4,0,.2,1)",
                        }}
                      />
                    </div>
                    <span
                      style={{
                        fontWeight: 600,
                        color: "var(--color-text-primary)",
                        minWidth: 20,
                        textAlign: "right",
                        fontSize: 12,
                      }}
                    >
                      {score}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          borderTop: "0.5px solid var(--color-border-tertiary, #e7e7e7)",
        }}
      >
        {COMPETENCIES.map(({ key, label }, i) => {
          const score = scores[key];
          const { label: statusLabel, color, bg, stroke } = getStatus(score);
          const isLast = i === COMPETENCIES.length - 1;
          return (
            <div
              key={key}
              style={{
                padding: "14px 8px",
                textAlign: "center",
                borderRight: isLast ? "none" : "0.5px solid var(--color-border-tertiary, #e7e7e7)",
              }}
            >
              <MiniArc score={score} stroke={stroke} delay={300 + i * 100} />
              <p
                style={{
                  margin: 0,
                  fontSize: 15,
                  fontWeight: 600,
                  color: "var(--color-text-primary)",
                  lineHeight: 1,
                  fontFamily: "var(--ds-font-sans)",
                }}
              >
                {score}
              </p>
              <p
                style={{
                  margin: "3px 0 0",
                  fontSize: 9,
                  color: "var(--color-text-secondary)",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                {label}
              </p>
              <span
                style={{
                  display: "inline-block",
                  marginTop: 5,
                  fontSize: 9,
                  fontWeight: 600,
                  color,
                  background: bg,
                  padding: "2px 6px",
                  borderRadius: 20,
                }}
              >
                {statusLabel}
              </span>
            </div>
          );
        })}
      </div>

      <div
        style={{
          padding: "11px 20px",
          borderTop: "0.5px solid var(--color-border-tertiary, #e7e7e7)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <p style={{ margin: 0, fontSize: 11, color: "var(--color-text-secondary)" }}>
          {daysUntilRetake > 0 ? `Retake available in ${daysUntilRetake} days` : "Retake now available"}
        </p>
        {onViewFull && (
          <button
            type="button"
            onClick={onViewFull}
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "#2b2d31",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
            }}
          >
            View full results →
          </button>
        )}
      </div>
    </div>
  );
}
