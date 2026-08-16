"use client";

import {
  ChevronDown,
  ChevronLeft,
  Download,
  Image as ImageIcon,
  LayoutGrid,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SiteHeader } from "@/components/layout/site-header";
import { FloatingDownloadProgress } from "@/features/downloads/floating-progress";
import { categoryIcon } from "@/features/wallpapers/wallpaper-categories";
import {
  DEFAULT_WALLPAPER_SORT,
  sortWallpapers,
  WALLPAPER_SORTS,
  type WallpaperSort,
} from "@/lib/wallpapers-sort";
import { useWallpaperDownload } from "@/features/wallpapers/use-wallpaper-download";
import { haptic } from "@/lib/motion/haptics";
import { playSound } from "@/lib/notifications/sound-fx";
import { cn } from "@/lib/utils";
import {
  popularity,
  resolutionBadge,
  wallpaperAlt,
  wallpaperType,
  WALLPAPER_TYPES,
  type Wallpaper,
  type WallpaperType,
} from "@/lib/wallpapers";

/**
 * /wallpapers — the Wallpaper Gallery, built to public/mainwallpaperpaage.jpg.
 *
 * ── The reference, top to bottom ──────────────────────────────────────────────
 *   1. a quiet top bar: back on the left, search on the right
 *   2. an editorial hero — "Wallpapers", three short lines, "Free" in brand blue
 *   3. a fanned deck of real covers with a resolution chip
 *   4. a scrolling row of category pills, "All" filled, the rest outlined
 *   5. a filter card: Categories, Types, and a tune button
 *   6. a "Popular / View all" section heading
 *   7. a three-across grid of tall cards, each with a download button, a name,
 *      a category and a resolution chip
 *
 * Every one of those is here. Where the reference implies data we do not have,
 * the element is driven by data we DO have rather than dropped or faked:
 *
 * • The chips read "4K" only where the file really is — `resolutionBadge` is
 *   derived from measured pixels, and an unmeasured wallpaper shows no chip at
 *   all. The reference badges everything; badging everything would be a lie
 *   about the product, which is the one edit worth making to a design.
 *
 * • "Types" filters by orientation (Phone / Desktop / Square), computed from
 *   those same real dimensions. It is the one property of a wallpaper a person
 *   filters on that the file itself can answer.
 *
 * • "Popular" is ranked on real likes, saves, comments and downloads, and the
 *   whole section is REPLACED by a plain "All wallpapers" heading while nothing
 *   has any engagement yet — an ordering over all-zero scores would be an
 *   arbitrary list wearing the word "popular".
 *
 * ── Instant, on purpose ───────────────────────────────────────────────────────
 * Opening the viewer is client state, never a navigation: no route change, no
 * fetch, no skeleton. Filtering is a `useMemo` over an array already in memory,
 * so every control responds within the frame it was tapped in.
 *
 * ── Who can do what ───────────────────────────────────────────────────────────
 * A signed-out visitor scrolls the whole library and downloads from it. Liking,
 * saving and commenting belong to signed-in members, so `canEngage` follows the
 * session; the viewer offers a sign-in rather than swallowing the tap.
 */

/*
  Interaction-only — the full-screen viewer and the two ad sheets never render
  until a wallpaper is opened or a download starts, so none of them belong in
  this page's first-load bundle. `WallpaperReels` alone is ~800 lines pulling
  in the comments UI, engagement and share sheet; shipping it unconditionally
  to every /wallpapers visit who never taps a card is dead weight on exactly
  the kind of cold, mobile-Safari load this page needs to stay light for.
*/
const WallpaperReels = dynamic(
  () => import("@/features/wallpapers/wallpaper-reels").then((m) => m.WallpaperReels),
  { ssr: false },
);
const WallpaperRewardAd = dynamic(
  () => import("@/features/wallpapers/wallpaper-reward-ad").then((m) => m.WallpaperRewardAd),
  { ssr: false },
);
const WallpaperLimitSheet = dynamic(
  () => import("@/features/wallpapers/wallpaper-reward-ad").then((m) => m.WallpaperLimitSheet),
  { ssr: false },
);

/** How many the Popular section shows before "View all" opens the rest. */
const POPULAR_PREVIEW = 12;
/** Grid tiles rendered per batch — the initial paint, and each scroll-triggered
 *  step after it. Keeps the DOM/image count proportional to how far someone has
 *  actually scrolled instead of mounting the whole (up to 600-wallpaper) library
 *  at once (owner, 2026-08-16: "wallpaper page appears to be trying to load too
 *  much content at once"). */
const GRID_BATCH = 24;

export function WallpaperExplore({
  items,
  canEngage,
  openReels = false,
  children,
}: {
  items: Wallpaper[];
  canEngage: boolean;
  /** Entered from a "browse full screen" link — skip the grid entirely. */
  openReels?: boolean;
  /**
   * Rendered inside `<main>`, below the grid — the page's readable content
   * (`WallpaperSeoContent`). Passed in as a slot rather than imported here
   * because it is a SERVER component: prose and links that ship as HTML with no
   * JavaScript attached, which importing it into this client module would
   * silently undo.
   */
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [viewer, setViewer] = useState<number | null>(openReels ? 0 : null);
  const { allowance, download, adOpen, closeAd, limitHit, closeLimit, adSeconds } = useWallpaperDownload();
  // The name shown on the ad card — the wallpaper whose download is running.
  const [adFor, setAdFor] = useState("");

  const [category, setCategory] = useState<string>("all");
  const [type, setType] = useState<WallpaperType | "all">("all");
  /*
    Newest by default (owner, 2026-08-09: "make the wallpaper page to show
    wallpaper based on time uploaded, and users can change the sorting").

    It was "popular", which on a library with little engagement is an ordering
    nobody can perceive — everything ties at zero, so the grid looked frozen and
    a wallpaper uploaded this morning could sit anywhere. Upload time is the one
    axis that always moves, so a visitor returning tomorrow sees something new
    at the top, which is the whole reason to open the page again.
  */
  const [sort, setSort] = useState<WallpaperSort>(DEFAULT_WALLPAPER_SORT);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [tuneOpen, setTuneOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  /* The category pills are the REAL categories in the library, most-used first,
     so the row reflects what has actually been published rather than a fixed
     list that could name an empty one. */
  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const w of items) counts.set(w.category, (counts.get(w.category) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [items]);

  /* Types are offered only where at least one wallpaper can answer them. Before
     the dimensions backfill has run, every wallpaper is unmeasured — and a
     filter that can only ever return nothing is worse than no filter. */
  const availableTypes = useMemo(() => {
    const present = new Set(items.map((w) => wallpaperType(w.width, w.height)).filter(Boolean));
    return WALLPAPER_TYPES.filter((t) => present.has(t.id));
  }, [items]);

  /* Real engagement anywhere in the library is what earns the word "Popular". */
  const hasEngagement = useMemo(() => items.some((w) => popularity(w) > 0), [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = items.filter((w) => {
      if (category !== "all" && w.category !== category) return false;
      if (type !== "all" && wallpaperType(w.width, w.height) !== type) return false;
      if (q && !`${w.name} ${w.category}`.toLowerCase().includes(q)) return false;
      return true;
    });

    /*
      Every ordering now goes through the one comparator (lib/wallpapers-sort),
      including "newest".

      That used to be the identity sort, on the reasoning that `items` already
      arrives ordered `sort_order, created_at desc` — true, but it meant "Newest"
      was really "the operator's curation", so a wallpaper pinned with a low
      `sort_order` outranked one uploaded minutes ago. Sorting explicitly makes
      the label honest, and curation still leads on every other ordering through
      the name tiebreak.
    */
    return sortWallpapers(list, sort);
  }, [items, category, type, query, sort]);

  const filtering = category !== "all" || type !== "all" || query.trim().length > 0;
  /* The Popular section caps itself; a filtered or searched list never does —
     hiding results behind "View all" when someone has just narrowed the library
     to nine things would be actively unhelpful. */
  /* The preview cap belongs to the RANKED orderings — a "top" list implies a
     cut-off. A chronological or alphabetical list does not, so those show
     everything. Never capped while filtering: narrowing to nine things and then
     hiding some behind "View all" is actively unhelpful. */
  const ranked = sort === "liked" || sort === "viewed" || sort === "downloaded" || sort === "saved";
  const capped = ranked && hasEngagement && !filtering && !expanded;

  /*
    Progressive grid — only the uncapped path needs it, since "capped" already
    caps itself at POPULAR_PREVIEW. Windowed rather than the whole `filtered`
    array so a library of hundreds never mounts hundreds of tiles the instant
    the page (or a filter) renders; `sentinelRef` below grows it as the visitor
    actually scrolls near the bottom.
  */
  const [visibleCount, setVisibleCount] = useState(GRID_BATCH);
  useEffect(() => {
    setVisibleCount(GRID_BATCH);
  }, [category, type, query, sort, expanded]);

  const shown = capped ? filtered.slice(0, POPULAR_PREVIEW) : filtered.slice(0, visibleCount);
  const hasMore = !capped && shown.length < filtered.length;

  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!hasMore) return;
    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((c) => Math.min(filtered.length, c + GRID_BATCH));
        }
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, filtered.length]);

  const open = useCallback((wallpaper: Wallpaper) => {
    haptic("light");
    playSound("tap");
    // Index into the FULL library, not the filtered view: the viewer scrolls the
    // whole thing, so an index from a filtered array would open the wrong image.
    setViewer(items.indexOf(wallpaper));
  }, [items]);

  const closeViewer = useCallback(() => {
    // Arriving via ?reels=1 means the grid was never the destination — closing
    // should leave the page, not strand the visitor on a grid they didn't ask for.
    if (openReels) {
      if (window.history.length > 1) router.back();
      else router.push("/");
      return;
    }
    setViewer(null);
  }, [openReels, router]);


  const empty = items.length === 0;
  const deck = items.slice(0, 3);
  const deckBadge = resolutionBadge(deck[0]?.width, deck[0]?.height);

  /* The heading names the ORDERING, so the grid always says what it is showing
     — "Most liked" over a like-ranked list, not a generic "All wallpapers". */
  const sortLabel = WALLPAPER_SORTS.find((s) => s.key === sort)?.label ?? "All wallpapers";
  const heading = query.trim()
    ? `Results for “${query.trim()}”`
    : category !== "all"
      ? category
      : sort === DEFAULT_WALLPAPER_SORT
        ? "All wallpapers"
        : sortLabel;

  return (
    <>
      {/*
        🔴 THE SITE HEADER (owner, 2026-08-16: "the landing or download top
        header should also be in the wallpaper page above the search and back
        button, dont remove the search and back button, they should stick to
        the top on scrolling").

        Superseded the fixed white safe-area strip this replaced: that strip
        was a stopgap for a page that had NO header at all, painting one blank
        opaque region over the status bar. A real SiteHeader covers the exact
        same region with real content instead, so the strip is gone. `canvas`
        is deliberately NOT passed — the header stays plain white, matching
        every other canvas-grounded page's header (features, landing).
      */}
      <SiteHeader />
      {/* Top padding clears the FIXED SiteHeader (it isn't in normal flow), so
          the sticky back/search row below starts already at its stuck offset
          instead of rendering hidden behind the header for the first frame. */}
      <main className="frenz-canvas-page min-h-dvh pb-24 pt-[calc(var(--frenz-safe-top,0px)+4rem)]">
        {/*
          🔴 Two loose buttons, not a bar (owner, 2026-08-16: "search and back
          button shouldn't be on separate nav or section, they should be
          alone… on top of the wallpaper page without obstructing any text,
          they should blend in not to be positioned like a second header").

          This used to be a full-width `sticky` strip painted in the canvas
          color — a second opaque header sitting right under the real one,
          and because it's sticky it slides up over whatever has scrolled
          beneath it (the hero deck), cutting across the image. There is no
          bar now: no shared background, no row spanning the width. Each
          button keeps its own small `bg-card` chip (so it still reads against
          any photo) and its own sticky position, floating independently over
          the page content instead of announcing itself as a nav section.
        */}
        <div
          /*
            🔴 z-50, not z-40 (owner, 2026-08-16, twice — first "goes under
            the somethings when scrolling", then "add more z index to the
            search button").

            z-40 fixed the tie against the grid tiles' own `z-30` download
            buttons, but the fanned card-deck's "HD/FULL HD" badge just above
            (line ~372 below) is ALSO `z-40` — and it renders LATER in the
            document (it's part of the headline+deck block right after this
            bar), so at that tie it painted on top instead. z-50 clears both
            the tiles (z-30) and the deck badge (z-40) outright rather than
            chasing each new element that happens to share this bar's value.
          */
          className="pointer-events-none sticky z-50 px-4 pt-3"
          style={{ top: "calc(var(--frenz-safe-top, 0px) + 4rem)" }}
        >
          <div className="pointer-events-none mx-auto flex w-full max-w-3xl items-start justify-between">
            {/*
              The reference draws a hamburger here. This is a back control
              instead, deliberately: a drawer here would be a menu glyph with
              nothing real behind it, the exact dead affordance this codebase
              has had to remove before. Same slot, same white rounded tile, an
              honest icon.

              🔴 Corrected 2026-08-09. This comment previously justified itself
              with "the page already carries the app's bottom navigation" —
              it does not. `MobileNav` is mounted in the (app) layout and
              /wallpapers sits outside it, so for as long as that sentence
              stood, this arrow was the page's ONLY link to anywhere. The site
              footer now renders below the grid, which is the real fix; the
              back control stays because it is still the right control.
            */}
            <Link
              href="/"
              aria-label="Back to home"
              className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-2xl bg-card text-foreground shadow-soft ring-1 ring-inset ring-border/50 transition active:scale-95"
            >
              <ChevronLeft className="h-5 w-5" />
            </Link>
            <button
              type="button"
              onClick={() => setSearchOpen((s) => !s)}
              aria-label={searchOpen ? "Close search" : "Search wallpapers"}
              aria-expanded={searchOpen}
              className={cn(
                "pointer-events-auto flex h-11 w-11 items-center justify-center rounded-2xl shadow-soft ring-1 ring-inset transition active:scale-95",
                searchOpen
                  ? "bg-primary text-primary-foreground ring-primary/40"
                  : "bg-card text-foreground ring-border/50",
              )}
            >
              {searchOpen ? <X className="h-5 w-5" /> : <Search className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/*
          Visible breadcrumb, matching the BreadcrumbList JSON-LD already
          emitted by lib/seo/wallpapers.ts (owner, 2026-08-16 SEO audit) — the
          page had structured data for a trail nothing on screen showed. Kept
          to its own thin row rather than folded into the sticky back/search
          bar above: that bar is deliberately two loose buttons, not a second
          header (owner, 2026-08-16: "shouldn't be positioned like a second
          header"), and this doesn't touch it.
        */}
        <nav aria-label="Breadcrumb" className="mx-auto mt-2 w-full max-w-3xl px-4">
          <ol className="flex items-center gap-2 text-xs text-muted-foreground">
            <li>
              <Link href="/" className="transition hover:text-foreground">
                Home
              </Link>
            </li>
            <li aria-hidden>/</li>
            <li aria-current="page" className="text-foreground">
              Wallpapers
            </li>
          </ol>
        </nav>

        {/* The headline + card deck — NOT sticky, scrolls away normally. */}
        <div className="mx-auto w-full max-w-3xl px-4">
          <div className="relative mt-3 flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 pb-2">
              {/*
                🔴 Small-screen collision (owner, 2026-08-09, with a
                screenshot: the card deck painted straight over the word
                "Wallpapers").

                Not a z-index problem — an arithmetic one. The headline was a
                flat 2.75rem (44px) and the deck a flat 150px wide. On a 430px
                phone that leaves the text column 236px while "Wallpapers" at
                44px extra-bold needs about 240, and a single unbreakable word
                cannot wrap — so it overflowed its column and ran under the
                deck, which paints later and therefore on top.

                Both sides are now proportional instead of fixed, so the two
                columns can never trade places at some untested width:
                the type scales with the viewport up to its designed 44px, and
                the deck takes a share of the row rather than a pixel count.
              */}
              <h1 className="text-[clamp(1.75rem,8.6vw,2.75rem)] font-extrabold leading-[0.95] tracking-[-0.045em] sm:text-6xl">
                Wallpapers
              </h1>
              <p className="mt-3 text-[15px] leading-snug text-muted-foreground sm:text-base">
                Stunning HD wallpapers
                <br />
                for your screen.
                <br />
                <span className="font-semibold text-primary">Free</span> to download.
              </p>
            </div>

            {/* The deck — real covers, and a real entry into the viewer. */}
            {deck.length > 0 ? (
              <button
                type="button"
                onClick={() => open(deck[0]!)}
                aria-label="Browse wallpapers full screen"
                /* A SHARE of the row (38%), capped at the design's 190px, and
                   holding its shape with an aspect ratio rather than a fixed
                   height — see the headline note above. */
                className="relative aspect-[150/168] w-[38%] max-w-[190px] shrink-0"
              >
                {deck.map((w, i) => (
                  <span
                    key={w.id}
                    className={cn(
                      "absolute inset-y-2 left-1/2 block w-[62%] -translate-x-1/2 overflow-hidden rounded-2xl shadow-xl ring-1 ring-black/10 transition-transform duration-300",
                      i === 0 && "z-30 rotate-0",
                      i === 1 && "z-20 -translate-x-[92%] -rotate-[11deg]",
                      i === 2 && "z-10 -translate-x-[8%] rotate-[11deg]",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- public storage CDN; next/image 403s on these */}
                    <img src={w.thumbUrl} alt="" aria-hidden className="h-full w-full object-cover" />
                  </span>
                ))}
                {/* Only where the top cover genuinely is one. */}
                {deckBadge ? (
                  <span className="absolute bottom-1 right-0 z-40 rounded-xl bg-neutral-900/90 px-2.5 py-1 text-center text-white shadow-lg backdrop-blur">
                    <span className="block text-base font-extrabold leading-none">{deckBadge.short}</span>
                    <span className="mt-0.5 block text-[8px] font-bold uppercase tracking-[0.12em] text-white/70">
                      {deckBadge.long}
                    </span>
                  </span>
                ) : null}
              </button>
            ) : null}
          </div>
        </div>

        {/* Search — an inline field under the bar, opened from the icon. */}
        {searchOpen ? (
          <div className="mx-auto mt-2 w-full max-w-3xl px-4">
            <div className="relative animate-in fade-in slide-in-from-top-2 duration-200 motion-reduce:animate-none">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search wallpapers…"
                aria-label="Search wallpapers"
                className="h-12 w-full rounded-2xl bg-card pl-11 pr-11 text-sm shadow-soft outline-none ring-1 ring-inset ring-border/60 focus:ring-2 focus:ring-primary"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted-foreground transition hover:bg-secondary"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* ── 4: category pills ────────────────────────────────────────────── */}
        {!empty ? (
          <div className="mt-4 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="mx-auto flex w-max max-w-none gap-2.5 px-4 sm:w-full sm:max-w-3xl">
              <CategoryPill
                label="All"
                Icon={LayoutGrid}
                active={category === "all"}
                onClick={() => setCategory("all")}
              />
              {categories.map(([name]) => (
                <CategoryPill
                  key={name}
                  label={name}
                  Icon={categoryIcon(name)}
                  active={category === name}
                  onClick={() => setCategory(category === name ? "all" : name)}
                />
              ))}
            </div>
          </div>
        ) : null}

        {/* ── 5: the filter card ───────────────────────────────────────────── */}
        {!empty ? (
          <div className="mx-auto mt-3 w-full max-w-3xl px-4">
            <div className="rounded-3xl bg-card p-2 shadow-soft ring-1 ring-inset ring-border/50">
              <div className="flex items-center gap-2">
                {/*
                  A native <select> under a styled face. On a phone that opens the
                  system picker — faster, familiar, and keyboard/screen-reader
                  correct for free — where a hand-built popover would be a menu we
                  own the accessibility of forever.
                */}
                <SelectPill
                  Icon={LayoutGrid}
                  label={category === "all" ? "Categories" : category}
                  ariaLabel="Filter by category"
                  value={category}
                  onChange={setCategory}
                  options={[
                    { value: "all", label: "All categories" },
                    ...categories.map(([name, count]) => ({ value: name, label: `${name} (${count})` })),
                  ]}
                />
                <SelectPill
                  Icon={ImageIcon}
                  label={type === "all" ? "Types" : (WALLPAPER_TYPES.find((t) => t.id === type)?.label ?? "Types")}
                  ariaLabel="Filter by screen shape"
                  value={type}
                  onChange={(v) => setType(v as WallpaperType | "all")}
                  disabled={availableTypes.length === 0}
                  options={[
                    { value: "all", label: "All types" },
                    ...availableTypes.map((t) => ({ value: t.id, label: t.label })),
                  ]}
                />
                <span aria-hidden className="h-8 w-px shrink-0 bg-border/70" />
                <button
                  type="button"
                  onClick={() => setTuneOpen((t) => !t)}
                  aria-label="Sorting options"
                  aria-expanded={tuneOpen}
                  className={cn(
                    "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition active:scale-95",
                    tuneOpen ? "bg-primary text-primary-foreground" : "bg-secondary text-foreground",
                  )}
                >
                  <SlidersHorizontal className="h-[18px] w-[18px]" />
                </button>
              </div>

              {tuneOpen ? (
                <div className="animate-in fade-in slide-in-from-top-1 border-t border-border/60 px-1 pb-1 pt-3 duration-200 motion-reduce:animate-none">
                  <p className="px-1 text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                    Sort by
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {/*
                      The full set (owner, 2026-08-09: "most liked, most viewed,
                      alphabetically and any other sort").

                      The ENGAGEMENT orderings are hidden while the library has
                      no engagement at all. Offering "Most liked" over a set
                      where every wallpaper has zero likes is a control that
                      visibly does nothing when tapped — the ordering is real,
                      but every row ties, so the grid does not move and the
                      picker looks broken. Chronological and alphabetical always
                      work, so they are always offered.
                    */}
                    {WALLPAPER_SORTS.filter(
                      (s) =>
                        hasEngagement ||
                        !["liked", "viewed", "downloaded", "saved"].includes(s.key),
                    ).map((s) => (
                      <button
                        key={s.key}
                        type="button"
                        onClick={() => setSort(s.key)}
                        aria-pressed={sort === s.key}
                        title={s.hint}
                        className={cn(
                          "rounded-full px-3.5 py-2 text-xs font-bold transition active:scale-95",
                          sort === s.key
                            ? "bg-foreground text-background"
                            : "bg-secondary text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {s.label}
                      </button>
                    ))}
                    {filtering ? (
                      <button
                        type="button"
                        onClick={() => {
                          setCategory("all");
                          setType("all");
                          setQuery("");
                        }}
                        className="rounded-full px-3.5 py-2 text-xs font-bold text-primary transition hover:bg-secondary active:scale-95"
                      >
                        Clear filters
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* ── 6 + 7: section heading and the grid ──────────────────────────── */}
        <div className="mx-auto w-full max-w-3xl px-4 pt-5">
          {empty ? (
            <p className="rounded-2xl border border-dashed border-border/70 px-4 py-10 text-center text-sm text-muted-foreground">
              No wallpapers have been published yet. Check back soon.
            </p>
          ) : (
            <>
              <div className="mb-3 flex items-end justify-between gap-3">
                <h2 className="truncate text-lg font-bold tracking-tight">{heading}</h2>
                {capped && filtered.length > POPULAR_PREVIEW ? (
                  <button
                    type="button"
                    onClick={() => setExpanded(true)}
                    className="shrink-0 text-sm font-semibold text-primary transition active:scale-95"
                  >
                    View all
                  </button>
                ) : (
                  <span className="shrink-0 text-xs font-semibold text-muted-foreground">
                    {filtered.length} design{filtered.length === 1 ? "" : "s"}
                  </span>
                )}
              </div>

              {filtered.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-border/70 px-4 py-10 text-center text-sm text-muted-foreground">
                  Nothing matches that yet.{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setCategory("all");
                      setType("all");
                      setQuery("");
                    }}
                    className="font-semibold text-primary underline-offset-2 hover:underline"
                  >
                    Clear the filters
                  </button>
                  .
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-2.5">
                  {shown.map((wp, i) => (
                    <ExploreTile
                      key={wp.id}
                      wp={wp}
                      index={i}
                      onOpen={() => open(wp)}
                      onDownload={() => {
                        setAdFor(wp.name);
                        download(wp);
                      }}
                    />
                  ))}
                </div>
              )}

              {/* Grows `visibleCount` when it nears the viewport — the rest of
                  the (already in-memory) library mounts in batches as the
                  visitor actually scrolls, instead of all at once up front. */}
              {hasMore ? (
                <div ref={sentinelRef} aria-hidden className="h-px w-full" />
              ) : null}
            </>
          )}
        </div>

        {children}
      </main>

      {viewer !== null ? (
        <WallpaperReels
          items={items}
          startIndex={viewer}
          canEngage={canEngage}
          onClose={closeViewer}
          onDownload={(w) => {
            setAdFor(w.name);
            download(w);
          }}
        />
      ) : null}

      {/*
        🔴 The download popup (owner, 2026-08-09): "let users be notified like a
        pop up when they click on download wallpaper button, and they see it
        started and completed."

        The card that does exactly this already existed — it just was not on
        this page. `FloatingDownloadProgress` is mounted from inside
        `Downloader`, and /wallpapers renders no Downloader, so a wallpaper
        download ran completely silently: no "started", no progress, no
        "complete", and on iOS no "Save to device" tap, which is the step that
        actually puts the file in Photos. Tapping Download appeared to do
        nothing at all.

        `z-[115]` because the reels viewer is a full-screen `z-[100]` overlay —
        at the default 85 the card would render behind the wallpaper and be just
        as invisible as having no card.
      */}
      <FloatingDownloadProgress layerClass="z-[115]" />

      {/* The 30-second ad a free member sees while their wallpaper saves, and
          the sheet shown once the day's five are gone. Both are per-download
          and neither blocks the transfer. */}
      {adOpen ? (
        <WallpaperRewardAd
          seconds={adSeconds}
          wallpaperName={adFor}
          remaining={allowance?.remaining ?? null}
          onClose={closeAd}
        />
      ) : null}
      {limitHit ? <WallpaperLimitSheet limit={allowance?.limit ?? 5} onClose={closeLimit} /> : null}
    </>
  );
}

function CategoryPill({
  label,
  Icon,
  active,
  onClick,
}: {
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex shrink-0 items-center gap-2 rounded-2xl px-4 py-3 text-sm font-bold transition active:scale-95",
        active
          ? "bg-gradient-to-r from-[#6D5CFF] to-[#8B5CF6] text-white shadow-lg shadow-violet-500/25"
          : "bg-card text-foreground shadow-soft ring-1 ring-inset ring-border/50",
      )}
    >
      <Icon className={cn("h-[18px] w-[18px]", !active && "text-primary")} />
      <span className="capitalize">{label}</span>
    </button>
  );
}

/** A dropdown pill: styled face, real <select> on top of it at zero opacity. */
function SelectPill({
  Icon,
  label,
  ariaLabel,
  value,
  onChange,
  options,
  disabled,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative flex min-w-0 flex-1 items-center gap-2 rounded-2xl bg-secondary/60 px-3.5 py-3",
        disabled && "opacity-45",
      )}
    >
      <Icon className="h-[18px] w-[18px] shrink-0 text-primary" />
      <span className="min-w-0 flex-1 truncate text-sm font-semibold capitalize">{label}</span>
      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      <select
        aria-label={ariaLabel}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * One grid tile — cover, download button, name, category, resolution chip.
 *
 * The card is a plain container with TWO buttons layered over it rather than one
 * button wrapping everything: a download control nested inside an open control
 * is invalid HTML, and browsers resolve it by dropping one of them, which is how
 * a download button ends up silently opening the viewer instead. The caption is
 * `pointer-events-none`, so a tap anywhere on the artwork still opens it.
 *
 * The reveal is a pure CSS animation with a capped per-tile delay — no observer,
 * no state, nothing running while the visitor scrolls, and `motion-reduce`
 * removes it entirely rather than merely shortening it.
 */
function ExploreTile({
  wp,
  index,
  onOpen,
  onDownload,
}: {
  wp: Wallpaper;
  index: number;
  onOpen: () => void;
  onDownload: () => void;
}) {
  const badge = resolutionBadge(wp.width, wp.height);
  return (
    <div
      className="group relative aspect-[7/10] animate-in fade-in zoom-in-95 overflow-hidden rounded-2xl bg-neutral-800 ring-1 ring-border/50 duration-500 [animation-fill-mode:backwards] motion-reduce:animate-none"
      // Capped so a long library never staggers into a visible wait.
      style={{ animationDelay: `${Math.min(index, 11) * 35}ms` }}
    >
      {/*
        Real alt text, added 2026-08-09.

        These shipped as `alt="" aria-hidden` — correct markup for decoration and
        wrong for the content of an image gallery. It meant the one page on this
        site whose whole purpose is publishing pictures published none of them:
        Google Images had nothing to index, and a screen-reader user got a grid
        of unnamed buttons. The name and category are the only things we
        truthfully know about the picture, so that is exactly what it says — see
        `wallpaperAlt` for why it is not stuffed with keywords.
      */}
      {/* eslint-disable-next-line @next/next/no-img-element -- public storage CDN; next/image 403s on these */}
      <img
        src={wp.thumbUrl}
        alt={wallpaperAlt(wp)}
        loading={index < 6 ? "eager" : "lazy"}
        className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.04]"
      />

      <button
        type="button"
        onClick={onOpen}
        aria-label={`Open ${wp.name} full screen`}
        className="absolute inset-0 z-10"
      />

      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-2/5 bg-gradient-to-t from-black/80 via-black/35 to-transparent"
      />
      <span className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-end justify-between gap-1 p-2">
        <span className="min-w-0">
          <span className="block truncate text-[11px] font-bold leading-tight text-white">{wp.name}</span>
          <span className="block truncate text-[10px] leading-tight text-white/70">{wp.category}</span>
        </span>
        {badge ? (
          <span className="shrink-0 rounded-md bg-black/55 px-1.5 py-0.5 text-[9px] font-extrabold text-white backdrop-blur-sm">
            {badge.short}
          </span>
        ) : null}
      </span>

      {/* Always visible, as in the reference — on a phone there is no hover, so a
          hover-only download button is a button that does not exist. */}
      <button
        type="button"
        onClick={onDownload}
        aria-label={`Download ${wp.name}`}
        className="absolute right-1.5 top-1.5 z-30 flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-white ring-1 ring-inset ring-white/20 backdrop-blur-md transition hover:bg-black/65 active:scale-90"
      >
        <Download className="h-4 w-4" />
      </button>
    </div>
  );
}
