// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CycleReminderFields, reminderRequestFields, validateReminderForm } from "@/components/admin/CycleReminderFields";
import { cycleToForm, emptyCycleForm, type Cycle } from "@/components/admin/admin-shared";
import { parseFinalReviewNoticeText, parseReminderDaysText } from "@/lib/appraisal-reminder-policy";

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
});

const DEFAULT_FORM = { reminder_days_before: "7, 3, 1, 0", overdue_reminder_days: "1, 3, 7", final_review_notice_days: "30" };
const section = () => document.querySelector("[data-reminder-section]") as HTMLElement;
const input = (id: string) => document.querySelector<HTMLInputElement>(`[data-reminder-input="${id}"]`)!;
const chips = () => [...document.querySelectorAll("[data-reminder-chip]")].map((c) => c.textContent);
const errors = () => [...document.querySelectorAll("[data-reminder-error]")].map((e) => e.textContent);

function type(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("CycleReminderFields", () => {
  const onChange = vi.fn();
  const render = async (value = DEFAULT_FORM, locked = false) =>
    act(async () => root.render(createElement(CycleReminderFields, { value, onChange, locked })));

  it("shows the reminder settings with helper text and a preview of each day", async () => {
    await render();
    expect(section().textContent).toContain("Reminder settings");
    expect(section().textContent).toContain("0 means on the due date");
    expect(section().textContent).toContain("Overdue reminders stop after the last configured day");
    expect(section().textContent).toContain("days before cycle end");
    expect(chips()).toEqual(["7d before", "3d before", "1d before", "On due date", "1d overdue", "3d overdue", "7d overdue"]);
    expect(input("final-review-notice-days").value).toBe("30");
    expect(errors()).toEqual([]);
  });

  it("sends edits as typed", async () => {
    await render();
    await act(async () => type(input("reminder-days-before"), "10, 5"));
    expect(onChange).toHaveBeenCalledWith({ reminder_days_before: "10, 5" });
    await act(async () => type(input("overdue-reminder-days"), "2"));
    expect(onChange).toHaveBeenCalledWith({ overdue_reminder_days: "2" });
    await act(async () => type(input("final-review-notice-days"), "14"));
    expect(onChange).toHaveBeenCalledWith({ final_review_notice_days: "14" });
  });

  it("shows an inline error for invalid input", async () => {
    await render({ reminder_days_before: "7, 7", overdue_reminder_days: "0", final_review_notice_days: "abc" });
    expect(errors()).toEqual([
      "Due reminders: 7 is listed more than once.",
      "Overdue reminders: each day must be between 1 and 60.",
      "Final Review notice: enter a whole number of days.",
    ]);
    expect(input("reminder-days-before").getAttribute("aria-invalid")).toBe("true");
    expect(chips()).toEqual([]);
  });

  it("locked: read-only", async () => {
    await render(DEFAULT_FORM, true);
    for (const id of ["reminder-days-before", "overdue-reminder-days", "final-review-notice-days"]) {
      expect(input(id).disabled).toBe(true);
    }
    expect(section().textContent).toContain("can't be changed");
  });
});

describe("reminder settings validation", () => {
  it.each([
    ["", "enter at least one day"],
    ["7, x", 'use whole numbers only ("x" is not)'],
    ["1.5", 'use whole numbers only ("1.5" is not)'],
    ["-1", 'use whole numbers only ("-1" is not)'],
    ["61", "each day must be between 0 and 60"],
    ["3, 3", "3 is listed more than once"],
    ["1,2,3,4,5,6,7,8,9,10,11", "enter no more than 10 days"],
  ])("rejects due reminders %j", (raw, message) => {
    expect(validateReminderForm({ ...DEFAULT_FORM, reminder_days_before: raw })).toBe(`Due reminders: ${message}.`);
  });

  it("rejects an overdue reminder on the due date (0)", () => {
    expect(validateReminderForm({ ...DEFAULT_FORM, overdue_reminder_days: "0, 3" })).toBe("Overdue reminders: each day must be between 1 and 60.");
  });

  it.each([
    ["", "enter a whole number of days"],
    ["2.5", "enter a whole number of days"],
    ["0", "must be between 1 and 90 days"],
    ["91", "must be between 1 and 90 days"],
  ])("rejects a Final Review notice of %j", (raw, message) => {
    expect(validateReminderForm({ ...DEFAULT_FORM, final_review_notice_days: raw })).toBe(`Final Review notice: ${message}.`);
  });

  it("accepts commas or spaces and the 0-60 range", () => {
    expect(validateReminderForm(DEFAULT_FORM)).toBeNull();
    expect(validateReminderForm({ ...DEFAULT_FORM, reminder_days_before: "60 0", overdue_reminder_days: "60" })).toBeNull();
    expect(parseReminderDaysText(" 14 ,7  1 ", 0, "Due reminders")).toEqual({ value: [14, 7, 1], error: null });
    expect(parseFinalReviewNoticeText(" 90 ", "Final Review notice")).toEqual({ value: 90, error: null });
  });

  it("request fields are sorted numbers", () => {
    expect(reminderRequestFields({ reminder_days_before: "1, 14, 7", overdue_reminder_days: "5 2", final_review_notice_days: "21" })).toEqual({
      reminder_days_before: [14, 7, 1],
      overdue_reminder_days: [2, 5],
      final_review_notice_days: 21,
    });
  });
});

describe("cycle form reminder values", () => {
  it("a new cycle starts with the current default policy", () => {
    expect(emptyCycleForm).toMatchObject(DEFAULT_FORM);
  });

  it("editing a cycle shows its stored settings, or the defaults when it has none", () => {
    const base = { id: "c-1", name: "FY 2026", fiscal_year: "2026", status: "open" } as Cycle;
    expect(cycleToForm(base)).toMatchObject(DEFAULT_FORM);
    expect(cycleToForm({ ...base, reminder_days_before: [10, 5], overdue_reminder_days: [2], final_review_notice_days: 14 })).toMatchObject({
      reminder_days_before: "10, 5",
      overdue_reminder_days: "2",
      final_review_notice_days: "14",
    });
  });
});
