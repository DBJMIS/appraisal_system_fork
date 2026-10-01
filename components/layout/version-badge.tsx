"use client";

import { usePathname } from "next/navigation";

export function VersionBadge({ version }: { version: string }) {
  const pathname = usePathname();
  if (pathname === "/login") return null;

  return (
    <div
      className="pointer-events-none fixed bottom-2 right-3 z-[60] select-none rounded-ds-badge border border-ds-border bg-ds-background px-2 py-1 text-[10px] font-medium text-ds-text-secondary"
      aria-label="application-version"
    >
      {version}
    </div>
  );
}
