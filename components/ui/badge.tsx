import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/utils/cn";

const badgeVariants = cva(
  "inline-flex items-center rounded-ds-badge border px-1.5 py-0.5 text-xs font-medium leading-4 transition-colors duration-100 focus:outline-none focus:ring-2 focus:ring-ds-focus focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-ds-surface text-ds-text-primary",
        secondary: "border-transparent bg-ds-surface text-ds-text-secondary",
        destructive: "border-ds-error-border bg-ds-error-subtle text-ds-error",
        outline: "border-ds-border text-ds-text-primary",
        success: "border-ds-success-border bg-ds-success-subtle text-ds-success",
        warning: "border-ds-warning-border bg-ds-warning-subtle text-ds-warning",
        info: "border-ds-info-border bg-ds-info-subtle text-ds-info",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
