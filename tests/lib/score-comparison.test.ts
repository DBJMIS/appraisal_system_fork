import { describe, expect, it } from "vitest";
import { compareScores, formatScore, formatScoreChange, type StoredScore } from "@/lib/score-comparison";

const score = (total: number, grade = "C", gradeLabel = "Good"): StoredScore => ({ total, grade, gradeLabel });

describe("compareScores", () => {
  it("MIDYEAR only: no final, no change, nothing official yet", () => {
    const c = compareScores(score(72.4), null);
    expect(c).toEqual({ midyear: score(72.4), final: null, change: null, official: null });
  });

  it("FINAL only: final is official, no change", () => {
    const c = compareScores(null, score(81.6, "B", "Very good"));
    expect(c).toEqual({ midyear: null, final: score(81.6, "B", "Very good"), change: null, official: "FINAL" });
  });

  it("both: change is Final − Mid-Year", () => {
    const c = compareScores(score(72.4), score(81.6));
    expect(c.change).toBe(9.2);
    expect(formatScoreChange(c.change!)).toBe("+9.2");
    expect(c.official).toBe("FINAL");
  });

  it.each([
    [72.4, 81.6, 9.2, "+9.2"],
    [81.6, 72.4, -9.2, "-9.2"],
    [70, 70, 0, "0.0"],
    [60.01, 60.04, 0, "0.0"],
    [60.04, 60.06, 0.1, "+0.1"],
    [72.45, 81.64, 9.1, "+9.1"],
    [0, 100, 100, "+100.0"],
  ])("Mid-Year %s → Final %s changes by %s", (mid, fin, change, label) => {
    const c = compareScores(score(mid), score(fin));
    expect(c.change).toBe(change);
    expect(formatScoreChange(c.change!)).toBe(label);
  });

  it("the change always matches the one-decimal scores shown", () => {
    for (let i = 0; i < 500; i++) {
      const mid = Math.round(((i * 7919) % 10000)) / 100;
      const fin = Math.round(((i * 104729) % 10000)) / 100;
      const c = compareScores(score(mid), score(fin));
      expect(c.change).toBeCloseTo(Number(formatScore(fin)) - Number(formatScore(mid)), 10);
    }
  });

  it("never averages: the stored scores pass through unchanged and no combined value exists", () => {
    const mid = score(60, "D", "Fair");
    const fin = score(90, "A", "Excellent");
    const c = compareScores(mid, fin);
    expect(Object.keys(c).sort()).toEqual(["change", "final", "midyear", "official"]);
    expect(c.final).toEqual(fin);
    expect(c.midyear).toEqual(mid);
    expect(Object.values(c)).not.toContain(75);
    expect(JSON.stringify(c)).not.toMatch(/75/);
  });
});
