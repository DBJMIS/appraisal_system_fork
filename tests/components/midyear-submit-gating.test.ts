// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ActiveCheckInCard } from "@/components/appraisal/checkins/ActiveCheckInCard";
import { MidyearBlockers } from "@/components/appraisal/checkins/MidyearAssessmentFields";
import type { CheckInCompetencyRating, CheckInResponse, CheckInWithResponses } from "@/types/checkins";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let alertMock: ReturnType<typeof vi.fn>;
let onUpdate: ReturnType<typeof vi.fn>;

const ok = () => ({ ok: true, json: async () => ({ success: true }) });
const HELP = "Complete the required items before submitting.";

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  fetchMock = vi.fn().mockResolvedValue(ok());
  alertMock = vi.fn();
  onUpdate = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("alert", alertMock);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const workplanItem = (id: string, weight: number) => ({
  id,
  major_task: `Task ${id}`,
  corporate_objective: "",
  division_objective: "",
  key_output: "Output",
  performance_standard: "",
  metric_target: 10,
  metric_type: "NUMBER",
  metric_deadline: null,
  weight,
});

function response(id: string, actual: number | null, weight = 50): CheckInResponse {
  return {
    id: `r-${id}`,
    check_in_id: "ci-1",
    workplan_item_id: id,
    employee_status: "ON_TRACK",
    progress_pct: actual == null ? null : actual * 10,
    employee_comment: null,
    employee_updated_at: null,
    mgr_status_override: null,
    mgr_comment: null,
    mgr_acknowledged_at: null,
    employee_actual_raw: actual,
    employee_result: actual == null ? null : actual * 10,
    weight_snapshot: weight,
    workplan_item: workplanItem(id, weight),
  } as CheckInResponse;
}

function competency(id: string, section: CheckInCompetencyRating["section"], rating: string | null, weight = 25): CheckInCompetencyRating {
  return {
    id,
    check_in_id: "ci-1",
    section,
    factor_id: `f-${id}`,
    technical_competency_id: null,
    name_snapshot: `Competency ${id}`,
    weight_snapshot: weight,
    display_order: 0,
    employee_rating_code: rating,
    manager_rating_code: null,
    employee_comment: null,
    manager_comment: null,
  };
}

const COMPLETE = { required: true, weights: [], employee: [], manager: [], complete: true };

/** Scored review with every required employee input saved. */
function completeReview(overrides: Partial<CheckInWithResponses> = {}): CheckInWithResponses {
  return {
    id: "ci-1",
    appraisal_id: "a-1",
    title: "Mid-Year Review – FY 2026/27",
    check_in_type: "MIDYEAR",
    review_mode: "FORMAL_SCORED",
    is_management_track: false,
    initiated_by: null,
    due_date: "2026-10-30",
    status: "OPEN",
    employee_submitted_at: null,
    manager_reviewed_at: null,
    manager_overall_notes: null,
    note_to_employee: null,
    created_at: "2026-09-01",
    updated_at: "2026-09-01",
    responses: [response("wi-1", 8), response("wi-2", 9)],
    competency_ratings: [competency("cr-core", "CORE", "7"), competency("cr-prod", "PRODUCTIVITY", "7")],
    midyear_completeness: COMPLETE,
    ...overrides,
  };
}

/** Same review with one objective result and one core rating still missing. */
const incompleteReview = (overrides: Partial<CheckInWithResponses> = {}) =>
  completeReview({
    responses: [response("wi-1", 8), response("wi-2", null)],
    competency_ratings: [competency("cr-core", "CORE", null), competency("cr-prod", "PRODUCTIVITY", "7")],
    midyear_completeness: {
      required: true,
      weights: [],
      employee: ["Workplan: 1 objective(s) missing an employee Mid-Year result.", "Core competencies: 1 employee rating(s) missing."],
      manager: [],
      complete: false,
    },
    ...overrides,
  });

const render = async (ci: CheckInWithResponses, role: "EMPLOYEE" | "MANAGER" = "EMPLOYEE") =>
  act(async () =>
    root.render(
      createElement(ActiveCheckInCard, {
        appraisalId: "a-1",
        checkIn: ci,
        appraisal: { employeeName: "Jane Brown", employee_id: "emp-1", manager_employee_id: "mgr-1", status: "IN_PROGRESS" },
        currentUser: { employee_id: role === "EMPLOYEE" ? "emp-1" : "mgr-1", roles: [] },
        role,
        onUpdate,
        ratingScale: [
          { code: "5", label: "Meets expectations" },
          { code: "7", label: "Meets expectations well" },
        ],
      })
    )
  );

const submitButton = () => document.querySelector<HTMLButtonElement>("[data-midyear-submit]");
const confirmButton = () => document.querySelector<HTMLButtonElement>("[data-midyear-confirm-submit]");
const saveButton = () => document.querySelector<HTMLButtonElement>("[data-midyear-save-draft]")!;
const blockerTexts = () => [...document.querySelectorAll("[data-midyear-blocker]")].map((li) => li.textContent);
const blockerCount = () => document.querySelector("[data-midyear-blocker-count]")?.textContent ?? null;
const actualInput = (itemId: string) =>
  document.querySelector<HTMLInputElement>(`[data-midyear-workplan-row="${itemId}"] [data-midyear-actual]`)!;

function setInput(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function setSelect(el: HTMLSelectElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

describe("Submit to manager on a scored Mid-Year Review", () => {
  it("is visible but disabled while required employee items are missing", async () => {
    await render(incompleteReview());
    const btn = submitButton()!;
    expect(btn).not.toBeNull();
    expect(btn.textContent).toContain("Submit to manager");
    expect(btn.disabled).toBe(true);
    expect(btn.classList.contains("bg-ds-surface")).toBe(true);
    expect(btn.classList.contains("text-ds-text-muted")).toBe(true);
    expect(btn.classList.contains("bg-ds-accent")).toBe(false);
  });

  it("explains why it is disabled with an accessible description and tooltip", async () => {
    await render(incompleteReview());
    const btn = submitButton()!;
    const describedBy = btn.getAttribute("aria-describedby")!;
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy)!.textContent).toBe(HELP);
    expect(btn.parentElement!.getAttribute("title")).toBe(HELP);
  });

  it("cannot open the confirmation or send a request while incomplete", async () => {
    await render(incompleteReview());
    await act(async () => submitButton()!.click());
    expect(confirmButton()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Save draft stays enabled while incomplete and saves as before", async () => {
    await render(incompleteReview());
    expect(saveButton().disabled).toBe(false);
    await act(async () => saveButton().click());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).action).toBe("EMPLOYEE_SAVE_DRAFT");
  });

  it("is enabled with the primary styling once every required item is complete", async () => {
    await render(completeReview());
    const btn = submitButton()!;
    expect(btn.disabled).toBe(false);
    expect(btn.classList.contains("bg-ds-accent")).toBe(true);
    expect(btn.hasAttribute("aria-describedby")).toBe(false);
    expect(btn.parentElement!.hasAttribute("title")).toBe(false);
    expect(document.querySelector("[data-midyear-ready]")!.textContent).toContain("All required items complete");
  });

  it("submits the current form values after confirmation", async () => {
    await render(completeReview());
    await act(async () => submitButton()!.click());
    await act(async () => confirmButton()!.click());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.action).toBe("EMPLOYEE_SUBMIT");
    expect(body.competencies).toEqual([
      { id: "cr-core", employee_rating_code: "7", employee_comment: null },
      { id: "cr-prod", employee_rating_code: "7", employee_comment: null },
    ]);
  });

  it("shows Submitting… and ignores duplicate clicks while the request is in flight", async () => {
    const pending = deferred();
    fetchMock.mockReturnValueOnce(pending.promise);
    await render(completeReview());
    await act(async () => submitButton()!.click());
    await act(async () => {
      confirmButton()!.click();
      confirmButton()!.click();
    });
    expect(confirmButton()!.textContent).toContain("Submitting…");
    expect(confirmButton()!.disabled).toBe(true);
    await act(async () => confirmButton()!.click());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(ok()));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("server rejection of an incomplete submission is still reported", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        error: "The Mid-Year Review is incomplete.",
        blockers: ["Core competencies: 1 employee rating(s) missing."],
      }),
    });
    await render(completeReview());
    await act(async () => submitButton()!.click());
    await act(async () => confirmButton()!.click());
    expect(alertMock).toHaveBeenCalledWith("The Mid-Year Review is incomplete.\n• Core competencies: 1 employee rating(s) missing.");
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

describe("requirements follow the current form values", () => {
  it("entering the missing values enables Submit without saving first", async () => {
    await render(incompleteReview());
    expect(submitButton()!.disabled).toBe(true);
    await act(async () => setInput(actualInput("wi-2"), "6"));
    expect(submitButton()!.disabled).toBe(true);
    expect(blockerTexts()).toEqual(["Core competencies: 1 employee rating(s) missing."]);
    await act(async () => setSelect(document.querySelector<HTMLSelectElement>('[data-midyear-rating="cr-core"]')!, "5"));
    expect(blockerTexts()).toEqual([]);
    expect(submitButton()!.disabled).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clearing a saved value disables Submit again, including on the confirmation step", async () => {
    await render(completeReview());
    await act(async () => submitButton()!.click());
    expect(confirmButton()!.disabled).toBe(false);
    await act(async () => setInput(actualInput("wi-1"), ""));
    expect(confirmButton()!.disabled).toBe(true);
    expect(confirmButton()!.getAttribute("title")).toBe(HELP);
    expect(blockerTexts()).toEqual(["Workplan: 1 objective(s) missing an employee Mid-Year result."]);
    await act(async () => confirmButton()!.click());
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the same rule as the server: zero-weight items and off-track Leadership are not required", async () => {
    await render(
      completeReview({
        responses: [response("wi-1", 8, 100), response("wi-2", null, 0)],
        competency_ratings: [
          competency("cr-core", "CORE", "7"),
          competency("cr-zero", "PRODUCTIVITY", null, 0),
          competency("cr-lead", "LEADERSHIP", null),
        ],
        is_management_track: false,
      })
    );
    expect(submitButton()!.disabled).toBe(false);
  });

  it("an unscored formal review never blocks Submit", async () => {
    await render(incompleteReview({ review_mode: "FORMAL", midyear_completeness: { required: false, weights: [], employee: [], manager: [], complete: true } }));
    expect(submitButton()!.disabled).toBe(false);
    expect(document.querySelector("[data-midyear-blockers]")).toBeNull();
  });
});

const MANAGER_HELP = "Complete the required manager items before submitting.";
const managerSubmit = () => document.querySelector<HTMLButtonElement>("[data-midyear-manager-submit]")!;
const rating = (id: string) => document.querySelector<HTMLSelectElement>(`[data-midyear-rating="${id}"]`)!;

/** Submitted review awaiting the manager, with every required manager rating given. */
function reviewedByManager(overrides: Partial<CheckInWithResponses> = {}): CheckInWithResponses {
  const ci = completeReview({ status: "EMPLOYEE_SUBMITTED", employee_submitted_at: "2026-10-12T09:00:00Z" });
  return {
    ...ci,
    competency_ratings: ci.competency_ratings!.map((c) => ({ ...c, manager_rating_code: "7" })),
    ...overrides,
  };
}

/** Same review with the manager's Core rating still missing. */
const managerIncomplete = (overrides: Partial<CheckInWithResponses> = {}) =>
  reviewedByManager({
    competency_ratings: [
      { ...competency("cr-core", "CORE", "7"), manager_rating_code: null },
      { ...competency("cr-prod", "PRODUCTIVITY", "7"), manager_rating_code: "7" },
    ],
    ...overrides,
  });

describe("Submit manager review on a scored Mid-Year Review", () => {
  it("is visible but disabled, with neutral styling and an accessible tooltip, while manager items are missing", async () => {
    await render(managerIncomplete(), "MANAGER");
    const btn = managerSubmit();
    expect(btn.textContent).toBe("Submit manager review ✓");
    expect(btn.disabled).toBe(true);
    expect(btn.classList.contains("bg-ds-surface")).toBe(true);
    expect(btn.classList.contains("bg-ds-accent")).toBe(false);
    expect(btn.parentElement!.getAttribute("title")).toBe(MANAGER_HELP);
    expect(document.getElementById(btn.getAttribute("aria-describedby")!)!.textContent).toBe(MANAGER_HELP);
    expect(blockerTexts()).toEqual(["Core competencies: 1 manager rating(s) missing."]);
    expect(document.querySelector("[data-midyear-blockers] p")!.textContent).toBe("Required before you can submit your review");
  });

  it("sends no request while incomplete; Save draft stays available", async () => {
    await render(managerIncomplete(), "MANAGER");
    await act(async () => managerSubmit().click());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(saveButton().disabled).toBe(false);
    await act(async () => saveButton().click());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ action: "MANAGER_RESPOND", saveOnly: true });
  });

  it("is enabled with primary styling and a ready message when complete", async () => {
    await render(reviewedByManager(), "MANAGER");
    const btn = managerSubmit();
    expect(btn.disabled).toBe(false);
    expect(btn.classList.contains("bg-ds-accent")).toBe(true);
    expect(btn.hasAttribute("aria-describedby")).toBe(false);
    expect(btn.parentElement!.hasAttribute("title")).toBe(false);
    expect(document.querySelector("[data-midyear-ready]")!.textContent).toContain("All required manager items complete");
  });

  it("completing the missing rating enables it without saving", async () => {
    await render(managerIncomplete(), "MANAGER");
    await act(async () => setSelect(rating("cr-core"), "5"));
    expect(blockerTexts()).toEqual([]);
    expect(managerSubmit().disabled).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clearing a required rating disables it again and updates the blocker list", async () => {
    await render(reviewedByManager(), "MANAGER");
    expect(managerSubmit().disabled).toBe(false);
    await act(async () => setSelect(rating("cr-prod"), ""));
    expect(managerSubmit().disabled).toBe(true);
    expect(blockerTexts()).toEqual(["Productivity: 1 manager rating(s) missing."]);
  });

  it("a workplan objective needs a manager or employee result; the manager's actual satisfies it", async () => {
    await render(reviewedByManager({ responses: [response("wi-1", 8), { ...response("wi-2", null) }] }), "MANAGER");
    expect(managerSubmit().disabled).toBe(true);
    expect(blockerTexts()).toEqual(["Workplan: 1 objective(s) missing a scoreable Mid-Year result."]);
    await act(async () => setInput(actualInput("wi-2"), "6"));
    expect(blockerTexts()).toEqual([]);
    expect(managerSubmit().disabled).toBe(false);
  });

  it("zero-weight items are not required", async () => {
    await render(
      reviewedByManager({
        responses: [response("wi-1", 8, 100), response("wi-2", null, 0)],
        competency_ratings: [
          { ...competency("cr-core", "CORE", "7"), manager_rating_code: "7" },
          { ...competency("cr-zero", "PRODUCTIVITY", "7", 0), manager_rating_code: null },
        ],
      }),
      "MANAGER"
    );
    expect(managerSubmit().disabled).toBe(false);
  });

  it("Leadership is ignored off the management track", async () => {
    await render(
      reviewedByManager({
        is_management_track: false,
        competency_ratings: [
          { ...competency("cr-core", "CORE", "7"), manager_rating_code: "7" },
          { ...competency("cr-lead", "LEADERSHIP", "7"), manager_rating_code: null },
        ],
      }),
      "MANAGER"
    );
    expect(managerSubmit().disabled).toBe(false);
  });

  it("Leadership is required on the management track", async () => {
    await render(
      reviewedByManager({
        is_management_track: true,
        competency_ratings: [
          { ...competency("cr-core", "CORE", "7"), manager_rating_code: "7" },
          { ...competency("cr-lead", "LEADERSHIP", "7"), manager_rating_code: null },
        ],
      }),
      "MANAGER"
    );
    expect(managerSubmit().disabled).toBe(true);
    expect(blockerTexts()).toEqual(["Leadership: 1 manager rating(s) missing."]);
    await act(async () => setSelect(rating("cr-lead"), "7"));
    expect(managerSubmit().disabled).toBe(false);
  });

  it("an unscored formal review is never blocked", async () => {
    await render(
      managerIncomplete({ review_mode: "FORMAL", midyear_completeness: { required: false, weights: [], employee: [], manager: [], complete: true } }),
      "MANAGER"
    );
    expect(managerSubmit().disabled).toBe(false);
    expect(document.querySelector("[data-midyear-blockers]")).toBeNull();
    await act(async () => managerSubmit().click());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).action).toBe("MANAGER_COMPLETE");
  });

  it("shows Submitting… and sends one request for repeated clicks", async () => {
    const pending = deferred();
    fetchMock.mockReturnValueOnce(pending.promise);
    await render(reviewedByManager(), "MANAGER");
    await act(async () => {
      managerSubmit().click();
      managerSubmit().click();
    });
    expect(managerSubmit().textContent).toBe("Submitting…");
    expect(managerSubmit().disabled).toBe(true);
    await act(async () => managerSubmit().click());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).action).toBe("MANAGER_COMPLETE");
    await act(async () => pending.resolve(ok()));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(managerSubmit().textContent).toBe("Submit manager review ✓");
  });

  it("a server 422 is still reported and the button recovers", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "The Mid-Year Review is incomplete.", blockers: ["Core competencies: 1 manager rating(s) missing."] }),
    });
    await render(reviewedByManager(), "MANAGER");
    await act(async () => managerSubmit().click());
    expect(alertMock).toHaveBeenCalledWith("The Mid-Year Review is incomplete.\n• Core competencies: 1 manager rating(s) missing.");
    expect(onUpdate).not.toHaveBeenCalled();
    expect(managerSubmit().disabled).toBe(false);
    expect(managerSubmit().textContent).toBe("Submit manager review ✓");
  });
});

describe("blocker count wording", () => {
  const renderBlockers = async (blockers: string[]) =>
    act(async () => root.render(createElement(MidyearBlockers, { title: "Required before you can submit", blockers })));

  it("counts requirement categories, not individual items", async () => {
    await renderBlockers([
      "Workplan: 2 objective(s) missing an employee Mid-Year result.",
      "Core competencies: 3 employee rating(s) missing.",
      "Productivity: 5 employee rating(s) missing.",
      "Technical competencies: 1 employee rating(s) missing.",
    ]);
    expect(blockerCount()).toBe("4 requirements remaining");
    expect(blockerTexts()).toHaveLength(4);
  });

  it("uses the singular for one requirement", async () => {
    await renderBlockers(["Core competencies: 3 employee rating(s) missing."]);
    expect(blockerCount()).toBe("1 requirement remaining");
  });

  it("the employee view shows the live requirement count", async () => {
    await render(incompleteReview());
    expect(blockerCount()).toBe("2 requirements remaining");
    expect(document.querySelector("[data-midyear-blockers] p")!.textContent).toBe("Required before you can submit");
  });
});
