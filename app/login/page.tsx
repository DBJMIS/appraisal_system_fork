"use client";

import { useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { UAT_CREDENTIALS_PROVIDER_ID } from "@/lib/uat-credentials-constants";

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "v0.3.0";
const SHOW_UAT_LOGIN = process.env.NEXT_PUBLIC_ENABLE_UAT_CREDENTIALS === "true";

export default function LoginPage() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/dashboard";
  const error = searchParams.get("error");

  const [uatEmail, setUatEmail] = useState("");
  const [uatPassword, setUatPassword] = useState("");
  const [uatLoading, setUatLoading] = useState(false);
  const [uatError, setUatError] = useState(false);

  const handleUatSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setUatLoading(true);
    setUatError(false);
    try {
      const res = await signIn(UAT_CREDENTIALS_PROVIDER_ID, {
        email: uatEmail.trim(),
        password: uatPassword,
        callbackUrl,
        redirect: false,
      });
      if (res?.ok) {
        window.location.href = callbackUrl;
        return;
      }
      setUatError(true);
    } catch {
      setUatError(true);
    } finally {
      setUatLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center relative bg-no-repeat"
      style={{
        backgroundImage: "url('/bg1.jpg')",
        backgroundSize: "cover",
        backgroundPosition: "50% 35%",
      }}
    >
      {/* Overlay: flat neutral scrim so the card stays the focus */}
      <div className="absolute inset-0" style={{ background: "rgba(13, 14, 16, 0.62)" }} aria-hidden />
      <div className="absolute bottom-5 right-7 z-10 pointer-events-none">
        <span className="rounded-ds-badge border border-white/15 bg-white/10 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white/75">
          {APP_VERSION}
        </span>
      </div>

      {/* Card */}
      <main
        data-login-card
        className="relative z-10 mx-4 w-full max-w-[400px] rounded-[10px] border border-black/5 bg-ds-background shadow-ds-dialog"
      >
        {/* Institution / product */}
        <header className="flex items-center gap-3 border-b border-ds-border px-7 py-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-ds-button bg-ds-accent">
            <Image src="/brand/dbj-ascend-mark.png" alt="" width={242} height={234} priority className="h-[22px] w-[22px] object-contain" />
          </div>
          <div className="min-w-0">
            <p className="m-0 truncate text-[14px] font-semibold leading-[1.3] text-ds-text-primary">Development Bank of Jamaica</p>
            <p className="m-0 truncate text-[12px] leading-[1.35] text-ds-text-secondary">Performance Management System</p>
          </div>
        </header>

        <div className="px-7 pb-6 pt-6">
          {/* Heading */}
          <h1 className="m-0 text-[20px] font-semibold leading-[1.25] tracking-[-0.01em] text-ds-text-primary">Welcome back</h1>
          <p className="m-0 mt-1 text-[13px] leading-[1.45] text-ds-text-secondary">
            Sign in with your work account to continue.
          </p>

          {/* Error messages */}
          {(error === "CredentialsSignin" || uatError) && (
            <p role="alert" className="m-0 mt-4 rounded-ds-control border border-ds-error-border bg-ds-error-subtle px-3 py-2 text-[13px] text-ds-error">
              Sign in failed. Please check your email and password.
            </p>
          )}
          {error && error !== "CredentialsSignin" && !uatError && (
            <p role="alert" className="m-0 mt-4 rounded-ds-control border border-ds-border bg-ds-surface px-3 py-2 text-[13px] text-ds-text-secondary">
              An error occurred. Please try again.
            </p>
          )}

          {/* Microsoft SSO button (primary) */}
          <button
            type="button"
            onClick={() => signIn("azure-ad", { callbackUrl })}
            className="mt-5 flex h-10 w-full items-center justify-center gap-2.5 rounded-ds-button bg-ds-accent text-[14px] font-medium text-ds-on-primary transition-colors duration-100 hover:bg-ds-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus focus-visible:ring-offset-2"
          >
            <svg width="16" height="16" viewBox="0 0 21 21" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0" aria-hidden="true">
              <rect x="1" y="1" width="9" height="9" fill="#F25022" />
              <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
              <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
              <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
            </svg>
            <span>Sign in with Microsoft</span>
          </button>

          {SHOW_UAT_LOGIN && (
            <section aria-labelledby="uat-heading" data-uat-section className="mt-5 rounded-ds-panel border border-ds-border bg-[#fafafa] px-4 pb-4 pt-3">
              <div className="flex items-center justify-between gap-3">
                <h2 id="uat-heading" className="m-0 text-[13px] font-medium text-ds-text-primary">Test account access</h2>
                <span className="rounded-ds-badge border border-ds-border-strong bg-ds-background px-1.5 py-0.5 text-[11px] font-medium leading-4 text-ds-text-secondary">
                  UAT testing
                </span>
              </div>
              <p className="m-0 mt-0.5 text-[12px] leading-[1.4] text-ds-text-secondary">
                For HR UAT only. Production staff should use Microsoft sign-in above.
              </p>

              <form onSubmit={handleUatSubmit} className="mt-3 space-y-2.5">
                <div>
                  <label htmlFor="uat-email" className="mb-1 block text-[12px] font-medium text-ds-text-primary">
                    Email
                  </label>
                  <input
                    id="uat-email"
                    type="email"
                    autoComplete="username"
                    required
                    value={uatEmail}
                    onChange={(e) => setUatEmail(e.target.value)}
                    className="block h-9 w-full rounded-ds-control border border-ds-border-control bg-ds-background px-2.5 text-[14px] text-ds-text-primary placeholder:text-ds-text-muted transition-colors duration-100 hover:border-ds-text-secondary focus:border-ds-focus focus:outline-none focus:ring-1 focus:ring-ds-focus"
                    placeholder="leonwull@dbankjm.com"
                  />
                </div>
                <div>
                  <label htmlFor="uat-password" className="mb-1 block text-[12px] font-medium text-ds-text-primary">
                    Password
                  </label>
                  <input
                    id="uat-password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={uatPassword}
                    onChange={(e) => setUatPassword(e.target.value)}
                    className="block h-9 w-full rounded-ds-control border border-ds-border-control bg-ds-background px-2.5 text-[14px] text-ds-text-primary placeholder:text-ds-text-muted transition-colors duration-100 hover:border-ds-text-secondary focus:border-ds-focus focus:outline-none focus:ring-1 focus:ring-ds-focus"
                  />
                </div>
                <button
                  type="submit"
                  disabled={uatLoading}
                  className="!mt-3 flex h-9 w-full items-center justify-center rounded-ds-button border border-ds-border-strong bg-ds-background text-[13px] font-medium text-ds-text-primary transition-colors duration-100 hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {uatLoading ? "Signing in…" : "Sign in with test account"}
                </button>
              </form>
            </section>
          )}
        </div>

        {/* Card footer metadata */}
        <footer className="flex items-center justify-between gap-3 border-t border-ds-border px-7 py-3 text-[12px] text-ds-text-secondary">
          <span className="flex items-center gap-1.5">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0" aria-hidden="true">
              <rect x="3" y="7" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="1.3" />
              <path d="M5 7V5a3 3 0 016 0v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
            Azure AD (Entra ID)
          </span>
          <span className="font-medium tabular-nums text-ds-text-primary">FY 2026 – 2027</span>
        </footer>
      </main>
    </div>
  );
}
