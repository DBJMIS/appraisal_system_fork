"use client";

import { useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
} from "chart.js";
import { Bar } from "react-chartjs-2";
import type { ScoreDistributionBucket } from "@/lib/dashboard-hr-stats";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip);

interface Props {
  buckets: ScoreDistributionBucket[];
  meanScore: number | null;
}

export function ScoreDistributionChart({ buckets, meanScore }: Props) {
  const data = useMemo(
    () => ({
      labels: buckets.map((b) => b.label),
      datasets: [
        {
          data: buckets.map((b) => b.count),
          backgroundColor: buckets.map((b) => b.barColor ?? "#0d0e10"),
          borderColor: buckets.map((b) => (b.anomaly ? "#8a5a00" : "transparent")),
          borderWidth: buckets.map((b) => (b.anomaly ? 2 : 0)),
          borderRadius: 3,
        },
      ],
    }),
    [buckets]
  );

  const options = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx: { parsed: { y: number } }) =>
              `${ctx.parsed.y} employee${ctx.parsed.y === 1 ? "" : "s"}`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 10 }, color: "#646f79" },
        },
        y: {
          beginAtZero: true,
          grid: { color: "#f3f3f3" },
          ticks: { font: { size: 10 }, color: "#646f79", precision: 0 },
        },
      },
    }),
    []
  );

  return (
    <div>
      <div style={{ height: 120, position: "relative" }}>
        <Bar data={data} options={options as never} />
      </div>
      {meanScore != null && !Number.isNaN(meanScore) && (
        <div style={{ marginTop: 10 }}>
          <div
            style={{
              position: "relative",
              height: 10,
              background: "#f3f3f3",
              borderRadius: 4,
            }}
          >
            <div
              style={{
                position: "absolute",
                left: `clamp(0%, ${meanScore}%, 100%)`,
                top: -6,
                bottom: -6,
                width: 0,
                borderLeft: "2px dashed #646f79",
                transform: "translateX(-1px)",
              }}
              title={`Mean ${meanScore}%`}
            />
          </div>
          <div style={{ fontSize: 10, color: "#646f79", marginTop: 4 }}>
            Mean overall score: <strong style={{ color: "#0d0d0d" }}>{meanScore}%</strong>
          </div>
        </div>
      )}
    </div>
  );
}
