"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { AppNotification, NotificationType } from "@/lib/notifications/types";

async function loadUnreadCount(): Promise<number> {
  try {
    const r = await fetch("/api/notifications/count");
    const d = (await r.json()) as { count?: number };
    return d.count ?? 0;
  } catch {
    return 0;
  }
}

function typeIcon(type: string): { label: string } {
  if (type.startsWith("appraisal.")) return { label: "A" };
  if (type.startsWith("feedback.")) return { label: "360" };
  if (type.startsWith("checkin.")) return { label: "CI" };
  return { label: "!" };
}

const BellIcon = () => (
  <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

export function NotificationBell({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadUnreadCount().then(setCount);
    const interval = setInterval(() => {
      void loadUnreadCount().then(setCount);
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadUnreadCount().then(setCount);
    setLoading(true);
    fetch("/api/notifications?limit=20")
      .then((r) => r.json())
      .then((d: { notifications?: AppNotification[] }) => setNotifications(d.notifications ?? []))
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const markRead = async (id: string) => {
    const prev = notifications.find((n) => n.id === id);
    const wasUnread = prev && !prev.read_at;
    await fetch(`/api/notifications/${id}/read`, { method: "POST" });
    setNotifications((p) =>
      p.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n))
    );
    if (wasUnread) setCount((c) => Math.max(0, c - 1));
  };

  const markAllRead = async () => {
    await fetch("/api/notifications/read-all", { method: "POST" });
    setNotifications((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
    setCount(0);
  };

  return (
    <div className={cn("relative", className)} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-8 w-8 items-center justify-center rounded-ds-button text-ds-text-secondary transition-colors duration-100 hover:bg-ds-surface-hover hover:text-ds-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus"
        aria-label="Notifications"
        title="Notifications"
      >
        <BellIcon />
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-ds-button bg-ds-error px-1 text-[10px] font-semibold text-white">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-[70] mt-2 w-80 overflow-hidden rounded-ds-popover border border-ds-border bg-ds-background shadow-ds-popover">
          <div className="flex items-center justify-between border-b border-ds-border px-4 py-2.5">
            <span className="text-[13px] font-semibold text-ds-text-primary">
              Notifications{" "}
              {count > 0 && <span className="font-normal text-ds-text-secondary">({count})</span>}
            </span>
            {count > 0 && (
              <button type="button" onClick={markAllRead} className="text-xs font-medium text-ds-text-primary underline-offset-2 hover:underline">
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loading ? (
              <div className="space-y-3 p-4" aria-busy="true">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="animate-pulse motion-reduce:animate-none">
                    <div className="mb-1.5 h-3 w-[75%] rounded bg-ds-surface" />
                    <div className="h-2.5 w-full rounded bg-ds-surface" />
                  </div>
                ))}
              </div>
            ) : notifications.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-[13px] text-ds-text-secondary">No notifications yet</p>
              </div>
            ) : (
              notifications.map((n) => {
                const typeLabel = typeIcon(n.type as NotificationType | string).label;
                return (
                  <div
                    key={n.id}
                    className={cn(
                      "flex gap-3 border-b border-ds-border px-4 py-3 transition-colors duration-100 last:border-b-0 hover:bg-ds-surface-hover",
                      !n.read_at && "bg-ds-surface"
                    )}
                  >
                    <div className="mt-0.5 flex h-6 min-w-6 flex-shrink-0 items-center justify-center rounded-ds-badge border border-ds-border-strong px-1 text-[10px] font-semibold text-ds-text-secondary">
                      {typeLabel}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={cn("text-xs leading-snug text-ds-text-primary", n.read_at ? "font-medium" : "font-semibold")}>
                        {!n.read_at && <span className="sr-only">Unread: </span>}
                        {n.title}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-ds-text-secondary">{n.body}</p>
                      <div className="mt-1.5 flex items-center justify-between">
                        <span className="text-[11px] text-ds-text-secondary">
                          {new Date(n.created_at).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                        <div className="flex gap-3">
                          {n.link && (
                            <Link
                              href={n.link}
                              onClick={() => {
                                void markRead(n.id);
                                setOpen(false);
                              }}
                              className="text-[11px] font-medium text-ds-text-primary underline-offset-2 hover:underline"
                            >
                              View
                            </Link>
                          )}
                          {!n.read_at && (
                            <button
                              type="button"
                              onClick={() => void markRead(n.id)}
                              className="text-[11px] text-ds-text-secondary hover:text-ds-text-primary"
                            >
                              Dismiss
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
