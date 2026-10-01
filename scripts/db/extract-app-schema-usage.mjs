/**
 * Heuristic scan of application code for Supabase usage: tables, columns referenced
 * in select/filter/insert/update calls, RPC functions and storage buckets.
 *
 * Usage: node scripts/db/extract-app-schema-usage.mjs [--json <out.json>]
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const SCAN_DIRS = ["app", "lib", "components", "hooks", "utils", "scripts"];
const SKIP_DIRS = new Set(["node_modules", ".next", "db"]);

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e)) continue;
    const full = join(dir, e);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(e)) out.push(full);
  }
  return out;
}

const STRING = String.raw`(?:"([^"]*)"|'([^']*)'|\x60([^\x60]*)\x60)`;
const FROM_RE = /(?<!storage\s*)\.from\(\s*["'`]([a-zA-Z0-9_]+)["'`]\s*\)/g;
const STORAGE_RE = /storage\s*\.from\(\s*["'`]([a-zA-Z0-9_-]+)["'`]\s*\)/g;
const RPC_RE = /\.rpc\(\s*["'`]([a-zA-Z0-9_]+)["'`]/g;
const SELECT_RE = new RegExp(String.raw`\.select\(\s*` + STRING, "g");
const FILTER_RE = /\.(eq|neq|in|is|gt|gte|lt|lte|like|ilike|not|contains|containedBy|order|filter)\(\s*["'`]([a-zA-Z0-9_]+)["'`]/g;
const ON_CONFLICT_RE = /onConflict:\s*["'`]([a-zA-Z0-9_, ]+)["'`]/g;
const WRITE_RE = /\.(insert|update|upsert)\(\s*(\[?\s*\{)/g;

function selectColumns(text) {
  let depth = 0;
  let token = "";
  const top = [];
  for (const ch of text) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      top.push(token);
      token = "";
      continue;
    }
    token += ch;
  }
  top.push(token);
  return top
    .map((t) => t.trim())
    .filter((t) => t && t !== "*" && !t.includes("(") && !t.startsWith("count"))
    .map((t) => (t.includes(":") ? t.split(":").pop() : t))
    .map((t) => t.split("::")[0].split("->")[0].trim())
    .filter((t) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(t));
}

function objectKeys(src, start) {
  let depth = 0;
  let i = start;
  let body = "";
  for (; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) break;
    }
    if (depth >= 1) body += ch;
  }
  const keys = [];
  let d = 0;
  let segment = "";
  for (const ch of body.slice(1)) {
    if ("{[(".includes(ch)) d++;
    if ("}])".includes(ch)) d--;
    if (ch === "," && d === 0) {
      keys.push(segment);
      segment = "";
      continue;
    }
    segment += ch;
  }
  keys.push(segment);
  return keys
    .map((s) => s.trim())
    .map((s) => {
      const m = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*(:|$)/.exec(s);
      return m ? m[1] : null;
    })
    .filter(Boolean);
}

export function extractUsage() {
  const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));
  const tables = {};
  const rpcs = {};
  const buckets = {};
  const add = (map, key, file) => {
    map[key] ??= new Set();
    map[key].add(file);
  };
  const addColumn = (table, column, file) => {
    tables[table] ??= { files: new Set(), columns: {} };
    tables[table].columns[column] ??= new Set();
    tables[table].columns[column].add(file);
  };

  for (const full of files) {
    const src = readFileSync(full, "utf8");
    const rel = relative(ROOT, full).split(sep).join("/");
    for (const m of src.matchAll(RPC_RE)) add(rpcs, m[1], rel);
    for (const m of src.matchAll(STORAGE_RE)) add(buckets, m[1], rel);
    const froms = [...src.matchAll(FROM_RE)];
    froms.forEach((m, idx) => {
      const table = m[1];
      tables[table] ??= { files: new Set(), columns: {} };
      tables[table].files.add(rel);
      const end = Math.min(froms[idx + 1]?.index ?? src.length, m.index + 2500);
      const chain = src.slice(m.index, end);
      for (const s of chain.matchAll(SELECT_RE)) {
        for (const c of selectColumns(s[1] ?? s[2] ?? s[3] ?? "")) addColumn(table, c, rel);
      }
      for (const f of chain.matchAll(FILTER_RE)) addColumn(table, f[2], rel);
      for (const oc of chain.matchAll(ON_CONFLICT_RE)) {
        for (const c of oc[1].split(",")) addColumn(table, c.trim(), rel);
      }
      for (const w of chain.matchAll(WRITE_RE)) {
        const braceAt = m.index + w.index + w[0].lastIndexOf("{");
        for (const k of objectKeys(src, braceAt)) addColumn(table, k, rel);
      }
    });
  }

  const toPlain = (map) => Object.fromEntries(Object.entries(map).map(([k, v]) => [k, [...v].sort()]));
  return {
    tables: Object.fromEntries(
      Object.entries(tables)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([t, v]) => [t, { files: [...v.files].sort(), columns: toPlain(v.columns) }])
    ),
    rpcs: toPlain(rpcs),
    buckets: toPlain(buckets),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const usage = extractUsage();
  const i = process.argv.indexOf("--json");
  if (i > 0) {
    const out = resolve(process.argv[i + 1]);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(usage, null, 2));
    console.log(`Usage written to ${out}`);
  }
  console.log(`tables: ${Object.keys(usage.tables).length}, rpcs: ${Object.keys(usage.rpcs).length}, buckets: ${Object.keys(usage.buckets).length}`);
  console.log("rpcs:", Object.keys(usage.rpcs).join(", "));
  console.log("buckets:", Object.keys(usage.buckets).join(", "));
}
