// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import fs from "node:fs";
import path from "node:path";
import { ActiveCheckInCard } from "@/components/appraisal/checkins/ActiveCheckInCard";
import type { CheckInWithResponses } from "@/types/checkins";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let confirmSpy: ReturnType<typeof vi.fn>;
let alertSpy: ReturnType<typeof vi.fn>;
let onUpdate: ReturnType<typeof vi.fn>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
  confirmSpy = vi.fn(() => true);
  alertSpy = vi.fn();
  onUpdate = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("confirm", confirmSpy);
  vi.stubGlobal("alert", alertSpy);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function checkIn(): CheckInWithResponses {
  return {
    id: "ci-1",
    appraisal_id: "a-1",
    title: "Q2 check-in",
    check_in_type: "ADHOC",
    review_mode: "INFORMAL",
    initiated_by: null,
    due_date: "2026-09-30",
    status: "OPEN",
    employee_submitted_at: null,
    manager_reviewed_at: null,
    manager_overall_notes: null,
    note_to_employee: null,
    created_at: "2026-09-01",
    updated_at: "2026-09-01",
    responses: [],
  } as CheckInWithResponses;
}

async function flush() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function renderManagerCard() {
  await act(async () =>
    root.render(
      createElement(ActiveCheckInCard, {
        appraisalId: "a-1",
        checkIn: checkIn(),
        appraisal: { employeeName: "Employee", employee_id: "emp-1", manager_employee_id: "mgr-1", status: "IN_PROGRESS" },
        currentUser: { employee_id: "mgr-1", roles: [] },
        role: "MANAGER",
        onUpdate,
        ratingScale: [],
      })
    )
  );
}

const dialog = () => document.querySelector<HTMLElement>("[data-cancel-checkin-dialog]");
const dialogButton = (label: RegExp) =>
  [...(dialog()?.querySelectorAll("button") ?? [])].find((b) => label.test(b.textContent ?? "")) as HTMLButtonElement;

async function openDialog() {
  await act(async () => document.querySelector<HTMLButtonElement>("[data-cancel-checkin]")!.click());
  await flush();
}

describe("cancel check-in confirmation dialog", () => {
  it("opens the application dialog instead of a native confirm", async () => {
    await renderManagerCard();
    expect(dialog()).toBeNull();
    await openDialog();

    const d = dialog()!;
    expect(d).not.toBeNull();
    expect(d.getAttribute("role")).toBe("alertdialog");
    expect(d.textContent).toContain("Cancel check-in?");
    expect(d.textContent).toContain(
      "This check-in will be cancelled and can no longer be completed. This action cannot be undone."
    );
    expect(dialogButton(/^Keep check-in$/)).toBeTruthy();
    expect(dialogButton(/^Cancel check-in$/).className).toContain("bg-ds-error");
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Keep check-in closes the dialog without calling the API", async () => {
    await renderManagerCard();
    await openDialog();
    await act(async () => dialogButton(/^Keep check-in$/).click());
    await flush();
    expect(dialog()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("Cancel check-in sends the existing CANCEL request, refreshes and closes", async () => {
    await renderManagerCard();
    await openDialog();
    await act(async () => dialogButton(/^Cancel check-in$/).click());
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/appraisals/a-1/checkins/ci-1");
    expect(init).toMatchObject({ method: "PATCH" });
    expect(JSON.parse(init.body)).toEqual({ action: "CANCEL" });
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("while cancelling, both actions are disabled, the label changes and duplicates are ignored", async () => {
    let resolve!: (v: unknown) => void;
    fetchMock.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    await renderManagerCard();
    await openDialog();

    await act(async () => dialogButton(/^Cancel check-in$/).click());
    const confirmBtn = dialogButton(/^Cancelling…$/);
    expect(confirmBtn).toBeTruthy();
    expect(confirmBtn.disabled).toBe(true);
    expect(dialogButton(/^Keep check-in$/).disabled).toBe(true);

    await act(async () => confirmBtn.click());
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(dialog()).not.toBeNull();

    await act(async () => resolve({ ok: true, json: async () => ({ success: true }) }));
    await flush();
    expect(dialog()).toBeNull();
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it("on API failure keeps the dialog open and shows the existing error message", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Only the manager can cancel." }) });
    await renderManagerCard();
    await openDialog();
    await act(async () => dialogButton(/^Cancel check-in$/).click());
    await flush();

    expect(alertSpy).toHaveBeenCalledWith("Only the manager can cancel.");
    expect(dialog()).not.toBeNull();
    expect(dialogButton(/^Cancel check-in$/).disabled).toBe(false);
    expect(dialogButton(/^Keep check-in$/).disabled).toBe(false);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("Escape closes the dialog without calling the API", async () => {
    await renderManagerCard();
    await openDialog();
    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await flush();
    expect(dialog()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the check-in card no longer uses the native confirm for cancelling a check-in", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "components/appraisal/checkins/ActiveCheckInCard.tsx"), "utf8");
    expect(source).not.toContain("Cancel this check-in? This cannot be undone.");
    expect(source).not.toMatch(/window\.confirm/);
    expect(source).toMatch(/<CancelCheckInDialog[\s\S]*?onConfirm=\{\(\) => patch\(\{ action: "CANCEL" \}\)\}/);
  });
});
