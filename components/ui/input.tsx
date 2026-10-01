import * as React from "react";
import { cn } from "@/utils/cn";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-ds-control border border-ds-border-control bg-ds-background px-3 py-2 text-sm text-ds-text-primary ring-offset-ds-background transition-colors duration-100 file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-ds-text-muted hover:border-ds-text-secondary focus-visible:border-ds-focus focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ds-focus disabled:cursor-not-allowed disabled:bg-ds-surface disabled:opacity-60 aria-[invalid=true]:border-ds-error",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
