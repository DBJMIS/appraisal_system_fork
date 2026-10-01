"use client";

interface RatingButtonsProps {
  value: string | null;
  onChange: (code: string) => void;
  disabled?: boolean;
  /** "compact": single-row neutral scale used by the competency assessment grid. */
  variant?: "default" | "compact";
  /** Accessible name for the rating group (compact variant). */
  label?: string;
}

const BAND = (n: number) => {
  if (n <= 2) return { bg: "#fef2f2", border: "#fbd5d5", text: "#b42318", glow: "rgba(252,165,165,.3)" };
  if (n <= 4) return { bg: "#fffbeb", border: "#fbe3a1", text: "#8a5a00", glow: "rgba(253,186,116,.3)" };
  if (n <= 6) return { bg: "#fffbeb", border: "#fbe3a1", text: "#8a5a00", glow: "rgba(252,211,77,.3)" };
  if (n <= 8) return { bg: "#ecfdf5", border: "#bbf0d9", text: "#2e7d4f", glow: "rgba(134,239,172,.25)" };
  return { bg: "#ecfdf5", border: "#bbf0d9", text: "#2e7d4f", glow: "rgba(110,231,183,.25)" };
};

export const RATING_LABELS: Record<number, string> = {
  1: "Far below expectations",
  2: "Far below expectations",
  3: "Below expectations",
  4: "Below expectations",
  5: "Approaching expectations",
  6: "Meets expectations",
  7: "Meets expectations well",
  8: "Exceeds expectations",
  9: "Highly exceeds expectations",
  10: "Exceptional performance",
};

const LABEL = RATING_LABELS;

function CompactRatingButtons({ value, onChange, disabled = false, label }: RatingButtonsProps) {
  const selected = value ? parseInt(value, 10) : null;

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex gap-1" role="group" aria-label={label}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => {
          const isSelected = selected === n;
          return (
            <button
              key={n}
              type="button"
              disabled={disabled}
              onClick={() => !disabled && onChange(String(n))}
              aria-pressed={isSelected}
              aria-label={`${n} — ${LABEL[n]}`}
              title={`${n} — ${LABEL[n]}`}
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] border text-[11px] font-medium tabular-nums transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-focus focus-visible:ring-offset-1 ${
                disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
              } ${
                isSelected
                  ? "border-ds-accent bg-ds-accent text-ds-on-primary"
                  : "border-ds-border-control bg-ds-background text-ds-text-secondary hover:border-ds-text-secondary hover:text-ds-text-primary"
              }`}
            >
              {n}
            </button>
          );
        })}
      </div>
      <p className={`m-0 text-xs leading-4 ${selected ? "text-ds-text-primary" : "text-ds-text-secondary"}`}>
        {selected ? `${selected} — ${LABEL[selected]}` : "Select a rating"}
      </p>
    </div>
  );
}

export function RatingButtons(props: RatingButtonsProps) {
  if (props.variant === "compact") return <CompactRatingButtons {...props} />;
  const { value, onChange, disabled = false } = props;
  const selected = value ? parseInt(value, 10) : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1.5">
        {[1, 2, 3, 4, 5].map((n) => {
          const isSelected = selected === n;
          const band = BAND(n);
          return (
            <button
              key={n}
              type="button"
              disabled={disabled}
              onClick={() => !disabled && onChange(String(n))}
              className={`h-[30px] w-[30px] flex-shrink-0 rounded-full text-[11px] font-semibold flex items-center justify-center transition-all duration-150
                ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}
                ${isSelected ? "border-[2px] scale-110" : "border-[1.5px] border-ds-border bg-transparent text-ds-text-secondary hover:border-ds-text-secondary hover:bg-ds-surface hover:text-ds-text-primary"}`}
              style={
                isSelected
                  ? {
                      background: band.bg,
                      borderColor: band.border,
                      color: band.text,
                      boxShadow: `0 0 0 3px ${band.glow}`,
                    }
                  : {}
              }
              title={`${n} — ${LABEL[n]}`}
            >
              {n}
            </button>
          );
        })}
      </div>
      <div className="flex gap-1.5">
        {[6, 7, 8, 9, 10].map((n) => {
          const isSelected = selected === n;
          const band = BAND(n);
          return (
            <button
              key={n}
              type="button"
              disabled={disabled}
              onClick={() => !disabled && onChange(String(n))}
              className={`h-[30px] w-[30px] flex-shrink-0 rounded-full text-[11px] font-semibold flex items-center justify-center transition-all duration-150
                ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}
                ${isSelected ? "border-[2px] scale-110" : "border-[1.5px] border-ds-border bg-transparent text-ds-text-secondary hover:border-ds-text-secondary hover:bg-ds-surface hover:text-ds-text-primary"}`}
              style={
                isSelected
                  ? {
                      background: band.bg,
                      borderColor: band.border,
                      color: band.text,
                      boxShadow: `0 0 0 3px ${band.glow}`,
                    }
                  : {}
              }
              title={`${n} — ${LABEL[n]}`}
            >
              {n}
            </button>
          );
        })}
      </div>
      <p
        className={`text-[9px] font-medium leading-none transition-colors ${selected ? "" : "text-ds-text-secondary"}`}
        style={selected ? { color: BAND(selected).text } : {}}
      >
        {selected ? `${selected} — ${LABEL[selected]}` : "Select a rating"}
      </p>
    </div>
  );
}
