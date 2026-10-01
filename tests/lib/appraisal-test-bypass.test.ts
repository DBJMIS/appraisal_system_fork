import { describe, it, expect, afterEach, vi } from "vitest";
import { allowAppraisalTestBypass, allowAppraisalTestBypassClient } from "@/lib/appraisal-test-bypass";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("allowAppraisalTestBypass", () => {
  it.each([
    ["production", "true", false],
    ["test", "true", false],
    ["development", "false", false],
    ["development", "", false],
    ["development", "true", true],
  ])("NODE_ENV=%s flag=%s -> %s", (nodeEnv, flag, expected) => {
    vi.stubEnv("NODE_ENV", nodeEnv);
    vi.stubEnv("ALLOW_APPRAISAL_TEST_BYPASS", flag);
    expect(allowAppraisalTestBypass()).toBe(expected);
  });
});

describe("allowAppraisalTestBypassClient", () => {
  it.each([
    ["production", "true", false],
    ["development", "false", false],
    ["development", "true", true],
  ])("NODE_ENV=%s flag=%s -> %s", (nodeEnv, flag, expected) => {
    vi.stubEnv("NODE_ENV", nodeEnv);
    vi.stubEnv("NEXT_PUBLIC_ALLOW_APPRAISAL_TEST_BYPASS", flag);
    expect(allowAppraisalTestBypassClient()).toBe(expected);
  });
});
