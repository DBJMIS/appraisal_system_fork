import { describe, expect, it } from "vitest";
import { listMigrations, SUPABASE_MIGRATION_PATTERN } from "@/scripts/db/replay-migrations.mjs";
import { DESTRUCTIVE_ALLOWLIST, KNOWN_DUPLICATE_VERSIONS } from "@/scripts/db/baseline-register.mjs";

const migrations = listMigrations();

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}

const DESTRUCTIVE_PATTERNS: Record<string, RegExp> = {
  truncate: /\btruncate\b/i,
  "drop table": /\bdrop\s+table\b/i,
  "delete from": /\bdelete\s+from\b/i,
  "drop column": /\bdrop\s+column\b/i,
};

describe("migration filenames", () => {
  it("every file parses to a Supabase version", () => {
    const unparseable = migrations.filter((m) => !SUPABASE_MIGRATION_PATTERN.test(m.file)).map((m) => m.file);
    expect(unparseable).toEqual([]);
  });

  it("no Supabase version is shared by more than one file, apart from registered duplicates", () => {
    const byVersion = new Map<string, string[]>();
    for (const m of migrations) {
      const version = m.version ?? m.file;
      byVersion.set(version, [...(byVersion.get(version) ?? []), m.file]);
    }
    const duplicates = Object.fromEntries([...byVersion.entries()].filter(([, files]) => files.length > 1));
    expect(duplicates).toEqual(KNOWN_DUPLICATE_VERSIONS);
  });
});

describe("destructive statements in active migrations", () => {
  const found: Record<string, string[]> = {};
  for (const m of migrations) {
    const sql = stripComments(m.sql);
    const kinds = Object.entries(DESTRUCTIVE_PATTERNS)
      .filter(([, re]) => re.test(sql))
      .map(([kind]) => kind);
    if (kinds.length) found[m.file] = kinds.sort();
  }

  it("only registered files contain data-destroying statements", () => {
    const expected = Object.fromEntries(
      Object.entries(DESTRUCTIVE_ALLOWLIST).map(([file, kinds]) => [file, Object.keys(kinds).sort()])
    );
    expect(found).toEqual(expected);
  });

  it("TRUNCATE appears only in the registered reset migration", () => {
    const truncating = Object.entries(found)
      .filter(([, kinds]) => kinds.includes("truncate"))
      .map(([file]) => file);
    expect(truncating).toEqual(
      Object.entries(DESTRUCTIVE_ALLOWLIST)
        .filter(([, kinds]) => "truncate" in kinds)
        .map(([file]) => file)
    );
  });
});
