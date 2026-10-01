// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import fs from "node:fs";
import path from "node:path";

import { SignoffsTab, signedDocumentItems } from "@/components/appraisal/SignoffsTab";
import type { AppraisalData } from "@/components/appraisal/AppraisalTabs";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let submitBodies: unknown[];

const jsonResponse = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

async function flush() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

const APPRAISAL: AppraisalData = {
  id: "a-1",
  employee_id: "e-1",
  manager_employee_id: "m-1",
  cycle_id: "c-1",
  status: "MANAGER_REVIEW",
  is_management: false,
  employeeName: "Jane Employee",
  employeeEmail: "jane@example.com",
  managerName: "Mark Manager",
  managerEmail: "mark@example.com",
  hrOfficerName: "Helen Head",
  hrOfficerEmail: "helen@example.com",
  cycleName: "FY2026",
  agreement: null,
};

const SCORES = { workplan: 42, competency: 11.7, overall: 53.7, ratingLabel: "Far Below Expectations" };

type Chain = { role: "EMPLOYEE" | "MANAGER" | "HOD"; name: string; email: string | null; signedAt: string | null }[];

const THREE_SIGNERS: Chain = [
  { role: "EMPLOYEE", name: "Jane Employee", email: "jane@example.com", signedAt: null },
  { role: "MANAGER", name: "Mark Manager", email: "mark@example.com", signedAt: null },
  { role: "HOD", name: "Helen Head", email: "helen@example.com", signedAt: null },
];

function statusPayload(overrides: Record<string, unknown> = {}) {
  return {
    agreement: null,
    signers: {
      employee: { full_name: "Jane Employee", email: "jane@example.com" },
      manager: { full_name: "Mark Manager", email: "mark@example.com" },
      hrOfficer: { full_name: "Helen Head", email: "helen@example.com" },
    },
    signerChain: THREE_SIGNERS,
    scores: SCORES,
    ...overrides,
  };
}

function stubFetch(status: unknown, submit: () => ReturnType<typeof jsonResponse> = () => jsonResponse({ error: "Adobe Sign unavailable" }, 500)) {
  submitBodies = [];
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/signoff/status")) return status === 500 ? jsonResponse({}, 500) : jsonResponse(status);
    if (u.endsWith("/signoff/submit")) {
      submitBodies.push(JSON.parse(String(init?.body)));
      return submit();
    }
    if (u.endsWith("/check-adobe-status")) return jsonResponse({ ok: true });
    return jsonResponse({}, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
}

async function renderTab(
  opts: {
    status?: unknown;
    appraisal?: Partial<AppraisalData>;
    role?: "manager" | "hr" | "employee";
    showLeadership?: boolean;
  } = {}
) {
  stubFetch(opts.status ?? statusPayload());
  const role = opts.role ?? "manager";
  await act(async () => {
    root.render(
      createElement(SignoffsTab, {
        appraisalId: "a-1",
        appraisal: { ...APPRAISAL, ...opts.appraisal },
        signoffs: [],
        isEmployee: role === "employee",
        isAppraisalManager: role === "manager",
        isHR: role === "hr",
        showLeadership: opts.showLeadership ?? false,
      })
    );
  });
  await flush();
}

const q = <T extends Element = HTMLElement>(sel: string) => container.querySelector<T>(sel);
const qa = (sel: string) => [...container.querySelectorAll(sel)];
const cta = () => q<HTMLButtonElement>("[data-signoff-cta]");

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Sign-off page structure", () => {
  it("is organised as Final result → Sign-off via Adobe Sign → Manager comments", async () => {
    await renderTab();
    const sections = qa("section");
    expect(sections.map((s) => s.querySelector("h3")!.textContent?.trim())).toEqual([
      "Final result",
      "Sign-off via Adobe Sign",
      "Manager comments",
    ]);
    for (const s of sections) {
      expect(s.getAttribute("aria-labelledby")).toBe(s.querySelector("h3")!.id);
    }
  });
});

describe("Final result summary", () => {
  it("shows four compact metrics in one panel with the existing score values", async () => {
    await renderTab();
    const summary = q("[data-result-summary]")!;
    const metric = (id: string) => summary.querySelector(`[data-result-metric="${id}"]`)!;
    const pair = (id: string) => [metric(id).querySelector("dd")!.textContent, metric(id).querySelector("dt")!.textContent];

    expect(pair("overall")).toEqual(["53.7", "Overall Score"]);
    expect(pair("workplan")).toEqual(["42.0", "Workplan Points"]);
    expect(pair("competency")).toEqual(["11.7", "Competencies"]);
    expect(pair("rating")).toEqual(["Far Below Expectations", "Rating"]);
    expect(summary.querySelectorAll("[data-result-metric]")).toHaveLength(4);
  });

  it("keeps the rating readable but smaller than the numeric scores", async () => {
    await renderTab();
    const rating = q('[data-result-metric="rating"] dd')!;
    const overall = q('[data-result-metric="overall"] dd')!;
    expect(rating.className).toContain("text-[14px]");
    expect(overall.className).toContain("text-[20px]");
  });

  it("uses subtle separators in a single panel instead of four large cards", async () => {
    await renderTab();
    const summary = q("[data-result-summary]")!;
    expect(summary.className).toContain("gap-px");
    expect(summary.className).toContain("bg-ds-border");
    expect(summary.className).toContain("rounded-[8px]");
    for (const m of summary.querySelectorAll("[data-result-metric]")) {
      expect(m.className).not.toMatch(/\bborder\b|rounded/);
    }
    expect(container.innerHTML).not.toContain("text-[22px]");
  });

  it("falls back to zero scores and — when the status request fails, as before", async () => {
    await renderTab({ status: 500 });
    expect(q('[data-result-metric="overall"] dd')!.textContent).toBe("0.0");
    expect(q('[data-result-metric="rating"] dd')!.textContent).toBe("—");
  });
});

describe("Sign-off section and signer order", () => {
  it("has the simplified header and supporting text", async () => {
    await renderTab();
    const header = q("[data-signoff-section] [data-signoff-header]")!;
    expect(header.querySelector("h3")!.textContent).toBe("Sign-off via Adobe Sign");
    expect(header.textContent).toContain("Signatures are collected in sequence.");
  });

  it("renders the signer chain as a compact numbered flow in API order", async () => {
    await renderTab();
    const steps = qa("[data-signer-flow] [data-signer-step]");
    expect(steps.map((s) => s.getAttribute("data-signer-step"))).toEqual(["1", "2", "3"]);
    expect(steps.map((s) => s.querySelector("[data-signer-role]")!.textContent)).toEqual(["Employee", "Manager", "HOD"]);
    expect(steps[0].textContent).toContain("Jane Employee");
    expect(steps[0].querySelector("[title]")!.getAttribute("title")).toBe("jane@example.com");
    expect(q("[data-signer-flow]")!.tagName).toBe("OL");
    expect(steps[0].querySelectorAll("svg")).toHaveLength(1);
    expect(steps[2].querySelectorAll("svg")).toHaveLength(0);
  });

  it("renders only two steps when the API returns a two-signer chain", async () => {
    await renderTab({
      status: statusPayload({
        signerChain: [
          { role: "EMPLOYEE", name: "Jane Employee", email: "jane@example.com", signedAt: null },
          { role: "MANAGER", name: "Mark Manager", email: "mark@example.com", signedAt: null },
        ],
      }),
    });
    const steps = qa("[data-signer-step]");
    expect(steps).toHaveLength(2);
    expect(steps.map((s) => s.querySelector("[data-signer-role]")!.textContent)).toEqual(["Employee", "Manager"]);
  });

  it("uses the existing fallback chain when the status request fails", async () => {
    await renderTab({ status: 500 });
    expect(qa("[data-signer-role]").map((s) => s.textContent)).toEqual(["Employee", "Manager", "HOD"]);
    expect(q('[data-signer-step="3"]')!.textContent).toContain("Helen Head");
  });
});

describe("Adobe Sign CTA placement", () => {
  it("sits in the Sign-off section header as the single primary dark action", async () => {
    await renderTab();
    const button = cta()!;
    expect(button.closest("[data-signoff-header]")).not.toBeNull();
    expect(button.closest("[data-signoff-section]")).not.toBeNull();
    expect(button.textContent?.trim()).toBe("Generate PDF & send via Adobe Sign");
    expect(button.className).toContain("bg-ds-text-primary");
    expect(button.className).toContain("text-white");
    expect(qa("[data-signoff-cta]")).toHaveLength(1);
    expect(qa("button.bg-ds-text-primary")).toHaveLength(1);
    expect(button.disabled).toBe(false);
  });

  it("is available to HR but not to the employee, as before", async () => {
    await renderTab({ role: "hr" });
    expect(cta()).not.toBeNull();
    act(() => root.unmount());
    root = createRoot(container);
    await renderTab({ role: "employee" });
    expect(cta()).toBeNull();
  });

  it("is disabled outside Manager Review, as before", async () => {
    await renderTab({ role: "hr", appraisal: { status: "SUBMITTED" } });
    expect(cta()!.disabled).toBe(true);
  });

  it("submits the same request with the manager comments", async () => {
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
    await renderTab();
    const textarea = q<HTMLTextAreaElement>("[data-manager-comments] textarea")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(textarea, "Strong year overall.");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => cta()!.click());
    await flush();

    const submitCalls = fetchMock.mock.calls.filter(([u]) => String(u).endsWith("/api/appraisals/a-1/signoff/submit"));
    expect(submitCalls).toHaveLength(1);
    expect(submitCalls[0][1].method).toBe("POST");
    expect(submitBodies).toEqual([{ managerComments: "Strong year overall." }]);
    expect(alertSpy).toHaveBeenCalledWith("Adobe Sign unavailable");
  });

  it("replaces the CTA with the current status when an agreement is out for signature", async () => {
    await renderTab({
      appraisal: { status: "PENDING_SIGNOFF" },
      status: statusPayload({
        agreement: { id: "ag-1", status: "OUT_FOR_SIGNATURE", created_at: "2026-09-20T00:00:00Z" },
        signerChain: [{ ...THREE_SIGNERS[0], signedAt: "2026-09-21T00:00:00Z" }, THREE_SIGNERS[1], THREE_SIGNERS[2]],
      }),
    });
    expect(cta()).toBeNull();
    const header = q("[data-signoff-header]")!;
    expect(header.querySelector("h3")!.textContent).toBe("Sign-off via Adobe Sign");
    expect(header.textContent).toContain("1 of 3 signed");
    expect(q("[data-signoff-status]")!.textContent?.trim()).toBe("Awaiting signatures");
    const buttons = qa("button").map((b) => b.textContent?.trim());
    expect(buttons).toContain("Sync with Adobe Sign");
    expect(buttons).toContain("Download draft");
    expect(q("[data-result-summary]")).toBeNull();
  });
});

describe("Document contents", () => {
  it("lists only the sections the signed PDF actually contains", async () => {
    await renderTab();
    const box = q("[data-document-contents]")!;
    expect(box.querySelector("h4")!.textContent).toBe("Included in the signed appraisal");
    expect(qa("[data-document-item]").map((li) => li.textContent)).toEqual([
      "Employee details & cover page",
      "Workplan objectives & actuals",
      "Core competency ratings",
      "Technical competencies",
      "Productivity assessment",
      "Summary score & HR recommendation",
      "Signature block",
    ]);
    expect(box.textContent).not.toMatch(/Leadership|Evidence/);
    for (const li of qa("[data-document-item]")) expect(li.querySelector("svg")).not.toBeNull();
  });

  it("shows Leadership explicitly when it applies", async () => {
    await renderTab({ showLeadership: true });
    expect(qa("[data-document-item]").map((li) => li.textContent)).toContain("Leadership assessment");
  });

  it("matches the PDF template sections", () => {
    const template = read("lib/pdf/appraisal-template.html");
    const pdf = read("lib/appraisal-pdf.ts");
    expect(template).toContain('id="cover-page"');
    expect(template).toContain("SECTION A — WORKPLAN ASSESSMENT");
    expect(template).toContain("SECTION B — CORE COMPETENCIES");
    expect(template).toContain("SECTION C — TECHNICAL COMPETENCIES");
    expect(template).toContain("SECTION D — PRODUCTIVITY ASSESSMENT");
    expect(template).toContain("SECTION F — OVERALL SUMMARY");
    expect(template).toContain("HR RECOMMENDATION");
    expect(template).toContain("SECTION G — SIGN-OFF");
    expect(pdf).toContain("const leadershipSection = data.appraisal.showLeadership");
    expect(template.toLowerCase()).not.toContain("evidence");
    expect(signedDocumentItems(false)).toHaveLength(7);
    expect(signedDocumentItems(true)).toHaveLength(8);
  });
});

describe("Manager comments", () => {
  it("is a light optional section with a compact 3-line textarea", async () => {
    await renderTab();
    const section = q("[data-manager-comments]")!;
    expect(section.className).not.toMatch(/\bborder\b|bg-ds-surface/);
    expect(section.querySelector("h3")!.textContent).toBe("Manager comments");
    expect(section.textContent).toContain("Optional · Saved with the appraisal");
    const textarea = section.querySelector("textarea")!;
    expect(textarea.getAttribute("rows")).toBe("3");
    expect(textarea.className).toContain("resize-none");
    expect(textarea.style.maxHeight).toBe("240px");
    expect(textarea.getAttribute("aria-labelledby")).toBe(section.querySelector("h3")!.id);
  });
});

describe("Responsive behaviour", () => {
  it("summary stacks 2×2 on narrow screens and goes horizontal from sm", async () => {
    await renderTab();
    const cls = q("[data-result-summary]")!.className;
    expect(cls).toContain("grid-cols-2");
    expect(cls).toContain("sm:grid-cols-4");
  });

  it("signer flow stacks on narrow screens, sits on one line from sm, and hides arrows when stacked", async () => {
    await renderTab();
    const flow = q("[data-signer-flow]")!;
    expect(flow.className).toContain("flex-col");
    expect(flow.className).toContain("sm:flex-row");
    const arrow = q('[data-signer-step="1"] svg')!;
    expect(arrow.getAttribute("class")).toContain("hidden");
    expect(arrow.getAttribute("class")).toContain("sm:block");
  });

  it("header stacks and the CTA becomes full width on narrow screens", async () => {
    await renderTab();
    const header = q("[data-signoff-section] [data-signoff-header]")!;
    expect(header.className).toContain("flex-col");
    expect(header.className).toContain("sm:flex-row");
    expect(cta()!.className).toContain("max-sm:w-full");
  });

  it("introduces no horizontal scrolling or fixed wide widths", async () => {
    await renderTab();
    const html = container.innerHTML;
    expect(html).not.toMatch(/overflow-x-(auto|scroll)/);
    expect(html).not.toMatch(/min-w-\[(\d{3,})px\]/);
  });
});

describe("static guards", () => {
  it("no longer portals the CTA outside the Sign-off section", () => {
    expect(read("components/appraisal/SignoffsTab.tsx")).not.toMatch(/createPortal|manager-review-actions/);
    expect(read("components/appraisal/AppraisalTabs.tsx")).not.toContain("manager-review-actions");
  });

  it("keeps the existing sign-off requests", () => {
    const src = read("components/appraisal/SignoffsTab.tsx");
    expect(src).toContain("`/api/appraisals/${appraisalId}/signoff/submit`");
    expect(src).toContain("body: JSON.stringify({ managerComments: managerComments || undefined })");
    expect(src).toContain("`/api/appraisals/${appraisalId}/signoff/status?showLeadership=");
    expect(src).toContain("`/api/appraisals/${appraisalId}/check-adobe-status`");
    expect(src).toContain('if (status === "MANAGER_REVIEW") return "READY_TO_SUBMIT";');
    expect(src).toContain('const canSubmit = (isAppraisalManager || isHR) && status === "MANAGER_REVIEW";');
  });
});
