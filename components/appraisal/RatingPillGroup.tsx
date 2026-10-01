import { cn } from "@/lib/utils";

const GRADES = [
  { value: "A", label: "Highly\nExceeds" },
  { value: "B", label: "Exceeds\nExpects." },
  { value: "C", label: "Meets\nExpects." },
  { value: "D", label: "Below\nExpects." },
  { value: "E", label: "Far Below\nExpects." },
] as const;

export type Grade = (typeof GRADES)[number]["value"];

const gradeStyles: Record<Grade, { selected: string; ring: string }> = {
  A: {
    selected:
      "bg-ds-success-subtle border-ds-success shadow-[0_0_0_2px_rgba(5,150,105,0.15)]",
    ring: "text-ds-success",
  },
  B: {
    selected:
      "bg-ds-info-subtle border-ds-info shadow-[0_0_0_2px_rgba(37,99,235,0.15)]",
    ring: "text-ds-info",
  },
  C: {
    selected: "bg-ds-info-subtle border-ds-info shadow-[0_0_0_2px_rgba(2,132,199,0.15)]",
    ring: "text-ds-info",
  },
  D: {
    selected:
      "bg-ds-warning-subtle border-ds-warning shadow-[0_0_0_2px_rgba(217,119,6,0.15)]",
    ring: "text-ds-warning",
  },
  E: {
    selected: "bg-ds-error-subtle border-ds-error shadow-[0_0_0_2px_rgba(220,38,38,0.15)]",
    ring: "text-ds-error",
  },
};

export const gradeChipStyles: Record<Grade, string> = {
  A: "bg-ds-success-subtle text-ds-success",
  B: "bg-ds-info-subtle text-ds-info",
  C: "bg-ds-info-subtle text-ds-info",
  D: "bg-ds-warning-subtle text-ds-warning",
  E: "bg-ds-error-subtle text-ds-error",
};

const VALID_GRADES: Grade[] = ["A", "B", "C", "D", "E"];

/** 1-10 numeric rating codes (replaces A-E). */
export type RatingCode = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "10";

const VALID_RATING_CODES: RatingCode[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];

export function isGrade(value: string | null): value is RatingCode {
  return value != null && VALID_RATING_CODES.includes(value as RatingCode);
}

export function VarianceChip({
  selfRating,
  managerRating,
}: {
  selfRating: string | null;
  managerRating: string | null;
}) {
  if (!selfRating || !managerRating) return null;

  const selfNum = parseInt(selfRating, 10);
  const managerNum = parseInt(managerRating, 10);
  if (Number.isNaN(selfNum) || Number.isNaN(managerNum)) return null;

  const delta = managerNum - selfNum;
  if (delta === 0) return null;

  const isUp = delta > 0;
  const abs = Math.abs(delta);

  const colour = isUp
    ? "text-ds-success"
    : abs >= 3
      ? "text-ds-error"
      : abs === 2
        ? "text-ds-warning"
        : "text-ds-warning";

  return (
    <span className={cn("text-[10px] font-semibold tabular-nums leading-none", colour)}>
      {isUp ? "↑" : "↓"}
      {abs}
    </span>
  );
}

interface RatingPillGroupProps {
  name: string;
  value: Grade | null;
  onChange: (value: Grade) => void;
  disabled?: boolean;
}

export function RatingPillGroup({
  name,
  value,
  onChange,
  disabled = false,
}: RatingPillGroupProps) {
  return (
    <div className="flex gap-[5px] items-center">
      {GRADES.map((grade) => {
        const isSelected = value === grade.value;
        const styles = gradeStyles[grade.value];
        return (
          <label
            key={grade.value}
            className={cn(
              "flex flex-col items-center justify-center px-1 py-[7px] rounded-lg border-[1.5px] cursor-pointer",
              "min-w-[54px] flex-1 text-center select-none",
              "transition-all duration-150",
              isSelected
                ? styles.selected
                : "bg-white border-ds-border hover:border-ds-accent hover:bg-ds-surface",
              disabled && "opacity-50 cursor-not-allowed pointer-events-none"
            )}
          >
            <input
              type="radio"
              name={name}
              value={grade.value}
              checked={isSelected}
              onChange={() => !disabled && onChange(grade.value)}
              className="sr-only"
            />
            <span
              className={cn(
                'font-sans text-[13px] font-semibold leading-none mb-[3px]',
                isSelected ? styles.ring : "text-ds-text-primary"
              )}
            >
              {grade.value}
            </span>
            <span
              className={cn(
                "text-[9px] font-medium leading-[1.2] whitespace-pre-line",
                isSelected ? styles.ring : "text-ds-text-secondary"
              )}
            >
              {grade.label}
            </span>
          </label>
        );
      })}
    </div>
  );
}

const RATING_BAND_COLOR: Record<number, string> = {
  1: "bg-ds-error-subtle text-ds-error",
  2: "bg-ds-error-subtle text-ds-error",
  3: "bg-ds-warning-subtle text-ds-warning",
  4: "bg-ds-warning-subtle text-ds-warning",
  5: "bg-ds-warning-subtle text-ds-warning",
  6: "bg-ds-warning-subtle text-ds-warning",
  7: "bg-ds-success-subtle text-ds-success",
  8: "bg-ds-success-subtle text-ds-success",
  9: "bg-ds-success-subtle text-ds-success",
  10: "bg-ds-success-subtle text-ds-success",
};

interface RatingGradeChipProps {
  value: Grade | RatingCode | string | null;
  className?: string;
}

export function RatingGradeChip({ value, className }: RatingGradeChipProps) {
  if (value == null) {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center w-7 h-7 rounded-[6px] border-[1.5px] border-dashed border-ds-border text-ds-text-secondary text-base",
          className
        )}
      >
        —
      </span>
    );
  }
  if (isGrade(value)) {
    const n = parseInt(value, 10);
    const bandClass = !Number.isNaN(n) && n >= 1 && n <= 10 ? RATING_BAND_COLOR[n] : "bg-ds-surface text-ds-info";
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center w-7 h-7 rounded-[6px] font-sans text-[13px] font-semibold",
          bandClass,
          className
        )}
      >
        {value}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center w-7 h-7 rounded-[6px] border-[1.5px] border-dashed border-ds-border text-ds-text-secondary text-base",
        className
      )}
    >
      —
    </span>
  );
}

export function RatingLegend() {
  const items = [
    { range: "1–2", label: "Far below", color: "#b42318" },
    { range: "3–4", label: "Below", color: "#8a5a00" },
    { range: "5–6", label: "Meets", color: "#8a5a00" },
    { range: "7–8", label: "Exceeds", color: "#2e7d4f" },
    { range: "9–10", label: "Highly exceeds", color: "#2e7d4f" },
  ];
  return (
    <div
      className="flex flex-wrap items-center gap-4 border-t border-ds-border bg-ds-surface px-5 py-2.5"
      style={{ fontFamily: "var(--ds-font-sans)" }}
    >
      {items.map((b) => (
        <div key={b.range} className="flex items-center gap-1.5 text-[10px]" style={{ color: "#646f79" }}>
          <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: b.color }} />
          <span style={{ color: b.color, fontWeight: 500 }}>{b.range}</span>
          <span>— {b.label}</span>
        </div>
      ))}
    </div>
  );
}
