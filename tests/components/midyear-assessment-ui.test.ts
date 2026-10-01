// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ActiveCheckInCard } from "@/components/appraisal/checkins/ActiveCheckInCard";
import { HistoryCheckInCard } from "@/components/appraisal/checkins/HistoryCheckInCard";
import type { CheckInWithResponses } from "@/types/checkins";

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

const wpNum = { id: "wi-num", major_task: "Deliver reports", corporate_objective: "", division_objective: "", key_output: "Reports", performance_standard: "", metric_target: 10, metric_type: "NUMBER", metric_deadline: null, weight: 60 };

function checkIn(overrides: Partial<CheckInWithResponses> = {}): CheckInWithResponses {
  return {
    id: "ci-1",
    appraisal_id: "a-1",
    title: "Mid-Year Review – 2026",
    check_in_type: "MIDYEAR",
    review_mode: "FORMAL",
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
        employee_status: null,
        progress_pct: null,
        employee_comment: null,
        employee_updated_at: null,
        mgr_status_override: null,
        mgr_comment: null,
        mgr_acknowledged_at: null,
        employee_actual_raw: null,
        employee_result: null,
        weight_snapshot: 60,
        workplan_item: wpNum,
      },
    ],
    competency_ratings: [
      { id: "cr-core", check_in_id: "ci-1", section: "CORE", factor_id: "f-core", technical_competency_id: null, name_snapshot: "Integrity", weight_snapshot: 100, display_order: 0, employee_rating_code: null, manager_rating_code: null, employee_comment: null, manager_comment: null },
      { id: "cr-tech", check_in_id: "ci-1", section: "TECHNICAL", factor_id: null, technical_competency_id: "t-sql", name_snapshot: "SQL", weight_snapshot: 100, display_order: 0, employee_rating_code: "6", manager_rating_code: null, employee_comment: "Improving", manager_comment: null },
    ],
    ...overrides,
  };
}

const render = async (ci: CheckInWithResponses, role: "EMPLOYEE" | "MANAGER") =>
  act(async () =>
    root.render(
      createElement(ActiveCheckInCard, {
        appraisalId: "a-1",
        checkIn: ci,
        appraisal: { employeeName: "Employee", employee_id: "emp-1", manager_employee_id: "mgr-1" },
        currentUser: { employee_id: role === "EMPLOYEE" ? "emp-1" : "mgr-1", roles: [] },
        role,
        onUpdate: vi.fn(),
        ratingScale: [{ code: "7", label: "Meets expectations well" }, { code: "8", label: "Exceeds expectations" }],
      })
    )
  );

const button = (text: string) => [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!;
const lastBody = () => JSON.parse(fetchMock.mock.calls.at(-1)![1].body);

function setValue(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
}

describe("formal Mid-Year — employee", () => {
  it("collects workplan actuals with a live result and competency ratings", async () => {
    await render(checkIn(), "EMPLOYEE");
    expect(document.querySelector('[data-midyear-workplan-input="employee"]')).not.toBeNull();
    await act(async () => setValue(document.querySelector<HTMLInputElement>("[data-midyear-actual]")!, "8"));
    expect(document.querySelector("[data-midyear-result]")!.textContent).toBe("80%");
    const sections = [...document.querySelectorAll<HTMLElement>("[data-midyear-competency-section]")].map((s) => s.dataset.midyearCompetencySection);
    expect(sections).toEqual(["CORE", "TECHNICAL"]);
    await act(async () => setValue(document.querySelector<HTMLSelectElement>('[data-midyear-rating="cr-core"]')!, "8"));
    await act(async () => setValue(document.querySelector<HTMLTextAreaElement>('[data-midyear-comment="cr-core"]')!, "Consistent"));

    await act(async () => button("Save draft").click());
    const body = lastBody();
    expect(body.action).toBe("EMPLOYEE_SAVE_DRAFT");
    expect(body.responses[0]).toMatchObject({ workplan_item_id: "wi-num", employee_actual_raw: 8, progress_pct: 80 });
    expect(body.competencies).toEqual([
      { id: "cr-core", employee_rating_code: "8", employee_comment: "Consistent" },
      { id: "cr-tech", employee_rating_code: "6", employee_comment: "Improving" },
    ]);
  });
});

describe("formal Mid-Year — manager", () => {
  it("collects the manager workplan assessment and competency ratings", async () => {
    const ci = checkIn({ status: "EMPLOYEE_SUBMITTED" });
    ci.responses[0] = { ...ci.responses[0], employee_actual_raw: 8, employee_result: 80, progress_pct: 80, employee_status: "ON_TRACK" };
    await render(ci, "MANAGER");
    expect(document.querySelector("[data-midyear-employee-result]")!.textContent).toContain("80%");
    expect(document.querySelector("[data-midyear-employee-actual]")!.textContent).toContain("8");
    expect(document.querySelector('[data-midyear-workplan-input="manager"]')).not.toBeNull();
    expect(document.querySelector('[data-midyear-competency="cr-tech"] [data-midyear-employee-rating]')!.textContent).toContain("6/10");
    await act(async () => setValue(document.querySelector<HTMLInputElement>("[data-midyear-actual]")!, "6"));
    await act(async () => setValue(document.querySelector<HTMLSelectElement>('[data-midyear-rating="cr-tech"]')!, "7"));

    await act(async () => button("Submit manager review ✓").click());
    const body = lastBody();
    expect(body.action).toBe("MANAGER_COMPLETE");
    expect(body.responses[0]).toMatchObject({ mgr_actual_raw: 6 });
    expect(body.competencies).toEqual([
      { id: "cr-core", manager_rating_code: null, manager_comment: null },
      { id: "cr-tech", manager_rating_code: "7", manager_comment: null },
    ]);
  });
});

describe("informal check-ins keep the existing UI and payloads", () => {
  const informal = () =>
    checkIn({ title: "Q2 check-in", check_in_type: "QUARTERLY", review_mode: "INFORMAL", is_management_track: null, competency_ratings: undefined });

  it("employee view has no Mid-Year inputs and sends the original body", async () => {
    await render(informal(), "EMPLOYEE");
    expect(document.querySelector("[data-midyear-workplan-input]")).toBeNull();
    expect(document.querySelector("[data-midyear-competencies]")).toBeNull();
    expect(document.querySelector('input[type="number"]')).not.toBeNull();
    await act(async () => button("Save draft").click());
    const body = lastBody();
    expect(Object.keys(body)).toEqual(["action", "responses"]);
    expect(Object.keys(body.responses[0]).sort()).toEqual(
      ["employee_comment", "employee_status", "mgr_comment", "mgr_status_override", "progress_pct", "workplan_item_id"]
    );
  });

  it("manager view has no Mid-Year inputs and sends the original body", async () => {
    await render({ ...informal(), status: "EMPLOYEE_SUBMITTED" }, "MANAGER");
    expect(document.querySelector("[data-midyear-workplan-input]")).toBeNull();
    await act(async () => button("Complete check-in ✓").click());
    expect(Object.keys(lastBody())).toEqual(["action", "responses", "manager_overall_notes"]);
  });

  it("history card shows no Mid-Year details", async () => {
    await act(async () => root.render(createElement(HistoryCheckInCard, { checkIn: { ...informal(), status: "MANAGER_REVIEWED" } })));
    await act(async () => (document.querySelector(".cursor-pointer") as HTMLElement).click());
    expect(document.querySelector("[data-midyear-summary]")).toBeNull();
    expect(document.querySelector("[data-midyear-competencies]")).toBeNull();
  });
});

describe("history of a formal Mid-Year Review", () => {
  it("shows both parties' results and competency ratings read-only", async () => {
    const ci = checkIn({ status: "COMPLETE" });
    ci.responses[0] = { ...ci.responses[0], employee_actual_raw: 8, employee_result: 80, mgr_actual_raw: 6, mgr_result: 60 };
    ci.competency_ratings![1] = { ...ci.competency_ratings![1], manager_rating_code: "7", manager_comment: "Agree" };
    await act(async () => root.render(createElement(HistoryCheckInCard, { checkIn: ci })));
    await act(async () => (document.querySelector(".cursor-pointer") as HTMLElement).click());
    const summaries = [...document.querySelectorAll("[data-midyear-summary]")].map((s) => s.textContent);
    expect(summaries).toEqual(["Actual: 8 · Result: 80%", "Actual: 6 · Result: 60%"]);
    const managerRating = document.querySelector('[data-midyear-competency="cr-tech"] [data-midyear-manager-rating]')!.textContent;
    expect(managerRating).toContain("7/10");
    expect(managerRating).toContain("Agree");
    expect(document.querySelector("[data-midyear-rating]")).toBeNull();
  });
});
