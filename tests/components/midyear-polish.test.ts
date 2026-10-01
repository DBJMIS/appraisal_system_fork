// @vitest-environment jsdom
// Jamaica (UTC-5, no DST): a date-only value parsed as UTC midnight falls on the previous local day.
process.env.TZ = "America/Jamaica";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ActiveCheckInCard } from "@/components/appraisal/checkins/ActiveCheckInCard";
import { HistoryCheckInCard } from "@/components/appraisal/checkins/HistoryCheckInCard";
import { MidyearReviewBanner } from "@/components/appraisal/checkins/MidyearReviewBanner";
import { MidyearBlockers } from "@/components/appraisal/checkins/MidyearAssessmentFields";
import { MIDYEAR_BUTTON } from "@/components/appraisal/checkins/MidyearReviewWorkspace";
import { ScoreSnapshotsView } from "@/components/appraisal/ScoreSnapshotsPanel";
import {
  dedupeFiscalYearPrefix,
  formatCheckInDate,
  formatCheckInDateTime,
  formatCycleLabel,
  formatMidyearDate,
  type MidyearConfig,
} from "@/lib/midyear-config";
import type { CheckInWithResponses } from "@/types/checkins";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) }));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const $ = (sel: string, scope: ParentNode = document) => scope.querySelector<HTMLElement>(sel);
const text = (sel: string, scope: ParentNode = document) => $(sel, scope)?.textContent ?? null;

const wp = { id: "wi-1", major_task: "Deliver reports", corporate_objective: "", division_objective: "", key_output: "Reports", performance_standard: "", metric_target: 10, metric_type: "NUMBER", metric_deadline: null, weight: 100 };
const wpDate = { ...wp, id: "wi-2", major_task: "Launch portal", metric_type: "DATE", metric_target: null, metric_deadline: "2026-09-30" };

function review(overrides: Partial<CheckInWithResponses> = {}): CheckInWithResponses {
  return {
    id: "ci-1",
    appraisal_id: "a-1",
    title: "Mid-Year Review – FY 2026/27",
    check_in_type: "MIDYEAR",
    review_mode: "FORMAL_SCORED",
    is_management_track: false,
    initiated_by: null,
    due_date: "2026-09-30",
    status: "OPEN",
    employee_submitted_at: null,
    manager_reviewed_at: null,
    manager_overall_notes: null,
    note_to_employee: null,
    created_at: "2026-09-01T14:00:00Z",
    updated_at: "2026-09-01T14:00:00Z",
    responses: [
      {
        id: "r-1",
        check_in_id: "ci-1",
        workplan_item_id: "wi-1",
        employee_status: "ON_TRACK",
        progress_pct: 80,
        employee_comment: "Going well",
        employee_updated_at: null,
        mgr_status_override: null,
        mgr_comment: "Agreed",
        mgr_acknowledged_at: null,
        employee_actual_raw: 8,
        employee_result: 80,
        mgr_actual_raw: 7,
        mgr_result: 70,
        weight_snapshot: 60,
        workplan_item: wp,
      },
      {
        id: "r-2",
        check_in_id: "ci-1",
        workplan_item_id: "wi-2",
        employee_status: "COMPLETE",
        progress_pct: 100,
        employee_comment: null,
        employee_updated_at: null,
        mgr_status_override: null,
        mgr_comment: null,
        mgr_acknowledged_at: null,
        employee_completion_date: "2026-09-30",
        employee_result: 100,
        weight_snapshot: 40,
        workplan_item: wpDate,
      },
    ],
    competency_ratings: [
      { id: "cr-core", check_in_id: "ci-1", section: "CORE", factor_id: "f-1", technical_competency_id: null, name_snapshot: "Integrity", weight_snapshot: 100, display_order: 0, employee_rating_code: "7", manager_rating_code: "8", employee_comment: null, manager_comment: null },
    ],
    midyear_completeness: { required: true, weights: [], employee: [], manager: [], complete: true },
    ...overrides,
  };
}

const renderActive = (ci: CheckInWithResponses) =>
  act(async () =>
    root.render(
      createElement(ActiveCheckInCard, {
        appraisalId: "a-1",
        checkIn: ci,
        appraisal: { employeeName: "Jane Brown", employee_id: "emp-1", manager_employee_id: "mgr-1", status: "IN_PROGRESS" },
        currentUser: { employee_id: "emp-1", roles: [] },
        role: "EMPLOYEE",
        onUpdate: vi.fn(),
        ratingScale: [{ code: "7", label: "Meets expectations well" }],
      })
    )
  );

describe("date-only values are calendar dates", () => {
  it("the test runs in a time zone behind UTC", () => {
    expect(new Date("2026-09-30").getDate()).toBe(29);
  });

  it("formats YYYY-MM-DD without shifting the day", () => {
    expect(formatMidyearDate("2026-09-30")).toBe("30 Sep 2026");
    expect(formatMidyearDate("2027-01-01")).toBe("1 Jan 2027");
    expect(formatCheckInDate("2026-09-30")).toBe("30 Sep 2026");
  });

  it("keeps other values unchanged and formats timestamps in local time", () => {
    expect(formatMidyearDate(null)).toBeNull();
    expect(formatMidyearDate("2026-02-30")).toBe("2026-02-30");
    expect(formatMidyearDate("Q3")).toBe("Q3");
    expect(formatCheckInDate("2026-10-12T15:00:00Z")).toBe("12 Oct 2026");
    expect(formatCheckInDate("2026-10-01T02:00:00Z")).toBe("30 Sep 2026");
  });

  it("the Mid-Year header shows the stored due date", async () => {
    await renderActive(review());
    expect(text("[data-midyear-header-due]")).toBe("Due 30 Sep 2026");
  });

  it("the banner shows the configured window and due date", async () => {
    const midyear: MidyearConfig = { enabled: true, scoringEnabled: true, windowStart: "2026-09-01", dueDate: "2026-09-30" };
    await act(async () => root.render(createElement(MidyearReviewBanner, { midyear, fiscalYear: "FY 2026/27", checkIns: [] })));
    expect(text("[data-midyear-banner-due]")).toBe("30 Sep 2026");
    expect(text("[data-midyear-banner-window]")).toBe("1 Sep 2026 – 30 Sep 2026");
  });

  it("the read-only completion date and date target are not shifted", async () => {
    await act(async () => root.render(createElement(HistoryCheckInCard, { checkIn: review({ status: "COMPLETE" }) })));
    await act(async () => $(".cursor-pointer")!.click());
    const row = $('[data-midyear-workplan-row="wi-2"]')!;
    expect(text("[data-midyear-target]", row)).toBe("30 Sep 2026");
    expect(text('[data-midyear-party="employee"] [data-midyear-summary]', row)).toBe("Completed: 30 Sep 2026 · Result: 100%");
  });
});

describe("fiscal-year label appears once", () => {
  it("collapses a repeated FY prefix", () => {
    expect(dedupeFiscalYearPrefix("FY FY 2026/27")).toBe("FY 2026/27");
    expect(dedupeFiscalYearPrefix("Mid-Year Review – FY FY 2026/27")).toBe("Mid-Year Review – FY 2026/27");
    expect(dedupeFiscalYearPrefix("Mid-Year Review – FY 2026/27")).toBe("Mid-Year Review – FY 2026/27");
    expect(dedupeFiscalYearPrefix("FY 2026")).toBe("FY 2026");
  });

  it("cycle labels drop repeated prefixes and repeated segments", () => {
    expect(formatCycleLabel("Annual Appraisal · FY FY 2026/27")).toBe("Annual Appraisal · FY 2026/27");
    expect(formatCycleLabel("FY 2026/27 · FY FY 2026/27")).toBe("FY 2026/27");
    expect(formatCycleLabel("Annual Appraisal · FY 2026")).toBe("Annual Appraisal · FY 2026");
    expect(formatCycleLabel(null)).toBe("");
  });

  it("the Mid-Year header shows FY once", async () => {
    await renderActive(review({ title: "Mid-Year Review – FY FY 2026/27" }));
    expect(text("[data-midyear-header] h3")).toBe("Mid-Year Review – FY 2026/27");
  });

  it("the banner shows FY once whether or not the stored value has the prefix", async () => {
    const midyear: MidyearConfig = { enabled: true, scoringEnabled: false, windowStart: null, dueDate: null };
    await act(async () => root.render(createElement(MidyearReviewBanner, { midyear, fiscalYear: "FY 2026/27", checkIns: [] })));
    expect(text("[data-midyear-banner-title]")).toBe("Mid-Year Review · FY 2026/27");
    await act(async () => root.render(createElement(MidyearReviewBanner, { midyear, fiscalYear: "2026/27", checkIns: [] })));
    expect(text("[data-midyear-banner-title]")).toBe("Mid-Year Review · FY 2026/27");
  });

  it("the history card title shows FY once", async () => {
    await act(async () => root.render(createElement(HistoryCheckInCard, { checkIn: review({ status: "COMPLETE", title: "Mid-Year Review – FY FY 2026/27" }) })));
    expect(document.body.textContent).toContain("Mid-Year Review – FY 2026/27");
    expect(document.body.textContent).not.toContain("FY FY");
  });
});

describe("completed Mid-Year Review", () => {
  it("shows mode, Complete status and both parties' inputs read-only", async () => {
    await act(async () =>
      root.render(
        createElement(HistoryCheckInCard, {
          checkIn: review({ status: "COMPLETE", manager_reviewed_at: "2026-10-20T15:00:00Z", updated_at: "2026-10-22T15:00:00Z" }),
          ratingScale: [{ code: "7", label: "Meets expectations well" }, { code: "8", label: "Exceeds expectations" }],
        })
      )
    );
    await act(async () => $(".cursor-pointer")!.click());
    const history = $("[data-midyear-history]")!;
    expect(text("[data-midyear-history-meta]", history)).toBe("Formal · Scored·Status: Complete");
    expect(history.querySelectorAll("input, select, textarea, [data-midyear-segmented]")).toHaveLength(0);
    const row = $('[data-midyear-workplan-row="wi-1"]', history)!;
    expect(text('[data-midyear-party="employee"] [data-midyear-summary]', row)).toBe("Actual: 8 · Result: 80%");
    expect(text('[data-midyear-party="manager"] [data-midyear-summary]', row)).toBe("Actual: 7 · Result: 70%");
    expect(text("[data-midyear-employee-rating]", history)).toContain("7 · Meets expectations well");
    expect(text("[data-midyear-manager-rating]", history)).toContain("8 · Exceeds expectations");
    expect(text("[data-midyear-times]", history)).toBe("Manager review submitted: 20 Oct 2026, 10:00 AM·Completed: 22 Oct 2026, 10:00 AM");
  });

  it("the stored Mid-Year score shows with its grade", async () => {
    await act(async () =>
      root.render(
        createElement(ScoreSnapshotsView, {
          comparison: { midyear: { total: 72.5, grade: "B", gradeLabel: "Good" }, final: null, change: null, official: null },
        })
      )
    );
    expect(text('[data-score-cell="midyear"]')).toContain("Mid-Year Score");
    expect(text('[data-score-grade="midyear"]')).toBe("B · Good");
  });
});

describe("manager review timestamps", () => {
  const T = {
    employee: "2026-10-12T15:00:00Z",
    submitted: "2026-10-20T15:00:00Z",
    revised: "2026-10-21T19:30:00Z",
    completed: "2026-10-22T15:00:00Z",
    reopened: "2026-11-02T15:00:00Z",
    draft: "2026-11-03T15:00:00Z",
    resubmitted: "2026-11-04T15:00:00Z",
    recompleted: "2026-11-05T15:00:00Z",
  };
  /** A review whose response and competency rows were last saved at `rowsAt`. */
  const stamped = (rowsAt: string, overrides: Partial<CheckInWithResponses>) => {
    const base = review({ employee_submitted_at: T.employee, ...overrides });
    return {
      ...base,
      responses: base.responses.map((r) => ({ ...r, updated_at: rowsAt })),
      competency_ratings: base.competency_ratings!.map((c) => ({ ...c, updated_at: rowsAt })),
    };
  };
  const revision = (completedAt: string | null) => ({
    revision_number: 2,
    reopened_at: T.reopened,
    reopened_by: "u-hr",
    reopened_by_name: "Helen HR",
    reopen_reason: "Correction",
    previous_score_revision: 1,
    completed_at: completedAt,
    completed_by: completedAt ? "u-mgr" : null,
    score_revision: completedAt ? 2 : null,
  });
  const times = () =>
    Object.fromEntries([...document.querySelectorAll<HTMLElement>("[data-midyear-time]")].map((e) => [e.dataset.midyearTime, e.textContent]));
  const renderHistory = async (ci: CheckInWithResponses) => {
    await act(async () => root.render(createElement(HistoryCheckInCard, { checkIn: ci })));
    await act(async () => $(".cursor-pointer")!.click());
  };

  it("formats date and time in the viewer's local time", () => {
    expect(formatCheckInDateTime(T.revised)).toBe("21 Oct 2026, 2:30 PM");
    expect(formatCheckInDateTime("2026-10-21T05:00:00Z")).toBe("21 Oct 2026, 12:00 AM");
    expect(formatCheckInDateTime("2026-10-21T17:05:00Z")).toBe("21 Oct 2026, 12:05 PM");
    expect(formatCheckInDateTime("2026-09-30")).toBe("30 Sep 2026");
    expect(formatCheckInDateTime(null)).toBeNull();
  });

  it("shows nothing before the manager first submits", async () => {
    await renderActive(stamped(T.revised, { status: "EMPLOYEE_SUBMITTED", updated_at: T.revised }));
    expect($("[data-midyear-times]")).toBeNull();
  });

  it("initial manager submission only: no Last revised", async () => {
    await renderActive(stamped(T.submitted, { status: "MANAGER_REVIEWED", manager_reviewed_at: T.submitted, updated_at: T.submitted }));
    expect(times()).toEqual({ submitted: "Manager review submitted: 20 Oct 2026, 10:00 AM" });
  });

  it("the employee's earlier saves never count as manager revisions", async () => {
    await renderActive(stamped(T.employee, { status: "MANAGER_REVIEWED", manager_reviewed_at: T.submitted, updated_at: T.submitted }));
    expect(times()).toEqual({ submitted: "Manager review submitted: 20 Oct 2026, 10:00 AM" });
  });

  it("manager edits after submission add Last revised and keep the submission time", async () => {
    await renderActive(stamped(T.revised, { status: "MANAGER_REVIEWED", manager_reviewed_at: T.submitted, updated_at: T.revised }));
    expect(times()).toEqual({
      submitted: "Manager review submitted: 20 Oct 2026, 10:00 AM",
      revised: "Last revised: 21 Oct 2026, 2:30 PM",
    });
    await renderActive(stamped(T.submitted, { status: "MANAGER_REVIEWED", manager_reviewed_at: T.submitted, updated_at: T.revised }));
    expect(times().revised).toBe("Last revised: 21 Oct 2026, 2:30 PM");
  });

  it("a completed review shows submission, last revision and completion", async () => {
    await renderHistory(stamped(T.revised, { status: "COMPLETE", manager_reviewed_at: T.submitted, updated_at: T.completed }));
    expect(times()).toEqual({
      submitted: "Manager review submitted: 20 Oct 2026, 10:00 AM",
      revised: "Last revised: 21 Oct 2026, 2:30 PM",
      completed: "Completed: 22 Oct 2026, 10:00 AM",
    });
    expect(document.body.textContent).toContain("Completed 22 Oct 2026");
  });

  it("a completed review without later edits omits Last revised", async () => {
    await renderHistory(stamped(T.submitted, { status: "COMPLETE", manager_reviewed_at: T.submitted, updated_at: T.completed }));
    expect(times()).toEqual({
      submitted: "Manager review submitted: 20 Oct 2026, 10:00 AM",
      completed: "Completed: 22 Oct 2026, 10:00 AM",
    });
  });

  it("a reopened review keeps the original submission and shows the latest revision activity", async () => {
    const reopened = { status: "EMPLOYEE_SUBMITTED" as const, manager_reviewed_at: T.submitted, updated_at: T.reopened, midyear_revisions: [revision(null)] };
    await renderActive(stamped(T.revised, reopened));
    expect(times()).toEqual({
      submitted: "Manager review submitted: 20 Oct 2026, 10:00 AM",
      revised: "Last revised: 21 Oct 2026, 2:30 PM",
    });
    await renderActive(stamped(T.draft, { ...reopened, updated_at: T.draft }));
    expect(times().revised).toBe("Last revised: 3 Nov 2026, 10:00 AM");

    await renderActive(
      stamped(T.resubmitted, {
        status: "MANAGER_REVIEWED",
        manager_reviewed_at: T.resubmitted,
        original_manager_reviewed_at: T.submitted,
        updated_at: T.resubmitted,
        midyear_revisions: [revision(null)],
      })
    );
    expect(times()).toEqual({
      submitted: "Manager review submitted: 20 Oct 2026, 10:00 AM",
      revised: "Last revised: 4 Nov 2026, 10:00 AM",
    });
  });

  it("a revised completion is labelled as such, with the original submission kept", async () => {
    await renderHistory(
      stamped(T.resubmitted, {
        status: "COMPLETE",
        manager_reviewed_at: T.resubmitted,
        original_manager_reviewed_at: T.submitted,
        updated_at: T.recompleted,
        midyear_revisions: [revision(T.recompleted)],
      })
    );
    expect(times()).toEqual({
      submitted: "Manager review submitted: 20 Oct 2026, 10:00 AM",
      revised: "Last revised: 4 Nov 2026, 10:00 AM",
      completed: "Revised review completed: 5 Nov 2026, 10:00 AM",
    });
    expect(document.body.textContent).toContain("Completed 5 Nov 2026");
  });

  it("does not present a resubmission as the original when the history is unavailable", async () => {
    await renderActive(
      stamped(T.resubmitted, { status: "MANAGER_REVIEWED", manager_reviewed_at: T.resubmitted, updated_at: T.resubmitted, midyear_revisions: [revision(null)] })
    );
    expect(times()).toEqual({ revised: "Last revised: 4 Nov 2026, 10:00 AM" });
  });
});

describe("action bar and requirements presentation", () => {
  it("the requirement list is compact: no nested scroll area, text unchanged", async () => {
    const blockers = ["Workplan: 2 objective(s) missing an employee Mid-Year result.", "Core competencies: 3 employee rating(s) missing."];
    await act(async () => root.render(createElement(MidyearBlockers, { title: "Required before you can submit", blockers })));
    expect(text("[data-midyear-blocker-count]")).toBe("2 requirements remaining");
    const list = $("[data-midyear-blockers] ul")!;
    expect(list.className).not.toMatch(/overflow|max-h/);
    expect([...document.querySelectorAll("[data-midyear-blocker]")].map((li) => li.textContent)).toEqual(blockers);
  });

  it("the disabled submit style is bordered and neutral; enabled actions show a focus ring", () => {
    expect(MIDYEAR_BUTTON.disabled).toContain("border-ds-border");
    expect(MIDYEAR_BUTTON.disabled).toContain("cursor-not-allowed");
    for (const variant of ["primary", "secondary", "danger", "quiet"] as const) {
      expect(MIDYEAR_BUTTON[variant]).toContain("focus-visible:ring-2");
    }
  });

  it("tracking segments keep a pressed state and a visible focus ring", async () => {
    await renderActive(review());
    const segments = [...document.querySelectorAll<HTMLButtonElement>("[data-midyear-segmented] button")];
    expect(segments.length).toBeGreaterThan(0);
    expect(segments.every((b) => b.className.includes("focus-visible:ring-2"))).toBe(true);
    expect(segments.some((b) => b.getAttribute("aria-pressed") === "true")).toBe(true);
  });
});
