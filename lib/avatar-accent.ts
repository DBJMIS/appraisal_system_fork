import type { CSSProperties } from "react";

export type AvatarAccent = {
  /** Tailwind classes; pair with a `border` width class. */
  className: string;
  /** Equivalent inline style for components styled with `style={{ ... }}`. */
  style: Pick<CSSProperties, "background" | "color" | "border">;
};

const ACCENTS: readonly AvatarAccent[] = [
  {
    className: "border-ds-lavender-border bg-ds-lavender-subtle text-ds-lavender-text",
    style: { background: "var(--ds-lavender-subtle)", color: "var(--ds-lavender-text)", border: "1px solid var(--ds-lavender-border)" },
  },
  {
    className: "border-ds-mint-border bg-ds-mint-subtle text-ds-success",
    style: { background: "var(--ds-mint-subtle)", color: "var(--ds-success)", border: "1px solid var(--ds-mint-border)" },
  },
  {
    className: "border-ds-amber-border bg-ds-amber-subtle text-ds-warning",
    style: { background: "var(--ds-amber-subtle)", color: "var(--ds-warning)", border: "1px solid var(--ds-amber-border)" },
  },
  {
    className: "border-ds-coral-border bg-ds-coral-subtle text-ds-error",
    style: { background: "var(--ds-coral-subtle)", color: "var(--ds-error)", border: "1px solid var(--ds-coral-border)" },
  },
];

/** Deterministic muted accent for a person's initials avatar: the same name always gets the same tint. */
export function avatarAccent(seed: string | null | undefined): AvatarAccent {
  const key = (seed ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return ACCENTS[hash % ACCENTS.length];
}
