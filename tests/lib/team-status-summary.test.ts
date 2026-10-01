import { describe, expect, it } from "vitest";
import {
  formatTeamSummary,
  summarizeTeamStatuses,
  teamStatusBucket,
} from "@/lib/team-status-summary";

describe("teamStatusBucket", () => {
  it.each([
    ["DRAFT", "draft"],
    ["PENDING_APPROVAL", "pending"],
    ["SUBMITTED", "pending"],
    ["MANAGER_REVIEW", "pending"],
    ["HOD_REVIEW", "pending"],
    ["PENDING_SIGNOFF", "pending"],
    ["HR_REVIEW", "pending"],
    ["IN_PROGRESS", "in_progress"],
    ["SELF_ASSESSMENT", "in_progress"],
    ["COMPLETE", "complete"],
    ["complete", "complete"],
  ])("maps %s to %s", (status, bucket) => {
    expect(teamStatusBucket(status)).toBe(bucket);
  });

  it("returns null for unknown statuses", () => {
    expect(teamStatusBucket("SOMETHING_ELSE")).toBeNull();
    expect(teamStatusBucket(null)).toBeNull();
  });
});

describe("summarizeTeamStatuses", () => {
  it("returns null when the employee has no direct reports", () => {
    expect(summarizeTeamStatuses(0, [])).toBeNull();
    expect(summarizeTeamStatuses(0, ["DRAFT"])).toBeNull();
  });

  it("summarises a manager's team in the requested format", () => {
    const summary = summarizeTeamStatuses(3, ["DRAFT", "IN_PROGRESS", "DRAFT"])!;
    expect(summary.appraisalCount).toBe(3);
    expect(formatTeamSummary(summary)).toBe("Team: 3 appraisals · 2 Draft · 1 In Progress");
  });

  it("orders mixed statuses Draft, Pending, In Progress, Complete with approved tones", () => {
    const summary = summarizeTeamStatuses(6, [
      "COMPLETE",
      "SELF_ASSESSMENT",
      "MANAGER_REVIEW",
      "DRAFT",
      "PENDING_APPROVAL",
      "IN_PROGRESS",
    ])!;
    expect(summary.buckets.map((b) => [b.label, b.count, b.tone])).toEqual([
      ["Draft", 1, "neutral"],
      ["Pending", 2, "warning"],
      ["In Progress", 2, "progress"],
      ["Complete", 1, "success"],
    ]);
    expect(formatTeamSummary(summary)).toBe(
      "Team: 6 appraisals · 1 Draft · 2 Pending · 2 In Progress · 1 Complete"
    );
  });

  it("falls back to the direct report count when no appraisals are visible", () => {
    const summary = summarizeTeamStatuses(2, [])!;
    expect(summary.buckets).toEqual([]);
    expect(formatTeamSummary(summary)).toBe("Team: 2 direct reports");
    expect(formatTeamSummary(summarizeTeamStatuses(1, [])!)).toBe("Team: 1 direct report");
  });

  it("contains aggregate counts only", () => {
    const summary = summarizeTeamStatuses(2, ["DRAFT", "COMPLETE"])!;
    expect(Object.keys(summary).sort()).toEqual(["appraisalCount", "buckets", "directReportCount"]);
    for (const b of summary.buckets) {
      expect(Object.keys(b).sort()).toEqual(["count", "key", "label", "tone"]);
    }
  });
});