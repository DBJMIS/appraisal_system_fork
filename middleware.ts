import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

/**
 * Protect app routes: redirect to sign-in when there is no session.
 * After sign-in, user is sent back via callbackUrl so the server will have the session cookie.
 */
export async function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  const isAuthRoute = pathname.startsWith("/api/auth") || pathname === "/login";
  const isWebhookRoute = pathname.startsWith("/api/webhooks/adobe-sign");
  const isPublic =
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".");
  const isReportingTest = pathname === "/reporting-test";
  // Vercel Cron has no session; the route itself requires CRON_SECRET (or an HR/Admin session for manual POST).
  const isScheduledJobRoute = pathname === "/api/cron/appraisal-reminders";

  if (isAuthRoute || isWebhookRoute || isPublic || isReportingTest || isScheduledJobRoute) {
    return NextResponse.next();
  }

  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    return NextResponse.next();
  }

  const token = await getToken({
    req,
    secret,
  });

  if (!token) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname + req.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  const roles: string[] = Array.isArray((token as { roles?: unknown }).roles)
    ? ((token as { roles?: unknown[] }).roles ?? []).map((r) => String(r))
    : [];

  const hrRoutes = ["/admin/appraisals", "/admin/360"];
  const adminRoutes = ["/admin/users", "/admin/operational-plan"];

  if (hrRoutes.some((r) => pathname.startsWith(r)) && !roles.includes("hr")) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  if (adminRoutes.some((r) => pathname.startsWith(r)) && !roles.includes("admin")) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  if ((pathname === "/admin" || pathname.startsWith("/admin/")) && !roles.includes("hr") && !roles.includes("admin")) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - api/auth (NextAuth)
     * - api/webhooks/adobe-sign* (Adobe Sign webhook verification/callback)
     * - login
     * - _next (Next.js)
     * - static files
     */
    "/((?!api/auth|api/webhooks/adobe-sign|login|_next/static|_next/image|favicon.ico|.*\\.).*)",
  ],
};
