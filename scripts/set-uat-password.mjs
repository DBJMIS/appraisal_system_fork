/**
 * Set or update a UAT test password for an app_users email.
 *
 * Usage (from project root, with .env present):
 *   node scripts/set-uat-password.mjs leonwull@dbankjm.com "YourPassword"
 *
 * Requires: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Table: uat_login_credentials (migration 0067)
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { scryptSync, randomBytes } from "crypto";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function loadEnvFile() {
  try {
    const raw = readFileSync(resolve(root, ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] == null || process.env[key] === "") {
        process.env[key] = val;
      }
    }
  } catch {
    // .env optional if vars already exported
  }
}

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LEN = 64;

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEY_LEN, SCRYPT_PARAMS).toString("hex");
  return `${salt}:${hash}`;
}

async function main() {
  loadEnvFile();

  const email = process.argv[2];
  const password = process.argv[3];

  if (!email || !password) {
    console.error("Usage: node scripts/set-uat-password.mjs <email> <password>");
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const supabase = createClient(url, key);
  const normalizedEmail = email.trim().toLowerCase();

  const { data: appUser, error: userErr } = await supabase
    .from("app_users")
    .select("id, email, display_name")
    .ilike("email", normalizedEmail)
    .maybeSingle();

  if (userErr || !appUser) {
    console.error(`No app_users row found for: ${normalizedEmail}`);
    console.error(userErr?.message ?? "Create the user in app_users first.");
    process.exit(1);
  }

  const password_hash = hashPassword(password);
  const now = new Date().toISOString();

  const { error: upsertErr } = await supabase.from("uat_login_credentials").upsert(
    {
      app_user_id: appUser.id,
      password_hash,
      is_active: true,
      updated_at: now,
    },
    { onConflict: "app_user_id" }
  );

  if (upsertErr) {
    console.error("Failed to save password:", upsertErr.message);
    console.error("Did you run migration 0067_uat_login_credentials.sql?");
    process.exit(1);
  }

  console.log(`UAT password set for ${appUser.email} (${appUser.display_name ?? "—"})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
