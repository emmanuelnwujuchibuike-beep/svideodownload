"use client";

import { useEffect, useState } from "react";

import type { LocaleCode } from "@/lib/i18n/locales";

export const LANGUAGE_COOKIE = "frenz_lang";

/**
 * The locale to RENDER IN, from the member's own choice.
 *
 * ── The gap this closes ──────────────────────────────────────────────────
 * The header's switcher wrote a `frenz_lang` cookie and nothing read it —
 * every caller passed `DEFAULT_LOCALE` literally. So switching language
 * changed a cookie, a `lang` attribute, and nothing a member could see. That
 * is the owner's "language doesn't update instantly": not a refresh problem,
 * the choice simply had no consumer.
 *
 * ── Why the codes are inline and nothing is imported ─────────────────────
 * The obvious version validated against `availableLocales()`. That reaches
 * `catalogueCoverage`, which imports every catalogue — and the header renders
 * on the LANDING page, so it dragged the whole English message table into the
 * cold-entry bundle and broke the 305 kB ceiling by itself. A type-only import
 * plus six literals costs nothing at runtime.
 *
 * No availability check is needed either: `translate` already falls back to
 * English per KEY, so an untranslated locale renders English automatically and
 * a partially-translated one renders exactly what exists. That is a better
 * behaviour than refusing the locale outright, and it is free.
 */
const CODES: readonly LocaleCode[] = [
  "en", "zh", "hi", "es", "fr", "ar", "bn", "pt", "ru", "ur",
  "id", "de", "ja", "sw", "mr", "te", "tr", "ta", "vi", "ko",
  "it", "th", "gu", "fa", "pl", "uk", "ms", "kn", "pa", "ro",
  "nl", "yo", "ig", "ha", "am", "zu", "fil", "el", "cs", "sv",
  "hu", "he", "da", "fi", "no", "sk", "sr", "hr", "bg", "ne",
];

export function useLocale(): LocaleCode {
  const [locale, setLocale] = useState<LocaleCode>("en");

  useEffect(() => {
    const read = () => {
      try {
        const m = document.cookie.match(/(?:^|;\s*)frenz_lang=([^;]+)/);
        const raw = (m?.[1] ?? localStorage.getItem(LANGUAGE_COOKIE) ?? "").trim().toLowerCase();
        if (!raw) return;
        // `pt-BR` still means Portuguese.
        const base = raw.split("-")[0] as LocaleCode;
        if (CODES.includes(base)) setLocale(base);
      } catch {
        /* storage blocked — stay on English */
      }
    };
    read();
    // The switcher dispatches this so every mounted consumer updates at once,
    // with no reload and no prop drilling through the whole chrome.
    window.addEventListener("frenz:locale", read);
    return () => window.removeEventListener("frenz:locale", read);
  }, []);

  return locale;
}
