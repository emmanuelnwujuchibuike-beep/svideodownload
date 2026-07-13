"use client";

import { useTheme } from "next-themes";
import { useEffect } from "react";

import { getCachedThemeMode } from "@/lib/theme/theme-mode-client";

/**
 * Keeps `localStorage["frenz-resolved-theme"]` in sync with next-themes'
 * live `resolvedTheme` — the boot script (features/app-shell/boot-splash.tsx)
 * reads this cached value on the NEXT cold start instead of querying
 * `prefers-color-scheme` live, since a live query is what caused the
 * dark/light flash on iOS (WebKit can report a stale answer for the first
 * moment after a resume, before self-correcting). Every explicit light/dark
 * choice AND every live OS-theme change (while "System" is selected)
 * overwrites it immediately.
 *
 * Also owns the post-hydration live OS-change listener: this app always
 * keeps next-themes' own `theme` storage/state a concrete "light"/"dark"
 * (never the literal "system" — see boot-splash.tsx's THEME_JS), so
 * next-themes' OWN internal system-follow effect (`theme === "system"`)
 * never fires. Calling the real `setTheme()` here — rather than only
 * patching the DOM class directly, as the pre-hydration boot script does —
 * keeps next-themes' React state consistent with what's actually painted.
 */
export function ThemeCacheSync() {
  const { resolvedTheme, setTheme } = useTheme();

  useEffect(() => {
    if (!resolvedTheme) return;
    try {
      localStorage.setItem("frenz-resolved-theme", resolvedTheme);
    } catch {
      /* storage blocked — boot script just falls back to a live query */
    }
  }, [resolvedTheme]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (getCachedThemeMode() !== "system") return;
      setTheme(mq.matches ? "dark" : "light");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [setTheme]);

  return null;
}
