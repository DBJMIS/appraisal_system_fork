// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ScoreSnapshotsView } from "@/components/appraisal/ScoreSnapshotsPanel";
import { CheckInTab } from "@/components/appraisal/checkins/CheckInTab";
import { compareScores } from "@/lib/score-comparison";
import type { CheckInStatus, CheckInWithResponses } from "@/types/checkins";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

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

const q = (sel: string) => container.querySelector(sel)?.textContent ?? null;
const score = (total: number, grade: string, gradeLabel: string) => ({ total, grade, gradeLabel });

describe("ScoreSnapshotsView", () => {
  it("renders nothing when neither score exists", () => {
    act(() => root.render(createElement(ScoreSnapshotsView, { comparison: compareScores(null, null) })));
    expect(container.querySelector("[data-score-snapshots]")).toBeNull();
  });

  it("MIDYEAR only: Mid-Year shown, no Final, no change, not official", () => {
    act(() => root.render(createElement(ScoreSnapshotsView, { comparison: compareScores(score(72.4, "C", "Good"), null) })));
    expect(q('[data-score-value="midyear"]')).toBe("72.4");
    expect(q('[data-score-grade="midyear"]')).toBe("C · Good");
    expect(container.querySelector('[data-score-cell="final"]')).toBeNull();
    expect(container.querySelector("[data-score-change]")).toBeNull();
    expect(container.querySelector("[data-score-official]")).toBeNull();
  });

  it("FINAL only: Final shown as the official result", () => {
    act(() => root.render(createElement(ScoreSnapshotsView, { comparison: compareScores(null, score(81.6, "B", "Very good")) })));
    expect(q('[data-score-value="final"]')).toBe("81.6");
    expect(q("[data-score-official]")).toBe("Official result");
    expect(container.querySelector('[data-score-cell="midyear"]')).toBeNull();
    expect(container.querySelector("[data-score-change]")).toBeNull();
  });

  it("both: Mid-Year 72.4, Final 81.6, Change +9.2 — and no average anywhere", () => {
    act(() =>
      root.render(createElement(ScoreSnapshotsView, { comparison: compareScores(score(72.4, "C", "Good"), score(81.6, "B", "Very good")) }))
    );
    expect(q('[data-score-value="midyear"]')).toBe("72.4");
    expect(q('[data-score-value="final"]')).toBe("81.6");
    expect(q("[data-score-change]")).toBe("+9.2");
    const text = container.textContent ?? "";
    expect(text).not.toContain("77.0");
    expect(text).toMatch(/not averaged/);
    expect(container.querySelectorAll("[data-score-official]")).toHaveLength(1);
    expect(container.querySelector('[data-score-cell="final"] [data-score-official]')).not.toBeNull();
  });
});

const formal = (status: CheckInStatus, id = `ci-${status}`) =>
  ({
    id,
    appraisal_id: "a-1",
    title: "Mid-Year Review – 2026",
    check_in_type: "MIDYEAR",
    review_mode: "FORMAL_SCORED",
    is_management_track: false,
    initiated_by: null,
    due_date: "2026-06-30",
    status,
    employee_submitted_at: null,
    manager_reviewed_at: null,
    manager_overall_notes: null,
    note_to_employee: null,
    created_at: "2026-06-01",
    updated_at: "2026-06-01",
    responses: [],
  }) as unknown as CheckInWithResponses;

async function renderTab(checkIns: CheckInWithResponses[], readOnly: boolean, snapshots: unknown = { midyear: null, final: null, change: null, official: null }) {
  const fetchMock = vi.fn(async (url: string) => ({
    ok: true,
    json: async () =>
      url.endsWith("/score-snapshots")
        ? snapshots
        : {
            checkIns,
            appraisal: { id: "a-1", employee_id: "emp-1", manager_employee_id: "mgr-1", employeeName: "Jane", cycleLabel: "FY 2026", fiscalYear: "2026", status: readOnly ? "COMPLETE" : "IN_PROGRESS" },
            workplanItems: [],
            currentUser: { employee_id: "mgr-1", roles: ["manager"] },
            access: { isEmployee: false, hasManagerAccess: true, isDelegate: false, isHrAdmin: false },
            midyear: { enabled: true, scoringEnabled: true, windowStart: "2026-06-01", dueDate: "2026-06-30" },
            ratingScale: [],
          },
  }));
  vi.stubGlobal("fetch", fetchMock);
  await act(async () => {
    root.render(createElement(CheckInTab, { appraisalId: "a-1", isManager: true, isHR: false, isEmployee: false, readOnly }));
  });
  await act(async () => {});
  return fetchMock;
}

describe("check-in history after IN_PROGRESS", () => {
  it("read-only: a completed formal Mid-Year and its score are visible; nothing can be started", async () => {
    const fetchMock = await renderTab([formal("COMPLETE")], true, {
      midyear: score(72.4, "C", "Good"),
      final: score(81.6, "B", "Very good"),
      change: 9.2,
      official: "FINAL",
    });
    expect(container.querySelector("[data-checkins-readonly]")).not.toBeNull();
    expect(container.textContent).toContain("Mid-Year Review – 2026");
    expect(container.textContent).not.toContain("New check-in");
    expect(q('[data-score-value="midyear"]')).toBe("72.4");
    expect(q("[data-score-change]")).toBe("+9.2");
    expect(fetchMock).toHaveBeenCalledWith("/api/appraisals/a-1/score-snapshots");
  });

  it("read-only: a review left open is listed as history, not as an editable card", async () => {
    await renderTab([formal("OPEN")], true);
    expect(container.textContent).toContain("Mid-Year Review – 2026");
    expect(container.querySelector("[data-midyear-readonly]")).toBeNull();
    expect(container.querySelector("textarea, input")).toBeNull();
    expect(container.textContent).not.toContain("Complete Mid-Year Review");
  });

  it("IN_PROGRESS behaviour is unchanged: the manager can start a check-in", async () => {
    await renderTab([], false);
    expect(container.textContent).toContain("New check-in");
    expect(container.querySelector("[data-checkins-readonly]")).toBeNull();
  });
});

describe("appraisal tabs", () => {
  const source = readFileSync(join(__dirname, "..", "..", "components", "appraisal", "AppraisalTabs.tsx"), "utf8");

  it("after IN_PROGRESS the Check-ins tab is listed only when a formal review exists, read-only", () => {
    const tabsBlock = source.slice(source.indexOf("const tabs: Tab[] = isInProgress"), source.indexOf("const renderContent"));
    expect(tabsBlock).toMatch(/\{ id: "workplan", label: "Workplan" \},\s*\{ id: "checkins", label: checkInsLabel \},\s*\]/);
    expect(tabsBlock).toMatch(/\.\.\.\(hasFormalMidyearHistory \? \[\{ id: "checkins" as const, label: checkInsLabel \}\] : \[\]\)/);
    expect(source).toMatch(/readOnly=\{readOnly \|\| !isInProgress\}/);
    expect(source).toMatch(/!isInProgress && !hasFormalMidyearHistory && activeTab === "checkins"/);
  });

  it("the Summary tab shows the stored Mid-Year / Final scores", () => {
    const summaryCase = source.slice(source.indexOf('case "summary":'), source.indexOf('case "signoffs":'));
    expect(summaryCase).toMatch(/<ScoreSnapshotsPanel appraisalId=\{appraisal\.id\}/);
  });
});
