// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { NotificationActivityPanel } from "@/components/admin/NotificationActivityPanel";
import { OutstandingActionsPanel, escalationTargetLabel } from "@/components/admin/OutstandingActionsPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let detailBody: Record<string, unknown>;
let retryResponse: { status: number; body: unknown };

const jsonResponse = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

const ITEM = {
  activityAt: "2026-10-31T13:00:01.000Z",
  recipientEmail: null,
  dueDateLabel: "30 Oct 2026",
  attemptCount: 1,
};

const LIST = {
  items: [
    { ...ITEM, id: "d-failed", employeeName: "Jane Employee", kindLabel: "Mid-Year Review overdue", recipientRole: "employee", recipientName: "Jane Employee", status: "FAILED", statusLabel: "Failed", statusTone: "error", errorCode: "GRAPH_503", reason: "Mail service unavailable" },
    { ...ITEM, id: "d-sent", employeeName: "Ann Analyst", kindLabel: "Mid-Year manager review pending", recipientRole: "manager", recipientName: "Mark Manager", recipientEmail: "mark@example.test", status: "SENT", statusLabel: "Sent", statusTone: "success", errorCode: null, reason: null },
    { ...ITEM, id: "d-skip", employeeName: "Cal Complete", kindLabel: "Mid-Year Review due soon", recipientRole: "employee", recipientName: "Cal Complete", status: "SKIPPED", statusLabel: "Skipped", statusTone: "muted", errorCode: "NO_LONGER_REQUIRED", reason: "Action already completed", attemptCount: 0 },
  ],
  total: 30,
  page: 1,
  pageSize: 25,
  metrics: { sent: 20, failed: 5, pending: 3, sending: 0, skipped: 2, successRate: 0.8 },
  cycles: [
    { id: "c-1", name: "FY 2026", status: "open" },
    { id: "c-old", name: "FY 2025", status: "closed" },
  ],
  cycleId: "c-1",
  reminderKinds: [{ kind: "MIDYEAR_OVERDUE", label: "Mid-Year Review overdue" }],
};

const DETAIL = {
  id: "d-failed",
  appraisal: { id: "a-1", employeeName: "Jane Employee", cycleName: "FY 2026", statusLabel: "In progress" },
  kind: "MIDYEAR_OVERDUE",
  kindLabel: "Mid-Year Review overdue",
  recipientRole: "employee",
  recipientName: "Jane Employee",
  recipientEmail: "jane@example.test",
  recipientEmailSource: "current",
  scheduledFor: "2026-10-31",
  dueDate: "2026-10-30",
  timing: "1 day overdue",
  status: "FAILED",
  statusLabel: "Failed",
  statusTone: "error",
  attemptCount: 1,
  maxAttempts: 3,
  firstAttemptAt: "2026-10-31T13:00:00.000Z",
  firstAttemptRecorded: true,
  lastAttemptAt: "2026-10-31T13:00:00.000Z",
  sentAt: null,
  nextRetryAt: null,
  errorCode: "GRAPH_503",
  reason: "Mail service unavailable",
  createdAt: "2026-10-31T13:00:00.000Z",
  stillRequired: true,
  currentStateReason: null,
  retry: { allowed: true, blockCode: null, message: null },
};

const PREVIEW = {
  subject: "Mid-Year Review overdue",
  html: "<p>Preview body</p>",
  text: "Preview body",
  notice: "Preview reflects the appraisal's current state.",
  stateChanged: true,
  stateChangeReason: "Action already completed",
  warnings: [],
};

const OUTSTANDING = {
  items: [
    {
      appraisalId: "a-1",
      employeeName: "Jane Employee",
      reviewStage: "Mid-Year Review",
      requiredAction: "Submit Mid-Year Review",
      responsibleRole: "employee",
      responsibleName: "Jane Employee",
      dueDate: "2026-10-30",
      dueDateLabel: "30 Oct 2026",
      daysOverdue: 11,
      lastReminderSentAt: "2026-10-31T13:00:00.000Z",
      escalationCandidate: true,
      escalationKey: "ESCALATION:MIDYEAR_EMPLOYEE:2026-10-30",
      escalationTarget: { type: "DIRECT_MANAGER", employeeId: "mgr-1", name: "Mark Manager", basis: "Appraisal manager" },
    },
    {
      appraisalId: "a-2",
      employeeName: "Ann Analyst",
      reviewStage: "Mid-Year Review",
      requiredAction: "Complete Mid-Year manager review",
      responsibleRole: "manager",
      responsibleName: "Mark Manager",
      dueDate: "2026-10-30",
      dueDateLabel: "30 Oct 2026",
      daysOverdue: 3,
      lastReminderSentAt: null,
      escalationCandidate: false,
      escalationKey: "ESCALATION:MIDYEAR_MANAGER:2026-10-30",
      escalationTarget: null,
    },
  ],
  total: 2,
  page: 1,
  pageSize: 25,
  summary: { overdue: 2, employeeActions: 1, managerActions: 1, escalationCandidates: 1 },
  escalationDaysOverdue: 7,
  warnings: [],
  cycles: [{ id: "c-1", name: "FY 2026", status: "open" }],
  cycleId: "c-1",
};

async function flush() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));

async function click(sel: string) {
  await act(async () => {
    q<HTMLElement>(sel)!.click();
  });
  await flush();
}

async function change(sel: string, value: string) {
  const el = q<HTMLSelectElement | HTMLInputElement>(sel)!;
  await act(async () => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
  await flush();
}

async function render(component: () => ReturnType<typeof createElement>) {
  act(() => {
    root.render(component());
  });
  await flush();
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  detailBody = DETAIL;
  retryResponse = { status: 200, body: { deliveryId: "d-failed", previousStatus: "FAILED", status: "SENT", statusLabel: "Sent", attemptCount: 2, outcome: "SENT", reason: null } };
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/admin/reminder-deliveries?")) return jsonResponse(LIST);
    if (url.endsWith("/preview")) return jsonResponse(PREVIEW);
    if (url.endsWith("/retry") && init?.method === "POST") return jsonResponse(retryResponse.body, retryResponse.status);
    if (url.startsWith("/api/admin/reminder-deliveries/")) return jsonResponse(detailBody);
    if (url.startsWith("/api/admin/outstanding-appraisal-actions")) return jsonResponse(OUTSTANDING);
    return jsonResponse({ error: "unexpected" }, 500);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("NotificationActivityPanel", () => {
  it("loads the current cycle by default and shows metrics, badges and sanitised reasons", async () => {
    await render(() => createElement(NotificationActivityPanel));
    expect(urls()[0]).toBe("/api/admin/reminder-deliveries?page=1");
    expect(q<HTMLSelectElement>("[data-filter=cycle]")!.value).toBe("c-1");

    const metrics = [...document.querySelectorAll("[data-delivery-metric]")].map((m) => m.textContent);
    expect(metrics).toEqual(["Sent20", "Failed5", "Pending3", "Skipped2", "Success rate80%"]);

    const rows = [...document.querySelectorAll("[data-delivery-row]")].map((r) => [...r.querySelectorAll("td")].map((td) => td.textContent));
    expect(rows[0].slice(1)).toEqual(["Jane Employee", "Mid-Year Review overdue", "Employee", "Jane Employee", "30 Oct 2026", "Failed", "1", "Mail service unavailable"]);
    expect(rows[1].slice(6)).toEqual(["Sent", "1", "—"]);
    expect(rows[2].slice(6)).toEqual(["Skipped", "0", "Action already completed"]);
    expect([...document.querySelectorAll("[data-delivery-status]")].map((b) => b.className)).toEqual([
      expect.stringContaining("text-ds-error"),
      expect.stringContaining("text-ds-success"),
      expect.stringContaining("text-ds-text-secondary"),
    ]);
    expect(q("[data-delivery-range]")!.textContent).toBe("Showing 1–25 of 30");
  });

  it("sends filters and paging to the server", async () => {
    await render(() => createElement(NotificationActivityPanel));
    await change("[data-filter=status]", "FAILED");
    expect(urls().at(-1)).toBe("/api/admin/reminder-deliveries?status=FAILED&page=1");
    await change("[data-filter=cycle]", "all");
    expect(urls().at(-1)).toBe("/api/admin/reminder-deliveries?cycleId=all&status=FAILED&page=1");
    await change("[data-filter=role]", "manager");
    await change("[data-filter=from]", "2026-10-01");
    expect(urls().at(-1)).toBe("/api/admin/reminder-deliveries?cycleId=all&status=FAILED&role=manager&from=2026-10-01&page=1");
    await click("[data-delivery-next]");
    expect(urls().at(-1)).toContain("page=2");
  });

  it("opens the detail drawer with sanitised fields, preview notice and state-change flag", async () => {
    await render(() => createElement(NotificationActivityPanel));
    await click("[data-delivery-row=d-failed]");
    expect(urls()).toContain("/api/admin/reminder-deliveries/d-failed");
    const fields = q("[data-delivery-fields]")!.textContent!;
    expect(fields).toContain("jane@example.test");
    expect(fields).toContain("1 of 3");
    expect(fields).toContain("Mail service unavailable");
    expect(fields).toContain("GRAPH_503");

    await click("[data-delivery-preview-action]");
    expect(q("[data-delivery-preview-notice]")!.textContent).toBe("Preview reflects the appraisal's current state.");
    expect(q("[data-delivery-preview-changed]")!.textContent).toContain("Action already completed");
    const frame = q<HTMLIFrameElement>("[data-delivery-preview] iframe")!;
    expect(frame.getAttribute("sandbox")).toBe("");
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "POST")).toBe(false);
  });

  it("asks for confirmation, retries, shows the result and refreshes the list", async () => {
    await render(() => createElement(NotificationActivityPanel));
    await click("[data-delivery-row=d-failed]");
    const listCalls = () => urls().filter((u) => u.startsWith("/api/admin/reminder-deliveries?")).length;
    const before = listCalls();
    await click("[data-delivery-retry-action]");
    expect(q("[data-delivery-retry-confirm]")).not.toBeNull();
    await click("[data-delivery-retry-confirm-action]");
    const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST")!;
    expect(post[0]).toBe("/api/admin/reminder-deliveries/d-failed/retry");
    expect(q("[data-delivery-retry-result]")!.textContent).toBe("Reminder sent.");
    expect(listCalls()).toBeGreaterThan(before);
  });

  it("disables retry and explains why when it is not allowed", async () => {
    detailBody = { ...DETAIL, attemptCount: 3, retry: { allowed: false, blockCode: "MAX_ATTEMPTS", message: "The maximum of 3 attempts has been reached." } };
    await render(() => createElement(NotificationActivityPanel));
    await click("[data-delivery-row=d-failed]");
    expect(q<HTMLButtonElement>("[data-delivery-retry-action]")!.disabled).toBe(true);
    expect(q("[data-delivery-retry-blocked]")!.textContent).toBe("The maximum of 3 attempts has been reached.");
  });

  it("does not offer retry for sent reminders", async () => {
    detailBody = { ...DETAIL, status: "SENT", statusLabel: "Sent", statusTone: "success", errorCode: null, reason: null, retry: { allowed: false, blockCode: "ALREADY_SENT", message: "x" } };
    await render(() => createElement(NotificationActivityPanel));
    await click("[data-delivery-row=d-failed]");
    expect(q("[data-delivery-retry-action]")).toBeNull();
    expect(q("[data-delivery-preview-action]")).not.toBeNull();
  });

  it("shows the server's refusal message when a retry is rejected", async () => {
    retryResponse = { status: 409, body: { error: "This reminder has already been sent.", code: "ALREADY_SENT" } };
    await render(() => createElement(NotificationActivityPanel));
    await click("[data-delivery-row=d-failed]");
    await click("[data-delivery-retry-action]");
    await click("[data-delivery-retry-confirm-action]");
    expect(q("[data-delivery-retry-result]")!.textContent).toBe("This reminder has already been sent.");
  });
});

describe("OutstandingActionsPanel", () => {
  it("lists overdue actions with escalation candidates and the suggested follow-up", async () => {
    await render(() => createElement(OutstandingActionsPanel));
    expect(urls()[0]).toBe("/api/admin/outstanding-appraisal-actions?page=1");
    expect(q("[data-outstanding-summary]")!.textContent).toBe("2 overdue actions · 1 employee · 1 manager · 1 escalation candidate");
    expect(q("[data-escalation-rule]")!.textContent).toContain("7 days or more overdue");
    const rows = [...document.querySelectorAll("[data-outstanding-row]")].map((r) => [...r.querySelectorAll("td")].map((td) => td.textContent));
    expect(rows[0].slice(0, 6)).toEqual(["Jane Employee", "Mid-Year Review", "Submit Mid-Year Review", "EmployeeJane Employee", "30 Oct 2026", "11"]);
    expect(rows[0][7]).toBe("Escalation candidateSuggested: Mark Manager (Manager)");
    expect(rows[1][6]).toBe("None sent");
    expect(rows[1][7]).toBe("—");
  });

  it("filters to escalation candidates on the server", async () => {
    await render(() => createElement(OutstandingActionsPanel));
    await click("[data-outstanding-filter=candidates]");
    expect(urls().at(-1)).toBe("/api/admin/outstanding-appraisal-actions?candidatesOnly=1&page=1");
  });

  it("labels escalation targets", () => {
    expect(escalationTargetLabel({ type: "HR", employeeId: null, name: null, basis: "x" })).toBe("HR follow-up");
    expect(escalationTargetLabel({ type: "SECOND_LEVEL_MANAGER", employeeId: "d", name: "Dana Director", basis: "x" })).toBe("Dana Director (Manager's manager)");
  });
});
