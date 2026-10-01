// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TeamStatusSummary } from "@/components/appraisal/TeamStatusSummary";
import { summarizeTeamStatuses } from "@/lib/team-status-summary";

const mocks = vi.hoisted(() => ({
  user: null as unknown,
  list: { myAppraisals: [] as unknown[], reportsAppraisals: [] as unknown[] },
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn(async () => mocks.user) }));
vi.mock("@/lib/appraisals-list-data", () => ({ getAppraisalsListForUser: vi.fn(async () => mocks.list) }));

function mount(html: string) {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
}

const render = (summary: ReturnType<typeof summarizeTeamStatuses>) =>
  mount(renderToStaticMarkup(createElement(TeamStatusSummary, { summary })));

describe("TeamStatusSummary", () => {
  it("renders a compact secondary line for a manager with direct reports", () => {
    const el = render(summarizeTeamStatuses(3, ["DRAFT", "DRAFT", "IN_PROGRESS"]));
    const line = el.querySelector("[data-team-summary]")!;
    expect(line.textContent).toBe("Team: 3 appraisals·2 Draft·1 In Progress");
    expect(line.className).toContain("text-[11px]");
    expect(line.className).toContain("text-ds-text-secondary");
    expect(el.querySelector('[data-team-bucket="draft"] > span')!.className).toContain("bg-ds-text-muted");
    expect(el.querySelector('[data-team-bucket="in_progress"] > span')!.className).toContain("bg-ds-lavender");
  });

  it("renders nothing for an employee with no direct reports", () => {
    expect(renderToStaticMarkup(createElement(TeamStatusSummary, { summary: summarizeTeamStatuses(0, []) }))).toBe("");
    expect(renderToStaticMarkup(createElement(TeamStatusSummary, { summary: undefined }))).toBe("");
  });

  it("uses the approved accent for each status group", () => {
    const el = render(summarizeTeamStatuses(4, ["DRAFT", "PENDING_APPROVAL", "SELF_ASSESSMENT", "COMPLETE"]));
    const dot = (key: string) => el.querySelector(`[data-team-bucket="${key}"] > span`)!.className;
    expect(dot("draft")).toContain("bg-ds-text-muted");
    expect(dot("pending")).toContain("bg-ds-amber");
    expect(dot("in_progress")).toContain("bg-ds-lavender");
    expect(dot("complete")).toContain("bg-ds-mint");
    expect([...el.querySelectorAll("[data-team-bucket]")].map((n) => n.getAttribute("data-team-bucket"))).toEqual([
      "draft",
      "pending",
      "in_progress",
      "complete",
    ]);
  });

  it("shows the headcount and a concise empty note when the team has no appraisals in this cycle", () => {
    const el = render(summarizeTeamStatuses(3, []));
    expect(el.querySelector("[data-team-summary]")!.textContent).toBe("Team: 3 direct reports·No team appraisals for this cycle");
    expect(el.querySelectorAll("[data-team-bucket]")).toHaveLength(0);
  });

  it("is not a link, since no manager drill-down view exists", () => {
    const el = render(summarizeTeamStatuses(2, ["DRAFT", "COMPLETE"]));
    expect(el.querySelector("[data-team-summary] a")).toBeNull();
    expect(el.querySelector("[data-team-summary]")!.closest("a")).toBeNull();
  });
});

describe("My Appraisals page", () => {
  beforeEach(() => {
    mocks.user = { id: "u1", email: null, name: "Viewer", roles: ["manager"], employee_id: "sys-viewer" };
  });

  const row = (appraisalId: string, employeeName: string, teamSummary?: unknown) => ({
    appraisalId,
    employeeId: `sys-${appraisalId}`,
    employeeName,
    cycleId: "cy-1",
    cycleName: "FY 2026",
    reviewType: "ANNUAL",
    status: "IN_PROGRESS",
    departmentName: "Ops",
    ...(teamSummary ? { teamSummary } : {}),
  });

  it("shows the summary only under team members who manage people", async () => {
    mocks.list = {
      myAppraisals: [row("mine-1", "Viewer", summarizeTeamStatuses(2, ["DRAFT"]))],
      reportsAppraisals: [
        row("a", "Alex Manager", summarizeTeamStatuses(3, ["DRAFT", "DRAFT", "IN_PROGRESS"])),
        row("c", "Casey Contributor"),
      ],
    };
    const { default: AppraisalsPage } = await import("@/app/appraisals/page");
    const el = mount(renderToStaticMarkup(await AppraisalsPage()));

    const tables = el.querySelectorAll("table");
    expect(tables).toHaveLength(2);
    expect(tables[0].querySelector("[data-team-summary]")).toBeNull();

    const teamRows = [...tables[1].querySelectorAll("tbody tr")];
    expect(teamRows[0].querySelector("[data-team-summary]")!.textContent).toBe(
      "Team: 3 appraisals·2 Draft·1 In Progress"
    );
    expect(teamRows[1].querySelector("[data-team-summary]")).toBeNull();
    expect(tables[1].querySelectorAll("thead th")).toHaveLength(5);
  });
});
