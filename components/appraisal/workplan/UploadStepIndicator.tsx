"use client";

const STEPS = ["Upload file", "Select sheet", "Map columns", "Review & confirm"];

interface UploadStepIndicatorProps {
  currentStep: number;
}

export function UploadStepIndicator({ currentStep }: UploadStepIndicatorProps) {
  return (
    <div className="flex items-center justify-center gap-1 flex-wrap">
      {STEPS.map((label, i) => {
        const isActive = i === currentStep;
        const isCompleted = i < currentStep;
        const stepNum = i + 1;
        return (
          <div key={i} className="flex items-center gap-1">
            <div
              className={`
                flex items-center justify-center w-7 h-7 rounded-full text-[11px] font-semibold
                ${isCompleted ? "bg-ds-accent text-white" : ""}
                ${isActive ? "bg-ds-text-primary text-white" : ""}
                ${!isCompleted && !isActive ? "bg-ds-border text-ds-text-secondary" : ""}
              `}
            >
              {isCompleted ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                stepNum
              )}
            </div>
            <span
              className={`text-[11px] font-medium max-w-[90px] truncate hidden sm:inline
                ${isActive ? "text-ds-text-primary" : ""}
                ${isCompleted ? "text-ds-accent" : ""}
                ${!isCompleted && !isActive ? "text-ds-text-secondary" : ""}
              `}
            >
              {label}
            </span>
            {i < STEPS.length - 1 && (
              <span className="text-ds-text-secondary text-[10px] mx-0.5">›</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
