"use client";

import { Check, Globe, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { IconTile } from "@/components/icons/icon-tile";
import { LANGUAGE_COOKIE, LANGUAGES, findLanguage } from "@/lib/i18n/languages";
import { haptic } from "@/lib/motion/haptics";
import { playSound } from "@/lib/notifications/sound-fx";
import { cn } from "@/lib/utils";

/**
 * Header language selector for the top ~50 languages (owner — replaces the
 * downloads/history icon in the header). Stores the chosen language in a cookie +
 * localStorage. Content translation is driven by the i18n catalogue, which falls
 * back to the default locale for strings not yet translated, so a pick is honoured
 * as far as translations exist and remembered for when more are added.
 */
function readLang(): string {
  if (typeof document === "undefined") return "en";
  const m = document.cookie.match(/(?:^|;\s*)frenz_lang=([^;]+)/);
  return m?.[1] ?? (() => {
    try {
      return localStorage.getItem(LANGUAGE_COOKIE) ?? "en";
    } catch {
      return "en";
    }
  })();
}

export function LanguageSelector() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [current, setCurrent] = useState("en");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => setCurrent(readLang()), []);
  useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  const s = q.trim().toLowerCase();
  const filtered = s
    ? LANGUAGES.filter((l) => l.name.toLowerCase().includes(s) || l.native.toLowerCase().includes(s) || l.code.includes(s))
    : LANGUAGES;

  const choose = (code: string) => {
    haptic("selection");
    playSound("tap");
    try {
      const secure = location.protocol === "https:" ? "; secure" : "";
      document.cookie = `${LANGUAGE_COOKIE}=${code}; path=/; max-age=31536000; samesite=lax${secure}`;
      localStorage.setItem(LANGUAGE_COOKIE, code);
      document.documentElement.setAttribute("lang", code);
    } catch {
      /* storage blocked */
    }
    setCurrent(code);
    setOpen(false);
  };

  const active = findLanguage(current);

  return (
    <>
      <button
        type="button"
        aria-label={`Language: ${active.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => { haptic("light"); playSound("tap"); setOpen((o) => !o); }}
        className="inline-flex h-10 items-center justify-center"
      >
        <IconTile>
          <span className="relative flex items-center">
            <Globe className="h-[20px] w-[20px]" />
            <span className="ml-1 hidden text-[11px] font-bold uppercase text-muted-foreground sm:inline">{active.code}</span>
          </span>
        </IconTile>
      </button>

      {open ? (
        <>
          <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="fixed inset-0 z-[60] cursor-default" />
          <div
            role="menu"
            aria-label="Choose a language"
            className="fixed right-2 top-[calc(var(--frenz-safe-top)+3.75rem)] z-[61] w-72 max-w-[calc(100vw-1rem)] overflow-hidden rounded-2xl border border-border/60 bg-card shadow-2xl"
          >
            <div className="border-b border-border/60 p-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  ref={inputRef}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search language…"
                  aria-label="Search language"
                  className="h-10 w-full rounded-xl bg-secondary/60 pl-9 pr-3 text-sm outline-none ring-1 ring-inset ring-border/50 transition focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>
            <div className="max-h-[60vh] overflow-y-auto overscroll-contain p-1.5">
              {filtered.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  role="menuitemradio"
                  aria-checked={l.code === current}
                  onClick={() => choose(l.code)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition duration-150 active:scale-[0.98]",
                    l.code === current ? "bg-primary/10" : "hover:bg-secondary",
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{l.native}</span>
                    <span className="block truncate text-xs text-muted-foreground">{l.name}</span>
                  </span>
                  {l.code === current ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
                </button>
              ))}
              {filtered.length === 0 ? <p className="px-3 py-6 text-center text-sm text-muted-foreground">No language matches.</p> : null}
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
