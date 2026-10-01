// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import fs from "node:fs";
import path from "node:path";
import { ACTIVE_FACTORS, factorRatingsResponse } from "../helpers/factor-fixtures";

vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));

import { CoreCompetenciesSection } from "@/components/appraisal/CoreCompetenciesSection";
import { ProductivitySection } from "@/components/appraisal/ProductivitySection";
import { LeadershipSection } from "@/components/appraisal/LeadershipSection";
import { TechnicalCompetenciesSection } from "@/components/appraisal/TechnicalCompetenciesSection";
import { RATING_LABELS } from "@/components/appraisal/RatingButtons";
import { DRAFT_SAVED_MS } from "@/hooks/useDraftSaveFeedback";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

async function flush() {
  for (let i = 0; i < 20; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

const core = ACTIVE_FACTORS.filter((f) => f.id.startsWith("core-")).sort((a, b) => a.display_order - b.display_order);
const rated = core[0];
const unrated = core[1];

type Access = { status: string; canEditSelfRatings: boolean; canEditManagerRatings: boolean };
const EMPLOYEE: Access = { status: "SELF_ASSESSMENT", canEditSelfRatings: true, canEditManagerRatings: false };
const MANAGER: Access = { status: "MANAGER_REVIEW", canEditSelfRatings: false, canEditManagerRatings: true };
const READ_ONLY: Access = { status: "COMPLETE", canEditSelfRatings: false, canEditManagerRatings: false };

type PostHandler = () => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

async function renderCore(access: Access, opts: { managerRating?: string | null; onPost?: PostHandler } = {}) {
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") return opts.onPost ? opts.onPost() : { ok: true, status: 200, json: async () => ({ success: true }) };
    return {
      ok: true,
      status: 200,
      json: async () =>
        factorRatingsResponse({
          ratings: [
            { factor_id: rated.id, self_rating_code: "6", manager_rating_code: opts.managerRating ?? null, self_comments: "self note", manager_comments: null, weight: 20 },
            { factor_id: unrated.id, self_rating_code: null, manager_rating_code: null, self_comments: null, manager_comments: null, weight: 80 },
          ],
        }),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  await act(async () => {
    root.render(createElement(CoreCompetenciesSection, { appraisalId: "a-1", appraisalStatus: access.status, ...access }));
  });
  await flush();
}

const rowOf = (name: string) => [...container.querySelectorAll("tbody tr")].find((tr) => tr.textContent?.includes(name))!;
const headers = () => [...container.querySelectorAll("thead th")].map((th) => th.textContent);
const saveButton = () => container.querySelector<HTMLButtonElement>("[data-save-ratings]");
const select = (label: string) => container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
async function choose(el: HTMLSelectElement, value: string) {
  await act(async () => {
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
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

describe("compact rating control", () => {
  it("is one dropdown per rating with the existing 1–10 labels and stored codes", async () => {
    await renderCore(EMPLOYEE);
    const el = select(`${unrated.name} employee rating`)!;
    expect(el.tagName).toBe("SELECT");
    const options = [...el.options];
    expect(options[0]).toMatchObject({ value: "", disabled: true, textContent: "Select rating" });
    expect(options.slice(1).map((o) => o.value)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    expect(options.slice(1).map((o) => o.textContent)).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `${n} – ${RATING_LABELS[n]}`)
    );
    expect(el.value).toBe("");
    expect(select(`${rated.name} employee rating`)!.value).toBe("6");
  });

  it("replaces the ten-button strip and the per-row 'Select a rating' helper", async () => {
    await renderCore(EMPLOYEE);
    expect(container.querySelector('[role="group"]')).toBeNull();
    expect(container.querySelector("button[aria-pressed]")).toBeNull();
    expect(container.textContent).not.toContain("Select a rating");
  });

  it("shows the rating scale once, in the section header", async () => {
    await renderCore(EMPLOYEE);
    const scales = container.querySelectorAll("[data-rating-scale]");
    expect(scales).toHaveLength(1);
    expect(scales[0].textContent).toBe("1–2 Far below · 3–4 Below · 5–6 Meets · 7–8 Exceeds · 9–10 Highly exceeds");
    expect(container.querySelector("[data-competency-header]")!.contains(scales[0])).toBe(true);
    expect(container.querySelector("[data-competency-header] p")!.textContent).toBe("Value-based and soft skill competencies");
  });

  it("clamps long descriptions to two lines in the competency cell", async () => {
    await renderCore(EMPLOYEE);
    const desc = rowOf(rated.name).querySelector("[data-competency-description]")!;
    expect(desc.className).toContain("line-clamp-2");
    expect(desc.getAttribute("title")).toBe(rated.description);
  });
});

describe("employee editable state (SELF_ASSESSMENT)", () => {
  it("rates and comments only their own fields; the manager side is a compact 'Not rated'", async () => {
    await renderCore(EMPLOYEE);
    expect(headers()).toEqual(["Competency", "Weight", "Your Rating", "Your Comment", "Manager Rating", "Score"]);
    const r = rowOf(rated.name);
    expect(r.querySelector(`select[aria-label="${rated.name} employee rating"]`)).not.toBeNull();
    expect(r.querySelector(`select[aria-label="${rated.name} manager rating"]`)).toBeNull();
    const comment = r.querySelector<HTMLTextAreaElement>('[data-comment="self"] textarea')!;
    expect(comment.value).toBe("self note");
    expect(comment.getAttribute("rows")).toBe("1");
    expect(comment.placeholder).toBe("Optional comment");
    expect(r.querySelector("[data-manager-rating] [data-not-rated]")!.textContent).toBe("Not rated");
    expect(r.querySelector('[data-comment="manager"]')).toBeNull();
  });

  it("a chosen rating is saved with the same stored code and payload shape", async () => {
    await renderCore(EMPLOYEE);
    await choose(select(`${unrated.name} employee rating`)!, "8");
    await act(async () => saveButton()!.click());
    await flush();
    const call = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST")!;
    expect(call[0]).toBe("/api/appraisals/a-1/factor-ratings");
    const ratings = JSON.parse(String((call[1] as RequestInit).body)).ratings as Record<string, unknown>[];
    expect(ratings.find((x) => x.factor_id === unrated.id)).toMatchObject({ self_rating_code: "8", manager_rating_code: null, weight: 80 });
    expect(ratings.find((x) => x.factor_id === rated.id)).toMatchObject({ self_rating_code: "6", self_comments: "self note", weight: 20 });
  });
});

describe("manager editable state (MANAGER_REVIEW)", () => {
  it("shows the employee rating and comment read-only and makes the manager rating and comment editable", async () => {
    await renderCore(MANAGER, { managerRating: "9" });
    expect(headers()).toEqual(["Competency", "Weight", "Employee Rating", "Employee Comment", "Manager Rating", "Score"]);
    const r = rowOf(rated.name);
    expect(r.querySelector(`select[aria-label="${rated.name} employee rating"]`)).toBeNull();
    expect(r.querySelector("[data-self-rating]")!.textContent).toContain("6");
    expect(r.querySelector("[data-self-rating]")!.textContent).toContain(RATING_LABELS[6]);
    expect(r.querySelector('[data-comment="self"]')!.textContent).toContain("self note");
    expect(r.querySelector('[data-comment="self"] textarea')).toBeNull();
    expect(select(`${rated.name} manager rating`)!.value).toBe("9");
    expect(r.querySelector('[data-comment="manager"] textarea')).not.toBeNull();
    expect(r.textContent).toContain("↑3");
  });
});

describe("read-only state (later stages)", () => {
  it("renders values as text with no controls and no save action", async () => {
    await renderCore(READ_ONLY, { managerRating: "8" });
    expect(container.querySelector("select, textarea, input")).toBeNull();
    expect(saveButton()).toBeNull();
    const r = rowOf(rated.name);
    expect(r.querySelector("[data-manager-rating]")!.textContent).toContain(`8${RATING_LABELS[8]}`);
    expect(rowOf(unrated.name).querySelector("[data-self-rating] [data-not-rated]")).not.toBeNull();
  });
});

describe("Score and weight columns", () => {
  it("score is right-aligned, uses the section's own value, and shows — when unrated", async () => {
    await renderCore(EMPLOYEE);
    const ratedScore = rowOf(rated.name).querySelector("[data-score]")!;
    expect(ratedScore.className).toContain("text-right");
    expect(ratedScore.textContent).toContain("12.0");
    expect(rowOf(unrated.name).querySelector("[data-score]")!.textContent).toContain("—");
    expect(container.querySelector("[data-total-score]")!.textContent).toContain("12.0");
  });

  it("weight is a narrow secondary percentage", async () => {
    await renderCore(EMPLOYEE);
    const weight = rowOf(rated.name).querySelector("[data-weight]")!;
    expect(weight.textContent).toBe("20%");
    expect(weight.className).toContain("text-ds-text-secondary");
    expect(container.querySelector("col.w-\\[7\\%\\]")).not.toBeNull();
  });
});

describe("Technical required level", () => {
  const competencies = [
    { id: "t-1", name: "Budgeting", required_level: "6", weight: 100, self_rating: null, manager_rating: null, self_comments: null, manager_comments: null, display_order: 0 },
  ];
  it("shows Required as a muted number in its own narrow column", async () => {
    fetchMock = vi.fn(async (url: string) =>
      url.includes("factor-ratings")
        ? { ok: true, status: 200, json: async () => factorRatingsResponse() }
        : { ok: true, status: 200, json: async () => ({ competencies }) }
    );
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => {
      root.render(
        createElement(TechnicalCompetenciesSection, {
          appraisalId: "a-1",
          appraisalStatus: "SELF_ASSESSMENT",
          canEditSetup: false,
          canDeleteCompetencies: false,
          canEditSelfRatings: true,
          canEditManagerRatings: false,
        })
      );
    });
    await flush();
    expect(headers()).toEqual(["Competency", "Required", "Weight", "Your Rating", "Your Comment", "Manager Rating", "Score"]);
    const cell = rowOf("Budgeting").querySelector("[data-required-cell]")!;
    expect(cell.querySelector("[data-mobile-label]")!.textContent).toBe("Required");
    const level = cell.querySelector("[data-required-level]")!;
    expect(level.textContent).toBe("6");
    expect(level.getAttribute("title")).toBe("Label 6");
    expect(level.className).toContain("text-ds-text-secondary");
    expect(level.className).not.toMatch(/border|font-semibold/);
    expect(rowOf("Budgeting").querySelector("[data-score]")!.textContent).toContain("—");
  });
});

describe("Save Ratings feedback", () => {
  it("is a compact neutral outline button, not the dark primary", async () => {
    await renderCore(EMPLOYEE);
    const btn = saveButton()!;
    expect(btn.textContent).toBe("Save Ratings");
    expect(btn.className).toMatch(/\bh-8\b/);
    expect(btn.className).toContain("rounded-[8px]");
    expect(btn.className).toContain("border-ds-border");
    expect(btn.className).toContain("bg-white");
    expect(btn.className).not.toMatch(/bg-ds-accent|text-ds-on-primary|shadow/);
    expect(container.querySelector("[data-competency-header]")!.contains(btn)).toBe(true);
  });

  it("Saving… → Saved ✓ → Save Ratings, with Last saved and no success banner", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await renderCore(EMPLOYEE, {
      onPost: async () => {
        await gate;
        return { ok: true, status: 200, json: async () => ({ success: true }) };
      },
    });
    await act(async () => saveButton()!.click());
    expect(saveButton()!.textContent).toBe("Saving…");
    expect(saveButton()!.disabled).toBe(true);

    await act(async () => release());
    await flush();
    expect(saveButton()!.textContent).toBe("Saved ✓");
    expect(container.querySelector("[data-midyear-last-saved]")!.textContent).toBe("Last saved just now");
    expect(container.textContent).not.toMatch(/Ratings saved successfully|Success ·/);
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => {
      await new Promise((r) => setTimeout(r, DRAFT_SAVED_MS + 50));
    });
    expect(saveButton()!.textContent).toBe("Save Ratings");
  });

  it("a failed save shows the existing error and keeps the entered values", async () => {
    await renderCore(EMPLOYEE, { onPost: async () => ({ ok: false, status: 500, json: async () => ({ error: "Could not save ratings" }) }) });
    await choose(select(`${unrated.name} employee rating`)!, "4");
    await act(async () => saveButton()!.click());
    await flush();
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("Could not save ratings");
    expect(select(`${unrated.name} employee rating`)!.value).toBe("4");
    expect(saveButton()!.textContent).toBe("Save Ratings");
    expect(container.querySelector("[data-midyear-last-saved]")).toBeNull();
  });

  it.each([
    ["Productivity", ProductivitySection],
    ["Leadership", LeadershipSection],
  ] as const)("%s uses the same secondary save action", async (_label, component) => {
    fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => factorRatingsResponse() }));
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => {
      root.render(createElement(component, { appraisalId: "a-1", appraisalStatus: "SELF_ASSESSMENT", canEditSelfRatings: true, canEditManagerRatings: false }));
    });
    await flush();
    expect(saveButton()!.className).toContain("border-ds-border");
    expect(saveButton()!.className).not.toContain("bg-ds-accent");
  });
});

describe("responsive stacking", () => {
  it("desktop is a fixed compact table; below md each row stacks with field labels and no horizontal scroll", async () => {
    await renderCore(EMPLOYEE);
    const table = container.querySelector("[data-competency-table]")!;
    expect(table.className).toContain("md:table-fixed");
    expect(table.className).toContain("max-md:block");
    expect(table.closest(".overflow-x-auto")).toBeNull();
    expect(container.querySelector("thead")!.className).toContain("max-md:hidden");
    const row = rowOf(rated.name);
    expect(row.className).toContain("max-md:grid");
    expect(row.className).toContain("max-md:grid-cols-2");
    const labels = [...row.querySelectorAll("[data-mobile-label]")].map((l) => l.textContent);
    expect(labels).toEqual(["Weight", "Your Rating", "Your Comment", "Manager Rating", "Score"]);
    for (const l of row.querySelectorAll("[data-mobile-label]")) expect(l.className).toContain("md:hidden");
    expect(row.querySelector("[data-self-rating]")!.className).toContain("max-md:col-span-2");
  });

  it("the header and save action stack on narrow screens", async () => {
    await renderCore(EMPLOYEE);
    const header = container.querySelector("[data-competency-header]")!;
    expect(header.className).toContain("flex-col");
    expect(header.className).toContain("sm:flex-row");
    expect(saveButton()!.className).toContain("w-full");
    expect(saveButton()!.className).toContain("sm:w-auto");
  });
});

describe("no scoring, permission or save changes", () => {
  it("the section files keep their scoring, payloads and endpoints", () => {
    const coreSrc = read("components/appraisal/CoreCompetenciesSection.tsx");
    expect(coreSrc).toContain("const rowScore = effectiveWeight * factorVal;");
    expect(coreSrc).toContain("`/api/appraisals/${appraisalId}/factor-ratings`");
    const tech = read("components/appraisal/TechnicalCompetenciesSection.tsx");
    expect(tech).toContain('method: "PUT"');
    expect(tech).toContain("comp.weight * getFactorFromScale(");
  });
});
