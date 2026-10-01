/**
 * Collects schema-only metadata from the Supabase project configured in .env:
 *   - PostgREST OpenAPI description (tables, views, columns, types, RPC signatures)
 *   - Storage bucket configuration
 *   - Anonymous exposure probe: HEAD requests with the anon key and count=exact,
 *     which return a row count header and no row data.
 * Never selects, writes or prints row contents or keys.
 *
 * Usage: node scripts/db/fetch-live-schema-metadata.mjs --json <out.json>
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");

function loadEnv() {
  const env = { ...process.env };
  const file = join(ROOT, ".env");
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (!m || env[m[1]]) continue;
      env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return env;
}

function parseDescription(desc = "") {
  const pk = desc.includes("<pk/>");
  const fk = /<fk table='([^']+)' column='([^']+)'\/>/.exec(desc);
  return { pk, fk: fk ? `${fk[1]}.${fk[2]}` : null };
}

async function main() {
  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const service = env.SUPABASE_SERVICE_ROLE_KEY;
  const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !service) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  const serviceHeaders = { apikey: service, Authorization: `Bearer ${service}` };

  const specRes = await fetch(`${url}/rest/v1/`, { headers: { ...serviceHeaders, Accept: "application/openapi+json" } });
  if (!specRes.ok) throw new Error(`OpenAPI request failed: ${specRes.status}`);
  const spec = await specRes.json();

  const relations = {};
  for (const [name, def] of Object.entries(spec.definitions ?? {})) {
    const columns = {};
    for (const [col, p] of Object.entries(def.properties ?? {})) {
      columns[col] = {
        type: p.type ?? null,
        format: p.format ?? null,
        default: p.default ?? null,
        enum: p.enum ?? null,
        required: (def.required ?? []).includes(col),
        ...parseDescription(p.description),
      };
    }
    relations[name] = { columns };
  }

  const rpcs = {};
  for (const [path, ops] of Object.entries(spec.paths ?? {})) {
    if (!path.startsWith("/rpc/")) continue;
    const op = ops.post ?? ops.get;
    const bodyParam = (op?.parameters ?? []).find((p) => p.in === "body");
    const props = bodyParam?.schema?.properties ?? {};
    rpcs[path.slice(5)] = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, v.format ?? v.type ?? null]));
  }

  let buckets = null;
  const bucketRes = await fetch(`${url}/storage/v1/bucket`, { headers: serviceHeaders });
  if (bucketRes.ok) {
    buckets = (await bucketRes.json()).map((b) => ({
      id: b.id,
      public: b.public,
      file_size_limit: b.file_size_limit ?? null,
      allowed_mime_types: b.allowed_mime_types ?? null,
    }));
  }

  const anonExposure = {};
  if (anon) {
    for (const table of Object.keys(relations)) {
      const res = await fetch(`${url}/rest/v1/${encodeURIComponent(table)}?select=*`, {
        method: "HEAD",
        headers: { apikey: anon, Authorization: `Bearer ${anon}`, Prefer: "count=exact" },
      });
      const range = res.headers.get("content-range");
      const count = range && range.includes("/") ? range.split("/")[1] : null;
      anonExposure[table] = { status: res.status, visibleRows: count === "*" ? null : count != null ? Number(count) : null };
    }
  }

  const out = {
    project: new URL(url).hostname.split(".")[0],
    collectedAt: new Date().toISOString(),
    postgrestVersion: spec.info?.version ?? null,
    relations,
    rpcs,
    buckets,
    anonExposure,
  };
  const i = process.argv.indexOf("--json");
  const target = resolve(i > 0 ? process.argv[i + 1] : join(ROOT, ".tmp", "live-schema.json"));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(out, null, 2));
  console.log(`project ${out.project}: ${Object.keys(relations).length} relations, ${Object.keys(rpcs).length} rpcs, ${buckets?.length ?? "?"} buckets`);
  console.log(`written to ${target}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
