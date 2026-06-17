import { scryptSync, randomBytes, timingSafeEqual } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { UAT_CREDENTIALS_PROVIDER_ID } from "@/lib/uat-credentials-constants";

export { UAT_CREDENTIALS_PROVIDER_ID };

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const KEY_LEN = 64;

/** Server-side: register the Credentials provider and verify passwords. */
export function isUatCredentialsEnabled(): boolean {
  return process.env.ENABLE_UAT_CREDENTIALS === "true";
}

/** Client-side: show the UAT login form on /login. */
export function isUatCredentialsLoginVisible(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_UAT_CREDENTIALS === "true";
}

export function hashUatPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEY_LEN, SCRYPT_PARAMS).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyUatPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  try {
    const expected = Buffer.from(hash, "hex");
    const derived = scryptSync(password, salt, KEY_LEN, SCRYPT_PARAMS);
    return expected.length === derived.length && timingSafeEqual(expected, derived);
  } catch {
    return false;
  }
}

function getSupabaseService(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function resolveRolesFromAppUser(row: {
  role?: string | null;
  roles?: unknown;
}): string[] {
  const dbRoles = Array.isArray(row.roles)
    ? row.roles.map((r) => String(r))
    : [];
  if (dbRoles.length > 0) return dbRoles;
  const fallback = typeof row.role === "string" ? row.role : null;
  if (fallback && fallback !== "individual") return [fallback];
  return [];
}

export type UatAuthorizedUser = {
  id: string;
  email: string;
  name: string | null;
  employee_id: string | null;
  division_id: string | null;
  roles: string[];
  authSource: "uat";
};

export async function verifyUatLogin(
  email: string,
  password: string
): Promise<UatAuthorizedUser | null> {
  if (!isUatCredentialsEnabled()) return null;

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !password) return null;

  const supabase = getSupabaseService();
  if (!supabase) return null;

  const { data: appUser, error: userErr } = await supabase
    .from("app_users")
    .select("id, email, display_name, role, roles, employee_id, division_id, is_active")
    .ilike("email", normalizedEmail)
    .maybeSingle();

  if (userErr || !appUser || appUser.is_active === false) return null;

  const { data: creds, error: credErr } = await supabase
    .from("uat_login_credentials")
    .select("password_hash, is_active")
    .eq("app_user_id", appUser.id)
    .maybeSingle();

  if (credErr || !creds || creds.is_active === false) return null;
  if (!verifyUatPassword(password, creds.password_hash)) return null;

  return {
    id: appUser.id,
    email: appUser.email ?? normalizedEmail,
    name: appUser.display_name ?? appUser.email ?? null,
    employee_id: appUser.employee_id ?? null,
    division_id: appUser.division_id ?? null,
    roles: resolveRolesFromAppUser(appUser),
    authSource: "uat",
  };
}

export async function upsertUatPasswordForEmail(
  email: string,
  password: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !password) {
    return { ok: false, error: "email and password are required" };
  }

  const supabase = getSupabaseService();
  if (!supabase) {
    return { ok: false, error: "Supabase service role not configured" };
  }

  const { data: appUser, error: userErr } = await supabase
    .from("app_users")
    .select("id, email")
    .ilike("email", normalizedEmail)
    .maybeSingle();

  if (userErr || !appUser) {
    return { ok: false, error: `No app_users row for ${normalizedEmail}` };
  }

  const password_hash = hashUatPassword(password);
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
    return { ok: false, error: upsertErr.message };
  }

  return { ok: true };
}
