/**
 * Tailwind 3 preset: maps the CSS variables in src/styles/tokens.css onto
 * utility names, so components say `bg-card` or `text-muted-foreground` and
 * dark mode is a token swap, not a second set of classes.
 */
import type { Config } from "tailwindcss";

const token = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;

const preset: Partial<Config> = {
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        background: token("background"),
        foreground: token("foreground"),
        card: { DEFAULT: token("card"), foreground: token("card-foreground") },
        popover: { DEFAULT: token("popover"), foreground: token("popover-foreground") },
        muted: { DEFAULT: token("muted"), foreground: token("muted-foreground") },
        subtle: { foreground: token("subtle-foreground") },
        border: token("border"),
        input: token("input"),
        ring: token("ring"),
        link: token("link"),
        overlay: token("overlay"),
        brand: token("brand"),
        star: token("star"),
        ink: { DEFAULT: token("ink"), foreground: token("ink-foreground") },
        ground: { 2: token("ground-2") },
        primary: {
          DEFAULT: token("primary"),
          foreground: token("primary-foreground"),
          soft: token("primary-soft"),
          "soft-foreground": token("primary-soft-foreground"),
        },
        success: {
          DEFAULT: token("success"),
          foreground: token("success-foreground"),
          soft: token("success-soft"),
          "soft-foreground": token("success-soft-foreground"),
        },
        warning: {
          DEFAULT: token("warning"),
          foreground: token("warning-foreground"),
          soft: token("warning-soft"),
          "soft-foreground": token("warning-soft-foreground"),
        },
        danger: {
          DEFAULT: token("danger"),
          foreground: token("danger-foreground"),
          soft: token("danger-soft"),
          "soft-foreground": token("danger-soft-foreground"),
        },
      },
      borderRadius: {
        card: "var(--radius-card)",
        "2xl": "calc(var(--radius) + 8px)",
        xl: "calc(var(--radius) + 4px)",
        lg: "var(--radius)",
        md: "8px",
        sm: "6px",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        "card-hover": "var(--shadow-card-hover)",
        popover: "var(--shadow-popover)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "1rem" }],
      },
      spacing: {
        header: "var(--header-height)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "fade-out": { from: { opacity: "1" }, to: { opacity: "0" } },
        "pop-in": { from: { opacity: "0", transform: "scale(0.97) translateY(2px)" }, to: { opacity: "1", transform: "none" } },
        "slide-in-right": { from: { transform: "translateX(100%)" }, to: { transform: "none" } },
        "slide-in-left": { from: { transform: "translateX(-100%)" }, to: { transform: "none" } },
        "slide-up": { from: { opacity: "0", transform: "translateY(8px)" }, to: { opacity: "1", transform: "none" } },
        shimmer: { "0%": { opacity: "1" }, "50%": { opacity: "0.55" }, "100%": { opacity: "1" } },
        rise: { from: { opacity: "0", transform: "translateY(14px)" }, to: { opacity: "1", transform: "none" } },
      },
      animation: {
        "fade-in": "fade-in 150ms ease-out",
        "fade-out": "fade-out 120ms ease-in",
        "pop-in": "pop-in 160ms cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-in-right": "slide-in-right 220ms cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-in-left": "slide-in-left 220ms cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-up": "slide-up 180ms cubic-bezier(0.16, 1, 0.3, 1)",
        shimmer: "shimmer 1.6s ease-in-out infinite",
        rise: "rise 600ms cubic-bezier(0.2, 0.7, 0.2, 1) both",
      },
    },
  },
};

export default preset;
