// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { stub } = vi.hoisted(() => ({
  stub: (name: string) => () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createElement: h } = require("react") as typeof import("react");
    return h("div", { "data-section": name });
  },
}));
vi.mock("@/components/appraisal/WorkplanSection", () => ({ WorkplanSection: stub("workplan") }));
vi.mock("@/components/appraisal/EvidenceBuilder", () => ({ EvidenceBuilder: stub("evidence") }));
vi.mock("@/components/appraisal/CoreCompetenciesSection", () => ({ CoreCompetenciesSection: stub("core") }));
vi.mock("@/components/appraisal/TechnicalCompetenciesSection", () => ({ TechnicalCompetenciesSection: stub("technical") }));
vi.mock("@/components/appraisal/ProductivitySection", () => ({ ProductivitySection: stub("productivity") }));
vi.mock("@/components/appraisal/LeadershipSection", () => ({ LeadershipSection: stub("leadership") }));
vi.mock("@/components/appraisal/SummaryTab", () => ({ SummaryTab: stub("summary") }));
vi.mock("@/components/appraisal/SignoffsTab", () => ({ SignoffsTab: stub("signoffs") }));
vi.mock("@/components/appraisal/HRActionsTab", () => ({ HRActionsTab: stub("hractions") }));
vi.mock("@/components/appraisal/AuditTrailTab", () => ({ AuditTrailTab: stub("audit") }));
vi.mock("@/components/appraisal/checkins/CheckInTab", () => ({ CheckInTab: stub("checkins") }));
vi.mock("@/components/appraisal/DelegationTab", () => ({ DelegationTab: stub("delegation") }));

import { AppraisalTabs } from "@/components/appraisal/AppraisalTabs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function flush() {
  for (let i = 0; i < 10; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

async function renderPending(opts: { employee?: boolean; manager?: boolean; approvals?: { role: string }[] }) {
  await act(async () => {
    root.render(
      createElement(AppraisalTabs, {
        appraisal: {
          id: "a-1",
          employee_id: "emp-1",
          manager_employee_id: "mgr-1",
          cycle_id: "c-1",
          status: "PENDING_APPROVAL",
          is_management: false,
          employeeName: "Test Employee",
          cycleName: "FY 2026",
        },
        cyclePhase: "",
        currentUserId: "u-1",
        currentUserEmployeeId: opts.employee ? "emp-1" : "someone-else",
        isManager: !!opts.manager,
        isHR: false,
        showLeadership: false,
        approvals: opts.approvals ?? [],
      })
    );
  });
  await flush();
}

const panel = () => container.querySelector<HTMLElement>('[data-approval-panel="approval"]')!;
const actions = () => panel().querySelector<HTMLElement>("[data-approval-actions]")!;
const buttons = () => [...panel().querySelectorAll("button")];
const buttonNamed = (label: string) => buttons().find((b) => b.textContent === label);
const badge = (label: string) => panel().querySelector<HTMLElement>(`[data-approval-badge="${label}"]`)!;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Workplan Approval panel", () => {
  it("uses a neutral panel with near-black title and muted supporting text", async () => {
    await renderPending({ employee: true });
    const el = panel();
    expect(el.textContent).toContain("Awaiting Workplan Approval");
    expect(el.className).toContain("bg-ds-background");
    expect(el.className).toContain("border-ds-border");
    expect(el.className).not.toMatch(/warning|amber/);
    expect(el.getAttribute("style")).toBeNull();
    expect(el.querySelector(".text-ds-text-primary")?.textContent).toBe("Awaiting Workplan Approval");
    expect(el.querySelector(".text-ds-text-secondary")?.textContent).toContain("both must approve to proceed");
  });

  it("bypass off: the employee sees one Approve Workplan button with the primary CTA style", async () => {
    await renderPending({ employee: true });
    expect(buttonNamed("Approve Workplan")).toBeDefined();
    expect(buttonNamed("Approve as Employee")).toBeUndefined();
    expect(buttonNamed("Approve as Manager")).toBeUndefined();
    const approve = buttonNamed("Approve Workplan")!;
    expect(approve.className).toContain("bg-ds-accent");
    expect(approve.className).toContain("rounded-ds-button");
    expect(approve.className).toContain("focus-visible:ring-ds-focus");
  });

  it("bypass off: the approve button disappears once the current role has approved", async () => {
    await renderPending({ employee: true, approvals: [{ role: "EMPLOYEE" }] });
    expect(buttonNamed("Approve Workplan")).toBeUndefined();
  });

  it("bypass off: sends the current role when approving", async () => {
    await renderPending({ manager: true });
    const fetchMock = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: "x" }) }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "alert").mockImplementation(() => {});
    await act(async () => buttonNamed("Approve Workplan")!.click());
    await flush();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/appraisals/a-1/approve");
    expect(JSON.parse(String(init.body))).toEqual({ role: "MANAGER" });
  });

  it("bypass on: shows both test approve buttons with the same styling and existing order rules", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_ALLOW_APPRAISAL_TEST_BYPASS", "true");
    await renderPending({ employee: true });
    const asEmployee = buttonNamed("Approve as Employee")!;
    const asManager = buttonNamed("Approve as Manager")!;
    expect(asEmployee).toBeDefined();
    expect(asManager).toBeDefined();
    expect(buttonNamed("Approve Workplan")).toBeUndefined();
    expect(asEmployee.disabled).toBe(false);
    expect(asEmployee.className).toContain("bg-ds-accent");
    expect(asManager.disabled).toBe(true);
    expect(asManager.className).toContain("cursor-not-allowed");
  });

  it("approved pills use the success tone and pending pills the warning tone", async () => {
    await renderPending({ employee: true, approvals: [{ role: "EMPLOYEE" }] });
    const employee = badge("Employee");
    const manager = badge("Manager");
    expect(employee.dataset.tone).toBe("success");
    expect(employee.className).toContain("bg-ds-success-subtle");
    expect(employee.textContent).toBe("✓ Employee");
    expect(manager.dataset.tone).toBe("warning");
    expect(manager.className).toContain("bg-ds-warning-subtle");
    expect(manager.textContent).toBe("○ Manager");
    expect(manager.className).not.toMatch(/error|coral/);
  });

  it("Request Changes is present as a neutral outline action and opens the dialog", async () => {
    await renderPending({ employee: true });
    const requestChanges = buttonNamed("Request Changes")!;
    expect(requestChanges).toBeDefined();
    expect(requestChanges.className).toContain("border-ds-border-strong");
    expect(requestChanges.className).not.toMatch(/error|coral/);
    expect(requestChanges.getAttribute("style")).toBeNull();
    await act(async () => requestChanges.click());
    expect(document.body.textContent).toContain("Provide a reason for requesting revision.");
  });

  it("the right-side action group wraps on narrow screens", async () => {
    await renderPending({ employee: true });
    expect(actions().className).toContain("flex-wrap");
    expect(panel().className).toContain("flex-wrap");
  });

  it("groups status pills and action buttons separately, with wider spacing between the groups", async () => {
    await renderPending({ employee: true });
    const status = actions().querySelector<HTMLElement>("[data-approval-status-group]")!;
    const buttonsGroup = actions().querySelector<HTMLElement>("[data-approval-button-group]")!;
    expect([...status.querySelectorAll<HTMLElement>("[data-approval-badge]")].map((b) => b.dataset.approvalBadge)).toEqual(["Employee", "Manager"]);
    expect([...buttonsGroup.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Approve Workplan", "Request Changes"]);
    expect(status.className).toContain("gap-2");
    expect(buttonsGroup.className).toContain("gap-2");
    expect(buttonsGroup.className).toContain("flex-wrap");
    expect(actions().className).toContain("gap-x-4");
  });
});
