// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import fs from "node:fs";
import path from "node:path";
import SummaryTabContent from "@/components/appraisal/SummaryTabContent";
import type { SummaryResult } from "@/lib/summary-calc";
import type { AppraisalData } from "@/components/appraisal/AppraisalTabs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const thresholds = (w: number) => ({ A: w, B: w * 0.8, C: w * 0.6, D: w * 0.4, E: w * 0.2 });
const RESULT: SummaryResult = {
  components: [
    { key: "workplan", name: "Workplan", sub: "Objectives", weight: 50, actual: 92, points: 46, grade: "B", gradeThresholds: thresholds(50) },
    { key: "core", name: "Core Competencies", sub: "Values", weight: 20, actual: 80, points: 16, grade: "C", gradeThresholds: thresholds(20) },
    { key: "technical", name: "Technical", sub: "Functional", weight: 15, actual: 70, points: 10.5, grade: "D", gradeThresholds: thresholds(15) },
    { key: "productivity", name: "Productivity", sub: "Output", weight: 15, actual: 60, points: 9, grade: "E", gradeThresholds: thresholds(15) },
  ],
  totalWeight: 100,
  totalPoints: 81.5,
  overallPct: 81.5,
  overallGrade: "C",
  gradeBand: "Meets Expectations",
  isManagementTrack: false,
};
const APPRAISAL = { id: "a-1", employee_id: "E1", manager_employee_id: null, cycle_id: "c-1", status: "MANAGER_REVIEW", is_management: false, employeeName: "Pat", cycleName: "FY26" } as AppraisalData;
const EMPLOYEE = { full_name: "Pat Example", employee_id: "E1", division_name: "Finance" };
const CYCLE = { name: "FY26", fiscal_year: "2026" };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const renderSummary = (props: Partial<Parameters<typeof SummaryTabContent>[0]> = {}) =>
  act(async () => {
    root.render(createElement(SummaryTabContent, { employee: EMPLOYEE, cycle: CYCLE, appraisal: APPRAISAL, summaryResult: RESULT, isEmptyScore: false, ...props }));
  });

describe("Summary tab", () => {
  it("shows total score, grade and status in the overall result area", async () => {
    await renderSummary();
    expect(container.querySelector("[data-summary-total]")?.textContent).toBe("81.5");
    expect(container.querySelector("[data-summary-grade]")?.textContent).toBe("C");
    const overall = container.querySelector('[aria-labelledby="summary-overall-heading"]')!;
    expect(overall.textContent).toContain("Meets Expectations");
    expect(overall.textContent).toContain("Manager Review");
    expect(overall.textContent).toContain("Pat Example");
    expect(overall.textContent).toContain("FY 2026");
    expect(overall.textContent).toContain("Non-Management Track");
  });

  it("lists every section with the calculated values unchanged", async () => {
    await renderSummary();
    const rows = [...container.querySelectorAll("tbody tr")];
    expect(rows.map((r) => r.querySelector("td")?.textContent)).toEqual(["WorkplanObjectives", "Core CompetenciesValues", "TechnicalFunctional", "ProductivityOutput"]);
    const cells = [...rows[2].querySelectorAll("td")].map((td) => td.textContent);
    expect(cells).toEqual(["TechnicalFunctional", "15", "70%", "10.5", "DBelow", "15.0", "12.0", "9.0", "6.0", "3.0"]);
    const foot = [...container.querySelectorAll("tfoot td")].map((td) => td.textContent);
    expect(foot.slice(0, 5)).toEqual(["Total", "100", "81.5%", "81.5", "C"]);
    expect(container.querySelector('li[aria-current="true"]')?.textContent).toContain("Meets Expectations");
  });

  it("keeps the empty-score presentation", async () => {
    await renderSummary({ isEmptyScore: true });
    expect(container.textContent).toContain("Scores will appear here once ratings are entered");
    expect(container.querySelector("[data-summary-total]")).toBeNull();
    const foot = [...container.querySelectorAll("tfoot td")].map((td) => td.textContent);
    expect(foot.slice(0, 4)).toEqual(["Total", "100", "—", "—"]);
  });

  it("uses no gradients, decorative icons or statistic tiles", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "components/appraisal/SummaryTabContent.tsx"), "utf8");
    expect(src).not.toMatch(/linear-gradient|radial-gradient|lucide-react|<svg|Sora|#0f1f3d/);
  });
});
