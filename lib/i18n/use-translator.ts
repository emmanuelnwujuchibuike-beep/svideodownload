"use client";

import { useEffect, useState } from "react";

import { en, type MessageKey } from "./messages/en";
import { useLocale } from "./use-locale";

/**
 * A translator for CLIENT components, with the catalogues loaded on demand.
 *
 * ── The problem this exists to solve ─────────────────────────────────────────
 *
 * `site-header.tsx` is a client component, it is on the LANDING page, and it
 * used `translator(useLocale())` from `./messages`. That import reaches
 * `messages/catalogues`, so webpack put **every** catalogue into the landing's
 * first-load JavaScript.
 *
 * With five near-empty catalogues that was invisible. With fifty full ones it is
 * tens of kilobytes of strings — in a bundle measured at 274 kB against a 275 kB
 * ceiling, on the one page with a hard cold-entry budget, shipped to every
 * visitor so that 3 header labels could render in a language 99% of them did not
 * choose.
 *
 * ── How this avoids it ───────────────────────────────────────────────────────
 *
 * English is bundled (it is the fallback and it is tiny). Everything else is
 * fetched with a dynamic `import()` the first time a visitor is actually on a
 * non-English locale — so the cost lands on the people who asked for it, on a
 * page they have already loaded, and never on the cold-entry path.
 *
 * The first render always returns English. That is not a compromise: `translate`
 * already falls back to English per key, so this is the same behaviour the
 * system has everywhere else, resolved a few hundred milliseconds later. Nothing
 * flashes for the overwhelming majority, who are on English already.
 *
 * ── Why not `next/dynamic` ───────────────────────────────────────────────────
 * `next/dynamic` with `ssr: false` never resolves in this app (a known, recorded
 * failure). A plain `import()` inside an effect does, and is what every other
 * lazy chunk here uses.
 */

type Catalogue = Partial<Record<MessageKey, string>>;

/** Module-level so a second component pays nothing and there is one fetch. */
let loaded: Record<string, Catalogue> | null = null;
let inflight: Promise<void> | null = null;

function ensureCatalogues(): Promise<void> {
  if (loaded) return Promise.resolve();
  inflight ??= import("./messages/catalogues")
    .then((m) => {
      loaded = m.CATALOGUES as unknown as Record<string, Catalogue>;
    })
    .catch(() => {
      // A failed chunk must never break the header — English is already right.
      loaded = {};
    });
  return inflight;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

export function useTranslator(): (key: MessageKey, vars?: Record<string, string | number>) => string {
  const locale = useLocale();
  const [, setReady] = useState(0);

  useEffect(() => {
    if (locale === "en") return; // English is bundled; nothing to fetch
    let alive = true;
    void ensureCatalogues().then(() => {
      // Re-render once the strings are in hand. Cheap: the header is small and
      // this happens at most once per visit.
      if (alive) setReady((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, [locale]);

  return (key, vars) => {
    const value = locale === "en" ? undefined : loaded?.[locale]?.[key];
    return interpolate(typeof value === "string" && value.length > 0 ? value : en[key], vars);
  };
}
