"use client";

import { useId, useState, type InputHTMLAttributes } from "react";

/**
 * Parses what the user has typed so far.
 * - `null`: the field is empty (no value entered — never 0)
 * - `undefined`: an incomplete entry such as "-" or "." that should not replace the stored value yet
 * - number: a complete finite value
 */
export function parseNumericDraft(raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

type NativeInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "min" | "max">;

export interface NumericDraftInputProps extends NativeInputProps {
  value: number | null | undefined;
  onValueChange: (value: number | null) => void;
  min?: number;
  max?: number;
  /** Clamp the stored value into [min, max]. The typed text is left alone until blur. */
  clamp?: boolean;
  showRangeHint?: boolean;
}

/**
 * Number input that keeps the typed text as a string while focused, so multi-digit entry,
 * select-and-replace and clearing to empty behave naturally. The parsed value is reported on
 * every complete keystroke; the text resyncs to the stored value on blur.
 */
export function NumericDraftInput({
  value,
  onValueChange,
  min,
  max,
  clamp = false,
  showRangeHint = true,
  onFocus,
  onBlur,
  ...rest
}: NumericDraftInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const hintId = useId();
  const display = draft ?? (value == null || Number.isNaN(value) ? "" : String(value));

  const parsedDraft = draft == null ? undefined : parseNumericDraft(draft);
  const outOfRange =
    typeof parsedDraft === "number" && ((min != null && parsedDraft < min) || (max != null && parsedDraft > max));

  const toStored = (n: number) => {
    if (!clamp) return n;
    let v = n;
    if (max != null) v = Math.min(max, v);
    if (min != null) v = Math.max(min, v);
    return v;
  };

  return (
    <>
      <input
        {...rest}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        value={display}
        aria-invalid={outOfRange || undefined}
        aria-describedby={outOfRange && showRangeHint ? hintId : rest["aria-describedby"]}
        data-numeric-draft
        onFocus={(e) => {
          setDraft(display);
          onFocus?.(e);
        }}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "" && e.target.validity?.badInput) return;
          setDraft(raw);
          const parsed = parseNumericDraft(raw);
          if (parsed === undefined) return;
          onValueChange(parsed == null ? null : toStored(parsed));
        }}
        onBlur={(e) => {
          setDraft(null);
          onBlur?.(e);
        }}
      />
      {outOfRange && showRangeHint && (
        <span id={hintId} data-numeric-range-hint className="mt-0.5 block basis-full text-[11px] text-ds-warning">
          {min != null && max != null ? `Enter a value from ${min} to ${max}` : max != null ? `Maximum is ${max}` : `Minimum is ${min}`}
        </span>
      )}
    </>
  );
}
