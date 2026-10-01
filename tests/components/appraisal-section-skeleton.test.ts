// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import fs from "node:fs";
import path from "node:path";
import { factorRatingsResponse } from "../helpers/factor-fixtures";

const mocks = vi.hoisted(() => ({ browserCreateClient: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ createClient: mocks.browserCreateClient }));

import { AppraisalSectionSkeleton, type AppraisalSectionSkeletonVariant } from "@/components/appraisal/AppraisalSectionSkeleton";
import { WorkplanSection } from "@/components/appraisal/WorkplanSection";
import { CoreCompetenciesSection } from "@/components/appraisal/CoreCompetenciesSection";
import { ProductivitySection } from "@/components/appraisal/ProductivitySection";
import { LeadershipSection } from "@/components/appraisal/LeadershipSection";
import { TechnicalCompetenciesSection } from "@/components/appraisal/TechnicalCompetenciesSection";
import { SummaryTab } from "@/components/appraisal/SummaryTab";
import { CheckInTab } from "@/components/appraisal/checkins/CheckInTab";
import { TooltipProvider } from "@/components/ui/tooltip";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

type FakeResponse = { ok: boolean; status: number; json: () => Promise<unknown> };
const jsonResponse = (body: unknown, status = 200): FakeResponse => ({ ok: status >= 200 && status < 300, status, json: async () => body });

/** fetch whose responses are held until `release()`; `pending` requests never resolve. */
function gatedFetch(respond: (url: string) => FakeResponse | "pending") {
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  const fetchMock = vi.fn(async (url: string) => {
    await gate;
    const res = respond(String(url));
    return res === "pending" ? new Promise<never>(() => {}) : res;
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    fetchMock,
    release: async () => {
      open();
      await flush();
    },
  };
}

async function flush() {
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function render(element: ReturnType<typeof createElement>) {
  await act(async () => {
    root.render(element);
  });
}

const skeleton = () => container.querySelector<HTMLElement>("[data-section-skeleton]");
const skeletonRows = () => container.querySelectorAll("[data-section-skeleton] [data-skeleton-row]");

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const query: Record<string, unknown> = {};
  Object.assign(query, {
    select: () => query,
    eq: () => query,
    in: async () => ({ data: [] }),
    single: async () => ({ data: null }),
  });
  mocks.browserCreateClient.mockReturnValue({ from: () => query });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("AppraisalSectionSkeleton", () => {
  const VARIANTS: AppraisalSectionSkeletonVariant[] = ["workplan", "competency", "summary", "checkins"];

  it.each(VARIANTS)("%s: a busy status region that announces only its label", async (variant) => {
    await render(createElement(AppraisalSectionSkeleton, { variant, label: "Loading things…" }));
    const region = skeleton()!;
    expect(region.getAttribute("data-section-skeleton")).toBe(variant);
    expect(region.getAttribute("role")).toBe("status");
    expect(region.getAttribute("aria-busy")).toBe("true");
    expect(region.getAttribute("aria-live")).toBe("polite");

    const label = region.querySelector(".sr-only")!;
    expect(label.textContent).toBe("Loading things…");
    expect(label.closest("[aria-hidden]")).toBeNull();

    const blocks = [...region.querySelectorAll("[data-skeleton-block]")];
    expect(blocks.length).toBeGreaterThan(10);
    for (const block of blocks) {
      expect(block.closest('[aria-hidden="true"]')).not.toBeNull();
      expect(block.textContent).toBe("");
    }
  });

  it.each(VARIANTS)("%s: light neutral blocks, subtle pulse only when motion is allowed, no gradients", async (variant) => {
    await render(createElement(AppraisalSectionSkeleton, { variant, label: "Loading…" }));
    for (const block of container.querySelectorAll("[data-skeleton-block]")) {
      const classes = block.className.split(/\s+/);
      expect(classes).toContain("bg-ds-surface-hover");
      expect(classes).toContain("motion-safe:animate-pulse");
      expect(classes).not.toContain("animate-pulse");
      expect(block.className).not.toMatch(/gradient|shimmer|shadow/);
      expect(block.className).toMatch(/rounded-ds-(control|panel)/);
    }
  });

  it("workplan: header, table header and 5 objective rows by default, each with the five grid columns", async () => {
    await render(createElement(AppraisalSectionSkeleton, { variant: "workplan", label: "Loading workplan…" }));
    expect(skeletonRows()).toHaveLength(5);
    for (const row of skeletonRows()) expect(row.children).toHaveLength(5);
    const objectiveWidths = [...skeletonRows()].map((row) => row.querySelector("[data-skeleton-block]")!.className.match(/w-\[\d+%\]/)![0]);
    expect(new Set(objectiveWidths).size).toBeGreaterThan(3);
  });

  it("row count can be set", async () => {
    await render(createElement(AppraisalSectionSkeleton, { variant: "competency", label: "Loading…", rows: 4 }));
    expect(skeletonRows()).toHaveLength(4);
  });

  it("competency: mirrors the grid's six columns with control-height rating placeholders", async () => {
    await render(createElement(AppraisalSectionSkeleton, { variant: "competency", label: "Loading core competencies…" }));
    expect(skeletonRows()).toHaveLength(6);
    for (const row of skeletonRows()) {
      expect(row.children).toHaveLength(6);
      expect(row.querySelectorAll(".h-8")).toHaveLength(3);
    }
  });

  it("uses the shared reduced-motion rule and is not a full-page loader", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "components/appraisal/AppraisalSectionSkeleton.tsx"), "utf8");
    expect(src).not.toMatch(/min-h-screen|h-screen|fixed inset/);
    const css = fs.readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
  });
});

describe("Workplan tab loading", () => {
  const WORKPLAN = {
    workplan: { id: "wp-1", status: "approved", locked_at: "2026-04-01T00:00:00Z", submitted_at: null, rejection_reason: null },
    items: [
      {
        id: "i-1",
        workplan_id: "wp-1",
        corporate_objective: "Objective one",
        major_task: "Task one",
        key_output: "Output one",
        performance_standard: "Standard one",
        weight: 100,
        metric_type: "PERCENT",
        metric_target: 100,
        actual_result: 40,
      },
    ],
  };

  const renderWorkplan = () =>
    render(
      createElement(
        TooltipProvider,
        null,
        createElement(WorkplanSection, {
          appraisalId: "a-1",
          appraisalStatus: "IN_PROGRESS",
          cyclePhase: "ASSESSMENT",
          isEmployee: true,
          isManager: false,
          isHR: false,
        })
      )
    );

  it("shows the workplan skeleton immediately, then replaces it with the workplan", async () => {
    const { release } = gatedFetch((url) => {
      if (url.endsWith("/api/appraisals/a-1/workplan")) return jsonResponse(WORKPLAN);
      if (url.endsWith("/api/appraisals/a-1/objectives")) return jsonResponse([]);
      return jsonResponse({}, 404);
    });
    await renderWorkplan();
    expect(skeleton()?.getAttribute("data-section-skeleton")).toBe("workplan");
    expect(skeleton()?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector("table")).toBeNull();

    await release();
    expect(skeleton()).toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(container.querySelector("tbody")?.textContent).toContain("Task one");
  });

  it("still shows the existing error message when the workplan fails to load", async () => {
    const { release } = gatedFetch((url) =>
      url.endsWith("/api/appraisals/a-1/workplan") ? jsonResponse({ error: "Workplan unavailable" }, 500) : jsonResponse({}, 404)
    );
    await renderWorkplan();
    expect(skeleton()).not.toBeNull();
    await release();
    expect(skeleton()).toBeNull();
    expect(container.textContent).toContain("Workplan unavailable");
  });
});

describe("competency tabs loading", () => {
  it("Core Competencies: competency skeleton, then the grid", async () => {
    const { release } = gatedFetch(() => jsonResponse(factorRatingsResponse()));
    await render(createElement(CoreCompetenciesSection, { appraisalId: "a-1", canEditSelfRatings: true, canEditManagerRatings: false }));
    expect(skeleton()?.getAttribute("data-section-skeleton")).toBe("competency");
    expect(skeleton()?.textContent).toBe("Loading core competencies…");

    await release();
    expect(skeleton()).toBeNull();
    expect(container.querySelector("[data-competency-grid]")).not.toBeNull();
  });

  it("Core Competencies: the existing error alert still renders when loading fails", async () => {
    const { release } = gatedFetch(() => ({ ok: true, status: 200, json: async () => Promise.reject(new Error("Network down")) }));
    await render(createElement(CoreCompetenciesSection, { appraisalId: "a-1", canEditSelfRatings: true, canEditManagerRatings: false }));
    await release();
    expect(skeleton()).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Network down");
  });

  const OTHERS: [string, ComponentType<Record<string, unknown>>, Record<string, unknown>, string][] = [
    ["Productivity", ProductivitySection as never, { canEditSelfRatings: true, canEditManagerRatings: false }, "Loading productivity assessment…"],
    ["Leadership", LeadershipSection as never, { canEditSelfRatings: true, canEditManagerRatings: false }, "Loading leadership assessment…"],
    [
      "Technical",
      TechnicalCompetenciesSection as never,
      { canEditSetup: false, canDeleteCompetencies: false, canEditSelfRatings: true, canEditManagerRatings: false },
      "Loading technical competencies…",
    ],
  ];

  it.each(OTHERS)("%s: competency skeleton while loading", async (_name, component, props, label) => {
    gatedFetch(() => "pending");
    await render(createElement(component, { appraisalId: "a-1", ...props }));
    expect(skeleton()?.getAttribute("data-section-skeleton")).toBe("competency");
    expect(skeleton()?.textContent).toBe(label);
    expect(skeletonRows()).toHaveLength(4);
  });
});

describe("Summary tab loading", () => {
  const appraisal = {
    id: "a-1",
    employee_id: "emp-1",
    cycle_id: "c-1",
    status: "IN_PROGRESS",
    employeeName: "Jane Employee",
    cycleName: "FY 2026",
  };

  it("shows the summary skeleton, then the summary", async () => {
    const { release } = gatedFetch(() =>
      jsonResponse({ components: [], totalWeight: 100, totalPoints: 0, overallPct: 0, overallGrade: "E", gradeBand: "—", isManagementTrack: false })
    );
    await render(
      createElement(SummaryTab, {
        appraisalId: "a-1",
        appraisal: appraisal as never,
        showLeadership: false,
        isHR: false,
        isManager: false,
        isEmployee: true,
        currentUserEmployeeId: "emp-1",
      })
    );
    expect(skeleton()?.getAttribute("data-section-skeleton")).toBe("summary");
    await release();
    expect(skeleton()).toBeNull();
    expect(container.querySelector("#summary-overall-heading")).not.toBeNull();
  });
});

describe("Reviews & Check-ins tab loading", () => {
  it("shows the check-ins skeleton, and the existing error message when loading fails", async () => {
    const { release } = gatedFetch(() => jsonResponse({ error: "nope" }, 500));
    await render(createElement(CheckInTab, { appraisalId: "a-1", isManager: false, isHR: false, isEmployee: true } as never));
    expect(skeleton()?.getAttribute("data-section-skeleton")).toBe("checkins");
    expect(skeleton()?.textContent).toBe("Loading check-ins…");
    await release();
    expect(skeleton()).toBeNull();
    expect(container.textContent).toContain("Failed to load check-ins.");
  });
});

describe("loading text replaced in the appraisal sections", () => {
  it.each([
    "components/appraisal/WorkplanSection.tsx",
    "components/appraisal/CoreCompetenciesSection.tsx",
    "components/appraisal/ProductivitySection.tsx",
    "components/appraisal/TechnicalCompetenciesSection.tsx",
    "components/appraisal/LeadershipSection.tsx",
    "components/appraisal/SummaryTab.tsx",
    "components/appraisal/checkins/CheckInTab.tsx",
  ])("%s renders AppraisalSectionSkeleton instead of a plain loading paragraph", (file) => {
    const src = fs.readFileSync(path.join(process.cwd(), file), "utf8");
    expect(src).toMatch(/<AppraisalSectionSkeleton variant="(workplan|competency|summary|checkins)"/);
    expect(src).not.toMatch(/<p[^>]*>Loading [^<]*…<\/p>/);
  });
});
