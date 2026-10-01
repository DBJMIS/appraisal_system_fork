// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import fs from "node:fs";
import path from "node:path";

const mocks = vi.hoisted(() => ({ browserCreateClient: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ createClient: mocks.browserCreateClient }));

import { WorkplanSection } from "@/components/appraisal/WorkplanSection";
import { TooltipProvider } from "@/components/ui/tooltip";
import { formatMidyearResult } from "@/components/appraisal/workplan/MidyearFinalReviewContext";
import { DRAFT_SAVED_MS } from "@/hooks/useDraftSaveFeedback";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

let container: HTMLDivElement;
let root: Root;

const jsonResponse = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

async function flush() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

const item = (id: string, task: string, actual_result: number | null, extra: Record<string, unknown> = {}) => ({
  id,
  workplan_id: "wp-1",
  corporate_objective: `Objective ${id}`,
  division_objective: "",
  individual_objective: "",
  major_task: task,
  key_output: `Output ${id}`,
  performance_standard: `Standard ${id}`,
  weight: id === "i-3" ? 20 : 40,
  metric_type: "PERCENT",
  metric_target: 100,
  actual_result,
  ...extra,
});

const WORKPLAN = {
  workplan: { id: "wp-1", status: "approved", locked_at: "2026-04-01T00:00:00Z", submitted_at: null, rejection_reason: null },
  items: [item("i-1", "Task one", 40), item("i-2", "Task two", 90), item("i-3", "Task three", null)],
};

const CONTEXT = {
  available: true,
  results: { "i-1": 60, "i-2": 85 },
  score: { total: 74.56, grade: "B", gradeLabel: "Very good", revision: 2 },
};

type Handler = (
  url: string,
  init?: RequestInit
) => ReturnType<typeof jsonResponse> | undefined | Promise<ReturnType<typeof jsonResponse> | undefined>;
let fetchMock: ReturnType<typeof vi.fn>;

function stubFetch(context: unknown, extra?: Handler) {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const handled = await extra?.(String(url), init);
    if (handled) return handled;
    if (String(url).endsWith("/api/appraisals/a-1/workplan")) return jsonResponse(WORKPLAN);
    if (String(url).endsWith("/api/appraisals/a-1/objectives")) return jsonResponse([]);
    if (String(url).endsWith("/api/appraisals/a-1/midyear-context")) return context === 500 ? jsonResponse({ error: "x" }, 500) : jsonResponse(context);
    return jsonResponse({}, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  const query = { select: () => query, eq: () => query, in: async () => ({ data: [] }) };
  mocks.browserCreateClient.mockReturnValue({ from: () => query });
}

async function renderWorkplan(appraisalStatus: string, role: "employee" | "manager" = "employee") {
  await act(async () => {
    root.render(
      createElement(
        TooltipProvider,
        null,
        createElement(WorkplanSection, {
          appraisalId: "a-1",
          appraisalStatus,
          cyclePhase: "ASSESSMENT",
          isEmployee: role === "employee",
          isManager: role === "manager",
          isHR: false,
        })
      )
    );
  });
  await flush();
}

const headers = () => [...container.querySelectorAll("thead th")].map((th) => th.textContent?.trim() ?? "");
const rowOf = (task: string) => [...container.querySelectorAll("tbody tr")].find((tr) => tr.textContent?.includes(task))!;
const midyearCell = (task: string) => rowOf(task).querySelector("[data-midyear-cell]");
const saveButton = () => container.querySelector<HTMLButtonElement>("[data-save-assessment]");
const downloadButtons = () => [...container.querySelectorAll("button")].filter((b) => /Download Excel|Downloading/.test(b.textContent ?? ""));
const contextCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/midyear-context"));

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

describe("Final Review workplan: Mid-Year Result column", () => {
  it("a completed Mid-Year Review adds the column between Weighting and Actual YTD", async () => {
    stubFetch(CONTEXT);
    await renderWorkplan("SELF_ASSESSMENT");
    const h = headers();
    expect(h.slice(h.indexOf("Performance Standard"))).toEqual([
      "Performance Standard",
      "Target",
      "Weighting",
      "Mid-Year Result",
      "Actual YTD",
      "Evidence",
      "Points",
    ]);
    expect(midyearCell("Task one")!.textContent).toBe("60%");
    expect(midyearCell("Task two")!.textContent).toBe("85%");
    expect(container.querySelector("col.w-\\[8\\%\\]")).not.toBeNull();
  });

  it("an objective with no Mid-Year response shows —", async () => {
    stubFetch(CONTEXT);
    await renderWorkplan("SELF_ASSESSMENT");
    expect(midyearCell("Task three")!.textContent).toBe("—");
    expect(midyearCell("Task three")!.querySelector("[data-midyear-result]")!.getAttribute("aria-label")).toBe("Mid-Year result: not available");
  });

  it.each([
    ["no completed Mid-Year Review", { available: false, results: {}, score: null }],
    ["the context request fails", 500],
  ])("%s → the existing table is unchanged", async (_label, context) => {
    stubFetch(context);
    await renderWorkplan("SELF_ASSESSMENT");
    const h = headers();
    expect(h.slice(h.indexOf("Performance Standard"))).toEqual(["Performance Standard", "Target", "Weighting", "Actual YTD", "Evidence", "Points"]);
    expect(container.querySelector("[data-midyear-cell]")).toBeNull();
    expect(container.querySelector("[data-midyear-score]")).toBeNull();
    expect(container.querySelector("col.w-\\[8\\%\\]")).toBeNull();
  });

  it.each(["DRAFT", "PENDING_APPROVAL", "IN_PROGRESS"])("is not requested before the Final Review (%s)", async (status) => {
    stubFetch(CONTEXT);
    await renderWorkplan(status);
    expect(contextCalls()).toEqual([]);
    expect(container.querySelector("[data-midyear-cell]")).toBeNull();
  });

  it("employee view: the value is plain read-only text, not an input or pill", async () => {
    stubFetch(CONTEXT);
    await renderWorkplan("SELF_ASSESSMENT");
    const cell = midyearCell("Task one")!;
    expect(cell.querySelector("input, select, textarea, button")).toBeNull();
    const value = cell.querySelector("[data-midyear-result]")!;
    expect(value.className).toContain("font-normal");
    expect(value.className).not.toMatch(/rounded|border|bg-/);
    expect(value.getAttribute("aria-label")).toBe("Mid-Year result: 60%");
  });

  it("manager view: the same read-only context during Manager Review", async () => {
    stubFetch(CONTEXT);
    await renderWorkplan("MANAGER_REVIEW", "manager");
    expect(headers()).toContain("Mid-Year Result");
    expect(headers().indexOf("Mid-Year Result")).toBe(headers().indexOf("Weighting") + 1);
    expect(midyearCell("Task one")!.textContent).toBe("60%");
    expect(midyearCell("Task one")!.querySelector("input, select, textarea, button")).toBeNull();
    expect(container.querySelector("[data-midyear-score]")!.textContent).toBe("Mid-Year score: 74.6 · Grade B");
  });

  it.each(["SUBMITTED", "PENDING_SIGNOFF", "COMPLETE"])("stays visible, read-only, later in the annual review (%s)", async (status) => {
    stubFetch(CONTEXT);
    await renderWorkplan(status);
    expect(midyearCell("Task one")!.textContent).toBe("60%");
  });
});

describe("Final Review workplan: overall Mid-Year score", () => {
  it("shows the stored score and grade, rounded for display only", async () => {
    stubFetch(CONTEXT);
    await renderWorkplan("SELF_ASSESSMENT");
    expect(container.querySelector("[data-midyear-score]")!.textContent).toBe("Mid-Year score: 74.6 · Grade B");
  });

  it("no current Mid-Year score → no summary, but the column still shows", async () => {
    stubFetch({ ...CONTEXT, score: null });
    await renderWorkplan("SELF_ASSESSMENT");
    expect(container.querySelector("[data-midyear-score]")).toBeNull();
    expect(midyearCell("Task one")!.textContent).toBe("60%");
  });
});

describe("Final Review workplan: annual isolation", () => {
  it("Mid-Year values never prefill or alter Actual YTD, points or the saved payload", async () => {
    let saved: { items: Array<{ id: string; actual_result: number | null; points: number | null }> } | null = null;
    stubFetch(CONTEXT, (url, init) => {
      if (url.endsWith("/api/appraisals/a-1/workplan") && init?.method === "POST") {
        saved = JSON.parse(String(init.body));
        return jsonResponse({ ok: true });
      }
      return undefined;
    });
    await renderWorkplan("SELF_ASSESSMENT");

    const actualInput = (task: string) => rowOf(task).querySelector<HTMLInputElement>('input[type="number"]')!;
    expect(actualInput("Task one").value).toBe("40");
    expect(actualInput("Task three").value).toBe("");

    await act(async () => saveButton()!.click());
    await flush();
    const byId = Object.fromEntries(saved!.items.map((i) => [i.id, i]));
    expect(byId["i-1"].actual_result).toBe(40);
    expect(byId["i-2"].actual_result).toBe(90);
    expect(byId["i-3"].actual_result).toBeNull();
    expect(JSON.stringify(saved)).not.toMatch(/midyear|"60"|:60\b|:85\b/i);
  });

  it("the footer total still sums annual points only", async () => {
    stubFetch(CONTEXT);
    await renderWorkplan("SUBMITTED");
    const footer = container.querySelector("tfoot")!.textContent ?? "";
    expect(footer).toContain("100.0%");
    expect(footer).toContain((0.4 * 40 + 0.9 * 40).toFixed(1));
  });

  it("formats results without recalculating them", () => {
    expect(formatMidyearResult(60)).toBe("60%");
    expect(formatMidyearResult(72.46)).toBe("72.5%");
    expect(formatMidyearResult(null)).toBe("—");
    expect(formatMidyearResult(undefined)).toBe("—");
  });

  it("the Mid-Year context module only reads: no writes, no annual or Mid-Year scoring imports", () => {
    const lib = read("lib/midyear-final-review-context.ts");
    expect(lib).not.toMatch(/\.(insert|update|upsert|delete)\(/);
    expect(lib).not.toMatch(/calcSummary|persistScoreSnapshot|buildSummaryInput|recordMidyearScore/);
    const ui = read("components/appraisal/workplan/MidyearFinalReviewContext.tsx");
    expect(ui).not.toMatch(/method:\s*"(POST|PATCH|PUT|DELETE)"/);
  });
});

describe("Final Review workplan: Save Assessment action", () => {
  it("sits in a compact action row above the table with Download Excel on the opposite side", async () => {
    stubFetch(CONTEXT);
    await renderWorkplan("SELF_ASSESSMENT");
    const row = container.querySelector("[data-assessment-actions]")!;
    expect(row).not.toBeNull();
    expect(row.contains(saveButton())).toBe(true);
    expect(downloadButtons()).toHaveLength(1);
    expect(row.contains(downloadButtons()[0])).toBe(true);
    expect(row.className).toContain("flex-col");
    expect(row.className).toContain("sm:flex-row");
    expect(row.className).toContain("sm:justify-between");
    expect(row.compareDocumentPosition(container.querySelector("table")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("is a neutral outline button, not the dark workflow CTA", async () => {
    stubFetch(CONTEXT);
    await renderWorkplan("SELF_ASSESSMENT");
    const btn = saveButton()!;
    expect(btn.textContent).toContain("Save Assessment");
    expect(btn.querySelector("svg")).not.toBeNull();
    expect(btn.className).toMatch(/\bh-8\b/);
    expect(btn.className).toContain("rounded-[8px]");
    expect(btn.className).toContain("border-ds-border");
    expect(btn.className).toContain("bg-white");
    expect(btn.className).toContain("text-ds-text-primary");
    expect(btn.className).not.toMatch(/bg-ds-accent|shadow/);
    expect(btn.style.background).toBe("");
  });

  it("employee save: Saving… → Saved ✓ with Last saved, no success banner, then back to Save Assessment", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    stubFetch(CONTEXT, async (url, init) => {
      if (url.endsWith("/api/appraisals/a-1/workplan") && init?.method === "POST") {
        await gate;
        return jsonResponse({ ok: true });
      }
      return undefined;
    });
    await renderWorkplan("SELF_ASSESSMENT");

    await act(async () => saveButton()!.click());
    expect(saveButton()!.textContent).toContain("Saving…");
    expect(saveButton()!.disabled).toBe(true);

    await act(async () => release());
    await flush();
    expect(saveButton()!.textContent).toContain("Saved ✓");
    expect(container.querySelector("[data-midyear-last-saved]")!.textContent).toBe("Last saved just now");
    expect(container.textContent).not.toContain("Changes saved successfully.");
    const posts = fetchMock.mock.calls.filter(([u, i]) => String(u).endsWith("/api/appraisals/a-1/workplan") && i?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(JSON.parse(String(posts[0][1].body))).toMatchObject({ workplanId: "wp-1", idsToDelete: [] });

    await act(async () => {
      await new Promise((r) => setTimeout(r, DRAFT_SAVED_MS + 50));
    });
    expect(saveButton()!.textContent).toContain("Save Assessment");
    expect(container.querySelector("[data-midyear-last-saved]")).not.toBeNull();
  });

  it("a failed save shows the existing error and keeps the entered values", async () => {
    stubFetch(CONTEXT, (url, init) =>
      url.endsWith("/api/appraisals/a-1/workplan") && init?.method === "POST" ? jsonResponse({ error: "Could not save workplan" }, 500) : undefined
    );
    await renderWorkplan("SELF_ASSESSMENT");
    const input = rowOf("Task three").querySelector<HTMLInputElement>('input[type="number"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "55");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => saveButton()!.click());
    await flush();
    expect(container.textContent).toContain("Could not save workplan");
    expect(rowOf("Task three").querySelector<HTMLInputElement>('input[type="number"]')!.value).toBe("55");
    expect(saveButton()!.textContent).toContain("Save Assessment");
    expect(container.querySelector("[data-midyear-last-saved]")).toBeNull();
  });

  it("manager save still PATCHes each item's manager assessment", async () => {
    stubFetch(CONTEXT, (url, init) => (url.includes("/api/workplan-items/") && init?.method === "PATCH" ? jsonResponse({ ok: true }) : undefined));
    await renderWorkplan("MANAGER_REVIEW", "manager");
    expect(saveButton()!.textContent).toContain("Save Assessment");
    await act(async () => saveButton()!.click());
    await flush();
    const patches = fetchMock.mock.calls.filter(([, i]) => i?.method === "PATCH").map(([u]) => String(u));
    expect(patches).toEqual(["/api/workplan-items/i-1/manager", "/api/workplan-items/i-2/manager", "/api/workplan-items/i-3/manager"]);
    expect(saveButton()!.textContent).toContain("Saved ✓");
  });

  it.each([
    ["IN_PROGRESS", "employee"],
    ["SUBMITTED", "employee"],
    ["MANAGER_REVIEW", "employee"],
  ] as const)("no Save action when nothing is editable (%s, %s); Download Excel stays in the card header", async (status, role) => {
    stubFetch(CONTEXT);
    await renderWorkplan(status, role);
    expect(saveButton()).toBeNull();
    expect(container.querySelector("[data-assessment-actions]")).toBeNull();
    expect(downloadButtons()).toHaveLength(1);
  });

  it("Download Excel itself is unchanged: same styling and the same export request", async () => {
    stubFetch(CONTEXT, (url) =>
      url.endsWith("/workplan/export-excel")
        ? ({ ok: true, status: 200, json: async () => ({}), blob: async () => new Blob(["x"]), headers: new Headers() } as unknown as ReturnType<typeof jsonResponse>)
        : undefined
    );
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await renderWorkplan("SELF_ASSESSMENT");
    const dl = downloadButtons()[0];
    expect(dl.className).toBe(
      "inline-flex items-center gap-2 px-3 py-2 rounded-[8px] bg-white text-ds-text-primary border border-ds-border text-[11px] font-semibold hover:bg-ds-surface transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    );
    await act(async () => dl.click());
    await flush();
    expect(fetchMock).toHaveBeenCalledWith("/api/appraisals/a-1/workplan/export-excel");
    expect(anchorClick).toHaveBeenCalledTimes(1);
    anchorClick.mockRestore();
  });
});
