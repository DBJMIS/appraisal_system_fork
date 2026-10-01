"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";

const PlanIcon = () => (
  <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
  </svg>
);

export default function AchieveItPage() {
  const [data, setData] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch("/api/achieveit/plan?skip=0&take=100")
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText);
        return res.json();
      })
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load plan");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        icon={<PlanIcon />}
        title="AchieveIt Plan"
        subtitle="Plan export from AchieveIt API"
      />

      {loading && (
        <div className="rounded-ds-panel border border-border bg-surface p-6 text-center text-text-muted">
          Loading plan…
        </div>
      )}

      {error && (
        <div className="rounded-ds-panel border border-ds-error-border bg-ds-error-subtle p-4 text-ds-error dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">
          {error}
        </div>
      )}

      {!loading && !error && data !== null && (
        <div className="rounded-ds-panel border border-border bg-surface overflow-hidden">
          {Array.isArray(data) ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    {data.length > 0 &&
                      Object.keys(data[0] as object).map((key) => (
                        <th key={key} className="px-4 py-3 font-medium text-text-primary">
                          {key}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {data.map((row, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      {Object.values(row as object).map((val, j) => (
                        <td key={j} className="px-4 py-3 text-text-secondary">
                          {val != null && typeof val === "object" ? JSON.stringify(val) : String(val)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : typeof data === "object" && data !== null && "items" in data && Array.isArray((data as { items: unknown[] }).items) ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    {(data as { items: Record<string, unknown>[] }).items.length > 0 &&
                      Object.keys((data as { items: Record<string, unknown>[] }).items[0]).map((key) => (
                        <th key={key} className="px-4 py-3 font-medium text-text-primary">
                          {key}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {(data as { items: Record<string, unknown>[] }).items.map((row, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      {Object.values(row).map((val, j) => (
                        <td key={j} className="px-4 py-3 text-text-secondary">
                          {val != null && typeof val === "object" ? JSON.stringify(val) : String(val)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <pre className="p-4 text-sm text-text-secondary overflow-x-auto">
              {JSON.stringify(data, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
