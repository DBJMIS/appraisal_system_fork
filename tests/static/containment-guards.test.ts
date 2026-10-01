import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = join(__dirname, "..", "..");
const SCAN_DIRS = ["app", "lib", "components"];
const BYPASS_HELPER = join("lib", "appraisal-test-bypass.ts");

function sourceFiles(): { path: string; text: string }[] {
  const files: { path: string; text: string }[] = [];
  for (const dir of SCAN_DIRS) {
    const entries = readdirSync(join(ROOT, dir), { recursive: true }) as string[];
    for (const entry of entries) {
      if (!/\.(ts|tsx)$/.test(entry)) continue;
      const full = join(ROOT, dir, entry);
      files.push({ path: relative(ROOT, full).split(sep).join("/"), text: readFileSync(full, "utf8") });
    }
  }
  return files;
}

const files = sourceFiles();

describe("containment regression guards", () => {
  it("has no debug ingest calls to the local agent logger", () => {
    const offenders = files.filter((f) => f.text.includes("127.0.0.1:7442")).map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("reads the appraisal test-bypass flag only through the canonical helper", () => {
    const helper = BYPASS_HELPER.split(sep).join("/");
    const offenders = files
      .filter((f) => f.path !== helper)
      .filter((f) => /process\.env\.(NEXT_PUBLIC_)?ALLOW_APPRAISAL_TEST_BYPASS/.test(f.text))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("does not log the full Adobe webhook payload or participant email", () => {
    const v2 = files.find((f) => f.path === "app/api/webhooks/adobe-sign-v2/route.ts");
    expect(v2).toBeDefined();
    expect(v2!.text).not.toMatch(/Full payload/);
    expect(v2!.text).not.toMatch(/console\.log\([^)]*participantUserEmail/);
  });

  it("does not log the delegation request body", () => {
    const delegation = files.find((f) => f.path === "app/api/appraisals/[id]/delegation/route.ts");
    expect(delegation).toBeDefined();
    expect(delegation!.text).not.toMatch(/console\.log\([^)]*raw body/);
  });
});
