import { NextResponse } from "next/server";
import { getCurrentUser, isPlaceholderUser, type AuthUser } from "@/lib/auth";

export type HrOrAdminGuardResult =
  | { ok: true; user: AuthUser }
  | { ok: false; response: NextResponse };

export function isHrOrAdmin(user: Pick<AuthUser, "roles"> | null | undefined): boolean {
  return !!user?.roles?.some((r) => r === "hr" || r === "admin");
}

/**
 * Resolves the current user and allows only HR or admin.
 * 401 when there is no real session, 403 for any other authenticated user.
 */
export async function requireHrOrAdmin(): Promise<HrOrAdminGuardResult> {
  const user = await getCurrentUser();
  if (!user?.id || isPlaceholderUser(user)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 }),
    };
  }
  if (!isHrOrAdmin(user)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Forbidden", code: "FORBIDDEN" }, { status: 403 }),
    };
  }
  return { ok: true, user };
}
