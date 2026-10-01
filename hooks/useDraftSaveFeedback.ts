"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ToastMessage } from "@/components/ui/toast";

export type DraftSaveState = "idle" | "saving" | "saved";
export type DraftSaveResult = { ok: true } | { ok: false; message: string };

export const DRAFT_SAVED_MS = 1800;

/**
 * Button state, toast and last-saved time around an existing save call. It does not change what
 * `save` sends; it only reports the outcome.
 */
export function useDraftSaveFeedback(success: { title: string; description: string }) {
  const [state, setState] = useState<DraftSaveState>("idle");
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const inFlight = useRef(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(savedTimer.current), []);

  const { title, description } = success;
  const run = useCallback(
    async (save: () => Promise<DraftSaveResult>) => {
      // A second click can land before React re-renders the disabled button.
      if (inFlight.current) return;
      inFlight.current = true;
      clearTimeout(savedTimer.current);
      setState("saving");
      try {
        const result = await save();
        if (result.ok) {
          setLastSavedAt(Date.now());
          setToast({ tone: "success", title, description });
          setState("saved");
          savedTimer.current = setTimeout(() => setState("idle"), DRAFT_SAVED_MS);
        } else {
          setState("idle");
          setToast({ tone: "error", title: "Draft not saved", description: result.message });
        }
      } catch (e) {
        setState("idle");
        setToast({ tone: "error", title: "Draft not saved", description: e instanceof Error ? e.message : "Request failed" });
      } finally {
        inFlight.current = false;
      }
    },
    [title, description]
  );

  const dismissToast = useCallback(() => setToast(null), []);

  return { state, toast, lastSavedAt, run, dismissToast };
}
