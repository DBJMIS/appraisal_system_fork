import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
import { dsTwMergeExtension } from "@/lib/design-tokens";

const twMerge = extendTailwindMerge(dsTwMergeExtension);

/**
 * Merge Tailwind CSS classes with clsx and tailwind-merge.
 * Used by shadcn/ui and custom components.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
