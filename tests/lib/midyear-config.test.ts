import { describe, expect, it } from "vitest";
import {
  MIDYEAR_DISABLED,
  midyearConfigFromRow,
  midyearReviewTitle,
  parseMidyearFields,
  resolveCheckInReviewMode,
  resolveMidyearChange,
} from "@/lib/midyear-config";

describe("Mid-Year configuration defaults", () => {
  it("a cycle without Mid-Year settings is off", () => {
    expect(midyearConfigFromRow(null)).toEqual(MIDYEAR_DISABLED);
    expect(midyearConfigFromRow({})).toEqual(MIDYEAR_DISABLED);
    expect(MIDYEAR_DISABLED).toEqual({ enabled: false, scoringEnabled: false, windowStart: null, dueDate: null });
  });

  it("never reports scoring on while the review is off", () => {
    expect(midyearConfigFromRow({ midyear_review_enabled: false, midyear_scoring_enabled: true }).scoringEnabled).toBe(false);
  });

  it("maps stored settings", () => {
    expect(
      midyearConfigFromRow({
        midyear_review_enabled: true,
        midyear_scoring_enabled: true,
        midyear_window_start: "2026-06-01",
        midyear_due_date: "2026-06-30",
      })
    ).toEqual({ enabled: true, scoringEnabled: true, windowStart: "2026-06-01", dueDate: "2026-06-30" });
  });
});

describe("parseMidyearFields", () => {
  it("picks only the fields present", () => {
    expect(parseMidyearFields({ midyear_review_enabled: true, other: 1 })).toEqual({
      fields: { midyear_review_enabled: true },
      error: null,
    });
  });

  it("treats empty dates as null", () => {
    expect(parseMidyearFields({ midyear_window_start: "", midyear_due_date: null }).fields).toEqual({
      midyear_window_start: null,
      midyear_due_date: null,
    });
  });

  it.each([
    [{ midyear_review_enabled: "yes" }, /must be true or false/],
    [{ midyear_due_date: "30/06/2026" }, /must be a date/],
    [{ midyear_window_start: "2026-02-30" }, /must be a date/],
  ])("rejects %j", (body, message) => {
    expect(parseMidyearFields(body).error).toMatch(message);
  });
});

describe("resolveMidyearChange", () => {
  it("rejects scoring while the review is off", () => {
    expect(resolveMidyearChange(null, { midyear_scoring_enabled: true }).error).toMatch(/scoring cannot be enabled/);
    expect(
      resolveMidyearChange({ midyear_review_enabled: false }, { midyear_scoring_enabled: true }).error
    ).toMatch(/scoring cannot be enabled/);
  });

  it("turning the review off also turns scoring off", () => {
    const r = resolveMidyearChange({ midyear_review_enabled: true, midyear_scoring_enabled: true }, { midyear_review_enabled: false });
    expect(r.error).toBeNull();
    expect(r.update).toEqual({ midyear_review_enabled: false, midyear_scoring_enabled: false });
  });

  it("rejects a due date before the window start, including against stored values", () => {
    expect(
      resolveMidyearChange(null, { midyear_review_enabled: true, midyear_window_start: "2026-07-01", midyear_due_date: "2026-06-30" }).error
    ).toMatch(/cannot be before/);
    expect(
      resolveMidyearChange({ midyear_review_enabled: true, midyear_window_start: "2026-07-01" }, { midyear_due_date: "2026-06-01" }).error
    ).toMatch(/cannot be before/);
  });

  it("partial change keeps untouched stored values", () => {
    const r = resolveMidyearChange(
      { midyear_review_enabled: true, midyear_scoring_enabled: true, midyear_window_start: "2026-06-01", midyear_due_date: "2026-06-30" },
      { midyear_due_date: "2026-07-15" }
    );
    expect(r.error).toBeNull();
    expect(r.update).toEqual({ midyear_due_date: "2026-07-15" });
    expect(r.merged).toEqual({
      midyear_review_enabled: true,
      midyear_scoring_enabled: true,
      midyear_window_start: "2026-06-01",
      midyear_due_date: "2026-07-15",
    });
  });
});

describe("resolveCheckInReviewMode", () => {
  const off = MIDYEAR_DISABLED;
  const on = { ...MIDYEAR_DISABLED, enabled: true };
  const scored = { ...on, scoringEnabled: true };

  it.each([
    ["MIDYEAR", off, "INFORMAL"],
    ["MIDYEAR", on, "FORMAL"],
    ["MIDYEAR", scored, "FORMAL_SCORED"],
    ["QUARTERLY", scored, "INFORMAL"],
    ["ADHOC", scored, "INFORMAL"],
    ["QUARTERLY", on, "INFORMAL"],
  ] as const)("%s with %j → %s", (type, config, expected) => {
    expect(resolveCheckInReviewMode(type, config)).toBe(expected);
  });
});

describe("midyearReviewTitle", () => {
  it("uses the cycle fiscal year", () => {
    expect(midyearReviewTitle("2026")).toBe("Mid-Year Review – 2026");
    expect(midyearReviewTitle(null)).toBe("Mid-Year Review");
  });
});
