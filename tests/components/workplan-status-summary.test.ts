// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ActiveCheckInCard } from "@/components/appraisal/checkins/ActiveCheckInCard";
import { HistoryCheckInCard } from "@/components/appraisal/checkins/HistoryCheckInCard";
import {
  WorkplanStatusInline,
  WorkplanStatusSummary,
  countObjectiveStatuses,
  workplanAssessment,
} from "@/components/appraisal/checkins/WorkplanStatusSummary";
import { calcMidyearCompleteness } from "@/lib/midyear-lifecycle";
import type { CheckInResponse, CheckInWithResponses, ObjectiveStatus } from "@/types/checkins";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) }));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const $ = (sel: string, scope: ParentNode = document) => scope.querySelector<HTMLElement>(sel);
const $$ = (sel: string, scope: ParentNode = document) => [...scope.querySelectorAll<HTMLElement>(sel)];
const statusText = (scope: ParentNode = document) =>
  Object.fromEntries($$("[data-workplan-summary-status]", scope).map((e) => [e.dataset.workplanSummaryStatus, e.textContent]));

/** 62 On track, 14 At risk, 8 Behind, 16 Complete. */
const HUNDRED: ObjectiveStatus[] = [
  ...Array<ObjectiveStatus>(62).fill("ON_TRACK"),
  ...Array<ObjectiveStatus>(14).fill("AT_RISK"),
  ...Array<ObjectiveStatus>(8).fill("BEHIND"),
  ...Array<ObjectiveStatus>(16).fill("COMPLETE"),
];

function response(i: number, overrides: Partial<CheckInResponse> = {}): CheckInResponse {
  return {
    id: `r-${i}`,
    check_in_id: "ci-1",
    workplan_item_id: `wi-${i}`,
    employee_status: "ON_TRACK",
    progress_pct: null,
    employee_comment: null,
    employee_updated_at: null,
    mgr_status_override: null,
    mgr_comment: null,
    mgr_acknowledged_at: null,
    employee_actual_raw: 5,
    employee_result: 50,
    mgr_actual_raw: null,
    mgr_result: null,
    weight_snapshot: 1,
    workplan_item: {
      id: `wi-${i}`,
      major_task: `Objective number ${i}`,
      corporate_objective: "",
      division_objective: "",
      key_output: "",
      performance_standard: "",
      metric_target: 10,
      metric_type: "NUMBER",
      metric_deadline: null,
      weight: 1,
    },
    ...overrides,
  };
}

function review(responses: CheckInResponse[], overrides: Partial<CheckInWithResponses> = {}): CheckInWithResponses {
  return {
    id: "ci-1",
    appraisal_id: "a-1",
    title: "Mid-Year Review – FY 2026/27",
    check_in_type: "MIDYEAR",
    review_mode: "FORMAL_SCORED",
    is_management_track: false,
    initiated_by: null,
    due_date: null,
    status: "OPEN",
    employee_submitted_at: null,
    manager_reviewed_at: null,
    manager_overall_notes: null,
    note_to_employee: null,
    created_at: "2026-09-01T14:00:00Z",
    updated_at: "2026-09-01T14:00:00Z",
    responses,
    competency_ratings: [],
    midyear_completeness: { required: true, weights: [], employee: [], manager: [], complete: true },
    ...overrides,
  };
}

const fromStatuses = (statuses: Array<ObjectiveStatus | null>) => statuses.map((s, i) => response(i, { employee_status: s }));

const renderActive = (ci: CheckInWithResponses, role: "EMPLOYEE" | "MANAGER" | "HR") =>
  act(async () =>
    root.render(
      createElement(ActiveCheckInCard, {
        appraisalId: "a-1",
        checkIn: ci,
        appraisal: { employeeName: "Jane Brown", employee_id: "emp-1", manager_employee_id: "mgr-1", status: "IN_PROGRESS" },
        currentUser: role === "EMPLOYEE" ? { employee_id: "emp-1", roles: [] } : role === "HR" ? { employee_id: "hr-1", roles: ["hr"] } : { employee_id: "mgr-1", roles: [] },
        role,
        onUpdate: vi.fn(),
        ratingScale: [],
      })
    )
  );

describe("status counts", () => {
  it("counts every status and treats a missing status as Not set", () => {
    expect(countObjectiveStatuses(["ON_TRACK", "AT_RISK", null, "COMPLETE", undefined, "ON_TRACK", "BEHIND"])).toEqual({
      ON_TRACK: 2,
      AT_RISK: 1,
      BEHIND: 1,
      COMPLETE: 1,
      NOT_SET: 2,
    });
  });

  it("small workplan: label, number and share for each status", async () => {
    await act(async () => root.render(createElement(WorkplanStatusSummary, { statuses: ["ON_TRACK", "ON_TRACK", "AT_RISK", "BEHIND", "COMPLETE"] })));
    expect($("[data-workplan-summary-total]")!.textContent).toBe("5 objectives");
    expect(statusText()).toEqual({
      ON_TRACK: "On track2(40%)",
      AT_RISK: "At risk1(20%)",
      BEHIND: "Behind1(20%)",
      COMPLETE: "Complete1(20%)",
    });
  });

  it("a single objective reads in the singular", async () => {
    await act(async () => root.render(createElement(WorkplanStatusSummary, { statuses: ["COMPLETE"] })));
    expect($("[data-workplan-summary-total]")!.textContent).toBe("1 objective");
  });

  it("large workplan: the same four counts, one bar, nothing per objective", async () => {
    await act(async () => root.render(createElement(WorkplanStatusSummary, { statuses: HUNDRED })));
    expect($("[data-workplan-summary-total]")!.textContent).toBe("100 objectives");
    expect(statusText()).toEqual({
      ON_TRACK: "On track62(62%)",
      AT_RISK: "At risk14(14%)",
      BEHIND: "Behind8(8%)",
      COMPLETE: "Complete16(16%)",
    });
    const segments = $$("[data-workplan-summary-segment]");
    expect(segments.map((s) => [s.dataset.workplanSummarySegment, s.style.width])).toEqual([
      ["ON_TRACK", "62%"],
      ["AT_RISK", "14%"],
      ["BEHIND", "8%"],
      ["COMPLETE", "16%"],
    ]);
    expect(container.querySelectorAll("*").length).toBeLessThan(40);
  });

  it("uses the semantic colours, with the bar decorative and the text carrying the data", async () => {
    await act(async () => root.render(createElement(WorkplanStatusSummary, { statuses: HUNDRED })));
    const swatch = (key: string) => $(`[data-workplan-summary-status="${key}"] span[aria-hidden]`)!.className;
    expect(swatch("ON_TRACK")).toContain("bg-ds-mint");
    expect(swatch("AT_RISK")).toContain("bg-ds-amber");
    expect(swatch("BEHIND")).toContain("bg-ds-coral");
    expect(swatch("COMPLETE")).toContain("bg-ds-success");
    expect($("[data-workplan-summary-bar]")!.getAttribute("aria-hidden")).toBe("true");
    expect($("[data-workplan-summary-counts]")!.tagName).toBe("DL");
  });

  it("objectives without a status show as Not set; the item is omitted when there are none", async () => {
    await act(async () => root.render(createElement(WorkplanStatusSummary, { statuses: ["ON_TRACK", null, null, "AT_RISK"] })));
    expect(statusText().NOT_SET).toBe("Not set2(50%)");
    expect(statusText().BEHIND).toBe("Behind0(0%)");
    await act(async () => root.render(createElement(WorkplanStatusSummary, { statuses: ["ON_TRACK"] })));
    expect(statusText()).not.toHaveProperty("NOT_SET");
  });

  it("renders nothing for an empty workplan", async () => {
    await act(async () => root.render(createElement(WorkplanStatusSummary, { statuses: [] })));
    expect($("[data-workplan-summary]")).toBeNull();
  });
});

describe("assessed objectives reuse the completeness rule", () => {
  it("shows how many objectives are assessed and how many still require input", async () => {
    await act(async () => root.render(createElement(WorkplanStatusSummary, { statuses: HUNDRED, assessment: { required: 100, assessed: 92 } })));
    expect($("[data-workplan-summary-assessed]")!.textContent).toBe("92 of 100 objectives assessed · 8 still require input");
    await act(async () => root.render(createElement(WorkplanStatusSummary, { statuses: HUNDRED, assessment: { required: 100, assessed: 100 } })));
    expect($("[data-workplan-summary-assessed]")!.textContent).toBe("100 of 100 objectives assessed");
  });

  it("agrees with the completeness blockers for both stages, including zero-weight objectives", () => {
    const rows = [
      { weight_snapshot: 10, employee_result: 50, mgr_result: null },
      { weight_snapshot: 10, employee_result: null, mgr_result: 70 },
      { weight_snapshot: 10, employee_result: null, mgr_result: null },
      { weight_snapshot: 0, employee_result: null, mgr_result: null },
    ];
    const blockers = calcMidyearCompleteness({ reviewMode: "FORMAL_SCORED", responses: rows, competencies: [] });
    expect(workplanAssessment(rows, "employee")).toEqual({ required: 3, assessed: 1 });
    expect(blockers.employee).toEqual(["Workplan: 2 objective(s) missing an employee Mid-Year result."]);
    expect(workplanAssessment(rows, "manager")).toEqual({ required: 3, assessed: 2 });
    expect(blockers.manager).toEqual(["Workplan: 1 objective(s) missing a scoreable Mid-Year result."]);
  });
});

describe("no per-objective status strip", () => {
  const completed = (n: number) => {
    const responses = HUNDRED.slice(0, n).map((s, i) => response(i, { employee_status: s }));
    return review(responses, { status: "COMPLETE", employee_submitted_at: "2026-10-12T14:00:00Z", manager_reviewed_at: "2026-10-20T14:00:00Z" });
  };

  it.each([5, 20, 100])("the history card header summarises %i objectives in one compact line", async (n) => {
    await act(async () => root.render(createElement(HistoryCheckInCard, { checkIn: completed(n) })));
    const inline = $("[data-workplan-summary-inline]")!;
    expect($("[data-workplan-summary-total]", inline)!.textContent).toBe(`${n} objectives`);
    expect($$("[data-workplan-summary-status]", inline).length).toBeLessThanOrEqual(5);
    expect(document.body.textContent).not.toContain("Objective number");
    expect(document.querySelectorAll(".w-2\\.5.h-2\\.5")).toHaveLength(0);
  });

  it("the header counts use the manager's status where it differs (as the strip did)", async () => {
    const ci = completed(4);
    ci.responses[0] = { ...ci.responses[0], mgr_status_override: "BEHIND" };
    await act(async () => root.render(createElement(HistoryCheckInCard, { checkIn: ci })));
    expect(statusText($("[data-workplan-summary-inline]")!)).toEqual({ ON_TRACK: "On track 3", BEHIND: "Behind 1" });
  });

  it("the expanded completed review shows the full summary before the objective rows", async () => {
    await act(async () => root.render(createElement(HistoryCheckInCard, { checkIn: completed(100) })));
    await act(async () => $(".cursor-pointer")!.click());
    const summary = $("[data-midyear-history] [data-workplan-summary]")!;
    const table = $("[data-midyear-history] [data-midyear-workplan-table]")!;
    expect(summary.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(statusText(summary).AT_RISK).toBe("At risk14(14%)");
    expect($("[data-workplan-summary-assessed]", summary)!.textContent).toBe("100 of 100 objectives assessed");
  });

  it("an informal check-in history card also uses the compact line", async () => {
    const ci = review(fromStatuses(["ON_TRACK", "AT_RISK", null]), {
      title: "Q2",
      check_in_type: "QUARTERLY",
      review_mode: "INFORMAL",
      status: "COMPLETE",
      competency_ratings: undefined,
      midyear_completeness: undefined,
    });
    await act(async () => root.render(createElement(HistoryCheckInCard, { checkIn: ci })));
    expect(statusText($("[data-workplan-summary-inline]")!)).toEqual({ ON_TRACK: "On track 1", AT_RISK: "At risk 1", NOT_SET: "Not set 1" });
  });
});

describe("Workplan section of the active review", () => {
  it("sits at the top of the Workplan section, before the objective grid", async () => {
    await renderActive(review(fromStatuses(HUNDRED)), "EMPLOYEE");
    const section = $("[data-midyear-workspace-section='workplan']")!;
    const summary = $("[data-workplan-summary]", section)!;
    const table = $("[data-midyear-workplan-table]", section)!;
    expect(summary.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(statusText(summary).ON_TRACK).toBe("On track62(62%)");
  });

  it("follows the employee's unsaved tracking and actuals as they change", async () => {
    const responses = [response(0), response(1, { employee_status: null, employee_actual_raw: null, employee_result: null })];
    await renderActive(review(responses), "EMPLOYEE");
    expect(statusText()).toMatchObject({ ON_TRACK: "On track1(50%)", NOT_SET: "Not set1(50%)" });
    expect($("[data-workplan-summary-assessed]")!.textContent).toBe("1 of 2 objectives assessed · 1 still require input");

    const atRisk = $$('[aria-label="Objective number 1 tracking"] button').find((b) => b.textContent === "At risk")!;
    await act(async () => atRisk.click());
    expect(statusText()).toMatchObject({ ON_TRACK: "On track1(50%)", AT_RISK: "At risk1(50%)" });
    expect(statusText()).not.toHaveProperty("NOT_SET");

    const input = $('[data-midyear-workplan-row="wi-1"] [data-midyear-actual]') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "7");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect($("[data-workplan-summary-assessed]")!.textContent).toBe("2 of 2 objectives assessed");
  });

  it("the manager's tracking replaces the employee's where set; Agree keeps the employee's", async () => {
    const responses = [response(0, { employee_status: "ON_TRACK" }), response(1, { employee_status: "ON_TRACK" })];
    await renderActive(review(responses, { status: "EMPLOYEE_SUBMITTED", employee_submitted_at: "2026-10-12T14:00:00Z" }), "MANAGER");
    expect(statusText()).toMatchObject({ ON_TRACK: "On track2(100%)" });
    const behind = $$('[aria-label="Objective number 1 manager tracking"] button').find((b) => b.textContent === "Behind")!;
    await act(async () => behind.click());
    expect(statusText()).toMatchObject({ ON_TRACK: "On track1(50%)", BEHIND: "Behind1(50%)" });
  });

  it("before the employee submits, others see the total but not the employee's draft statuses", async () => {
    await renderActive(review(fromStatuses(["AT_RISK", "BEHIND"])), "HR");
    expect($("[data-workplan-summary-total]")!.textContent).toBe("2 objectives");
    expect($("[data-workplan-summary-pending]")!.textContent).toBe("Objective statuses appear once the employee submits.");
    expect($("[data-workplan-summary-counts]")).toBeNull();
    expect($("[data-workplan-summary-assessed]")).toBeNull();
  });
});

describe("responsive rendering", () => {
  it("counts form a 2×2 grid on narrow screens and one wrapping row from sm up; nothing scrolls", async () => {
    await act(async () => root.render(createElement(WorkplanStatusSummary, { statuses: HUNDRED, assessment: { required: 100, assessed: 92 } })));
    const counts = $("[data-workplan-summary-counts]")!.className;
    expect(counts).toMatch(/(^| )grid( |$)/);
    expect(counts).toContain("grid-cols-2");
    expect(counts).toContain("sm:flex");
    expect(counts).toContain("sm:flex-wrap");
    expect($("[data-workplan-summary-bar]")!.className).toContain("w-full");
    expect($("[data-workplan-summary]")!.parentElement!.innerHTML).not.toMatch(/overflow-x|overflow-auto|overflow-scroll|whitespace-nowrap/);
  });

  it("the compact line wraps instead of growing with the workplan", async () => {
    await act(async () => root.render(createElement(WorkplanStatusInline, { statuses: HUNDRED })));
    const inline = $("[data-workplan-summary-inline]")!;
    expect(inline.className).toContain("flex-wrap");
    expect(inline.children).toHaveLength(5);
  });
});
