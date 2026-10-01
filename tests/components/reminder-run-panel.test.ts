// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { ReminderRunPanel, runSummaryLine } from "@/components/admin/ReminderRunPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let runResponse: { status: number; body: unknown };

const jsonResponse = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

const BASE = {
  date: "2026-10-27",
  appraisalsChecked: 12,
  remindersPlanned: 2,
  created: 0,
  alreadyScheduled: 0,
  deliveriesDue: 2,
  sent: 0,
  skipped: 0,
  failed: 0,
  retriesScheduled: 0,
  deferred: 0,
  warnings: [],
};

const PREVIEW = {
  ...BASE,
  dryRun: true,
  reminders: [
    {
      appraisalId: "a-1",
      employeeName: "Jane Employee",
      kind: "MIDYEAR_DUE_SOON",
      kindLabel: "Mid-Year Review due soon",
      recipientRole: "employee",
      dueDate: "30 Oct 2026",
      offset: "3 days before due date",
    },
    {
      appraisalId: "a-2",
      employeeName: "Ann Analyst",
      kind: "MIDYEAR_MANAGER_REVIEW_PENDING",
      kindLabel: "Mid-Year manager review pending",
      recipientRole: "manager",
      dueDate: "30 Oct 2026",
      offset: "3 days before due date",
    },
  ],
};

const NEXT = [
  {
    appraisalId: "a-1",
    employeeName: "Jane Employee",
    reviewType: "Mid-Year Review",
    kind: "MIDYEAR_DUE_SOON",
    label: "Mid-Year Review due soon",
    recipientRole: "employee",
    scheduledDate: "2026-10-07",
    scheduledDateLabel: "7 Oct 2026",
    offsetDays: -3,
    timing: "3 days before due",
  },
  {
    appraisalId: "a-2",
    employeeName: "Ann Analyst",
    reviewType: "Final Review",
    kind: "MANAGER_REVIEW_PENDING",
    label: "Manager review pending",
    recipientRole: "manager",
    scheduledDate: "2027-03-31",
    scheduledDateLabel: "31 Mar 2027",
    offsetDays: 0,
    timing: "due-date reminder",
  },
];

let previewBody: unknown;

async function flush() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

const q = <T extends Element = HTMLElement>(sel: string) => container.querySelector(sel) as T | null;

async function click(sel: string) {
  await act(async () => {
    q<HTMLButtonElement>(sel)!.click();
  });
  await flush();
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  runResponse = { status: 200, body: { ...BASE, dryRun: false, created: 6, sent: 4, skipped: 1, failed: 1, retriesScheduled: 1 } };
  previewBody = PREVIEW;
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    return body.dryRun ? jsonResponse(previewBody) : jsonResponse(runResponse.body, runResponse.status);
  });
  vi.stubGlobal("fetch", fetchMock);
  act(() => {
    root.render(createElement(ReminderRunPanel));
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("ReminderRunPanel", () => {
  it("formats the run summary", () => {
    expect(runSummaryLine({ ...BASE, dryRun: false, sent: 4, skipped: 1, failed: 1 })).toBe(
      "12 appraisals checked · 4 reminders sent · 1 skipped · 1 failed"
    );
    expect(runSummaryLine({ ...BASE, dryRun: false, appraisalsChecked: 1, sent: 1 })).toBe(
      "1 appraisal checked · 1 reminder sent · 0 skipped · 0 failed"
    );
  });

  it("previews the run as a dry run and lists employee, type, recipient, due date and timing", async () => {
    await click("[data-reminder-preview-action]");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/cron/appraisal-reminders");
    expect(JSON.parse(String(init.body))).toEqual({ dryRun: true });

    const rows = [...container.querySelectorAll("[data-reminder-row]")].map((r) =>
      [...r.querySelectorAll("td")].map((td) => td.textContent)
    );
    expect(rows).toEqual([
      ["Jane Employee", "Mid-Year Review due soon", "Employee", "30 Oct 2026", "3 days before due date"],
      ["Ann Analyst", "Mid-Year manager review pending", "Manager", "30 Oct 2026", "3 days before due date"],
    ]);
    expect(q("[data-reminder-preview-summary]")!.textContent).toBe("12 appraisals checked · 2 reminders due today");
    expect(q("[data-reminder-preview-empty]")).toBeNull();
    expect(q("[data-reminder-next]")).toBeNull();
  });

  it("when nothing is due, explains and shows the next eligible reminder", async () => {
    previewBody = {
      ...BASE,
      dryRun: true,
      appraisalsChecked: 1,
      remindersPlanned: 0,
      reminders: [],
      nextEligibleReminder: NEXT[0],
      upcomingReminders: [NEXT[0]],
    };
    await click("[data-reminder-preview-action]");
    expect(q("[data-reminder-preview-summary]")!.textContent).toBe("1 appraisal checked · 0 reminders due today");
    expect(q("[data-reminder-preview-empty]")!.textContent).toBe("No reminders are scheduled for today.");
    expect(q("[data-reminder-next]")!.textContent).toContain("Next eligible reminder");
    expect(q("[data-reminder-next-title]")!.textContent).toBe("Mid-Year Review · Jane Employee");
    expect(q("[data-reminder-next-detail]")!.textContent).toBe("Employee · 7 Oct 2026 · 3 days before due");
    expect(container.querySelector("table")).toBeNull();
  });

  it("lists up to three upcoming reminders, soonest first as returned", async () => {
    previewBody = { ...BASE, dryRun: true, remindersPlanned: 0, reminders: [], nextEligibleReminder: NEXT[0], upcomingReminders: NEXT };
    await click("[data-reminder-preview-action]");
    expect(q("[data-reminder-next]")!.textContent).toContain("Next eligible reminders");
    expect([...container.querySelectorAll("[data-reminder-next-detail]")].map((e) => e.textContent)).toEqual([
      "Employee · 7 Oct 2026 · 3 days before due",
      "Manager · 31 Mar 2027 · due-date reminder",
    ]);
  });

  it("omits the helper cleanly when no next reminder can be calculated", async () => {
    previewBody = { ...BASE, dryRun: true, remindersPlanned: 0, reminders: [], nextEligibleReminder: null, upcomingReminders: [] };
    await click("[data-reminder-preview-action]");
    expect(q("[data-reminder-preview-empty]")!.textContent).toBe("No reminders are scheduled for today.");
    expect(q("[data-reminder-next]")).toBeNull();
  });

  it("shows local testing mode as a neutral notice and real problems as warnings", async () => {
    previewBody = {
      ...PREVIEW,
      notices: [{ title: "Local testing mode", message: "Email links point to localhost and will only open correctly on this computer." }],
    };
    await click("[data-reminder-preview-action]");
    const notice = q("[data-reminder-notice]")!;
    expect(notice.textContent).toBe("Local testing mode·Email links point to localhost and will only open correctly on this computer.");
    expect(notice.className).not.toMatch(/warning|error/);
    expect(q("[data-reminder-warnings]")).toBeNull();

    previewBody = { ...PREVIEW, warnings: ["NEXT_PUBLIC_APP_URL points to a local address (localhost:3000); links will not work for recipients."] };
    await click("[data-reminder-preview-action]");
    expect(q("[data-reminder-notice]")).toBeNull();
    expect(q("[data-reminder-warnings]")!.className).toMatch(/warning/);
  });

  it("asks for confirmation before a real run, then shows the summary", async () => {
    await click("[data-reminder-run-action]");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(q("[data-reminder-confirm]")).not.toBeNull();

    await click("[data-reminder-confirm-action]");
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({ dryRun: false });
    expect(q("[data-reminder-summary]")!.textContent).toBe("12 appraisals checked · 4 reminders sent · 1 skipped · 1 failed");
    expect(q("[data-reminder-result]")!.textContent).toContain("1 failed reminder will be retried automatically.");
    expect(q("[data-reminder-result]")!.textContent).not.toMatch(/Graph|GRAPH_|token/i);
  });

  it("shows the controlled error when the run is refused", async () => {
    runResponse = { status: 403, body: { error: "Forbidden", code: "FORBIDDEN" } };
    await click("[data-reminder-run-action]");
    await click("[data-reminder-confirm-action]");
    expect(q("[data-reminder-error]")!.textContent).toBe("Forbidden");
    expect(q("[data-reminder-summary]")).toBeNull();
  });
});
