import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const COMPONENTS = [
  "components/appraisal/CoreCompetenciesSection.tsx",
  "components/appraisal/ProductivitySection.tsx",
  "components/appraisal/LeadershipSection.tsx",
  "components/appraisal/TechnicalCompetenciesSection.tsx",
];
const REFERENCE_TABLES = ["evaluation_categories", "evaluation_factors", "rating_scale"];

describe("competency sections read reference data through the server", () => {
  it.each(COMPONENTS)("%s does not use the browser Supabase client", (file) => {
    const src = readFileSync(join(ROOT, file), "utf8");
    expect(src).not.toMatch(/from\s+["']@\/lib\/supabase["']/);
    expect(src).not.toMatch(/\bcreateClient\s*\(/);
  });

  it.each(COMPONENTS)("%s does not query reference tables directly", (file) => {
    const src = readFileSync(join(ROOT, file), "utf8");
    for (const table of REFERENCE_TABLES) {
      expect(src).not.toMatch(new RegExp(String.raw`\.from\(\s*["'\x60]${table}["'\x60]`));
    }
  });

  it.each(COMPONENTS)("%s loads factor-ratings data from the API", (file) => {
    const src = readFileSync(join(ROOT, file), "utf8");
    expect(src).toContain("/factor-ratings`");
  });
});

describe("HR admin panel reads and writes reference data through the server", () => {
  const ADMIN_FILES = [
    "components/admin/admin-panel.tsx",
    "components/admin/tabs/CompetenciesTab.tsx",
    "components/admin/tabs/RatingScaleTab.tsx",
    "components/admin/tabs/RecommendationRulesTab.tsx",
  ];
  const ADMIN_TABLES = ["evaluation_categories", "evaluation_factors", "rating_scale", "recommendation_rules"];

  it.each(ADMIN_FILES)("%s does not use the browser Supabase client", (file) => {
    const src = readFileSync(join(ROOT, file), "utf8");
    expect(src).not.toMatch(/from\s+["']@\/lib\/supabase["']/);
    expect(src).not.toMatch(/\bcreateClient\s*\(/);
  });

  it.each(ADMIN_FILES)("%s does not query or mutate the four reference tables directly", (file) => {
    const src = readFileSync(join(ROOT, file), "utf8");
    for (const table of ADMIN_TABLES) {
      expect(src).not.toMatch(new RegExp(String.raw`\.from\(\s*["'\x60]${table}["'\x60]`));
    }
  });

  it("admin-panel.tsx loads reference data from the HR/admin API", () => {
    const src = readFileSync(join(ROOT, "components/admin/admin-panel.tsx"), "utf8");
    expect(src).toContain('"/api/admin/reference-data"');
  });

  it("the server module never ships the service-role key to a client bundle", () => {
    const src = readFileSync(join(ROOT, "lib/admin-reference-data.ts"), "utf8");
    expect(src).not.toMatch(/^["']use client["']/m);
    expect(src).not.toContain("NEXT_PUBLIC_SUPABASE_SERVICE");
  });
});
