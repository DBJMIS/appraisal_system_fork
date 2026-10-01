// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import fs from "node:fs";
import path from "node:path";

const mocks = vi.hoisted(() => ({ browserCreateClient: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ createClient: mocks.browserCreateClient }));

import { WorkplanSection } from "@/components/appraisal/WorkplanSection";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NumericDraftInput, parseNumericDraft } from "@/components/appraisal/workplan/NumericDraftInput";
import { calcCompletion } from "@/lib/appraisal-completion";
import { calcMetricPercentage } from "@/lib/metric-calc";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let savedBody: { items: Array<Record<string, unknown>> } | null;
let managerPatches: Array<{ url: string; body: Record<string, unknown> }>;

const jsonResponse = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

async function flush() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

const item = (id: string, task: string, extra: Record<string, unknown> = {}) => ({
  id,
  workplan_id: "wp-1",
  corporate_objective: `Objective ${id}`,
  division_objective: "",
  individual_objective: "",
  major_task: task,
  key_output: `Output ${id}`,
  performance_standard: `Standard ${id}`,
  weight: 40,
  metric_type: "PERCENT",
  metric_target: 100,
  actual_result: null,
  ...extra,
});

function stubFetch(items: unknown[]) {
  savedBody = null;
  managerPatches = [];
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/api/appraisals/a-1/workplan") && init?.method === "POST") {
      savedBody = JSON.parse(String(init.body));
      return jsonResponse({ ok: true });
    }
    if (u.includes("/api/workplan-items/") && init?.method === "PATCH") {
      managerPatches.push({ url: u, body: JSON.parse(String(init.body)) });
      return jsonResponse({ ok: true });
    }
    if (u.endsWith("/api/appraisals/a-1/workplan")) {
      return jsonResponse({
        workplan: { id: "wp-1", status: "approved", locked_at: "2026-04-01T00:00:00Z", submitted_at: null, rejection_reason: null },
        items,
      });
    }
    if (u.endsWith("/api/appraisals/a-1/objectives")) return jsonResponse([]);
    if (u.endsWith("/api/appraisals/a-1/midyear-context")) return jsonResponse({ available: false, results: {}, score: null });
    return jsonResponse({}, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  const query = { select: () => query, eq: () => query, in: async () => ({ data: [] }) };
  mocks.browserCreateClient.mockReturnValue({ from: () => query });
}

async function renderWorkplan(items: unknown[], appraisalStatus = "SELF_ASSESSMENT", role: "employee" | "manager" = "employee") {
  stubFetch(items);
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

const rowOf = (task: string) => [...container.querySelectorAll("tbody tr")].find((tr) => tr.textContent?.includes(task))!;
const ytdInput = (task: string) => rowOf(task).querySelector<HTMLInputElement>("[data-actual-ytd]")!;
const pointsCell = (task: string) => {
  const cells = rowOf(task).querySelectorAll("td");
  return cells[cells.length - 1].textContent?.trim();
};

const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;

async function typeValue(input: HTMLInputElement, value: string) {
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Simulates successive keystrokes: each step is the field's full text after the key. */
async function keystrokes(input: HTMLInputElement, steps: string[]) {
  for (const s of steps) await typeValue(input, s);
}

async function focus(input: HTMLInputElement) {
  await act(async () => { input.focus(); });
}

async function blur(input: HTMLInputElement) {
  await act(async () => { input.blur(); });
}

async function save() {
  const btn = container.querySelector<HTMLButtonElement>("[data-save-assessment]")!;
  await act(async () => btn.click());
  await flush();
}

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

describe("parseNumericDraft", () => {
  it("distinguishes empty, incomplete and complete entries", () => {
    expect(parseNumericDraft("")).toBeNull();
    expect(parseNumericDraft("   ")).toBeNull();
    expect(parseNumericDraft("-")).toBeUndefined();
    expect(parseNumericDraft(".")).toBeUndefined();
    expect(parseNumericDraft("abc")).toBeUndefined();
    expect(parseNumericDraft("4")).toBe(4);
    expect(parseNumericDraft("40")).toBe(40);
    expect(parseNumericDraft("100")).toBe(100);
    expect(parseNumericDraft("07")).toBe(7);
    expect(parseNumericDraft("12.5")).toBe(12.5);
  });
});

describe("Actual YTD (percent) input — employee Self Assessment", () => {
  it("accepts a single digit", async () => {
    await renderWorkplan([item("i-1", "Task one")]);
    const input = ytdInput("Task one");
    await focus(input);
    await keystrokes(input, ["4"]);
    expect(input.value).toBe("4");
    expect(pointsCell("Task one")).toBe("1.6");
  });

  it("accepts multi-digit values typed one key at a time (4 → 40)", async () => {
    await renderWorkplan([item("i-1", "Task one")]);
    const input = ytdInput("Task one");
    await focus(input);
    await keystrokes(input, ["4", "40"]);
    expect(input.value).toBe("40");
    expect(pointsCell("Task one")).toBe("16");
  });

  it("extends a saved value with another digit instead of snapping back", async () => {
    await renderWorkplan([item("i-1", "Task one", { actual_result: 4 })]);
    const input = ytdInput("Task one");
    expect(input.value).toBe("4");
    await focus(input);
    await keystrokes(input, ["40"]);
    expect(input.value).toBe("40");
    expect(pointsCell("Task one")).toBe("16");
    await blur(input);
    expect(input.value).toBe("40");
  });

  it("accepts 100", async () => {
    await renderWorkplan([item("i-1", "Task one")]);
    const input = ytdInput("Task one");
    await focus(input);
    await keystrokes(input, ["1", "10", "100"]);
    expect(input.value).toBe("100");
    expect(pointsCell("Task one")).toBe("40");
  });

  it("Backspace/Delete can clear the field completely — it stays empty, not 0 or the old value", async () => {
    await renderWorkplan([item("i-1", "Task one", { actual_result: 40 })]);
    const input = ytdInput("Task one");
    await focus(input);
    await keystrokes(input, ["4", ""]);
    expect(input.value).toBe("");
    expect(pointsCell("Task one")).toBe("—");
    await blur(input);
    expect(input.value).toBe("");
    expect(pointsCell("Task one")).toBe("—");
  });

  it("select-all and replace an existing value", async () => {
    await renderWorkplan([item("i-1", "Task one", { actual_result: 40 })]);
    const input = ytdInput("Task one");
    await focus(input);
    input.select();
    await keystrokes(input, ["7", "75"]);
    expect(input.value).toBe("75");
    expect(pointsCell("Task one")).toBe("30");
  });

  it("pasting a multi-digit value", async () => {
    await renderWorkplan([item("i-1", "Task one", { actual_result: 40 })]);
    const input = ytdInput("Task one");
    await focus(input);
    await typeValue(input, "85");
    expect(input.value).toBe("85");
    expect(pointsCell("Task one")).toBe("34");
  });

  it("keeps the existing 0–100 range: lets the user finish typing, hints, then shows the clamped value on blur", async () => {
    await renderWorkplan([item("i-1", "Task one")]);
    const input = ytdInput("Task one");
    await focus(input);
    await keystrokes(input, ["1", "15", "150"]);
    expect(input.value).toBe("150");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const hint = rowOf("Task one").querySelector("[data-numeric-range-hint]")!;
    expect(hint.textContent).toBe("Enter a value from 0 to 100");
    expect(input.getAttribute("aria-describedby")).toBe(hint.id);
    expect(pointsCell("Task one")).toBe("40");

    await blur(input);
    expect(input.value).toBe("100");
    expect(input.hasAttribute("aria-invalid")).toBe(false);
    expect(rowOf("Task one").querySelector("[data-numeric-range-hint]")).toBeNull();
  });

  it("an emptied value saves as null (incomplete), never 0", async () => {
    await renderWorkplan([item("i-1", "Task one", { actual_result: 40 }), item("i-2", "Task two", { actual_result: 90 })]);
    const input = ytdInput("Task one");
    await focus(input);
    await keystrokes(input, ["4", ""]);
    await blur(input);
    await save();

    const saved = savedBody!.items.find((i) => i.id === "i-1")!;
    expect(saved.actual_result).toBeNull();
    expect(saved.metric_actual_raw).toBeNull();
    expect(saved.points).toBeNull();
    expect(savedBody!.items.find((i) => i.id === "i-2")!.actual_result).toBe(90);

    const report = calcCompletion({
      workplanItems: savedBody!.items as never,
      appraisalStatus: "SELF_ASSESSMENT",
      factorRatings: [],
      coreFactorIds: [],
      productivityFactorIds: [],
      leadershipFactorIds: [],
      technicalCompetencies: [],
      showLeadership: false,
    });
    const wp = report.sections.find((s) => s.key === "workplan")!;
    expect(wp.completed).toBe(1);
    expect(wp.total).toBe(2);
  });

  it("a typed value saves with the same calculation as before", async () => {
    await renderWorkplan([item("i-1", "Task one", { actual_result: 4 })]);
    const input = ytdInput("Task one");
    await focus(input);
    await keystrokes(input, ["40"]);
    await blur(input);
    await save();
    const saved = savedBody!.items.find((i) => i.id === "i-1")!;
    expect(saved.actual_result).toBe(40);
    expect(saved.metric_actual_raw).toBe(40);
    expect(saved.points).toBe(16);
    expect(calcMetricPercentage({ metric_type: "PERCENT", metric_actual_raw: 40 })).toBe(40);
  });
});

describe("Actual YTD (number) input", () => {
  const numberItem = (extra: Record<string, unknown> = {}) =>
    item("i-1", "Task one", { metric_type: "NUMBER", metric_target: 200, ...extra });

  it("multi-digit entry recalculates using the existing raw/target formula", async () => {
    await renderWorkplan([numberItem()]);
    const input = ytdInput("Task one");
    await focus(input);
    await keystrokes(input, ["1", "15", "150"]);
    expect(input.value).toBe("150");
    // round(150 / 200 * 100) = 75 → 75% of weight 40 = 30
    expect(pointsCell("Task one")).toBe("30");
  });

  it("clearing the raw value clears the result instead of keeping the stale one", async () => {
    await renderWorkplan([numberItem({ metric_actual_raw: 100, actual_result: 50 })]);
    const input = ytdInput("Task one");
    expect(pointsCell("Task one")).toBe("20");
    await focus(input);
    await keystrokes(input, ["10", "1", ""]);
    expect(input.value).toBe("");
    expect(pointsCell("Task one")).toBe("—");
    await blur(input);
    await save();
    const saved = savedBody!.items.find((i) => i.id === "i-1")!;
    expect(saved.metric_actual_raw).toBeNull();
    expect(saved.actual_result).toBeNull();
  });
});

describe("Manager Actual YTD input (MANAGER_REVIEW)", () => {
  it("can be cleared and retyped without the employee value reappearing mid-edit", async () => {
    await renderWorkplan(
      [item("i-1", "Task one", { actual_result: 40, metric_actual_raw: 40 })],
      "MANAGER_REVIEW",
      "manager"
    );
    const input = rowOf("Task one").querySelector<HTMLInputElement>("[data-mgr-actual]")!;
    expect(input.value).toBe("40");
    await focus(input);
    await keystrokes(input, ["4", "", "3", "35"]);
    expect(input.value).toBe("35");
  });

  it("an emptied manager field still means 'use the employee value' after blur, as before", async () => {
    await renderWorkplan(
      [item("i-1", "Task one", { actual_result: 40, metric_actual_raw: 40 })],
      "MANAGER_REVIEW",
      "manager"
    );
    const input = rowOf("Task one").querySelector<HTMLInputElement>("[data-mgr-actual]")!;
    await focus(input);
    await keystrokes(input, ["4", ""]);
    expect(input.value).toBe("");
    await blur(input);
    expect(input.value).toBe("40");
  });
});

describe("NumericDraftInput", () => {
  function Harness({ initial, clamp, onValue }: { initial: number | null; clamp?: boolean; onValue: (v: number | null) => void }) {
    const [v, setV] = useState<number | null>(initial);
    return createElement(
      "div",
      null,
      createElement(NumericDraftInput, {
        value: v,
        min: 0,
        max: 100,
        clamp,
        onValueChange: (n: number | null) => {
          setV(n);
          onValue(n);
        },
      }),
      createElement("output", null, v == null ? "—" : String(v))
    );
  }

  async function mount(initial: number | null, clamp = true) {
    const onValue = vi.fn();
    await act(async () => {
      root.render(createElement(Harness, { initial, clamp, onValue }));
    });
    return { input: container.querySelector("input")!, output: container.querySelector("output")!, onValue };
  }

  it("reports null (not 0) when emptied and shows — for the result", async () => {
    const { input, output, onValue } = await mount(40);
    await focus(input);
    await keystrokes(input, ["4", ""]);
    expect(onValue).toHaveBeenLastCalledWith(null);
    expect(output.textContent).toBe("—");
    expect(input.value).toBe("");
  });

  it("does not clamp the stored value unless asked", async () => {
    const { input, onValue } = await mount(null, false);
    await focus(input);
    await keystrokes(input, ["1", "12", "120"]);
    expect(onValue).toHaveBeenLastCalledWith(120);
  });

  it("clamps the stored value but leaves the typed text until blur", async () => {
    const { input, output, onValue } = await mount(null, true);
    await focus(input);
    await keystrokes(input, ["1", "12", "120"]);
    expect(onValue).toHaveBeenLastCalledWith(100);
    expect(input.value).toBe("120");
    expect(output.textContent).toBe("100");
    await blur(input);
    expect(input.value).toBe("100");
  });

  it("forwards focus and blur handlers", async () => {
    const onFocus = vi.fn();
    const onBlur = vi.fn();
    await act(async () => {
      root.render(createElement(NumericDraftInput, { value: 5, onValueChange: () => {}, onFocus, onBlur }));
    });
    const input = container.querySelector("input")!;
    await focus(input);
    await blur(input);
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onBlur).toHaveBeenCalledTimes(1);
  });
});

describe("static guards", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "components/appraisal/WorkplanSection.tsx"), "utf8");

  it("no Actual YTD input converts and clamps on every keystroke any more", () => {
    expect(src).not.toMatch(/Math\.min\(100,\s*Math\.max\(0,\s*Number\(e\.target\.value\)\)\)/);
  });

  it("does not change the shared metric formulas", () => {
    const calc = fs.readFileSync(path.join(process.cwd(), "lib/metric-calc.ts"), "utf8");
    expect(calc).toContain("return Math.min(100, Math.round((item.metric_actual_raw / item.metric_target) * 100));");
    expect(calc).toContain("return Math.min(100, Math.max(0, item.metric_actual_raw));");
    expect(src).toContain("return Math.round((actualYTD / 100) * weight * 10) / 10;");
  });
});
