import { createClient } from "@supabase/supabase-js";
import { getServerSession } from "next-auth";
import type { UserRole } from "@/types";
import { authOptions } from "@/lib/auth-options";

/**
 * Authentication layer.
 * Uses NextAuth session (Azure AD) when signed in; falls back to SEED_USER_EMAIL then placeholder.
 */

export interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
  roles: UserRole[];
  jobTitle?: string;
  department?: string;
  managerId?: string;
  /** Linked employee_id from app_users / Dynamics; used for dashboard and appraisals. */
  employee_id?: string | null;
  /** Division for GM role; used by RLS and division-scoped views. */
  division_id?: string | null;
  /** Temporary fallback while app_users.role exists during migration window. */
  role?: string | null;
  /** Where `id` comes from: app portal account vs HR employee record only. */
  source?: "app_users" | "employees";
}

/** Default placeholder user when no seed user is configured. */
const PLACEHOLDER_USER: AuthUser = {
  id: "placeholder-user-id",
  email: "user@company.com",
  name: "Placeholder User",
  roles: ["employee"],
  jobTitle: "Software Engineer",
  department: "Technology",
  managerId: "placeholder-manager-id",
  employee_id: null,
};

function getSupabaseService() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function toUserRole(role: string): UserRole {
  if (role === "individual") return "employee";
  if (role === "gm" || role === "manager" || role === "hr" || role === "admin") return role as UserRole;
  return "employee";
}

/** True if the given user is the placeholder (no real session). */
export function isPlaceholderUser(user: AuthUser | null): boolean {
  return user?.id === PLACEHOLDER_USER.id || user?.email === PLACEHOLDER_USER.email;
}

/**
 * Get the current user.
 * HR/admin: row in app_users → `id` is app_users UUID.
 * Regular employees: no app_users row → `id` is employees.employee_id (Dynamics id), never the email string.
 */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const session = await getServerSession(authOptions);
  const sessionUser = session?.user as
    | {
        email?: string | null;
        name?: string | null;
        roles?: string[];
        employee_id?: string | null;
        division_id?: string | null;
      }
    | undefined;
  const sessionEmail = session?.user?.email?.trim();
  const seedEmail = process.env.SEED_USER_EMAIL?.trim();
  const email = sessionEmail ?? seedEmail;
  if (!email) return PLACEHOLDER_USER;

  const supabase = getSupabaseService();
  if (!supabase) {
    return session?.user ? null : PLACEHOLDER_USER;
  }

  const { data: row, error } = await supabase
    .from("app_users")
    .select("id, email, display_name, role, roles, employee_id, division_id")
    .ilike("email", email)
    .eq("is_active", true)
    .maybeSingle();

  if (!error && row) {
    const employee_id = sessionUser?.employee_id ?? row.employee_id ?? null;
    const division_id = sessionUser?.division_id ?? row.division_id ?? null;
    const dbRoles = Array.isArray((row as { roles?: unknown }).roles)
      ? ((row as { roles?: unknown[] }).roles ?? []).map((r) => String(r))
      : [];
    const fallbackRole = typeof row.role === "string" ? row.role : null;
    const resolvedRoles =
      dbRoles.length > 0
        ? dbRoles
        : fallbackRole && fallbackRole !== "individual"
          ? [fallbackRole]
          : [];
    return {
      id: row.id,
      email: row.email ?? null,
      name: row.display_name ?? row.email ?? null,
      roles: resolvedRoles.map((r) => toUserRole(r)),
      employee_id,
      division_id,
      role: fallbackRole,
      source: "app_users",
    };
  }

  if (session?.user) {
    const employeeId = sessionUser?.employee_id ?? null;
    const divisionId = sessionUser?.division_id ?? null;
    if (!employeeId) {
      console.warn(`[auth] No HRMIS identity (employee_id) for: ${email}`);
      return null;
    }

    return {
      id: employeeId,
      email: session.user.email ?? null,
      name: (session.user.name ?? session.user.email) ?? null,
      roles: ["employee"],
      employee_id: employeeId,
      division_id: divisionId,
      source: "employees",
    };
  }

  const { data: seedApp } = await supabase
    .from("app_users")
    .select("id, email, display_name, role, roles, employee_id, division_id")
    .ilike("email", email)
    .eq("is_active", true)
    .maybeSingle();

  if (seedApp) {
    const employee_id = seedApp.employee_id ?? null;
    const division_id = seedApp.division_id ?? null;
    const dbRoles = Array.isArray((seedApp as { roles?: unknown }).roles)
      ? ((seedApp as { roles?: unknown[] }).roles ?? []).map((r) => String(r))
      : [];
    const fallbackRole = typeof seedApp.role === "string" ? seedApp.role : null;
    const resolvedRoles =
      dbRoles.length > 0
        ? dbRoles
        : fallbackRole && fallbackRole !== "individual"
          ? [fallbackRole]
          : [];
    return {
      id: seedApp.id,
      email: seedApp.email ?? null,
      name: seedApp.display_name ?? seedApp.email ?? null,
      roles: resolvedRoles.map((r) => toUserRole(r)),
      employee_id,
      division_id,
      role: fallbackRole,
      source: "app_users",
    };
  }

  return PLACEHOLDER_USER;
}

/**
 * Sign in. Placeholder — no-op until Entra ID is configured.
 */
export async function signIn(): Promise<{ success: boolean; error?: string }> {
  // TODO: Redirect to Entra ID login or handle OAuth flow
  return { success: true };
}

/**
 * Sign out. Placeholder — clear local state; will clear Entra ID session when integrated.
 */
export async function signOut(): Promise<void> {
  // TODO: Clear Entra ID session and redirect to logout endpoint
}

/**
 * Check if the current session is authenticated (placeholder).
 */
export function isAuthenticated(): boolean {
  // TODO: Validate real session (e.g. JWT from Entra ID)
  return true;
}
