/**
 * Theme preference: system, light or dark. A device preference, not account
 * data, so it is kept in localStorage. The inline boot script in the root
 * layout applies it before first paint to avoid a flash.
 */
import { create } from "zustand";

export type ThemePref = "system" | "light" | "dark";
export const THEME_KEY = "os.theme";

function read(): ThemePref {
  if (typeof window === "undefined") return "system";
  try {
    const v = window.localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function resolveTheme(pref: ThemePref, prefersDark: boolean): "light" | "dark" {
  return pref === "system" ? (prefersDark ? "dark" : "light") : pref;
}

export function applyTheme(pref: ThemePref) {
  if (typeof document === "undefined") return;
  const prefersDark = typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches;
  const root = document.documentElement;
  if (pref === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", pref);
  root.style.colorScheme = resolveTheme(pref, !!prefersDark);
}

interface ThemeStore {
  pref: ThemePref;
  setPref: (p: ThemePref) => void;
  hydrate: () => void;
}

export const useTheme = create<ThemeStore>((set) => ({
  pref: "system",
  setPref: (pref) => {
    try {
      if (pref === "system") window.localStorage.removeItem(THEME_KEY);
      else window.localStorage.setItem(THEME_KEY, pref);
    } catch {
      /* storage blocked: the choice still applies for this page view */
    }
    applyTheme(pref);
    set({ pref });
  },
  hydrate: () => set({ pref: read() }),
}));

/** The boot script body (served from /theme.js so the CSP needs no inline script). */
export const THEME_BOOT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;
