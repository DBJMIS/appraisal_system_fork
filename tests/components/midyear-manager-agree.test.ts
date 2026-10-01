// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ActiveCheckInCard } from "@/components/appraisal/checkins/ActiveCheckInCard";
import { midyearEmployeeResult, midyearManagerResult } from "@/lib/midyear-assessment";
import { calcMidyearCompleteness } from "@/lib/midyear-lifecycle";
import type { CheckInResponse, CheckInWithResponses, ObjectiveStatus } from "@/types/checkins";

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
  vi.stubGlobal("alert", vi.fn());
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const numberItem = { id: "wi-num", major_task: "Deliver reports", corporate_objective: "", division_objective: "", key_output: "Reports", performance_standard: "", metric_target: 10, metric_type: "NUMBER", metric_deadline: null, weight: 50 };
const dateItem = { id: "wi-date", major_task: "Launch portal", corporate_objective: "", division_objective: "", key_output: "Portal", performance_standard: "", metric_target: null, metric_type: "DATE", metric_deadline: "2026-12-31", weight: 50 };

function response(
  item: typeof numberItem | typeof dateItem,
  employee: { actual?: number | null; date?: string | null; result: number | null },
  manager: { status?: ObjectiveStatus | null; actual?: number | null; date?: string | null; result?: number | null } = {}
): CheckInResponse {
  return {
    id: `r-${item.id}`,
    check_in_id: "ci-1",
    workplan_item_id: item.id,
    employee_status: "ON_TRACK",
    progress_pct: 80,
    employee_comment: null,
    employee_updated_at: null,
    mgr_status_override: manager.status ?? null,
    mgr_comment: null,
    mgr_acknowledged_at: null,
    employee_actual_raw: employee.actual ?? null,
    employee_completion_date: employee.date ?? null,
    employee_result: employee.result,
    mgr_actual_raw: manager.actual ?? null,
    mgr_completion_date: manager.date ?? null,
    mgr_result: manager.result ?? null,
    weight_snapshot: item.weight,
    workplan_item: item,
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
    due_date: "2026-10-30",
    status: "EMPLOYEE_SUBMITTED",
    employee_submitted_at: "2026-10-12T09:00:00Z",
    manager_reviewed_at: null,
    manager_overall_notes: null,
    note_to_employee: null,
    created_at: "2026-09-01",
    updated_at: "2026-09-01",
    responses,
    competency_ratings: [
      { id: "cr-core", check_in_id: "ci-1", section: "CORE", factor_id: "f-1", technical_competency_id: null, name_snapshot: "Professionalism", weight_snapshot: 100, display_order: 0, employee_rating_code: "7", manager_rating_code: "7", employee_comment: null, manager_comment: null },
    ],
    midyear_completeness: { required: true, weights: [], employee: [], manager: [], complete: true },
    ...overrides,
  };
}

const render = async (ci: CheckInWithResponses, role: "MANAGER" | "HR" = "MANAGER") =>
  act(async () =>
    root.render(
      createElement(ActiveCheckInCard, {
        appraisalId: "a-1",
        checkIn: ci,
        appraisal: { employeeName: "Jane Brown", employee_id: "emp-1", manager_employee_id: "mgr-1", status: "IN_PROGRESS" },
        currentUser: role === "HR" ? { employee_id: "hr-1", roles: ["hr"] } : { employee_id: "mgr-1", roles: [] },
        role,
        onUpdate: vi.fn(),
        ratingScale: [{ code: "7", label: "Meets expectations well" }],
      })
    )
  );

const row = (id: string) => document.querySelector<HTMLElement>(`[data-midyear-workplan-row="${id}"]`)!;
const managerActual = (id: string) => row(id).querySelector<HTMLInputElement>('[data-midyear-workplan-input="manager"] [data-midyear-actual]')!;
const managerDate = (id: string) => row(id).querySelector<HTMLInputElement>('[data-midyear-workplan-input="manager"] [data-midyear-completion-date]')!;
const managerResult = (id: string) => row(id).querySelector("[data-midyear-result]")!.textContent;
const segment = (id: string, label: string) =>
  [...row(id).querySelectorAll<HTMLButtonElement>("[data-midyear-segmented] button")].find((b) => b.textContent === label)!;
const click = async (el: HTMLElement) => act(async () => el.click());
const sentResponses = () => JSON.parse(fetchMock.mock.calls.at(-1)![1].body).responses as Array<Record<string, unknown>>;
const sentFor = (id: string) => sentResponses().find((r) => r.workplan_item_id === id)!;

async function type(el: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("manager Agree uses the employee's Mid-Year actual", () => {
  it("existing Agreed rows with no manager value show the employee's actual, date and result", async () => {
    await render(
      review([response(numberItem, { actual: 8, result: 80 }), response(dateItem, { date: "2026-11-15", result: 100 })])
    );
    expect(segment("wi-num", "Agree").getAttribute("aria-pressed")).toBe("true");
    expect(managerActual("wi-num").value).toBe("8");
    expect(managerResult("wi-num")).toBe("80%");
    expect(managerDate("wi-date").value).toBe("2026-11-15");
    expect(managerResult("wi-date")).toBe("100%");
  });

  it("selecting Agree on a blank manager row copies the employee's actual and result", async () => {
    await render(review([response(numberItem, { actual: 8, result: 80 }, { status: "AT_RISK" })]));
    expect(managerActual("wi-num").value).toBe("");
    expect(managerResult("wi-num")).toBe("—");

    await click(segment("wi-num", "Agree"));
    expect(segment("wi-num", "Agree").getAttribute("aria-pressed")).toBe("true");
    expect(managerActual("wi-num").value).toBe("8");
    expect(managerResult("wi-num")).toBe("80%");
  });

  it("selecting Agree on a blank date objective copies the employee's completion date", async () => {
    await render(review([response(dateItem, { date: "2026-11-15", result: 100 }, { status: "BEHIND" })]));
    expect(managerDate("wi-date").value).toBe("");

    await click(segment("wi-date", "Agree"));
    expect(managerDate("wi-date").value).toBe("2026-11-15");
    expect(managerResult("wi-date")).toBe("100%");
  });

  it("does not overwrite a saved manager actual", async () => {
    await render(review([response(numberItem, { actual: 8, result: 80 }, { status: "AT_RISK", actual: 6, result: 60 })]));
    await click(segment("wi-num", "Agree"));
    expect(managerActual("wi-num").value).toBe("6");
    expect(managerResult("wi-num")).toBe("60%");
  });

  it("does not overwrite a manager actual typed in this session", async () => {
    await render(review([response(numberItem, { actual: 8, result: 80 }, { status: "BEHIND" })]));
    await type(managerActual("wi-num"), "5");
    await click(segment("wi-num", "Agree"));
    expect(managerActual("wi-num").value).toBe("5");
    expect(managerResult("wi-num")).toBe("50%");
  });

  it("the auto-filled value stays editable and the result recalculates", async () => {
    await render(review([response(numberItem, { actual: 8, result: 80 })]));
    expect(managerActual("wi-num").disabled).toBe(false);
    expect(managerActual("wi-num").readOnly).toBe(false);

    await type(managerActual("wi-num"), "9");
    expect(managerActual("wi-num").value).toBe("9");
    expect(managerResult("wi-num")).toBe("90%");

    await type(managerActual("wi-num"), "");
    expect(managerActual("wi-num").value).toBe("");
    expect(managerResult("wi-num")).toBe("—");
  });

  it.each(["At risk", "Behind"])("%s does not copy the employee's actual", async (label) => {
    await render(review([response(numberItem, { actual: 8, result: 80 }, { status: "AT_RISK" })]));
    await click(segment("wi-num", label));
    expect(managerActual("wi-num").value).toBe("");
    expect(managerResult("wi-num")).toBe("—");
  });

  it("switching from Agree to At risk drops an untouched auto-fill", async () => {
    await render(review([response(numberItem, { actual: 8, result: 80 })]));
    expect(managerActual("wi-num").value).toBe("8");
    await click(segment("wi-num", "At risk"));
    expect(managerActual("wi-num").value).toBe("");
  });

  it("Save draft persists the Agreed value explicitly", async () => {
    await render(
      review([
        response(numberItem, { actual: 8, result: 80 }),
        response(dateItem, { date: "2026-11-15", result: 100 }, { status: "AT_RISK" }),
      ])
    );
    await click(document.querySelector<HTMLButtonElement>("[data-midyear-save-draft]")!);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).action).toBe("MANAGER_RESPOND");
    expect(sentFor("wi-num")).toMatchObject({ mgr_status_override: null, mgr_actual_raw: 8, mgr_completion_date: null });
    expect(sentFor("wi-date")).toMatchObject({ mgr_status_override: "AT_RISK", mgr_actual_raw: null, mgr_completion_date: null });
  });

  it("Submit manager review persists the Agreed value explicitly", async () => {
    await render(review([response(numberItem, { actual: 8, result: 80 }, { status: "AT_RISK" })]));
    await click(segment("wi-num", "Agree"));
    await click(document.querySelector<HTMLButtonElement>("[data-midyear-manager-submit]")!);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).action).toBe("MANAGER_COMPLETE");
    expect(sentFor("wi-num")).toMatchObject({ mgr_status_override: null, mgr_actual_raw: 8, mgr_completion_date: null });
  });

  it("a cleared manager actual is sent as cleared, not re-filled", async () => {
    await render(review([response(numberItem, { actual: 8, result: 80 })]));
    await type(managerActual("wi-num"), "");
    await click(document.querySelector<HTMLButtonElement>("[data-midyear-save-draft]")!);
    expect(sentFor("wi-num")).toMatchObject({ mgr_status_override: null, mgr_actual_raw: null });
  });

  it("read-only Agreed rows saved without a manager value show the employee's value", async () => {
    await render(
      review(
        [
          response(numberItem, { actual: 8, result: 80 }),
          response(dateItem, { date: "2026-11-15", result: 100 }, { status: "AT_RISK" }),
        ],
        { status: "MANAGER_REVIEWED", manager_reviewed_at: "2026-10-20T09:00:00Z" }
      ),
      "HR"
    );
    const manager = (id: string) => row(id).querySelector<HTMLElement>('[data-midyear-party="manager"]')!;
    expect(manager("wi-num").querySelector("[data-midyear-summary]")!.textContent).toBe("Actual: 8 · Result: 80%");
    expect(manager("wi-num").querySelector("[data-midyear-agreed-fallback]")).not.toBeNull();
    expect(manager("wi-date").querySelector("[data-midyear-summary]")!.textContent).toBe("Completed: — · Result: —");
    expect(manager("wi-date").querySelector("[data-midyear-agreed-fallback]")).toBeNull();
  });
});

describe("scoring is unchanged by the copy", () => {
  it("the manager formula gives the employee's result for the copied value", () => {
    const cases: Array<[typeof numberItem | typeof dateItem, { actual_raw: number | null; completion_date: string | null }]> = [
      [numberItem, { actual_raw: 8, completion_date: null }],
      [numberItem, { actual_raw: 12, completion_date: null }],
      [{ ...numberItem, metric_type: "PERCENTAGE", metric_target: 100 }, { actual_raw: 65, completion_date: null }],
      [dateItem, { actual_raw: null, completion_date: "2026-11-15" }],
      [dateItem, { actual_raw: null, completion_date: "2027-02-01" }],
    ];
    for (const [item, input] of cases) {
      expect(midyearManagerResult(item, input)).toBe(midyearEmployeeResult(item, input));
    }
  });

  it("completeness is the same whether the Agreed value is copied or left to the employee fallback", () => {
    const base = { reviewMode: "FORMAL_SCORED" as const, isManagementTrack: false };
    const competencies = [{ section: "CORE" as const, weight_snapshot: 100, employee_rating_code: "7", manager_rating_code: "7" }];
    const fallback = calcMidyearCompleteness({
      ...base,
      competencies,
      responses: [{ weight_snapshot: 100, employee_result: 80, mgr_result: null }],
    });
    const copied = calcMidyearCompleteness({
      ...base,
      competencies,
      responses: [{ weight_snapshot: 100, employee_result: 80, mgr_result: 80 }],
    });
    expect(copied).toEqual(fallback);
  });
});
