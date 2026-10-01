// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ActiveCheckInCard } from "@/components/appraisal/checkins/ActiveCheckInCard";
import { HistoryCheckInCard } from "@/components/appraisal/checkins/HistoryCheckInCard";
import type { CheckInStatus, CheckInWithResponses } from "@/types/checkins";
import type { MidyearCompleteness } from "@/lib/midyear-lifecycle";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

type WorkplanFixture = {
  id: string;
  major_task: string;
  corporate_objective: string;
  division_objective: string;
  key_output: string;
  performance_standard: string;
  metric_target: number | null;
  metric_type: string | null;
  metric_deadline: string | null;
  weight: number;
};
const wpNum: WorkplanFixture = { id: "wi-num", major_task: "Deliver reports", corporate_objective: "", division_objective: "", key_output: "Monthly reports", performance_standard: "On time, no errors", metric_target: 10, metric_type: "NUMBER", metric_deadline: null, weight: 60 };
const wpPct: WorkplanFixture = { id: "wi-pct", major_task: "Reduce backlog", corporate_objective: "", division_objective: "", key_output: "Backlog cleared", performance_standard: "", metric_target: null, metric_type: "PERCENT", metric_deadline: null, weight: 40 };
const complete: MidyearCompleteness = { required: true, weights: [], employee: [], manager: [], complete: true };
const scale = [{ code: "7", label: "Meets expectations well" }, { code: "8", label: "Exceeds expectations" }];

function response(id: string, wp: WorkplanFixture, weight: number) {
  return {
    id: `r-${id}`,
    check_in_id: "ci-1",
    workplan_item_id: wp.id,
    employee_status: null,
    progress_pct: null,
    employee_comment: null,
    employee_updated_at: null,
    mgr_status_override: null,
    mgr_comment: null,
    mgr_acknowledged_at: null,
    employee_actual_raw: null,
    employee_result: null,
    weight_snapshot: weight,
    workplan_item: wp,
  };
}

function checkIn(overrides: Partial<CheckInWithResponses> = {}): CheckInWithResponses {
  return {
    id: "ci-1",
    appraisal_id: "a-1",
    title: "Mid-Year Review – FY 2026/27",
    check_in_type: "MIDYEAR",
    review_mode: "FORMAL_SCORED",
    is_management_track: true,
    initiated_by: null,
    due_date: "2026-10-30",
    status: "OPEN",
    employee_submitted_at: null,
    manager_reviewed_at: null,
    manager_overall_notes: null,
    note_to_employee: null,
    created_at: "2026-09-01",
    updated_at: "2026-09-01",
    responses: [response("num", wpNum, 60), response("pct", wpPct, 40)],
    competency_ratings: [
      { id: "cr-core", check_in_id: "ci-1", section: "CORE", factor_id: "f-1", technical_competency_id: null, name_snapshot: "Professionalism", weight_snapshot: 20, display_order: 0, employee_rating_code: null, manager_rating_code: null, employee_comment: null, manager_comment: null },
      { id: "cr-prod", check_in_id: "ci-1", section: "PRODUCTIVITY", factor_id: "f-2", technical_competency_id: null, name_snapshot: "Quality of work", weight_snapshot: 50, display_order: 0, employee_rating_code: null, manager_rating_code: null, employee_comment: null, manager_comment: null },
      { id: "cr-tech", check_in_id: "ci-1", section: "TECHNICAL", factor_id: null, technical_competency_id: "t-1", name_snapshot: "SQL", weight_snapshot: 100, display_order: 0, employee_rating_code: "7", manager_rating_code: null, employee_comment: "Improving", manager_comment: null },
      { id: "cr-lead", check_in_id: "ci-1", section: "LEADERSHIP", factor_id: "f-3", technical_competency_id: null, name_snapshot: "Coaching", weight_snapshot: 100, display_order: 0, employee_rating_code: null, manager_rating_code: null, employee_comment: null, manager_comment: null },
    ],
    midyear_completeness: complete,
    ...overrides,
  };
}

/** checkIn() with every required employee input filled in. */
function completedCheckIn(): CheckInWithResponses {
  const ci = checkIn();
  return {
    ...ci,
    responses: ci.responses.map((r) => ({ ...r, employee_actual_raw: 5, employee_result: 50 })),
    competency_ratings: ci.competency_ratings!.map((c) => ({ ...c, employee_rating_code: c.employee_rating_code ?? "7" })),
  };
}

type Role = "EMPLOYEE" | "MANAGER" | "HR" | "VIEWER";
const render = async (ci: CheckInWithResponses, role: Role, appraisalStatus = "IN_PROGRESS") =>
  act(async () =>
    root.render(
      createElement(ActiveCheckInCard, {
        appraisalId: "a-1",
        checkIn: ci,
        appraisal: { employeeName: "Jane Brown", employee_id: "emp-1", manager_employee_id: "mgr-1", status: appraisalStatus },
        currentUser: { employee_id: role === "EMPLOYEE" ? "emp-1" : "mgr-1", roles: role === "HR" ? ["hr"] : [] },
        role,
        onUpdate: vi.fn(),
        ratingScale: scale,
      })
    )
  );

const $ = <T extends Element = HTMLElement>(sel: string, scope: ParentNode = document) => scope.querySelector<T>(sel);
const $$ = <T extends Element = HTMLElement>(sel: string, scope: ParentNode = document) => [...scope.querySelectorAll<T>(sel)];
const text = (sel: string, scope: ParentNode = document) => $(sel, scope)?.textContent ?? null;
const button = (label: string, scope: ParentNode = document) => $$<HTMLButtonElement>("button", scope).find((b) => b.textContent?.trim() === label)!;
const lastBody = () => JSON.parse(fetchMock.mock.calls.at(-1)![1].body);
const headColumns = (scope: ParentNode) => $$("[data-midyear-grid-head] > span", scope).map((s) => s.textContent);

function setValue(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

describe("header", () => {
  it("shows title, mode, due date and a small status indicator only", async () => {
    await render(checkIn(), "EMPLOYEE");
    expect(text("[data-midyear-header] h3")).toBe("Mid-Year Review – FY 2026/27");
    expect(text("[data-midyear-header-mode]")).toBe("Formal · Scored");
    expect(text("[data-midyear-header-due]")).toBe("Due 30 Oct 2026");
    const status = $("[data-midyear-header-status]")!;
    expect(status.textContent).toBe("Employee input");
    expect(status.className).toContain("bg-ds-warning-subtle");
    expect($("[data-midyear-header]")!.className).not.toContain("bg-ds-warning");
  });

  it("an unscored review reads Formal", async () => {
    await render(checkIn({ review_mode: "FORMAL" }), "EMPLOYEE");
    expect(text("[data-midyear-header-mode]")).toBe("Formal");
  });
});

describe("compact workplan rows (employee)", () => {
  it("renders one row per objective with the table columns", async () => {
    await render(checkIn(), "EMPLOYEE");
    const table = $("[data-midyear-workplan-table]")!;
    expect(table.dataset.midyearWorkplanTable).toBe("employee");
    expect(headColumns(table)).toEqual(["Objective", "Target", "Tracking", "Mid-Year Actual", "Result", "Comment"]);
    expect($$("[data-midyear-workplan-row]").map((r) => r.dataset.midyearWorkplanRow)).toEqual(["wi-num", "wi-pct"]);
    expect(text("[data-midyear-workspace-section='workplan'] h4")).toBe("Workplan Progress");
    expect(text("[data-midyear-workspace-section='workplan']")).toContain(
      "Assess progress against the approved workplan as at the Mid-Year Review."
    );
  });

  it("shows the objective once, with weight as compact metadata", async () => {
    await render(checkIn(), "EMPLOYEE");
    const objective = $("[data-midyear-workplan-row='wi-num'] [data-midyear-objective]")!;
    const lines = $$("p", objective).map((p) => p.textContent);
    expect(lines).toEqual(["Deliver reports", "Monthly reports · On time, no errors"]);
    expect(text("[data-midyear-weight]", objective)).toBe("Weight: 60%");
  });

  it("uses a segmented tracking control with an obvious selected state", async () => {
    await render(checkIn(), "EMPLOYEE");
    const row = $("[data-midyear-workplan-row='wi-num']")!;
    const segments = $$<HTMLButtonElement>("[data-midyear-segmented] button", row);
    expect(segments.map((b) => b.textContent)).toEqual(["On track", "At risk", "Behind", "Complete"]);
    expect(segments.every((b) => b.getAttribute("aria-pressed") === "false")).toBe(true);
    await act(async () => segments[1].click());
    expect(segments[1].getAttribute("aria-pressed")).toBe("true");
    expect(segments[1].className).toContain("bg-ds-warning-subtle");
    await act(async () => button("Save draft").click());
    expect(lastBody().responses[0]).toMatchObject({ workplan_item_id: "wi-num", employee_status: "AT_RISK" });
  });

  it("has a compact actual input per metric type and a plain read-only result", async () => {
    await render(checkIn(), "EMPLOYEE");
    const num = $("[data-midyear-workplan-row='wi-num']")!;
    const pct = $("[data-midyear-workplan-row='wi-pct']")!;
    expect(text("[data-midyear-workplan-input]", num)).toBe("/ 10");
    expect(text("[data-midyear-workplan-input]", pct)).toBe("%");
    expect(text("[data-midyear-result]", pct)).toBe("—");
    await act(async () => setValue($<HTMLInputElement>("[data-midyear-actual]", pct)!, "65"));
    const result = $("[data-midyear-result]", pct)!;
    expect(result.textContent).toBe("65%");
    expect(result.tagName).toBe("SPAN");
    expect(result.className).not.toMatch(/\bborder\b|rounded/);
  });

  it("comments start at one line and grow as the user types", async () => {
    await render(checkIn(), "EMPLOYEE");
    const comment = $<HTMLTextAreaElement>("[data-midyear-workplan-row='wi-num'] textarea")!;
    expect(comment.rows).toBe(1);
    expect(comment.className).toContain("resize-none");
    await act(async () => setValue(comment, "Two reports delivered"));
    await act(async () => button("Save draft").click());
    expect(lastBody().responses[0].employee_comment).toBe("Two reports delivered");
  });
});

describe("target column", () => {
  const item = (id: string, over: Partial<WorkplanFixture>): WorkplanFixture => ({ ...wpNum, id, major_task: id, key_output: "", performance_standard: "", ...over });
  const targets = () =>
    checkIn({
      responses: [
        response("pct", item("wi-pct100", { metric_type: "PERCENT", metric_target: 100, weight: 10 }), 10),
        response("num", item("wi-num12", { metric_type: "NUMBER", metric_target: 12 }), 30),
        response("date", item("wi-date", { metric_type: "DATE", metric_target: null, metric_deadline: "2026-12-31" }), 30),
        // The column is numeric today; a text target must still display as entered.
        response("text", item("wi-text", { metric_type: "PERCENT", metric_target: "Board approval" as unknown as number }), 30),
      ],
    });
  const target = (id: string) => text(`[data-midyear-workplan-row='${id}'] [data-midyear-target]`);
  const stacked = (id: string) => text(`[data-midyear-workplan-row='${id}'] [data-midyear-target-stacked]`);

  it("percentage target", async () => {
    await render(targets(), "EMPLOYEE");
    expect(target("wi-pct100")).toBe("100%");
  });

  it("numeric target", async () => {
    await render(targets(), "EMPLOYEE");
    expect(target("wi-num12")).toBe("12");
  });

  it("date target shows the configured deadline", async () => {
    await render(targets(), "EMPLOYEE");
    expect(target("wi-date")).toBe("31 Dec 2026");
  });

  it("text target is shown as entered", async () => {
    await render(targets(), "EMPLOYEE");
    expect(target("wi-text")).toBe("Board approval");
  });

  it("desktop: Target is its own column between Objective and Tracking", async () => {
    await render(targets(), "EMPLOYEE");
    expect(headColumns($("[data-midyear-workplan-table]")!).slice(0, 3)).toEqual(["Objective", "Target", "Tracking"]);
    const row = $("[data-midyear-workplan-row='wi-pct100']")!;
    const cell = $("[data-midyear-target]", row)!;
    expect(row.children[1]).toBe(cell);
    expect(cell.className).toContain("hidden xl:block");
    expect($("[data-midyear-target-stacked]", row)!.className).toContain("xl:hidden");
    expect($("[data-midyear-objective]", row)!.textContent).not.toMatch(/Target \d/);
  });

  it("narrow screens: Target and Weight stack under the objective", async () => {
    await render(targets(), "EMPLOYEE");
    const meta = $("[data-midyear-workplan-row='wi-pct100'] [data-midyear-objective-meta]")!;
    expect([...meta.children].map((c) => c.textContent)).toEqual(["Target: 100%", "Weight: 10%"]);
    expect(stacked("wi-num12")).toBe("Target: 12");
    expect(stacked("wi-date")).toBe("Target: 31 Dec 2026");
    expect(stacked("wi-text")).toBe("Target: Board approval");
  });

  it("manager and read-only grids show the same Target column", async () => {
    await render({ ...targets(), status: "EMPLOYEE_SUBMITTED" }, "MANAGER");
    expect(headColumns($("[data-midyear-workplan-table]")!)).toEqual(["Objective", "Target", "Tracking", "Mid-Year Actual", "Result", "Comment"]);
    expect(target("wi-num12")).toBe("12");
    act(() => root.unmount());
    root = createRoot(container);
    await render({ ...targets(), status: "MANAGER_REVIEWED" }, "EMPLOYEE");
    expect(target("wi-date")).toBe("31 Dec 2026");
    expect($("[data-midyear-workplan-row='wi-date'] [data-midyear-target]")!.className).toContain("hidden md:block");
    expect($("[data-midyear-workplan-row='wi-date'] [data-midyear-target-stacked]")!.className).toContain("md:hidden");
  });

  it("an objective without a target shows a dash", async () => {
    await render(checkIn(), "EMPLOYEE");
    expect(target("wi-pct")).toBe("—");
    expect(stacked("wi-pct")).toBe("Target: —");
  });

  it("the result is unchanged by the new column", async () => {
    await render(targets(), "EMPLOYEE");
    const num = $("[data-midyear-workplan-row='wi-num12']")!;
    await act(async () => setValue($<HTMLInputElement>("[data-midyear-actual]", num)!, "9"));
    expect(text("[data-midyear-result]", num)).toBe("75%");
    await act(async () => button("Save draft").click());
    expect(lastBody().responses[1]).toMatchObject({ workplan_item_id: "wi-num12", employee_actual_raw: 9, progress_pct: 75 });
  });
});

describe("competency grid", () => {
  it("groups competencies with one compact row each", async () => {
    await render(checkIn(), "EMPLOYEE");
    const grid = $("[data-midyear-competencies]")!;
    expect(grid.dataset.midyearCompetencyGrid).toBe("employee");
    expect(text("[data-midyear-workspace-section='competencies'] h4")).toBe("Competency Self-Assessment");
    expect(headColumns(grid)).toEqual(["Competency", "Weight", "Rating", "Comment"]);
    expect($$("[data-midyear-competency-section] > p", grid).map((p) => p.textContent)).toEqual([
      "Core Competencies",
      "Productivity",
      "Technical",
      "Leadership",
    ]);
    const row = $("[data-midyear-competency='cr-core']")!;
    expect(row.textContent).toContain("Professionalism");
    expect(row.textContent).toContain("20%");
    const select = $<HTMLSelectElement>("[data-midyear-rating='cr-core']", row)!;
    expect(select.className).toContain("w-full");
    expect([...select.options].map((o) => o.textContent)).toEqual(["Select rating", "7 · Meets expectations well", "8 · Exceeds expectations"]);
    const comment = $<HTMLTextAreaElement>("[data-midyear-comment='cr-core']", row)!;
    expect(comment.placeholder).toBe("Optional comment");
    expect(comment.rows).toBe(1);
  });

  it("every rating column has the same fixed width", async () => {
    await render(checkIn(), "EMPLOYEE");
    const rows = $$("[data-midyear-competency]");
    expect(rows).toHaveLength(4);
    for (const r of rows) expect(r.className).toContain("md:grid-cols-[minmax(0,1.3fr)_56px_200px_minmax(0,1.7fr)]");
  });

  it("counts ratings as the employee enters them", async () => {
    await render(checkIn(), "EMPLOYEE");
    const meta = () => $("[data-midyear-workspace-section='competencies'] span.tabular-nums")!.textContent;
    expect(meta()).toBe("1/4 rated");
    await act(async () => setValue($<HTMLSelectElement>("[data-midyear-rating='cr-core']")!, "8"));
    expect(meta()).toBe("2/4 rated");
  });

  it("keeps Workplan and Competencies as separate sections", async () => {
    await render(checkIn(), "EMPLOYEE");
    const sections = $$("[data-midyear-workspace-section]").map((s) => s.dataset.midyearWorkspaceSection);
    expect(sections).toEqual(["workplan", "competencies"]);
    expect($("[data-midyear-workplan-table]")!.contains($("[data-midyear-competencies]"))).toBe(false);
  });
});

describe("employee editable view", () => {
  it("summarises blockers near the action bar with an expandable list", async () => {
    await render(checkIn(), "EMPLOYEE");
    const blockers = $("[data-midyear-action-bar] details[data-midyear-blockers]")!;
    expect(text("[data-midyear-blocker-count]", blockers)).toBe("4 requirements remaining");
    expect($$("[data-midyear-blocker]", blockers).map((b) => b.textContent)).toEqual([
      "Workplan: 2 objective(s) missing an employee Mid-Year result.",
      "Core competencies: 1 employee rating(s) missing.",
      "Productivity: 1 employee rating(s) missing.",
      "Leadership: 1 employee rating(s) missing.",
    ]);
  });

  it("shows a ready state when nothing blocks submission", async () => {
    await render(completedCheckIn(), "EMPLOYEE");
    expect($("[data-midyear-blockers]")).toBeNull();
    expect(text("[data-midyear-action-bar] [data-midyear-ready]")).toBe("All required items complete");
  });

  it("shows the manager's note compactly", async () => {
    await render(checkIn({ note_to_employee: "Please focus on the backlog." }), "EMPLOYEE");
    expect(text("[data-midyear-note]")).toBe("Note from your manager: Please focus on the backlog.");
  });
});

describe("manager editable view", () => {
  const submitted = () => {
    const ci = checkIn({ status: "EMPLOYEE_SUBMITTED", employee_submitted_at: "2026-10-12T09:00:00Z" });
    ci.responses[0] = { ...ci.responses[0], employee_status: "ON_TRACK", employee_actual_raw: 8, employee_result: 80, employee_comment: "Two left" };
    return ci;
  };

  it("shows the employee's values beside the manager inputs", async () => {
    await render(submitted(), "MANAGER");
    expect(text("[data-midyear-header-status]")).toBe("Manager review");
    expect(text("[data-midyear-header-detail]")).toBe("Submitted by Jane Brown on 12 Oct 2026");
    const row = $("[data-midyear-workplan-row='wi-num']")!;
    expect(text("[data-midyear-employee-status]", row)).toBe("EmployeeOn track");
    expect(text("[data-midyear-employee-actual]", row)).toBe("Employee8");
    expect(text("[data-midyear-employee-result]", row)).toBe("Employee80%");
    expect(text("[data-midyear-employee-comment]", row)).toBe("EmployeeTwo left");
    expect($('[data-midyear-workplan-input="manager"]', row)).not.toBeNull();
    expect($('[data-midyear-workplan-input="employee"]')).toBeNull();
  });

  it("records the manager's tracking view with Agree selected by default", async () => {
    await render(submitted(), "MANAGER");
    const row = $("[data-midyear-workplan-row='wi-num']")!;
    const segments = $$<HTMLButtonElement>("[data-midyear-segmented] button", row);
    expect(segments.map((b) => b.textContent)).toEqual(["Agree", "At risk", "Behind"]);
    expect(segments[0].getAttribute("aria-pressed")).toBe("true");
    await act(async () => segments[2].click());
    await act(async () => setValue($<HTMLInputElement>("[data-midyear-actual]", row)!, "6"));
    expect(text("[data-midyear-result]", row)).toBe("60%");
    await act(async () => button("Save draft").click());
    expect(lastBody()).toMatchObject({ action: "MANAGER_RESPOND", saveOnly: true });
    expect(lastBody().responses[0]).toMatchObject({ mgr_status_override: "BEHIND", mgr_actual_raw: 6 });
  });

  it("uses a competency grid with the employee rating column", async () => {
    await render(submitted(), "MANAGER");
    const grid = $("[data-midyear-competencies]")!;
    expect(grid.dataset.midyearCompetencyGrid).toBe("manager");
    expect(headColumns(grid)).toEqual(["Competency", "Weight", "Employee", "Your rating", "Comment"]);
    expect(text("[data-midyear-competency='cr-tech'] [data-midyear-employee-rating]")).toContain("7 · Meets expectations well");
    expect($("[data-midyear-rating='cr-tech']")).not.toBeNull();
    expect($<HTMLTextAreaElement>("textarea[aria-label='Overall notes for employee']")!.rows).toBe(2);
  });
});

describe("read-only and completed views", () => {
  const reviewed = () => {
    const ci = checkIn({ status: "MANAGER_REVIEWED", manager_overall_notes: "Solid half-year." });
    ci.responses[0] = { ...ci.responses[0], employee_status: "ON_TRACK", employee_actual_raw: 8, employee_result: 80, employee_comment: "Two left", mgr_status_override: "AT_RISK", mgr_actual_raw: 7, mgr_result: 70, mgr_comment: "Watch pace" };
    ci.competency_ratings![0] = { ...ci.competency_ratings![0], employee_rating_code: "7", manager_rating_code: "8" };
    return ci;
  };

  it("is a compact two-column comparison with no inputs", async () => {
    await render(reviewed(), "EMPLOYEE");
    const table = $("[data-midyear-workplan-table]")!;
    expect(table.dataset.midyearWorkplanTable).toBe("readonly");
    expect(headColumns(table)).toEqual(["Objective", "Target", "Employee", "Manager"]);
    const row = $("[data-midyear-workplan-row='wi-num']")!;
    expect(text("[data-midyear-party='employee'] [data-midyear-summary]", row)).toBe("Actual: 8 · Result: 80%");
    expect(text("[data-midyear-party='manager'] [data-midyear-summary]", row)).toBe("Actual: 7 · Result: 70%");
    expect(text("[data-midyear-party='manager'] [data-midyear-status-tag]", row)).toBe("At risk");
    expect(headColumns($("[data-midyear-competencies]")!)).toEqual(["Competency", "Weight", "Employee", "Manager"]);
    expect(document.body.textContent).toContain("Solid half-year.");
    expect(document.querySelectorAll("input, select, textarea")).toHaveLength(0);
    expect($("[data-midyear-action-bar]")).toBeNull();
  });

  it("before submission others see one column awaiting the employee", async () => {
    await render(checkIn(), "HR");
    expect(headColumns($("[data-midyear-workplan-table]")!)).toEqual(["Objective", "Target", "Employee"]);
    expect($$("[data-midyear-workplan-row]").every((r) => r.textContent!.includes("Awaiting employee input"))).toBe(true);
  });

  it("the completed history card uses the same read-only tables", async () => {
    const ci = { ...reviewed(), status: "COMPLETE" as CheckInStatus, manager_reviewed_at: "2026-10-20T10:00:00Z" };
    await act(async () => root.render(createElement(HistoryCheckInCard, { checkIn: ci, ratingScale: scale })));
    await act(async () => (document.querySelector(".cursor-pointer") as HTMLElement).click());
    const history = $("[data-midyear-history]")!;
    expect(headColumns($("[data-midyear-workplan-table]", history)!)).toEqual(["Objective", "Target", "Employee", "Manager"]);
    expect($("[data-midyear-competencies]", history)!.dataset.midyearCompetencyGrid).toBe("readonly");
    expect(history.querySelectorAll("input, select, textarea")).toHaveLength(0);
  });
});

describe("sticky action bar", () => {
  it("employee: Save draft on the left, Submit to manager on the right, pinned to the bottom", async () => {
    await render(checkIn(), "EMPLOYEE");
    const bar = $("[data-midyear-action-bar]")!;
    expect(bar.className).toContain("sticky");
    expect(bar.className).toContain("bottom-0");
    expect(bar.className).toContain("bg-white");
    const [left, right] = [...bar.firstElementChild!.children] as HTMLElement[];
    expect(button("Save draft", left)).toBeDefined();
    expect(button("Submit to manager", right)).toBeDefined();
    expect(bar.parentElement!.lastElementChild).toBe(bar);
  });

  it("keeps the submit confirmation step", async () => {
    await render(completedCheckIn(), "EMPLOYEE");
    await act(async () => button("Submit to manager").click());
    expect(document.body.textContent).toContain("Once submitted you cannot edit.");
    await act(async () => button("Confirm submit").click());
    expect(lastBody().action).toBe("EMPLOYEE_SUBMIT");
  });

  it("manager actions and the complete action live in the same bar", async () => {
    await render({ ...checkIn(), status: "EMPLOYEE_SUBMITTED" }, "MANAGER");
    expect(button("Submit manager review ✓", $("[data-midyear-action-bar]")!)).toBeDefined();
    act(() => root.unmount());
    root = createRoot(container);
    await render({ ...checkIn(), status: "MANAGER_REVIEWED" }, "MANAGER");
    expect($("[data-midyear-action-bar] [data-midyear-complete]")).not.toBeNull();
  });

  it("the manager waiting for input can still cancel", async () => {
    await render(checkIn(), "MANAGER");
    const bar = $("[data-midyear-action-bar]")!;
    expect($("[data-cancel-checkin]", bar)).not.toBeNull();
    expect(button("Add manager response", bar).disabled).toBe(true);
    expect(text("[data-midyear-header-detail]")).toBe("Awaiting employee input from Jane Brown");
  });
});

describe("responsive stacking", () => {
  it("workplan rows stack below xl and become a table at xl", async () => {
    await render(checkIn(), "EMPLOYEE");
    const row = $("[data-midyear-workplan-row='wi-num']")!;
    expect(row.className).toMatch(/\bflex\b/);
    expect(row.className).toContain("flex-col");
    expect(row.className).toContain("xl:grid");
    expect($("[data-midyear-workplan-table] [data-midyear-grid-head]")!.className).toContain("hidden xl:grid");
    const cells = [...row.children] as HTMLElement[];
    expect(cells).toHaveLength(5);
    expect(cells[1].dataset).toHaveProperty("midyearTarget");
    expect(cells[3].className).toContain("xl:contents");
    expect($$("p", cells[3]).map((p) => p.textContent)).toEqual(["Mid-Year Actual", "Result"]);
    const captions = $$("p", row).filter((p) => p.className.includes("xl:hidden")).map((p) => p.textContent);
    expect(captions).toEqual(["Tracking", "Mid-Year Actual", "Result", "Comment"]);
  });

  it("competency rows stack below md (lg for the wider manager grid)", async () => {
    await render(checkIn(), "EMPLOYEE");
    expect($("[data-midyear-competency='cr-core']")!.className).toMatch(/flex-col.*md:grid/);
    act(() => root.unmount());
    root = createRoot(container);
    await render({ ...checkIn(), status: "EMPLOYEE_SUBMITTED" }, "MANAGER");
    expect($("[data-midyear-competency='cr-core']")!.className).toMatch(/flex-col.*lg:grid/);
  });

  it("nothing in the review scrolls horizontally, and the action bar stacks on mobile", async () => {
    await render(checkIn(), "EMPLOYEE");
    const workspace = $("[data-midyear-workspace]")!;
    const all = [workspace, ...$$("*", workspace)];
    expect(all.filter((el) => /overflow-x-(auto|scroll)|overflow-auto|overflow-scroll/.test(el.getAttribute("class") ?? ""))).toEqual([]);
    const inner = $("[data-midyear-action-bar] > div")!;
    expect(inner.className).toContain("flex-col");
    expect(inner.className).toContain("sm:flex-row");
    for (const b of $$("[data-midyear-action-bar] button")) {
      expect(b.classList.contains("w-full")).toBe(true);
      expect(b.classList.contains("sm:w-auto")).toBe(true);
    }
  });
});

describe("informal check-ins are untouched", () => {
  it("do not use the Mid-Year workspace", async () => {
    await render(checkIn({ title: "Q2", check_in_type: "QUARTERLY", review_mode: "INFORMAL", competency_ratings: undefined, midyear_completeness: undefined }), "EMPLOYEE");
    expect($("[data-midyear-workspace]")).toBeNull();
    expect($("[data-midyear-action-bar]")).toBeNull();
    expect(button("Save draft")).toBeDefined();
  });
});
