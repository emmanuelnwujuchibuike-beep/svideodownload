"use client";

import {
  ChevronLeft,
  Cloud,
  Download,
  Heart,
  History,
  RotateCcw,
  Search,
  Share2,
  Trash2,
  X,
  BrainCircuit,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { startDownload } from "@/features/downloads/manager";
import { totalUsedBytes } from "@/features/history/usage";
import { LoadingStripe } from "@/features/ui/page-loader";
import { toast } from "@/features/ui/toast";
import { haptic } from "@/lib/motion/haptics";
import { playSound } from "@/lib/notifications/sound-fx";
import { cn, formatBytes } from "@/lib/utils";

import dynamic from "next/dynamic";

import { ChevronRightIcon, CloudIcon, SearchIcon } from "@/features/frenz-ui/icons";
import { Input, SegmentedControl } from "@/features/frenz-ui/primitives";

import { COLS_KEY, COLUMN_CHOICES, MediaGallery, readPref, SORTS, SORT_KEY, VIEW_KEY, type SortKey, type ViewMode } from "./media-gallery";

const UsageDashboard = dynamic(() => import("@/features/downloads/usage-dashboard").then((m) => m.UsageDashboard), { ssr: false });
import { useHistory } from "./use-history";

/** Premium tactile feedback on every history-page control (owner). */
function tap() {
  haptic("light");
  playSound("tap");
}

/**
 * The landing "Your downloads" history — a header + Recent/Favorites tabs + search
 * around the shared iOS-Photos MediaGallery (grid/list, column count, sort). The
 * same MediaGallery powers the signed-in Downloads page, so both look identical.
 */
type KindFilter = "all" | "video" | "image" | "audio";

const KIND_FILTERS: { key: KindFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "video", label: "Videos" },
  { key: "image", label: "Images" },
  { key: "audio", label: "Audio" },
];

export function HistoryPanel({
  standalone = false,
  embedded = false,
  beforeGrid,
}: {
  /** The dedicated /history page: its own top padding, and an empty state. */
  standalone?: boolean;
  /**
   * Rendered between the filter chips and the media grid.
   *
   * Exists for the /history ad placement, which the owner asked to sit directly
   * above the grid rather than above the panel's search and filters. A slot
   * keeps that decision with the page that made it — the other two hosts of
   * this panel place their ad differently and on purpose.
   */
  beforeGrid?: React.ReactNode;
  /**
   * Rendered INSIDE another page's card (the signed-in Downloads page).
   *
   * Same panel, no outer chrome: the host already provides the border, the
   * background and the padding, and the "‹ History" back link would be a
   * second way out of a page you are still on. Everything else — the headline,
   * the meta line, search, the filter pills, Select mode — is identical, which
   * is the entire point of sharing the component rather than keeping two
   * headers over one gallery.
   */
  embedded?: boolean;
}) {
  const { items, ready, toggleFavorite, removeDownload, clearHistory } = useHistory();
  const [tab, setTab] = useState<"recent" | "favorites" | "failed">("recent");
  const [kind, setKind] = useState<KindFilter>("all");
  const [query, setQuery] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  // the redesigned /history (standalone): sort, view and columns live behind ONE options button
  const [sort, setSort] = useState<SortKey>(() => {
    const v = readPref(SORT_KEY);
    return v && SORTS.some((o) => o.key === v) ? (v as SortKey) : "time";
  });
  const [view, setView] = useState<ViewMode>(() => (readPref(VIEW_KEY) === "list" ? "list" : "grid"));
  // three across by default, as drawn; a saved choice still wins
  const [cols, setCols] = useState<number>(() => {
    const c = Number(readPref(COLS_KEY));
    return COLUMN_CHOICES.includes(c as (typeof COLUMN_CHOICES)[number]) ? c : 3;
  });
  const [storageOpen, setStorageOpen] = useState(false);
  const save = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode — the choice still applies for this visit */
    }
  };

  /*
    Open straight into Favorites from the download page's quick action. Read
    from `window.location` in an effect rather than through `searchParams` —
    taking searchParams in the page would make /history dynamic, and this page
    is deliberately static so it opens instantly (see the note on its route).
  */
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("filter") === "favorites") setTab("favorites");
  }, []);

  const favCount = useMemo(() => items.filter((i) => i.favorite).length, [items]);
  /*
    Failed + cancelled (owner, 2026-08-24: "I still don't see the cancelled and
    failed Downloads button that shows the failed and cancelled Download their
    thumbnail or favicon like in grid just like downloads in history so users
    can click on it and it shows retry download").

    Those records have been stored since 2026-08-23 and badged wherever they
    appear, but there was no way to FIND them — they sat mixed into a long
    date-ordered list, so a failure from last week was effectively lost.

    🔴 `?? "completed"` is load-bearing: history is the visitor's own
    localStorage and every record written before `status` existed has none. A
    bare `!== "completed"` would put everyone's entire library in this tab.
  */
  const failedCount = useMemo(
    () => items.filter((i) => (i.status ?? "completed") !== "completed").length,
    [items],
  );
  const usedBytes = useMemo(() => totalUsedBytes(items), [items]);
  const counts = useMemo<Record<KindFilter, number>>(
    () => ({
      all: items.length,
      video: items.filter((i) => i.kind === "video").length,
      image: items.filter((i) => i.kind === "image").length,
      audio: items.filter((i) => i.kind === "audio").length,
    }),
    [items],
  );

  const filtered = useMemo(() => {
    let base =
      tab === "favorites"
        ? items.filter((i) => i.favorite)
        : tab === "failed"
          ? items.filter((i) => (i.status ?? "completed") !== "completed")
          : items;
    // The kind chips narrow the plain list only — inside Favorites or Failed the
    // tab IS the filter, and stacking a second one hides records the person came
    // here specifically to find.
    if (tab === "recent" && kind !== "all") base = base.filter((i) => i.kind === kind);
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter((i) => i.title.toLowerCase().includes(q) || i.platformName.toLowerCase().includes(q));
  }, [items, tab, kind, query]);

  const toggleSelected = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const pick = () => items.filter((i) => selected.has(i.id));

  /** Share the selected items' source links. Falls back to the clipboard where
   *  the Web Share API isn't available (every desktop browser). */
  const shareSelected = async () => {
    const urls = pick().map((i) => i.url);
    if (urls.length === 0) return;
    const text = urls.join("\n");
    try {
      if (navigator.share) await navigator.share({ title: "My downloads", text });
      else {
        await navigator.clipboard.writeText(text);
        // Owner, 2026-08-18: "any link copied" should show a prompt — the
        // clipboard fallback (every desktop browser) gave no confirmation.
        toast(urls.length > 1 ? "Links copied." : "Link copied.", "success");
      }
    } catch {
      /* the user dismissed the sheet — nothing to report */
    }
  };

  /** Re-run each selected download through the manager, which already
   *  serialises saves so the browser doesn't drop all but the first. */
  const redownloadSelected = () => {
    for (const item of pick()) {
      startDownload({
        url: item.url,
        formatId: item.formatId,
        kind: item.kind,
        title: item.title,
        thumbnail: item.thumbnail,
        platform: item.platform,
        platformName: item.platformName,
        qualityLabel: item.qualityLabel,
        directUrl: item.directUrl ?? undefined,
      });
    }
    setSelected(new Set());
    setSelecting(false);
  };

  const deleteSelected = () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (!confirm(`Remove ${ids.length} item${ids.length === 1 ? "" : "s"} from your history?`)) return;
    for (const id of ids) removeDownload(id);
    setSelected(new Set());
    setSelecting(false);
  };

  if (!ready && !standalone && !embedded) return null;
  /*
    🔴 THE PAGE'S OWN LAYOUT IS IN THE FIRST PAINT (owner, 2026-10-10, with a
    screenshot: "the History page always flash this half white on first /cold
    entry"). Before this, the not-ready pass returned only a 2 px stripe, so the
    static HTML painted the header, a blank block and the footer pulled up under
    it until the bundle hydrated (reproduced: ~1.5–2 s on a throttled phone).
    The store reads localStorage, which the server cannot — so now everything
    that does NOT need the records (storage bar, search, filter chips) renders
    on the server too, and only the grid waits, under the stripe. Counts and the
    size are left out until they are real — never a placeholder number.
  */

  if (ready && items.length === 0) {
    // Embedded (e.g. on /library) → render nothing so it doesn't take space; the
    // dedicated history page passes `standalone` so it shows an empty state instead.
    if (!standalone && !embedded) return null;
    return (
      <section className="py-16 text-center">
        <div className="lux-enter mx-auto max-w-md px-4">
          {/* An empty page is still the product. A gradient tile and a real
              invitation read as "nothing here YET"; a grey outline glyph reads
              as something failing to load. */}
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-lg shadow-violet-500/25">
            <History className="h-8 w-8" />
          </span>
          <h2 className="lux-title mt-5 text-2xl font-extrabold tracking-[-0.02em]">No downloads yet</h2>
          <p className="mt-1.5 text-[15px] text-muted-foreground">
            Videos, reels, photos and audio you download will show up here.
          </p>
          <Link
            href="/"
            prefetch
            className="lux-btn mt-5 inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-violet-600 px-5 py-3 text-sm font-bold text-white shadow-md shadow-violet-500/25 transition hover:shadow-lg hover:shadow-violet-500/30 active:scale-[0.97]"
          >
            <span className="relative z-[2] inline-flex items-center gap-2">
              <Download className="h-4 w-4" /> Download something
            </span>
          </Link>
        </div>
      </section>
    );
  }

  return (
    // Standalone (the /history page) has the header directly above it, so it needs
    // almost no top padding — the big gap was the embedded py-14 stacking on the
    // page's own top padding (owner). Embedded on /library it keeps the divider + gap.
    <section
      id="history"
      className={cn(embedded ? "" : standalone ? "pb-16 pt-2" : "border-t border-border/60 py-14 sm:py-20")}
    >
      {/* Minimal side padding (owner) so the media grid stretches to the far edges. */}
      <div className={cn(embedded ? "" : "mx-auto max-w-6xl px-2 sm:px-4")}>
        {/*
          Top-to-bottom structure below: the header (the new `HistoryHero`
          card for `standalone` — see its own doc comment; the original quiet
          "‹ History … Select" bar + plain headline for `embedded`/library,
          built to public/mainhistorypage.jpg and unchanged since), then a
          full-width search field, All/Videos/Images/Audio filter chips, day
          sections with counts (in MediaGallery), then the grid itself.

          Nothing from the pre-hero version was dropped for `standalone`
          either — "Clear all" moved into the new card's corner, the live
          counts stayed on the filter pills, Favorites keeps its own chip.
        */}
        {standalone ? (
          /*
            The redesigned History (owner's screenshot, 2026-10-18): a large "History" with
            "items · size ›" under it (it opens the storage detail), the one options button (sort,
            view, columns, filters, Frenz AI, Clear all) and Select; then a native search field and
            the All · Videos · Images · Audio control. Every number is real.
          */
          <div className="frenz-ui">
            <div className="flex items-start justify-between gap-3 px-1 pt-1">
              <div className="min-w-0">
                <h1 className="m-0 font-heading text-[38px] font-extrabold leading-none tracking-[-1.5px] text-frenz-ink">History</h1>
                <button
                  type="button"
                  onClick={() => { tap(); setStorageOpen((v) => !v); }}
                  aria-expanded={storageOpen}
                  aria-controls="history-storage"
                  className="mt-2 inline-flex min-h-8 items-center gap-1.5 text-[15px] font-semibold text-frenz-muted"
                >
                  <CloudIcon size={18} strokeWidth={2} />
                  {ready ? `${items.length} item${items.length === 1 ? "" : "s"} · ${formatBytes(usedBytes)}` : "Your downloads"}
                  <ChevronRightIcon size={14} strokeWidth={2.6} className={cn("transition-transform", storageOpen && "rotate-90")} />
                </button>
              </div>
              <div className="flex shrink-0 items-center gap-2.5 pt-0.5">
                <HistoryOptions
                  sort={sort}
                  view={view}
                  cols={cols}
                  onSort={(v) => { setSort(v); save(SORT_KEY, v); }}
                  onView={(v) => { setView(v); save(VIEW_KEY, v); }}
                  onCols={(n) => { setCols(n); save(COLS_KEY, String(n)); }}
                  tab={tab}
                  onTab={setTab}
                  favCount={ready ? favCount : null}
                  failedCount={ready ? failedCount : null}
                  onClearAll={() => {
                    if (!confirm("Clear your whole download history? This removes every item from this device.")) return;
                    clearHistory();
                  }}
                />
                <button
                  type="button"
                  onClick={() => { tap(); setSelecting((v) => !v); setSelected(new Set()); }}
                  aria-pressed={selecting}
                  className={cn(
                    "h-11 rounded-full px-5 text-base font-bold transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-frenz-violet",
                    selecting ? "bg-frenz-ink text-frenz-page" : "bg-frenz-violet/10 text-frenz-violet",
                  )}
                >
                  {selecting ? "Done" : "Select"}
                </button>
              </div>
            </div>

            <div id="history-storage">{storageOpen ? <div className="mt-3"><UsageDashboard /></div> : null}</div>

            <Input
              id="history-search"
              label="Search downloads"
              type="search"
              enterKeyHint="search"
              icon={<SearchIcon size={18} />}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search downloads"
              className="mt-4 h-12"
              trailing={
                query ? (
                  <button type="button" onClick={() => { tap(); setQuery(""); }} aria-label="Clear search" className="flex h-9 w-9 items-center justify-center rounded-full text-frenz-muted">
                    <X className="h-4 w-4" />
                  </button>
                ) : null
              }
            />

            <SegmentedControl
              label="Show"
              className="mt-3"
              value={tab === "recent" ? kind : "all"}
              onChange={(k) => { tap(); setTab("recent"); setKind(k); }}
              options={KIND_FILTERS.map((f) => ({ value: f.key, label: f.label }))}
            />

            {/* Favorites / Failed are picked in the options menu; while one is on, say so and let it go in one tap */}
            {tab !== "recent" ? (
              <button
                type="button"
                onClick={() => { tap(); setTab("recent"); }}
                className="mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-full bg-frenz-violet/10 px-3 text-sm font-bold text-frenz-violet"
              >
                {tab === "favorites" ? "Favorites" : "Failed & cancelled"} <X className="h-3.5 w-3.5" aria-hidden />
                <span className="sr-only">— show all</span>
              </button>
            ) : null}
          </div>
        ) : null}
        {standalone ? null : (
          <>
        {(
          <>
            <div className="mb-4 flex items-center justify-between gap-3">
              {embedded ? (
                <span className="text-[15px] font-semibold text-muted-foreground">History</span>
              ) : (
                <Link
                  href="/"
                  className="-ml-1 inline-flex items-center gap-1 rounded-lg px-1 py-1 text-[15px] font-semibold text-primary transition active:scale-95"
                >
                  <ChevronLeft className="h-5 w-5" /> History
                </Link>
              )}

              <div className="flex items-center gap-1">
                {confirmClear ? (
                  <span className="flex items-center gap-1 text-sm">
                    <button
                      type="button"
                      onClick={() => { tap(); clearHistory(); setConfirmClear(false); }}
                      className="rounded-lg px-2.5 py-1.5 font-bold text-rose-500 transition active:scale-95"
                    >
                      Clear all?
                    </button>
                    <button
                      type="button"
                      onClick={() => { tap(); setConfirmClear(false); }}
                      className="rounded-lg px-2.5 py-1.5 font-semibold text-muted-foreground transition active:scale-95"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => { tap(); setConfirmClear(true); }}
                    aria-label="Clear all downloads"
                    className="rounded-lg p-2 text-muted-foreground transition hover:text-rose-500 active:scale-95"
                  >
                    <Trash2 className="h-[18px] w-[18px]" />
                  </button>
                )}
                {/* Select reads as a real control now — it toggles the whole page
                    into a different mode, which a bare text link never signalled. */}
                <button
                  type="button"
                  onClick={() => { tap(); setSelecting((v) => !v); setSelected(new Set()); }}
                  aria-pressed={selecting}
                  className={cn(
                    "lux-btn rounded-xl px-3 py-1.5 text-[15px] font-bold transition duration-150 active:scale-95",
                    selecting
                      ? "bg-foreground text-background shadow-sm"
                      : "bg-primary/10 text-primary ring-1 ring-inset ring-primary/25 hover:bg-primary/15",
                  )}
                >
                  <span className="relative z-[2]">{selecting ? "Done" : "Select"}</span>
                </button>
              </div>
            </div>

            {/*
              ── Premium, and paid for in paint rather than in frames ────────────
              Owner, 2026-08-09: "premium, alive, luxurious and professional
              without breaking the performance rule."

              The glow is a single static radial and the headline is a gradient
              fill — both painted once, neither animated. The only motion on this
              page is the one-shot entrance and the sheen that plays under a
              finger. See the `.lux-btn` note in globals.css for why nothing here
              loops.
            */}
            <div className="relative">
              <span
                aria-hidden
                className="pointer-events-none absolute -left-10 -top-12 h-40 w-40 rounded-full bg-[radial-gradient(circle,rgba(37,99,255,0.12),transparent_70%)]"
              />
              <h2 className="lux-title lux-enter relative text-[2rem] font-extrabold leading-none tracking-[-0.03em] sm:text-4xl">
                Your Downloads
              </h2>
            </div>
            {/* One line, three real facts. The size is measured from the records
                themselves, not estimated from a count. */}
            <p className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[15px] text-muted-foreground">
              <span className="font-semibold text-foreground">
                {items.length} item{items.length === 1 ? "" : "s"}
              </span>
              <span aria-hidden>·</span>
              <span className="font-semibold text-foreground">{formatBytes(usedBytes)}</span>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-0.5 text-[13px] font-semibold text-primary ring-1 ring-inset ring-primary/20">
                Private Cloud <Cloud className="h-3.5 w-3.5" />
              </span>
            </p>
          </>
        )}

        {/* Full width, as in the reference — search is the fastest way through a
            long history and it was previously sharing its row with a chip. */}
        <div className="relative mt-5">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search downloads…"
            aria-label="Search downloads"
            className="h-14 w-full rounded-2xl bg-secondary/60 pl-12 pr-11 text-[15px] font-medium shadow-sm outline-none ring-1 ring-inset ring-border/40 transition focus:bg-background focus:shadow-md focus:ring-2 focus:ring-primary"
          />
          {query ? (
            <button
              type="button"
              onClick={() => { tap(); setQuery(""); }}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted-foreground transition hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        {/* The reference's four pills, evenly weighted, with the live counts the
            previous version earned — a chip never advertises items that aren't
            there. Favorites follows them because it is a different KIND of
            filter, not a fifth media type. */}
        <div className="-mx-2 mt-4 flex gap-2 overflow-x-auto px-2 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {KIND_FILTERS.map((f) => (
            <Chip key={f.key} active={tab === "recent" && kind === f.key} onClick={() => { setTab("recent"); setKind(f.key); }}>
              {f.label} {ready ? <Count>{counts[f.key]}</Count> : null}
            </Chip>
          ))}
          <Chip active={tab === "favorites"} onClick={() => setTab(tab === "favorites" ? "recent" : "favorites")}>
            <Heart className={cn("h-3.5 w-3.5", tab === "favorites" && "fill-current")} /> Favorites {ready ? <Count>{favCount}</Count> : null}
          </Chip>
          {/*
            Failed & cancelled. Shown only when there ARE any: a permanent
            "Failed 0" chip is a standing accusation that something is broken
            when nothing is, and it costs a slot in a row that scrolls on a
            phone. It appears the moment a download fails, which is exactly
            when someone starts looking for it.
          */}
          {failedCount > 0 ? (
            <Chip active={tab === "failed"} onClick={() => setTab(tab === "failed" ? "recent" : "failed")}>
              <RotateCcw className="h-3.5 w-3.5" /> Failed <Count>{failedCount}</Count>
            </Chip>
          ) : null}
        </div>


          </>
        )}
        {/*
          Directly above the grid, below the search and the filter chips
          (owner, 2026-08-09, with a screenshot: "the history page ad should be
          above the media grid").

          A slot rather than the ad itself, because this panel has three hosts —
          /history, /downloads and /library — and only /history wants the unit
          here. The other two place it around the whole panel, which is right
          for them: on /downloads the panel sits inside a bordered card, and an
          ad wedged between that card's chrome and its contents would read as
          part of the history rather than as an advertisement.
        */}
        {beforeGrid}

        <div className="mt-5">
        {!ready ? (
          // holds the screen the grid will take, so the footer never rides up into it and back down
          <section aria-busy="true" aria-label="Loading your history" className="min-h-[70svh]">
            <LoadingStripe />
          </section>
        ) : (
        <MediaGallery
          items={filtered}
          onToggleFavorite={toggleFavorite}
          onRemove={removeDownload}
          groupByDay
          selection={{ active: selecting, selected, onToggle: toggleSelected }}
          frenz={standalone ? { sort, view, cols } : undefined}
          emptyText={tab === "favorites" ? "No favorites yet — tap the heart on any download to save it here." : "No downloads match your search."}
        />
        )}
        </div>
      </div>

      {/* Selection action bar — the reference's footer. It only exists while
          Select is on, and each action states how many items it will touch, so
          "Delete" can never be a surprise. */}
      {selecting ? (
        <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-30 mx-auto mt-4 max-w-6xl px-2 sm:px-4">
          <div className="relative overflow-hidden rounded-2xl border border-border/70 bg-card/95 p-3 shadow-elevated backdrop-blur-xl">
            {/* The same hairline of brand light the download card uses, so the
                two floating surfaces in this app read as one family. */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#2563FF]/60 to-transparent"
            />
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-auto text-sm font-semibold text-muted-foreground">
                {selected.size === 0 ? "Select items to take action" : `${selected.size} selected`}
              </span>
              {/*
                Three actions, weighted by what they do rather than styled alike.

                "Download again" is the one people came to press, so it is the
                only filled button. Share sits beside it as a tinted secondary,
                and Delete stays outlined in rose — destructive actions should
                never be the easiest thing to hit by accident. All three carry
                the hover/focus sheen; none animates at rest.
              */}
              <LuxAction
                onClick={() => void shareSelected()}
                disabled={selected.size === 0}
                icon={<Share2 className="h-4 w-4" />}
                tone="tinted"
              >
                Share
              </LuxAction>
              <LuxAction
                onClick={() => redownloadSelected()}
                disabled={selected.size === 0}
                icon={<Download className="h-4 w-4" />}
                tone="primary"
              >
                Download again
              </LuxAction>
              <LuxAction
                onClick={() => deleteSelected()}
                disabled={selected.size === 0}
                icon={<Trash2 className="h-4 w-4" />}
                tone="danger"
              >
                Delete
              </LuxAction>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/**
 * A selection-bar action.
 *
 * Three tones rather than three copies of one class string, so the weighting
 * (which action is the filled one) is a decision made once and visible here
 * instead of buried in three near-identical `className`s that drift apart.
 *
 * The sheen comes from `.lux-btn` (globals.css) and plays only on hover/focus —
 * see that comment for why nothing on this page loops.
 */
function LuxAction({
  onClick,
  disabled,
  icon,
  tone,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  icon: ReactNode;
  tone: "primary" | "tinted" | "danger";
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        tap();
        onClick();
      }}
      className={cn(
        "lux-btn inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-bold transition duration-150",
        "active:scale-[0.96] disabled:pointer-events-none disabled:opacity-40",
        tone === "primary" &&
          "bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-md shadow-violet-500/25 hover:shadow-lg hover:shadow-violet-500/30",
        tone === "tinted" &&
          "bg-secondary/80 text-foreground ring-1 ring-inset ring-border/50 hover:bg-secondary hover:ring-border",
        tone === "danger" &&
          "text-rose-500 ring-1 ring-inset ring-rose-500/40 hover:bg-rose-500/10 hover:ring-rose-500/60",
      )}
    >
      <span className="relative z-[2] inline-flex items-center gap-1.5">
        {icon} {children}
      </span>
    </button>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => { tap(); onClick(); }}
      aria-pressed={active}
      className={cn(
        "lux-btn inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-bold transition duration-150 active:scale-[0.95]",
        active
          ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-md shadow-violet-500/25 [&_[data-count]]:bg-white/25 [&_[data-count]]:text-white"
          : "bg-secondary/70 text-muted-foreground ring-1 ring-inset ring-border/40 hover:bg-secondary hover:text-foreground",
      )}
    >
      <span className="relative z-[2] inline-flex items-center gap-1.5">{children}</span>
    </button>
  );
}

function Count({ children }: { children: ReactNode }) {
  /*
    `data-count` is the hook the ACTIVE chip uses to re-tint this — see Chip's
    `[&_[data-count]]:bg-white/25`. The count is styled from the parent because
    only the parent knows whether it is sitting on the gradient.

    The obvious version was `bg-current/15`, so the pill would inherit whatever
    ink the chip had. It compiles to NOTHING: Tailwind 3 has no opacity modifier
    for `currentColor`, so the class is silently dropped and the pill loses its
    background entirely — verified by running the Tailwind CLI over it rather
    than by reading the docs. Same shape as the undefined-colour-token bug that
    `lib/design-tokens.test.ts` exists to catch.
  */
  return (
    <span
      data-count
      className="rounded-full bg-muted-foreground/15 px-1.5 text-[10px] font-bold tabular-nums"
    >
      {children}
    </span>
  );
}

/**
 * History's ONE options button (owner's screenshot, 2026-10-18): sort, view and columns, the
 * Favorites / Failed filters, Frenz AI — which was the floating lightbulb button on this page
 * (owner, 2026-09-14) and moved here when that button went — and Clear all, with a confirm.
 * A popover under the button; closes on an outside tap or Escape.
 */
function HistoryOptions({
  sort,
  view,
  cols,
  onSort,
  onView,
  onCols,
  tab,
  onTab,
  favCount,
  failedCount,
  onClearAll,
}: {
  sort: SortKey;
  view: ViewMode;
  cols: number;
  onSort: (v: SortKey) => void;
  onView: (v: ViewMode) => void;
  onCols: (n: number) => void;
  tab: "recent" | "favorites" | "failed";
  onTab: (t: "recent" | "favorites" | "failed") => void;
  favCount: number | null;
  failedCount: number | null;
  onClearAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const choose = (fn: () => void) => () => {
    tap();
    fn();
  };
  const row = "flex min-h-11 w-full items-center justify-between gap-3 rounded-xl px-3 text-left text-[15px] font-semibold text-frenz-ink transition hover:bg-frenz-fill";
  const mark = (on: boolean) => (on ? <span aria-hidden className="h-2 w-2 rounded-full bg-frenz-violet" /> : null);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => { tap(); setOpen((v) => !v); }}
        aria-label="Sort, view and filters"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-11 w-11 items-center justify-center rounded-full border border-frenz-line bg-frenz-card text-frenz-ink transition active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-frenz-violet"
      >
        {/* three lines, shorter each time — the design's filter glyph */}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
          <path d="M4 7h16" />
          <path d="M7 12h10" />
          <path d="M10 17h4" />
        </svg>
      </button>
      {open ? (
        <>
          <button type="button" aria-label="Close menu" onClick={() => setOpen(false)} className="fixed inset-0 z-40 cursor-default" />
          <div role="menu" className="frenz-ui absolute right-0 top-[calc(100%+0.5rem)] z-50 w-64 overflow-hidden rounded-2xl border border-frenz-line bg-frenz-card p-1.5 shadow-frenz-float">
            <p className="px-3 pb-1 pt-2 text-xs font-bold uppercase tracking-wide text-frenz-muted">Sort by</p>
            {SORTS.map((o) => (
              <button key={o.key} type="button" role="menuitemradio" aria-checked={sort === o.key} onClick={choose(() => onSort(o.key))} className={row}>
                {o.label} {mark(sort === o.key)}
              </button>
            ))}
            <div className="my-1 h-px bg-frenz-line" />
            <p className="px-3 pb-1 pt-1 text-xs font-bold uppercase tracking-wide text-frenz-muted">View</p>
            <div className="flex gap-1 px-1.5 pb-1">
              {(["grid", "list"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="menuitemradio"
                  aria-checked={view === v}
                  onClick={choose(() => onView(v))}
                  className={cn("min-h-10 flex-1 rounded-xl text-sm font-bold", view === v ? "bg-frenz-ink text-frenz-page" : "bg-frenz-fill text-frenz-ink/80")}
                >
                  {v === "grid" ? "Grid" : "List"}
                </button>
              ))}
            </div>
            {view === "grid" ? (
              <div className="flex gap-1 px-1.5 pb-1">
                {COLUMN_CHOICES.map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="menuitemradio"
                    aria-checked={cols === n}
                    aria-label={`${n} columns`}
                    onClick={choose(() => onCols(n))}
                    className={cn("min-h-10 flex-1 rounded-xl text-sm font-bold tabular-nums", cols === n ? "bg-frenz-ink text-frenz-page" : "bg-frenz-fill text-frenz-ink/80")}
                  >
                    {n}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="my-1 h-px bg-frenz-line" />
            <button type="button" role="menuitemcheckbox" aria-checked={tab === "favorites"} onClick={choose(() => { onTab(tab === "favorites" ? "recent" : "favorites"); setOpen(false); })} className={row}>
              <span className="inline-flex items-center gap-2"><Heart className="h-4 w-4" aria-hidden /> Favorites</span>
              <span className="flex items-center gap-2 text-sm text-frenz-muted">{favCount ?? ""}{mark(tab === "favorites")}</span>
            </button>
            {failedCount ? (
              <button type="button" role="menuitemcheckbox" aria-checked={tab === "failed"} onClick={choose(() => { onTab(tab === "failed" ? "recent" : "failed"); setOpen(false); })} className={row}>
                <span className="inline-flex items-center gap-2"><RotateCcw className="h-4 w-4" aria-hidden /> Failed &amp; cancelled</span>
                <span className="flex items-center gap-2 text-sm text-frenz-muted">{failedCount}{mark(tab === "failed")}</span>
              </button>
            ) : null}
            <Link href="/ai" role="menuitem" onClick={() => { tap(); setOpen(false); }} className={row}>
              <span className="inline-flex items-center gap-2"><BrainCircuit className="h-4 w-4" aria-hidden /> Frenz AI</span>
            </Link>
            <div className="my-1 h-px bg-frenz-line" />
            <button type="button" role="menuitem" onClick={() => { tap(); setOpen(false); onClearAll(); }} className={cn(row, "text-rose-600 hover:bg-rose-50")}>
              <span className="inline-flex items-center gap-2"><Trash2 className="h-4 w-4" aria-hidden /> Clear all</span>
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
