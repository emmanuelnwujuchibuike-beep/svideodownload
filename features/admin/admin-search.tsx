"use client";

import { CornerDownLeft, Search, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { searchAdmin } from "@/lib/admin/search-index";
import { cn } from "@/lib/utils";

/**
 * Search every setting in the dashboard.
 *
 * Owner, 2026-09-02, hunting for the VAST start-ad toggle: "how do i turn of
 * enableon download ? i cant find it … put a search system and placeholder in
 * the admin dashboard so i can search every single thing".
 *
 * The control was there — Monetization → VAST interstitial → "Show when a
 * download STARTS" — and unfindable, because the dashboard is 32 sections deep
 * and nobody guesses which one owns a given switch. So this searches CONTROLS,
 * not just screens, and every result says exactly where the thing lives
 * (`lib/admin/search-index.ts`).
 *
 * ── Keyboard, because this is a tool for someone who uses it daily ───────
 * `/` focuses it from anywhere in the dashboard, arrows move, Enter jumps,
 * Escape clears. The listbox carries the ARIA a combobox needs so it is not
 * mouse-only.
 */
export function AdminSearch({ onSelect }: { onSelect: (sectionId: string) => void }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const results = useMemo(() => searchAdmin(query), [query]);

  useEffect(() => setCursor(0), [query]);

  /*
    `/` as the global focus key — the convention every developer tool uses. It
    stands down while the operator is typing somewhere else, so it can never
    steal a keystroke out of a settings field.
  */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const choose = (sectionId: string) => {
    onSelect(sectionId);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setQuery("");
      setOpen(false);
      return;
    }
    if (results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (c + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (c - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = results[cursor];
      if (hit) choose(hit.section);
    }
  };

  const showList = open && query.trim().length >= 2;

  return (
    <div className="relative mb-6 px-3 sm:px-0">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label="Search every setting in the dashboard"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          // A beat, so a click on a result lands before the list unmounts.
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          placeholder="Search settings — try “download start”, “hilltop”, “cpm”, “price”"
          className="w-full rounded-2xl border border-border bg-card py-3 pl-10 pr-10 text-sm outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        ) : (
          <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-border bg-secondary px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:block">
            /
          </kbd>
        )}
      </div>

      {showList ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Search results"
          className="absolute z-30 mt-2 w-[calc(100%-1.5rem)] overflow-hidden rounded-2xl border border-border bg-card shadow-lg sm:w-full"
        >
          {results.length === 0 ? (
            <li className="px-4 py-4 text-xs text-muted-foreground">
              Nothing matches “{query}”. Search finds settings as well as sections — try the words on the
              control itself, or the network name.
            </li>
          ) : (
            results.map((r, i) => (
              <li key={r.id} role="option" aria-selected={i === cursor}>
                <button
                  type="button"
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => choose(r.section)}
                  className={cn(
                    "flex w-full items-center gap-3 px-4 py-2.5 text-left transition",
                    i === cursor ? "bg-secondary/70" : "hover:bg-secondary/40",
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{r.label}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{r.hint}</span>
                  </span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                      r.kind === "setting"
                        ? "bg-primary/10 text-primary"
                        : "bg-secondary text-muted-foreground",
                    )}
                  >
                    {r.kind === "setting" ? "Setting" : "Section"}
                  </span>
                  {i === cursor ? (
                    <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
