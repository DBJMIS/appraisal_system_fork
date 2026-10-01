// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import fs from "node:fs";
import path from "node:path";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const { stub } = vi.hoisted(() => ({
  /** Renders the section's boolean props as data attributes so tests can see what it was allowed to do. */
  stub: (name: string) => (props: Record<string, unknown>) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createElement: h } = require("react") as typeof import("react");
    const flags = Object.fromEntries(
      Object.entries(props)
        .filter(([, v]) => typeof v === "boolean")
        .map(([k, v]) => [`data-${k.toLowerCase()}`, String(v)])
    );
    return h("div", { "data-section": name, ...flags });
  },
}));
vi.mock("@/components/appraisal/WorkplanSection", () => ({ WorkplanSection: stub("workplan") }));
vi.mock("@/components/appraisal/EvidenceBuilder", () => ({ EvidenceBuilder: stub("evidence") }));
vi.mock("@/components/appraisal/CoreCompetenciesSection", () => ({ CoreCompetenciesSection: stub("core") }));
vi.mock("@/components/appraisal/TechnicalCompetenciesSection", () => ({ TechnicalCompetenciesSection: stub("technical") }));
vi.mock("@/components/appraisal/ProductivitySection", () => ({ ProductivitySection: stub("productivity") }));
vi.mock("@/components/appraisal/LeadershipSection", () => ({ LeadershipSection: stub("leadership") }));
vi.mock("@/components/appraisal/SummaryTab", () => ({ SummaryTab: stub("summary") }));
vi.mock("@/components/appraisal/SignoffsTab", () => ({ SignoffsTab: stub("signoffs") }));
vi.mock("@/components/appraisal/HRActionsTab", () => ({ HRActionsTab: stub("hractions") }));
vi.mock("@/components/appraisal/AuditTrailTab", () => ({ AuditTrailTab: stub("audit") }));
vi.mock("@/components/appraisal/checkins/CheckInTab", () => ({ CheckInTab: stub("checkins") }));
vi.mock("@/components/appraisal/DelegationTab", () => ({ DelegationTab: stub("delegation") }));

import { AppraisalTabs, type AppraisalData } from "@/components/appraisal/AppraisalTabs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

let container: HTMLDivElement;
let root: Root;

const appraisal = (status: string): AppraisalData => ({
  id: "a-1",
  employee_id: "emp-1",
  manager_employee_id: "mgr-1",
  cycle_id: "c-1",
  status,
  is_management: true,
  employeeName: "Brown, Alicia",
  cycleName: "FY 2026/27",
});

async function flush() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

/** As the appraisal page renders it: oversight viewers get no role flags and readOnly. */
async function render(status: string, viewer: "oversight" | "manager") {
  await act(async () => {
    root.render(
      createElement(AppraisalTabs, {
        appraisal: appraisal(status),
        cyclePhase: "",
        currentUserId: viewer === "oversight" ? "u-sr" : "u-mgr",
        currentUserEmployeeId: viewer === "oversight" ? "sr-1" : "mgr-1",
        isManager: viewer === "manager",
        isHR: false,
        isPrimaryManager: viewer === "manager",
        readOnly: viewer === "oversight",
      })
    );
  });
  await flush();
}

const tabs = () => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
const tabLabels = () => tabs().map((t) => t.textContent);
const openTab = async (label: string) => act(async () => tabs().find((t) => t.textContent === label)!.click());
const section = (name: string) => container.querySelector<HTMLElement>(`[data-section="${name}"]`)!;
const buttonsText = () => [...container.querySelectorAll("button:not([role=tab])")].map((b) => b.textContent ?? "");

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ canSubmit: true, blockers: [], checkIns: [] }) })));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("read-only oversight view of an appraisal", () => {
  it("hides Sign-offs, HR Actions, Delegation and the Audit trail", async () => {
    await render("MANAGER_REVIEW", "oversight");
    expect(tabLabels()).toEqual(["Workplan", "Core Competencies", "Technical", "Productivity", "Leadership", "Summary"]);
  });

  it("passes no edit rights to any rating section", async () => {
    await render("MANAGER_REVIEW", "oversight");
    for (const [label, name] of [
      ["Core Competencies", "core"],
      ["Productivity", "productivity"],
      ["Leadership", "leadership"],
    ] as const) {
      await openTab(label);
      expect(section(name).dataset.caneditselfratings).toBe("false");
      expect(section(name).dataset.caneditmanagerratings).toBe("false");
      expect(section(name).dataset.caneditweights).toBe("false");
    }
    await openTab("Technical");
    expect(section("technical").dataset.caneditsetup).toBe("false");
    expect(section("technical").dataset.caneditmanagerratings).toBe("false");
  });

  it("keeps weights and technical setup locked in Draft", async () => {
    await render("DRAFT", "oversight");
    await openTab("Core Competencies");
    expect(section("core").dataset.caneditweights).toBe("false");
    await openTab("Technical");
    expect(section("technical").dataset.caneditsetup).toBe("false");
    expect(section("technical").dataset.candeletecompetencies).toBe("false");
  });

  it("shows no workflow actions in any stage", async () => {
    for (const status of ["DRAFT", "PENDING_APPROVAL", "IN_PROGRESS", "SELF_ASSESSMENT", "MANAGER_REVIEW", "PENDING_SIGNOFF", "HR_REVIEW", "COMPLETE"]) {
      await render(status, "oversight");
      const text = buttonsText().join(" | ");
      expect(text, status).not.toMatch(/Submit|Approve|Request Changes|Recall|Start Final Review|Reopen|Sign/i);
      expect(container.querySelector("[data-start-final-review]"), status).toBeNull();
    }
  });

  it("opens the workplan and check-ins read-only, without evidence tools", async () => {
    await render("IN_PROGRESS", "oversight");
    expect(section("workplan").dataset.oversight).toBe("true");
    expect(container.querySelector('[data-section="evidence"]')).toBeNull();
    await openTab("Check-ins");
    expect(section("checkins").dataset.readonly).toBe("true");
    expect(section("checkins").dataset.testbypass).toBe("false");

    await render("SELF_ASSESSMENT", "oversight");
    expect(container.querySelector('[data-section="evidence"]')).toBeNull();
  });
});

describe("direct manager view is unchanged", () => {
  it("keeps the manager's tabs and edit rights in Manager Review", async () => {
    await render("MANAGER_REVIEW", "manager");
    expect(tabLabels()).toEqual([
      "Workplan",
      "Core Competencies",
      "Technical",
      "Productivity",
      "Leadership",
      "HR Actions",
      "Summary",
      "Sign-offs",
      "Delegation",
      "Audit trail",
    ]);
    await openTab("Core Competencies");
    expect(section("core").dataset.caneditmanagerratings).toBe("true");
  });

  it("keeps weight editing and workplan editing in Draft", async () => {
    await render("DRAFT", "manager");
    expect(section("workplan").dataset.oversight).toBe("false");
    await openTab("Core Competencies");
    expect(section("core").dataset.caneditweights).toBe("true");
    await openTab("Technical");
    expect(section("technical").dataset.caneditsetup).toBe("true");
  });
});

describe("appraisal page wiring", () => {
  const page = read("app/appraisals/[id]/page.tsx");

  it("allows oversight only as a fallback after the existing access check", () => {
    expect(page).toContain("const directAccess = canAccessAppraisal(");
    expect(page).toContain("const oversight = !directAccess && (await hasOversightReadAccess(user, appraisal));");
    expect(page).toMatch(/if \(!directAccess && !oversight\) \{\s*notFound\(\);/);
  });

  it("shows the neutral read-only banner and hides the completion bar for oversight", () => {
    expect(page).toContain("Read-only oversight");
    expect(page).toContain("You can view this appraisal because this employee is within your reporting hierarchy.");
    const banner = page.slice(page.indexOf("data-oversight-banner"), page.indexOf("Read-only oversight"));
    expect(banner).not.toMatch(/amber|warning|red|yellow/i);
    expect(page).toMatch(/\{!oversight && \(\s*<CompletionBarWrapperClient/);
    expect(page).toContain("readOnly={oversight}");
  });

  it("never grants manager, HR or head-of-department roles to an oversight viewer", () => {
    expect(page).toMatch(/const isManager = !oversight &&/);
    expect(page).toMatch(/const isHR = !oversight &&/);
    expect(page).toMatch(/const isHOD =\s*!oversight &&/);
    expect(page).toContain("isDelegated={!oversight && managerAccess.isDelegated}");
    expect(page).toContain("isPrimaryManager={!oversight && managerAccess.isPrimaryManager}");
  });
});
