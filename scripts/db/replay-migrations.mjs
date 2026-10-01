/**
 * Scratch replay of supabase/migrations against an in-memory Postgres (PGlite).
 * Never connects to a real database.
 *
 * Usage:
 *   node scripts/db/replay-migrations.mjs [--exclude <file>]... [--stop-on-error] [--json <out.json>]
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(HERE, "..", "..");
export const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");
const SHIM_PATH = join(HERE, "supabase-shim.sql");

/** Same pattern the Supabase CLI uses to derive a migration version from its filename. */
export const SUPABASE_MIGRATION_PATTERN = /^([0-9]+)_(.*)\.sql$/;

export function listMigrations(dir = MIGRATIONS_DIR) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => {
      const m = SUPABASE_MIGRATION_PATTERN.exec(file);
      return {
        file,
        version: m ? m[1] : null,
        name: m ? m[2] : null,
        sql: readFileSync(join(dir, file), "utf8"),
      };
    });
}

export async function createScratchDb() {
  const db = new PGlite({ extensions: { pgcrypto, uuid_ossp } });
  await db.exec(readFileSync(SHIM_PATH, "utf8"));
  return db;
}

function describeError(err) {
  return {
    message: err?.message ?? String(err),
    code: err?.code ?? null,
    detail: err?.detail ?? null,
    position: err?.position ?? null,
  };
}

/**
 * Applies each migration in its own transaction, in filename order.
 * With stopOnError=false, a failed file is rolled back and replay continues so
 * downstream effects of the failure are visible.
 * `transform(file, sql)` rewrites a file's SQL in memory only; files on disk are never changed.
 *
 * @param {{ exclude?: string[], stopOnError?: boolean, db?: PGlite, transform?: (file: string, sql: string) => string }} [options]
 */
export async function replayMigrations({ exclude = [], stopOnError = false, db, transform } = {}) {
  const scratch = db ?? (await createScratchDb());
  const results = [];
  for (const m of listMigrations()) {
    if (exclude.includes(m.file)) {
      results.push({ file: m.file, version: m.version, status: "excluded" });
      continue;
    }
    try {
      await scratch.exec("BEGIN");
      await scratch.exec(transform ? transform(m.file, m.sql) : m.sql);
      await scratch.exec("COMMIT");
      results.push({ file: m.file, version: m.version, status: "applied" });
    } catch (err) {
      await scratch.exec("ROLLBACK").catch(() => {});
      results.push({ file: m.file, version: m.version, status: "failed", error: describeError(err) });
      if (stopOnError) break;
    }
  }
  return { db: scratch, results };
}

/** @param {PGlite} db */
export async function introspect(db) {
  /** @type {(sql: string) => Promise<Record<string, any>[]>} */
  const q = async (sql) => (await db.query(sql)).rows;
  return {
    tables: await q(`
      select c.relname as table_name, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r','p')
      order by 1`),
    views: await q(`
      select c.relname as view_name, coalesce(array_to_string(c.reloptions, ','), '') as options
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'v'
      order by 1`),
    columns: await q(`
      select table_name, column_name, data_type, udt_name, is_nullable, column_default, ordinal_position
      from information_schema.columns
      where table_schema = 'public'
      order by table_name, ordinal_position`),
    constraints: await q(`
      select rel.relname as table_name, con.conname as name, con.contype as type,
             pg_get_constraintdef(con.oid) as definition
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace n on n.oid = rel.relnamespace
      where n.nspname = 'public'
      order by 1, 2`),
    indexes: await q(`
      select tablename as table_name, indexname as name, indexdef as definition
      from pg_indexes where schemaname = 'public'
      order by 1, 2`),
    functions: await q(`
      select p.proname as name, pg_get_function_identity_arguments(p.oid) as args,
             pg_get_function_result(p.oid) as returns, l.lanname as language,
             p.prosecdef as security_definer
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      join pg_language l on l.oid = p.prolang
      where n.nspname = 'public'
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      order by 1, 2`),
    triggers: await q(`
      select c.relname as table_name, t.tgname as name, p.proname as function_name
      from pg_trigger t
      join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      join pg_proc p on p.oid = t.tgfoid
      where n.nspname = 'public' and not t.tgisinternal
      order by 1, 2`),
    policies: await q(`
      select schemaname as schema, tablename as table_name, policyname as name, cmd, roles::text as roles,
             permissive, qual, with_check
      from pg_policies
      where schemaname in ('public', 'storage')
      order by 1, 2, 3`),
    enums: await q(`
      select t.typname as name, array_agg(e.enumlabel order by e.enumsortorder)::text as labels
      from pg_type t join pg_enum e on e.enumtypid = t.oid
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public'
      group by 1 order by 1`),
    buckets: await q(`
      select id, public, file_size_limit, allowed_mime_types::text as allowed_mime_types
      from storage.buckets order by id`),
    tableGrants: await q(`
      select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privileges
      from information_schema.role_table_grants
      where table_schema = 'public' and grantee in ('anon','authenticated','service_role')
      group by 1, 2 order by 1, 2`),
  };
}

function parseArgs(argv) {
  const opts = { exclude: [], stopOnError: false, json: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--exclude") opts.exclude.push(argv[++i]);
    else if (a === "--stop-on-error") opts.stopOnError = true;
    else if (a === "--json") opts.json = argv[++i];
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { db, results } = await replayMigrations(opts);
  const failed = results.filter((r) => r.status === "failed");
  for (const r of results) {
    const tag = r.status === "applied" ? "ok  " : r.status === "excluded" ? "skip" : "FAIL";
    console.log(`${tag} ${r.file}${r.error ? `  ->  ${r.error.message}` : ""}`);
  }
  const versions = new Map();
  for (const m of listMigrations()) {
    versions.set(m.version, [...(versions.get(m.version) ?? []), m.file]);
  }
  const dupes = [...versions.entries()].filter(([, files]) => files.length > 1);
  console.log(`\n${results.length} files, ${failed.length} failed, ${results.filter((r) => r.status === "excluded").length} excluded`);
  if (dupes.length) console.log(`Duplicate Supabase versions: ${dupes.map(([v, f]) => `${v} (${f.join(", ")})`).join("; ")}`);
  if (opts.json) {
    const schema = await introspect(db);
    mkdirSync(dirname(resolve(opts.json)), { recursive: true });
    writeFileSync(resolve(opts.json), JSON.stringify({ results, schema }, null, 2));
    console.log(`Schema snapshot written to ${opts.json}`);
  }
  await db.close();
  process.exitCode = failed.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 2;
  });
}
