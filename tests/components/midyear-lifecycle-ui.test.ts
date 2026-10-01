// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ActiveCheckInCard } from "@/components/appraisal/checkins/ActiveCheckInCard";
import { CheckInTab } from "@/components/appraisal/checkins/CheckInTab";
import type { CheckInStatus, CheckInWithResponses } from "@/types/checkins";
import type { MidyearCompleteness } from "@/lib/midyear-lifecycle";

const ACTIVE: CheckInStatus[] = ["OPEN", "EMPLOYEE_SUBMITTED", "MANAGER_REVIEWED"];

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

const wp = { id: "wi-num", major_task: "Deliver reports", corporate_objective: "", division_objective: "", key_output: "Reports", performance_standard: "", metric_target: 10, metric_type: "NUMBER", metric_deadline: null, weight: 60 };
const complete: MidyearCompleteness = { required: true, weights: [], employee: [], manager: [], complete: true };

function checkIn(overrides: Partial<CheckInWithResponses> = {}): CheckInWithResponses {
  return {
    id: "ci-1",
    appraisal_id: "a-1",
    title: "Mid-Year Review – 2026",
    check_in_type: "MIDYEAR",
    review_mode: "FORMAL_SCORED",
    is_management_track: false,
    initiated_by: null,
    due_date: "2026-06-30",
    status: "OPEN",
    employee_submitted_at: null,
    manager_reviewed_at: null,
    manager_overall_notes: null,
    note_to_employee: null,
    created_at: "2026-06-01",
    updated_at: "2026-06-01",
    responses: [
      {
        id: "r-1",
        check_in_id: "ci-1",
        workplan_item_id: "wi-num",
        employee_status: "ON_TRACK",
        progress_pct: 80,
        employee_comment: "Going well",
        employee_updated_at: null,
        mgr_status_override: null,
        mgr_comment: "Agreed",
        mgr_acknowledged_at: null,
        employee_actual_raw: 8,
        employee_result: 80,
        mgr_actual_raw: 7,
        mgr_result: 70,
        weight_snapshot: 60,
        workplan_item: wp,
      },
    ],
    competency_ratings: [
      { id: "cr-core", check_in_id: "ci-1", section: "CORE", factor_id: "f-core", technical_competency_id: null, name_snapshot: "Integrity", weight_snapshot: 100, display_order: 0, employee_rating_code: "7", manager_rating_code: "8", employee_comment: null, manager_comment: null },
    ],
    midyear_completeness: complete,
    ...overrides,
  };
}

type Role = "EMPLOYEE" | "MANAGER" | "HR" | "VIEWER";
const render = async (ci: CheckInWithResponses, role: Role, appraisalStatus = "IN_PROGRESS") =>
  act(async () =>
    root.render(
      createElement(ActiveCheckInCard, {
        appraisalId: "a-1",
        checkIn: ci,
        appraisal: { employeeName: "Employee", employee_id: "emp-1", manager_employee_id: "mgr-1", status: appraisalStatus },
        currentUser: { employee_id: role === "EMPLOYEE" ? "emp-1" : "other", roles: role === "HR" ? ["hr"] : [] },
        role,
        onUpdate: vi.fn(),
        ratingScale: [],
      })
    )
  );

const buttons = () => [...document.querySelectorAll("button")].map((b) => b.textContent?.trim());
const noInputs = () => document.querySelectorAll("input, select, textarea").length === 0;
const lastBody = () => JSON.parse(fetchMock.mock.calls.at(-1)![1].body);

function setInput(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function setNativeValue(el: HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function setSelect(el: HTMLSelectElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("formal MANAGER_REVIEWED", () => {
  it("the manager can complete the review when nothing blocks it; the values on screen are saved first", async () => {
    await render(checkIn({ status: "MANAGER_REVIEWED" }), "MANAGER");
    expect(document.querySelector('[data-midyear-workspace="MANAGER_EDIT"]')).not.toBeNull();
    const btn = document.querySelector<HTMLButtonElement>("[data-midyear-complete]")!;
    expect(btn.disabled).toBe(false);
    await act(async () => btn.click());
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body));
    expect(bodies.map((b) => b.action)).toEqual(["MANAGER_RESPOND", "COMPLETE"]);
    expect(bodies[0]).toMatchObject({ saveOnly: true, responses: [expect.objectContaining({ workplan_item_id: "wi-num", mgr_actual_raw: 7 })] });
    expect(lastBody()).toEqual({ action: "COMPLETE" });
  });

  it("the complete button is disabled and blockers are listed when the review is incomplete", async () => {
    const ci = checkIn({ status: "MANAGER_REVIEWED" });
    ci.competency_ratings = ci.competency_ratings!.map((c) => ({ ...c, manager_rating_code: null }));
    await render(ci, "MANAGER");
    expect(document.querySelector<HTMLButtonElement>("[data-midyear-complete]")!.disabled).toBe(true);
    expect([...document.querySelectorAll("[data-midyear-blocker]")].map((b) => b.textContent)).toEqual([
      "Core competencies: 1 manager rating(s) missing.",
    ]);
    await act(async () => document.querySelector<HTMLButtonElement>("[data-midyear-complete]")!.click());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a failed save stops completion", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Save failed" }) });
    const alertSpy = vi.fn();
    vi.stubGlobal("alert", alertSpy);
    await render(checkIn({ status: "MANAGER_REVIEWED" }), "MANAGER");
    await act(async () => document.querySelector<HTMLButtonElement>("[data-midyear-complete]")!.click());
    expect(fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).action)).toEqual(["MANAGER_RESPOND"]);
    expect(alertSpy).toHaveBeenCalledWith("Save failed");
  });

  it("the manager can keep revising after Submit manager review; completeness updates live", async () => {
    await render(checkIn({ status: "MANAGER_REVIEWED" }), "MANAGER");
    expect(document.querySelector("[data-midyear-header-detail]")!.textContent).toBe("You can still revise your review until it is completed");
    const rating = document.querySelector<HTMLSelectElement>('[data-midyear-rating="cr-core"]')!;
    const complete = () => document.querySelector<HTMLButtonElement>("[data-midyear-complete]")!;
    const blockers = () => [...document.querySelectorAll("[data-midyear-blocker]")].map((b) => b.textContent);

    await act(async () => setSelect(rating, ""));
    expect(complete().disabled).toBe(true);
    expect(blockers()).toEqual(["Core competencies: 1 manager rating(s) missing."]);

    await act(async () => setSelect(rating, "6"));
    expect(complete().disabled).toBe(false);
    expect(blockers()).toEqual([]);

    await act(async () => setInput(document.querySelector<HTMLInputElement>('[data-midyear-workplan-row="wi-num"] [data-midyear-actual]')!, "9"));
    await act(async () => setNativeValue(document.querySelector<HTMLTextAreaElement>('[data-midyear-comment="cr-core"]')!, "Revised view"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Save draft at MANAGER_REVIEWED sends the revised manager values and can be repeated", async () => {
    await render(checkIn({ status: "MANAGER_REVIEWED" }), "MANAGER");
    const save = () => document.querySelector<HTMLButtonElement>("[data-midyear-save-draft]")!;
    await act(async () => setSelect(document.querySelector<HTMLSelectElement>('[data-midyear-rating="cr-core"]')!, "6"));
    await act(async () => setInput(document.querySelector<HTMLInputElement>('[data-midyear-workplan-row="wi-num"] [data-midyear-actual]')!, "9"));
    await act(async () => save().click());
    expect(lastBody()).toMatchObject({
      action: "MANAGER_RESPOND",
      saveOnly: true,
      responses: [expect.objectContaining({ workplan_item_id: "wi-num", mgr_actual_raw: 9 })],
      competencies: [{ id: "cr-core", manager_rating_code: "6", manager_comment: null }],
    });
    await act(async () => setSelect(document.querySelector<HTMLSelectElement>('[data-midyear-rating="cr-core"]')!, "9"));
    await act(async () => save().click());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(lastBody()).toMatchObject({ action: "MANAGER_RESPOND", saveOnly: true, competencies: [{ id: "cr-core", manager_rating_code: "9" }] });
    expect(fetchMock.mock.calls.every(([, init]) => JSON.parse(init.body).action !== "COMPLETE")).toBe(true);
  });

  it("the manager gets no employee inputs; the employee's values are shown read-only", async () => {
    await render(checkIn({ status: "MANAGER_REVIEWED" }), "MANAGER");
    expect(document.querySelector('[data-midyear-workplan-input="employee"]')).toBeNull();
    expect(document.querySelector('[data-midyear-workplan-input="manager"]')).not.toBeNull();
    expect(document.querySelector('[data-midyear-workplan-row="wi-num"] [data-midyear-employee-actual]')!.textContent).toContain("8");
    expect(document.querySelector('[data-midyear-competency="cr-core"] [data-midyear-employee-rating]')!.textContent).toContain("7");
  });

  it("the manager may still cancel an unrevised review, but not one reopened for revision", async () => {
    await render(checkIn({ status: "MANAGER_REVIEWED" }), "MANAGER");
    expect(buttons()).toContain("Cancel review");
    const revision = {
      revision_number: 2, reopened_at: "2026-11-01T00:00:00Z", reopened_by: "hr-1", reopened_by_name: "HR", reopen_reason: "Correction",
      previous_score_revision: 1, completed_at: null, completed_by: null, score_revision: null,
    };
    await render(checkIn({ status: "MANAGER_REVIEWED", midyear_revisions: [revision] }), "MANAGER");
    expect(buttons()).not.toContain("Cancel review");
    expect(document.querySelector("[data-midyear-complete]")).not.toBeNull();
  });

  it("the employee sees it read-only with no actions", async () => {
    await render(checkIn({ status: "MANAGER_REVIEWED" }), "EMPLOYEE");
    expect(document.querySelector("[data-midyear-readonly]")).not.toBeNull();
    expect(noInputs()).toBe(true);
    expect(buttons()).toEqual([]);
  });
});

describe("formal role alignment", () => {
  it.each(ACTIVE)("HR sees a read-only %s review and may only cancel", async (status) => {
    await render(checkIn({ status }), "HR");
    expect(document.querySelector("[data-midyear-readonly]")).not.toBeNull();
    expect(noInputs()).toBe(true);
    expect(buttons()).toEqual(["Cancel review"]);
  });

  it.each(ACTIVE)("a general viewer sees a read-only %s review with no actions", async (status) => {
    await render(checkIn({ status }), "VIEWER");
    expect(noInputs()).toBe(true);
    expect(buttons()).toEqual([]);
  });

  it("does not reveal the employee's unsubmitted draft to others", async () => {
    await render(checkIn({ status: "OPEN" }), "HR");
    expect(document.body.textContent).not.toContain("Going well");
    expect(document.body.textContent).toContain("Awaiting employee input");
  });

  it("the employee sees completeness blockers before submitting", async () => {
    const [saved] = checkIn().responses;
    await render(checkIn({ status: "OPEN", responses: [{ ...saved, employee_actual_raw: null, employee_result: null }] }), "EMPLOYEE");
    expect(document.querySelector("[data-midyear-workplan-input]")).not.toBeNull();
    expect(document.querySelector("[data-midyear-blocker]")!.textContent).toContain("missing an employee Mid-Year result");
  });

  it("server blockers are shown when an action is rejected", async () => {
    const alertMock = vi.fn();
    vi.stubGlobal("alert", alertMock);
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "The Mid-Year Review is incomplete.", blockers: ["Workplan: x"] }) });
    await render(checkIn({ status: "MANAGER_REVIEWED" }), "MANAGER");
    await act(async () => document.querySelector<HTMLButtonElement>("[data-midyear-complete]")!.click());
    expect(alertMock).toHaveBeenCalledWith("The Mid-Year Review is incomplete.\n• Workplan: x");
  });
});

describe("formal review locked once the appraisal leaves In progress", () => {
  it.each<[CheckInStatus, Role]>([
    ["OPEN", "EMPLOYEE"],
    ["EMPLOYEE_SUBMITTED", "MANAGER"],
    ["MANAGER_REVIEWED", "MANAGER"],
    ["OPEN", "HR"],
  ])("%s as %s is read-only with no actions", async (status, role) => {
    await render(checkIn({ status }), role, "SELF_ASSESSMENT");
    expect(document.querySelector("[data-midyear-locked]")).not.toBeNull();
    expect(noInputs()).toBe(true);
    expect(buttons()).toEqual([]);
  });
});

describe("informal check-ins keep the existing role behaviour", () => {
  const informal = (status: CheckInStatus) =>
    checkIn({ title: "Q2", check_in_type: "QUARTERLY", review_mode: "INFORMAL", status, competency_ratings: undefined, midyear_completeness: undefined });

  it("HR still gets the manager view", async () => {
    await render(informal("EMPLOYEE_SUBMITTED"), "HR");
    expect(buttons()).toContain("Complete check-in ✓");
  });

  it("an informal check-in is not locked by the appraisal status", async () => {
    await render(informal("OPEN"), "EMPLOYEE", "SELF_ASSESSMENT");
    expect(buttons()).toContain("Save draft");
  });
});

describe("CheckInTab", () => {
  const pageData = (overrides: Record<string, unknown>) => ({
    checkIns: [],
    appraisal: { id: "a-1", employee_id: "emp-1", manager_employee_id: "mgr-1", employeeName: "Employee", cycleLabel: "FY 2026", fiscalYear: "2026", status: "IN_PROGRESS" },
    workplanItems: [{ id: "wi-num", major_task: "Deliver reports", corporate_objective: "", division_objective: "", key_output: "", weight: 60, metric_target: 10 }],
    currentUser: { employee_id: "other", roles: [] },
    access: { isEmployee: false, hasManagerAccess: false, isDelegate: false, isHrAdmin: false },
    midyear: { enabled: true, scoringEnabled: true, windowStart: null, dueDate: null },
    ...overrides,
  });
  const renderTab = async (data: Record<string, unknown>) => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => data });
    await act(async () =>
      root.render(createElement(CheckInTab, { appraisalId: "a-1", isManager: false, isHR: false, isEmployee: false }))
    );
  };

  it("a general viewer gets the read-only formal review, not the employee inputs", async () => {
    await renderTab(pageData({ checkIns: [checkIn({ status: "OPEN" })], currentUser: { employee_id: "gm-1", roles: ["gm"] } }));
    expect(document.querySelector("[data-midyear-readonly]")).not.toBeNull();
    expect(document.querySelector("[data-midyear-workplan-input]")).toBeNull();
  });

  it("an active delegate acts as the manager", async () => {
    await renderTab(
      pageData({
        checkIns: [checkIn({ status: "MANAGER_REVIEWED" })],
        currentUser: { employee_id: "del-1", roles: [] },
        access: { isEmployee: false, hasManagerAccess: true, isDelegate: true, isHrAdmin: false },
      })
    );
    expect(document.querySelector("[data-midyear-complete]")).not.toBeNull();
  });

  it("an active delegate can start a check-in", async () => {
    await renderTab(
      pageData({ currentUser: { employee_id: "del-1", roles: [] }, access: { isEmployee: false, hasManagerAccess: true, isDelegate: true, isHrAdmin: false } })
    );
    expect(buttons()).toContain("New check-in");
  });

  it("a formal MANAGER_REVIEWED review stays active; a COMPLETE one moves to history", async () => {
    await renderTab(pageData({ checkIns: [checkIn({ status: "MANAGER_REVIEWED" })], currentUser: { employee_id: "mgr-1", roles: [] } }));
    expect(document.querySelector('[data-midyear-workspace="MANAGER_EDIT"]')).not.toBeNull();
    await act(async () => root.unmount());
    root = createRoot(container);
    await renderTab(pageData({ checkIns: [checkIn({ status: "COMPLETE" })], currentUser: { employee_id: "mgr-1", roles: [] } }));
    expect(document.querySelector("[data-midyear-workspace]")).toBeNull();
    expect(document.querySelector("[data-midyear-readonly]")).toBeNull();
    expect(document.body.textContent).toContain("Past check-ins");
    expect(document.body.textContent).toContain("Mid-Year Review – 2026");
  });

  it("an informal MANAGER_REVIEWED check-in still moves to history", async () => {
    await renderTab(
      pageData({
        checkIns: [checkIn({ title: "Q2", check_in_type: "QUARTERLY", review_mode: "INFORMAL", status: "MANAGER_REVIEWED", competency_ratings: undefined })],
        currentUser: { employee_id: "mgr-1", roles: [] },
      })
    );
    expect(document.querySelector("[data-midyear-readonly]")).toBeNull();
    expect(document.body.textContent).toContain("Q2");
  });
});
