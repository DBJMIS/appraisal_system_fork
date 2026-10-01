import { describe, expect, it } from "vitest";
import {
  calcMidyearCompleteness,
  canInitiateFormal,
  formalActionDenied,
  midyearStageBlockers,
  type MidyearActor,
} from "@/lib/midyear-lifecycle";

const responses = () => [
  { weight_snapshot: 60, employee_result: 80, mgr_result: null },
  { weight_snapshot: 40, employee_result: 100, mgr_result: 90 },
];
const competencies = () => [
  { section: "CORE", weight_snapshot: 100, employee_rating_code: "7", manager_rating_code: "8" },
  { section: "TECHNICAL", weight_snapshot: 100, employee_rating_code: "6", manager_rating_code: "7" },
];

describe("calcMidyearCompleteness", () => {
  it("is complete when weights are present and every required item is scoreable", () => {
    const c = calcMidyearCompleteness({ reviewMode: "FORMAL_SCORED", responses: responses(), competencies: competencies() });
    expect(c).toEqual({ required: true, weights: [], employee: [], manager: [], complete: true });
  });

  it("uses the employee result as the scoreable workplan result when the manager has none", () => {
    const c = calcMidyearCompleteness({ reviewMode: "FORMAL_SCORED", responses: responses(), competencies: competencies() });
    expect(c.manager).toEqual([]);
  });

  it("reports missing employee and manager inputs per section", () => {
    const r = responses();
    r[0].employee_result = null as unknown as number;
    const comp = competencies();
    comp[0].employee_rating_code = null as unknown as string;
    comp[1].manager_rating_code = "" as string;
    const c = calcMidyearCompleteness({ reviewMode: "FORMAL_SCORED", responses: r, competencies: comp });
    expect(c.employee).toEqual([
      "Workplan: 1 objective(s) missing an employee Mid-Year result.",
      "Core competencies: 1 employee rating(s) missing.",
    ]);
    expect(c.manager).toEqual([
      "Workplan: 1 objective(s) missing a scoreable Mid-Year result.",
      "Technical competencies: 1 manager rating(s) missing.",
    ]);
    expect(c.complete).toBe(false);
  });

  it("does not require zero-weight items", () => {
    const r = responses();
    r.push({ weight_snapshot: 0, employee_result: null as unknown as number, mgr_result: null });
    const comp = competencies();
    comp.push({ section: "CORE", weight_snapshot: 0, employee_rating_code: null as unknown as string, manager_rating_code: null as unknown as string });
    const c = calcMidyearCompleteness({ reviewMode: "FORMAL_SCORED", responses: r, competencies: comp });
    expect(c.complete).toBe(true);
  });

  it("requires weights to be present", () => {
    const r = responses();
    r[1].weight_snapshot = null as unknown as number;
    const comp = competencies().map((x) => ({ ...x, weight_snapshot: x.section === "TECHNICAL" ? 0 : x.weight_snapshot }));
    const c = calcMidyearCompleteness({ reviewMode: "FORMAL_SCORED", responses: r, competencies: comp });
    expect(c.weights).toEqual(["Workplan: 1 objective weight(s) missing.", "Technical competencies: weights total 0%."]);
    expect(c.complete).toBe(false);
    expect(calcMidyearCompleteness({ reviewMode: "FORMAL_SCORED", responses: [], competencies: [] }).weights).toEqual([
      "Workplan: no objectives were captured for this Mid-Year Review.",
    ]);
  });

  it("never requires comments", () => {
    const c = calcMidyearCompleteness({
      reviewMode: "FORMAL_SCORED",
      responses: responses().map((r) => ({ ...r, employee_comment: null, mgr_comment: null })),
      competencies: competencies().map((x) => ({ ...x, employee_comment: null, manager_comment: null })),
    });
    expect(c.complete).toBe(true);
  });

  it("is not enforced for unscored formal reviews", () => {
    const c = calcMidyearCompleteness({ reviewMode: "FORMAL", responses: [], competencies: [] });
    expect(c.required).toBe(false);
    expect(c.complete).toBe(true);
    expect(midyearStageBlockers(c, "EMPLOYEE_SUBMIT")).toEqual([]);
    expect(midyearStageBlockers(c, "COMPLETE")).toEqual([]);
  });

  it("with a known track, every scored section needs competencies (leadership only for management)", () => {
    const scored = (isManagementTrack: boolean) =>
      calcMidyearCompleteness({ reviewMode: "FORMAL_SCORED", responses: responses(), competencies: competencies(), isManagementTrack });
    expect(scored(false).weights).toEqual(["Productivity: no competencies were captured for this Mid-Year Review."]);
    expect(scored(true).weights).toEqual([
      "Productivity: no competencies were captured for this Mid-Year Review.",
      "Leadership: no competencies were captured for this Mid-Year Review.",
    ]);
  });

  it("ignores leadership rows off the management track", () => {
    const comp = [
      ...competencies(),
      { section: "PRODUCTIVITY", weight_snapshot: 100, employee_rating_code: "7", manager_rating_code: "7" },
      { section: "LEADERSHIP", weight_snapshot: 100, employee_rating_code: null, manager_rating_code: null },
    ];
    const c = calcMidyearCompleteness({ reviewMode: "FORMAL_SCORED", responses: responses(), competencies: comp, isManagementTrack: false });
    expect(c.complete).toBe(true);
    expect(c.employee).toEqual([]);
  });

  it("stage blockers: employee submit checks employee inputs, manager stages check scoreable inputs", () => {
    const r = responses();
    r[0].employee_result = null as unknown as number;
    const c = calcMidyearCompleteness({ reviewMode: "FORMAL_SCORED", responses: r, competencies: competencies() });
    expect(midyearStageBlockers(c, "EMPLOYEE_SUBMIT")).toEqual(["Workplan: 1 objective(s) missing an employee Mid-Year result."]);
    expect(midyearStageBlockers(c, "MANAGER_REVIEW")).toEqual(["Workplan: 1 objective(s) missing a scoreable Mid-Year result."]);
    expect(midyearStageBlockers(c, "COMPLETE")).toEqual(midyearStageBlockers(c, "MANAGER_REVIEW"));
  });
});

describe("formal role rules", () => {
  const actor = (a: Partial<MidyearActor>): MidyearActor => ({ isEmployee: false, hasManagerAccess: false, isHrAdmin: false, testBypass: false, ...a });
  const employee = actor({ isEmployee: true });
  const manager = actor({ hasManagerAccess: true });
  const hr = actor({ isHrAdmin: true });
  const viewer = actor({});

  it("only the employee enters the employee portion", () => {
    for (const a of ["EMPLOYEE_SAVE_DRAFT", "EMPLOYEE_SUBMIT"] as const) {
      expect(formalActionDenied(a, employee)).toBeNull();
      expect(formalActionDenied(a, manager)).not.toBeNull();
      expect(formalActionDenied(a, hr)).not.toBeNull();
      expect(formalActionDenied(a, viewer)).not.toBeNull();
    }
  });

  it("only the manager or delegate enters the manager portion and completes", () => {
    for (const a of ["MANAGER_RESPOND", "MANAGER_COMPLETE", "COMPLETE"] as const) {
      expect(formalActionDenied(a, manager)).toBeNull();
      expect(formalActionDenied(a, employee)).not.toBeNull();
      expect(formalActionDenied(a, hr)).not.toBeNull();
      expect(formalActionDenied(a, viewer)).not.toBeNull();
    }
  });

  it("manager, delegate or HR can cancel; manager, delegate or HR can initiate", () => {
    expect(formalActionDenied("CANCEL", manager)).toBeNull();
    expect(formalActionDenied("CANCEL", hr)).toBeNull();
    expect(formalActionDenied("CANCEL", employee)).not.toBeNull();
    expect(canInitiateFormal(manager)).toBe(true);
    expect(canInitiateFormal(hr)).toBe(true);
    expect(canInitiateFormal(employee)).toBe(false);
    expect(canInitiateFormal(viewer)).toBe(false);
  });
});
