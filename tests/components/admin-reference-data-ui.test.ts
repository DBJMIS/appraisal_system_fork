// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AdminPanel } from "@/components/admin/admin-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const REFERENCE_LOAD_ERROR = "Could not load competencies, rating scale or recommendation rules. Please try again.";

const categories = [
  { id: "c1", name: "Core", category_type: "core", applies_to: "both", active: true },
  { id: "c2", name: "Leadership", category_type: "leadership", applies_to: "manager_only", active: true },
  { id: "c3", name: "Technical", category_type: "technical", applies_to: "both", active: true },
];
const factors = Array.from({ length: 15 }, (_, i) => ({
  id: `f${i + 1}`,
  category_id: categories[i % 3].id,
  name: `Factor ${i + 1}`,
  description: null,
  display_order: i + 1,
  weight: 1,
  active: true,
}));
const ratingScale = Array.from({ length: 10 }, (_, i) => ({
  id: `r${i + 1}`, code: String(10 - i), factor: (10 - i) / 10, label: `Label ${10 - i}`,
}));
const rules = [{ id: "rule-1", rating_label: "Exceeds", recommendation: "Promote", description: null, active: true }];
const FULL = { categories, factors, ratingScale, rules };
const EMPTY = { categories: [], factors: [], ratingScale: [], rules: [] };

type Reference = { status: number; body: unknown };
let reference: Reference;
let writeResponse: Reference;
const fetchMock = vi.fn();

function respond({ status, body }: Reference) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

let container: HTMLDivElement;
let root: Root;

const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
};

async function render() {
  await act(async () => root.render(createElement(AdminPanel)));
  await flush();
}

async function openTab(label: string) {
  const tab = [...container.querySelectorAll("button")].find((b) => b.textContent === label)!;
  await act(async () => tab.click());
}

const bodyRows = (cardTitle: string) => {
  const heading = [...container.querySelectorAll("*")].find((el) => el.children.length === 0 && el.textContent === cardTitle)!;
  let node: Element | null = heading;
  while (node && !node.querySelector("table")) node = node.parentElement;
  return [...node!.querySelector("table")!.querySelectorAll("tbody tr")];
};
const emptyStates = () => [...container.querySelectorAll("[data-empty-state]")].map((el) => el.textContent);
const banner = () => container.textContent ?? "";
const button = (text: string, scope: ParentNode = container) =>
  [...scope.querySelectorAll("button")].filter((b) => b.textContent === text);
const referenceCalls = () =>
  fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/admin/reference-data/"));

beforeEach(() => {
  vi.clearAllMocks();
  reference = { status: 200, body: FULL };
  writeResponse = { status: 200, body: { ok: true } };
  fetchMock.mockImplementation((url: string) => {
    if (url === "/api/admin/cycles" || url === "/api/admin/feedback/cycles") return respond({ status: 200, body: [] });
    if (url === "/api/admin/reference-data") return respond(reference);
    if (url.startsWith("/api/admin/reference-data/")) return respond(writeResponse);
    return respond({ status: 404, body: {} });
  });
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("HR admin reference data UI", () => {
  it("loads reference data from the HR/admin API, not the browser Supabase client", async () => {
    await render();
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/reference-data");
  });

  it("renders 3 categories and 15 factors", async () => {
    await render();
    await openTab("Competencies");
    expect(bodyRows("Competency Categories")).toHaveLength(3);
    expect(bodyRows("Competency Factors")).toHaveLength(15);
    expect(container.textContent).toContain("manager only");
    expect(emptyStates()).toEqual([]);
  });

  it("renders 10 rating scale rows", async () => {
    await render();
    await openTab("Rating scale");
    expect(bodyRows("Rating Scale")).toHaveLength(10);
  });

  it("renders 1 recommendation rule", async () => {
    await render();
    await openTab("Recommendation rules");
    const rows = bodyRows("Recommendation Rules");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("Exceeds");
  });

  it("shows concise empty states when tables are genuinely empty", async () => {
    reference = { status: 200, body: EMPTY };
    await render();
    expect(banner()).not.toContain(REFERENCE_LOAD_ERROR);
    await openTab("Competencies");
    expect(emptyStates()).toEqual(["No competency categories configured.", "No competency factors configured."]);
    await openTab("Rating scale");
    expect(emptyStates()).toEqual(["No rating scale entries configured."]);
    await openTab("Recommendation rules");
    expect(emptyStates()).toEqual(["No recommendation rules configured."]);
  });

  it("shows the admin error banner on a failed load instead of looking empty", async () => {
    reference = { status: 500, body: { error: "Could not load reference data. Please try again.", code: "DB_ERROR" } };
    await render();
    expect(banner()).toContain(REFERENCE_LOAD_ERROR);
    await openTab("Competencies");
    expect(emptyStates()).not.toContain("No competency categories configured.");
    expect(emptyStates()).toEqual(["Competency categories could not be loaded.", "Competency factors could not be loaded."]);
    await openTab("Rating scale");
    expect(emptyStates()).toEqual(["Rating scale could not be loaded."]);
  });

  it("does not surface raw database errors from the API", async () => {
    reference = { status: 500, body: { error: "permission denied for table rating_scale" } };
    await render();
    expect(banner()).toContain(REFERENCE_LOAD_ERROR);
    expect(banner()).not.toContain("permission denied");
  });

  it("preserves already-loaded data when a reload fails", async () => {
    await render();
    reference = { status: 500, body: { error: "x" } };
    const refresh = [...container.querySelectorAll("button")].find((b) => b.querySelector("svg") && !b.textContent?.trim())!;
    await act(async () => refresh.click());
    await flush();
    expect(banner()).toContain(REFERENCE_LOAD_ERROR);
    await openTab("Competencies");
    expect(bodyRows("Competency Categories")).toHaveLength(3);
    expect(bodyRows("Competency Factors")).toHaveLength(15);
  });

  it("does not crash when applies_to is null and shows a dash", async () => {
    reference = {
      status: 200,
      body: { ...FULL, categories: [{ id: "c1", name: "Core", category_type: "core", applies_to: null, active: true }] },
    };
    await render();
    await openTab("Competencies");
    const rows = bodyRows("Competency Categories");
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelectorAll("td")[2].textContent).toBe("—");
  });

  it("toggles a factor through the factor API", async () => {
    await render();
    await openTab("Competencies");
    await act(async () => button("Deactivate")[0].click());
    await flush();
    expect(referenceCalls()[0][0]).toBe("/api/admin/reference-data/factors/f1");
    expect(referenceCalls()[0][1]).toMatchObject({ method: "PATCH", body: JSON.stringify({ active: false }) });
    expect(banner()).toContain("Factor updated.");
  });

  it("toggles a rule through the rule API", async () => {
    await render();
    await openTab("Recommendation rules");
    await act(async () => button("Deactivate")[0].click());
    await flush();
    expect(referenceCalls()[0][0]).toBe("/api/admin/reference-data/rules/rule-1");
    expect(referenceCalls()[0][1]).toMatchObject({ method: "PATCH", body: JSON.stringify({ active: false }) });
  });

  it("deletes a category through the category API and shows the in-use message", async () => {
    writeResponse = {
      status: 409,
      body: { error: "Cannot delete category: It has related factors. Delete the factors first.", code: "IN_USE" },
    };
    await render();
    await openTab("Competencies");
    const trash = bodyRows("Competency Categories")[0].querySelectorAll("button")[1] as HTMLButtonElement;
    await act(async () => trash.click());
    await flush();
    const confirm = button("Delete", document.body)[0];
    await act(async () => confirm.click());
    await flush();
    expect(referenceCalls()[0][0]).toBe("/api/admin/reference-data/categories/c1");
    expect(referenceCalls()[0][1]).toMatchObject({ method: "DELETE" });
    expect(banner()).toContain("Cannot delete category: It has related factors. Delete the factors first.");
  });

  it("shows a friendly error when a write returns not found (zero rows)", async () => {
    writeResponse = { status: 404, body: { error: "Rule not found. It may have been deleted.", code: "NOT_FOUND" } };
    await render();
    await openTab("Recommendation rules");
    await act(async () => button("Deactivate")[0].click());
    await flush();
    expect(banner()).toContain("Rule not found. It may have been deleted.");
    expect(bodyRows("Recommendation Rules")).toHaveLength(1);
  });
});
