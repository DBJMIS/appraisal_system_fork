// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import fs from "node:fs";
import path from "node:path";
import { ACTIVE_FACTORS, CATEGORY_TYPES, factorRatingsResponse, type CategoryType } from "../helpers/factor-fixtures";

const mocks = vi.hoisted(() => ({ browserCreateClient: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ createClient: mocks.browserCreateClient }));

import { CoreCompetenciesSection } from "@/components/appraisal/CoreCompetenciesSection";
import { ProductivitySection } from "@/components/appraisal/ProductivitySection";
import { LeadershipSection } from "@/components/appraisal/LeadershipSection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type SectionProps = { appraisalId: string; canEditSelfRatings: boolean; canEditManagerRatings: boolean; canEditWeights?: boolean };

const SECTIONS: Record<CategoryType, { component: ComponentType<SectionProps>; title: string; factorLabel: string; commentHeader: string; file: string }> = {
  core: { component: CoreCompetenciesSection, title: "Core Competencies", factorLabel: "Competency", commentHeader: "Your Comment", file: "CoreCompetenciesSection" },
  productivity: { component: ProductivitySection, title: "Productivity Assessment", factorLabel: "Factor", commentHeader: "Your Comment", file: "ProductivitySection" },
  leadership: { component: LeadershipSection, title: "Leadership Assessment", factorLabel: "Area of Focus", commentHeader: "Your Comments / Evidence", file: "LeadershipSection" },
};

async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

function stubFetch(getBody: unknown) {
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") return { ok: true, status: 200, json: async () => ({ success: true }) };
    return { ok: true, status: 200, json: async () => getBody };
  });
  vi.stubGlobal("fetch", fetchMock);
}

async function render(element: ReturnType<typeof createElement>) {
  await act(async () => {
    root.render(element);
  });
  for (let i = 0; i < 20 && /Loading/.test(container.textContent ?? ""); i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function setNativeValue(el: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function postedRatings() {
  const call = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
  return JSON.parse(String((call![1] as RequestInit).body)).ratings as Record<string, unknown>[];
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

describe.each(CATEGORY_TYPES)("%s assessment grid", (type) => {
  const { component, title, factorLabel, commentHeader, file } = SECTIONS[type];
  const own = ACTIVE_FACTORS.filter((f) => f.id.startsWith(`${type}-`)).sort((a, b) => a.display_order - b.display_order);

  it("renders a structured grid with a text-only heading and employee/manager columns", async () => {
    stubFetch(factorRatingsResponse());
    await render(createElement(component, { appraisalId: "a-1", canEditSelfRatings: true, canEditManagerRatings: false }));
    expect(container.querySelector("h2")?.textContent).toBe(title);
    expect(container.querySelector("h2")?.parentElement?.querySelector("svg")).toBeNull();
    const headers = [...container.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(headers).toEqual([factorLabel, "Weight", "Your Rating", commentHeader, "Manager Rating", "Score"]);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(own.length);
    expect(container.querySelector("tfoot td")?.textContent).toBe("Total");
    expect(read(`components/appraisal/${file}.tsx`)).not.toMatch(/linear-gradient|#3b82f6|boxShadow/);
  });

  it("employee rating click, comment and save send the same payload shape as before", async () => {
    stubFetch(factorRatingsResponse());
    await render(createElement(component, { appraisalId: "a-1", canEditSelfRatings: true, canEditManagerRatings: false }));
    const target = own[0];

    const select = container.querySelector(`select[aria-label="${target.name} employee rating"]`) as HTMLSelectElement;
    await choose(select, "7");
    expect(select.value).toBe("7");

    const comment = container.querySelector(`textarea[aria-label^="${target.name} employee"]`) as HTMLTextAreaElement;
    await act(async () => setNativeValue(comment, "strong delivery"));

    const save = [...container.querySelectorAll("button")].find((b) => b.textContent === "Save Ratings")!;
    await act(async () => save.click());
    for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    const posted = postedRatings();
    expect(posted).toHaveLength(own.length);
    const row = posted.find((r) => r.factor_id === target.id)!;
    expect(row).toMatchObject({ self_rating_code: "7", self_comments: "strong delivery", manager_rating_code: null, manager_comments: null });
    expect(fetchMock).toHaveBeenCalledWith("/api/appraisals/a-1/factor-ratings", expect.objectContaining({ method: "POST" }));
  });

  it("manager edits only the manager fields when self fields are read-only", async () => {
    const target = own[0];
    stubFetch(factorRatingsResponse({ ratings: [{ factor_id: target.id, self_rating_code: "6", manager_rating_code: null, self_comments: "self text", manager_comments: null, weight: 20 }] }));
    await render(createElement(component, { appraisalId: "a-1", canEditSelfRatings: false, canEditManagerRatings: true }));

    expect(container.querySelector(`[aria-label="${target.name} employee rating"]`)).toBeNull();
    const row = [...container.querySelectorAll("tbody tr")].find((tr) => tr.textContent?.includes(target.name))!;
    expect(row.textContent).toContain("6");
    expect(row.textContent).toContain("Meets expectations");
    expect(row.textContent).toContain("self text");

    await choose(container.querySelector(`select[aria-label="${target.name} manager rating"]`) as HTMLSelectElement, "9");
    expect(row.textContent).toContain("↑3");
    // score = weight 20 × factor 0.9 from the manager rating
    expect(row.textContent).toContain("18.0");
  });

  it("weight edits still flow through the section's weight rule", async () => {
    stubFetch(factorRatingsResponse());
    await render(createElement(component, { appraisalId: "a-1", canEditSelfRatings: false, canEditManagerRatings: false, canEditWeights: true }));
    const input = container.querySelector(`input[aria-label="${own[0].name} weight"]`) as HTMLInputElement;
    await act(async () => setNativeValue(input, ""));
    expect(input.value).toBe("0");
  });
});

describe("Technical competencies grid", () => {
  const competencies = [
    { id: "t-1", name: "Budgeting", required_level: "6", weight: 60, self_rating: "5", manager_rating: "8", self_comments: "own view", manager_comments: null, display_order: 0 },
    { id: "t-2", name: "Reporting", required_level: "4", weight: 40, self_rating: null, manager_rating: null, self_comments: null, manager_comments: null, display_order: 1 },
  ];
  type TechProps = { appraisalId: string; canEditSetup: boolean; canDeleteCompetencies: boolean; canEditSelfRatings: boolean; canEditManagerRatings: boolean };
  const base: TechProps = { appraisalId: "a-1", canEditSetup: false, canDeleteCompetencies: false, canEditSelfRatings: false, canEditManagerRatings: false };

  let techFetch: ReturnType<typeof vi.fn>;
  function stubTech() {
    techFetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("factor-ratings")) return { ok: true, status: 200, json: async () => factorRatingsResponse() };
      if (init?.method) return { ok: true, status: 200, json: async () => ({ success: true }) };
      return { ok: true, status: 200, json: async () => ({ competencies }) };
    });
    vi.stubGlobal("fetch", techFetch);
  }
  const renderTech = async (props: Partial<TechProps>) => {
    stubTech();
    const { TechnicalCompetenciesSection } = await import("@/components/appraisal/TechnicalCompetenciesSection");
    await render(createElement(TechnicalCompetenciesSection, { ...base, ...props }));
  };
  const flush = async () => {
    for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  };

  it("separates competency, required level, weight, employee, manager and score columns", async () => {
    await renderTech({});
    const headers = [...container.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(headers).toEqual(["Competency", "Required", "Weight", "Employee Rating", "Employee Comment", "Manager Rating", "Score"]);
    const [first] = container.querySelectorAll("tbody tr");
    expect(first.textContent).toContain("Budgeting");
    expect(first.textContent).toContain("own view");
    // score = weight 60 × factor 0.8 (manager rating takes precedence)
    expect(first.textContent).toContain("48.0");
    expect(container.querySelector("tfoot")?.textContent).toContain("48.0");
    expect(container.querySelector("tfoot")?.textContent).toContain("100");
    expect(container.textContent).not.toContain("Save Ratings");
    expect(container.textContent).not.toContain("Add Technical Competency");
  });

  it("setup edits and save send the same PUT payload as before", async () => {
    await renderTech({ canEditSetup: true });
    const name = container.querySelector('input[aria-label="Competency 1 name"]') as HTMLInputElement;
    await act(async () => setNativeValue(name, "Budget control"));
    const level = container.querySelector('select[aria-label="Competency 1 required level"]') as HTMLSelectElement;
    await act(async () => {
      level.value = "8";
      level.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const weight = container.querySelector('input[aria-label="Budget control weight"]') as HTMLInputElement;
    await act(async () => setNativeValue(weight, "55"));
    expect(container.textContent).toContain("Must equal 100%");

    const save = [...container.querySelectorAll("button")].find((b) => b.textContent === "Save Ratings")!;
    expect(save.disabled).toBe(true);
    const weight2 = container.querySelector('input[aria-label="Reporting weight"]') as HTMLInputElement;
    await act(async () => setNativeValue(weight2, "45"));
    expect(save.disabled).toBe(false);
    await act(async () => save.click());
    await flush();

    const put = techFetch.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PUT")!;
    expect(put[0]).toBe("/api/appraisals/a-1/technical-competencies");
    expect(JSON.parse(String((put[1] as RequestInit).body)).competencies[0]).toEqual({
      id: "t-1", name: "Budget control", required_level: "8", self_rating: "5", manager_rating: "8", self_comments: "own view", manager_comments: null, weight: 55,
    });
  });

  it("add and remove call the same endpoints", async () => {
    await renderTech({ canEditSetup: true, canDeleteCompetencies: true });
    await act(async () => ([...container.querySelectorAll("button")].find((b) => b.textContent === "Remove" && b.getAttribute("aria-label") === "Remove Reporting")!).click());
    await flush();
    expect(techFetch).toHaveBeenCalledWith("/api/appraisals/a-1/technical-competencies?competencyId=t-2", { method: "DELETE" });

    await act(async () => ([...container.querySelectorAll("button")].find((b) => b.textContent === "Add Technical Competency")!).click());
    const nameInput = document.getElementById("comp-name") as HTMLInputElement;
    await act(async () => setNativeValue(nameInput, "Forecasting"));
    await act(async () => ([...document.querySelectorAll("button")].find((b) => b.textContent === "Add Competency")!).click());
    await flush();
    const post = techFetch.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST")!;
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({ name: "Forecasting", required_level: "6", display_order: 2 });
  });

  it("manager rating edits the manager field only", async () => {
    await renderTech({ canEditManagerRatings: true });
    expect(container.querySelector('[aria-label="Reporting employee rating"]')).toBeNull();
    await choose(container.querySelector('select[aria-label="Reporting manager rating"]') as HTMLSelectElement, "10");
    const row = container.querySelectorAll("tbody tr")[1];
    // 40 × 1.0
    expect(row.textContent).toContain("40.0");
    expect(read("components/appraisal/TechnicalCompetenciesSection.tsx")).not.toMatch(/linear-gradient|style=\{/);
  });
});
