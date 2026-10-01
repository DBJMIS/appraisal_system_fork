"use client";

import { useState } from "react";

export function CreateMissingClient({ employeeIds }: { employeeIds: string[] }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/appraisals/create-missing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employee_ids: employeeIds }),
      });
      const data = (await res.json().catch(() => ({}))) as { created?: number; skipped?: number; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to create appraisals");
        return;
      }
      setResult({ created: data.created ?? 0, skipped: data.skipped ?? 0 });
    } catch {
      setError("Failed to create appraisals");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <button
        onClick={run}
        disabled={running || employeeIds.length === 0}
        className="rounded-[8px] px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-60"
        style={{ background: "#8a5a00" }}
      >
        {running ? "Creating…" : `Create missing appraisals (${employeeIds.length})`}
      </button>

      {result && (
        <p className="text-[13px]" style={{ color: "#2e7d4f" }}>
          Completed. Created {result.created}, skipped {result.skipped}.
        </p>
      )}
      {error && (
        <p className="text-[13px]" style={{ color: "#b42318" }}>
          {error}
        </p>
      )}
    </div>
  );
}
