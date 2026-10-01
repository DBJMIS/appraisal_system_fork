import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = join(__dirname, "..", "..");
const SCAN_DIRS = ["app", "lib", "components"];
const MIGRATION = join(ROOT, "supabase", "migrations", "0070_appraisal_score_snapshots.sql");

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
const find = (path: string) => files.find((f) => f.path === path)!;

describe("score snapshot guards", () => {
  it("the legacy score-engine is imported only by its existing calculate-score route", () => {
    const importers = files.filter((f) => /from ["']@\/lib\/score-engine["']/.test(f.text)).map((f) => f.path);
    expect(importers).toEqual(["app/api/appraisals/[id]/calculate-score/route.ts"]);
  });

  it.each([
    "lib/appraisal-score-snapshot.ts",
    "lib/appraisal-pdf.ts",
    "lib/pdf/fetch-appraisal-pdf-data.ts",
    "app/api/appraisals/[id]/signoff/submit/route.ts",
  ])("%s does not use the legacy engine or its table", (path) => {
    const text = find(path).text;
    expect(text).not.toMatch(/score-engine|calculateAppraisalScore|appraisal_section_scores/);
  });

  it("appraisal_score_snapshots is referenced only by the snapshot helper; everything else goes through its functions", () => {
    const users = files.filter((f) => f.text.includes("appraisal_score_snapshots")).map((f) => f.path);
    expect(users).toEqual(["lib/appraisal-score-snapshot.ts"]);
  });

  it("snapshot reads are limited to the named presentation and reporting readers", () => {
    const readersOf = (fn: string) =>
      files
        .filter((f) => f.path !== "lib/appraisal-score-snapshot.ts" && new RegExp(`\\b${fn}\\(`).test(f.text))
        .map((f) => f.path)
        .sort();
    expect(readersOf("loadScoreSnapshotSummaries")).toEqual([
      "app/api/appraisals/[id]/score-snapshots/route.ts",
      "lib/midyear-final-review-context.ts",
    ]);
    expect(readersOf("listScoreSnapshotsByType")).toEqual(["lib/midyear-report-data.ts", "lib/official-scores.ts"]);
    expect(readersOf("findScoreSnapshot")).toEqual(["lib/midyear-score.ts"]);
    expect(readersOf("listMidyearScoreRevisions")).toEqual(["app/api/appraisals/[id]/score-snapshots/route.ts"]);
  });

  it("official reporting reads only FINAL snapshots", () => {
    const text = find("lib/official-scores.ts").text;
    expect(text.match(/listScoreSnapshotsByType\([^)]*\)/g)).toEqual(['listScoreSnapshotsByType(supabase, "FINAL", ids)']);
    expect(text).not.toMatch(/MIDYEAR"/);
  });

  it("Mid-Year reporting reads MIDYEAR and FINAL separately, once each", () => {
    const calls = find("lib/midyear-report-data.ts").text.match(/listScoreSnapshotsByType\([^)]*\)/g);
    expect(calls).toEqual(['listScoreSnapshotsByType(supabase, "MIDYEAR", ids)', 'listScoreSnapshotsByType(supabase, "FINAL", ids)']);
  });

  it.each([
    "lib/hr-analytics-data.ts",
    "lib/hr-trends-data.ts",
    "lib/dashboard-hr-stats.ts",
    "lib/dashboard-manager-stats.ts",
  ])("%s takes official scores from the FINAL-first resolver, not the legacy table", (path) => {
    const text = find(path).text;
    expect(text).toMatch(/loadOfficialScoreTotals\(supabase, /);
    expect(text).not.toMatch(/appraisal_section_scores|appraisal_score_snapshots|MIDYEAR/);
  });

  it("the legacy appraisal_section_scores table keeps its existing readers only (none repurposed silently)", () => {
    const users = files.filter((f) => f.text.includes("appraisal_section_scores")).map((f) => f.path).sort();
    expect(users).toEqual([
      "app/api/appraisals/[id]/calculate-score/route.ts",
      "app/appraisals/[id]/summary/page.tsx",
      "components/appraisal/SummarySection.tsx",
      "lib/dashboard-data.ts",
      "lib/dashboard-employee-strip.ts",
      "lib/history-data.ts",
      "lib/hr-review-data.ts",
      "lib/official-scores.ts",
      "lib/recommendation-engine.ts",
      "lib/score-engine.ts",
    ]);
  });

  it("only sign-off submit (FINAL) and the Mid-Year score recorder (MIDYEAR) persist snapshots; only sign-off uses the score-returning PDF generator", () => {
    const persisters = files
      .filter((f) => f.path !== "lib/appraisal-score-snapshot.ts" && f.text.includes("persistScoreSnapshot"))
      .map((f) => f.path)
      .sort();
    expect(persisters).toEqual(["app/api/appraisals/[id]/signoff/submit/route.ts", "lib/midyear-score.ts"]);
    const pdfWithScore = files
      .filter((f) => f.path !== "lib/appraisal-pdf.ts" && f.text.includes("generateAppraisalPDFWithScore"))
      .map((f) => f.path);
    expect(pdfWithScore).toEqual(["app/api/appraisals/[id]/signoff/submit/route.ts"]);
  });

  it("the snapshot is persisted with score_type FINAL in sign-off submit", () => {
    expect(find("app/api/appraisals/[id]/signoff/submit/route.ts").text).toMatch(/scoreType:\s*"FINAL"/);
  });

  it("the Mid-Year recorder persists only MIDYEAR, from the Mid-Year loader and calcSummary", () => {
    const text = find("lib/midyear-score.ts").text;
    expect(text).toMatch(/scoreType:\s*"MIDYEAR"/);
    expect(text).not.toMatch(/"FINAL"/);
    expect(text).toMatch(/buildMidyearSummaryInput\(/);
    expect(text).toMatch(/calcSummary\(/);
    expect(text).not.toMatch(/buildSummaryInput\(|score-engine/);
  });
});

describe("0070_appraisal_score_snapshots.sql", () => {
  const sql = readFileSync(MIGRATION, "utf8").replace(/--[^\n]*/g, "");

  it("restricts score_type to MIDYEAR and FINAL and enforces one row per appraisal per type", () => {
    expect(sql).toMatch(/CHECK \(score_type IN \('MIDYEAR', 'FINAL'\)\)/);
    expect(sql).toMatch(/UNIQUE \(appraisal_id, score_type\)/);
  });

  it("writes no rows and changes no existing table", () => {
    expect(sql).not.toMatch(/\b(insert\s+into|update\s+\w|delete\s+from|truncate|drop\s+table|alter\s+table\s+(?!public\.appraisal_score_snapshots\b))/i);
  });
});

describe("0075_midyear_review_revisions.sql", () => {
  const sql = readFileSync(join(ROOT, "supabase", "migrations", "0075_midyear_review_revisions.sql"), "utf8").replace(/--[^\n]*/g, "");

  it("keeps FINAL a single, never-superseded revision", () => {
    expect(sql).toMatch(/score_type <> 'FINAL' OR \(revision = 1 AND superseded_at IS NULL\)/);
    expect(sql).toMatch(/UNIQUE \(appraisal_id, score_type, revision\)/);
    expect(sql).toMatch(/ON public\.appraisal_score_snapshots \(appraisal_id, score_type\)\s+WHERE superseded_at IS NULL/);
  });

  it("the reopen function writes only revisions, MIDYEAR snapshots and the check-in status", () => {
    const writes = [...sql.matchAll(/\b(?:update|insert\s+into|delete\s+from)\s+(public\.\w+)/gi)].map((m) => m[1]);
    expect(new Set(writes)).toEqual(new Set(["public.midyear_review_revisions", "public.appraisal_score_snapshots", "public.check_ins"]));
    expect(sql).toMatch(/s\.score_type = 'MIDYEAR'/);
    expect(sql).not.toMatch(/update\s+public\.appraisals\b/i);
  });

  it("the reopen function is callable only by the service role", () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.reopen_midyear_review\(UUID, TEXT, TEXT, TEXT\) FROM anon, authenticated/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.reopen_midyear_review\(UUID, TEXT, TEXT, TEXT\) TO service_role/);
  });
});
