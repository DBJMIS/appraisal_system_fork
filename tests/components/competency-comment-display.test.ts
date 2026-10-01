// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ACTIVE_FACTORS, CATEGORY_TYPES, factorRatingsResponse, type CategoryType } from "../helpers/factor-fixtures";
import { competencyCommentDisplay } from "@/lib/competency-comment-display";

vi.mock("@/lib/supabase", () => ({ createClient: vi.fn() }));

import { CoreCompetenciesSection } from "@/components/appraisal/CoreCompetenciesSection";
import { ProductivitySection } from "@/components/appraisal/ProductivitySection";
import { LeadershipSection } from "@/components/appraisal/LeadershipSection";
import { TechnicalCompetenciesSection } from "@/components/appraisal/TechnicalCompetenciesSection";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Access = { status: string; canEditSelfRatings: boolean; canEditManagerRatings: boolean };

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;

async function flush() {
  for (let i = 0; i < 20; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
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
});

describe("competencyCommentDisplay", () => {
  it("hides every comment in DRAFT, even when editable or present", () => {
    expect(competencyCommentDisplay("DRAFT", true, "text")).toBe("hidden");
    expect(competencyCommentDisplay("draft", false, "text")).toBe("hidden");
  });
  it("shows the editor when the side is editable outside DRAFT", () => {
    expect(competencyCommentDisplay("SELF_ASSESSMENT", true, null)).toBe("edit");
    expect(competencyCommentDisplay("MANAGER_REVIEW", true, "")).toBe("edit");
  });
  it("shows read-only comments only when they exist", () => {
    expect(competencyCommentDisplay("COMPLETE", false, "done")).toBe("read");
    expect(competencyCommentDisplay("COMPLETE", false, "   ")).toBe("hidden");
    expect(competencyCommentDisplay("PENDING_SIGNOFF", false, null)).toBe("hidden");
  });
});

// One factor-based section and the technical section share the grid; run the stage matrix against all four.
type FactorSectionProps = {
  appraisalId: string;
  appraisalStatus?: string | null;
  canEditSelfRatings: boolean;
  canEditManagerRatings: boolean;
  canEditWeights?: boolean;
};
const FACTOR_SECTIONS: Record<CategoryType, ComponentType<FactorSectionProps>> = {
  core: CoreCompetenciesSection,
  productivity: ProductivitySection,
  leadership: LeadershipSection,
};

type Harness = {
  name: string;
  render: (access: Access, comments: { self: string | null; manager: string | null }) => Promise<void>;
  rowName: string;
  draftSaveLabel: string;
  postedRow: () => Record<string, unknown> | undefined;
};

const harnesses: Harness[] = [
  ...CATEGORY_TYPES.map((type): Harness => {
    const target = ACTIVE_FACTORS.filter((f) => f.id.startsWith(`${type}-`)).sort((a, b) => a.display_order - b.display_order)[0];
    return {
      name: type,
      rowName: target.name,
      draftSaveLabel: "Save Weights",
      render: async (access, comments) => {
        fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
          if (init?.method === "POST") return { ok: true, status: 200, json: async () => ({ success: true }) };
          return {
            ok: true,
            status: 200,
            json: async () =>
              factorRatingsResponse({
                ratings: [{ factor_id: target.id, self_rating_code: "6", manager_rating_code: "8", self_comments: comments.self, manager_comments: comments.manager, weight: 20 }],
              }),
          };
        });
        vi.stubGlobal("fetch", fetchMock);
        await act(async () => {
          root.render(
            createElement(FACTOR_SECTIONS[type], {
              appraisalId: "a-1",
              appraisalStatus: access.status,
              canEditSelfRatings: access.canEditSelfRatings,
              canEditManagerRatings: access.canEditManagerRatings,
              canEditWeights: access.status === "DRAFT",
            })
          );
        });
        await flush();
      },
      postedRow: () => {
        const call = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
        if (!call) return undefined;
        return (JSON.parse(String((call[1] as RequestInit).body)).ratings as Record<string, unknown>[]).find((r) => r.factor_id === target.id);
      },
    };
  }),
  {
    name: "technical",
    rowName: "Budgeting",
    draftSaveLabel: "Save",
    render: async (access, comments) => {
      const competencies = [
        { id: "t-1", name: "Budgeting", required_level: "6", weight: 100, self_rating: "6", manager_rating: "8", self_comments: comments.self, manager_comments: comments.manager, display_order: 0 },
      ];
      fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (url.includes("factor-ratings")) return { ok: true, status: 200, json: async () => factorRatingsResponse() };
        if (init?.method) return { ok: true, status: 200, json: async () => ({ success: true }) };
        return { ok: true, status: 200, json: async () => ({ competencies }) };
      });
      vi.stubGlobal("fetch", fetchMock);
      await act(async () => {
        root.render(
          createElement(TechnicalCompetenciesSection, {
            appraisalId: "a-1",
            appraisalStatus: access.status,
            canEditSetup: false,
            canDeleteCompetencies: false,
            canEditSelfRatings: access.canEditSelfRatings,
            canEditManagerRatings: access.canEditManagerRatings,
          })
        );
      });
      await flush();
    },
    postedRow: () => {
      const call = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PUT");
      if (!call) return undefined;
      return JSON.parse(String((call[1] as RequestInit).body)).competencies[0];
    },
  },
];

const row = (name: string) => [...container.querySelectorAll("tbody tr")].find((tr) => tr.textContent?.includes(name))!;
const buttonNamed = (label: string) => [...container.querySelectorAll("button")].find((b) => b.textContent === label);
const save = () => buttonNamed("Save Ratings");

describe.each(harnesses)("$name comment visibility by stage", (h) => {
  // Rating flags are forced on to prove the grid itself refuses rating editing in DRAFT.
  it("DRAFT hides comments, renders no editable rating controls, and saves existing values unchanged", async () => {
    await h.render({ status: "DRAFT", canEditSelfRatings: true, canEditManagerRatings: true }, { self: "self note", manager: "mgr note" });
    const r = row(h.rowName);
    expect(r.querySelector("textarea")).toBeNull();
    expect(r.querySelector("[data-comment]")).toBeNull();
    expect(r.textContent).not.toContain("Comment");
    expect(r.textContent).not.toContain("self note");
    expect(r.textContent).not.toContain("mgr note");
    expect([...r.querySelectorAll("p")].some((p) => p.textContent?.trim() === "—")).toBe(false);
    expect(container.querySelector(`[aria-label="${h.rowName} employee rating"]`)).toBeNull();
    expect(container.querySelector(`[aria-label="${h.rowName} manager rating"]`)).toBeNull();
    expect(container.querySelector('[role="group"]')).toBeNull();

    expect(save()).toBeUndefined();
    const button = buttonNamed(h.draftSaveLabel);
    expect(button).toBeDefined();
    if (!button!.disabled) {
      await act(async () => button!.click());
      await flush();
      const posted = h.postedRow();
      expect(posted).toBeDefined();
      expect(posted!.self_comments).toBe("self note");
      expect(posted!.manager_comments).toBe("mgr note");
    }
  });

  it("SELF_ASSESSMENT and MANAGER_REVIEW keep the Save Ratings label and editable rating controls", async () => {
    await h.render({ status: "SELF_ASSESSMENT", canEditSelfRatings: true, canEditManagerRatings: false }, { self: null, manager: null });
    expect(save()).toBeDefined();
    expect(container.querySelector(`[aria-label="${h.rowName} employee rating"]`)).not.toBeNull();
    expect(container.querySelector(`[aria-label="${h.rowName} manager rating"]`)).toBeNull();

    await h.render({ status: "MANAGER_REVIEW", canEditSelfRatings: false, canEditManagerRatings: true }, { self: null, manager: null });
    expect(save()).toBeDefined();
    expect(container.querySelector(`[aria-label="${h.rowName} manager rating"]`)).not.toBeNull();
    expect(container.querySelector(`[aria-label="${h.rowName} employee rating"]`)).toBeNull();
  });

  it("SELF_ASSESSMENT shows the employee comment editor and hides an empty manager comment", async () => {
    await h.render({ status: "SELF_ASSESSMENT", canEditSelfRatings: true, canEditManagerRatings: false }, { self: "self note", manager: null });
    const r = row(h.rowName);
    const self = r.querySelector('[data-comment="self"] textarea') as HTMLTextAreaElement;
    expect(self).not.toBeNull();
    expect(self.value).toBe("self note");
    expect(r.querySelector('[data-comment="manager"]')).toBeNull();
  });

  it("MANAGER_REVIEW shows the employee comment read-only and the manager comment editor", async () => {
    await h.render({ status: "MANAGER_REVIEW", canEditSelfRatings: false, canEditManagerRatings: true }, { self: "self note", manager: "mgr note" });
    const r = row(h.rowName);
    expect(r.querySelector('[data-comment="self"]')?.textContent).toContain("self note");
    expect(r.querySelector('[data-comment="self"] textarea')).toBeNull();
    expect((r.querySelector('[data-comment="manager"] textarea') as HTMLTextAreaElement).value).toBe("mgr note");
  });

  it.each(["PENDING_SIGNOFF", "HR_REVIEW", "COMPLETE"])("%s shows existing comments read-only and omits empty ones", async (status) => {
    await h.render({ status, canEditSelfRatings: false, canEditManagerRatings: false }, { self: "self note", manager: null });
    const r = row(h.rowName);
    expect(r.querySelector("textarea")).toBeNull();
    expect(r.querySelector('[data-comment="self"]')?.textContent).toContain("self note");
    expect(r.querySelector('[data-comment="manager"]')).toBeNull();
    expect([...r.querySelectorAll("p")].some((p) => p.textContent?.trim() === "—")).toBe(false);
  });

  it("keeps the row structure compact", async () => {
    await h.render({ status: "SELF_ASSESSMENT", canEditSelfRatings: true, canEditManagerRatings: false }, { self: null, manager: null });
    const cells = [...row(h.rowName).querySelectorAll("td")];
    for (const td of cells) {
      expect(td.className).toContain("py-2");
      expect(td.className).not.toMatch(/\bpy-3\b/);
    }
    const textarea = row(h.rowName).querySelector("textarea")!;
    expect(textarea.getAttribute("rows")).toBe("1");
    expect(textarea.className).toContain("min-h-[32px]");
    expect(textarea.className).toContain("resize-none");
    expect(textarea.className).not.toMatch(/min-h-\[(40|56)px\]/);
    expect(textarea.getAttribute("placeholder")).toMatch(/^Optional comment/);
  });
});
