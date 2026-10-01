// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { TeamAppraisalRowGroup, type TeamAppraisalRow } from "@/components/appraisal/TeamAppraisalRows";
import { summarizeTeamStatuses } from "@/lib/team-status-summary";

const mocks = vi.hoisted(() => ({
  list: { myAppraisals: [] as unknown[], reportsAppraisals: [] as unknown[] },
}));
vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(async () => ({ id: "u1", email: null, name: "Viewer", roles: ["manager"], employee_id: "sys-viewer" })),
}));
vi.mock("@/lib/appraisals-list-data", () => ({ getAppraisalsListForUser: vi.fn(async () => mocks.list) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const leaf = (id: string, name: string, status: string): TeamAppraisalRow => ({
  appraisalId: id,
  employeeName: name,
  cycleName: "FY 2026/27",
  reviewType: "ANNUAL",
  status,
  access: "oversight",
});

/** Senior Manager's view: Morgan (manager) -> Brown + Lee; Lee (manager) -> Patel. */
function morganRow(): TeamAppraisalRow {
  const lee: TeamAppraisalRow = {
    ...leaf("ap-lee", "Lee, Jordan", "DRAFT"),
    team: [leaf("ap-patel", "Patel, Sam", "MANAGER_REVIEW")],
    teamSummary: summarizeTeamStatuses(1, ["MANAGER_REVIEW"]),
  };
  return {
    appraisalId: "ap-morgan",
    employeeName: "Morgan, Alex",
    cycleName: "FY 2026/27",
    reviewType: "ANNUAL",
    status: "IN_PROGRESS",
    access: "direct",
    team: [leaf("ap-brown", "Brown, Alicia", "IN_PROGRESS"), lee],
    teamSummary: summarizeTeamStatuses(2, ["IN_PROGRESS", "DRAFT"]),
  };
}

let container: HTMLDivElement;
let root: Root;

async function renderRows(rows: TeamAppraisalRow[]) {
  await act(async () => {
    root.render(
      createElement(
        "table",
        null,
        createElement(
          "tbody",
          null,
          rows.map((row, idx) => createElement(TeamAppraisalRowGroup, { key: row.appraisalId, row, first: idx === 0 }))
        )
      )
    );
  });
}

const bodyRows = () => [...container.querySelectorAll<HTMLTableRowElement>("tbody > tr")];
const rowFor = (name: string) => bodyRows().find((r) => r.textContent?.includes(name))!;
const toggleIn = (row: Element) => row.querySelector<HTMLButtonElement>("[data-team-toggle]");
const action = (row: Element) => row.querySelector<HTMLAnchorElement>("td:last-child a")!;
const cells = (row: Element) => [...row.querySelectorAll("td")].map((td) => td.textContent?.trim());
const statusOf = (row: Element) => cells(row)[3]?.toLowerCase();

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("team appraisal rows", () => {
  it("shows a collapsed expand control on a manager row that has team appraisals", async () => {
    await renderRows([morganRow()]);
    const toggle = toggleIn(rowFor("Morgan, Alex"))!;
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-label")).toBe("Show Morgan, Alex's team appraisals");
    expect(bodyRows()).toHaveLength(1);
  });

  it("shows no expand control for an employee without a team", async () => {
    await renderRows([{ ...leaf("ap-casey", "Casey Contributor", "DRAFT"), access: "direct" }]);
    expect(toggleIn(rowFor("Casey Contributor"))).toBeNull();
  });

  it("shows no expand control, but the empty note, when the team has no appraisals this cycle", async () => {
    await renderRows([{ ...leaf("ap-x", "Quinn, Ray", "DRAFT"), access: "direct", teamSummary: summarizeTeamStatuses(3, []) }]);
    const row = rowFor("Quinn, Ray");
    expect(toggleIn(row)).toBeNull();
    expect(row.querySelector("[data-team-empty]")!.textContent).toBe("No team appraisals for this cycle");
  });

  it("shows the grouped status summary on the parent row", async () => {
    await renderRows([morganRow()]);
    expect(rowFor("Morgan, Alex").querySelector("[data-team-summary]")!.textContent).toBe(
      "Team: 2 appraisals·1 Draft·1 In Progress"
    );
  });

  it("expanding shows that manager's team immediately underneath, indented and view-only", async () => {
    await renderRows([morganRow(), { ...leaf("ap-casey", "Casey Contributor", "DRAFT"), access: "direct" }]);
    await act(async () => toggleIn(rowFor("Morgan, Alex"))!.click());

    expect(toggleIn(rowFor("Morgan, Alex"))!.getAttribute("aria-expanded")).toBe("true");
    const rows = bodyRows();
    expect(rows.map((r) => r.querySelector("td")!.textContent)).toEqual([
      expect.stringContaining("Morgan, Alex"),
      expect.stringContaining("Brown, Alicia"),
      expect.stringContaining("Lee, Jordan"),
      expect.stringContaining("Casey Contributor"),
    ]);

    const brown = rowFor("Brown, Alicia");
    expect(brown.getAttribute("data-depth")).toBe("1");
    expect(brown.getAttribute("data-access")).toBe("oversight");
    expect(brown.className).toContain("bg-ds-background");
    expect(brown.querySelector("td")!.textContent).toContain("↳");
    expect(cells(brown).slice(1, 3)).toEqual(["FY 2026/27", "Annual"]);
    expect(statusOf(brown)).toBe("in progress");
    expect(cells(brown)[4]).toMatch(/^View/);
  });

  it("uses View for indirect reports and keeps Open for direct reports", async () => {
    await renderRows([morganRow()]);
    await act(async () => toggleIn(rowFor("Morgan, Alex"))!.click());

    const open = action(rowFor("Morgan, Alex"));
    expect(open.textContent!.trim()).toBe("Open");
    expect(open.getAttribute("href")).toBe("/appraisals/ap-morgan");
    expect(open.hasAttribute("data-view-only")).toBe(false);

    const view = action(rowFor("Brown, Alicia"));
    expect(view.textContent).toMatch(/^View/);
    expect(view.getAttribute("href")).toBe("/appraisals/ap-brown");
    expect(view.hasAttribute("data-view-only")).toBe(true);
    expect(view.title).toBe("View only");
  });

  it("nests further levels with the correct status, each collapsed until expanded", async () => {
    await renderRows([morganRow()]);
    await act(async () => toggleIn(rowFor("Morgan, Alex"))!.click());

    const lee = rowFor("Lee, Jordan");
    expect(lee.querySelector("[data-team-summary]")!.textContent).toBe("Team: 1 appraisal·1 Pending");
    expect(toggleIn(lee)!.getAttribute("aria-expanded")).toBe("false");
    expect(bodyRows().some((r) => r.textContent?.includes("Patel, Sam"))).toBe(false);

    await act(async () => toggleIn(lee)!.click());
    const patel = rowFor("Patel, Sam");
    expect(patel.getAttribute("data-depth")).toBe("2");
    expect(statusOf(patel)).toBe("manager review");
    expect(action(patel).textContent).toMatch(/^View/);
    expect(bodyRows().indexOf(patel)).toBe(bodyRows().indexOf(lee) + 1);
  });

  it("collapsing hides the team again", async () => {
    await renderRows([morganRow()]);
    const toggle = () => toggleIn(rowFor("Morgan, Alex"))!;
    await act(async () => toggle().click());
    expect(bodyRows()).toHaveLength(3);
    await act(async () => toggle().click());
    expect(bodyRows()).toHaveLength(1);
    expect(toggle().getAttribute("aria-label")).toBe("Show Morgan, Alex's team appraisals");
  });
});

describe("My Appraisals page with team hierarchy", () => {
  const row = (appraisalId: string, employeeName: string, extra: Record<string, unknown> = {}) => ({
    appraisalId,
    employeeId: `sys-${appraisalId}`,
    employeeName,
    cycleId: "cy-1",
    cycleName: "FY 2026",
    reviewType: "ANNUAL",
    status: "IN_PROGRESS",
    departmentName: "Ops",
    ...extra,
  });

  it("renders team rows collapsed by default and leaves My Appraisals rows unchanged", async () => {
    const morgan = morganRow();
    mocks.list = {
      myAppraisals: [row("mine-1", "Viewer")],
      reportsAppraisals: [row("ap-morgan", "Morgan, Alex", { access: "direct", team: morgan.team, teamSummary: morgan.teamSummary })],
    };
    const { default: AppraisalsPage } = await import("@/app/appraisals/page");
    const el = document.createElement("div");
    el.innerHTML = renderToStaticMarkup(await AppraisalsPage());

    const [mine, team] = [...el.querySelectorAll("table")];
    expect(mine.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(mine.querySelector("[data-team-toggle]")).toBeNull();
    expect(mine.querySelector("tbody a")!.textContent!.trim()).toBe("Open");

    const teamRows = team.querySelectorAll("tbody tr");
    expect(teamRows).toHaveLength(1);
    expect(teamRows[0].querySelector("[data-team-toggle]")!.getAttribute("aria-expanded")).toBe("false");
    expect(team.textContent).not.toContain("Brown, Alicia");
    expect(team.querySelectorAll("thead th")).toHaveLength(5);
  });
});
