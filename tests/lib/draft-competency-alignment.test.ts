import { describe, expect, it } from "vitest";
import { canEditField, type EditableField, type WorkflowRole } from "@/lib/appraisal-workflow";
import { calcCompletion } from "@/lib/appraisal-completion";
import type { AppraisalStatus } from "@/types/appraisal";

const RATING_FIELDS: EditableField[] = ["self_rating", "self_comments", "manager_rating", "manager_comments"];

describe("canEditField stage alignment", () => {
  it.each<WorkflowRole>(["EMPLOYEE", "MANAGER"])("DRAFT %s can edit structure but no ratings or comments", (role) => {
    expect(canEditField("workplan_structure", "DRAFT", role)).toBe(true);
    for (const field of RATING_FIELDS) expect(canEditField(field, "DRAFT", role), field).toBe(false);
  });

  it("SELF_ASSESSMENT employee can edit self rating and comments only", () => {
    expect(canEditField("self_rating", "SELF_ASSESSMENT", "EMPLOYEE")).toBe(true);
    expect(canEditField("self_comments", "SELF_ASSESSMENT", "EMPLOYEE")).toBe(true);
    expect(canEditField("actual_ytd", "SELF_ASSESSMENT", "EMPLOYEE")).toBe(true);
    expect(canEditField("manager_rating", "SELF_ASSESSMENT", "EMPLOYEE")).toBe(false);
    expect(canEditField("self_rating", "SELF_ASSESSMENT", "MANAGER")).toBe(false);
  });

  it("MANAGER_REVIEW manager can edit manager rating and comments only", () => {
    expect(canEditField("manager_rating", "MANAGER_REVIEW", "MANAGER")).toBe(true);
    expect(canEditField("manager_comments", "MANAGER_REVIEW", "MANAGER")).toBe(true);
    expect(canEditField("self_rating", "MANAGER_REVIEW", "MANAGER")).toBe(false);
    expect(canEditField("manager_rating", "MANAGER_REVIEW", "EMPLOYEE")).toBe(false);
  });

  it.each<AppraisalStatus>(["PENDING_APPROVAL", "IN_PROGRESS", "PENDING_SIGNOFF", "HR_REVIEW", "COMPLETE"])(
    "%s allows no rating or comment edits",
    (status) => {
      for (const role of ["EMPLOYEE", "MANAGER", "HOD", "HR"] as WorkflowRole[]) {
        for (const field of RATING_FIELDS) expect(canEditField(field, status, role), `${role} ${field}`).toBe(false);
      }
    }
  );
});

describe("DRAFT competency blocker wording", () => {
  const base = {
    workplanItems: [{ id: "w", major_task: "t", key_output: "o", performance_standard: "p", weight: 100 }],
    coreFactorIds: ["c1", "c2"],
    productivityFactorIds: ["p1"],
    leadershipFactorIds: ["l1"],
    technicalCompetencies: [],
    showLeadership: true,
  };

  it("refers to setting and saving weights that total 100%", () => {
    const report = calcCompletion({ ...base, appraisalStatus: "DRAFT", factorRatings: [{ factor_id: "c1", weight: 40 }] });
    expect(report.blockers).toEqual([
      "Core Competencies: set and save weights for all factors. Total weight must equal 100%.",
      "Productivity: set and save weights for all factors. Total weight must equal 100%.",
      "Leadership: set and save weights for all factors. Total weight must equal 100%.",
    ]);
    expect(report.blockers.join(" ")).not.toMatch(/rating/i);
  });

  it("clears once every factor has a saved weight row totalling 100%", () => {
    const report = calcCompletion({
      ...base,
      appraisalStatus: "DRAFT",
      factorRatings: [
        { factor_id: "c1", weight: 60 },
        { factor_id: "c2", weight: 40 },
        { factor_id: "p1", weight: 100 },
        { factor_id: "l1", weight: 100 },
      ],
    });
    expect(report.blockers).toEqual([]);
    expect(report.canSubmit).toBe(true);
  });

  it("keeps the rating-missing wording outside DRAFT", () => {
    const report = calcCompletion({ ...base, appraisalStatus: "SELF_ASSESSMENT", factorRatings: [] });
    expect(report.blockers).toContain("Core Competencies: 2 rating(s) missing");
  });
});
