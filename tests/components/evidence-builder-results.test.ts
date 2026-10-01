// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import fs from "node:fs";
import path from "node:path";

import { EvidenceBuilder } from "@/components/appraisal/EvidenceBuilder";
import type { ScanReport } from "@/types/evidence";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type FetchResult = { ok: boolean; status: number; json: () => Promise<unknown> };

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

async function flush() {
  for (let i = 0; i < 20; i++) await act(async () => { await Promise.resolve(); });
}

const ok = (body: unknown): FetchResult => ({ ok: true, status: 200, json: async () => body });

const GENERATED_AT = "2026-10-01T16:30:00.000Z";

function scanReport(overrides: Partial<Record<string, Partial<ScanReport["sources"][number]>>> = {}): ScanReport {
  const sources: ScanReport["sources"] = [
    { name: "Appraisal / Workplan", attempted: true, collected: 8, status: "live", note: "Reads workplan objectives, tasks, and outcomes from Supabase" },
    { name: "Calendar / Meetings", attempted: true, collected: 0, status: "live", note: "Reading calendar events via Microsoft Graph" },
    { name: "SharePoint / OneDrive", attempted: true, collected: 0, status: "live", note: "Reading OneDrive and SharePoint files via Microsoft Graph" },
    { name: "Email (Sent Items)", attempted: true, collected: 0, status: "live", note: "Sent mail matched to workplan objectives via Microsoft Graph" },
  ].map((s) => ({ ...s, ...(overrides[s.name] ?? {}) })) as ScanReport["sources"];
  return { generatedAt: GENERATED_AT, totalCollected: sources.reduce((n, s) => n + s.collected, 0), sources };
}

const DIAGNOSIS = {
  appraisal: { workplanItemsConsidered: 8, rowsWithActualResult: 0, rowsTaskOnly: 8, stored: 8, activityDateRange: "2026-01-05 → 2026-09-30" },
  calendar: { graphEventsReturned: 14, stored: 0, dropped: { outsideWindow: 3, declined: 0, allDay: 2 } },
  sharePoint: { oneDrive: { raw: 5, stored: 0 }, sharePoint: { raw: 2, stored: 0 } },
  clustering: {
    itemsInWindow: 8,
    rawClusterCount: 3,
    qualifyingClusterCount: 0,
    disqualified: [{ topic: "Budget review", itemCount: 2, score: 60, reason: "below threshold" }],
  },
};

const SUGGESTIONS = [
  { id: "s-1", achievement_text: "Delivered the quarterly reporting dashboard.", confidence_level: "high", evidence_summary: ["task_completed: Dashboard"] },
  { id: "s-2", achievement_text: "Completed the policy refresh.", confidence_level: "medium", evidence_summary: ["task_completed: Policy"] },
];

async function scan(response: Record<string, unknown>) {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/evidence/generate-suggestions") return ok(response);
    if (init?.method === "PATCH" || init?.method === "POST") return ok({ success: true });
    return ok({ suggestions: [] });
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
  const generate = [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Generate")!;
  await act(async () => { generate.click(); });
  await flush();
}

const q = (sel: string) => container.querySelector(sel);
const qa = (sel: string) => [...container.querySelectorAll(sel)];
const stat = (id: string) => q(`[data-evidence-stat="${id}"]`)!;
const source = (kind: string) => q(`[data-evidence-source="${kind}"]`)!;

function diagnosticStats(group: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const el of qa(`[data-diagnostic-group="${group}"] [data-diagnostic-stat]`)) {
    out[el.querySelector("dt")!.textContent!] = el.querySelector("dd")!.textContent!;
  }
  return out;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("EvidenceBuilder results — outcome summary", () => {
  it("summarises an empty scan with friendly wording, metrics and helper text", async () => {
    await scan({ suggestions: [], scanReport: scanReport(), diagnosis: DIAGNOSIS });

    const summary = q("[data-evidence-summary]")!;
    expect(summary.querySelector("h4")!.textContent).toBe("Scan complete");
    expect(summary.querySelector("time")!.getAttribute("dateTime")).toBe(GENERATED_AT);
    expect(q("[data-evidence-result]")!.textContent).toBe("No evidence suggestions found yet");
    expect(summary.textContent).toContain(
      "We scanned your connected work sources but did not find strong evidence suggestions for this review period."
    );
    expect(q("[data-evidence-empty]")!.getAttribute("role")).toBe("status");

    const helper = q("[data-evidence-empty-helper]")!;
    expect(helper.textContent).toContain("You can still add evidence manually.");
    expect(helper.textContent).toContain("Updating Actual YTD entries may improve future scan results.");

    expect(stat("sources").querySelector("dt")!.textContent).toBe("Sources checked");
    expect(stat("sources").querySelector("dd")!.textContent).toBe("4");
    expect(stat("collected").querySelector("dt")!.textContent).toBe("Total items collected");
    expect(stat("collected").querySelector("dd")!.textContent).toBe("8");
    expect(stat("suggestions").querySelector("dt")!.textContent).toBe("Evidence suggestions found");
    expect(stat("suggestions").querySelector("dd")!.textContent).toBe("0");

    expect(container.textContent).not.toContain("No significant activity clusters");
    expect(q("[data-evidence-results]")).toBeNull();
  });

  it("summarises a scan with suggestions and lists them under their own heading", async () => {
    await scan({ suggestions: SUGGESTIONS, scanReport: scanReport(), diagnosis: DIAGNOSIS });

    expect(q("[data-evidence-result]")!.textContent).toBe("2 evidence suggestions found");
    expect(stat("suggestions").querySelector("dd")!.textContent).toBe("2");
    expect(q("[data-evidence-empty-helper]")).toBeNull();
    expect(q("[data-evidence-empty]")).toBeNull();

    const results = q("[data-evidence-results]")!;
    const heading = results.querySelector("h4")!;
    expect(heading.textContent?.trim()).toBe("Suggested evidence");
    expect(results.getAttribute("aria-labelledby")).toBe(heading.id);
    expect(results.textContent).toContain(SUGGESTIONS[0].achievement_text);
    expect(results.textContent).toContain(SUGGESTIONS[1].achievement_text);
  });

  it("keeps the scan outcome stable as suggestions are accepted", async () => {
    await scan({ suggestions: SUGGESTIONS, scanReport: scanReport() });
    const accept = [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Accept")!;
    await act(async () => { accept.click(); });
    await flush();

    expect(q("[data-evidence-results]")!.textContent).not.toContain(SUGGESTIONS[0].achievement_text);
    expect(q("[data-evidence-result]")!.textContent).toBe("2 evidence suggestions found");
  });

  it("orders sections summary → suggestions → sources", async () => {
    await scan({ suggestions: SUGGESTIONS, scanReport: scanReport() });
    const order = qa("[data-evidence-summary], [data-evidence-results], [data-evidence-sources]").map((el) =>
      el.hasAttribute("data-evidence-summary") ? "summary" : el.hasAttribute("data-evidence-results") ? "results" : "sources"
    );
    expect(order).toEqual(["summary", "results", "sources"]);
  });

  it("falls back to the friendly empty state when no scan report is returned", async () => {
    await scan({ suggestions: [] });
    expect(q("[data-evidence-summary]")).toBeNull();
    const empty = q("[data-evidence-empty]")!;
    expect(empty.textContent).toContain("No evidence suggestions found yet");
    expect(empty.textContent).toContain("You can still add evidence manually.");
  });
});

describe("EvidenceBuilder results — source rows", () => {
  it("renders one labelled row per source with icon, status, count and explanation", async () => {
    await scan({ suggestions: [], scanReport: scanReport() });

    const section = q("[data-evidence-sources]")!;
    expect(section.querySelector("h4")!.textContent).toBe("Sources checked");
    expect(section.textContent).toContain("We checked your workplan, calendar, SharePoint/OneDrive and sent email activity.");

    const rows = qa("[data-evidence-source]");
    expect(rows.map((r) => r.getAttribute("data-evidence-source"))).toEqual(["workplan", "calendar", "files", "email"]);
    for (const row of rows) {
      expect(row.querySelector("svg")!.closest("[aria-hidden='true']")).not.toBeNull();
      expect(row.querySelector("[data-source-status]")!.textContent).toBe("Checked");
      expect(row.querySelector("[data-source-status]")!.getAttribute("data-source-status")).toBe("success");
    }

    const expectRow = (kind: string, name: string, count: string, explanation: string) => {
      const row = source(kind);
      expect(row.querySelector("[data-source-name]")!.textContent).toBe(name);
      expect(row.querySelector("[data-source-count]")!.textContent).toBe(count);
      expect(row.querySelector("[data-source-explanation]")!.textContent).toBe(explanation);
      expect(row.getAttribute("aria-label")).toBe(`${name}: Checked, ${count}`);
    };
    expectRow("workplan", "Appraisal / Workplan", "8 items found", "Read workplan objectives, tasks and actual entries");
    expectRow("calendar", "Calendar / Meetings", "0 items found", "No relevant calendar activity detected");
    expectRow("files", "SharePoint / OneDrive", "0 items found", "No relevant file activity detected");
    expectRow("email", "Email (Sent Items)", "0 items found", "No matching sent-email activity detected");
  });

  it("reflects found, not-connected, error and not-attempted sources honestly", async () => {
    await scan({
      suggestions: [],
      scanReport: scanReport({
        "Calendar / Meetings": { collected: 1 },
        "SharePoint / OneDrive": { status: "stub", note: "Requires Azure Graph OAuth — not yet connected" },
        "Email (Sent Items)": { attempted: false },
      }),
    });

    expect(source("calendar").querySelector("[data-source-count]")!.textContent).toBe("1 item found");
    expect(source("calendar").querySelector("[data-source-explanation]")!.textContent).toBe("Relevant calendar activity detected");

    const files = source("files");
    expect(files.querySelector("[data-source-status]")!.textContent).toBe("Not connected");
    expect(files.querySelector("[data-source-status]")!.getAttribute("data-source-status")).toBe("muted");
    expect(files.querySelector("[data-source-explanation]")!.textContent).toBe("Not connected yet, so no activity was read");

    const email = source("email");
    expect(email.querySelector("[data-source-status]")!.textContent).toBe("Not checked");
    expect(email.querySelector("[data-source-count]")!.textContent).toBe("Not checked");

    expect(stat("sources").querySelector("dd")!.textContent).toBe("3");
    expect(q("[data-evidence-sources]")!.textContent).toContain(
      "We checked your workplan, calendar and SharePoint/OneDrive activity."
    );
  });

  it("marks an errored source with the error tone", async () => {
    await scan({ suggestions: [], scanReport: scanReport({ "Calendar / Meetings": { status: "error" } }) });
    const cal = source("calendar");
    expect(cal.querySelector("[data-source-status]")!.textContent).toBe("Error");
    expect(cal.querySelector("[data-source-status]")!.getAttribute("data-source-status")).toBe("error");
    expect(cal.querySelector("[data-source-explanation]")!.textContent).toBe("This source could not be read");
  });
});

describe("EvidenceBuilder results — technical details", () => {
  it("stays hidden unless evidence debugging is enabled", async () => {
    await scan({ suggestions: [], scanReport: scanReport(), diagnosis: DIAGNOSIS });
    expect(q("[data-evidence-details]")).toBeNull();
    expect(container.textContent).not.toContain("Pipeline diagnosis");
  });

  it("is collapsed by default after a successful scan and expands accessibly", async () => {
    vi.stubEnv("NEXT_PUBLIC_EVIDENCE_DEBUG", "true");
    await scan({ suggestions: [], scanReport: scanReport(), diagnosis: DIAGNOSIS });

    const toggle = q("[data-evidence-details-toggle]") as HTMLButtonElement;
    expect(toggle.textContent?.trim()).toBe("Technical details");
    expect(toggle.closest("h4")).not.toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(q("[data-evidence-details-panel]")).toBeNull();
    expect(container.textContent).not.toContain("Pipeline diagnosis");

    await act(async () => { toggle.click(); });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const panel = q("[data-evidence-details-panel]")!;
    expect(panel.id).toBe(toggle.getAttribute("aria-controls"));
    expect(qa("[data-evidence-details-panel] h5").length).toBeGreaterThanOrEqual(5);

    await act(async () => { toggle.click(); });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(q("[data-evidence-details-panel]")).toBeNull();
  });

  it("keeps every previous diagnostic data point as compact label/value stats", async () => {
    vi.stubEnv("NEXT_PUBLIC_EVIDENCE_DEBUG", "true");
    const report = scanReport({ "Email (Sent Items)": { attempted: false } });
    await scan({ suggestions: [], scanReport: report, diagnosis: DIAGNOSIS });
    await act(async () => { (q("[data-evidence-details-toggle]") as HTMLButtonElement).click(); });

    const sources = q('[data-diagnostic-group="sources"]')!;
    expect(sources.textContent).toContain(`Sources checked · ${new Date(GENERATED_AT).toLocaleTimeString()}`);
    expect(sources.textContent).toContain("8 total items collected");
    for (const s of report.sources) {
      const row = q(`[data-diagnostic-source="${s.name}"]`)!;
      expect(row.textContent).toContain(s.name);
      expect(row.textContent).toContain(s.status);
      expect(row.textContent).toContain(s.attempted ? `${s.collected} item` : "Not attempted");
      expect(row.textContent).toContain(s.note!);
    }

    expect(diagnosticStats("appraisal")).toEqual({
      "Workplan items": "8",
      "With actual result": "0",
      "Task only": "8",
      Stored: "8",
    });
    expect(q('[data-diagnostic-group="appraisal"]')!.textContent).toContain("Dates: 2026-01-05 → 2026-09-30");

    expect(diagnosticStats("calendar")).toEqual({
      "From Graph": "14",
      Stored: "0",
      "Dropped: outsideWindow": "3",
      "Dropped: allDay": "2",
    });

    expect(diagnosticStats("sharePoint")).toEqual({
      "OneDrive raw": "5",
      "OneDrive stored": "0",
      "SharePoint raw": "2",
      "SharePoint stored": "0",
    });

    expect(diagnosticStats("clustering")).toEqual({ "In window": "8", "Raw clusters": "3", Qualifying: "0" });
    const disq = q("[data-diagnostic-disqualified]")!;
    expect(disq.textContent).toContain('"Budget review"');
    expect(disq.textContent).toContain("2 items · score 60 · below threshold");
  });

  it("is visually quieter than the summary and sits last", async () => {
    vi.stubEnv("NEXT_PUBLIC_EVIDENCE_DEBUG", "true");
    await scan({ suggestions: [], scanReport: scanReport(), diagnosis: DIAGNOSIS });
    const sections = qa("[data-evidence-summary], [data-evidence-sources], [data-evidence-details]");
    expect(sections[sections.length - 1].hasAttribute("data-evidence-details")).toBe(true);
    expect((q("[data-evidence-details-toggle]") as HTMLElement).className).toContain("text-ds-text-secondary");
  });
});

describe("EvidenceBuilder results — heading hierarchy and static guards", () => {
  it("uses h3 for the panel and h4 for each results section", async () => {
    vi.stubEnv("NEXT_PUBLIC_EVIDENCE_DEBUG", "true");
    await scan({ suggestions: SUGGESTIONS, scanReport: scanReport(), diagnosis: DIAGNOSIS });
    expect(qa("h3").map((h) => h.textContent)).toEqual(["AI Evidence Builder"]);
    expect(qa("h4").map((h) => h.textContent?.trim())).toEqual([
      "Scan complete",
      "Suggested evidence",
      "Sources checked",
      "Technical details",
    ]);
  });

  it("does not use loud colours or gradients in the results components", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "components/appraisal/EvidenceScanResults.tsx"), "utf8");
    expect(src).not.toMatch(/gradient|shadow-glow|animate-pulse/);
    expect(src).not.toMatch(/\bfetch\(/);
  });
});
