// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import fs from "node:fs";
import path from "node:path";
import { CheckInTab } from "@/components/appraisal/checkins/CheckInTab";
import { formalMidyearCreateBody } from "@/lib/midyear-config";
import type { CheckInWithResponses } from "@/types/checkins";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let pageData: Record<string, unknown>;
let postResponse: () => Promise<unknown>;
let afterPost: Record<string, unknown> | null;

const MANAGER = { employee_id: "mgr-1", roles: [] as string[] };
const EMPLOYEE = { employee_id: "emp-1", roles: [] as string[] };
const noAccess = { isEmployee: false, hasManagerAccess: false, isDelegate: false, isHrAdmin: false };
const midyearOn = { enabled: true, scoringEnabled: true, windowStart: "2026-09-30", dueDate: "2026-10-30" };

function formal(status: string, overrides: Partial<CheckInWithResponses> = {}): CheckInWithResponses {
  return {
    id: "ci-formal",
    appraisal_id: "a-1",
    title: "Mid-Year Review – FY 2026/27",
    check_in_type: "MIDYEAR",
    review_mode: "FORMAL_SCORED",
    is_management_track: false,
    initiated_by: null,
    due_date: "2026-10-30",
    status,
    employee_submitted_at: null,
    manager_reviewed_at: null,
    manager_overall_notes: null,
    note_to_employee: null,
    created_at: "2026-09-30",
    updated_at: "2026-09-30",
    responses: [],
    competency_ratings: [],
    ...overrides,
  } as CheckInWithResponses;
}

function data(overrides: Record<string, unknown> = {}) {
  return {
    checkIns: [],
    appraisal: {
      id: "a-1",
      employee_id: "emp-1",
      manager_employee_id: "mgr-1",
      employeeName: "Employee",
      cycleLabel: "FY 2026/27",
      fiscalYear: "FY 2026/27",
      status: "IN_PROGRESS",
    },
    workplanItems: [{ id: "wi-1", major_task: "Task", corporate_objective: "", division_objective: "", key_output: "", weight: 100, metric_target: null }],
    currentUser: MANAGER,
    access: noAccess,
    midyear: midyearOn,
    ...overrides,
  };
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  pageData = data();
  afterPost = null;
  postResponse = async () => ({ ok: true, json: async () => ({ success: true }) });
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      const res = await postResponse();
      if (afterPost && (res as { ok: boolean }).ok) pageData = afterPost;
      return res;
    }
    return { ok: true, json: async () => pageData };
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function flush() {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function renderTab(d: Record<string, unknown>, props: { readOnly?: boolean } = {}) {
  pageData = d;
  await act(async () =>
    root.render(createElement(CheckInTab, { appraisalId: "a-1", isManager: false, isHR: false, isEmployee: false, ...props }))
  );
  await flush();
}

const startButton = () => document.querySelector<HTMLButtonElement>("[data-midyear-start]");
const bannerStatus = () => document.querySelector("[data-midyear-banner-status]")?.textContent;
const posts = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST");

describe("Start Mid-Year Review visibility", () => {
  it("the direct manager sees Start Mid-Year Review on the banner", async () => {
    await renderTab(data());
    expect(bannerStatus()).toBe("Not started");
    const btn = startButton()!;
    expect(btn.textContent).toBe("Start Mid-Year Review");
    expect(btn.disabled).toBe(false);
    expect(btn.closest("[data-midyear-banner]")).not.toBeNull();
  });

  it("an active delegate sees it", async () => {
    await renderTab(
      data({ currentUser: { employee_id: "del-1", roles: [] }, access: { ...noAccess, hasManagerAccess: true, isDelegate: true } })
    );
    expect(startButton()).not.toBeNull();
  });

  it("HR and admin see it, as the server allows them to start the review", async () => {
    await renderTab(data({ currentUser: { employee_id: "hr-1", roles: ["hr"] }, access: { ...noAccess, isHrAdmin: true } }));
    expect(startButton()).not.toBeNull();
    act(() => root.unmount());
    root = createRoot(container);
    await renderTab(data({ currentUser: { employee_id: "adm-1", roles: ["admin"] }, access: { ...noAccess, isHrAdmin: true } }));
    expect(startButton()).not.toBeNull();
  });

  it("the employee does not see it, even with an HR role on their own appraisal", async () => {
    await renderTab(data({ currentUser: EMPLOYEE, access: { ...noAccess, isEmployee: true } }));
    expect(document.querySelector("[data-midyear-banner]")).not.toBeNull();
    expect(startButton()).toBeNull();
    act(() => root.unmount());
    root = createRoot(container);
    await renderTab(data({ currentUser: { employee_id: "emp-1", roles: ["hr"] }, access: { ...noAccess, isEmployee: true, isHrAdmin: true } }));
    expect(startButton()).toBeNull();
  });

  it("an unrelated viewer does not see it", async () => {
    await renderTab(data({ currentUser: { employee_id: "gm-1", roles: ["gm"] } }));
    expect(startButton()).toBeNull();
  });

  it("appears only while the appraisal is IN_PROGRESS", async () => {
    for (const status of ["DRAFT", "SELF_ASSESSMENT", "MANAGER_REVIEW", "COMPLETE"]) {
      await renderTab(data({ appraisal: { ...(data().appraisal as object), status } }));
      expect(startButton()).toBeNull();
      act(() => root.unmount());
      root = createRoot(container);
    }
    await renderTab(data(), { readOnly: true });
    expect(startButton()).toBeNull();
  });

  it("is hidden when Mid-Year Review is not enabled for the cycle", async () => {
    await renderTab(data({ midyear: { enabled: false, scoringEnabled: false, windowStart: null, dueDate: null } }));
    expect(document.querySelector("[data-midyear-banner]")).toBeNull();
    expect(startButton()).toBeNull();
  });

  it("is hidden once a formal Mid-Year Review exists, and shown again after it is cancelled", async () => {
    for (const status of ["OPEN", "EMPLOYEE_SUBMITTED", "MANAGER_REVIEWED", "COMPLETE"]) {
      await renderTab(data({ checkIns: [formal(status)] }));
      expect(startButton()).toBeNull();
      act(() => root.unmount());
      root = createRoot(container);
    }
    await renderTab(data({ checkIns: [formal("CANCELLED")] }));
    expect(bannerStatus()).toBe("Cancelled – can be restarted");
    expect(startButton()).not.toBeNull();
  });

  it("is unavailable, with a reason, while an informal check-in is still open", async () => {
    const informal = formal("OPEN", { id: "ci-adhoc", title: "Q2", check_in_type: "ADHOC", review_mode: "INFORMAL", competency_ratings: undefined });
    await renderTab(data({ checkIns: [informal] }));
    expect(startButton()!.disabled).toBe(true);
    expect(document.querySelector("[data-midyear-start-hint]")?.textContent).toBe("Complete or cancel the current check-in first.");
  });
});

describe("Start Mid-Year Review action", () => {
  it("posts the existing formal creation request and updates the banner and card", async () => {
    afterPost = data({ checkIns: [formal("OPEN")] });
    await renderTab(data());
    await act(async () => startButton()!.click());
    await flush();

    expect(posts()).toHaveLength(1);
    const [url, init] = posts()[0];
    expect(url).toBe("/api/appraisals/a-1/checkins");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      check_in_type: "MIDYEAR",
      review_mode: "FORMAL_SCORED",
      due_date: "2026-10-30",
      note_to_employee: null,
    });

    expect(bannerStatus()).toBe("Awaiting employee input");
    expect(startButton()).toBeNull();
    expect(document.body.textContent).toContain("Mid-Year Review – FY 2026/27");
    expect(document.body.textContent).toContain("Awaiting employee");
  });

  it("requests an unscored formal review when scoring is off", async () => {
    await renderTab(data({ midyear: { ...midyearOn, scoringEnabled: false } }));
    await act(async () => startButton()!.click());
    await flush();
    expect(JSON.parse((posts()[0][1] as RequestInit).body as string).review_mode).toBe("FORMAL");
  });

  it("shows Starting… and ignores repeat clicks while the request is in flight", async () => {
    let resolve!: (v: unknown) => void;
    postResponse = () => new Promise((r) => (resolve = r));
    await renderTab(data());
    await act(async () => startButton()!.click());
    expect(startButton()!.textContent).toBe("Starting…");
    expect(startButton()!.disabled).toBe(true);
    await act(async () => startButton()!.click());
    expect(posts()).toHaveLength(1);
    await act(async () => resolve({ ok: true, json: async () => ({ success: true }) }));
    await flush();
    expect(startButton()!.textContent).toBe("Start Mid-Year Review");
  });

  it("shows the server's message when creation is refused and lets the user retry", async () => {
    postResponse = async () => ({ ok: false, json: async () => ({ error: "A Mid-Year Review already exists for this appraisal." }) });
    await renderTab(data());
    await act(async () => startButton()!.click());
    await flush();
    expect(document.querySelector("[data-midyear-start-error]")?.textContent).toBe(
      "A Mid-Year Review already exists for this appraisal."
    );
    expect(startButton()!.disabled).toBe(false);
  });
});

describe("formal creation request", () => {
  it("uses the cycle due date, with the caller's date only as a fallback", () => {
    expect(formalMidyearCreateBody(midyearOn)).toEqual({
      check_in_type: "MIDYEAR",
      review_mode: "FORMAL_SCORED",
      due_date: "2026-10-30",
      note_to_employee: null,
    });
    expect(formalMidyearCreateBody({ ...midyearOn, dueDate: null }, { due_date: "2026-11-15", note_to_employee: "Hi" })).toEqual({
      check_in_type: "MIDYEAR",
      review_mode: "FORMAL_SCORED",
      due_date: "2026-11-15",
      note_to_employee: "Hi",
    });
  });

  it("the banner action and the New check-in modal share the same request builder", () => {
    const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
    expect(read("components/appraisal/checkins/CheckInTab.tsx")).toContain("formalMidyearCreateBody(data?.midyear)");
    expect(read("components/appraisal/checkins/NewCheckInModal.tsx")).toContain("formalMidyearCreateBody(midyear,");
  });
});
