"use client";

import { Check, ChevronDown, Clapperboard, Clock, ImageIcon, Search, Sparkles, Star, Type, X } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { aiButtonClass } from "@/features/ai/design/ai-button";
import { loadPromptLibrary } from "@/lib/ai/prompts/catalog";
import { combinePrompt, readiness, requirementLabel, type PromptMode, type PromptSuggestion, type WorkspaceAssets } from "@/lib/ai/prompts/schema";
import { indexSuggestions, searchSuggestions } from "@/lib/ai/prompts/search";
import { cn } from "@/lib/utils";

/**
 * The prompt library — a bottom sheet on a phone, a centred modal from `sm` up (owner's brief,
 * 2026-10-15, §2, §7, §10). Loaded only when "Explore Prompts" is tapped.
 *
 *   search (instant, local) · filter chips: All · Featured · Recent · Favourites · each category
 *   cards: title, one line, what it needs, a preview of the full prompt, ★, "Use Prompt"
 *
 * Nothing here talks to a server: the catalog is a local module, Recent and Favourites live on
 * the device (localStorage, per tool), search never sends a request or an analytics event. Cards
 * render progressively (a page at a time as the list scrolls) so a low-end phone never lays out
 * the whole library at once.
 */

export interface PromptLibraryProps {
  mode: PromptMode;
  currentPrompt: string;
  max: number;
  assets: WorkspaceAssets;
  /** the suggestion, and the prompt text to put in the field */
  onChoose: (s: PromptSuggestion, next: string) => void;
  onClose: () => void;
}

const PAGE = 24;
const RECENT_MAX = 8;
const store = (kind: "recent" | "fav", mode: PromptMode) => `frenz:ai:prompts:${kind}:${mode}`;

function readIds(key: string): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function writeIds(key: string, ids: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    /* storage blocked — the list simply isn't remembered */
  }
}

type Filter = "all" | "featured" | "recent" | "favorites" | string;
type Row = { kind: "heading"; key: string; title: string } | { kind: "card"; key: string; s: PromptSuggestion };

export function PromptLibrary({ mode, currentPrompt, max, assets, onChoose, onClose }: PromptLibraryProps) {
  const data = useMemo(() => loadPromptLibrary(mode), [mode]);
  const index = useMemo(() => indexSuggestions(data.suggestions, data.categories), [data]);
  const byId = useMemo(() => new Map(data.suggestions.map((s) => [s.id, s])), [data]);
  const catTitle = useMemo(() => new Map(data.categories.map((c) => [c.id, c.title])), [data]);

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [recent, setRecent] = useState<string[]>([]);
  const [favs, setFavs] = useState<string[]>([]);
  const [shown, setShown] = useState(PAGE);
  const [pending, setPending] = useState<PromptSuggestion | null>(null);

  useEffect(() => {
    setRecent(readIds(store("recent", mode)).filter((id) => byId.has(id)));
    setFavs(readIds(store("fav", mode)).filter((id) => byId.has(id)));
  }, [mode, byId]);

  /* ── what to show ── */
  const rows = useMemo<Row[]>(() => {
    const q = query.trim();
    const pick = (ids: string[]) => ids.map((id) => byId.get(id)).filter((s): s is PromptSuggestion => !!s);
    const cards = (list: PromptSuggestion[], prefix: string): Row[] => list.map((s) => ({ kind: "card", key: `${prefix}:${s.id}`, s }));
    if (q) {
      const hits = searchSuggestions(index, q).filter((s) => filter === "all" || filter === "featured" || filter === "recent" || filter === "favorites" || s.category === filter);
      return cards(hits, "q");
    }
    if (filter === "featured") return cards(data.suggestions.filter((s) => s.featured), "f");
    if (filter === "recent") return cards(pick(recent), "r");
    if (filter === "favorites") return cards(pick(favs), "v");
    if (filter !== "all") return cards(data.suggestions.filter((s) => s.category === filter), "c");
    // All: recently used and featured first, then every category in order
    const out: Row[] = [];
    if (recent.length) out.push({ kind: "heading", key: "h:recent", title: "Recently used" }, ...cards(pick(recent).slice(0, 4), "r"));
    out.push({ kind: "heading", key: "h:featured", title: "Featured" }, ...cards(data.suggestions.filter((s) => s.featured), "f"));
    for (const c of data.categories) {
      out.push({ kind: "heading", key: `h:${c.id}`, title: c.title }, ...cards(data.suggestions.filter((s) => s.category === c.id), c.id));
    }
    return out;
  }, [query, filter, index, data, byId, recent, favs]);

  // a new search or filter starts at the top with one page
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    setShown(PAGE);
    listRef.current?.scrollTo({ top: 0 });
  }, [query, filter]);

  // progressive rendering: the next page when the end of the list comes near
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || shown >= rows.length || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((e) => {
      if (e.some((x) => x.isIntersecting)) setShown((n) => n + PAGE);
    }, { root: listRef.current, rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [shown, rows.length]);

  /* ── choosing ── */
  const finish = useCallback(
    (s: PromptSuggestion, how: "replace" | "append") => {
      const nextRecent = [s.id, ...recent.filter((id) => id !== s.id)].slice(0, RECENT_MAX);
      writeIds(store("recent", mode), nextRecent);
      onChoose(s, combinePrompt(currentPrompt, s.prompt, how, max));
    },
    [recent, mode, onChoose, currentPrompt, max],
  );
  const use = (s: PromptSuggestion) => {
    if (currentPrompt.trim()) setPending(s);
    else finish(s, "replace");
  };
  const toggleFav = (id: string) => {
    const next = favs.includes(id) ? favs.filter((x) => x !== id) : [id, ...favs];
    setFavs(next);
    writeIds(store("fav", mode), next);
  };

  /* ── dialog behaviour: focus in, Escape out, focus kept inside, page beneath not scrolling ── */
  const titleId = useId();
  const panel = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    const body = document.body;
    const prev = body.style.overflowY;
    body.style.overflowY = "hidden"; // the app's overlay convention (lib/dom/scroll-lock.ts)
    // a precise pointer gets the search box; a phone keeps its keyboard down until the member taps it
    const fine = window.matchMedia?.("(pointer: fine)").matches;
    const t = window.setTimeout(() => (fine ? searchRef.current?.focus() : panel.current?.focus()), 30);
    return () => {
      window.clearTimeout(t);
      body.style.overflowY = prev;
    };
  }, []);
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      if (pending) setPending(null);
      else onClose();
      return;
    }
    if (e.key !== "Tab" || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), input, [href], [tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null);
    if (!items.length) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const chips: { id: Filter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "featured", label: "Featured" },
    ...(recent.length ? [{ id: "recent", label: "Recent" }] : []),
    ...(favs.length ? [{ id: "favorites", label: "Favourites" }] : []),
    ...data.categories.map((c) => ({ id: c.id, label: c.title })),
  ];

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-6" onKeyDown={onKeyDown}>
      <button type="button" aria-label="Close prompt ideas" onClick={onClose} className="absolute inset-0 cursor-default bg-black/45 backdrop-blur-[2px] animate-in fade-in duration-150 motion-reduce:animate-none" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "relative flex w-full flex-col overflow-hidden bg-background shadow-[0_-12px_48px_-12px_rgba(30,27,75,0.45)] outline-none",
          "h-[88dvh] rounded-t-[1.75rem] ring-1 ring-black/5 dark:ring-white/10",
          "sm:h-[min(44rem,88dvh)] sm:max-w-2xl sm:rounded-[1.75rem]",
          "animate-in slide-in-from-bottom-6 fade-in duration-200 motion-reduce:animate-none sm:slide-in-from-bottom-2",
        )}
      >
        {/* header */}
        <div className="shrink-0 border-b border-border/60 bg-gradient-to-b from-indigo-500/[0.06] to-transparent px-4 pb-3 pt-2.5 dark:from-indigo-400/[0.08]">
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-border sm:hidden" aria-hidden />
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 text-white shadow-[0_6px_16px_-8px_rgba(79,70,229,0.8)]" aria-hidden>
              <Sparkles className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-[16px] font-bold tracking-[-0.015em]">
                Prompt ideas
              </h2>
              <p className="text-[12px] text-muted-foreground">
                {mode === "text_to_video" ? "Text to Video" : "Image to Video"} · {data.suggestions.length} ready-to-use prompts
              </p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground">
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>

          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search: action, anime, product, African movie…"
              aria-label="Search prompt ideas"
              enterKeyHint="search"
              className="h-11 w-full rounded-xl bg-card pl-10 pr-3 text-[15px] outline-none ring-1 ring-inset ring-black/[0.08] transition placeholder:text-muted-foreground/80 focus:ring-2 focus:ring-indigo-400 dark:ring-white/10"
            />
          </div>

          <div role="tablist" aria-label="Categories" className="-mx-4 mt-2.5 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {chips.map((c) => (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={filter === c.id}
                onClick={() => setFilter(c.id)}
                className={cn(
                  "inline-flex min-h-[2.25rem] shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold transition",
                  filter === c.id
                    ? "bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 text-white shadow-[0_4px_14px_-6px_rgba(79,70,229,0.7)]"
                    : "bg-secondary/70 text-foreground/80 hover:bg-secondary",
                )}
              >
                {c.id === "featured" ? <Sparkles className="h-3.5 w-3.5" aria-hidden /> : c.id === "recent" ? <Clock className="h-3.5 w-3.5" aria-hidden /> : c.id === "favorites" ? <Star className="h-3.5 w-3.5" aria-hidden /> : null}
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* the list */}
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-14 text-center">
              <Search className="h-6 w-6 text-muted-foreground" aria-hidden />
              <p className="mt-3 text-[14px] font-semibold">No matching prompts found.</p>
              <p className="mt-1 text-[13px] text-muted-foreground">Try another keyword or write your own prompt.</p>
            </div>
          ) : (
            <ul className="space-y-2.5" aria-label="Prompt ideas">
              {rows.slice(0, shown).map((r) =>
                r.kind === "heading" ? (
                  <li key={r.key} className="px-1 pb-0.5 pt-3 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground first:pt-0" role="presentation">
                    {r.title}
                  </li>
                ) : (
                  <li key={r.key}>
                    <PromptCard
                      s={r.s}
                      mode={mode}
                      category={catTitle.get(r.s.category) ?? ""}
                      favourite={favs.includes(r.s.id)}
                      ready={readiness(r.s, mode, assets).kind === "ready"}
                      onFavourite={() => toggleFav(r.s.id)}
                      onUse={() => use(r.s)}
                    />
                  </li>
                ),
              )}
            </ul>
          )}
          {shown < rows.length ? <div ref={sentinel} className="h-8" aria-hidden /> : null}
        </div>

        {/* existing text is never overwritten silently */}
        {pending ? (
          <div className="absolute inset-0 z-10 flex items-end justify-center bg-black/35 p-3 sm:items-center" role="alertdialog" aria-modal="true" aria-labelledby={`${titleId}-c`}>
            <div className="w-full max-w-sm rounded-2xl bg-card p-4 shadow-2xl ring-1 ring-black/5 dark:ring-white/10">
              <h3 id={`${titleId}-c`} className="text-[15px] font-bold">
                You already have a prompt
              </h3>
              <p className="mt-1 text-[13px] leading-snug text-muted-foreground">Replace it with “{pending.title}”, or add the idea after what you wrote?</p>
              <div className="mt-4 grid gap-2">
                <button type="button" autoFocus onClick={() => finish(pending, "replace")} className={aiButtonClass({ size: "sm", block: true, className: "min-h-[2.75rem]" })}>
                  Replace Existing Prompt
                </button>
                <button type="button" onClick={() => finish(pending, "append")} className={aiButtonClass({ variant: "secondary", size: "sm", block: true, className: "min-h-[2.75rem]" })}>
                  Add to Existing Prompt
                </button>
                <button type="button" onClick={() => setPending(null)} className="min-h-[2.75rem] rounded-full text-[14px] font-semibold text-muted-foreground hover:text-foreground">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

function PromptCard({
  s,
  mode,
  category,
  favourite,
  ready,
  onFavourite,
  onUse,
}: {
  s: PromptSuggestion;
  mode: PromptMode;
  category: string;
  favourite: boolean;
  ready: boolean;
  onFavourite: () => void;
  onUse: () => void;
}) {
  const [preview, setPreview] = useState(false);
  const previewId = useId();
  const needs = s.requiredAssets !== "none";
  const NeedIcon = s.requiredAssets === "none" ? Type : s.requiredAssets === "image" ? ImageIcon : Clapperboard;
  return (
    <article className="group rounded-2xl bg-card p-3.5 ring-1 ring-inset ring-black/[0.07] transition [@media(hover:hover)]:hover:ring-indigo-400/40 dark:ring-white/10">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[14.5px] font-bold leading-snug tracking-[-0.01em]">{s.title}</h3>
          <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">{s.description}</p>
        </div>
        <button
          type="button"
          onClick={onFavourite}
          aria-pressed={favourite}
          aria-label={favourite ? `Remove ${s.title} from favourites` : `Add ${s.title} to favourites`}
          className="-mr-1.5 -mt-1.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-secondary"
        >
          <Star className={cn("h-[18px] w-[18px]", favourite && "fill-amber-400 text-amber-500")} aria-hidden />
        </button>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11.5px] font-semibold">
        <span className="rounded-full bg-secondary/80 px-2 py-0.5 text-foreground/75">{category}</span>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5",
            !needs ? "bg-cyan-500/10 text-cyan-700 dark:text-cyan-300" : ready ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/10 text-amber-700 dark:text-amber-300",
          )}
        >
          {needs && ready ? <Check className="h-3 w-3" aria-hidden /> : <NeedIcon className="h-3 w-3" aria-hidden />}
          {requirementLabel(s, mode)}
        </span>
      </div>

      {/* the preview of what it will generate is the full prompt itself, readable before choosing — and exactly the text
          that goes into the field, so the page translator leaves it as it is (titles and descriptions are translated) */}
      <p id={previewId} translate="no" className={cn("mt-2.5 whitespace-pre-line rounded-xl bg-secondary/45 px-3 py-2.5 text-[12.5px] leading-relaxed text-foreground/80", !preview && "line-clamp-2")}>
        {s.prompt}
      </p>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setPreview((p) => !p)}
          aria-expanded={preview}
          aria-controls={previewId}
          className="inline-flex min-h-[2.5rem] items-center gap-1 rounded-full px-2.5 text-[13px] font-semibold text-indigo-600 hover:bg-indigo-500/10 dark:text-indigo-300"
        >
          {preview ? "Hide prompt" : "Preview prompt"}
          <ChevronDown className={cn("h-4 w-4 transition", preview && "rotate-180")} aria-hidden />
        </button>
        <button type="button" onClick={onUse} aria-label={`Use prompt: ${s.title}`} className={aiButtonClass({ size: "sm", className: "ml-auto min-h-[2.5rem] px-4" })}>
          Use Prompt
        </button>
      </div>
    </article>
  );
}
