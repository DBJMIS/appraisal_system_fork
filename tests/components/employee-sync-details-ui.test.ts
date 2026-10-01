// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { EmployeeSyncTab } from "@/components/admin/tabs/EmployeeSyncTab";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RECORDED_ID = "11111111-1111-4111-8111-111111111111";
const HISTORICAL_ID = "22222222-2222-4222-8222-222222222222";

const details = {
  added: [],
  reactivated: [{ employee_id: "B", full_name: "Bob Returned" }],
  deactivated: [
    { employee_id: "C", full_name: "Carol Chen", reason: "not_in_active_dynamics_sync" },
    { employee_id: "D", full_name: "Dan Doe", reason: "not_in_active_dynamics_sync" },
  ],
  no_appraisal: [{ employee_id: "N", full_name: "Nora New" }],
  skipped: [{ employee_id: "R-new", full_name: "Rae Rekeyed", reason: "rekeyed" }],
};

const recordedRow = {
  id: RECORDED_ID,
  triggered_by: "manual",
  triggered_at: "2026-10-01T13:00:00Z",
  status: "completed",
  employees_synced: 127,
  employees_added: 0,
  employees_deactivated: 2,
  new_employee_ids: ["N"],
  duration_ms: 16100,
  details,
};
const historicalRow = {
  ...recordedRow,
  id: HISTORICAL_ID,
  triggered_at: "2026-09-30T13:42:47Z",
  employees_deactivated: 5,
  new_employee_ids: ["X"],
  details: null,
};

const detailResponse = (row: typeof recordedRow | typeof historicalRow) => ({
  id: row.id,
  triggered_at: row.triggered_at,
  completed_at: row.triggered_at,
  triggered_by: "Manual",
  status: row.status,
  employees_synced: row.employees_synced,
  employees_added: row.employees_added,
  employees_deactivated: row.employees_deactivated,
  duration_ms: row.duration_ms,
  details: row.details,
  details_recorded: row.details !== null,
});

const fetchMock = vi.fn();
const scrollIntoView = vi.fn();
let container: HTMLDivElement;
let root: Root;

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
};

async function render() {
  await act(async () => root.render(createElement(EmployeeSyncTab)));
  await flush();
}

const rows = () => [...container.querySelectorAll("tbody tr")];
const drawer = () => document.querySelector<HTMLElement>("[data-sync-drawer]");
const section = (key: string) => document.querySelector<HTMLElement>(`[data-sync-section="${key}"]`)!;
async function click(el: Element) {
  await act(async () => (el as HTMLElement).click());
  await flush();
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockImplementation((url: string) => {
    if (url === "/api/sync/employees") return json({ log: [recordedRow, historicalRow] });
    if (url === `/api/sync/employees/${RECORDED_ID}`) return json(detailResponse(recordedRow));
    if (url === `/api/sync/employees/${HISTORICAL_ID}`) return json(detailResponse(historicalRow));
    return json({ error: "Sync run not found." }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  Element.prototype.scrollIntoView = scrollIntoView;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("Employee Sync history details", () => {
  it("keeps the existing columns and adds a narrow Details column", async () => {
    await render();
    const headers = [...container.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(headers).toEqual(["Time", "By", "Status", "Synced", "Added", "Deactivated", "No appraisal", "Duration", "Details"]);
  });

  it("View details opens the drawer with the run header", async () => {
    await render();
    await click(rows()[0].querySelector(`[data-view-details="${RECORDED_ID}"]`)!);
    expect(fetchMock).toHaveBeenCalledWith(`/api/sync/employees/${RECORDED_ID}`, { cache: "no-store" });
    const d = drawer()!;
    expect(d.getAttribute("role")).toBe("dialog");
    expect(d.textContent).toContain("Sync details");
    expect(d.textContent).toContain("Manual");
    expect(d.textContent).toContain("completed");
    expect(d.textContent).toContain("16.1s");
    expect(section("deactivated").textContent).toContain("Carol Chen");
    expect(section("deactivated").textContent).toContain("C");
  });

  it("historical run shows a compact historical block with the aggregate summary, not None", async () => {
    await render();
    await click(rows()[1].querySelector(`[data-view-details="${HISTORICAL_ID}"]`)!);
    const block = document.querySelector<HTMLElement>("[data-details-not-recorded]")!;
    expect(block.textContent).toContain("Historical sync");
    expect(block.textContent).toContain("Employee-level details were not recorded for this run.");
    expect(drawer()!.textContent).not.toContain("None");
    expect(document.querySelector("[data-sync-section]")).toBeNull();
    expect(document.querySelector("[data-sync-detail-error]")).toBeNull();
    const summary = [...document.querySelectorAll("[data-sync-summary] > div")].map((d) => [
      d.querySelector("dt")!.textContent,
      d.querySelector("dd")!.textContent,
    ]);
    expect(summary).toEqual([
      ["Synced", "127"],
      ["Added", "0"],
      ["Deactivated", "5"],
      ["No appraisal", "1"],
      ["Duration", "16.1s"],
    ]);
  });

  it("says detail capture is not enabled when the details column is absent", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/sync/employees") return json({ log: [recordedRow, historicalRow] });
      return json({ ...detailResponse(historicalRow), details_capture_enabled: false });
    });
    await render();
    await click(rows()[1].querySelector(`[data-view-details="${HISTORICAL_ID}"]`)!);
    const block = document.querySelector<HTMLElement>("[data-details-not-recorded]")!;
    expect(block.textContent).toContain("Details not recorded");
    expect(block.textContent).not.toContain("Historical sync");
    expect(block.textContent).toContain("Detail capture is not yet enabled in this environment.");
  });

  it.each([
    ["an HTTP error", () => json({ error: "Could not load sync details. Please try again." }, 500)],
    ["a network failure", () => Promise.reject(new Error("offline"))],
  ])("shows the load error, not the historical message, on %s", async (_label, failure) => {
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/sync/employees") return json({ log: [recordedRow, historicalRow] });
      return failure();
    });
    await render();
    await click(rows()[1].querySelector(`[data-view-details="${HISTORICAL_ID}"]`)!);
    expect(document.querySelector("[data-sync-detail-error]")!.textContent).toBe("Could not load sync details. Please try again.");
    expect(document.querySelector("[data-details-not-recorded]")).toBeNull();
    expect(drawer()!.textContent).not.toContain("Historical sync");
  });

  it("renders every section and its rows for a recent run with recorded details", async () => {
    await render();
    await click(rows()[0].querySelector(`[data-view-details="${RECORDED_ID}"]`)!);
    const sections = [...document.querySelectorAll<HTMLElement>("[data-sync-section]")];
    expect(sections.map((s) => s.dataset.syncSection)).toEqual(["added", "reactivated", "deactivated", "no_appraisal", "skipped"]);
    expect(sections.map((s) => s.querySelector("h3")!.textContent)).toEqual([
      "Added · 0",
      "Reactivated · 1",
      "Deactivated · 2",
      "No appraisal · 1",
      "Skipped · 1",
    ]);
    expect(section("deactivated").querySelectorAll("li")).toHaveLength(2);
    expect(section("no_appraisal").textContent).toContain("Nora New");
    expect(document.querySelector("[data-details-not-recorded]")).toBeNull();
  });

  it("makes non-zero counts clickable only when details exist", async () => {
    await render();
    const [recorded, historical] = rows();
    expect(recorded.querySelector('[data-count-link="deactivated"]')?.textContent).toBe("2");
    expect(recorded.querySelector('[data-count-link="without appraisal"]')?.textContent).toBe("1");
    expect(historical.querySelector("[data-count-link]")).toBeNull();
    expect(historical.textContent).toContain("5");
  });

  it("leaves zero counts as plain text", async () => {
    await render();
    const recorded = rows()[0];
    expect(recorded.querySelector('[data-count-link="added"]')).toBeNull();
    expect(recorded.querySelectorAll("td")[4].textContent).toBe("0");
  });

  it("clicking Deactivated opens the drawer at the Deactivated section", async () => {
    await render();
    await click(rows()[0].querySelector('[data-count-link="deactivated"]')!);
    expect(drawer()).not.toBeNull();
    expect(section("deactivated").getAttribute("data-active-section")).toBe("true");
    expect(scrollIntoView).toHaveBeenCalled();
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(section("deactivated"));
  });

  it("recorded empty sections show None", async () => {
    await render();
    await click(rows()[0].querySelector(`[data-view-details="${RECORDED_ID}"]`)!);
    expect(section("added").querySelector("[data-empty-section]")?.textContent).toBe("None");
    expect(section("reactivated").textContent).toContain("Bob Returned");
  });

  it("describes deactivation neutrally and shows no email", async () => {
    await render();
    await click(rows()[0].querySelector(`[data-view-details="${RECORDED_ID}"]`)!);
    const text = drawer()!.textContent ?? "";
    expect(section("deactivated").textContent).toContain("Not returned in the active Dynamics employee list for this sync.");
    expect(text).not.toMatch(/resign|terminat|left DBJ|removed from employment/i);
    expect(text).not.toContain("@");
    expect(section("skipped").textContent).toContain("Matched an existing record by email; employee ID updated.");
  });

  it("begins below the app header and stays beneath the top navigation layer", async () => {
    await render();
    await click(rows()[0].querySelector(`[data-view-details="${RECORDED_ID}"]`)!);
    const d = drawer()!;
    const overlay = document.querySelector<HTMLElement>("[data-sync-drawer-overlay]")!;
    expect(d.parentElement).toBe(document.body);
    expect(d.style.position).toBe("fixed");
    expect(d.style.top).toBe("var(--ds-app-header-height, 3.5rem)");
    expect(d.style.bottom).toBe("0px");
    expect(overlay.style.top).toBe("var(--ds-app-header-height, 3.5rem)");
    expect(Number(d.style.zIndex)).toBeLessThan(50);
  });

  it("keeps the header visible with title, run metadata and close button, even when loading fails", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === "/api/sync/employees") return json({ log: [recordedRow, historicalRow] });
      return json({ error: "x" }, 500);
    });
    await render();
    await click(rows()[0].querySelector(`[data-view-details="${RECORDED_ID}"]`)!);
    const header = document.querySelector<HTMLElement>("[data-sync-drawer-header]")!;
    expect(header.style.position).toBe("sticky");
    expect(header.style.top).toBe("0px");
    expect(header.style.flexShrink).toBe("0");
    expect(header.textContent).toContain("Sync details");
    expect(header.textContent).toContain("Manual");
    expect(header.textContent).toContain("completed");
    expect(header.textContent).toContain("16.1s");
    expect(header.textContent).toMatch(/2026/);
    expect(header.querySelector('[aria-label="Close"]')).not.toBeNull();
  });

  it("gives the drawer body its own vertical scroll", async () => {
    await render();
    await click(rows()[0].querySelector(`[data-view-details="${RECORDED_ID}"]`)!);
    const body = document.querySelector<HTMLElement>("[data-sync-drawer-body]")!;
    expect(body.style.overflowY).toBe("auto");
    expect(body.style.minHeight).toMatch(/^0(px)?$/);
    expect(body.style.flex).toMatch(/^1/);
  });

  it("the header-height token matches the top navigation height", () => {
    const read = (p: string) => readFileSync(join(__dirname, "..", "..", p), "utf8");
    expect(read("components/layout/top-nav.tsx")).toMatch(/sticky top-0 z-50 flex h-14/);
    expect(read("app/globals.css")).toMatch(/--ds-app-header-height:\s*3\.5rem;/);
  });

  it("closes on Escape and on the close button", async () => {
    await render();
    await click(rows()[0].querySelector(`[data-view-details="${RECORDED_ID}"]`)!);
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(drawer()).toBeNull();
    await click(rows()[0].querySelector(`[data-view-details="${RECORDED_ID}"]`)!);
    await click(document.querySelector('[aria-label="Close"]')!);
    expect(drawer()).toBeNull();
  });
});
