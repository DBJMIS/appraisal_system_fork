// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactNode } from "react";
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
import { AppraisalWorkflowSteps, WORKFLOW_STEPS } from "@/components/appraisal/AppraisalWorkflowSteps";
import { MidyearSubStatus } from "@/components/appraisal/MidyearSubStatus";
import {
  MIDYEAR_REVIEW_UPDATED_EVENT,
  MIDYEAR_SUB_STATUS,
  midyearSubStatusState,
  pickCurrentFormalReview,
  type FormalReviewLike,
} from "@/lib/midyear-display";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

let container: HTMLDivElement;
let root: Root;

async function flush() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function render(node: ReactNode) {
  await act(async () => root.render(node));
  await flush();
}

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

const pill = () => container.querySelector<HTMLElement>("[data-midyear-substatus]");
const pillText = () => (pill()?.textContent ?? "").replace("In progress milestone, formal review: ", "");
const dot = () => pill()!.querySelector<HTMLElement>('[aria-hidden="true"]')!;

function subStatus(review: FormalReviewLike | null, scoringEnabled = false) {
  return createElement(MidyearSubStatus, { appraisalId: "a-1", scoringEnabled, initialReview: review });
}

describe("workflow progress bar", () => {
  const IN_PROGRESS_INDEX = WORKFLOW_STEPS.findIndex((s) => s.status === "IN_PROGRESS");
  const labels = () => [...container.querySelectorAll("ol > li")].map((li) => li.textContent);

  it("keeps the same 8 stages and numbering", () => {
    expect(WORKFLOW_STEPS.map((s) => [s.short, s.label, s.status])).toEqual([
      ["1", "Draft", "DRAFT"],
      ["2", "Approval", "PENDING_APPROVAL"],
      ["3", "In progress", "IN_PROGRESS"],
      ["4", "Self Assessment", "SELF_ASSESSMENT"],
      ["5", "Manager Review", "MANAGER_REVIEW"],
      ["6", "Sign-off", "PENDING_SIGNOFF"],
      ["7", "HR Review", "HR_REVIEW"],
      ["8", "Complete", "COMPLETE"],
    ]);
  });

  it("disabled: renders exactly as before, with no milestone", async () => {
    await render(createElement(AppraisalWorkflowSteps, { currentStepIndex: IN_PROGRESS_INDEX }));
    const ol = container.querySelector("ol")!;
    expect(ol.className).toBe("mb-4 flex w-full items-center gap-2 overflow-x-auto");
    expect(ol.getAttribute("aria-label")).toBe("Appraisal workflow");
    expect(labels()).toEqual(["✓Draft", "✓Approval", "3In progress", "4Self Assessment", "5Manager Review", "6Sign-off", "7HR Review", "8Complete"]);
    expect(container.querySelector("[data-in-progress-milestone]")).toBeNull();
    expect(container.querySelector('[aria-current="step"]')!.className).toBe("flex shrink-0 items-center gap-1.5");
    expect(container.querySelector('[aria-current="step"]')!.textContent).toBe("3In progress");
    for (const li of container.querySelectorAll("ol > li")) {
      expect(li.className).toBe("flex min-w-0 flex-1 items-center gap-2 last:flex-none");
    }
  });

  async function renderEnabled() {
    await render(
      createElement(AppraisalWorkflowSteps, {
        currentStepIndex: IN_PROGRESS_INDEX,
        inProgressMilestone: subStatus(null, true),
      }),
    );
  }

  it("enabled: the milestone sits under In progress without adding or renumbering stages", async () => {
    await renderEnabled();
    const items = [...container.querySelectorAll("ol > li")];
    expect(items).toHaveLength(8);
    const inProgress = items[IN_PROGRESS_INDEX];
    const slot = inProgress.querySelector<HTMLElement>("[data-in-progress-milestone]")!;
    expect(slot).not.toBeNull();
    expect(slot.textContent).toContain("Mid-Year · Scored · Not started");
    expect(container.querySelectorAll("[data-in-progress-milestone]")).toHaveLength(1);
    // The In progress row (node + connector) comes first, the milestone on its own line below it.
    expect(inProgress.className).toBe("flex min-w-0 flex-1 flex-col last:flex-none");
    expect(inProgress.firstElementChild!.className).toBe("flex items-center gap-2");
    expect(inProgress.firstElementChild!.querySelector('[aria-current="step"]')!.textContent).toBe("3In progress");
    expect(inProgress.lastElementChild).toBe(slot);
    items.forEach((li, i) => {
      if (i !== IN_PROGRESS_INDEX) expect(li.className).toBe("flex min-w-0 flex-1 items-center gap-2 last:flex-none");
    });
  });

  it("enabled: adds no scroll, overflow, fixed-height or absolute positioning", async () => {
    await renderEnabled();
    const ol = container.querySelector("ol")!;
    // Only items-center → items-start changes on the row; overflow-x-auto is the row's existing class.
    expect(ol.className).toBe("mb-4 flex w-full items-start gap-2 overflow-x-auto");
    const slot = container.querySelector<HTMLElement>("[data-in-progress-milestone]")!;
    const added = [slot, ...slot.querySelectorAll<HTMLElement>("*"), slot.closest("li")!, slot.closest("li")!.firstElementChild as HTMLElement];
    for (const el of added) {
      expect(el.className).not.toMatch(/overflow|scroll|absolute|fixed|(^|\s)(max-)?h-(?!1\.5)|min-w-\[|(^|\s)w-\[|pb-|truncate/);
    }
    expect(slot.className).toBe("mt-1 block w-max max-w-[16rem]");
  });

  it("the milestone label is compact muted text, not a badge", async () => {
    await render(subStatus(null, true));
    expect(pill()!.className).toBe("inline-flex items-center gap-1.5 text-[11px] leading-4 text-ds-text-muted");
    expect(pill()!.className).not.toMatch(/whitespace-nowrap|border|bg-|px-|py-/);
  });
});

describe("Mid-Year sub-status mapping", () => {
  it("maps each check-in status to one milestone state and tone", () => {
    expect(midyearSubStatusState(null)).toBe("NOT_STARTED");
    expect(midyearSubStatusState({ status: "OPEN" })).toBe("EMPLOYEE_INPUT");
    expect(midyearSubStatusState({ status: "EMPLOYEE_SUBMITTED" })).toBe("MANAGER_REVIEW");
    expect(midyearSubStatusState({ status: "MANAGER_REVIEWED" })).toBe("MANAGER_REVIEW");
    expect(midyearSubStatusState({ status: "COMPLETE" })).toBe("COMPLETE");
    expect(midyearSubStatusState({ status: "CANCELLED" })).toBe("NOT_STARTED");
    expect(Object.fromEntries(Object.entries(MIDYEAR_SUB_STATUS).map(([k, v]) => [k, v.tone]))).toEqual({
      NOT_STARTED: "neutral",
      EMPLOYEE_INPUT: "warning",
      MANAGER_REVIEW: "progress",
      COMPLETE: "success",
    });
  });

  it("prefers the live formal review over cancelled ones and ignores informal check-ins", () => {
    const rows = [
      { status: "OPEN", review_mode: "INFORMAL" },
      { status: "CANCELLED", review_mode: "FORMAL" },
      { status: "EMPLOYEE_SUBMITTED", review_mode: "FORMAL_SCORED" },
    ];
    expect(pickCurrentFormalReview(rows)).toBe(rows[2]);
    expect(pickCurrentFormalReview([rows[0], rows[1]])).toBe(rows[1]);
    expect(pickCurrentFormalReview([rows[0]])).toBeNull();
  });

  it("no formal review: Not started (neutral)", async () => {
    await render(subStatus(null));
    expect(pillText()).toBe("Mid-Year · Not started");
    expect(pill()!.dataset.midyearSubstatusState).toBe("NOT_STARTED");
    expect(dot().className).toContain("bg-ds-text-muted");
  });

  it("OPEN: Employee input (amber)", async () => {
    await render(subStatus({ status: "OPEN", review_mode: "FORMAL" }));
    expect(pillText()).toBe("Mid-Year · Employee input");
    expect(dot().className).toContain("bg-ds-amber");
  });

  it("EMPLOYEE_SUBMITTED: Manager review (lavender)", async () => {
    await render(subStatus({ status: "EMPLOYEE_SUBMITTED", review_mode: "FORMAL" }));
    expect(pillText()).toBe("Mid-Year · Manager review");
    expect(dot().className).toContain("bg-ds-lavender");
  });

  it("COMPLETE unscored: Complete (mint) and no score request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await render(subStatus({ status: "COMPLETE", review_mode: "FORMAL" }));
    expect(pillText()).toBe("Mid-Year · Complete");
    expect(dot().className).toContain("bg-ds-mint");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("COMPLETE scored: appends the stored MIDYEAR score", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ midyear: { total: 76.44, grade: "B" }, final: null }) }));
    vi.stubGlobal("fetch", fetchMock);
    await render(subStatus({ status: "COMPLETE", review_mode: "FORMAL_SCORED" }, true));
    expect(fetchMock).toHaveBeenCalledWith("/api/appraisals/a-1/score-snapshots");
    expect(pillText()).toBe("Mid-Year · Scored · Complete · 76.4");
  });

  it("COMPLETE scored without a stored snapshot: no score is shown", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ midyear: null, final: null }) })));
    await render(subStatus({ status: "COMPLETE", review_mode: "FORMAL_SCORED" }, true));
    expect(pillText()).toBe("Mid-Year · Scored · Complete");
  });

  it("scoring off: no Scored label", async () => {
    await render(subStatus(null, false));
    expect(pillText()).not.toContain("Scored");
    act(() => root.unmount());
    root = createRoot(container);
    await render(subStatus({ status: "OPEN", review_mode: "FORMAL" }, true));
    expect(pillText()).not.toContain("Scored");
  });

  it("scoring on: Scored label", async () => {
    await render(subStatus(null, true));
    expect(pillText()).toBe("Mid-Year · Scored · Not started");
    act(() => root.unmount());
    root = createRoot(container);
    await render(subStatus({ status: "EMPLOYEE_SUBMITTED", review_mode: "FORMAL_SCORED" }, false));
    expect(pillText()).toBe("Mid-Year · Scored · Manager review");
  });

  it("follows the check-ins tab without a page refresh", async () => {
    await render(subStatus(null));
    expect(pill()!.dataset.midyearSubstatusState).toBe("NOT_STARTED");
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(MIDYEAR_REVIEW_UPDATED_EVENT, { detail: { appraisalId: "other", review: { status: "COMPLETE", review_mode: "FORMAL" } } }),
      );
    });
    expect(pill()!.dataset.midyearSubstatusState).toBe("NOT_STARTED");
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(MIDYEAR_REVIEW_UPDATED_EVENT, { detail: { appraisalId: "a-1", review: { status: "OPEN", review_mode: "FORMAL" } } }),
      );
    });
    expect(pillText()).toBe("Mid-Year · Employee input");
  });
});

describe("Check-ins tab label", () => {
  const appraisal = (status: string): AppraisalData => ({
    id: "a-1",
    employee_id: "emp-1",
    manager_employee_id: "mgr-1",
    cycle_id: "c-1",
    status,
    is_management: false,
    employeeName: "Test Employee",
    cycleName: "FY 2026",
  });
  const tabLabels = () => [...container.querySelectorAll('[role="tab"]')].map((t) => t.textContent);

  async function renderTabs(status: string, midyearEnabled?: boolean) {
    await render(
      createElement(AppraisalTabs, {
        appraisal: appraisal(status),
        cyclePhase: "",
        currentUserId: "u-1",
        currentUserEmployeeId: "emp-1",
        isManager: false,
        isHR: false,
        showLeadership: false,
        ...(midyearEnabled === undefined ? {} : { midyearEnabled }),
      }),
    );
  }

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () =>
          String(url).endsWith("/checkins") ? { checkIns: [{ id: "ci-1", review_mode: "FORMAL" }] } : { canSubmit: false, blockers: [] },
      })),
    );
  });

  it("Mid-Year disabled: Check-ins", async () => {
    await renderTabs("IN_PROGRESS");
    expect(tabLabels()).toEqual(["Workplan", "Check-ins"]);
    act(() => root.unmount());
    root = createRoot(container);
    await renderTabs("IN_PROGRESS", false);
    expect(tabLabels()).toEqual(["Workplan", "Check-ins"]);
  });

  it("Mid-Year enabled: Reviews & Check-ins, same tab and position", async () => {
    await renderTabs("IN_PROGRESS", true);
    expect(tabLabels()).toEqual(["Workplan", "Reviews & Check-ins"]);
    await act(async () => (container.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1]).click());
    expect(container.querySelector('[data-section="checkins"]')).not.toBeNull();

    act(() => root.unmount());
    root = createRoot(container);
    await renderTabs("COMPLETE", true);
    expect(tabLabels()).toEqual(["Workplan", "Reviews & Check-ins", "Core Competencies", "Technical", "Productivity", "Summary", "Sign-offs", "Audit trail"]);
  });
});

describe("wiring", () => {
  it("the page shows the milestone only when Mid-Year is enabled and reuses stored data", () => {
    const page = read("app/appraisals/[id]/page.tsx");
    expect(page).toContain("<AppraisalWorkflowSteps");
    expect(page).toContain("currentStepIndex={safeStepIndex}");
    expect(page).toMatch(/appraisal\.midyear\.enabled \? \(\s*<MidyearSubStatus/);
    expect(page).toContain("midyearEnabled={appraisal.midyear.enabled}");
    expect(page).toContain("midyearConfigFromRow(");
    expect(page).not.toContain("const WORKFLOW_STEPS");
  });

  it("the check-ins tab publishes the current formal review after each load", () => {
    const tab = read("components/appraisal/checkins/CheckInTab.tsx");
    expect(tab).toMatch(/if \(json\.midyear\?\.enabled[\s\S]*pickCurrentFormalReview\(\(json\.checkIns[\s\S]*MIDYEAR_REVIEW_UPDATED_EVENT/);
  });
});
