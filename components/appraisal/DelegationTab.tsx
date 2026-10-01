"use client";

import { useEffect, useState } from "react";
import { avatarAccent } from "@/lib/avatar-accent";

interface TeamMember {
  id: string;
  name: string;
  jobTitle: string;
}

interface Delegation {
  id: string;
  delegated_to: string;
  delegated_to_name: string;
  created_at: string;
}

interface DelegationTabProps {
  appraisalId: string;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "NA";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

export function DelegationTab({ appraisalId }: DelegationTabProps) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [delegation, setDelegation] = useState<Delegation | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [selectedName, setSelectedName] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [dRes, mRes] = await Promise.all([
        fetch(`/api/appraisals/${appraisalId}/delegation`, { cache: "no-store" }),
        fetch(`/api/appraisals/${appraisalId}/team-members`, { cache: "no-store" }),
      ]);
      const d = await dRes.json().catch(() => ({}));
      const m = await mRes.json().catch(() => ({}));
      console.log("delegation team-members response", m);
      if (cancelled) return;
      setDelegation(d?.delegation ?? null);
      const normalizedMembers: TeamMember[] = Array.isArray(m?.members)
        ? m.members
            .map((row: unknown) => {
              const r = row as { id?: unknown; name?: unknown; jobTitle?: unknown };
              return {
                id: typeof r.id === "string" ? r.id : "",
                name: typeof r.name === "string" ? r.name : "",
                jobTitle: typeof r.jobTitle === "string" ? r.jobTitle : "",
              };
            })
            .filter((row: TeamMember) => row.id && row.name)
        : [];
      setMembers(normalizedMembers);
    })();
    return () => {
      cancelled = true;
    };
  }, [appraisalId]);

  if (!delegation) {
    return (
      <div className="rounded-ds-panel border border-ds-border bg-white p-5">
        <h3 className="text-[15px] font-semibold text-ds-text-primary">Delegate Access</h3>
        <p className="mt-1 text-[12px] text-ds-text-secondary">
          Allow a team member to manage this appraisal on your behalf. You will retain full access.
        </p>
        <div className="mt-4">
          <label className="mb-1 block text-[12px] font-medium text-ds-text-secondary">Select team member</label>
          <select
            value={selectedId}
            onChange={(e) => {
              const nextId = e.target.value;
              const found = members.find((m) => m.id === nextId);
              setSelectedId(found?.id ?? "");
              setSelectedName(found?.name ?? "");
            }}
            className="w-full rounded-[8px] border border-ds-border bg-white px-3 py-2 text-[13px] text-ds-text-primary"
          >
            <option value="">Select a team member...</option>
            {members.map((m) => (
              <option key={m.id} value={String(m.id)}>
                {m.name} {m.jobTitle ? `• ${m.jobTitle}` : ""}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          disabled={!selectedId || saving}
          onClick={async () => {
            if (!selectedId) return;
            console.log("delegation payload", {
              delegated_to: selectedId,
              delegated_to_name: selectedName,
            });
            setSaving(true);
            try {
              const res = await fetch(`/api/appraisals/${appraisalId}/delegation`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  delegated_to: selectedId,
                  delegated_to_name: selectedName,
                }),
              });
              const data = await res.json().catch(() => ({}));
              if (!res.ok) throw new Error(data.error || "Failed to assign delegate");
              setDelegation(data.delegation ?? null);
              setSelectedId("");
              setSelectedName("");
            } catch (err) {
              alert(err instanceof Error ? err.message : "Failed to assign delegate");
            } finally {
              setSaving(false);
            }
          }}
          className="mt-4 rounded-[8px] bg-ds-text-primary px-4 py-2 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Assigning..." : "Assign Delegate"}
        </button>
      </div>
    );
  }

  const member = members.find((m) => m.id === delegation.delegated_to);
  const delegateName = delegation.delegated_to_name || member?.name || "Delegate";
  const delegateTitle = member?.jobTitle ?? "";
  const delegatedOn = new Date(delegation.created_at).toLocaleDateString();

  return (
    <div className="rounded-ds-panel border border-ds-border bg-white p-5">
      <h3 className="text-[15px] font-semibold text-ds-text-primary">Delegate Access</h3>
      <div className="mt-4 flex items-start gap-3 rounded-ds-panel border border-ds-border bg-ds-surface p-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold"
          style={avatarAccent(delegateName).style}
        >
          {initials(delegateName)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-ds-text-primary">{delegateName}</p>
          <p className="text-[12px] text-ds-text-secondary">{delegateTitle || "Team member"}</p>
          <p className="mt-1 text-[11px] text-ds-text-secondary">Delegated on {delegatedOn}</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-ds-badge border border-ds-lavender-border bg-ds-lavender-subtle px-2 py-0.5 text-[10px] font-semibold text-ds-lavender-text">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-ds-lavender" />
          Active
        </span>
      </div>
      <button
        type="button"
        disabled={removing}
        onClick={async () => {
          const ok = window.confirm(
            `Remove ${delegateName} as delegate? They will immediately lose access to this appraisal.`
          );
          if (!ok) return;
          setRemoving(true);
          try {
            const res = await fetch(`/api/appraisals/${appraisalId}/delegation`, { method: "DELETE" });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || "Failed to remove delegate");
            setDelegation(null);
          } catch (err) {
            alert(err instanceof Error ? err.message : "Failed to remove delegate");
          } finally {
            setRemoving(false);
          }
        }}
        className="mt-4 rounded-[8px] px-2 py-1 text-[12px] font-semibold text-ds-error hover:bg-ds-error-subtle"
      >
        {removing ? "Removing..." : "Remove Delegate"}
      </button>
    </div>
  );
}
