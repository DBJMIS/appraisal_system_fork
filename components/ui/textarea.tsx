import * as React from "react";
import { cn } from "@/lib/utils";

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[80px] w-full rounded-ds-control border border-ds-border-control bg-ds-background px-3 py-2 text-sm leading-[1.5] text-ds-text-primary ring-offset-ds-background transition-colors duration-100 placeholder:text-ds-text-muted hover:border-ds-text-secondary focus-visible:border-ds-focus focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ds-focus disabled:cursor-not-allowed disabled:bg-ds-surface disabled:opacity-60 aria-[invalid=true]:border-ds-error",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Textarea.displayName = "Textarea";

export { Textarea };
