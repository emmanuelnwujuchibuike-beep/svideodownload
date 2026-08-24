"use client";

import { Clock, Search, TrendingUp, X } from "lucide-react";
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { NotificationBell } from "@/features/app-shell/notification-bell";
import { SearchCommitProvider } from "@/features/search/search-commit";
import { SearchResultsView } from "@/features/search/search-results-view";
import {
  clearRecentSearches,
  pushRecentSearch,
  readRecentSearches,
  removeRecentSearch,
} from "@/features/search/recent-searches";
import { emptySearchResult, type SearchResult, type SearchType } from "@/lib/social/search";
import { cn } from "@/lib/utils";

/**
 * The interactive half of /search: the field, the type tabs, recent/trending
 * shortcuts, and the results.
 *
 * ── What is NOT in here ───────────────────────────────────────────────────
 * The whole discovery screen — creator circles, Trending Now, Suggested for
 * you, Popular videos. It arrives as the `discover` ReactNode prop, already
 * rendered by the server. Passing server output THROUGH a client component
 * keeps it server output; had this component imported those sections instead,
 * four rails of cards would have become client JavaScript for no gain, because
 * none of them is interactive beyond a link and a Follow pill.
 *
 * ── The network contract ──────────────────────────────────────────────────
 *  • Typing sends nothing. A search fires 300ms after the last keystroke.
 *  • Every in-flight request is aborted the moment a newer one starts, so a
 *    slow early response can never overwrite a fast later one.
 *  • (term, tab) results are cached for the life of the screen, bounded to 24
 *    entries — so re-typing a term, switching tabs and switching back are all
 *    free, and the map cannot grow without limit on a long session.
 *  • Clearing the field cancels rather than searching for "".
 *
 * ── Navigation ────────────────────────────────────────────────────────────
 * The URL is kept in step with `history.replaceState`, never `router.push`.
 * A push would re-run the server component on every committed search —
 * re-fetching suggestions, trending tags and the popular-videos rail to
 * repaint a list the client already has. It also means the back gesture
 * leaves /search instead of walking a dozen keystrokes backwards.
 */

const TABS: { id: SearchType; label: string }[] = [
  { id: "all", label: "Top" },
  { id: "people", label: "Users" },
  { id: "video", label: "Videos" },
  { id: "sound", label: "Sounds" },
  { id: "hashtag", label: "Hashtags" },
  { id: "place", label: "Places" },
];

/** Long enough that a normal typist sends one request per word, not per key. */
const DEBOUNCE_MS = 300;
/** Bounded so a long session cannot grow the cache without limit. */
const CACHE_MAX = 24;

export function SearchExperience({
  initialQuery,
  initialType,
  initialResult,
  trendingTerms,
  canFollow,
  discoveryRow,
  discover,
}: {
  initialQuery: string;
  initialType: SearchType;
  initialResult: SearchResult;
  /**
   * Real trending tags that "Trending Now" is NOT already showing as cards —
   * so the two blocks complement each other instead of printing the same six
   * tags twice.
   */
  trendingTerms: string[];
  canFollow: boolean;
  /** Server-rendered creator circles — sits directly under the tabs. */
  discoveryRow: ReactNode;
  /** Server-rendered Trending Now / Suggested for you / Popular videos. */
  discover: ReactNode;
}) {
  const [input, setInput] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const [type, setType] = useState<SearchType>(initialType);
  const [result, setResult] = useState<SearchResult>(initialResult);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [recents, setRecents] = useState<string[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const cache = useRef(new Map<string, SearchResult>([[`${initialQuery}:${initialType}`, initialResult]]));
  const inFlight = useRef<AbortController | null>(null);

  // localStorage is read after mount, never during render — reading it in the
  // render pass would make the server and client HTML disagree.
  useEffect(() => setRecents(readRecentSearches()), []);

  // One listener for the life of the screen, and it only aborts. Nothing here
  // is registered on `window`.
  useEffect(() => () => inFlight.current?.abort(), []);

  const syncUrl = useCallback((term: string, t: SearchType) => {
    const sp = new URLSearchParams();
    if (term) sp.set("q", term);
    if (t !== "all") sp.set("type", t);
    const qs = sp.toString();
    window.history.replaceState(window.history.state, "", qs ? `/search?${qs}` : "/search");
  }, []);

  const run = useCallback(async (term: string, t: SearchType) => {
    const q = term.trim();
    inFlight.current?.abort();
    if (!q) {
      setResult(emptySearchResult());
      setStatus("idle");
      return;
    }

    const key = `${q}:${t}`;
    const cached = cache.current.get(key);
    if (cached) {
      setResult(cached);
      setStatus("idle");
      return;
    }

    const controller = new AbortController();
    inFlight.current = controller;
    setStatus("loading");
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&type=${t}`, { signal: controller.signal });
      if (!res.ok) throw new Error(`search ${res.status}`);
      const data = (await res.json()) as SearchResult;
      if (controller.signal.aborted) return;
      // Oldest-first eviction — Map preserves insertion order, so the first
      // key is the least recently ADDED.
      if (cache.current.size >= CACHE_MAX) {
        const oldest = cache.current.keys().next().value;
        if (oldest !== undefined) cache.current.delete(oldest);
      }
      cache.current.set(key, data);
      setResult(data);
      setStatus("idle");
    } catch {
      // An abort means a newer search took over — that is success, not failure.
      if (controller.signal.aborted) return;
      setStatus("error");
    }
  }, []);

  // Debounce. Clearing the field is exempt: waiting 300ms to show the
  // discovery screen again would feel like the app was thinking about it.
  useEffect(() => {
    const term = input.trim();
    if (term === query) return;
    if (!term) {
      setQuery("");
      syncUrl("", type);
      void run("", type);
      return;
    }
    const id = setTimeout(() => {
      setQuery(term);
      syncUrl(term, type);
      void run(term, type);
    }, DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [input, query, type, run, syncUrl]);

  const commit = useCallback(
    (term: string, t: SearchType = type) => {
      const trimmed = term.trim();
      setInput(trimmed);
      setQuery(trimmed);
      setType(t);
      if (trimmed) setRecents(pushRecentSearch(trimmed));
      syncUrl(trimmed, t);
      void run(trimmed, t);
    },
    [run, syncUrl, type],
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    commit(input);
    // Dismiss the on-screen keyboard — the results are what they want to see now.
    inputRef.current?.blur();
  };

  const pickTab = (t: SearchType) => {
    setType(t);
    syncUrl(query, t);
    if (query) void run(query, t);
  };

  const clear = () => {
    setInput("");
    inputRef.current?.focus();
  };

  const searching = query.length > 0;

  /*
    A stable identity for the provider value, so a keystroke re-render of THIS
    component never invalidates the context for every card below it.
  */
  const commitFn = useMemo(() => (term: string, t?: SearchType) => commit(term, t ?? type), [commit, type]);

  return (
    <SearchCommitProvider value={commitFn}>
    {/* `-mt-4` cancels AppContent's own `pt-4` below `lg`, so the header this
        page took over from the topbar sits flush against the top of the screen
        rather than floating 16px under the status bar. From `lg` the real
        topbar is back and that breathing room is wanted again. */}
    <div className="mx-auto -mt-4 w-full max-w-3xl lg:mt-0">
      {/*
        🔴 THE FIELD IS THE TOP HEADER ON MOBILE (owner, 2026-08-24: "on the
        search page the search icon shouldnt be there, only the search
        placeholder that is supposed to be at the top header where the search
        icon is").

        `AppTopbar` hides itself on this route below `lg` (one condition,
        exactly the pattern `/messages` already uses), so there is no longer a
        near-empty bar holding a magnifier above a search field that does the
        same job. This row takes its place: the field where the icon was, the
        notification bell where the bell was. The topbar drops its own bell on
        this route so it is never mounted twice.

        Sticky, not fixed. A `fixed` bar is what fights the iOS viewport when
        the keyboard opens; a sticky one rides the document and stays put on
        its own. On mobile it pins to the very top and owns the status-bar
        inset itself; from `lg` the topbar is back, so it tucks beneath it —
        offset from the tokens the topbar and announcement bar publish, with
        no measurement, no ResizeObserver and no scroll listener.

        Its ground is the CANVAS colour, not `bg-background`: this page uses
        `AppContent canvas`, so a `bg-background` bar would be a white strip
        sitting on grey until the moment it stuck.
      */}
      <div
        className="sticky top-0 z-20 -mx-3 bg-[hsl(var(--frenz-canvas))] px-3 pb-1 pt-[var(--frenz-safe-top)] sm:-mx-4 sm:px-4 lg:top-[calc(4rem+var(--frenz-safe-top)+var(--frenz-announce-h,0px))] lg:pt-1"
      >
        <div className="flex items-center gap-2">
        <form role="search" onSubmit={submit} className="relative min-w-0 flex-1">
          <label htmlFor="frenz-search" className="sr-only">
            Search Frenzsave
          </label>
          <Search
            aria-hidden
            className="pointer-events-none absolute left-4 top-1/2 h-[19px] w-[19px] -translate-y-1/2 text-muted-foreground"
          />
          <input
            id="frenz-search"
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="Search people, videos, hashtags, sounds..."
            /*
              `text-base` (16px) is not a style choice — iOS Safari zooms the
              whole page in when a focused input is below 16px, which is the
              single most common cause of a "search bar that breaks the
              layout" on iPhone.

              `::-webkit-search-cancel-button` is hidden because `type="search"`
              draws WebKit's own clear glyph — next to ours, on iOS, that is two
              clear buttons in the same corner.
            */
            className="srch-glass srch-field h-[52px] w-full rounded-[18px] pl-11 pr-11 text-base outline-none placeholder:text-muted-foreground focus:ring-0 [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden"
          />
          {/*
            Clear sits INSIDE the field and is absolutely positioned, so it
            fades in and out without ever changing the field's width. A Cancel
            button appearing beside the field — the other common pattern —
            resizes it the instant the keyboard opens, which is exactly the
            layout jump this must not do.
          */}
          <button
            type="button"
            onClick={clear}
            tabIndex={input ? 0 : -1}
            aria-hidden={!input}
            aria-label="Clear search"
            className={cn(
              "absolute right-2.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-secondary text-muted-foreground transition-opacity duration-150",
              input ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </form>
        {/* The bell the hidden topbar would have shown. `lg:hidden` because
            from `lg` the topbar is back and owns it again. */}
        <span className="shrink-0 lg:hidden">
          <NotificationBell />
        </span>
        </div>

        <SearchTabs active={type} onPick={pickTab} />
      </div>

      <div
        id="search-panel"
        role="tabpanel"
        aria-labelledby={`search-tab-${type}`}
        // No bottom padding of its own: AppContent's `pb-24` already clears the
        // mobile nav, and adding a second nav-height pad stacked ~10rem of dead
        // space under the last card.
        className="pt-3"
      >
        {searching ? (
          <SearchResultsView
            query={query}
            type={type}
            result={result}
            status={status}
            canFollow={canFollow}
            onRetry={() => void run(query, type)}
          />
        ) : (
          <div className="space-y-3.5">
            {discoveryRow}
            {recents.length > 0 ? (
              <RecentSearches
                terms={recents}
                onPick={(t) => commit(t)}
                onRemove={(t) => setRecents(removeRecentSearch(t))}
                onClearAll={() => setRecents(clearRecentSearches())}
              />
            ) : null}
            {trendingTerms.length > 0 ? <TrendingSearches terms={trendingTerms} onPick={(t) => commit(t)} /> : null}
            {discover}
          </div>
        )}
      </div>
    </div>
    </SearchCommitProvider>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Tabs
   ──────────────────────────────────────────────────────────────────────── */

/**
 * A CSS scroller with six buttons. The active underline is a `<span>` inside
 * the selected button, not a shared element being measured and translated —
 * so selecting a tab costs one class change and zero layout reads.
 */
function SearchTabs({ active, onPick }: { active: SearchType; onPick: (t: SearchType) => void }) {
  const railRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<SearchType, HTMLButtonElement>());

  /** Centre a tab in the rail. One native scroll on the RAIL only — never
      `scrollIntoView`, which would also scroll the page vertically.
      `behavior` is chosen per call because the CSS `prefers-reduced-motion`
      block cannot override a behaviour passed in JavaScript. */
  const reveal = (el: HTMLElement) => {
    const rail = railRef.current;
    if (!rail) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    rail.scrollTo({
      left: el.offsetLeft - rail.clientWidth / 2 + el.clientWidth / 2,
      behavior: reduced ? "auto" : "smooth",
    });
  };

  return (
    <div
      ref={railRef}
      role="tablist"
      aria-label="Search categories"
      className="srch-rail -mx-1 mt-1 gap-1 px-1"
      onKeyDown={(e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        e.preventDefault();
        const i = TABS.findIndex((t) => t.id === active);
        const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
        if (!next) return;
        onPick(next.id);
        // Roving tabindex: the tab that just lost selection also loses its tab
        // stop, so focus has to travel with the selection or it lands nowhere.
        const el = tabRefs.current.get(next.id);
        if (el) {
          el.focus();
          reveal(el);
        }
      }}
    >
      {TABS.map((t) => {
        const selected = t.id === active;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`search-tab-${t.id}`}
            aria-controls="search-panel"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            ref={(el) => {
              if (el) tabRefs.current.set(t.id, el);
              else tabRefs.current.delete(t.id);
            }}
            onClick={(e) => {
              onPick(t.id);
              reveal(e.currentTarget);
            }}
            className={cn(
              "srch-press relative shrink-0 px-3.5 pb-2.5 pt-2 text-[14.5px] font-semibold transition-colors duration-150",
              selected ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {t.label}
            <span
              aria-hidden
              className={cn(
                "srch-tab-underline absolute inset-x-2.5 bottom-0 h-[2.5px] rounded-full transition-opacity duration-150",
                selected ? "opacity-100" : "opacity-0",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Empty-state shortcuts
   ──────────────────────────────────────────────────────────────────────── */

function RecentSearches({
  terms,
  onPick,
  onRemove,
  onClearAll,
}: {
  terms: string[];
  onPick: (t: string) => void;
  onRemove: (t: string) => void;
  onClearAll: () => void;
}) {
  return (
    <section className="rounded-[22px] border border-border/70 bg-card px-1.5 py-2.5">
      <div className="flex items-center gap-2.5 px-2.5 pb-1.5">
        <Clock className="h-[17px] w-[17px] text-muted-foreground" aria-hidden />
        <h2 className="flex-1 text-[15px] font-semibold">Recent</h2>
        <button
          type="button"
          onClick={onClearAll}
          className="srch-press rounded-lg px-1 py-0.5 text-[13px] font-semibold text-primary"
        >
          Clear all
        </button>
      </div>
      <ul>
        {terms.map((t) => (
          <li key={t} className="flex items-center rounded-xl transition-colors duration-150 hover:bg-secondary/60">
            <button
              type="button"
              onClick={() => onPick(t)}
              className="flex min-w-0 flex-1 items-center gap-3 px-2.5 py-2 text-left"
            >
              <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                <Clock className="h-4 w-4" />
              </span>
              <span className="truncate text-[14px]">{t}</span>
            </button>
            <button
              type="button"
              onClick={() => onRemove(t)}
              aria-label={`Remove ${t} from recent searches`}
              className="srch-press mr-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TrendingSearches({ terms, onPick }: { terms: string[]; onPick: (t: string) => void }) {
  return (
    <section className="rounded-[22px] border border-border/70 bg-card px-4 py-3.5">
      <div className="flex items-center gap-2.5 pb-2.5">
        <TrendingUp className="h-[17px] w-[17px] text-primary" aria-hidden />
        <h2 className="text-[15px] font-semibold">Trending searches</h2>
      </div>
      <div className="flex flex-wrap gap-2">
        {terms.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onPick(t)}
            className="srch-press rounded-full bg-secondary/80 px-3.5 py-1.5 text-[13px] font-medium"
          >
            {t}
          </button>
        ))}
      </div>
    </section>
  );
}
