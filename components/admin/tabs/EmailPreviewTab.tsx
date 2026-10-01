"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAdminPanel } from "../AdminPanelContext";
import { CardWrapper } from "../admin-shared";
import { formatCycleLabel } from "@/lib/midyear-config";

type KindOption = { kind: string; label: string; recipientRole: "employee" | "manager" };
type AppraisalOption = { id: string; label: string };
type Preview = { subject: string; text: string; html: string; recipientRole: "employee" | "manager"; warnings: string[] };
type SendResult = { ok: boolean; message: string };

const API = "/api/admin/email-preview";
const selectClass = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

const MailIcon = () => (
  <svg style={{ width: 16, height: 16 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m22 7-10 6L2 7" />
  </svg>
);

const roleLabel = (role: "employee" | "manager") => (role === "manager" ? "Manager" : "Employee");

async function errorMessage(res: Response, fallback: string): Promise<string> {
  const data = await res.json().catch(() => ({}));
  return typeof data.error === "string" && data.error ? data.error : fallback;
}

export function EmailPreviewTab() {
  const { cycles } = useAdminPanel();
  const [cycleId, setCycleId] = useState<string>(() => cycles.find((c) => c.status === "open")?.id ?? cycles[0]?.id ?? "");
  const [kinds, setKinds] = useState<KindOption[]>([]);
  const [appraisals, setAppraisals] = useState<AppraisalOption[]>([]);
  const [appUrlWarning, setAppUrlWarning] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [kind, setKind] = useState("");
  const [appraisalId, setAppraisalId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<SendResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    setListError(null);
    setAppraisals([]);
    setAppraisalId("");
    fetch(cycleId ? `${API}?cycleId=${encodeURIComponent(cycleId)}` : API)
      .then(async (res) => {
        if (!res.ok) throw new Error(await errorMessage(res, "Could not load appraisals."));
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        setKinds(Array.isArray(data.kinds) ? data.kinds : []);
        setAppraisals(Array.isArray(data.appraisals) ? data.appraisals : []);
        setAppUrlWarning(typeof data.appUrl?.warning === "string" ? data.appUrl.warning : null);
      })
      .catch((e) => !cancelled && setListError(e instanceof Error ? e.message : "Could not load appraisals."));
    return () => {
      cancelled = true;
    };
  }, [cycleId]);

  useEffect(() => {
    setPreview(null);
    setPreviewError(null);
    setSendResult(null);
  }, [kind, appraisalId]);

  const ready = !!kind && !!appraisalId;

  const runPreview = async () => {
    if (!ready) return;
    setPreviewing(true);
    setPreviewError(null);
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, appraisalId }),
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Could not render the preview."));
      setPreview((await res.json()) as Preview);
    } catch (e) {
      setPreview(null);
      setPreviewError(e instanceof Error ? e.message : "Could not render the preview.");
    } finally {
      setPreviewing(false);
    }
  };

  const sendTest = async () => {
    if (!ready || !testTo.trim()) return;
    setSending(true);
    setSendResult(null);
    try {
      const res = await fetch("/api/admin/test-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: testTo.trim(), kind, appraisalId }),
      });
      if (!res.ok) throw new Error(await errorMessage(res, "The test email could not be sent."));
      setSendResult({ ok: true, message: `Test copy sent to ${testTo.trim()} via Microsoft Graph.` });
    } catch (e) {
      setSendResult({ ok: false, message: e instanceof Error ? e.message : "The test email could not be sent." });
    } finally {
      setSending(false);
    }
  };

  return (
    <CardWrapper
      title="Email preview"
      subtitle="Preview appraisal notification emails and send a test copy to a test mailbox. Employees and managers are never emailed from here."
      icon={<MailIcon />}
      iconBg="#f1f4f7"
      iconColor="#3d5a78"
    >
      <div className="space-y-6 px-6 py-5" data-email-preview>
        {appUrlWarning && (
          <p className="rounded-md border border-ds-warning-border bg-ds-warning-subtle px-3 py-2 text-xs text-ds-warning" data-app-url-warning>
            {appUrlWarning}
          </p>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="email-preview-cycle">Cycle</Label>
            <select id="email-preview-cycle" className={selectClass} value={cycleId} onChange={(e) => setCycleId(e.target.value)}>
              <option value="">Select cycle</option>
              {cycles.map((c) => (
                <option key={c.id} value={c.id}>
                  {formatCycleLabel(c.name)}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email-preview-appraisal">Appraisal</Label>
            <select
              id="email-preview-appraisal"
              className={selectClass}
              value={appraisalId}
              onChange={(e) => setAppraisalId(e.target.value)}
              disabled={!cycleId || appraisals.length === 0}
            >
              <option value="">{cycleId && appraisals.length === 0 ? "No appraisals in this cycle" : "Select appraisal"}</option>
              {appraisals.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="email-preview-kind">Notification type</Label>
            <select id="email-preview-kind" className={selectClass} value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">Select notification type</option>
              {kinds.map((k) => (
                <option key={k.kind} value={k.kind}>
                  {k.label} ({roleLabel(k.recipientRole).toLowerCase()})
                </option>
              ))}
            </select>
          </div>
        </div>

        {listError && <p className="text-sm text-ds-error">{listError}</p>}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={runPreview} disabled={!ready || previewing} data-preview-action>
            {previewing ? "Rendering…" : "Preview email"}
          </Button>
          <span className="text-xs text-ds-text-secondary">Preview renders the email only. Nothing is sent or recorded.</span>
        </div>
        {previewError && <p className="text-sm text-ds-error" data-preview-error>{previewError}</p>}

        {preview && (
          <div className="space-y-4 rounded-ds-panel border border-ds-border p-4" data-preview-result>
            <dl className="grid gap-3 text-sm sm:grid-cols-[120px_1fr]">
              <dt className="text-ds-text-secondary">Subject</dt>
              <dd className="font-semibold text-ds-text-primary" data-preview-subject>{preview.subject}</dd>
              <dt className="text-ds-text-secondary">Recipient role</dt>
              <dd className="text-ds-text-primary" data-preview-role>{roleLabel(preview.recipientRole)}</dd>
            </dl>
            {preview.warnings.length > 0 && (
              <ul className="space-y-1 rounded-md border border-ds-warning-border bg-ds-warning-subtle px-3 py-2 text-xs text-ds-warning" data-preview-warnings>
                {preview.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-ds-text-secondary">HTML version</p>
              <iframe
                title="HTML email preview"
                sandbox=""
                srcDoc={preview.html}
                className="h-[560px] w-full rounded-md border border-ds-border bg-white"
                data-email-html-preview
              />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-ds-text-secondary">Text version</p>
              <pre className="whitespace-pre-wrap rounded-md border border-ds-border bg-ds-surface p-3 font-sans text-sm text-ds-text-primary" data-email-text-preview>
                {preview.text}
              </pre>
            </div>
          </div>
        )}

        <div className="space-y-3 border-t border-ds-border pt-5">
          <div className="space-y-2 md:max-w-md">
            <Label htmlFor="email-preview-test-to">Test email address</Label>
            <Input
              id="email-preview-test-to"
              type="email"
              autoComplete="off"
              placeholder="test mailbox address"
              value={testTo}
              onChange={(e) => {
                setTestTo(e.target.value);
                setSendResult(null);
              }}
            />
            <p className="text-xs text-ds-text-secondary">
              Sent only to this address, with a [TEST] subject prefix. The employee and manager are not emailed and no
              reminder is marked as delivered.
            </p>
          </div>
          <Button type="button" variant="outline" onClick={sendTest} disabled={!ready || !testTo.trim() || sending} data-send-test-action>
            {sending ? "Sending…" : "Send test copy"}
          </Button>
          {sendResult && (
            <p className={`text-sm ${sendResult.ok ? "text-ds-success" : "text-ds-error"}`} data-send-result={sendResult.ok ? "success" : "error"}>
              {sendResult.message}
            </p>
          )}
        </div>
      </div>
    </CardWrapper>
  );
}
