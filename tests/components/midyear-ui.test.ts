// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CycleMidyearFields, midyearRequestFields, validateMidyearForm } from "@/components/admin/CycleMidyearFields";
import { NewCheckInModal } from "@/components/appraisal/checkins/NewCheckInModal";
import { cycleMidyearStatus, cycleToForm, emptyCycleForm } from "@/components/admin/admin-shared";
import type { MidyearConfig } from "@/lib/midyear-config";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const toggle = (attr: string) => document.querySelector(`input[${attr}]`)!.closest("button") as HTMLButtonElement;

describe("CycleMidyearFields", () => {
  const off = {
    midyear_review_enabled: false,
    midyear_scoring_enabled: false,
    midyear_window_start: "",
    midyear_due_date: "",
  };
  const onChange = vi.fn();
  const render = async (value = off, locked = false) =>
    act(async () => root.render(createElement(CycleMidyearFields, { value, onChange, locked })));

  it("off: scoring toggle disabled and dates hidden", async () => {
    await render();
    expect(toggle("data-midyear-review-toggle").getAttribute("aria-checked")).toBe("false");
    expect(toggle("data-midyear-scoring-toggle").disabled).toBe(true);
    expect(document.querySelector("[data-midyear-dates]")).toBeNull();
  });

  it("turning the review off also clears scoring", async () => {
    await render({ ...off, midyear_review_enabled: true, midyear_scoring_enabled: true });
    await act(async () => toggle("data-midyear-review-toggle").click());
    expect(onChange).toHaveBeenCalledWith({ midyear_review_enabled: false, midyear_scoring_enabled: false });
  });

  it("on: scoring can be toggled and dates are shown", async () => {
    await render({ ...off, midyear_review_enabled: true, midyear_window_start: "2026-06-01" });
    expect(toggle("data-midyear-scoring-toggle").disabled).toBe(false);
    await act(async () => toggle("data-midyear-scoring-toggle").click());
    expect(onChange).toHaveBeenCalledWith({ midyear_scoring_enabled: true });
    expect(document.querySelector("[data-midyear-dates]")).not.toBeNull();
    expect(document.querySelector<HTMLInputElement>("[data-midyear-due-date]")!.min).toBe("2026-06-01");
  });

  it("locked: everything read-only", async () => {
    await render({ ...off, midyear_review_enabled: true }, true);
    expect(toggle("data-midyear-review-toggle").disabled).toBe(true);
    expect(toggle("data-midyear-scoring-toggle").disabled).toBe(true);
    expect(document.querySelector<HTMLInputElement>("[data-midyear-window-start]")!.disabled).toBe(true);
    expect(document.querySelector("[data-midyear-section]")!.textContent).toContain("can't be changed");
  });

  it("request fields never send scoring or dates while the review is off", () => {
    expect(midyearRequestFields({ ...off, midyear_scoring_enabled: true, midyear_due_date: "2026-06-30" })).toEqual({
      midyear_review_enabled: false,
      midyear_scoring_enabled: false,
    });
    expect(
      midyearRequestFields({ midyear_review_enabled: true, midyear_scoring_enabled: true, midyear_window_start: "", midyear_due_date: "2026-06-30" })
    ).toEqual({ midyear_review_enabled: true, midyear_scoring_enabled: true, midyear_window_start: null, midyear_due_date: "2026-06-30" });
  });

  it("validates date order", () => {
    expect(validateMidyearForm({ ...off, midyear_review_enabled: true, midyear_window_start: "2026-07-01", midyear_due_date: "2026-06-01" })).toMatch(/cannot be before/);
    expect(validateMidyearForm({ ...off, midyear_review_enabled: true, midyear_window_start: "2026-06-01", midyear_due_date: "2026-06-30" })).toBeNull();
  });
});

describe("cycle list helpers", () => {
  it("new cycle form defaults to off", () => {
    expect(emptyCycleForm.midyear_review_enabled).toBe(false);
    expect(emptyCycleForm.midyear_scoring_enabled).toBe(false);
  });

  it("status pill text", () => {
    expect(cycleMidyearStatus({} as never)).toBe("Off");
    expect(cycleMidyearStatus({ midyear_review_enabled: true } as never)).toBe("On");
    expect(cycleMidyearStatus({ midyear_review_enabled: true, midyear_scoring_enabled: true } as never)).toBe("Scored");
  });

  it("edit form picks up stored Mid-Year settings", () => {
    const form = cycleToForm({
      id: "c-1",
      name: "FY 2026",
      fiscal_year: "2026",
      start_date: "2026-01-01",
      end_date: "2026-12-31",
      status: "open",
      midyear_review_enabled: true,
      midyear_scoring_enabled: false,
      midyear_window_start: "2026-06-01",
      midyear_due_date: null,
    } as never);
    expect(form).toMatchObject({
      midyear_review_enabled: true,
      midyear_scoring_enabled: false,
      midyear_window_start: "2026-06-01",
      midyear_due_date: "",
    });
  });
});

describe("NewCheckInModal — Mid-Year", () => {
  const base = {
    appraisalId: "a-1",
    employeeName: "Employee",
    cycleLabel: "FY 2026",
    workplanItems: [{ id: "wi-1", major_task: "Task", corporate_objective: "", division_objective: "", key_output: "", weight: 100, metric_target: null }],
    onCreated: vi.fn(),
    onClose: vi.fn(),
  };
  const ENABLED: MidyearConfig = { enabled: true, scoringEnabled: false, windowStart: "2026-06-01", dueDate: "2026-06-30" };
  const render = async (extra: Record<string, unknown> = {}) =>
    act(async () => root.render(createElement(NewCheckInModal, { ...base, ...extra } as never)));
  const typeButtons = () => [...document.querySelectorAll<HTMLButtonElement>("[data-checkin-type]")];
  const submit = () => [...document.querySelectorAll("button")].find((b) => b.textContent === "Create & notify employee")!;

  function stubFetch() {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ checkIn: { id: "ci-1" } }) });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("disabled: the original options and editable title, no formal note", async () => {
    await render();
    expect(typeButtons().map((b) => b.textContent)).toEqual(["Mid-year", "Quarterly", "Ad hoc"]);
    expect(document.querySelector("[data-formal-midyear-note]")).toBeNull();
    expect(document.querySelector<HTMLInputElement>('input[type="text"]')!.value).toBe("Mid-year check-in FY 2026");
  });

  it("disabled: submits the informal body with no review_mode", async () => {
    const fetchMock = stubFetch();
    await render();
    await act(async () => submit().click());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ title: "Mid-year check-in FY 2026", check_in_type: "MIDYEAR", due_date: null, note_to_employee: null });
  });

  it("enabled: Mid-Year Review with read-only title and due date from the cycle", async () => {
    await render({ midyear: ENABLED, fiscalYear: "2026" });
    expect(typeButtons()[0].textContent).toBe("Mid-Year Review");
    expect(document.querySelector("[data-formal-midyear-note]")).not.toBeNull();
    expect(document.querySelector("[data-formal-midyear-title]")!.textContent).toBe("Mid-Year Review – 2026");
    expect(document.querySelector("[data-formal-midyear-due]")!.textContent).toBe("2026-06-30");
    expect(document.querySelector('input[type="text"]')).toBeNull();
    expect(document.querySelector('input[type="date"]')).toBeNull();
  });

  it.each([
    [false, "FORMAL"],
    [true, "FORMAL_SCORED"],
  ])("enabled (scoring %s): submits review_mode %s without a title", async (scoringEnabled, mode) => {
    const fetchMock = stubFetch();
    await render({ midyear: { ...ENABLED, scoringEnabled }, fiscalYear: "2026" });
    await act(async () => submit().click());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ check_in_type: "MIDYEAR", review_mode: mode, due_date: "2026-06-30", note_to_employee: null });
  });

  it("enabled: Quarterly stays an informal check-in with an editable title", async () => {
    const fetchMock = stubFetch();
    await render({ midyear: ENABLED, fiscalYear: "2026" });
    await act(async () => typeButtons()[1].click());
    expect(document.querySelector("[data-formal-midyear-note]")).toBeNull();
    expect(document.querySelector('input[type="text"]')).not.toBeNull();
    await act(async () => submit().click());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.check_in_type).toBe("QUARTERLY");
    expect("review_mode" in body).toBe(false);
  });

  it("enabled + existing formal review: Mid-Year is not offered again", async () => {
    await render({ midyear: ENABLED, fiscalYear: "2026", formalMidyearExists: true });
    expect(typeButtons().map((b) => b.dataset.checkinType)).toEqual(["QUARTERLY", "ADHOC"]);
  });
});
