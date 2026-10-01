// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import fs from "node:fs";
import path from "node:path";
import { CheckInTab } from "@/components/appraisal/checkins/CheckInTab";
import { ScoreSnapshotsView } from "@/components/appraisal/ScoreSnapshotsPanel";
import type { CheckInWithResponses, MidyearRevision } from "@/types/checkins";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let fetchMock: ReturnType<typeof vi.fn>;
let pageData: Record<string, unknown>;
let patchResponse: () => Promise<unknown>;
let afterPatch: Record<string, unknown> | null;
let confirmSpy: ReturnType<typeof vi.fn>;

const HR = { employee_id: "hr-1", roles: ["hr"] };
const MANAGER = { employee_id: "mgr-1", roles: [] as string[] };
const EMPLOYEE = { employee_id: "emp-1", roles: [] as string[] };
const noAccess = { isEmployee: false, hasManagerAccess: false, isDelegate: false, isHrAdmin: false };
const hrAccess = { ...noAccess, isHrAdmin: true };
const midyearOn = { enabled: true, scoringEnabled: true, windowStart: "2026-09-30", dueDate: "2026-10-30" };
const REASON = "Manager rating entered against the wrong target.";

const openRevision: MidyearRevision = {
  revision_number: 2,
  reopened_at: "2026-10-20T10:00:00Z",
  reopened_by: "u-hr",
  reopened_by_name: "Helen HR",
  reopen_reason: REASON,
  previous_score_revision: 1,
  completed_at: null,
  completed_by: null,
  score_revision: null,
};

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
    employee_submitted_at: "2026-10-05T09:00:00Z",
    manager_reviewed_at: null,
    manager_overall_notes: null,
    note_to_employee: null,
    created_at: "2026-09-30",
    updated_at: "2026-09-30",
    responses: [],
    competency_ratings: [],
    midyear_revisions: [],
    ...overrides,
  } as CheckInWithResponses;
}

function data(overrides: Record<string, unknown> = {}) {
  return {
    checkIns: [formal("COMPLETE")],
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
    currentUser: HR,
    access: hrAccess,
    midyear: midyearOn,
    ...overrides,
  };
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  pageData = data();
  afterPatch = null;
  patchResponse = async () => ({ ok: true, json: async () => ({ success: true, revision_number: 2 }) });
  confirmSpy = vi.fn(() => true);
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      const res = await patchResponse();
      if (afterPatch && (res as { ok: boolean }).ok) pageData = afterPatch;
      return res;
    }
    if (url.endsWith("/score-snapshots")) return { ok: false, json: async () => ({}) };
    return { ok: true, json: async () => pageData };
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("confirm", confirmSpy);
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

async function rerender(d: Record<string, unknown>) {
  act(() => root.unmount());
  root = createRoot(container);
  await renderTab(d);
}

const reopenButton = () => document.querySelector<HTMLButtonElement>("[data-midyear-reopen]");
const dialog = () => document.querySelector<HTMLElement>("[data-reopen-midyear-dialog]");
const reasonField = () => document.querySelector<HTMLTextAreaElement>("[data-reopen-midyear-reason]");
const dialogButton = (label: RegExp) =>
  [...(dialog()?.querySelectorAll("button") ?? [])].find((b) => label.test(b.textContent ?? "")) as HTMLButtonElement;
const patches = () => fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "PATCH");

function typeReason(value: string) {
  const el = reasonField()!;
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function openDialog() {
  await act(async () => reopenButton()!.click());
  await flush();
}

describe("Reopen Mid-Year Review visibility", () => {
  it("HR and admin see it on a completed formal review while the appraisal is In progress", async () => {
    await renderTab(data());
    expect(reopenButton()?.textContent).toBe("Reopen Mid-Year Review");
    expect(reopenButton()!.closest("[data-midyear-banner]")).not.toBeNull();
    await rerender(data({ currentUser: { employee_id: "adm-1", roles: ["admin"] } }));
    expect(reopenButton()).not.toBeNull();
  });

  it.each([
    ["the employee", { currentUser: EMPLOYEE, access: { ...noAccess, isEmployee: true } }],
    ["HR on their own appraisal", { currentUser: { employee_id: "emp-1", roles: ["hr"] }, access: { ...hrAccess, isEmployee: true } }],
    ["the manager", { currentUser: MANAGER, access: { ...noAccess, hasManagerAccess: true } }],
    ["an unrelated viewer", { currentUser: { employee_id: "gm-1", roles: ["gm"] }, access: noAccess }],
  ])("%s does not see it", async (_label, overrides) => {
    await renderTab(data(overrides));
    expect(document.querySelector("[data-midyear-banner]")).not.toBeNull();
    expect(reopenButton()).toBeNull();
  });

  it("is hidden unless the review is COMPLETE and the appraisal In progress", async () => {
    for (const status of ["OPEN", "EMPLOYEE_SUBMITTED", "MANAGER_REVIEWED", "CANCELLED"]) {
      await rerender(data({ checkIns: [formal(status)] }));
      expect(reopenButton()).toBeNull();
    }
    for (const status of ["SELF_ASSESSMENT", "MANAGER_REVIEW", "COMPLETE"]) {
      await rerender(data({ appraisal: { ...(data().appraisal as object), status } }));
      expect(reopenButton()).toBeNull();
    }
    await rerender(data());
    act(() => root.unmount());
    root = createRoot(container);
    await renderTab(data(), { readOnly: true });
    expect(reopenButton()).toBeNull();
  });

  it("is hidden for an informal check-in", async () => {
    await renderTab(data({ checkIns: [formal("MANAGER_REVIEWED", { review_mode: "INFORMAL", check_in_type: "ADHOC", competency_ratings: undefined })] }));
    expect(reopenButton()).toBeNull();
  });
});

describe("Reopen confirmation dialog", () => {
  it("is an application dialog with the agreed wording and a required reason", async () => {
    await renderTab(data());
    await openDialog();
    const d = dialog()!;
    expect(d.getAttribute("role")).toBe("alertdialog");
    expect(d.textContent).toContain("Reopen Mid-Year Review?");
    expect(d.textContent).toContain(
      "This will reopen the completed Mid-Year Review for revision. The existing Mid-Year score will no longer be treated as current until the review is completed again."
    );
    expect(d.textContent).toContain("Reason for revision");
    expect(reasonField()!.required).toBe(true);
    expect(dialogButton(/^Keep completed$/)).toBeTruthy();
    expect(dialogButton(/^Reopen review$/).disabled).toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(patches()).toEqual([]);
  });

  it("a blank reason keeps Reopen review disabled", async () => {
    await renderTab(data());
    await openDialog();
    typeReason("   ");
    expect(dialogButton(/^Reopen review$/).disabled).toBe(true);
    typeReason(REASON);
    expect(dialogButton(/^Reopen review$/).disabled).toBe(false);
  });

  it("Keep completed closes it without calling the API", async () => {
    await renderTab(data());
    await openDialog();
    typeReason(REASON);
    await act(async () => dialogButton(/^Keep completed$/).click());
    await flush();
    expect(dialog()).toBeNull();
    expect(patches()).toEqual([]);
  });

  it("Reopen review sends REOPEN with the reason and refreshes into the revision", async () => {
    afterPatch = data({ checkIns: [formal("EMPLOYEE_SUBMITTED", { midyear_revisions: [openRevision] })] });
    await renderTab(data());
    await openDialog();
    typeReason(`  ${REASON}  `);
    await act(async () => dialogButton(/^Reopen review$/).click());
    await flush();

    expect(patches()).toHaveLength(1);
    const [url, init] = patches()[0];
    expect(url).toBe("/api/appraisals/a-1/checkins/ci-formal");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ action: "REOPEN", reason: REASON });
    expect(dialog()).toBeNull();
    expect(reopenButton()).toBeNull();
    expect(document.querySelector("[data-midyear-banner-title]")?.textContent).toContain("Revision in progress");
    expect(document.querySelector("[data-midyear-revision-notice]")).not.toBeNull();
  });

  it("shows the server's refusal in the dialog and keeps it open", async () => {
    patchResponse = async () => ({ ok: false, json: async () => ({ error: "Only HR or an administrator can reopen a completed Mid-Year Review." }) });
    await renderTab(data());
    await openDialog();
    typeReason(REASON);
    await act(async () => dialogButton(/^Reopen review$/).click());
    await flush();
    expect(document.querySelector("[data-reopen-midyear-error]")?.textContent).toBe(
      "Only HR or an administrator can reopen a completed Mid-Year Review."
    );
    expect(dialog()).not.toBeNull();
  });
});

describe("while the review is being revised", () => {
  const revising = (overrides: Record<string, unknown> = {}) =>
    data({ checkIns: [formal("EMPLOYEE_SUBMITTED", { midyear_revisions: [openRevision] })], ...overrides });

  it("shows Revision in progress with the revision number, reason and who reopened it", async () => {
    await renderTab(revising({ currentUser: EMPLOYEE, access: { ...noAccess, isEmployee: true } }));
    expect(document.querySelector("[data-midyear-banner-title]")?.textContent).toBe("Mid-Year Review · FY 2026/27 · Revision in progress");
    expect(document.querySelector("[data-midyear-banner-status]")?.textContent).toBe("Revision in progress (revision 2)");
    const notice = document.querySelector("[data-midyear-revision-notice]")!;
    expect(notice.textContent).toContain("Mid-Year Review · Revision in progress");
    expect(notice.querySelector("[data-midyear-revision-number]")?.textContent).toBe("(revision 2)");
    expect(notice.querySelector("[data-midyear-revision-reopened-by]")?.textContent).toContain("Reopened by Helen HR");
    expect(notice.querySelector("[data-midyear-revision-reason]")?.textContent).toBe(`Reason: ${REASON}`);
    expect(document.querySelector("[data-midyear-header-status]")?.textContent).toContain("Revision in progress");
  });

  it("the manager gets the editable manager portion again", async () => {
    await renderTab(revising({ currentUser: MANAGER, access: { ...noAccess, hasManagerAccess: true } }));
    expect(document.querySelector('[data-midyear-workspace="MANAGER_EDIT"]')).not.toBeNull();
    expect(document.querySelector("[data-midyear-revision-notice]")?.textContent).toContain("Update your assessment and submit the manager review again.");
  });

  it("the employee's view stays read-only", async () => {
    await renderTab(revising({ currentUser: EMPLOYEE, access: { ...noAccess, isEmployee: true } }));
    expect(document.querySelector('[data-midyear-workspace="READ_ONLY"]')).not.toBeNull();
    expect(document.querySelector('[data-midyear-workspace="EMPLOYEE_EDIT"]')).toBeNull();
  });

  it("HR cannot cancel a review that is being revised, and no reopen action is offered", async () => {
    await renderTab(data({ checkIns: [formal("EMPLOYEE_SUBMITTED")] }));
    expect([...document.querySelectorAll("button")].some((b) => /Cancel/.test(b.textContent ?? ""))).toBe(true);
    await rerender(revising());
    expect(document.querySelector('[data-midyear-workspace="READ_ONLY"]')).not.toBeNull();
    expect(document.querySelector("[data-cancel-checkin]")).toBeNull();
    expect([...document.querySelectorAll("button")].some((b) => /Cancel/.test(b.textContent ?? ""))).toBe(false);
    expect(reopenButton()).toBeNull();
  });

  it("a review that has never been revised shows no revision notice", async () => {
    await renderTab(data({ checkIns: [formal("EMPLOYEE_SUBMITTED")], currentUser: MANAGER, access: { ...noAccess, hasManagerAccess: true } }));
    expect(document.querySelector("[data-midyear-revision-notice]")).toBeNull();
    expect(document.querySelector("[data-midyear-banner-title]")?.textContent).toBe("Mid-Year Review · FY 2026/27");
    expect(document.querySelector("[data-midyear-header-status]")?.textContent).not.toContain("Revision");
  });
});

describe("score revisions in the score panel", () => {
  const render = async (props: Parameters<typeof ScoreSnapshotsView>[0]) => {
    await act(async () => root.render(createElement(ScoreSnapshotsView, props)));
  };
  const rev = (revision: number, total: number, superseded: boolean) => ({
    revision,
    total,
    grade: "C",
    gradeLabel: "Good",
    recordedAt: "2026-10-01T10:00:00Z",
    supersededAt: superseded ? "2026-10-20T10:00:00Z" : null,
  });

  it("shows the latest revision as current and earlier ones as history", async () => {
    await render({
      comparison: { midyear: { total: 75.1, grade: "C", gradeLabel: "Good" }, final: null, change: null, official: null },
      midyearRevision: 2,
      midyearRevisions: [rev(1, 72.4, true), rev(2, 75.1, false)],
    });
    expect(document.querySelector('[data-score-value="midyear"]')?.textContent).toBe("75.1");
    expect(document.querySelector("[data-score-revision]")?.textContent).toBe("Revision 2");
    const history = [...document.querySelectorAll("[data-score-revision-entry]")].map((e) => e.getAttribute("data-score-revision-entry"));
    expect(history).toEqual(["1"]);
    expect(document.querySelector('[data-score-revision-entry="1"]')?.textContent).toContain("72.4");
    expect(document.body.textContent).not.toContain("73.75");
  });

  it("while revising there is no current Mid-Year score, only the earlier one in history", async () => {
    await render({
      comparison: { midyear: null, final: null, change: null, official: null },
      midyearRevision: null,
      midyearRevisions: [rev(1, 72.4, true)],
    });
    expect(document.querySelector('[data-score-value="midyear"]')).toBeNull();
    expect(document.querySelector('[data-score-cell="midyear-revising"]')?.textContent).toContain("Revision in progress");
    expect(document.querySelector('[data-score-revision-entry="1"]')).not.toBeNull();
  });

  it("an unrevised score renders exactly as before", async () => {
    await render({
      comparison: { midyear: { total: 72.4, grade: "C", gradeLabel: "Good" }, final: null, change: null, official: null },
      midyearRevision: 1,
      midyearRevisions: [rev(1, 72.4, false)],
    });
    expect(document.querySelector("[data-score-revision]")).toBeNull();
    expect(document.querySelector("[data-score-revision-history]")).toBeNull();
  });
});

describe("UI and API agree on who may reopen", () => {
  it("both restrict reopen to HR/admin and never the employee", () => {
    const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
    expect(read("components/appraisal/checkins/CheckInTab.tsx")).toMatch(/access\?\.isHrAdmin === true &&\s*!isThisMyAppraisal/);
    expect(read("lib/midyear-lifecycle.ts")).toContain("a.isHrAdmin && !a.isEmployee");
  });
});
