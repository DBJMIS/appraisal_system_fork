// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import fs from "node:fs";
import path from "node:path";

const mocks = vi.hoisted(() => ({ browserCreateClient: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ createClient: mocks.browserCreateClient }));

import { SubmitForApprovalAction } from "@/components/appraisal/SubmitForApprovalAction";
import { useDraftSubmitReadiness } from "@/hooks/useDraftSubmitReadiness";
import { WorkplanSection } from "@/components/appraisal/WorkplanSection";
import { TooltipProvider } from "@/components/ui/tooltip";
import { calcCompletion, missingWorkplanItemFields } from "@/lib/appraisal-completion";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BLOCKER = "Workplan: 15 objective(s) incomplete";
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

let container: HTMLDivElement;
let root: Root;

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

async function flush() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function render(element: ReturnType<typeof createElement>) {
  await act(async () => {
    root.render(element);
  });
  await flush();
}

const button = () => [...container.querySelectorAll("button")].find((b) => /Submit for Approval|Submitting/.test(b.textContent ?? ""))!;

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

describe("SubmitForApprovalAction", () => {
  const props = { canSubmit: false as boolean | null, blockers: [BLOCKER], submitting: false, onSubmit: vi.fn() };

  it("DRAFT with blockers shows the blocker text next to the disabled button", async () => {
    await render(createElement(SubmitForApprovalAction, props));
    expect(container.textContent).toContain("Appraisal incomplete");
    expect(container.textContent).toContain(BLOCKER);
    expect(button().disabled).toBe(true);
    expect(button().getAttribute("aria-describedby")).toBe("submit-for-approval-blockers");
  });

  it("shows every blocker verbatim, in the order returned", async () => {
    const blockers = ["Core Competencies: complete all factors and set weights to total 100%", BLOCKER];
    await render(createElement(SubmitForApprovalAction, { ...props, blockers }));
    expect([...container.querySelectorAll("li")].map((li) => li.textContent)).toEqual(blockers);
  });

  it("a complete appraisal shows no blocker message and the button is enabled", async () => {
    await render(createElement(SubmitForApprovalAction, { ...props, canSubmit: true, blockers: [] }));
    expect(container.textContent).not.toContain("Appraisal incomplete");
    expect(container.querySelector("#submit-for-approval-blockers")).toBeNull();
    expect(button().disabled).toBe(false);
  });

  it("enablement follows canSubmit only, never the blocker list", async () => {
    await render(createElement(SubmitForApprovalAction, { ...props, canSubmit: true, blockers: ["stale"] }));
    expect(button().disabled).toBe(false);
    expect(container.textContent).not.toContain("Appraisal incomplete");

    await render(createElement(SubmitForApprovalAction, { ...props, canSubmit: false, blockers: [] }));
    expect(button().disabled).toBe(true);
    expect(container.textContent).not.toContain("Appraisal incomplete");

    await render(createElement(SubmitForApprovalAction, { ...props, canSubmit: null, blockers: [] }));
    expect(button().disabled).toBe(true);
  });

  it("stays disabled while submitting and calls onSubmit when enabled", async () => {
    const onSubmit = vi.fn();
    await render(createElement(SubmitForApprovalAction, { ...props, canSubmit: true, blockers: [], onSubmit }));
    await act(async () => button().click());
    expect(onSubmit).toHaveBeenCalledTimes(1);

    await render(createElement(SubmitForApprovalAction, { ...props, canSubmit: true, blockers: [], submitting: true, onSubmit }));
    expect(button().disabled).toBe(true);
    expect(button().textContent).toContain("Submitting…");
  });
});

describe("completion-driven readiness (same wiring as AppraisalTabs)", () => {
  function Harness({ enabled = true }: { enabled?: boolean }) {
    const { canSubmit, blockers } = useDraftSubmitReadiness("a-1", enabled, true);
    return createElement(SubmitForApprovalAction, { canSubmit, blockers, submitting: false, onSubmit: () => {} });
  }

  it("uses the completion endpoint and enables the button when the response changes to canSubmit: true", async () => {
    let response: unknown = { canSubmit: false, blockers: [BLOCKER] };
    const fetchMock = vi.fn(async () => jsonResponse(response));
    vi.stubGlobal("fetch", fetchMock);

    await render(createElement(Harness));
    expect(fetchMock).toHaveBeenCalledWith("/api/appraisals/a-1/completion?showLeadership=true", { cache: "no-store" });
    expect(container.textContent).toContain(BLOCKER);
    expect(button().disabled).toBe(true);

    response = { canSubmit: true, blockers: [] };
    await act(async () => {
      window.dispatchEvent(new CustomEvent("appraisal-completion-invalidate"));
    });
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(button().disabled).toBe(false);
    expect(container.textContent).not.toContain("Appraisal incomplete");
  });

  it("shows whatever blocker text the server returns, without local rules", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ canSubmit: false, blockers: ["Server says: something else"] })));
    await render(createElement(Harness));
    expect(container.textContent).toContain("Server says: something else");
  });

  it("a failed completion request keeps the button disabled without inventing a message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "boom" }, 500)));
    await render(createElement(Harness));
    expect(button().disabled).toBe(true);
    expect(container.textContent).not.toContain("Appraisal incomplete");
  });

  it("does not fetch when Submit for Approval is not shown", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ canSubmit: true, blockers: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await render(createElement(Harness, { enabled: false }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(button().disabled).toBe(true);
  });
});

describe("no duplicated completion logic", () => {
  it("the Submit for Approval UI only consumes the completion response", () => {
    for (const file of ["components/appraisal/SubmitForApprovalAction.tsx", "hooks/useDraftSubmitReadiness.ts", "components/appraisal/AppraisalTabs.tsx"]) {
      const src = read(file);
      expect(src, file).not.toMatch(/calcCompletion|fetchCompletionReport|missingWorkplanItemFields/);
      expect(src, file).not.toMatch(/objective\(s\) incomplete|set weights to total 100%/);
    }
    const tabs = read("components/appraisal/AppraisalTabs.tsx");
    expect(tabs).toContain("useDraftSubmitReadiness(");
    expect(tabs).toContain("canSubmit={canSubmitForApproval}");
    expect(tabs).toContain("blockers={submitForApprovalBlockers}");
    expect(read("components/appraisal/SubmitForApprovalAction.tsx")).toContain("disabled={submitting || !canSubmit}");
  });

  it("the Workplan row hint and calcCompletion share one rule", () => {
    expect(read("components/appraisal/WorkplanSection.tsx")).toMatch(/import \{ missingWorkplanItemFields \} from "@\/lib\/appraisal-completion"/);
    expect(read("lib/appraisal-completion.ts")).toContain("const hasStructure = missingWorkplanItemFields(item).length === 0;");
  });

  it("the shared rule matches the existing completion rule", () => {
    const complete = { major_task: "t", key_output: "o", performance_standard: "p", weight: 5 };
    expect(missingWorkplanItemFields(complete)).toEqual([]);
    expect(missingWorkplanItemFields({ ...complete, major_task: "  " })).toEqual(["Major Tasks"]);
    expect(missingWorkplanItemFields({ ...complete, key_output: "" })).toEqual(["Key Outputs"]);
    expect(missingWorkplanItemFields({ ...complete, performance_standard: null })).toEqual(["Performance Standard"]);
    expect(missingWorkplanItemFields({ ...complete, weight: 0 })).toEqual(["Weighting"]);

    const items = [
      { id: "1", ...complete },
      { id: "2", ...complete, key_output: "" },
      { id: "3", ...complete, weight: 0 },
    ];
    const report = calcCompletion({
      workplanItems: items,
      appraisalStatus: "DRAFT",
      factorRatings: [],
      coreFactorIds: [],
      productivityFactorIds: [],
      leadershipFactorIds: [],
      technicalCompetencies: [],
      showLeadership: false,
    });
    expect(report.sections.find((s) => s.key === "workplan")).toMatchObject({ completed: 1, total: 3 });
    expect(report.blockers).toEqual(["Workplan: 2 objective(s) incomplete"]);
  });
});

describe("Workplan editor required-field indicators", () => {
  const baseItem = {
    workplan_id: "wp-1",
    corporate_objective: "",
    division_objective: "",
    individual_objective: "",
    weight: 50,
    metric_type: "PERCENT",
  };
  const workplanResponse = {
    workplan: { id: "wp-1", status: "draft", locked_at: null, submitted_at: null, rejection_reason: null },
    items: [
      { ...baseItem, id: "i-complete", major_task: "Task A", key_output: "Output A", performance_standard: "Standard A" },
      { ...baseItem, id: "i-missing", major_task: "Task B", key_output: "", performance_standard: "Standard B" },
    ],
  };

  function stubWorkplanFetch() {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).endsWith("/api/appraisals/a-1/workplan")) return jsonResponse(workplanResponse);
        if (String(url).endsWith("/api/appraisals/a-1/objectives")) return jsonResponse([]);
        return jsonResponse({}, 404);
      })
    );
    const query = { select: () => query, eq: () => query, in: async () => ({ data: [] }) };
    mocks.browserCreateClient.mockReturnValue({ from: () => query });
  }

  const renderWorkplan = (appraisalStatus: string) =>
    render(
      createElement(
        TooltipProvider,
        null,
        createElement(WorkplanSection, {
          appraisalId: "a-1",
          appraisalStatus,
          cyclePhase: "PLANNING",
          isEmployee: true,
          isManager: false,
          isHR: false,
        })
      )
    );

  const header = (label: string) => [...container.querySelectorAll("th")].find((th) => th.textContent?.startsWith(label))!;

  it.each(["Major Tasks", "Key Outputs", "Performance Standard"])("marks %s as required in the DRAFT editor", async (label) => {
    stubWorkplanFetch();
    await renderWorkplan("DRAFT");
    const mark = header(label).querySelector("[data-required-mark]");
    expect(mark).not.toBeNull();
    expect(mark!.getAttribute("title")).toBe("Required");
  });

  it("uses the existing 'Required' placeholder on all three required text fields", async () => {
    stubWorkplanFetch();
    await renderWorkplan("DRAFT");
    const placeholders = (value: string) =>
      [...container.querySelectorAll("textarea")].filter((t) => t.value === value).map((t) => t.getAttribute("placeholder"));
    expect(placeholders("Task A")).toEqual(["Required"]);
    expect(placeholders("Output A")).toEqual(["Required"]);
    expect(placeholders("Standard A")).toEqual(["Required"]);
  });

  it("flags only the row that is incomplete under the completion rule", async () => {
    stubWorkplanFetch();
    await renderWorkplan("DRAFT");
    const hints = [...container.querySelectorAll("[data-workplan-row-incomplete]")];
    expect(hints).toHaveLength(1);
    expect(hints[0].textContent).toContain("Incomplete: Key Outputs required");
    expect(hints[0].closest("tr")!.textContent).toContain("Task B");
  });

  it("does not add markers or hints to the read-only workplan view", async () => {
    stubWorkplanFetch();
    await renderWorkplan("IN_PROGRESS");
    expect(container.querySelector("[data-required-mark]")).toBeNull();
    expect(container.querySelector("[data-workplan-row-incomplete]")).toBeNull();
  });
});
