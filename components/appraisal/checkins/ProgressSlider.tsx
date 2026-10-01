"use client";

interface ProgressSliderProps {
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
}

export function ProgressSlider({ value, onChange, disabled }: ProgressSliderProps) {
  const n = Math.min(100, Math.max(0, Number(value) || 0));
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 relative h-2 rounded-full bg-ds-surface border border-ds-border overflow-hidden">
        <div
          className="h-full rounded-full transition-[width]"
          style={{ width: `${n}%`, background: "#0d0e10" }}
        />
        <input
          type="range"
          min={0}
          max={100}
          value={n}
          onChange={(e) => onChange(Number(e.target.value))}
          disabled={disabled}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
        />
      </div>
      <span
        className="text-[11px] font-semibold text-ds-text-primary w-8 text-right flex-shrink-0"
        style={{ fontFamily: "var(--ds-font-sans)" }}
      >
        {n}%
      </span>
    </div>
  );
}
