// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import fs from "node:fs";
import path from "node:path";

import { EvidenceBuilder, EVIDENCE_SCAN_SLOW_MS } from "@/components/appraisal/EvidenceBuilder";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type FetchResult = { ok: boolean; status: number; json: () => Promise<unknown> };

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let generateCalls: Array<{ body: unknown; resolve: (r: FetchResult) => void; reject: (e: unknown) => void }>;

async function flush() {
  for (let i = 0; i < 20; i++) await act(async () => { await Promise.resolve(); });
}

const SUGGESTION = {
  id: "s-1",
  achievement_text: "Delivered the quarterly reporting dashboard ahead of schedule.",
  confidence_level: "high",
  evidence_summary: ["task_completed: Reporting dashboard"],
};

const ok = (body: unknown): FetchResult => ({ ok: true, status: 200, json: async () => body });

async function renderBuilder(existing: unknown[] = []) {
  generateCalls = [];
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === "/api/evidence/generate-suggestions") {
      return new Promise<FetchResult>((resolve, reject) => {
        generateCalls.push({ body: JSON.parse(String(init?.body)), resolve, reject });
      });
    }
    return Promise.resolve(ok({ suggestions: existing }));
  });
  vi.stubGlobal("fetch", fetchMock);
  await act(async () => {
    root.render(
      createElement(EvidenceBuilder, {
        appraisalId: "a-1",
        employeeId: "e-1",
        reviewStart: "2026-01-01",
        reviewEnd: "2026-12-31",
        status: "SELF_ASSESSMENT",
      })
    );
  });
  await flush();
}

function button(label: string) {
  return [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) ?? null;
}

async function startScan() {
  await act(async () => { button("Generate")!.click(); });
  await flush();
}

async function finishScan(result: FetchResult) {
  await act(async () => { generateCalls[generateCalls.length - 1].resolve(result); });
  await flush();
}

const q = (sel: string) => container.querySelector(sel);

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("EvidenceBuilder scanning state", () => {
  it("renders progress feedback with status text while scanning", async () => {
    await renderBuilder();
    await startScan();

    const scanning = q("[data-evidence-scanning]");
    expect(scanning).not.toBeNull();
    expect(scanning!.textContent).toContain("Scanning your work activity");
    expect(scanning!.textContent).toContain("Checking your workplan and connected sources for relevant achievements…");
    expect(q("[data-evidence-scan-helper]")!.textContent).toBe("This may take a moment.");
    expect(q("[data-evidence-spinner]")).not.toBeNull();
    expect(q("[data-evidence-progress]")).not.toBeNull();
    expect(button("Generate")).toBeNull();
  });

  it("uses an indeterminate progress bar because the scan reports no real progress", async () => {
    await renderBuilder();
    await startScan();

    const bar = q("[data-evidence-progress]")!;
    expect(bar.getAttribute("role")).toBe("progressbar");
    expect(bar.hasAttribute("aria-valuenow")).toBe(false);
    expect(bar.hasAttribute("aria-valuemin")).toBe(false);
    expect(bar.hasAttribute("aria-valuemax")).toBe(false);
    expect(bar.getAttribute("aria-valuetext")).toBe("Scanning");
    expect(q("[data-evidence-scanning]")!.textContent).not.toMatch(/\d+\s*%|\d+\s+of\s+\d+/);
  });

  it("does not simulate processing phases over time", async () => {
    vi.useFakeTimers();
    await renderBuilder();
    await startScan();
    const before = q("[data-evidence-scanning] [role='status']")!.textContent;

    await act(async () => { vi.advanceTimersByTime(EVIDENCE_SCAN_SLOW_MS * 3); });
    expect(q("[data-evidence-scanning] [role='status']")!.textContent).toBe(before);
  });

  it("switches to long-running reassurance after the slow threshold without cancelling", async () => {
    vi.useFakeTimers();
    await renderBuilder();
    await startScan();

    await act(async () => { vi.advanceTimersByTime(EVIDENCE_SCAN_SLOW_MS - 100); });
    expect(q("[data-evidence-scan-helper]")!.textContent).toBe("This may take a moment.");

    await act(async () => { vi.advanceTimersByTime(200); });
    expect(q("[data-evidence-scan-helper]")!.textContent).toBe(
      "Still scanning — this can take a little longer when there is more activity to review."
    );
    expect(q("[data-evidence-scanning]")).not.toBeNull();
    expect(generateCalls).toHaveLength(1);

    await finishScan(ok({ suggestions: [SUGGESTION] }));
    expect(q("[data-evidence-results]")).not.toBeNull();
  });

  it("replaces the progress state with results on success", async () => {
    await renderBuilder();
    await startScan();
    await finishScan(ok({ suggestions: [SUGGESTION] }));

    expect(q("[data-evidence-scanning]")).toBeNull();
    expect(q("[data-evidence-results]")!.textContent).toContain(SUGGESTION.achievement_text);
    expect(generateCalls[0].body).toEqual({
      employeeId: "e-1",
      appraisalId: "a-1",
      reviewStart: "2026-01-01",
      reviewEnd: "2026-12-31",
    });
  });

  it("shows the empty state when no suggestions are found", async () => {
    await renderBuilder();
    await startScan();
    await finishScan(ok({ suggestions: [] }));

    expect(q("[data-evidence-scanning]")).toBeNull();
    const empty = q("[data-evidence-empty]")!;
    expect(empty.textContent).toContain("No evidence suggestions found yet");
    expect(empty.getAttribute("role")).toBe("status");
  });

  it("shows a controlled inline error and retries the same scan", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    await renderBuilder();
    await startScan();
    await finishScan({ ok: false, status: 500, json: async () => ({ error: "Supabase config required" }) });

    const err = q("[data-evidence-scan-error]")!;
    expect(err.getAttribute("role")).toBe("alert");
    expect(err.textContent).toContain("We couldn't complete the evidence scan.");
    expect(err.textContent).not.toContain("Supabase config required");
    expect(q("[data-evidence-scanning]")).toBeNull();
    expect(q("[data-evidence-empty]")).toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();

    await act(async () => { button("Try again")!.click(); });
    await flush();
    expect(generateCalls).toHaveLength(2);
    expect(generateCalls[1].body).toEqual(generateCalls[0].body);
    expect(q("[data-evidence-scan-error]")).toBeNull();
    expect(q("[data-evidence-scanning]")).not.toBeNull();

    await finishScan(ok({ suggestions: [SUGGESTION] }));
    expect(q("[data-evidence-results]")).not.toBeNull();
  });

  it("treats a network failure as a scan error", async () => {
    await renderBuilder();
    await startScan();
    await act(async () => { generateCalls[0].reject(new TypeError("Failed to fetch")); });
    await flush();

    expect(q("[data-evidence-scan-error]")).not.toBeNull();
    expect(button("Try again")).not.toBeNull();
  });

  it("exposes accessible status semantics while scanning", async () => {
    await renderBuilder();
    await startScan();

    const scanning = q("[data-evidence-scanning]")!;
    expect(scanning.getAttribute("aria-busy")).toBe("true");
    const status = scanning.querySelector("[role='status']")!;
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toContain("Scanning your work activity");
    expect(q("[data-evidence-scan-helper]")!.getAttribute("aria-live")).toBe("polite");
    expect(q("[data-evidence-progress]")!.getAttribute("aria-label")).toBe("Evidence scan in progress");
    expect(q("[data-evidence-spinner]")!.getAttribute("aria-hidden")).toBe("true");
  });

  it("restricts animation to motion-safe and keeps a static fallback for reduced motion", async () => {
    await renderBuilder();
    await startScan();

    const spinner = q("[data-evidence-spinner]")!;
    expect(spinner.getAttribute("class")).toContain("motion-safe:animate-spin");
    expect(spinner.getAttribute("class")).not.toMatch(/(^|\s)animate-spin/);
    const fill = q("[data-evidence-progress] > div")!;
    expect(fill.className).toContain("motion-safe:animate-[indeterminate");
    expect(fill.className).toContain("motion-reduce:opacity-40");
    expect(fill.className).not.toMatch(/(^|\s)animate-\[/);
  });

  it("still shows previously stored suggestions on load without scanning", async () => {
    await renderBuilder([SUGGESTION]);
    expect(q("[data-evidence-results]")!.textContent).toContain(SUGGESTION.achievement_text);
    expect(q("[data-evidence-scanning]")).toBeNull();
    expect(generateCalls).toHaveLength(0);
  });
});

describe("EvidenceBuilder static guards", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "components/appraisal/EvidenceBuilder.tsx"), "utf8");

  it("does not fake progress or use browser alerts", () => {
    expect(src).not.toMatch(/aria-valuenow/);
    expect(src).not.toMatch(/\balert\(/);
    expect(src).not.toMatch(/bg-gradient|shadow-glow|animate-pulse-glow/);
  });

  it("keeps the same scan request", () => {
    expect(src).toContain('fetch("/api/evidence/generate-suggestions", {');
    expect(src.match(/fetch\(/g)).toHaveLength(4);
  });
});
