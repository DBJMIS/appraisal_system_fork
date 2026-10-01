/**
 * Design system tokens (Asana-inspired enterprise direction).
 *
 * Raw values live in app/globals.css under the `--ds-*` custom properties; this module only references them,
 * so there is one source of truth for values. The `ds` namespace avoids the legacy tokens (`--surface`, `--accent`,
 * `--border-color`, shadcn `--primary`/`--border`/`--background`), which feature screens still read directly.
 *
 * Canonical token -> CSS custom property:
 *   --background        -> --ds-background          --text-primary   -> --ds-text-primary
 *   --surface           -> --ds-surface             --text-secondary -> --ds-text-secondary
 *   --surface-elevated  -> --ds-surface-elevated    --text-muted     -> --ds-text-muted
 *   --primary           -> --ds-primary             --border         -> --ds-border
 *   --on-primary        -> --ds-on-primary          --border-subtle  -> --ds-border-subtle
 *   --accent            -> --ds-accent
 */

const v = (name: string) => `var(--ds-${name})`;

export const dsColors = {
  background: v("background"),
  surface: v("surface"),
  "surface-elevated": v("surface-elevated"),
  "surface-hover": v("surface-hover"),
  "text-primary": v("text-primary"),
  "text-secondary": v("text-secondary"),
  "text-muted": v("text-muted"),
  primary: v("primary"),
  "primary-hover": v("primary-hover"),
  "on-primary": v("on-primary"),
  accent: v("accent"),
  "accent-hover": v("accent-hover"),
  border: v("border"),
  "border-subtle": v("border-subtle"),
  "border-strong": v("border-strong"),
  "border-control": v("border-control"),
  focus: v("focus"),
  coral: v("coral"),
  "coral-subtle": v("coral-subtle"),
  "coral-border": v("coral-border"),
  mint: v("mint"),
  "mint-subtle": v("mint-subtle"),
  "mint-border": v("mint-border"),
  lavender: v("lavender"),
  "lavender-subtle": v("lavender-subtle"),
  "lavender-border": v("lavender-border"),
  "lavender-text": v("lavender-text"),
  amber: v("amber"),
  "amber-subtle": v("amber-subtle"),
  "amber-border": v("amber-border"),
  success: v("success"),
  "success-subtle": v("success-subtle"),
  "success-border": v("success-border"),
  warning: v("warning"),
  "warning-subtle": v("warning-subtle"),
  "warning-border": v("warning-border"),
  error: v("error"),
  "error-subtle": v("error-subtle"),
  "error-border": v("error-border"),
  info: v("info"),
  "info-subtle": v("info-subtle"),
  "info-border": v("info-border"),
  overlay: v("overlay"),
} as const;

/** Tailwind `rounded-ds-*` keys. */
export const dsRadius = {
  "ds-control": v("radius-control"),
  "ds-button": v("radius-button"),
  "ds-panel": v("radius-panel"),
  "ds-popover": v("radius-popover"),
  "ds-modal": v("radius-modal"),
  "ds-badge": v("radius-badge"),
} as const;

/** Tailwind `shadow-ds-*` keys. Shadows are only for floating layers (menus, popovers, dialogs). */
export const dsShadow = {
  "ds-popover": v("shadow-popover"),
  "ds-dialog": v("shadow-dialog"),
} as const;

type DsFontSize = [fontSize: string, configuration: { lineHeight: string; fontWeight: string }];

/** Tailwind `text-ds-*` font-size keys (size, line-height, weight). */
export const dsFontSize: Record<
  "ds-page-title" | "ds-section" | "ds-heading" | "ds-body" | "ds-label" | "ds-meta",
  DsFontSize
> = {
  "ds-page-title": ["28px", { lineHeight: "1.2", fontWeight: "500" }],
  "ds-section": ["18px", { lineHeight: "1.3", fontWeight: "500" }],
  "ds-heading": ["14px", { lineHeight: "1.4", fontWeight: "600" }],
  "ds-body": ["14px", { lineHeight: "1.5", fontWeight: "400" }],
  "ds-label": ["13px", { lineHeight: "1.35", fontWeight: "500" }],
  "ds-meta": ["12px", { lineHeight: "1.4", fontWeight: "400" }],
};

export const dsFontFamily = {
  sans: v("font-sans"),
} as const;

/**
 * Spacing uses the Tailwind default scale, which already matches the 8px-derived system:
 * 1 = 4px, 2 = 8px, 3 = 12px, 4 = 16px, 6 = 24px, 8 = 32px. Avoid larger steps inside appraisal screens.
 */
export const dsSpace = { 1: "4px", 2: "8px", 3: "12px", 4: "16px", 6: "24px", 8: "32px" } as const;

/** Motion: use Tailwind duration-100 (hover/focus), duration-150/200 (menus, dialogs, tabs). */
export const dsMotion = {
  fast: v("duration-fast"),
  base: v("duration-base"),
  slow: v("duration-slow"),
  easing: v("ease"),
} as const;

/** Tailwind theme extension consumed by tailwind.config.ts. */
export const dsTailwindTheme = {
  colors: { ds: dsColors },
  borderRadius: dsRadius,
  boxShadow: dsShadow,
  fontSize: dsFontSize,
} as const;

/** tailwind-merge extension so `rounded-ds-*`, `shadow-ds-*` and `text-ds-*` sizes merge with overrides correctly. */
export const dsTwMergeExtension = {
  extend: {
    classGroups: {
      rounded: [{ rounded: Object.keys(dsRadius) }],
      shadow: [{ shadow: Object.keys(dsShadow) }],
      "font-size": [{ text: Object.keys(dsFontSize) }],
    },
  },
};

/** Inline-style helpers for components that use `style={{ ... }}`. */
export const ds = {
  color: dsColors,
  radius: {
    control: v("radius-control"),
    button: v("radius-button"),
    panel: v("radius-panel"),
    popover: v("radius-popover"),
    modal: v("radius-modal"),
    badge: v("radius-badge"),
  },
  shadow: { popover: v("shadow-popover"), dialog: v("shadow-dialog") },
  font: dsFontFamily,
  space: dsSpace,
  motion: dsMotion,
} as const;
