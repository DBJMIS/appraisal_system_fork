import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    })
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

for (const table of ["appraisal_cycles", "cycle_review_types", "feedback_cycle"]) {
  const { data, error, count } = await sb.from(table).select("*", { count: "exact" }).limit(1);
  console.log(table, error ? `ERROR ${error.message}` : { rows: count, columns: data?.[0] ? Object.keys(data[0]) : "(no rows)" });
}
const { data: cycles } = await sb.from("appraisal_cycles").select("status");
const byStatus = {};
for (const c of cycles ?? []) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
console.log("cycles by status", byStatus);
const { data: ci } = await sb.from("check_ins").select("check_in_type, status");
const byType = {};
for (const c of ci ?? []) byType[`${c.check_in_type}/${c.status}`] = (byType[`${c.check_in_type}/${c.status}`] ?? 0) + 1;
console.log("check_ins by type/status", byType);
