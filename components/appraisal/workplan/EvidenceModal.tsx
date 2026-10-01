"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ExternalLink, Trash2 } from "lucide-react";
import { getFileIcon } from "./evidence-icons";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const ACCEPT =
  ".pdf,.doc,.docx,.xls,.xlsx,.zip,.jpg,.jpeg,.png,.gif,.webp,.txt,.csv";

export interface WorkplanItemForEvidence {
  id: string;
  major_task: string;
  corporate_objective?: string;
}

export interface EvidenceItem {
  id: string;
  evidence_type: "FILE" | "LINK" | "NOTE";
  file_name?: string | null;
  file_size?: number | null;
  file_type?: string | null;
  storage_path?: string | null;
  link_url?: string | null;
  link_title?: string | null;
  note_text?: string | null;
  signed_url?: string;
  created_at?: string;
  can_delete?: boolean;
}

interface EvidenceModalProps {
  workplanItem: WorkplanItemForEvidence;
  appraisalId: string;
  role: "EMPLOYEE" | "MANAGER" | "HR";
  onClose: () => void;
  onSaved?: () => void;
}

export function EvidenceModal({
  workplanItem,
  appraisalId,
  role,
  onClose,
  onSaved,
}: EvidenceModalProps) {
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"file" | "link" | "note">("file");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const [noteText, setNoteText] = useState("");
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const isEmployee = role === "EMPLOYEE";
  const itemId = workplanItem.id;

  const fetchEvidence = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/appraisals/${appraisalId}/workplan/${itemId}/evidence`
      );
      const data = await res.json();
      if (res.ok && Array.isArray(data?.evidence)) {
        setEvidence(data.evidence);
      } else {
        setEvidence([]);
      }
    } catch {
      setEvidence([]);
    } finally {
      setLoading(false);
    }
  }, [appraisalId, itemId]);

  useEffect(() => {
    fetchEvidence();
  }, [fetchEvidence]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setFileError(null);
      const files = Array.from(e.dataTransfer.files);
      const valid: File[] = [];
      for (const f of files) {
        if (f.size > MAX_FILE_SIZE) {
          setFileError("All files must be 20MB or less");
          continue;
        }
        valid.push(f);
      }
      setPendingFiles((prev) => [...prev, ...valid]);
    },
    []
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setFileError(null);
      const files = Array.from(e.target.files ?? []);
      const valid: File[] = [];
      for (const f of files) {
        if (f.size > MAX_FILE_SIZE) {
          setFileError("All files must be 20MB or less");
          continue;
        }
        valid.push(f);
      }
      setPendingFiles((prev) => [...prev, ...valid]);
      e.target.value = "";
    },
    []
  );

  const removePending = useCallback((index: number) => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const saveLink = useCallback(async () => {
    const url = linkUrl.trim();
    if (!url) return;
    setSaving(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("evidence_type", "LINK");
      form.set("link_url", url);
      form.set("link_title", linkTitle.trim());
      const res = await fetch(
        `/api/appraisals/${appraisalId}/workplan/${itemId}/evidence`,
        { method: "POST", body: form }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to add link");
      setLinkUrl("");
      setLinkTitle("");
      await fetchEvidence();
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add link");
    } finally {
      setSaving(false);
    }
  }, [appraisalId, itemId, linkUrl, linkTitle, fetchEvidence, onSaved]);

  const saveNote = useCallback(async () => {
    const text = noteText.trim();
    if (!text) return;
    setSaving(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("evidence_type", "NOTE");
      form.set("note_text", text);
      const res = await fetch(
        `/api/appraisals/${appraisalId}/workplan/${itemId}/evidence`,
        { method: "POST", body: form }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Failed to add note");
      setNoteText("");
      await fetchEvidence();
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add note");
    } finally {
      setSaving(false);
    }
  }, [appraisalId, itemId, noteText, fetchEvidence, onSaved]);

  const uploadPendingFiles = useCallback(async () => {
    if (pendingFiles.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      for (const file of pendingFiles) {
        const form = new FormData();
        form.set("evidence_type", "FILE");
        form.set("file", file);
        const res = await fetch(
          `/api/appraisals/${appraisalId}/workplan/${itemId}/evidence`,
          { method: "POST", body: form }
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? "Failed to upload");
      }
      setPendingFiles([]);
      await fetchEvidence();
      onSaved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setSaving(false);
    }
  }, [appraisalId, itemId, pendingFiles, fetchEvidence, onSaved]);

  const deleteEvidence = useCallback(
    async (evidenceId: string) => {
      try {
        const res = await fetch(
          `/api/appraisals/${appraisalId}/workplan/${itemId}/evidence/${evidenceId}`,
          { method: "DELETE" }
        );
        if (!res.ok) throw new Error("Failed to delete");
        await fetchEvidence();
        onSaved?.();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Delete failed");
      }
    },
    [appraisalId, itemId, fetchEvidence, onSaved]
  );

  const handleSaveEvidence = useCallback(async () => {
    if (pendingFiles.length > 0) await uploadPendingFiles();
    onClose();
  }, [pendingFiles.length, uploadPendingFiles, onClose]);

  const openItem = useCallback(
    (item: EvidenceItem) => {
      if (item.evidence_type === "FILE" && item.signed_url) {
        window.open(item.signed_url, "_blank");
      } else if (item.evidence_type === "LINK" && item.link_url) {
        window.open(item.link_url, "_blank");
      }
    },
    []
  );

  const title = isEmployee
    ? `Attach evidence — ${workplanItem.major_task || "Objective"}`
    : `Evidence — ${workplanItem.major_task || "Objective"}`;
  const subtitle = isEmployee
    ? workplanItem.corporate_objective || ""
    : `${evidence.length} files · Read only`;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg" showClose={true}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {subtitle && (
            <p className="text-sm text-ds-text-secondary">{subtitle}</p>
          )}
        </DialogHeader>

        {error && (
          <div className="rounded-lg border border-ds-error-border bg-ds-error-subtle px-3 py-2 text-sm text-ds-error">
            {error}
          </div>
        )}

        {isEmployee ? (
          <>
            <div className="flex gap-1 border-b border-ds-border">
              {(["file", "link", "note"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`rounded-t px-3 py-2 text-xs font-semibold capitalize ${
                    activeTab === tab
                      ? "border border-b-0 border-ds-border bg-white text-ds-text-primary"
                      : "text-ds-text-secondary hover:text-ds-text-primary"
                  }`}
                >
                  {tab === "file" ? "Upload file" : tab === "link" ? "Add link" : "Add note"}
                </button>
              ))}
            </div>

            {activeTab === "file" && (
              <div className="space-y-3 py-3">
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleDrop}
                  className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-ds-border bg-ds-surface py-8 text-center"
                >
                  <input
                    type="file"
                    accept={ACCEPT}
                    multiple
                    onChange={handleFileInput}
                    className="hidden"
                    id="evidence-file-input"
                  />
                  <label
                    htmlFor="evidence-file-input"
                    className="cursor-pointer text-sm text-ds-accent font-medium hover:underline"
                  >
                    Drop files or click to browse
                  </label>
                  <p className="mt-1 text-[10px] text-ds-text-secondary">
                    PDF, Word, Excel, images, ZIP, TXT, CSV. Max 20MB each.
                  </p>
                  {fileError && (
                    <p className="mt-1 text-xs text-ds-error">{fileError}</p>
                  )}
                </div>
                {pendingFiles.length > 0 && (
                  <ul className="space-y-1">
                    {pendingFiles.map((f, i) => (
                      <li
                        key={i}
                        className="flex items-center justify-between rounded bg-ds-surface px-2 py-1.5 text-xs"
                      >
                        <span className="truncate">{f.name}</span>
                        <span className="text-ds-text-secondary">
                          {(f.size / 1024).toFixed(1)} KB
                        </span>
                        <button
                          type="button"
                          onClick={() => removePending(i)}
                          className="text-ds-error hover:underline"
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {evidence.filter((e) => e.evidence_type === "FILE").length > 0 && (
                  <div>
                    <p className="text-[10px] font-semibold uppercase text-ds-text-secondary mb-1">
                      Saved files
                    </p>
                    <ul className="space-y-1">
                      {evidence
                        .filter((e) => e.evidence_type === "FILE")
                        .map((e) => (
                          <li
                            key={e.id}
                            className="flex items-center justify-between rounded border border-ds-border px-2 py-1.5 text-xs"
                          >
                            <span className="truncate">{e.file_name ?? "File"}</span>
                            <span className="text-ds-text-secondary">
                              {e.file_size != null
                                ? `${(e.file_size / 1024).toFixed(1)} KB`
                                : ""}
                            </span>
                            <div className="flex gap-1 items-center">
                              <button
                                type="button"
                                onClick={() => openItem(e)}
                                className="text-ds-accent hover:opacity-80 p-0.5"
                                title="Open"
                                aria-label="Open"
                              >
                                <ExternalLink className="h-3.5 w-3.5" />
                              </button>
                              {e.can_delete && (
                                <button
                                  type="button"
                                  onClick={() => deleteEvidence(e.id)}
                                  className="text-ds-error hover:opacity-80 p-0.5"
                                  title="Delete"
                                  aria-label="Delete"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </li>
                        ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {activeTab === "link" && (
              <div className="space-y-3 py-3">
                <div className="grid gap-2">
                  <Label htmlFor="link-url">URL</Label>
                  <Input
                    id="link-url"
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    placeholder="https://..."
                  />
                  <Label htmlFor="link-title">Title (optional)</Label>
                  <Input
                    id="link-title"
                    value={linkTitle}
                    onChange={(e) => setLinkTitle(e.target.value)}
                    placeholder="Link title"
                  />
                  <Button
                    size="sm"
                    onClick={saveLink}
                    disabled={saving || !linkUrl.trim()}
                  >
                    Save link
                  </Button>
                </div>
                {evidence.filter((e) => e.evidence_type === "LINK").length > 0 && (
                  <ul className="space-y-1">
                    {evidence
                      .filter((e) => e.evidence_type === "LINK")
                      .map((e) => (
                        <li
                          key={e.id}
                          className="flex items-center justify-between rounded border border-ds-border px-2 py-1.5 text-xs"
                        >
                          <a
                            href={e.link_url ?? "#"}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-ds-accent hover:underline truncate"
                          >
                            {e.link_title || e.link_url || "Link"}
                          </a>
                          {e.can_delete && (
                            <button
                              type="button"
                              onClick={() => deleteEvidence(e.id)}
                              className="text-ds-error hover:opacity-80 shrink-0 p-0.5"
                              title="Delete"
                              aria-label="Delete"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            )}

            {activeTab === "note" && (
              <div className="space-y-3 py-3">
                <div>
                  <Label htmlFor="note-text">Note</Label>
                  <textarea
                    id="note-text"
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    className="mt-1 w-full rounded border border-ds-border px-2 py-1.5 text-sm min-h-[80px]"
                    placeholder="Add a note..."
                  />
                  <Button
                    size="sm"
                    className="mt-2"
                    onClick={saveNote}
                    disabled={saving || !noteText.trim()}
                  >
                    Save note
                  </Button>
                </div>
                {evidence.filter((e) => e.evidence_type === "NOTE").length > 0 && (
                  <ul className="space-y-1">
                    {evidence
                      .filter((e) => e.evidence_type === "NOTE")
                      .map((e) => (
                        <li
                          key={e.id}
                          className="rounded border border-ds-border px-2 py-1.5 text-xs"
                        >
                          <p className="whitespace-pre-wrap">{e.note_text}</p>
                          {e.can_delete && (
                            <button
                              type="button"
                              onClick={() => deleteEvidence(e.id)}
                              className="mt-1 text-ds-error hover:opacity-80 p-0.5 inline-flex"
                              title="Delete"
                              aria-label="Delete"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            )}

            <div className="flex items-center justify-between border-t border-ds-border pt-3">
              <span className="text-[10px] text-ds-text-secondary">
                Files are linked to this objective only
              </span>
              <div className="flex gap-2">
                <Button variant="outline" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  onClick={handleSaveEvidence}
                  disabled={saving}
                >
                  {saving ? "Saving…" : "Save evidence"}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <>
            {evidence.length === 0 ? (
              <p className="py-4 text-sm text-ds-text-secondary">No evidence attached</p>
            ) : (
              <ul className="space-y-2 py-2">
                {evidence.map((e) => {
                  const icon = getFileIcon(e.file_type ?? null);
                  const label =
                    e.evidence_type === "FILE"
                      ? e.file_name ?? "File"
                      : e.evidence_type === "LINK"
                        ? e.link_title || e.link_url || "Link"
                        : (e.note_text ?? "Note").slice(0, 50) + (e.note_text && e.note_text.length > 50 ? "…" : "");
                  const canOpen =
                    (e.evidence_type === "FILE" && e.signed_url) ||
                    (e.evidence_type === "LINK" && e.link_url);
                  return (
                    <li
                      key={e.id}
                      className="flex items-center justify-between rounded border border-ds-border px-3 py-2 text-sm"
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span
                          className="h-8 w-8 shrink-0 rounded flex items-center justify-center text-xs font-semibold"
                          style={{
                            background: icon.bg,
                            border: `1px solid ${icon.border}`,
                            color: icon.stroke,
                          }}
                        >
                          {icon.icon === "pdf" ? "PDF" : icon.icon === "doc" ? "DOC" : icon.icon === "image" ? "IMG" : icon.icon === "archive" ? "ZIP" : "•"}
                        </span>
                        {e.evidence_type === "NOTE" ? (
                          <p className="whitespace-pre-wrap text-xs min-w-0">{e.note_text ?? ""}</p>
                        ) : (
                          <span className="truncate">{label}</span>
                        )}
                      </div>
                      {canOpen && (
                        <a
                          href={
                            e.evidence_type === "FILE"
                              ? e.signed_url
                              : e.link_url ?? "#"
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className="shrink-0 text-ds-accent hover:underline ml-2"
                        >
                          <span className="sr-only">Open</span>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                            <polyline points="15 3 21 3 21 9" />
                            <line x1="10" y1="14" x2="21" y2="3" />
                          </svg>
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="flex justify-end border-t border-ds-border pt-3">
              <Button onClick={onClose}>Close</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
