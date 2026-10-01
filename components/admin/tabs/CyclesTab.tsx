"use client";

import { useAdminPanel } from "../AdminPanelContext";
import {
  CardWrapper,
  ActionButton,
  IconButton,
  StatusBadge,
  CalendarIcon,
  RefreshIcon,
  PlusIcon,
  PencilIcon,
  PlayIcon,
  LockIcon,
  thStyle,
  tdStyle,
  cycleToForm,
  cycleMidyearStatus,
} from "../admin-shared";

const MIDYEAR_PILL: Record<"Off" | "On" | "Scored", { background: string; color: string; border: string }> = {
  Off: { background: "#f3f3f3", color: "#646f79", border: "#e7e7e7" },
  On: { background: "#eef4fb", color: "#3d5a78", border: "#d0d4d8" },
  Scored: { background: "#ecfdf5", color: "#2e7d4f", border: "#bbf0d9" },
};

export function CyclesTab() {
  const {
    cycles,
    load,
    setCycleModal,
    setCycleStatus,
    openAssessmentPhase,
    emptyCycleForm,
  } = useAdminPanel();

  return (
    <CardWrapper
      title="Appraisal Cycles"
      subtitle="Manage appraisal periods and their status"
      icon={<CalendarIcon />}
      iconBg="#f3f3f3"
      iconColor="#0d0e10"
      delay="0.08s"
      rightAction={
        <div style={{ display: "flex", gap: "8px" }}>
          <IconButton onClick={load}><RefreshIcon /></IconButton>
          <ActionButton variant="primary" onClick={() => setCycleModal({ open: true, mode: "create", data: emptyCycleForm })}><PlusIcon /> Create Cycle</ActionButton>
        </div>
      }
    >
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={thStyle}>Name</th>
            <th style={thStyle}>Type</th>
            <th style={thStyle}>Fiscal Year</th>
            <th style={thStyle}>Start</th>
            <th style={thStyle}>End</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle}>Phase</th>
            <th style={thStyle}>Mid-Year</th>
            <th style={{ ...thStyle, width: "260px" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {cycles.map((c) => (
            <tr key={c.id} style={{ transition: "background 0.13s" }} onMouseEnter={(e) => { e.currentTarget.style.background = "#f3f3f3"; }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}>
              <td style={{ ...tdStyle, fontWeight: 600, color: "#0d0d0d" }}>{c.name}</td>
              <td style={tdStyle}>{c.cycle_type.replace("_", " ")}</td>
              <td style={tdStyle}>{c.fiscal_year}</td>
              <td style={tdStyle}>{c.start_date}</td>
              <td style={tdStyle}>{c.end_date}</td>
              <td style={tdStyle}><StatusBadge status={c.status} /></td>
              <td style={tdStyle}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "5px",
                    padding: "3px 10px",
                    borderRadius: "4px",
                    fontSize: "11.5px",
                    fontWeight: 600,
                    background: c.phase === "planning" ? "#f3f3f3" : c.phase === "assessment" ? "#ecfdf5" : "#f3f3f3",
                    color: c.phase === "planning" ? "#3d5a78" : c.phase === "assessment" ? "#2e7d4f" : "#646f79",
                    border: `1px solid ${c.phase === "planning" ? "#d0d4d8" : c.phase === "assessment" ? "#bbf0d9" : "#e7e7e7"}`,
                    textTransform: "capitalize",
                  }}
                >
                  <span
                    style={{
                      width: "5px",
                      height: "5px",
                      borderRadius: "50%",
                      background: c.phase === "planning" ? "#0d0e10" : c.phase === "assessment" ? "#2e7d4f" : "#646f79",
                      display: "inline-block",
                    }}
                  />
                  {c.phase || "—"}
                </span>
              </td>
              <td style={tdStyle}>
                {(() => {
                  const midyear = cycleMidyearStatus(c);
                  const pill = MIDYEAR_PILL[midyear];
                  return (
                    <span
                      data-midyear-status={midyear}
                      title={midyear !== "Off" && c.midyear_due_date ? `Due ${c.midyear_due_date}` : undefined}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        padding: "3px 10px",
                        borderRadius: "4px",
                        fontSize: "11.5px",
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                        background: pill.background,
                        color: pill.color,
                        border: `1px solid ${pill.border}`,
                      }}
                    >
                      {midyear}
                    </span>
                  );
                })()}
              </td>
              <td style={tdStyle}>
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px" }}>
                  <IconButton onClick={() => setCycleModal({ open: true, mode: "edit", id: c.id, data: cycleToForm(c) })}><PencilIcon /></IconButton>
                  {c.status === "draft" && <ActionButton onClick={() => setCycleStatus(c.id, "open")}><PlayIcon /> Open</ActionButton>}
                  {c.status === "open" && c.phase === "planning" && <ActionButton variant="primary" onClick={() => openAssessmentPhase(c.id)}><PlayIcon /> Start Assessment</ActionButton>}
                  {(c.status === "open" || c.status === "draft") && <ActionButton onClick={() => setCycleStatus(c.id, "closed")}><LockIcon /> Close</ActionButton>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </CardWrapper>
  );
}
