"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

interface AppUser {
  id: string;
  email: string | null;
  display_name: string | null;
  role?: string | null;
  roles?: string[];
  employee_id: string | null;
  division_id: string | null;
  /** Resolved from synced `employees` (and `division_id`) on GET /api/admin/users */
  division_name?: string | null;
  is_active: boolean;
  created_at: string;
}

interface DynamicsUser {
  employee_id: string;
  full_name: string;
  email: string;
  title: string | null;
  division_id: string | null;
  division_name: string | null;
}

const SPECIAL_ROLES = ["hr", "admin"] as const;

function normalizeRoles(u: AppUser): string[] {
  const dbRoles = Array.isArray(u.roles) ? u.roles.map((r) => String(r).toLowerCase()) : [];
  if (dbRoles.length > 0) return dbRoles.filter((r) => SPECIAL_ROLES.includes(r as (typeof SPECIAL_ROLES)[number]));
  if (u.role && u.role !== "individual" && SPECIAL_ROLES.includes(u.role as (typeof SPECIAL_ROLES)[number])) {
    return [u.role];
  }
  return [];
}

function rolesSignature(roles: string[]) {
  return [...roles].slice().sort().join(",");
}

const NO_ROLES_HINT = "No roles selected = standard employee access";

function RoleCheckboxes({
  selected,
  onChange,
  compact = false,
}: {
  selected: string[];
  onChange: (r: string[]) => void;
  /** Table density: tighter spacing, and the no-roles hint is shown once in the column header. */
  compact?: boolean;
}) {
  const toggle = (r: string) =>
    onChange(selected.includes(r) ? selected.filter((x) => x !== r) : [...selected, r]);

  return (
    <div className={compact ? "space-y-1.5" : "space-y-3"} data-role-list>
      {[
        {
          value: "hr",
          label: "HR",
          desc: "All appraisals, 360 reviews, HR administration",
          color: "bg-ds-surface text-ds-accent-hover",
        },
        {
          value: "admin",
          label: "Admin",
          desc: "HR administration, operational plan, user management",
          color: "bg-ds-warning-subtle text-ds-warning",
        },
      ].map(({ value, label, desc, color }) => (
        <label
          key={value}
          data-role-option={value}
          className={cn("flex cursor-pointer items-start", compact ? "gap-2" : "gap-3")}
        >
          <button
            type="button"
            role="checkbox"
            aria-checked={selected.includes(value)}
            aria-label={label}
            onClick={() => toggle(value)}
            className={cn(
              "flex h-4 w-4 flex-shrink-0 cursor-pointer items-center justify-center rounded border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus focus-visible:ring-offset-1",
              compact ? "mt-px" : "mt-0.5",
              selected.includes(value)
                ? "border-ds-accent bg-ds-accent"
                : "border-ds-border bg-white hover:border-ds-accent"
            )}
          >
            {selected.includes(value) && (
              <svg width="10" height="8" viewBox="0 0 10 8" fill="none" aria-hidden="true">
                <path d="M1 4l3 3 5-6" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            )}
          </button>
          <div className="min-w-0">
            <span
              className={cn(
                "rounded-ds-badge font-semibold",
                compact ? "px-1.5 py-px text-[11px] leading-4" : "px-2 py-0.5 text-xs",
                color
              )}
            >
              {label}
            </span>
            <p
              data-role-desc
              className={cn(
                "text-ds-text-secondary",
                compact ? "mt-px text-[11px] leading-snug" : "mt-0.5 text-xs"
              )}
            >
              {desc}
            </p>
          </div>
        </label>
      ))}
      {!compact && <p className="mt-1 text-xs text-ds-border-strong">{NO_ROLES_HINT}</p>}
    </div>
  );
}

export function UserAdministrationTable() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [editDisplayName, setEditDisplayName] = useState<Record<string, string>>({});
  const [editIsActive, setEditIsActive] = useState<Record<string, boolean>>({});
  const [editRoles, setEditRoles] = useState<Record<string, string[]>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<DynamicsUser[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedUser, setSelectedUser] = useState<DynamicsUser | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to load users");
      }
      const data = await res.json();
      setUsers(Array.isArray(data) ? data : []);
      setEditDisplayName({});
      setEditIsActive({});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users");
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    const initial: Record<string, string[]> = {};
    users.forEach((u) => {
      initial[u.id] = normalizeRoles(u);
    });
    setEditRoles(initial);
  }, [users]);

  const getDisplayName = (u: AppUser) => (u.id in editDisplayName ? editDisplayName[u.id] : (u.display_name ?? ""));
  const getIsActive = (u: AppUser) => (u.id in editIsActive ? editIsActive[u.id] : u.is_active);

  const hasChanges = (u: AppUser) => {
    const originalRoles = rolesSignature(normalizeRoles(u));
    const draftRoles = rolesSignature(editRoles[u.id] ?? normalizeRoles(u));
    const rolesChanged = originalRoles !== draftRoles;
    return (
      rolesChanged ||
      getDisplayName(u) !== (u.display_name ?? "") ||
      getIsActive(u) !== u.is_active
    );
  };

  const saveUser = async (u: AppUser) => {
    const payload: Record<string, unknown> = {};
    if (getDisplayName(u) !== (u.display_name ?? "")) payload.display_name = getDisplayName(u) || null;
    if (getIsActive(u) !== u.is_active) payload.is_active = getIsActive(u);
    const newRoles = editRoles[u.id] ?? normalizeRoles(u);
    if (rolesSignature(newRoles) !== rolesSignature(normalizeRoles(u))) payload.roles = newRoles;
    if (Object.keys(payload).length === 0) return;

    setUpdatingId(u.id);
    try {
      const res = await fetch(`/api/admin/users/${u.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Update failed");
      }
      const updated = (await res.json().catch(() => ({}))) as {
        user?: {
          roles?: string[] | null;
          display_name?: string | null;
          employee_id?: string | null;
          division_id?: string | null;
          is_active?: boolean;
        };
      };
      const server = updated.user;
      const resolvedRoles = Array.isArray(server?.roles)
        ? server.roles
            .map((r) => String(r).toLowerCase())
            .filter((r) => SPECIAL_ROLES.includes(r as (typeof SPECIAL_ROLES)[number]))
        : (payload.roles as string[] | undefined) ?? normalizeRoles(u);

      setUsers((prev) =>
        prev.map((x) =>
          x.id === u.id
            ? {
                ...x,
                roles: resolvedRoles,
                display_name:
                  server?.display_name !== undefined
                    ? server.display_name
                    : payload.display_name !== undefined
                      ? (payload.display_name as string | null)
                      : x.display_name,
                employee_id: server?.employee_id !== undefined ? server.employee_id : x.employee_id,
                division_id: server?.division_id !== undefined ? server.division_id : x.division_id,
                is_active:
                  server?.is_active !== undefined
                    ? server.is_active
                    : payload.is_active !== undefined
                      ? (payload.is_active as boolean)
                      : x.is_active,
              }
            : x
        )
      );
      setEditDisplayName((prev) => {
        const next = { ...prev };
        delete next[u.id];
        return next;
      });
      setEditIsActive((prev) => {
        const next = { ...prev };
        delete next[u.id];
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setUpdatingId(null);
    }
  };

  useEffect(() => {
    if (!addOpen) return;
    if (searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await fetch(`/api/admin/dynamics/search-employees?q=${encodeURIComponent(searchQuery)}`);
        const data = await res.json().catch(() => ({}));
        setSearchResults(Array.isArray(data.results) ? data.results : []);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, addOpen]);

  const handleAddUser = async () => {
    if (!selectedUser) return;
    setAddSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: selectedUser.email.trim().toLowerCase(),
          display_name: selectedUser.full_name,
          roles: selectedRoles,
          employee_id: selectedUser.employee_id,
          division_id: selectedUser.division_id,
          is_active: true,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to add user");
      }
      setAddOpen(false);
      setSelectedUser(null);
      setSelectedRoles([]);
      setSearchQuery("");
      setSearchResults([]);
      await fetchUsers();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add user");
    } finally {
      setAddSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        Loading users…
      </div>
    );
  }

  if (error && users.length === 0) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        {error}
        <Button variant="outline" size="sm" className="mt-2" onClick={() => fetchUsers()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        {error && users.length > 0 && (
          <div className="rounded-lg border border-ds-warning-border bg-ds-warning-subtle px-3 py-2 text-sm text-ds-warning dark:text-amber-200">
            {error}
          </div>
        )}
        <div className="ml-auto">
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button>Add user</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add user</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                {!selectedUser ? (
                  <div>
                    <Label htmlFor="employee-search">Search employee</Label>
                    <div className="relative mt-1.5">
                      <svg
                        className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ds-text-secondary"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <circle cx="11" cy="11" r="8" />
                        <path d="M21 21l-4.35-4.35" />
                      </svg>
                      <Input
                        id="employee-search"
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Type name or email to search Dynamics..."
                        className="pl-9 pr-9"
                        autoFocus
                      />
                      {searchLoading && (
                        <svg
                          className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-ds-text-secondary"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M21 12a9 9 0 1 1-6.2-8.56" />
                        </svg>
                      )}
                    </div>
                    {searchResults.length > 0 && (
                      <div className="mt-2 max-h-64 overflow-auto rounded-ds-panel border border-ds-border bg-white">
                        {searchResults.map((user) => (
                          <button
                            key={user.employee_id}
                            type="button"
                            onClick={() => {
                              setSelectedUser(user);
                              setSearchQuery("");
                              setSearchResults([]);
                            }}
                            className="flex w-full items-center gap-3 border-b border-ds-surface px-4 py-3 text-left hover:bg-ds-surface last:border-b-0"
                          >
                            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-ds-surface text-xs font-semibold text-ds-accent-hover">
                              {user.full_name
                                .split(" ")
                                .map((n) => n[0])
                                .slice(0, 2)
                                .join("")}
                            </div>
                            <div>
                              <p className="text-sm font-medium text-ds-text-primary">{user.full_name}</p>
                              <p className="text-xs text-ds-text-secondary">
                                {user.email}
                                {user.title ? ` · ${user.title}` : ""}
                              </p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    {searchQuery.length >= 2 && !searchLoading && searchResults.length === 0 && (
                      <p className="mt-2 text-sm text-ds-text-secondary">No employees found in Dynamics</p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center gap-3 rounded-ds-panel border border-ds-border bg-ds-surface p-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-ds-surface text-sm font-semibold text-ds-accent-hover">
                        {selectedUser.full_name
                          .split(" ")
                          .map((n) => n[0])
                          .slice(0, 2)
                          .join("")}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-ds-text-primary">{selectedUser.full_name}</p>
                        <p className="text-xs text-ds-text-secondary">{selectedUser.email}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedUser(null)}
                        className="text-xs text-ds-text-secondary hover:text-ds-error"
                      >
                        Change
                      </button>
                    </div>
                    <div className="space-y-2">
                      <Label>Roles</Label>
                      <RoleCheckboxes selected={selectedRoles} onChange={setSelectedRoles} />
                    </div>
                  </div>
                )}
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => {
                    setAddOpen(false);
                    setSelectedUser(null);
                    setSelectedRoles([]);
                    setSearchQuery("");
                    setSearchResults([]);
                  }}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={handleAddUser}
                    disabled={!selectedUser || addSubmitting}
                    className={!selectedUser ? "cursor-not-allowed bg-ds-border text-ds-text-secondary hover:bg-ds-border" : "bg-ds-accent text-white hover:bg-ds-success"}
                  >
                    {addSubmitting ? "Adding…" : "Add user"}
                  </Button>
                </DialogFooter>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {users.length === 0 ? (
        <EmptyState
          icon={
            <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          }
          title="No users"
          description="No app users found. Add a user to get started."
          action={
            <Button onClick={() => setAddOpen(true)}>Add user</Button>
          }
        />
      ) : (
        <div className="animate-fade-up-delay-1 rounded-ds-panel border bg-card">
          <Table className="min-w-[880px] table-fixed">
            <colgroup>
              <col data-col="email" style={{ width: "22%" }} />
              <col data-col="display-name" style={{ width: "20%" }} />
              <col data-col="roles" />
              <col data-col="division" style={{ width: "14%" }} />
              <col data-col="active" style={{ width: "64px" }} />
              <col data-col="actions" style={{ width: "104px" }} />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead className="px-3">Email</TableHead>
                <TableHead className="px-3">Display name</TableHead>
                <TableHead className="h-auto px-3 py-2">
                  Roles
                  <span data-roles-hint className="block text-[11px] font-normal text-ds-text-muted">
                    {NO_ROLES_HINT}
                  </span>
                </TableHead>
                <TableHead className="px-3">Division</TableHead>
                <TableHead className="px-3">Active</TableHead>
                <TableHead className="px-3 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => {
                const dirty = hasChanges(u);
                const saving = updatingId === u.id;
                return (
                  <TableRow key={u.id} data-user-row={u.id}>
                    <TableCell className="px-3 py-2 text-[13px] font-medium [overflow-wrap:anywhere]">
                      {u.email?.includes("@") ? (
                        <>
                          {u.email.slice(0, u.email.indexOf("@"))}
                          <wbr />
                          {u.email.slice(u.email.indexOf("@"))}
                        </>
                      ) : (
                        u.email ?? "—"
                      )}
                    </TableCell>
                    <TableCell className="px-3 py-2">
                      <Input
                        className="h-8 w-full text-[13px]"
                        value={getDisplayName(u)}
                        onChange={(e) => setEditDisplayName((prev) => ({ ...prev, [u.id]: e.target.value }))}
                        placeholder="—"
                        aria-label={`Display name for ${u.email ?? "user"}`}
                      />
                    </TableCell>
                    <TableCell className="px-3 py-2 align-top [&:has([role=checkbox])]:pr-3">
                      <RoleCheckboxes
                        compact
                        selected={editRoles[u.id] ?? normalizeRoles(u)}
                        onChange={(newRoles) =>
                          setEditRoles((prev) => ({ ...prev, [u.id]: newRoles }))
                        }
                      />
                    </TableCell>
                    <TableCell className="px-3 py-2 text-[13px] text-ds-text-secondary [overflow-wrap:anywhere]">
                      {u.division_name?.trim() ? u.division_name : "—"}
                    </TableCell>
                    <TableCell className="px-3 py-2">
                      <Checkbox
                        checked={getIsActive(u)}
                        onCheckedChange={(checked) => setEditIsActive((prev) => ({ ...prev, [u.id]: !!checked }))}
                      />
                    </TableCell>
                    <TableCell className="px-3 py-2 text-right">
                      <Button
                        size="sm"
                        data-row-save
                        disabled={!dirty || saving}
                        onClick={() => saveUser(u)}
                        aria-label={`Save changes for ${u.email ?? "user"}`}
                        className="h-7 w-[76px] px-2 text-xs disabled:border disabled:border-ds-border disabled:bg-ds-surface disabled:text-ds-text-secondary disabled:opacity-100"
                      >
                        {saving ? "Saving…" : "Save"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
