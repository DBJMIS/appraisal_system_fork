// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ACTIVE_FACTORS, CATEGORY_TYPES, factorRatingsResponse, type CategoryType } from "../helpers/factor-fixtures";

const mocks = vi.hoisted(() => ({ browserCreateClient: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ createClient: mocks.browserCreateClient }));

import { CoreCompetenciesSection } from "@/components/appraisal/CoreCompetenciesSection";
import { ProductivitySection } from "@/components/appraisal/ProductivitySection";
import { LeadershipSection } from "@/components/appraisal/LeadershipSection";
import { TechnicalCompetenciesSection } from "@/components/appraisal/TechnicalCompetenciesSection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type SectionProps = {
  appraisalId: string;
  canEditSelfRatings: boolean;
  canEditManagerRatings: boolean;
  canEditWeights?: boolean;
};

const SECTIONS: Record<CategoryType, { component: ComponentType<SectionProps>; emptyMessage: string }> = {
  core: { component: CoreCompetenciesSection, emptyMessage: "No core competency factors configured" },
  productivity: { component: ProductivitySection, emptyMessage: "No productivity factors configured" },
  leadership: { component: LeadershipSection, emptyMessage: "No leadership factors configured" },
};

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function routeFetch(routes: Record<string, { body: unknown; status?: number }>) {
  fetchMock = vi.fn(async (url: string) => {
    const match = Object.entries(routes).find(([suffix]) => String(url).endsWith(suffix));
    if (!match) throw new Error(`unexpected fetch ${url}`);
    return jsonResponse(match[1].body, match[1].status ?? 200);
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

describe.each(CATEGORY_TYPES)("%s section with zero saved ratings", (type) => {
  const { component, emptyMessage } = SECTIONS[type];
  const props: SectionProps = { appraisalId: "a-1", canEditSelfRatings: true, canEditManagerRatings: false, canEditWeights: false };
  const ownFactors = ACTIVE_FACTORS.filter((f) => f.id.startsWith(`${type}-`));
  const otherFactors = ACTIVE_FACTORS.filter((f) => !f.id.startsWith(`${type}-`));

  it("renders one row per configured factor from the API response", async () => {
    routeFetch({ "/api/appraisals/a-1/factor-ratings": { body: factorRatingsResponse() } });
    await render(createElement(component, props));

    const text = container.textContent ?? "";
    expect(text).not.toContain(emptyMessage);
    for (const f of ownFactors) expect(text).toContain(f.name);
    for (const f of otherFactors) expect(text).not.toContain(f.name);
    const factorRows = [...container.querySelectorAll("tbody tr")].filter(
      (tr) => tr.querySelector("td")?.textContent !== "Total"
    );
    expect(factorRows).toHaveLength(ownFactors.length);
    expect(mocks.browserCreateClient).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith("/api/appraisals/a-1/factor-ratings");
  });

  it("orders factors by display_order", async () => {
    routeFetch({ "/api/appraisals/a-1/factor-ratings": { body: factorRatingsResponse() } });
    await render(createElement(component, props));
    const rendered = [...container.querySelectorAll("tbody tr")]
      .map((tr) => tr.querySelector("td")?.textContent ?? "")
      .filter((t) => t !== "Total");
    const expected = [...ownFactors].sort((a, b) => a.display_order - b.display_order).map((f) => f.name);
    expect(rendered.map((t) => expected.find((n) => t.startsWith(n)))).toEqual(expected);
  });

  it("overlays a saved weight over the master weight", async () => {
    const target = ownFactors[0];
    routeFetch({
      "/api/appraisals/a-1/factor-ratings": {
        body: factorRatingsResponse({
          ratings: [{ factor_id: target.id, self_rating_code: "8", manager_rating_code: null, self_comments: "saved comment", manager_comments: null, weight: 42 }],
        }),
      },
    });
    await render(createElement(component, { ...props, canEditSelfRatings: false }));
    const row = [...container.querySelectorAll("tbody tr")].find((tr) => tr.textContent?.includes(target.name));
    expect(row?.textContent).toContain("42");
    expect(row?.textContent).toContain("saved comment");
    expect(row?.textContent).toContain("33.6");
  });

  it("shows the existing empty state when the API returns no factors", async () => {
    routeFetch({ "/api/appraisals/a-1/factor-ratings": { body: factorRatingsResponse({ factors: [] }) } });
    await render(createElement(component, props));
    expect(container.textContent).toContain(emptyMessage);
  });
});

describe("Technical competencies rating scale", () => {
  const competencies = [
    { id: "t-1", name: "Budgeting", required_level: "6", weight: 50, self_rating: null, manager_rating: "8", self_comments: null, manager_comments: null, display_order: 1 },
    { id: "t-2", name: "Reporting", required_level: "4", weight: 50, self_rating: null, manager_rating: null, self_comments: null, manager_comments: null, display_order: 2 },
  ];
  const props = { appraisalId: "a-1", canEditSetup: true, canDeleteCompetencies: false, canEditSelfRatings: false, canEditManagerRatings: false };

  it("takes the rating scale from the server response", async () => {
    routeFetch({
      "/api/appraisals/a-1/technical-competencies": { body: { competencies } },
      "/api/appraisals/a-1/factor-ratings": { body: factorRatingsResponse() },
    });
    await render(createElement(TechnicalCompetenciesSection, props));

    const requiredLevel = container.querySelector("tbody tr select") as HTMLSelectElement;
    expect(requiredLevel.options).toHaveLength(10);
    const budgetingRow = [...container.querySelectorAll("tbody tr")].find((tr) => tr.textContent?.includes("40.0"));
    expect(budgetingRow).toBeDefined();
    expect(fetchMock).toHaveBeenCalledWith("/api/appraisals/a-1/factor-ratings");
    expect(mocks.browserCreateClient).not.toHaveBeenCalled();
  });

  it("still loads competencies when the rating scale request fails", async () => {
    routeFetch({
      "/api/appraisals/a-1/technical-competencies": { body: { competencies } },
      "/api/appraisals/a-1/factor-ratings": { body: { error: "forbidden" }, status: 403 },
    });
    await render(createElement(TechnicalCompetenciesSection, props));
    expect(container.textContent).not.toContain("Failed to load");
    expect(container.querySelectorAll("tbody tr select")).toHaveLength(2);
  });
});
