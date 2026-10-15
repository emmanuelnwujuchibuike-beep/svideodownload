"use client";

import { useEffect } from "react";

import { readCookie } from "@/lib/dom/cookie";

/**
 * Turns whole-page translation on for the chosen language (lib/i18n/page-translator.ts).
 *
 * Mounted once in the DeferredShell, two frames after first paint, and it costs an English
 * visitor one cookie read: the translator itself is a dynamic import that loads only when the
 * language is not English. It follows the language picker live (its `frenz:locale` event),
 * with no reload; switching back to English puts every original string back.
 */
const LANG_COOKIE = "frenz_lang"; // lib/i18n/languages LANGUAGE_COOKIE

function chosen(): string {
  const raw = readCookie(LANG_COOKIE) ?? (() => {
    try {
      return localStorage.getItem(LANG_COOKIE);
    } catch {
      return null;
    }
  })();
  return (raw ?? "en").trim().toLowerCase().split("-")[0] || "en";
}

export function PageTranslation() {
  useEffect(() => {
    let loaded: typeof import("@/lib/i18n/page-translator") | null = null;
    let alive = true;
    const apply = () => {
      const lang = chosen();
      if (lang === "en" && !loaded) return; // nothing to load for English
      void import("@/lib/i18n/page-translator")
        .then((m) => {
          loaded = m;
          if (alive) m.setPageLanguage(lang);
        })
        .catch(() => {
          /* the chunk failed to load — the page simply stays in English */
        });
    };
    apply();
    window.addEventListener("frenz:locale", apply);
    return () => {
      alive = false;
      window.removeEventListener("frenz:locale", apply);
    };
  }, []);
  return null;
}
