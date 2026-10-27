"use client";

import { Hash, History, Search, TrendingUp, UserRound, X } from "lucide-react";
import dynamic from "next/dynamic";
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SearchCommitProvider } from "@/features/search/search-commit";
import { TREND_CHIP } from "@/features/search/search-primitives";
import {
  clearRecentSearches,
  isRecentSearchEnabled,
  pushRecentSearch,
  readRecentSearches,
  removeRecentSearch,
  setRecentSearchEnabled,
} from "@/features/search/recent-searches";
import type { SearchResult, SearchType } from "@/lib/social/search";
import { emptySearchResult } from "@/lib/social/search-shared";
import { cn } from "@/lib/utils";

/**
 * The interactive half of /search (design/Frenz-Search-Discover-design.zip, 2026-10-26): Discover until the
 * field is tapped, then Search — the field with Cancel, the type chips, Recent + Trending searches, results.
 *
 * ── What is NOT in here ───────────────────────────────────────────────────
 * The whole Discover screen — creator circles, Trending now, Trending searches, Creators to follow, Explore
 * videos. It arrives as the `discover` ReactNode prop, already rendered by the server. Passing server output
 * THROUGH a client component keeps it server output.
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
 * re-fetching suggestions, trending tags and the videos rail to repaint a list
 * the client already has. It also means the back gesture leaves /search
 * instead of walking a dozen keystrokes backwards.
 *
 * ── Where the design and the app differ ───────────────────────────────────
 * The design puts the field above the type chips; the owner had asked (2026-09-27) for the chips above. The
 * design is the newer word, so the field is first. "Places" stays as a sixth chip (a real search the app has).
 */

/*
  The bell, loaded after the screen rather than in its first bundle: its live stream brings the Supabase client
  (~57 kB gz) and /explore is a cold-entry page. A same-size placeholder holds its place, so nothing moves.
*/
const NotificationBell = dynamic(() => import("@/features/app-shell/notification-bell").then((m) => m.NotificationBell), {
  ssr: false,
  loading: () => <span aria-hidden className="block h-11 w-11" />,
});

// Results only exist once something is searched — their code (rows, tiles, follow) loads then, or with a ?q= entry.
const SearchResultsView = dynamic(() => import("@/features/search/search-results-view").then((m) => m.SearchResultsView));

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
  title = "Discover",
  path = "/search",
}: {
  initialQuery: string;
  initialType: SearchType;
  initialResult: SearchResult;
  /** Real trending tags beyond the six "Trending now" shows — the chips under Recent. */
  trendingTerms: string[];
  canFollow: boolean;
  /** Server-rendered creator circles — directly under the field. */
  discoveryRow: ReactNode;
  /** Server-rendered Discover sections. */
  discover: ReactNode;
  /** The large title over the field while it is not in use. */
  title?: string;
  /** The route this screen lives on — /search, or /explore (the same screen) — kept in the URL as the member searches. */
  path?: string;
}) {
  const [input, setInput] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const [type, setType] = useState<SearchType>(initialType);
  const [result, setResult] = useState<SearchResult>(initialResult);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [recents, setRecents] = useState<string[]>([]);
  // whether this device keeps a search history at all (2026-09-27)
  const [historyOn, setHistoryOn] = useState(true);
  /*
    Discover ↔ Search: the screen opens as Discover. Tapping the field turns it into Search (the field at the
    top with a violet ring and Cancel, the type chips, then Recent + Trending searches until something is
    typed). Cancel clears and goes back to Discover. A blur alone never leaves Search, so a tap on a recent
    term or a chip still lands.
  */
  const [active, setActive] = useState(initialQuery.length > 0);

  const inputRef = useRef<HTMLInputElement>(null);
  const cache = useRef(new Map<string, SearchResult>([[`${initialQuery}:${initialType}`, initialResult]]));
  const inFlight = useRef<AbortController | null>(null);

  // localStorage is read after mount, never during render — reading it in the
  // render pass would make the server and client HTML disagree.
  useEffect(() => {
    setHistoryOn(isRecentSearchEnabled());
    setRecents(readRecentSearches());
  }, []);

  // One listener for the life of the screen, and it only aborts.
  useEffect(() => () => inFlight.current?.abort(), []);

  const syncUrl = useCallback((term: string, t: SearchType) => {
    const sp = new URLSearchParams();
    if (term) sp.set("q", term);
    if (t !== "all") sp.set("type", t);
    const qs = sp.toString();
    window.history.replaceState(window.history.state, "", qs ? `${path}?${qs}` : path);
  }, [path]);

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
      // Oldest-first eviction — Map preserves insertion order.
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

  // Debounce. Clearing the field is exempt: waiting 300ms to empty the results would feel like thinking.
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
      setActive(true);
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

  const pickTab = useCallback(
    (t: SearchType) => {
      setType(t);
      syncUrl(query, t);
      if (query) void run(query, t);
    },
    [query, run, syncUrl],
  );

  const clear = () => {
    setInput("");
    inputRef.current?.focus();
  };

  const cancel = () => {
    inFlight.current?.abort();
    setInput("");
    setQuery("");
    setResult(emptySearchResult());
    setStatus("idle");
    syncUrl("", type);
    setActive(false);
    inputRef.current?.blur();
  };

  const searching = query.length > 0;

  // A stable identity for the provider value, so a keystroke never invalidates the context for every card below.
  const commitFn = useMemo(() => (term: string, t?: SearchType) => commit(term, t ?? type), [commit, type]);

  return (
    <SearchCommitProvider value={commitFn}>
      {/* `-mt-4` cancels AppContent's own `pt-4` below `lg`: the topbar is hidden on this route on mobile, so this
          screen owns the status-bar inset itself. From `lg` the topbar is back. */}
      <div className="frenz-ui mx-auto -mt-4 w-full max-w-3xl px-1 lg:mt-0">
        {/* Sticky only while searching (a sticky bar rides the document, so it never fights the iOS keyboard). */}
        <div
          className={cn(
            "z-20 -mx-4 bg-frenz-page px-4 pb-1 pt-[calc(var(--frenz-safe-top)+0.5rem)] lg:pt-2",
            active && "sticky top-0 lg:top-[calc(4rem+var(--frenz-safe-top)+var(--frenz-announce-h,0px))]",
          )}
        >
          {!active ? (
            <header className="mb-3.5 flex items-center justify-between gap-3">
              <h1 className="font-heading text-[34px] font-extrabold leading-[1.05] tracking-[-1.2px]">{title}</h1>
              {/* the bell the hidden topbar would have shown; from `lg` the topbar owns it */}
              <span className="shrink-0 lg:hidden">
                <NotificationBell />
              </span>
            </header>
          ) : null}

          <div className="flex items-center gap-3">
            <form role="search" onSubmit={submit} className="relative min-w-0 flex-1">
              <label htmlFor="frenz-search" className="sr-only">
                Search Frenz
              </label>
              <Search
                aria-hidden
                className={cn("pointer-events-none absolute left-4 top-1/2 h-[19px] w-[19px] -translate-y-1/2", active ? "text-frenz-violet" : "text-frenz-muted")}
              />
              <input
                id="frenz-search"
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onFocus={() => setActive(true)}
                type="search"
                inputMode="search"
                enterKeyHint="search"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="Search people, videos, sounds"
                /*
                  16px (`text-base`): iOS Safari zooms the page in on a focused input below it. WebKit's own clear
                  glyph is hidden because ours sits in the same corner.
                */
                className={cn(
                  "h-[52px] w-full rounded-[26px] border-2 pl-12 pr-12 text-base text-frenz-ink outline-none placeholder:text-frenz-muted [&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden",
                  active ? "border-frenz-violet bg-frenz-card shadow-[0_0_0_4px_hsl(var(--frenz-violet)/0.14)]" : "border-transparent bg-frenz-fill",
                )}
              />
              {/* inside the field and absolutely placed, so it never changes the field's width */}
              <button
                type="button"
                onClick={clear}
                tabIndex={input ? 0 : -1}
                aria-hidden={!input}
                aria-label="Clear search"
                className={cn(
                  "absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-frenz-fill text-frenz-muted transition-opacity duration-150",
                  input ? "opacity-100" : "pointer-events-none opacity-0",
                )}
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </form>
            {active ? (
              <button type="button" onClick={cancel} className="h-11 shrink-0 px-1 text-[16px] font-bold text-frenz-violet transition-transform active:scale-[0.97]">
                Cancel
              </button>
            ) : null}
          </div>

          {active ? <SearchTabs active={type} onPick={pickTab} /> : null}
        </div>

        <div id="search-panel" role="tabpanel" aria-labelledby={active ? `search-tab-${type}` : undefined} className="pt-3">
          {searching ? (
            <SearchResultsView
              query={query}
              type={type}
              result={result}
              status={status}
              canFollow={canFollow}
              onRetry={() => void run(query, type)}
              onSeeAll={pickTab}
            />
          ) : active ? (
            <div>
              {historyOn ? (
                recents.length > 0 ? (
                  <RecentSearches
                    terms={recents}
                    onPick={(t) => commit(t)}
                    onRemove={(t) => setRecents(removeRecentSearch(t))}
                    onClearAll={() => setRecents(clearRecentSearches())}
                    onTurnOff={() => {
                      setHistoryOn(false);
                      setRecents(setRecentSearchEnabled(false));
                    }}
                  />
                ) : null
              ) : (
                /* with the history off there is no list to hang the switch on, so the way back stands on its own */
                <section className="flex items-center gap-3 rounded-[24px] border border-frenz-line bg-frenz-card px-4 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-bold">Search history is off</span>
                    <span className="block text-[13px] leading-snug text-frenz-muted">What you search isn&apos;t saved on this device.</span>
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={false}
                    aria-label="Save search history on this device"
                    onClick={() => {
                      setHistoryOn(true);
                      setRecents(setRecentSearchEnabled(true));
                    }}
                    className="h-11 shrink-0 px-1 text-[15px] font-bold text-frenz-violet"
                  >
                    Turn on
                  </button>
                </section>
              )}
              {trendingTerms.length > 0 ? <TrendingSearches terms={trendingTerms} onPick={(t) => commit(t)} /> : null}
            </div>
          ) : (
            <div>
              {discoveryRow}
              {discover}
            </div>
          )}
        </div>
      </div>
    </SearchCommitProvider>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Type chips
   ──────────────────────────────────────────────────────────────────────── */

/** Pill chips on one scrolling row. Selecting one is a class change; the rail scrolls itself, never the page. */
function SearchTabs({ active, onPick }: { active: SearchType; onPick: (t: SearchType) => void }) {
  const railRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<SearchType, HTMLButtonElement>());

  /** Centre a chip in the rail — one native scroll on the RAIL only, never `scrollIntoView` (it would move the page). */
  const reveal = (el: HTMLElement) => {
    const rail = railRef.current;
    if (!rail) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    rail.scrollTo({ left: el.offsetLeft - rail.clientWidth / 2 + el.clientWidth / 2, behavior: reduced ? "auto" : "smooth" });
  };

  return (
    <div
      ref={railRef}
      role="tablist"
      aria-label="Search categories"
      className="srch-rail -mx-4 mt-3 scroll-px-4 gap-2 px-4 pb-1"
      onKeyDown={(e) => {
        if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
        e.preventDefault();
        const i = TABS.findIndex((t) => t.id === active);
        const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
        if (!next) return;
        onPick(next.id);
        // roving tabindex: focus travels with the selection or it lands nowhere
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
              "h-11 shrink-0 rounded-full px-[18px] text-[15px] font-bold transition-transform active:scale-[0.97] motion-reduce:active:scale-100",
              selected ? "bg-frenz-ink text-frenz-page" : "border border-frenz-line bg-frenz-card text-frenz-ink/80",
            )}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Recent + Trending searches (the focused, empty field)
   ──────────────────────────────────────────────────────────────────────── */

/** # for a hashtag, a person for an @handle, a clock for anything else — read from the term itself. */
function RecentIcon({ term }: { term: string }) {
  const Icon = term.startsWith("#") ? Hash : term.startsWith("@") ? UserRound : History;
  return (
    <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-frenz-fill text-frenz-muted">
      <Icon className="h-[18px] w-[18px]" strokeWidth={2.2} />
    </span>
  );
}

function RecentSearches({
  terms,
  onPick,
  onRemove,
  onClearAll,
  onTurnOff,
}: {
  terms: string[];
  onPick: (t: string) => void;
  onRemove: (t: string) => void;
  onClearAll: () => void;
  onTurnOff: () => void;
}) {
  return (
    <section aria-labelledby="search-recent" className="overflow-hidden rounded-[24px] border border-frenz-line bg-frenz-card">
      <div className="flex items-center justify-between pl-4 pr-3 pt-1.5">
        <h2 id="search-recent" className="font-heading text-[18px] font-bold tracking-[-0.3px]">
          Recent
        </h2>
        {/* TWO controls, not one: "forget what I searched" and "stop remembering" are different wishes */}
        <button type="button" onClick={onClearAll} className="h-11 px-1 text-[15px] font-bold text-frenz-blue">
          Clear all
        </button>
      </div>
      <ul className="divide-y divide-frenz-line/70 border-y border-frenz-line/70">
        {terms.slice(0, 8).map((t) => (
          <li key={t} className="flex items-center">
            <button type="button" onClick={() => onPick(t)} className="flex min-w-0 flex-1 items-center gap-3 py-2 pl-4 text-left">
              <RecentIcon term={t} />
              <span className="truncate text-[16px] font-semibold">{t}</span>
            </button>
            <button
              type="button"
              onClick={() => onRemove(t)}
              aria-label={`Remove ${t} from recent searches`}
              className="mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-frenz-muted"
            >
              <X className="h-[18px] w-[18px]" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between pl-4 pr-3">
        <span className="text-[14px] text-frenz-muted">Save search history</span>
        <button type="button" onClick={onTurnOff} role="switch" aria-checked aria-label="Save search history on this device" className="h-11 px-1 text-[15px] font-bold text-frenz-violet">
          Turn off
        </button>
      </div>
    </section>
  );
}

function TrendingSearches({ terms, onPick }: { terms: string[]; onPick: (t: string) => void }) {
  return (
    <section aria-labelledby="search-trending">
      <h2 id="search-trending" className="px-1 pb-2.5 pt-[26px] font-heading text-[19px] font-bold tracking-[-0.4px]">
        Trending searches
      </h2>
      <div className="flex flex-wrap gap-2">
        {terms.map((t) => (
          <button key={t} type="button" onClick={() => onPick(t)} className={TREND_CHIP}>
            <TrendingUp className="h-4 w-4 text-frenz-violet" strokeWidth={2.4} aria-hidden />
            {t}
          </button>
        ))}
      </div>
    </section>
  );
}
