import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ds, dsColors, dsFontSize, dsRadius, dsShadow } from "@/lib/design-tokens";
import { cn } from "@/utils/cn";
import { cn as libCn } from "@/lib/utils";

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const css = read("app/globals.css");

function declaredValue(name: string): string | undefined {
  const match = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  return match?.[1].trim();
}

function referencedNames(value: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") {
      for (const m of v.matchAll(/var\(--(ds-[a-z0-9-]+)\)/g)) out.push(m[1]);
    } else if (v && typeof v === "object") {
      Object.values(v).forEach(walk);
    }
  };
  walk(value);
  return out;
}

describe("design tokens", () => {
  it("defines the canonical colour tokens with the approved values", () => {
    expect({
      background: declaredValue("ds-background"),
      surface: declaredValue("ds-surface"),
      surfaceElevated: declaredValue("ds-surface-elevated"),
      textPrimary: declaredValue("ds-text-primary"),
      textSecondary: declaredValue("ds-text-secondary"),
      textMuted: declaredValue("ds-text-muted"),
      primary: declaredValue("ds-primary"),
      onPrimary: declaredValue("ds-on-primary"),
      accent: declaredValue("ds-accent"),
      border: declaredValue("ds-border"),
      borderSubtle: declaredValue("ds-border-subtle"),
    }).toEqual({
      background: "#ffffff",
      surface: "#f3f3f3",
      surfaceElevated: "#ffffff",
      textPrimary: "#0d0d0d",
      textSecondary: "#646f79",
      textMuted: "#8b949e",
      primary: "#646f79",
      onPrimary: "#ffffff",
      accent: "#0d0e10",
      border: "#e7e7e7",
      borderSubtle: "#f3f3f3",
    });
  });

  it("declares every --ds-* property referenced from TypeScript", () => {
    const names = new Set(referencedNames({ ds, dsColors, dsRadius, dsShadow }));
    expect(names.size).toBeGreaterThan(30);
    for (const name of names) {
      expect(declaredValue(name), `--${name}`).toBeDefined();
    }
  });

  it("uses the approved radius scale", () => {
    expect(declaredValue("ds-radius-control")).toBe("6px");
    expect(declaredValue("ds-radius-button")).toBe("6px");
    expect(declaredValue("ds-radius-panel")).toBe("8px");
    expect(declaredValue("ds-radius-popover")).toBe("10px");
    expect(declaredValue("ds-radius-modal")).toBe("12px");
    expect(declaredValue("ds-radius-badge")).toBe("4px");
  });

  it("uses the approved type scale", () => {
    expect(dsFontSize["ds-page-title"]).toEqual(["28px", { lineHeight: "1.2", fontWeight: "500" }]);
    expect(dsFontSize["ds-section"][0]).toBe("18px");
    expect(dsFontSize["ds-section"][1].fontWeight).toBe("500");
    expect(dsFontSize["ds-heading"]).toEqual(["14px", { lineHeight: "1.4", fontWeight: "600" }]);
    expect(dsFontSize["ds-body"][0]).toBe("14px");
  });

  it("keeps the legacy token names but aliases them to the approved palette", () => {
    expect(declaredValue("surface")).toBe("var(--ds-surface)");
    expect(declaredValue("accent")).toBe("var(--ds-accent)");
    expect(declaredValue("navy")).toBe("var(--ds-accent)");
    expect(declaredValue("border-color")).toBe("var(--ds-border)");
    expect(declaredValue("text-primary")).toBe("var(--ds-text-primary)");
    expect(declaredValue("text-muted")).toBe("var(--ds-text-secondary)");
    expect(declaredValue("radius")).toBe("8px");
    expect(declaredValue("shadow-card")).toBe("none");
    expect(declaredValue("primary")).toBe("225 11% 6%");
    expect(css).not.toMatch(/#3b82f6|#0f1f3d|#dde5f5/i);
  });

  it("does not define the undeclared --color-* names that some feature screens fall back on", () => {
    expect(css).not.toMatch(/--color-text-primary\s*:/);
    expect(css).not.toMatch(/--color-background-primary\s*:/);
  });

  it("respects reduced-motion preferences", () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });
});

describe("cn with design-system classes", () => {
  it("lets caller radius, shadow and font-size overrides replace ds defaults", () => {
    expect(cn("rounded-ds-button", "rounded-full")).toBe("rounded-full");
    expect(cn("shadow-ds-popover", "shadow-none")).toBe("shadow-none");
    expect(cn("text-ds-section", "text-lg")).toBe("text-lg");
  });

  it("keeps ds font-size and ds text colour side by side", () => {
    expect(cn("text-ds-section text-ds-text-primary")).toBe("text-ds-section text-ds-text-primary");
    expect(cn("text-ds-text-primary", "text-red-500")).toBe("text-red-500");
  });

  it("is the same implementation from both import paths", () => {
    expect(libCn).toBe(cn);
  });
});
