"use client";

import {
  ChevronDown,
  ChevronLeft,
  CloudUpload,
  Crown,
  Download,
  Image as ImageIcon,
  LayoutGrid,
  Loader2,
  Search,
  SlidersHorizontal,
  Smartphone,
  Upload,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Portal } from "@/components/ui/portal";
import { FloatingDownloadProgress } from "@/features/downloads/floating-progress";
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
  wallpaperCredit,
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
const WallpaperProSheet = dynamic(
  () => import("@/features/wallpapers/wallpaper-reward-ad").then((m) => m.WallpaperProSheet),
  { ssr: false },
);

/** Glass over an image: translucent fill, hairline, blur. Never on a white surface. */
const GLASS = "border border-white/30 bg-white/[0.16] shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_8px_24px_rgba(10,6,30,0.25)] backdrop-blur-xl backdrop-saturate-[1.8]";
const GLASS_SOFT = "border border-white/30 bg-white/[0.16] backdrop-blur-xl";

/** How many the Popular section shows before "View all" opens the rest. */
const POPULAR_PREVIEW = 12;
/**
 * How many wallpapers the grid shows before "See more" (owner, 2026-08-23).
 *
 * Replaces a 24-per-batch infinite scroll. A fixed first page is what makes the
 * footer and everything below the grid reachable again on a 600-wallpaper
 * library — with the observer, the page grew as fast as you could scroll it.
 */
const WALLPAPER_PREVIEW = 30;
/**
 * How many each "See more" adds (owner, 2026-10-04).
 *
 * 🔴 It used to add ALL of them. `showAll` was a boolean, so one tap on a
 * 600-wallpaper library mounted 570 more tiles in a single commit — which is
 * the stall the owner is describing: "see more opening all total causing
 * lagging when a user scrolls fast."
 *
 * A page is ten. That keeps every expansion a small, constant amount of work no
 * matter how large the library grows, which a single `showAll` can never do:
 * its cost is the size of the library, so it gets worse with success.
 */
const WALLPAPER_PAGE = 10;

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
  const { allowance, download, adOpen, closeAd, limitHit, closeLimit, proRequired, closeProRequired, adSeconds } =
    useWallpaperDownload();
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
  const [expanded, setExpanded] = useState(false);

  /*
    The upload button (owner, 2026-08-23: "put a premium, noticeable upload
    button in the wallpaper page so users can see they can upload wallpapers
    and they should be able to mark more than one").

    The backend for this already existed — `/api/wallpapers/share` is how a
    signed-in member publishes their own image to the public library — but
    nothing on THIS page surfaced it: the only entry point was a muted, dashed
    text link buried on the download page. `multiple` on the file input plus
    the route's batch support (extended alongside this) is the "mark more than
    one" part: picking five photos is one upload, not five round trips.
  */
  const uploadInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [uploadSignIn, setUploadSignIn] = useState(false);
  useEffect(() => {
    if (!uploadMsg) return;
    const t = setTimeout(() => setUploadMsg(null), 4000);
    return () => clearTimeout(t);
  }, [uploadMsg]);

  const startUpload = useCallback(() => {
    haptic("light");
    playSound("tap");
    if (!canEngage) {
      setUploadSignIn(true);
      return;
    }
    uploadInput.current?.click();
  }, [canEngage]);

  const uploadFiles = useCallback(
    async (files: File[]) => {
      setUploading(true);
      setUploadMsg(null);
      try {
        const form = new FormData();
        for (const f of files) form.append("files", f);
        const res = await fetch("/api/wallpapers/share", { method: "POST", body: form });
        const json = (await res.json()) as { ok?: boolean; created?: number; failed?: string[]; error?: string };
        if (res.ok && json.ok) {
          const n = json.created ?? files.length;
          haptic("medium");
          setUploadMsg({
            ok: true,
            text:
              n > 1
                ? `${n} wallpapers uploaded — live in the library now.`
                : "Uploaded — it's live in the library now.",
          });
          router.refresh();
        } else {
          setUploadMsg({ ok: false, text: json.error ?? "Couldn't upload that." });
        }
      } catch {
        setUploadMsg({ ok: false, text: "Network error — try again." });
      } finally {
        setUploading(false);
        if (uploadInput.current) uploadInput.current.value = "";
      }
    },
    [router],
  );

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
  const clearFilters = useCallback(() => {
    setCategory("all");
    setType("all");
    setQuery("");
  }, []);
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
    🔴 THIRTY, THEN AN EXPLICIT "See more" (owner, 2026-08-23: "make wallpapers
    in wallpaper page to show only 30 wallpaper and a see more button that
    brings all out in grid, so users can scroll to the bottom easily when they
    didn't press see more, and put a see less button at the top and end").

    This REPLACES an infinite scroll: an IntersectionObserver grew the grid by
    24 every time the visitor neared the bottom. That is precisely what the
    owner is describing as the problem — with a 600-wallpaper library the page
    kept growing as you scrolled, so the footer and everything under the grid
    were unreachable in practice. A fixed first page with a real button hands
    the length of the page back to the person.

    The observer is gone rather than merely capped: keeping it would mean the
    grid still grew on its own while a "See more" button sat there claiming to
    be the way to see more.
  */
  /*
    How many tiles the grid is currently willing to render. A NUMBER, not a
    boolean: each "See more" raises it by one page, so the grid grows by a fixed
    ten whatever the library's size.
  */
  const [limit, setLimit] = useState(WALLPAPER_PREVIEW);
  /* Any change to the filters starts a fresh list, so an expansion from the
     previous one must not silently carry over into it. */
  useEffect(() => {
    setLimit(WALLPAPER_PREVIEW);
  }, [category, type, query, sort, expanded]);

  const shown = capped ? filtered.slice(0, POPULAR_PREVIEW) : filtered.slice(0, limit);
  const remaining = capped ? 0 : Math.max(0, filtered.length - limit);
  const hasMore = remaining > 0;
  /* The "See less" pair only makes sense once the grid was actually expanded —
     and only when collapsing would really remove something. */
  const canCollapse = !capped && limit > WALLPAPER_PREVIEW;

  /*
    Collapsing from the BOTTOM button would otherwise leave the viewport
    somewhere inside a grid that no longer extends that far, which reads as the
    page having jumped. Returning to the grid heading is the one position that
    is still meaningful after the list shrinks.
  */
  const gridTopRef = useRef<HTMLDivElement>(null);
  const collapse = useCallback(() => {
    setLimit(WALLPAPER_PREVIEW);
    gridTopRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, []);

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

  /*
    The redesign (design/Wallpapers.dc.html, owner 2026-10-18): the FEATURED wallpaper is a full-bleed
    header — the first in the library's own order (the operator's curation), never a stock picture.
    Glass is used only here, over that image; the white sheet below is solid. "Get this one" is the
    real download, "Preview" opens the existing full-screen viewer on it.
  */
  const featured = items[0] ?? null;
  const featuredBadge = resolutionBadge(featured?.width, featured?.height);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const openSearch = useCallback(() => {
    setSearchOpen(true);
    // the field lives at the top of the sheet: bring it up, then focus it
    requestAnimationFrame(() => {
      searchRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      searchRef.current?.focus({ preventScroll: true });
    });
  }, []);
  const filterCount = (type !== "all" ? 1 : 0) + (category !== "all" ? 1 : 0);

  return (
    <>
      <main className="frenz-ui min-h-dvh bg-frenz-page pb-24 text-frenz-ink">
        {/* ── the featured header (glass only over the image) ─────────────────── */}
        <section className="relative h-[470px] overflow-hidden bg-frenz-ink" aria-label="Featured wallpaper">
          {featured ? (
            // eslint-disable-next-line @next/next/no-img-element -- public storage CDN; next/image 403s on these
            <img src={featured.thumbUrl} alt={wallpaperAlt(featured)} fetchPriority="high" className="absolute inset-0 h-full w-full object-cover" />
          ) : null}
          <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/45 to-transparent" />
          <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[300px] bg-gradient-to-t from-[rgba(10,6,30,0.82)] to-transparent" />

          <div className="absolute inset-x-4 flex items-center justify-between" style={{ top: "calc(var(--frenz-safe-top, 0px) + 14px)" }}>
            <Link href="/" aria-label="Back to home" className={cn(GLASS, "flex h-11 w-11 items-center justify-center rounded-full text-white transition active:scale-95")}>
              <ChevronLeft className="h-5 w-5" aria-hidden />
            </Link>
            <div className={cn(GLASS, "flex h-11 items-center rounded-full")}>
              <button type="button" onClick={openSearch} aria-label="Search wallpapers" className="flex h-11 w-11 items-center justify-center rounded-full text-white transition active:scale-95">
                <Search className="h-[18px] w-[18px]" aria-hidden />
              </button>
              <button type="button" onClick={startUpload} disabled={uploading} aria-label="Upload your own wallpapers" className="flex h-11 w-11 items-center justify-center rounded-full text-white transition active:scale-95 disabled:opacity-60">
                {uploading ? <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden /> : <Upload className="h-[18px] w-[18px]" aria-hidden />}
              </button>
            </div>
          </div>

          <div className="absolute inset-x-5 top-[214px] flex flex-col gap-2.5">
            <span className={cn(GLASS_SOFT, "self-start rounded-full px-2.5 py-1 text-xs font-bold tracking-[0.4px] text-white")}>
              FEATURED{featuredBadge ? ` · ${featuredBadge.short} ${featuredBadge.long}`.toUpperCase() : ""}
            </span>
            <h1 className="m-0 font-heading text-[40px] font-extrabold leading-none tracking-[-1.5px] text-white">Wallpapers</h1>
            <p className="m-0 text-[15px] leading-snug text-white/85">
              {items.length.toLocaleString()} {items.length === 1 ? "design" : "designs"}. Free to download.
            </p>
            {featured ? (
              <div className="mt-1 flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setAdFor(featured.name);
                    download(featured);
                  }}
                  aria-label={`Download ${featured.name}`}
                  className="flex h-11 items-center gap-2 rounded-full bg-frenz-gradient-x px-[18px] text-[15px] font-bold text-white shadow-[0_10px_24px_-8px_rgba(91,63,240,0.8)] transition active:scale-[0.98]"
                >
                  {featured.proOnly ? <Crown className="h-[18px] w-[18px]" aria-hidden /> : <Download className="h-[18px] w-[18px]" aria-hidden />}
                  Get this one
                </button>
                <button type="button" onClick={() => open(featured)} aria-label={`Preview ${featured.name} full screen`} className={cn(GLASS, "flex h-11 items-center gap-2 rounded-full px-4 text-[15px] font-bold text-white transition active:scale-[0.98]")}>
                  <Smartphone className="h-[18px] w-[18px]" aria-hidden />
                  Preview
                </button>
              </div>
            ) : null}
          </div>

          {/* glass category chips; Categories and Types live behind the one filter button */}
          {!empty ? (
            <div className="absolute inset-x-0 bottom-10 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="flex w-max gap-2 px-4">
                <button
                  type="button"
                  onClick={() => setFiltersOpen(true)}
                  aria-label={filterCount ? `Filters, ${filterCount} on` : "Filters"}
                  aria-haspopup="dialog"
                  className={cn(GLASS_SOFT, "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white transition active:scale-95")}
                >
                  <SlidersHorizontal className="h-[18px] w-[18px]" aria-hidden />
                  {filterCount ? <span aria-hidden className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-frenz-gradient px-1 text-[10px] font-extrabold text-white">{filterCount}</span> : null}
                </button>
                <Chip label="All" active={category === "all"} onClick={() => setCategory("all")} />
                {categories.map(([name]) => (
                  <Chip key={name} label={name} active={category === name} onClick={() => setCategory(category === name ? "all" : name)} />
                ))}
              </div>
            </div>
          ) : null}
        </section>

        {/* ── the white sheet over it ─────────────────────────────────────────── */}
        <section className="relative -mt-[26px] rounded-t-[28px] bg-frenz-page px-4 pt-2" aria-labelledby="wallpapers-grid-heading">
          <div aria-hidden className="mx-auto mb-3.5 h-[5px] w-9 rounded-full bg-[#E2DFEC] dark:bg-white/20" />

          {searchOpen ? (
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-frenz-muted" aria-hidden />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search wallpapers"
                aria-label="Search wallpapers"
                className="h-11 w-full rounded-2xl border-0 bg-frenz-fill pl-11 pr-11 text-[16px] text-frenz-ink outline-none focus-visible:ring-2 focus-visible:ring-frenz-violet/40 [&::-webkit-search-cancel-button]:appearance-none"
              />
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setSearchOpen(false);
                }}
                aria-label="Close search"
                className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-frenz-muted"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ) : null}

          {empty ? (
            <p className="rounded-2xl border border-dashed border-frenz-line px-4 py-10 text-center text-sm text-frenz-muted">No wallpapers have been published yet. Check back soon.</p>
          ) : (
            <>
              {/* Scroll target for "See less" and search — see `collapse`. */}
              <div ref={gridTopRef} className="flex scroll-mt-4 items-center justify-between gap-3 px-1 pb-3.5">
                <div className="flex min-w-0 items-baseline gap-2">
                  <h2 id="wallpapers-grid-heading" className={cn("m-0 truncate font-heading text-[clamp(1.125rem,5.4vw,1.3125rem)] font-bold tracking-[-0.5px]", category !== "all" && !query.trim() && "capitalize")}>
                    {heading}
                  </h2>
                  <span className="shrink-0 text-[13px] font-semibold text-frenz-muted">{filtered.length.toLocaleString()}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {capped && filtered.length > POPULAR_PREVIEW ? (
                    <button type="button" onClick={() => setExpanded(true)} className="min-h-11 text-sm font-bold text-frenz-blue">
                      View all
                    </button>
                  ) : canCollapse ? (
                    /* The TOP "See less" (owner, 2026-08-23): the way back without scrolling to the end. */
                    <button type="button" onClick={collapse} className="min-h-11 text-sm font-bold text-frenz-blue">
                      See less
                    </button>
                  ) : null}
                  {/* the design's sort button — a real <select> under the face, so the phone's own picker opens */}
                  <label className="relative flex h-9 items-center gap-1.5 rounded-full bg-frenz-fill px-3 text-sm font-bold">
                    <span>{WALLPAPER_SORTS.find((s) => s.key === sort)?.label ?? "Sort"}</span>
                    <ChevronDown className="h-4 w-4" aria-hidden />
                    <select
                      aria-label="Sort wallpapers"
                      value={sort}
                      onChange={(e) => setSort(e.target.value as WallpaperSort)}
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    >
                      {/* engagement orderings only once anything has engagement — see the note in the filters */}
                      {WALLPAPER_SORTS.filter((s) => hasEngagement || !["liked", "viewed", "downloaded", "saved"].includes(s.key)).map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              {filtered.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-frenz-line px-4 py-10 text-center text-sm text-frenz-muted">
                  Nothing matches that yet.{" "}
                  <button type="button" onClick={clearFilters} className="font-semibold text-frenz-blue underline-offset-2 hover:underline">
                    Clear the filters
                  </button>
                  .
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
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

              {/* "See more" says what the tap does and what is left (owner, 2026-10-04) — a secondary action, so white, not the gradient */}
              {hasMore ? (
                <button
                  type="button"
                  onClick={() => setLimit((n) => n + WALLPAPER_PAGE)}
                  className="mt-4 flex min-h-12 w-full items-center justify-center rounded-2xl border border-frenz-line bg-frenz-card px-6 text-sm font-bold text-frenz-ink shadow-frenz-card transition active:scale-[0.99]"
                >
                  See {Math.min(WALLPAPER_PAGE, remaining)} more · {remaining.toLocaleString()} left
                </button>
              ) : canCollapse ? (
                <button type="button" onClick={collapse} className="mt-4 flex min-h-12 w-full items-center justify-center rounded-2xl border border-frenz-line bg-frenz-card px-6 text-sm font-bold text-frenz-ink transition active:scale-[0.99]">
                  See less
                </button>
              ) : null}
            </>
          )}

          {/* The visible trail for the BreadcrumbList JSON-LD (2026-08-16 SEO audit) — now a quiet line under the grid */}
          <nav aria-label="Breadcrumb" className="mt-6 px-1">
            <ol className="flex items-center gap-2 text-xs text-frenz-muted">
              <li>
                <Link href="/" className="transition hover:text-frenz-ink">
                  Home
                </Link>
              </li>
              <li aria-hidden>/</li>
              <li aria-current="page" className="text-frenz-ink">
                Wallpapers
              </li>
            </ol>
          </nav>
        </section>

        {children}
      </main>

      {filtersOpen ? (
        <Portal>
          <div className="frenz-ui fixed inset-0 z-[90] flex items-end justify-center bg-black/45 sm:items-center" onClick={() => setFiltersOpen(false)}>
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Filters"
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-t-[28px] border border-frenz-line bg-frenz-card px-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-3 text-frenz-ink shadow-frenz-float sm:rounded-[28px] sm:pb-5"
            >
              <div aria-hidden className="mx-auto mb-3 h-[5px] w-9 rounded-full bg-[#E2DFEC] dark:bg-white/20" />
              <div className="flex items-center justify-between">
                <h2 className="m-0 font-heading text-lg font-bold">Filters</h2>
                <button type="button" onClick={() => setFiltersOpen(false)} aria-label="Close filters" className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-frenz-muted">
                  <X className="h-5 w-5" aria-hidden />
                </button>
              </div>
              <div className="mt-3 flex flex-col gap-2.5">
                {/* A native <select> under a styled face: the phone's own picker, accessible for free */}
                <SelectPill
                  Icon={LayoutGrid}
                  label={category === "all" ? "All categories" : category}
                  ariaLabel="Filter by category"
                  value={category}
                  onChange={setCategory}
                  options={[{ value: "all", label: "All categories" }, ...categories.map(([name, count]) => ({ value: name, label: `${name} (${count})` }))]}
                />
                <SelectPill
                  Icon={ImageIcon}
                  label={type === "all" ? "All types" : (WALLPAPER_TYPES.find((t) => t.id === type)?.label ?? "Types")}
                  ariaLabel="Filter by screen shape"
                  value={type}
                  onChange={(v) => setType(v as WallpaperType | "all")}
                  disabled={availableTypes.length === 0}
                  options={[{ value: "all", label: "All types" }, ...availableTypes.map((t) => ({ value: t.id, label: t.label }))]}
                />
              </div>
              <div className="mt-4 flex gap-2.5">
                <button type="button" onClick={clearFilters} disabled={!filtering} className="flex min-h-12 flex-1 items-center justify-center rounded-full border border-frenz-line bg-frenz-card text-[15px] font-bold disabled:opacity-45">
                  Clear
                </button>
                <button type="button" onClick={() => setFiltersOpen(false)} className="flex min-h-12 flex-1 items-center justify-center rounded-full bg-frenz-gradient text-[15px] font-bold text-white">
                  Show {filtered.length.toLocaleString()}
                </button>
              </div>
            </div>
          </div>
        </Portal>
      ) : null}

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
        🔴 The download popup (owner, 2026-08-09): started / progress / complete, and on iOS the
        "Save to device" tap that actually puts the file in Photos. /wallpapers renders no Downloader,
        so the card is mounted here; z-[115] clears the full-screen viewer (z-[100]).
      */}
      <FloatingDownloadProgress layerClass="z-[115]" />

      {/* The 30-second ad a free member sees while their wallpaper saves, and the sheet shown once the
          day's five are gone. Both are per-download and neither blocks the transfer. */}
      {adOpen ? <WallpaperRewardAd seconds={adSeconds} wallpaperName={adFor} remaining={allowance?.remaining ?? null} onClose={closeAd} /> : null}
      {limitHit ? <WallpaperLimitSheet limit={allowance?.limit ?? 5} onClose={closeLimit} /> : null}
      {proRequired ? <WallpaperProSheet onClose={closeProRequired} /> : null}

      {/*
        Upload (owner, 2026-08-23: "a premium, noticeable upload button … mark more than one") now lives
        in the header, as the design draws it. Same input, same multi-file /api/wallpapers/share flow.
      */}
      <input
        ref={uploadInput}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp,image/avif"
        className="hidden"
        onChange={(e) => {
          const list = Array.from(e.target.files ?? []);
          if (list.length > 0) void uploadFiles(list);
        }}
      />
      {uploadMsg ? (
        <div className="pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4" style={{ bottom: "calc(1.25rem + env(safe-area-inset-bottom))" }}>
          <div
            role="status"
            className={cn(
              "max-w-[min(90vw,22rem)] rounded-2xl px-4 py-3 text-sm font-semibold shadow-frenz-float",
              uploadMsg.ok ? "border border-frenz-line bg-frenz-card text-frenz-ink" : "bg-rose-500 text-white",
            )}
          >
            {uploadMsg.text}
          </div>
        </div>
      ) : null}

      {uploadSignIn ? <UploadSignInPrompt onClose={() => setUploadSignIn(false)} /> : null}
    </>
  );
}

/** Sign-in nudge for the upload button — shown instead of silently ignoring a
 *  tap from a signed-out visitor. Same shape as the reels viewer's own prompt
 *  for like/save/comment. */
function UploadSignInPrompt({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[110] flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-3xl bg-card p-5 text-center shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <CloudUpload className="mx-auto h-8 w-8 text-primary" />
        <p className="mt-3 font-bold">Sign in to upload wallpapers</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Browsing and downloading are open to everyone — publishing your own to the library needs an account.
        </p>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onClose} className="btn-lux btn-lux-secondary flex-1 justify-center">
            Not now
          </button>
          <Link href="/login?next=/wallpapers" className="btn-lux btn-lux-primary flex-1 justify-center">
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}

/** A category chip over the featured image: glass, or solid white when it's the one chosen. */
function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex h-11 shrink-0 items-center rounded-full px-4 text-sm capitalize transition active:scale-95",
        active ? "bg-white font-bold text-frenz-ink" : cn(GLASS_SOFT, "font-semibold text-white"),
      )}
    >
      {label}
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
        "relative flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-2xl bg-frenz-fill px-3.5 py-3",
        disabled && "opacity-45",
      )}
    >
      <Icon className="h-[18px] w-[18px] shrink-0 text-frenz-violet" />
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
      className="group relative aspect-[1/2] overflow-hidden rounded-[22px] bg-frenz-fill shadow-[0_10px_24px_-14px_rgba(30,20,80,0.45)] animate-in fade-in duration-500 [animation-fill-mode:backwards] motion-reduce:animate-none"
      // Capped so a long library never staggers into a visible wait.
      style={{ animationDelay: `${Math.min(index, 11) * 35}ms` }}
    >
      {/* Real alt text (2026-08-09): the name and category are what we truthfully know — see `wallpaperAlt`. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- public storage CDN; next/image 403s on these */}
      <img
        src={wp.thumbUrl}
        alt={wallpaperAlt(wp)}
        loading={index < 6 ? "eager" : "lazy"}
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.04]"
      />

      <button type="button" onClick={onOpen} aria-label={`Open ${wp.name} full screen`} className="absolute inset-0 z-10" />

      {/* the frosted name plate (glass over the image): name, resolution, and the credit */}
      <span className="pointer-events-none absolute inset-x-1.5 bottom-1.5 z-20 flex flex-col gap-px rounded-[15px] border border-white/20 bg-[rgba(15,12,30,0.38)] px-2 py-[7px] backdrop-blur-lg backdrop-saturate-[1.6]">
        <span className="flex items-center justify-between gap-1">
          <span className="truncate text-xs font-bold text-white">{wp.name}</span>
          {badge ? <span className="shrink-0 rounded-[5px] bg-white/[0.22] px-[5px] py-px text-[9px] font-extrabold text-white">{badge.short}</span> : null}
        </span>
        {/* The sharer's @handle on member uploads, the category on curated ones — see `wallpaperCredit`. */}
        <span className="truncate text-[10px] font-semibold text-white/80">{wallpaperCredit(wp)}</span>
      </span>

      {/* Always visible — on a phone there is no hover. A 44 px target around the design's 34 px glass circle. */}
      <button
        type="button"
        onClick={onDownload}
        aria-label={wp.proOnly ? `Download ${wp.name} (Pro)` : `Download ${wp.name}`}
        className="absolute right-[3px] top-[3px] z-30 flex h-11 w-11 items-center justify-center transition active:scale-90"
      >
        <span
          className={cn(
            "flex h-[34px] w-[34px] items-center justify-center rounded-full border backdrop-blur-md",
            // A Pro wallpaper (admin upload, owner 2026-10-18) wears the gold crown.
            wp.proOnly ? "border-amber-300/60 bg-black/80 text-amber-300" : "border-white/35 bg-[rgba(15,12,30,0.32)] text-white",
          )}
        >
          {wp.proOnly ? <Crown className="h-4 w-4" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
        </span>
      </button>
    </div>
  );
}
