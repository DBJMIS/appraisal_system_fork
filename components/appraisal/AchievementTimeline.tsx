"use client";

import { useEffect, useState } from "react";

interface TimelineEntry {
  id: string;
  achievement_id: string | null;
  date_detected: string;
  summary: string | null;
}

interface MonthGroup {
  month: string;
  achievements: TimelineEntry[];
}

interface AchievementTimelineProps {
  employeeId: string | null;
}

function formatMonth(monthStr: string): string {
  try {
    const [year, month] = monthStr.split("-");
    const d = new Date(parseInt(year, 10), parseInt(month, 10) - 1);
    return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  } catch {
    return monthStr;
  }
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

const TimelineIcon = () => (
  <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

export function AchievementTimeline({ employeeId }: AchievementTimelineProps) {
  const [months, setMonths] = useState<MonthGroup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!employeeId) {
      setLoading(false);
      setMonths([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/evidence/timeline/${employeeId}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setMonths(data.months ?? []);
      })
      .catch(() => {
        if (!cancelled) setMonths([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  if (!employeeId) return null;

  return (
    <div
      className="overflow-hidden rounded-ds-panel bg-white"
      style={{
        boxShadow: "var(--shadow-card)",
        border: "1px solid var(--border-color)",
      }}
    >
      <div
        className="flex items-center gap-3 px-6 py-5"
        style={{ borderBottom: "1px solid var(--border-color)" }}
      >
        <div
          className="flex h-[30px] w-[30px] items-center justify-center rounded-lg"
          style={{ backgroundColor: "#f3f3f3" }}
        >
          <span style={{ color: "#0d0e10" }}>
            <TimelineIcon />
          </span>
        </div>
        <div>
          <h2 className="font-display text-[15px] font-semibold text-text-primary">
            Achievement Timeline
          </h2>
          <p className="text-xs text-text-muted">
            AI-detected achievements from your appraisals
          </p>
        </div>
      </div>
      <div className="p-6">
        {loading ? (
          <p className="text-sm text-text-muted">Loading…</p>
        ) : months.length === 0 ? (
          <p className="text-sm text-text-muted">
            No achievements yet. Use the AI Achievement Evidence Builder in an appraisal to add achievements.
          </p>
        ) : (
          <div className="space-y-6">
            {months.map(({ month, achievements }) => (
              <div key={month}>
                <h3 className="mb-2 text-sm font-medium text-text-primary">
                  {formatMonth(month)}
                </h3>
                <ul className="space-y-2">
                  {achievements.map((a) => (
                    <li
                      key={a.id}
                      className="flex gap-3 rounded-lg px-3 py-2 text-sm"
                      style={{ border: "1px solid var(--border-color)" }}
                    >
                      <span className="shrink-0 text-xs text-text-muted">
                        {formatDate(a.date_detected)}
                      </span>
                      <span className="text-text-primary">
                        {a.summary ?? "Achievement"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
