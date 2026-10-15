"use client";

import { Globe } from "lucide-react";
import { type ComponentType, useEffect, useState } from "react";

import { IconTile } from "@/components/icons/icon-tile";
import { readCookie } from "@/lib/dom/cookie";
import { haptic } from "@/lib/motion/haptics";
import { playSound } from "@/lib/notifications/sound-fx";

/**
 * Header language selector for the top ~50 languages (owner — replaces the
 * downloads/history icon in the header). Stores the chosen language in a cookie +
 * localStorage.
 *
 * ── Kept off the cold-entry budget ────────────────────────────────────────────
 * This trigger deliberately imports NO language data — only the current code
 * string, read from the cookie. The dropdown panel and the ~50-language table live
 * in `./language-menu`, dynamically `import()`-ed the first time the globe is
 * tapped, so none of that rides every marketing page's first-load JS (the
 * 2-second rule). A plain `import()` (not `next/dynamic ssr:false`, which never
 * resolves in this app) with a tiny loaded-module cache.
 */
const LANG_COOKIE = "frenz_lang"; // must match lib/i18n/languages LANGUAGE_COOKIE

type MenuComponent = ComponentType<{ current: string; onChoose: (code: string) => void; onClose: () => void; elevated?: boolean }>;

function readLang(): string {
  if (typeof document === "undefined") return "en";
  const fromCookie = readCookie(LANG_COOKIE); // guarded — see lib/dom/cookie.ts
  if (fromCookie) return fromCookie;
  try {
    return localStorage.getItem(LANG_COOKIE) ?? "en";
  } catch {
    return "en";
  }
}

/**
 * `variant="row"` is the side menu's "Language" row (owner, 2026-10-15: "put the language
 * button on the landing page inside the top side menu, the landing header is too crowded").
 * Its list opens ABOVE the menu sheet (`elevated`), which otherwise covers it.
 */
export function LanguageSelector({ variant = "icon" }: { variant?: "icon" | "row" } = {}) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("en");
  const [Menu, setMenu] = useState<MenuComponent | null>(null);

  useEffect(() => setCurrent(readLang()), []);

  const toggle = async () => {
    haptic("light");
    playSound("tap");
    if (open) {
      setOpen(false);
      return;
    }
    if (!Menu) {
      try {
        const mod = await import("./language-menu");
        setMenu(() => mod.LanguageMenu);
      } catch {
        return; // chunk failed to load — leave the trigger inert rather than break
      }
    }
    setOpen(true);
  };

  const menu =
    open && Menu ? (
      <Menu
        current={current}
        elevated={variant === "row"}
        onChoose={(code) => {
          setCurrent(code);
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
      />
    ) : null;

  if (variant === "row") {
    return (
      <>
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={toggle}
          className="mt-3 flex w-full items-center justify-between rounded-2xl border border-border/60 px-3 py-2 text-left"
        >
          <span className="text-sm font-medium text-muted-foreground">Language</span>
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
            <Globe className="h-[18px] w-[18px]" aria-hidden />
            <span translate="no" className="uppercase">{current}</span>
          </span>
        </button>
        {menu}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        aria-label={`Language: ${current.toUpperCase()}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        /*
          `min-w-[44px]`, not just `h-11`: every sibling header button is
          `h-11 w-11` (app-topbar, notification-bell, search-trigger) but this
          one only ever constrained its HEIGHT. Below `sm` the `EN` label is
          hidden, so the whole target collapsed to the 26px globe — measured
          26×44 at 320–430px. A MINIMUM rather than a fixed width, because the
          label reappears at `sm` and must still fit beside the glyph.
        */
        className="inline-flex h-11 min-w-[44px] items-center justify-center"
      >
        <IconTile>
          <span className="relative flex items-center">
            <Globe className="h-[26px] w-[26px]" />
            <span className="ml-1 hidden text-[11px] font-bold uppercase text-muted-foreground sm:inline">{current}</span>
          </span>
        </IconTile>
      </button>

      {menu}
    </>
  );
}
