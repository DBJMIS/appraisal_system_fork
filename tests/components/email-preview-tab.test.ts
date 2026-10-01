// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { EmailPreviewTab } from "@/components/admin/tabs/EmailPreviewTab";
import { AdminPanelContext, type AdminPanelContextValue } from "@/components/admin/AdminPanelContext";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let previewResponse: { status: number; body: unknown };
let testSendResponse: { status: number; body: unknown };

const jsonResponse = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

const HTML = '<!DOCTYPE html><html><body><a href="https://ascend.example.test/appraisals/a-1">Open Mid-Year Review</a></body></html>';

async function flush() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

const q = <T extends Element = HTMLElement>(sel: string) => container.querySelector(sel) as T | null;

async function choose(id: string, value: string) {
  const el = q<HTMLSelectElement>(`#${id}`)!;
  await act(async () => {
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flush();
}

async function type(id: string, value: string) {
  const el = q<HTMLInputElement>(`#${id}`)!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(sel: string) {
  await act(async () => {
    q<HTMLButtonElement>(sel)!.click();
  });
  await flush();
}

function render() {
  const value = {
    cycles: [{ id: "c-1", name: "FY 2026", cycle_type: "annual", fiscal_year: "2026", start_date: "2026-04-01", end_date: "2027-03-31", status: "open" }],
  } as unknown as AdminPanelContextValue;
  act(() => {
    root.render(createElement(AdminPanelContext.Provider, { value }, createElement(EmailPreviewTab)));
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  previewResponse = {
    status: 200,
    body: {
      subject: "Mid-Year Review due 30 Oct 2026",
      text: "Hello Jane Employee,\n\nYour Mid-Year Review for FY 2026/27 is due on 30 Oct 2026.",
      html: HTML,
      recipientRole: "employee",
      warnings: [],
    },
  };
  testSendResponse = { status: 200, body: { ok: true, transport: "graph" } };
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.startsWith("/api/admin/email-preview") && (!init || init.method !== "POST")) {
      return jsonResponse({
        kinds: [
          { kind: "MIDYEAR_DUE_SOON", label: "Mid-Year Review due soon", recipientRole: "employee" },
          { kind: "MANAGER_REVIEW_PENDING", label: "Manager review pending", recipientRole: "manager" },
        ],
        appraisals: [{ id: "a-1", label: "Jane Employee · In progress" }],
        appUrl: { configured: true, warning: null },
      });
    }
    if (url === "/api/admin/email-preview") return jsonResponse(previewResponse.body, previewResponse.status);
    if (url === "/api/admin/test-email") return jsonResponse(testSendResponse.body, testSendResponse.status);
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const postsTo = (url: string) => fetchMock.mock.calls.filter((c) => c[0] === url && (c[1] as RequestInit | undefined)?.method === "POST");

describe("EmailPreviewTab", () => {
  it("loads the open cycle's appraisals and notification types", async () => {
    render();
    await flush();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/email-preview?cycleId=c-1");
    expect(container.textContent).toContain("Jane Employee · In progress");
    expect(container.textContent).toContain("Mid-Year Review due soon (employee)");
    expect(q<HTMLButtonElement>("[data-preview-action]")!.disabled).toBe(true);
    expect(q<HTMLButtonElement>("[data-send-test-action]")!.disabled).toBe(true);
  });

  it("previews subject, recipient role, text and sandboxed HTML without sending", async () => {
    render();
    await flush();
    await choose("email-preview-appraisal", "a-1");
    await choose("email-preview-kind", "MIDYEAR_DUE_SOON");
    await click("[data-preview-action]");

    expect(JSON.parse(postsTo("/api/admin/email-preview")[0][1].body as string)).toEqual({ kind: "MIDYEAR_DUE_SOON", appraisalId: "a-1" });
    expect(postsTo("/api/admin/test-email")).toHaveLength(0);
    expect(q("[data-preview-subject]")!.textContent).toBe("Mid-Year Review due 30 Oct 2026");
    expect(q("[data-preview-role]")!.textContent).toBe("Employee");
    expect(q("[data-email-text-preview]")!.textContent).toContain("Your Mid-Year Review for FY 2026/27 is due on 30 Oct 2026.");
    const iframe = q<HTMLIFrameElement>("[data-email-html-preview]")!;
    expect(iframe.getAttribute("sandbox")).toBe("");
    expect(iframe.getAttribute("srcdoc")).toBe(HTML);
    expect(container.querySelector("[data-preview-result] a")).toBeNull();
  });

  it("shows preview warnings such as a missing app URL", async () => {
    previewResponse.body = { ...(previewResponse.body as object), warnings: ["NEXT_PUBLIC_APP_URL is not set, so this email has no link."] };
    render();
    await flush();
    await choose("email-preview-appraisal", "a-1");
    await choose("email-preview-kind", "MIDYEAR_DUE_SOON");
    await click("[data-preview-action]");
    expect(q("[data-preview-warnings]")!.textContent).toContain("NEXT_PUBLIC_APP_URL is not set");
  });

  it("sends a test copy only to the typed address", async () => {
    render();
    await flush();
    await choose("email-preview-appraisal", "a-1");
    await choose("email-preview-kind", "MIDYEAR_DUE_SOON");
    expect(q<HTMLInputElement>("#email-preview-test-to")!.value).toBe("");
    expect(q<HTMLButtonElement>("[data-send-test-action]")!.disabled).toBe(true);

    await type("email-preview-test-to", "tester@dbankjm.com");
    await click("[data-send-test-action]");
    expect(postsTo("/api/admin/test-email")).toHaveLength(1);
    expect(JSON.parse(postsTo("/api/admin/test-email")[0][1].body as string)).toEqual({
      to: "tester@dbankjm.com",
      kind: "MIDYEAR_DUE_SOON",
      appraisalId: "a-1",
    });
    expect(q("[data-send-result]")!.getAttribute("data-send-result")).toBe("success");
    expect(q("[data-send-result]")!.textContent).toContain("tester@dbankjm.com");
  });

  it("shows the controlled error when the test send fails", async () => {
    testSendResponse = { status: 502, body: { ok: false, transport: "graph", error: "Microsoft Graph refused to send (HTTP 403).", code: "GRAPH_403" } };
    render();
    await flush();
    await choose("email-preview-appraisal", "a-1");
    await choose("email-preview-kind", "MIDYEAR_DUE_SOON");
    await type("email-preview-test-to", "tester@dbankjm.com");
    await click("[data-send-test-action]");
    expect(q("[data-send-result]")!.getAttribute("data-send-result")).toBe("error");
    expect(q("[data-send-result]")!.textContent).toBe("Microsoft Graph refused to send (HTTP 403).");
  });
});
