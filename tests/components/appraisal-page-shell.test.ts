// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import fs from "node:fs";
import path from "node:path";

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

import { AppraisalTabs, type AppraisalData } from "@/components/appraisal/AppraisalTabs";
import { WORKFLOW_STEPS } from "@/components/appraisal/AppraisalWorkflowSteps";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const BLOCKER = "Workplan: 15 objective(s) incomplete";

let container: HTMLDivElement;
let root: Root;

function appraisal(status: string): AppraisalData {
  return {
    id: "a-1",
    employee_id: "emp-1",
    manager_employee_id: "mgr-1",
    cycle_id: "c-1",
    status,
    is_management: false,
    employeeName: "Test Employee",
    cycleName: "FY 2026",
  };
}

async function flush() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function renderTabs(status: string, opts: { employee?: boolean; manager?: boolean; hr?: boolean } = {}) {
  await act(async () => {
    root.render(
      createElement(AppraisalTabs, {
        appraisal: appraisal(status),
        cyclePhase: "",
        currentUserId: "u-1",
        currentUserEmployeeId: opts.employee ? "emp-1" : "someone-else",
        isManager: !!opts.manager,
        isHR: !!opts.hr,
        showLeadership: false,
      }),
    );
  });
  await flush();
}

const tabs = () => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
const tabLabels = () => tabs().map((t) => t.textContent);
const submitButton = () =>
  [...container.querySelectorAll("button")].find((b) => /Submit for Approval|Submitting/.test(b.textContent ?? ""));

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("appraisal tab bar", () => {
  it("keeps the DRAFT tab set and order, as text-only tabs", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ canSubmit: false, blockers: [BLOCKER] }) })));
    await renderTabs("DRAFT", { employee: true });
    expect(tabLabels()).toEqual(["Workplan", "Core Competencies", "Technical", "Productivity", "Summary", "Audit trail"]);
    for (const tab of tabs()) expect(tab.querySelector("svg")).toBeNull();
    expect(container.querySelector('[role="tablist"]')).not.toBeNull();
  });

  it("keeps the status/role-dependent tabs", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ canSubmit: false, blockers: [] }) })));
    await renderTabs("MANAGER_REVIEW", { manager: true });
    expect(tabLabels()).toEqual(["Workplan", "Core Competencies", "Technical", "Productivity", "HR Actions", "Summary", "Sign-offs", "Audit trail"]);

    await renderTabs("IN_PROGRESS", { employee: true });
    expect(tabLabels()).toEqual(["Workplan", "Check-ins"]);
  });

  it("after IN_PROGRESS shows a read-only Check-ins tab only when a formal Mid-Year review exists", async () => {
    const checkIns = (modes: (string | null)[]) =>
      vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () =>
          String(url).endsWith("/checkins") ? { checkIns: modes.map((m, i) => ({ id: `ci-${i}`, review_mode: m })) } : { canSubmit: false, blockers: [] },
      }));

    vi.stubGlobal("fetch", checkIns(["FORMAL_SCORED"]));
    await renderTabs("COMPLETE", { employee: true });
    expect(tabLabels()).toEqual(["Workplan", "Check-ins", "Core Competencies", "Technical", "Productivity", "Summary", "Sign-offs", "Audit trail"]);
    await act(async () => tabs()[1].click());
    expect(container.querySelector('[data-section="checkins"]')).not.toBeNull();

    act(() => root.unmount());
    root = createRoot(container);
    vi.stubGlobal("fetch", checkIns([null, "INFORMAL"]));
    await renderTabs("COMPLETE", { employee: true });
    expect(tabLabels()).not.toContain("Check-ins");
  });

  it("switches tabs and marks the active tab", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ canSubmit: false, blockers: [] }) })));
    await renderTabs("DRAFT", { employee: true });
    expect(tabs()[0].getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector('[data-section="workplan"]')).not.toBeNull();

    await act(async () => tabs()[1].click());
    expect(tabs()[1].getAttribute("aria-selected")).toBe("true");
    expect(tabs()[0].getAttribute("aria-selected")).toBe("false");
    expect(container.querySelector('[data-section="core"]')).not.toBeNull();
    expect(tabs()[1].className).toContain("border-ds-accent");
  });
});

describe("Submit for Approval area", () => {
  it("DRAFT with blockers: disabled, readable, blockers shown", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ canSubmit: false, blockers: [BLOCKER] }) })));
    await renderTabs("DRAFT", { employee: true });
    const btn = submitButton()!;
    expect(btn.disabled).toBe(true);
    expect(btn.className).toContain("text-ds-text-secondary");
    expect(btn.className).not.toContain("bg-ds-accent");
    expect(container.querySelector("#submit-for-approval-blockers")?.textContent).toContain(BLOCKER);
  });

  it("DRAFT and complete: enabled with the near-black primary style", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ canSubmit: true, blockers: [] }) })));
    await renderTabs("DRAFT", { employee: true });
    const btn = submitButton()!;
    expect(btn.disabled).toBe(false);
    expect(btn.className).toContain("bg-ds-accent");
    expect(btn.className).not.toMatch(/blue|linear-gradient/);
  });

  it("is not shown outside DRAFT or to other users", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ canSubmit: true, blockers: [] }) })));
    await renderTabs("DRAFT");
    expect(submitButton()).toBeUndefined();
    await renderTabs("SELF_ASSESSMENT", { employee: true });
    expect(submitButton()).toBeUndefined();
  });
});

describe("Start Final Review", () => {
  const startButton = () => container.querySelector<HTMLButtonElement>("[data-start-final-review]");
  const HELP = "Begin your year-end self-assessment and final appraisal review.";
  let reload: ReturnType<typeof vi.fn>;
  const originalLocation = window.location;

  beforeEach(() => {
    reload = vi.fn();
    Object.defineProperty(window, "location", { configurable: true, value: { ...originalLocation, reload } });
  });
  afterEach(() => {
    Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
  });

  it("the employee sees Start Final Review in IN_PROGRESS, with the year-end help text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ canSubmit: false, blockers: [] }) })));
    await renderTabs("IN_PROGRESS", { employee: true });
    const btn = startButton()!;
    expect(btn.textContent!.trim()).toBe("Start Final Review");
    expect(btn.title).toBe(HELP);
    expect(container.querySelector(`#${btn.getAttribute("aria-describedby")}`)!.textContent).toBe(HELP);
    expect(container.textContent).not.toMatch(/Start self-assessment/i);
  });

  it("clicking it calls the existing start-self-assessment action and reloads into the new stage", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
      String(url).endsWith("/start-self-assessment")
        ? { ok: true, status: 200, json: async () => ({ success: true, status: "SELF_ASSESSMENT", init }) }
        : { ok: true, status: 200, json: async () => ({ canSubmit: false, blockers: [] }) }
    );
    vi.stubGlobal("fetch", fetchMock);
    await renderTabs("IN_PROGRESS", { employee: true });
    await act(async () => startButton()!.click());
    const starts = fetchMock.mock.calls.filter(([url]) => String(url).includes("start-self-assessment"));
    expect(starts).toEqual([["/api/appraisals/a-1/start-self-assessment", { method: "POST" }]]);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("a refused start still shows the server's message and does not reload", async () => {
    const alertMock = vi.fn();
    vi.stubGlobal("alert", alertMock);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        String(url).endsWith("/start-self-assessment")
          ? { ok: false, status: 409, json: async () => ({ error: "Complete the Mid-Year Review before starting self-assessment." }) }
          : { ok: true, status: 200, json: async () => ({ canSubmit: false, blockers: [] }) }
      )
    );
    await renderTabs("IN_PROGRESS", { employee: true });
    await act(async () => startButton()!.click());
    expect(alertMock).toHaveBeenCalledWith("Complete the Mid-Year Review before starting self-assessment.");
    expect(reload).not.toHaveBeenCalled();
  });

  it("is shown only to the employee and only in IN_PROGRESS", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ canSubmit: false, blockers: [] }) })));
    await renderTabs("IN_PROGRESS", { manager: true });
    expect(startButton()).toBeNull();
    await renderTabs("SELF_ASSESSMENT", { employee: true });
    expect(startButton()).toBeNull();
    await renderTabs("DRAFT", { employee: true });
    expect(startButton()).toBeNull();
  });

  it("workflow-transition actions keep the dark primary treatment; Save Assessment is the neutral outline", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ canSubmit: true, blockers: [] }) })));
    const dark = "rgb(13, 14, 16)";
    await renderTabs("IN_PROGRESS", { employee: true });
    expect(startButton()!.style.background).toBe(dark);
    await renderTabs("SELF_ASSESSMENT", { employee: true });
    const submit = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("Submit Self-Assessment"))!;
    expect(submit.style.background).toBe(dark);
    expect(submit.style.color).toBe("white");
    const workplan = read("components/appraisal/WorkplanSection.tsx");
    const saveBlock = workplan.slice(workplan.indexOf("data-save-assessment"), workplan.indexOf("Save Assessment\"}"));
    expect(saveBlock).toContain("className={MIDYEAR_BUTTON.secondary}");
    expect(saveBlock).not.toMatch(/#0d0e10|background:/);
  });

  it("the workflow stage it leads to is still labelled Self Assessment", () => {
    expect(WORKFLOW_STEPS.find((s) => s.status === "SELF_ASSESSMENT")!.label).toBe("Self Assessment");
    expect(read("components/appraisal/AppraisalTabs.tsx")).toContain("/start-self-assessment`, { method: \"POST\" }");
  });
});

describe("appraisal page header source", () => {
  const page = read("app/appraisals/[id]/page.tsx");

  it("keeps every status label and the workflow steps", () => {
    const statusDisplay = read("lib/appraisal-status-display.ts");
    for (const label of ["Draft", "Pending Approval", "In progress", "Self Assessment", "Submitted", "Manager Review", "Pending Sign-off", "HR Review", "Complete"]) {
      expect(statusDisplay).toContain(`label: "${label}"`);
    }
    expect(page).toContain('from "@/lib/appraisal-status-display"');
    expect(page).toContain("statusConfig[appraisal.status] ?? statusConfig.DRAFT");
    expect(page).toContain('appraisal.status === "SUBMITTED" ? "MANAGER_REVIEW" : appraisal.status');
  });

  it("uses design tokens instead of gradients and legacy blues", () => {
    expect(page).not.toMatch(/linear-gradient|#3b82f6|fontFamily: "Sora/);
    expect(page).toContain("text-ds-page-title");
  });

  it("still renders the completion bar and tabs", () => {
    expect(page).toContain("<CompletionBarWrapperClient");
    expect(page).toContain("<AppraisalTabs");
  });
});
