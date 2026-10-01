// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ActiveCheckInCard } from "@/components/appraisal/checkins/ActiveCheckInCard";
import { DRAFT_SAVED_MS } from "@/hooks/useDraftSaveFeedback";
import type { CheckInWithResponses } from "@/types/checkins";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let alertMock: ReturnType<typeof vi.fn>;
let onUpdate: ReturnType<typeof vi.fn>;

const ok = () => ({ ok: true, json: async () => ({ success: true }) });

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
  vi.useRealTimers();
});

const wp = { id: "wi-num", major_task: "Deliver reports", corporate_objective: "", division_objective: "", key_output: "Reports", performance_standard: "", metric_target: 10, metric_type: "NUMBER", metric_deadline: null, weight: 100 };

function checkIn(overrides: Partial<CheckInWithResponses> = {}): CheckInWithResponses {
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
        mgr_comment: null,
        mgr_acknowledged_at: null,
        employee_actual_raw: 8,
        employee_result: 80,
        weight_snapshot: 100,
        workplan_item: wp,
      },
    ],
    competency_ratings: [
      { id: "cr-core", check_in_id: "ci-1", section: "CORE", factor_id: "f-1", technical_competency_id: null, name_snapshot: "Professionalism", weight_snapshot: 100, display_order: 0, employee_rating_code: "7", manager_rating_code: null, employee_comment: null, manager_comment: null },
    ],
    midyear_completeness: { required: true, weights: [], employee: [], manager: [], complete: true },
    ...overrides,
  };
}

const render = async (ci: CheckInWithResponses, role: "EMPLOYEE" | "MANAGER") =>
  act(async () =>
    root.render(
      createElement(ActiveCheckInCard, {
        appraisalId: "a-1",
        checkIn: ci,
        appraisal: { employeeName: "Jane Brown", employee_id: "emp-1", manager_employee_id: "mgr-1", status: "IN_PROGRESS" },
        currentUser: { employee_id: role === "EMPLOYEE" ? "emp-1" : "mgr-1", roles: [] },
        role,
        onUpdate,
        ratingScale: [{ code: "7", label: "Meets expectations well" }],
      })
    )
  );

const saveButton = () => document.querySelector<HTMLButtonElement>("[data-midyear-save-draft]")!;
const toast = () => document.querySelector<HTMLElement>("[data-toast]");
const button = (label: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === label)!;

function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
}

function setValue(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("formal Mid-Year Save draft feedback", () => {
  it("click shows Saving… and disables the button while the request is in flight", async () => {
    const pending = deferred();
    fetchMock.mockReturnValueOnce(pending.promise);
    await render(checkIn(), "EMPLOYEE");
    expect(saveButton().textContent).toBe("Save draft");
    await act(async () => saveButton().click());
    expect(saveButton().textContent).toBe("Saving…");
    expect(saveButton().disabled).toBe(true);
    expect(saveButton().dataset.midyearSaveDraft).toBe("saving");
    await act(async () => pending.resolve(ok()));
    expect(saveButton().textContent).toBe("Saved ✓");
  });

  it("duplicate clicks are ignored while saving", async () => {
    const pending = deferred();
    fetchMock.mockReturnValueOnce(pending.promise);
    await render(checkIn(), "EMPLOYEE");
    await act(async () => {
      saveButton().click();
      saveButton().click();
    });
    await act(async () => saveButton().click());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(ok()));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a successful save shows a success toast and the last-saved time", async () => {
    await render(checkIn(), "EMPLOYEE");
    expect(document.querySelector("[data-midyear-last-saved]")).toBeNull();
    await act(async () => saveButton().click());
    const t = toast()!;
    expect(t.dataset.toast).toBe("success");
    expect(t.getAttribute("role")).toBe("status");
    expect(t.querySelector("[data-toast-title]")!.textContent).toBe("Draft saved");
    expect(t.querySelector("[data-toast-description]")!.textContent).toBe("Your Mid-Year Review progress has been saved.");
    expect(t.className).toContain("border-ds-success-border");
    expect(document.querySelector("[data-midyear-last-saved]")!.textContent).toBe("Last saved just now");
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(alertMock).not.toHaveBeenCalled();
  });

  it("the button returns to Save draft and the toast dismisses itself", async () => {
    vi.useFakeTimers();
    await render(checkIn(), "EMPLOYEE");
    await act(async () => saveButton().click());
    expect(saveButton().textContent).toBe("Saved ✓");
    expect(saveButton().disabled).toBe(false);
    await act(async () => vi.advanceTimersByTime(DRAFT_SAVED_MS));
    expect(saveButton().textContent).toBe("Save draft");
    expect(toast()).not.toBeNull();
    await act(async () => vi.advanceTimersByTime(4000));
    expect(toast()).toBeNull();
  });

  it("the toast can be dismissed", async () => {
    await render(checkIn(), "EMPLOYEE");
    await act(async () => saveButton().click());
    await act(async () => toast()!.querySelector<HTMLButtonElement>("button[aria-label='Dismiss notification']")!.click());
    expect(toast()).toBeNull();
  });

  it("a failed save shows the controlled error, restores the button and keeps the inputs", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "The Mid-Year Review is read-only.", blockers: ["Workplan: x"] }),
    });
    await render(checkIn(), "EMPLOYEE");
    const actual = document.querySelector<HTMLInputElement>("[data-midyear-actual]")!;
    await act(async () => setValue(actual, "9"));
    await act(async () => saveButton().click());
    const t = toast()!;
    expect(t.dataset.toast).toBe("error");
    expect(t.getAttribute("role")).toBe("alert");
    expect(t.querySelector("[data-toast-title]")!.textContent).toBe("Draft not saved");
    expect(t.querySelector("[data-toast-description]")!.textContent).toBe("The Mid-Year Review is read-only.\n• Workplan: x");
    expect(saveButton().textContent).toBe("Save draft");
    expect(saveButton().disabled).toBe(false);
    expect(document.querySelector<HTMLInputElement>("[data-midyear-actual]")!.value).toBe("9");
    expect(document.querySelector("[data-midyear-last-saved]")).toBeNull();
    expect(alertMock).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("a network failure is reported the same way", async () => {
    fetchMock.mockRejectedValueOnce(new Error("Failed to fetch"));
    await render(checkIn(), "EMPLOYEE");
    await act(async () => saveButton().click());
    expect(toast()!.querySelector("[data-toast-description]")!.textContent).toBe("Failed to fetch");
    expect(saveButton().textContent).toBe("Save draft");
  });
});

describe("the save request is unchanged", () => {
  it("employee draft: same endpoint, method and body", async () => {
    await render(checkIn(), "EMPLOYEE");
    await act(async () => saveButton().click());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/appraisals/a-1/checkins/ci-1");
    expect(init.method).toBe("PATCH");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toEqual({
      action: "EMPLOYEE_SAVE_DRAFT",
      responses: [
        {
          workplan_item_id: "wi-num",
          employee_status: "ON_TRACK",
          progress_pct: 80,
          employee_comment: "Going well",
          mgr_status_override: null,
          mgr_comment: null,
          employee_actual_raw: 8,
          employee_completion_date: null,
          mgr_actual_raw: null,
          mgr_completion_date: null,
        },
      ],
      competencies: [{ id: "cr-core", employee_rating_code: "7", employee_comment: null }],
    });
  });

  it("manager draft: same body (Agreed rows carry the employee's actual) and the same feedback", async () => {
    await render({ ...checkIn(), status: "EMPLOYEE_SUBMITTED" }, "MANAGER");
    await act(async () => saveButton().click());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      action: "MANAGER_RESPOND",
      saveOnly: true,
      responses: [
        {
          workplan_item_id: "wi-num",
          employee_status: "ON_TRACK",
          progress_pct: 80,
          employee_comment: "Going well",
          mgr_status_override: null,
          mgr_comment: null,
          employee_actual_raw: 8,
          employee_completion_date: null,
          mgr_actual_raw: 8,
          mgr_completion_date: null,
        },
      ],
      manager_overall_notes: null,
      competencies: [{ id: "cr-core", manager_rating_code: null, manager_comment: null }],
    });
    expect(toast()!.querySelector("[data-toast-title]")!.textContent).toBe("Draft saved");
    expect(saveButton().textContent).toBe("Saved ✓");
  });

  it("submit keeps its existing error handling", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Incomplete." }) });
    await render(checkIn(), "EMPLOYEE");
    await act(async () => button("Submit to manager").click());
    await act(async () => button("Confirm submit").click());
    expect(alertMock).toHaveBeenCalledWith("Incomplete.");
    expect(toast()).toBeNull();
  });

  it("informal check-ins keep the existing Save draft", async () => {
    await render(
      checkIn({ title: "Q2", check_in_type: "QUARTERLY", review_mode: "INFORMAL", competency_ratings: undefined, midyear_completeness: undefined }),
      "EMPLOYEE"
    );
    expect(saveButton()).toBeNull();
    await act(async () => button("Save draft").click());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).action).toBe("EMPLOYEE_SAVE_DRAFT");
    expect(toast()).toBeNull();
  });
});
