"use client";

import { ChevronDown, MoreHorizontal, ArrowUpDown, Filter } from "lucide-react";

const AVATAR_COLORS = [
  "bg-ms-avatar-teal",
  "bg-ms-avatar-purple",
  "bg-ms-avatar-red",
  "bg-ms-avatar-orange",
  "bg-ms-avatar-green",
  "bg-ms-avatar-blue",
  "bg-ms-avatar-gray",
] as const;

function getAvatarColor(index: number) {
  return AVATAR_COLORS[index % AVATAR_COLORS.length];
}

export type PanelVariant = "leave" | "employment" | "empty";

export interface KanbanRowLeave {
  type: "leave";
  id: string;
  days: string;
  label: string;
  status: string;
  avatarNumber: number;
}

export interface KanbanRowEmployment {
  type: "employment";
  id: string;
  name: string;
  date: string;
  subtitle: string;
  avatarInitials: string;
  avatarColorIndex: number;
  value?: string;
}

export type KanbanRow = KanbanRowLeave | KanbanRowEmployment;

export interface KanbanPanelProps {
  title: string;
  filtered?: boolean;
  count: number;
  sortLabel?: string;
  variant: PanelVariant;
  rows: KanbanRow[];
  activeBorder?: boolean;
}

function LeaveRow({ row, colorClass }: { row: KanbanRowLeave; colorClass: string }) {
  return (
    <div className="flex h-14 min-h-[56px] items-center gap-3 border-b border-ms-border px-3 py-2 hover:bg-ms-hover group">
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold text-white ${colorClass}`}
      >
        {row.avatarNumber}
      </div>
      <div className="min-w-0 flex-1">
        <a
          href="#"
          className="text-[14px] font-normal text-ms-link hover:underline"
        >
          {row.days}: {row.label}
        </a>
        <div className="text-[12px] text-ms-muted">{row.status}</div>
      </div>
      <button
        type="button"
        className="shrink-0 p-1 rounded hover:bg-ms-border opacity-0 group-hover:opacity-100 transition-opacity"
        aria-label="Expand"
      >
        <ChevronDown className="h-4 w-4 text-ms-muted" />
      </button>
      <button
        type="button"
        className="shrink-0 p-1 rounded hover:bg-ms-border opacity-0 group-hover:opacity-100 transition-opacity"
        aria-label="More"
      >
        <MoreHorizontal className="h-4 w-4 text-ms-muted" />
      </button>
    </div>
  );
}

function EmploymentRow({
  row,
  colorClass,
}: {
  row: KanbanRowEmployment;
  colorClass: string;
}) {
  return (
    <div className="flex h-14 min-h-[56px] items-center gap-3 border-b border-ms-border px-3 py-2 hover:bg-ms-hover group">
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold text-white ${colorClass}`}
      >
        {row.avatarInitials}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-normal text-ms-text">{row.name}</div>
        <div className="text-[12px] text-ms-muted">
          {row.date}
          {row.subtitle ? ` · ${row.subtitle}` : ""}
        </div>
        {row.value && (
          <div className="text-[12px] text-ms-muted mt-0.5">{row.value}</div>
        )}
      </div>
      <button
        type="button"
        className="shrink-0 p-1 rounded hover:bg-ms-border opacity-0 group-hover:opacity-100 transition-opacity"
        aria-label="More"
      >
        <MoreHorizontal className="h-4 w-4 text-ms-muted" />
      </button>
    </div>
  );
}

export function KanbanPanel({
  title,
  filtered = false,
  count,
  sortLabel = "Modified On",
  variant,
  rows,
  activeBorder = false,
}: KanbanPanelProps) {
  return (
    <div
      className="flex w-80 shrink-0 flex-col overflow-hidden rounded-sm bg-white"
      style={{
        border: "1px solid #edebe9",
        borderLeftWidth: 4,
        borderLeftColor: activeBorder ? "#107c10" : "#edebe9",
      }}
    >
      <div className="border-b border-ms-border bg-white px-3 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-[16px] font-bold text-ms-text leading-tight truncate flex-1 min-w-0">
            {title}
          </h3>
          <span className="shrink-0 rounded-full bg-ms-muted/20 px-2 py-0.5 text-[12px] font-medium text-ms-muted">
            {count}
          </span>
        </div>
        <div className="mt-1.5 flex items-center gap-1">
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
              filtered
                ? "bg-[#605e5c]/20 text-ms-muted"
                : "bg-[#107c10]/15 text-ms-green"
            }`}
          >
            {filtered ? "Filtered" : "Unfiltered"}
          </span>
          <div className="flex flex-1 items-center justify-end gap-1">
            <button
              type="button"
              className="flex items-center gap-1 rounded px-1.5 py-1 text-[12px] text-ms-muted hover:bg-ms-hover"
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
              {sortLabel}
            </button>
            <button
              type="button"
              className="p-1 rounded text-ms-muted hover:bg-ms-hover"
              aria-label="Filter"
            >
              <Filter className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto min-h-[200px] max-h-[calc(100vh-280px)]">
        {variant === "empty" ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-ms-border/50 text-ms-muted mb-3">
              <svg
                className="h-8 w-8"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M20 7l-8 4-8-4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                />
              </svg>
            </div>
            <p className="text-[14px] font-normal text-ms-muted">
              No data available
            </p>
          </div>
        ) : (
          rows.map((row, idx) => {
            if (row.type === "leave") {
              return (
                <LeaveRow
                  key={row.id}
                  row={row}
                  colorClass={getAvatarColor(idx)}
                />
              );
            }
            return (
              <EmploymentRow
                key={row.id}
                row={row}
                colorClass={
                  row.avatarColorIndex !== undefined
                    ? AVATAR_COLORS[row.avatarColorIndex % AVATAR_COLORS.length]
                    : getAvatarColor(idx)
                }
              />
            );
          })
        )}
      </div>
    </div>
  );
}
