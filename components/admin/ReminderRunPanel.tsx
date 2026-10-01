"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CardWrapper } from "./admin-shared";

type DryRunReminder = {
  appraisalId: string;
  employeeName: string;
  kind: string;
  kindLabel: string;
  recipientRole: string;
  dueDate: string | null;
  offset: string;
};

type UpcomingReminder = {
  appraisalId: string;
  employeeName: string;
  reviewType: string;
  kind: string;
  label: string;
  recipientRole: string;
  scheduledDate: string;
  scheduledDateLabel: string;
  offsetDays: number | null;
  timing: string;
};

type RunNotice = { title: string; message: string };

type RunSummary = {
  dryRun: boolean;
  date: string;
  appraisalsChecked: number;
  remindersPlanned: number;
  deliveriesDue: number;
  sent: number;
  skipped: number;
  failed: number;
  retriesScheduled: number;
  deferred: number;
  warnings: string[];
  notices?: RunNotice[];
  reminders?: DryRunReminder[];
  nextEligibleReminder?: UpcomingReminder | null;
  upcomingReminders?: UpcomingReminder[];
};

const roleLabel = (role: string) => (role === "manager" ? "Manager" : "Employee");

const API = "/api/cron/appraisal-reminders";

const BellIcon = () => (
  <svg style={{ width: 16, height: 16 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function runSummaryLine(s: RunSummary): string {
  return [
    `${plural(s.appraisalsChecked, "appraisal")} checked`,
    `${plural(s.sent, "reminder")} sent`,
    `${s.skipped} skipped`,
    `${s.failed} failed`,
  ].join(" · ");
}

export function ReminderRunPanel() {
  const [busy, setBusy] = useState<"preview" | "run" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [preview, setPreview] = useState<RunSummary | null>(null);
  const [result, setResult] = useState<RunSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const call = async (dryRun: boolean): Promise<RunSummary> => {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dryRun }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(typeof data.error === "string" && data.error ? data.error : "The reminder check could not be completed.");
    return data as RunSummary;
  };

  const runPreview = async () => {
    setBusy("preview");
    setError(null);
    setResult(null);
    try {
      setPreview(await call(true));
    } catch (e) {
      setPreview(null);
      setError(e instanceof Error ? e.message : "The reminder check could not be completed.");
    } finally {
      setBusy(null);
    }
  };

  const runNow = async () => {
    setConfirming(false);
    setBusy("run");
    setError(null);
    try {
      setResult(await call(false));
      setPreview(null);
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "The reminder check could not be completed.");
    } finally {
      setBusy(null);
    }
  };

  const warnings = (result ?? preview)?.warnings ?? [];
  const notices = (result ?? preview)?.notices ?? [];
  const upcoming = preview?.upcomingReminders ?? (preview?.nextEligibleReminder ? [preview.nextEligibleReminder] : []);

  return (
    <CardWrapper
      title="Appraisal reminders"
      subtitle="Reminders run automatically once a day. Preview what today's run would send, or run the check now. Each reminder is sent at most once."
      icon={<BellIcon />}
      iconBg="#f1f4f7"
      iconColor="#3d5a78"
    >
      <div className="space-y-5 px-6 py-5" data-reminder-run>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" onClick={runPreview} disabled={busy !== null} data-reminder-preview-action>
            {busy === "preview" ? "Checking…" : "Preview reminder run"}
          </Button>
          {!confirming ? (
            <Button type="button" onClick={() => setConfirming(true)} disabled={busy !== null} data-reminder-run-action>
              {busy === "run" ? "Running…" : "Run reminder check"}
            </Button>
          ) : (
            <span className="flex flex-wrap items-center gap-2 rounded-md border border-ds-border px-3 py-2 text-sm" data-reminder-confirm>
              <span className="text-ds-text-primary">Send due reminders to employees and managers now?</span>
              <Button type="button" size="sm" onClick={runNow} data-reminder-confirm-action>
                Send reminders
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </span>
          )}
        </div>
        <p className="text-xs text-ds-text-secondary">
          Preview only lists reminders. It sends no email, creates no notification and records nothing.
        </p>

        {error && (
          <p className="text-sm text-ds-error" data-reminder-error>
            {error}
          </p>
        )}

        {notices.map((n) => (
          <p key={n.title} className="rounded-md border border-ds-border bg-ds-surface px-3 py-2 text-xs text-ds-text-secondary" data-reminder-notice>
            <span className="font-semibold text-ds-text-primary">{n.title}</span>
            <span className="mx-1.5" aria-hidden>
              ·
            </span>
            {n.message}
          </p>
        ))}

        {warnings.length > 0 && (
          <ul className="space-y-1 rounded-md border border-ds-warning-border bg-ds-warning-subtle px-3 py-2 text-xs text-ds-warning" data-reminder-warnings>
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}

        {result && (
          <div className="space-y-1 rounded-ds-panel border border-ds-border p-4" data-reminder-result>
            <p className="text-sm font-semibold text-ds-text-primary" data-reminder-summary>
              {runSummaryLine(result)}
            </p>
            {result.retriesScheduled > 0 && (
              <p className="text-xs text-ds-text-secondary">
                {plural(result.retriesScheduled, "failed reminder")} will be retried automatically.
              </p>
            )}
            {result.deferred > 0 && (
              <p className="text-xs text-ds-text-secondary">
                {plural(result.deferred, "reminder")} will be sent on the next run.
              </p>
            )}
          </div>
        )}

        {preview && (
          <div className="space-y-3" data-reminder-preview>
            <p className="text-sm text-ds-text-primary" data-reminder-preview-summary>
              {plural(preview.appraisalsChecked, "appraisal")} checked · {plural(preview.remindersPlanned, "reminder")} due today
            </p>
            {preview.reminders && preview.reminders.length > 0 ? (
              <div className="overflow-x-auto rounded-ds-panel border border-ds-border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-ds-surface text-xs uppercase tracking-wide text-ds-text-secondary">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Employee</th>
                      <th className="px-3 py-2 font-semibold">Reminder</th>
                      <th className="px-3 py-2 font-semibold">Recipient</th>
                      <th className="px-3 py-2 font-semibold">Due date</th>
                      <th className="px-3 py-2 font-semibold">Timing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.reminders.map((r) => (
                      <tr key={`${r.appraisalId}-${r.kind}-${r.recipientRole}`} className="border-t border-ds-border" data-reminder-row>
                        <td className="px-3 py-2 text-ds-text-primary">{r.employeeName}</td>
                        <td className="px-3 py-2 text-ds-text-primary">{r.kindLabel}</td>
                        <td className="px-3 py-2 text-ds-text-secondary">{r.recipientRole === "manager" ? "Manager" : "Employee"}</td>
                        <td className="px-3 py-2 text-ds-text-secondary">{r.dueDate ?? "—"}</td>
                        <td className="px-3 py-2 text-ds-text-secondary">{r.offset}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <>
                <p className="text-sm text-ds-text-secondary" data-reminder-preview-empty>
                  No reminders are scheduled for today.
                </p>
                {upcoming.length > 0 && (
                  <div className="rounded-ds-panel border border-ds-border bg-ds-surface px-4 py-3" data-reminder-next>
                    <p className="text-xs font-semibold uppercase tracking-wide text-ds-text-secondary">
                      {upcoming.length === 1 ? "Next eligible reminder" : "Next eligible reminders"}
                    </p>
                    <ul className="mt-2 space-y-2">
                      {upcoming.map((u) => (
                        <li key={`${u.appraisalId}-${u.kind}`} data-reminder-next-item>
                          <p className="text-sm font-medium text-ds-text-primary" data-reminder-next-title>
                            {u.reviewType}
                            <span className="font-normal text-ds-text-secondary"> · {u.employeeName}</span>
                          </p>
                          <p className="text-xs text-ds-text-secondary" data-reminder-next-detail>
                            {roleLabel(u.recipientRole)} · {u.scheduledDateLabel} · {u.timing}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </CardWrapper>
  );
}
