"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/utils/cn";
import { useAuth } from "@/hooks/use-auth";
import { avatarAccent } from "@/lib/avatar-accent";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  exactMatch?: boolean;
  section?: "main" | "hr" | "admin";
  accent?: NavAccent;
}

type NavAccent = "coral" | "mint" | "lavender" | "amber";

const NAV_ACCENT: Record<NavAccent, { icon: string; marker: string }> = {
  coral: { icon: "text-ds-coral", marker: "bg-ds-coral" },
  mint: { icon: "text-ds-mint", marker: "bg-ds-mint" },
  lavender: { icon: "text-ds-lavender", marker: "bg-ds-lavender" },
  amber: { icon: "text-ds-amber", marker: "bg-ds-amber" },
};

const GridIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);

const DocumentIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </svg>
);

const ClipboardIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
  </svg>
);

const BoltIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

const UserCircleIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 7a4 4 0 11-8 0 4 4 0 018 0z" />
    <path d="M12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
  </svg>
);

const UsersIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const ListIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" />
    <line x1="3" y1="12" x2="3.01" y2="12" />
    <line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
);

const SettingsIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const ChevronLeftIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

const ChevronRightIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const ClipboardCheckIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
    <path d="m9 14 2 2 4-4" />
  </svg>
);

const Feedback360Icon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </svg>
);

const ApiTesterIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M18 20V10" />
    <path d="M12 20V4" />
    <path d="M6 20v-6" />
  </svg>
);

const OperationalPlanIcon = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
);

const navItems: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: <GridIcon />, section: "main" },
  { href: "/appraisals", label: "My Appraisals", icon: <DocumentIcon />, section: "main", accent: "coral" },
  { href: "/feedback", label: "360 Feedback", icon: <Feedback360Icon />, section: "main", accent: "lavender" },
  { href: "/development", label: "Development Profile", icon: <BoltIcon />, section: "main", exactMatch: true, accent: "mint" },
  {
    href: "/admin/appraisals",
    label: "All Appraisals",
    icon: <ListIcon />,
    section: "hr",
    accent: "coral",
  },
  {
    href: "/admin/360",
    label: "All 360 Reviews",
    icon: <Feedback360Icon />,
    section: "hr",
    accent: "lavender",
  },
  {
    href: "/admin",
    label: "HR Administration",
    icon: <SettingsIcon />,
    section: "hr",
    accent: "lavender",
  },
  {
    href: "/admin",
    label: "HR Administration",
    icon: <SettingsIcon />,
    section: "admin",
    accent: "lavender",
  },
  {
    href: "/admin/operational-plan",
    label: "Operational Plan",
    icon: <OperationalPlanIcon />,
    section: "admin",
    accent: "amber",
  },
  {
    href: "/admin/users",
    label: "User administration",
    icon: <UsersIcon />,
    section: "admin",
  },
];

function navLinkClass(isActive: boolean, collapsed: boolean) {
  return cn(
    "group relative flex items-center rounded-ds-button text-[13px] transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
    collapsed ? "justify-center p-2.5" : "gap-2.5 px-2.5 py-[7px]",
    isActive
      ? "bg-white/[0.09] font-medium text-white"
      : "font-normal text-white/65 hover:bg-white/[0.05] hover:text-white"
  );
}

function NavLinkItem({ item, isActive, collapsed }: { item: NavItem; isActive: boolean; collapsed: boolean }) {
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      aria-current={isActive ? "page" : undefined}
      className={navLinkClass(isActive, collapsed)}
    >
      {isActive && <ActiveMarker accent={item.accent} />}
      <NavIcon accent={item.accent} isActive={isActive}>
        {item.icon}
      </NavIcon>
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );
}

function ActiveMarker({ accent }: { accent?: NavAccent }) {
  return (
    <span
      aria-hidden="true"
      className={cn("absolute inset-y-1.5 left-0 w-0.5 rounded-full", accent ? NAV_ACCENT[accent].marker : "bg-white/60")}
    />
  );
}

function NavIcon({ accent, isActive, children }: { accent?: NavAccent; isActive: boolean; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "shrink-0 transition-[color,opacity] duration-100",
        accent
          ? cn(NAV_ACCENT[accent].icon, isActive ? "opacity-100" : "opacity-75 group-hover:opacity-100")
          : isActive
            ? "text-white/80"
            : "text-white/40 group-hover:text-white/60"
      )}
    >
      {children}
    </span>
  );
}

function SectionLabel({ children, first = false }: { children: React.ReactNode; first?: boolean }) {
  return <div className={cn("mb-1.5 px-2.5 text-[11px] font-medium text-white/40", !first && "mt-5")}>{children}</div>;
}

export function Sidebar() {
  const pathname = usePathname();
  const { user } = useAuth();
  const roles = (user?.roles ?? []).map((r) => String(r).toLowerCase());
  const isHR = roles.includes("hr");
  const isAdmin = roles.includes("admin");
  const [collapsed, setCollapsed] = useState(false);

  const mainItems = navItems.filter((i) => i.section === "main");
  const hrItems = isHR ? navItems.filter((i) => i.section === "hr") : [];
  const adminItems = isAdmin
    ? navItems.filter((i) => i.section === "admin" && (isHR ? i.href !== "/admin" : true))
    : [];

  const initials = user?.name
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "U";

  return (
    <aside
      className={cn(
        "relative flex h-full flex-col overflow-hidden bg-ds-accent transition-[width] duration-200",
        collapsed ? "w-16" : "w-60"
      )}
    >
      {/* Logo block */}
      <div
        className={cn(
          "flex items-center border-b border-white/[0.08]",
          collapsed ? "flex-col gap-2 px-2 py-3" : "gap-2.5 px-4 py-2.5"
        )}
      >
        {collapsed ? (
          <Image
            src="/brand/dbj-ascend-mark.png"
            alt="DBJ Ascend"
            width={242}
            height={234}
            priority
            className="h-8 w-8 shrink-0 object-contain"
          />
        ) : (
          <Image
            src="/brand/dbj-ascend-logo.png"
            alt="DBJ Ascend — Performance & Development Portal"
            width={960}
            height={241}
            priority
            className="h-10 w-auto min-w-0 max-w-[172px] object-contain object-left"
          />
        )}
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          className={cn(
            "ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded-ds-button text-white/45 transition-colors duration-100 hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60",
            collapsed && "mx-auto"
          )}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
        </button>
      </div>

      {/* Navigation */}
      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-4">
        {/* Main section */}
        {!collapsed && <SectionLabel first>Main</SectionLabel>}
        <div className="space-y-px">
          {mainItems.map((item) => {
            const isActive = item.exactMatch
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(item.href + "/");

            return <NavLinkItem key={item.href} item={item} isActive={isActive} collapsed={collapsed} />;
          })}
        </div>

        {/* Admin section */}
        {adminItems.length > 0 && (
          <>
            {!collapsed && <SectionLabel>Admin</SectionLabel>}
            <div className="space-y-px">
              {adminItems.map((item) => {
                const isActive = item.exactMatch
                  ? pathname === item.href
                  : pathname === item.href || pathname.startsWith(item.href + "/");

                return <NavLinkItem key={item.href} item={item} isActive={isActive} collapsed={collapsed} />;
              })}
            </div>
          </>
        )}

        {/* HR section */}
        {hrItems.length > 0 && (
          <>
            {!collapsed && <SectionLabel>HR</SectionLabel>}
            <div className="space-y-px">
              {hrItems.map((item) => {
                const isHRAdminActive =
                  item.href === "/admin" &&
                  (pathname.startsWith("/admin/settings") ||
                    pathname.startsWith("/admin/360-settings") ||
                    pathname === "/admin");
                const isOperationalPlanActive =
                  item.href === "/admin/operational-plan" && pathname.startsWith("/admin/operational-plan");
                const is360Active =
                  item.href === "/admin/360" && pathname.startsWith("/admin/360");
                const isUsersActive =
                  item.href === "/admin/users" && pathname.startsWith("/admin/users");
                const isAppraisalsActive =
                  item.href === "/admin/appraisals" && pathname.startsWith("/admin/appraisals");
                // HR Administration (href="/admin") must only be active for /admin or its settings routes, not for /admin/appraisals, /admin/360, etc.
                const isActive =
                  item.href === "/admin"
                    ? isHRAdminActive
                    : isOperationalPlanActive
                      ? true
                      : is360Active
                        ? true
                        : isUsersActive
                          ? true
                          : isAppraisalsActive
                            ? true
                            : pathname === item.href || pathname.startsWith(item.href + "/");

                return <NavLinkItem key={item.href} item={item} isActive={isActive} collapsed={collapsed} />;
              })}
            </div>
          </>
        )}

        {process.env.NODE_ENV === "development" && (
          <div className="mt-5 space-y-px">
            <Link
              href="/achieveit-api-tester.html"
              title={collapsed ? "AchieveIt API Tester" : undefined}
              className={cn(
                "group relative flex items-center rounded-ds-button text-[13px] text-white/40 transition-colors duration-100 hover:text-white/65",
                collapsed ? "justify-center p-2.5" : "gap-2.5 px-2.5 py-[7px]"
              )}
            >
              <span className="shrink-0">
                <ApiTesterIcon />
              </span>
              {!collapsed && <span className="truncate">AchieveIt tester</span>}
            </Link>
          </div>
        )}
      </nav>

      {/* User block */}
      <div className="border-t border-white/[0.08] px-3 py-3">
        <div
          className={cn(
            "flex items-center gap-2.5 rounded-ds-button p-2",
            collapsed && "justify-center"
          )}
        >
          <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold", avatarAccent(user?.name).className)}>
            {initials}
          </div>
          {!collapsed && (
            <div className="flex flex-col overflow-hidden">
              <span className="truncate text-[13px] font-medium text-white">
                {user?.name || "User"}
              </span>
              <span className="truncate text-[11px] text-white/45">
                {user?.roles?.[0] || "Employee"}
              </span>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
