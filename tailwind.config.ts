import type { Config } from "tailwindcss";
import { dsTailwindTheme } from "./lib/design-tokens.ts";

const dsSans = ["var(--ds-font-sans)", "Segoe UI", "system-ui", "-apple-system", "Helvetica Neue", "Arial", "sans-serif"];

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: dsSans,
        display: dsSans,
        body: dsSans,
        segoe: ["Segoe UI", "Segoe UI Web (West European)", "system-ui", "sans-serif"],
      },
      fontSize: { ...dsTailwindTheme.fontSize },
      colors: {
        ...dsTailwindTheme.colors,
        // Legacy tokens below are still read by feature screens; they alias the approved palette.
        // New work should use the `ds` namespace.
        navy: {
          DEFAULT: "#0d0e10",
          mid: "#2b2d31",
          light: "#3a3d42",
        },
        accent: {
          DEFAULT: "#0d0e10",
          bright: "#646f79",
        },
        gold: {
          DEFAULT: "#8a5a00",
          light: "#fbe3a1",
        },
        teal: {
          DEFAULT: "#2e7d4f",
        },
        rose: {
          DEFAULT: "#b42318",
        },
        violet: {
          DEFAULT: "#3d5a78",
        },
        surface: {
          DEFAULT: "#f3f3f3",
          2: "#ebebeb",
        },
        "design-border": "#e7e7e7",
        "text-primary": "#0d0d0d",
        "text-secondary": "#646f79",
        "text-muted": "#646f79",
        // Legacy MS colors (keep for backwards compatibility)
        "ms-purple": "#742774",
        "ms-bg": "#f3f2f1",
        "ms-border": "#edebe9",
        "ms-text": "#323130",
        "ms-muted": "#605e5c",
        "ms-link": "#0078d4",
        "ms-green": "#107c10",
        "ms-avatar-blue": "#0078d4",
        "ms-avatar-green": "#107c10",
        "ms-avatar-red": "#a80000",
        "ms-avatar-purple": "#8764b8",
        "ms-avatar-orange": "#ca5010",
        "ms-avatar-teal": "#038387",
        "ms-avatar-gray": "#5a5a5a",
        "ms-hover": "#edebe9",
        // Shadcn compatible colors
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        ...dsTailwindTheme.borderRadius,
        card: "8px",
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "4px",
      },
      boxShadow: {
        ...dsTailwindTheme.boxShadow,
        card: "none",
        "card-hover": "0 0 0 1px #d0d4d8",
      },
      animation: {
        "fade-up": "fadeUp 0.4s ease both",
        "pulse-slow": "pulse-opacity-slow 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
      keyframes: {
        fadeUp: {
          from: { opacity: "0", transform: "translateY(14px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-opacity-slow": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
