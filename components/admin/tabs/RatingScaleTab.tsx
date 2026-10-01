"use client";

import { useMemo } from "react";
import { useAdminPanel } from "../AdminPanelContext";
import {
  CardWrapper,
  EmptyTableRow,
  StarIcon,
  thStyle,
  tdStyle,
} from "../admin-shared";

function factorColor(factor: number): string {
  if (factor <= 0.2) return "#b42318";
  if (factor <= 0.4) return "#8a5a00";
  if (factor <= 0.6) return "#8a5a00";
  if (factor <= 0.8) return "#2e7d4f";
  return "#2e7d4f";
}

export function RatingScaleTab() {
  const { ratingScale, referenceDataLoaded } = useAdminPanel();
  const sorted = useMemo(
    () => [...ratingScale].sort((a, b) => (Number(a.factor) ?? 0) - (Number(b.factor) ?? 0)),
    [ratingScale]
  );

  return (
    <CardWrapper
      title="Rating Scale"
      subtitle="1–10 numeric scale used in self-assessment and manager review"
      icon={<StarIcon />}
      iconBg="#fffbeb"
      iconColor="#8a5a00"
      delay="0.20s"
    >
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={thStyle}>Code</th>
            <th style={thStyle}>Factor</th>
            <th style={thStyle}>Label</th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <EmptyTableRow colSpan={3}>
              {referenceDataLoaded ? "No rating scale entries configured." : "Rating scale could not be loaded."}
            </EmptyTableRow>
          )}
          {sorted.map((r) => {
            const f = Number(r.factor) ?? 0;
            const color = factorColor(f);
            return (
              <tr key={r.id} style={{ transition: "background 0.13s" }} onMouseEnter={(e) => { e.currentTarget.style.background = "#f3f3f3"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
                <td style={{ ...tdStyle, fontWeight: 600, color: "#0d0d0d" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "28px", height: "28px", borderRadius: "6px", background: "#f3f3f3", border: "1px solid #e7e7e7", fontFamily: "ui-monospace, monospace", fontSize: "12px" }}>{r.code}</span>
                </td>
                <td style={{ ...tdStyle, fontWeight: 600, color }}>{f}</td>
                <td style={tdStyle}>{r.label}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p style={{ marginTop: 12, fontSize: "11px", color: "#646f79", borderTop: "1px solid #e7e7e7", paddingTop: 10 }}>
        Ratings 1–10. Score = rating factor × competency weight.
      </p>
    </CardWrapper>
  );
}
