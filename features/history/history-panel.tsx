"use client";

import {
  CheckCircle2,
  ChevronLeft,
  Cloud,
  Download,
  HardDrive,
  Heart,
  History,
  Image as ImageIcon,
  Layers,
  Music2,
  Play,
  RotateCcw,
  Search,
  Share2,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { startDownload } from "@/features/downloads/manager";
import { totalUsedBytes } from "@/features/history/usage";
import { toast } from "@/features/ui/toast";
import { haptic } from "@/lib/motion/haptics";
import { playSound } from "@/lib/notifications/sound-fx";
import { cn, formatBytes } from "@/lib/utils";

import { MediaGallery } from "./media-gallery";
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

/**
 * The /history page's own top card — owner, 2026-08-17, from a reference
 * screenshot of a gradient "Your Downloads" card (eyebrow, gradient headline,
 * stat pills, a prominent Select button and a drawn folder illustration).
 *
 * `standalone` ONLY. `embedded` (inside the /downloads card) and the bare
 * /library case keep the plain header below completely untouched — the doc
 * comment on `HistoryPanel`'s `embedded` prop is explicit that those two stay
 * identical to each other, and this card is a bigger visual moment than either
 * of THOSE hosts wants sitting inside their own chrome.
 *
 * ── Paid for in paint, not weight ───────────────────────────────────────────
 * No new image asset, no animation library: the folder illustration is the
 * same drawn-icons-in-a-gradient-tile technique `DownloadsHero` already uses
 * (features/downloads/downloads-sections.tsx) — an icon in a rounded gradient
 * square, `motion-safe:animate-float` (a no-op under prefers-reduced-motion,
 * already gated at the Tailwind-variant level), plus small badge chips. Unlike
 * that component it is NOT `hidden` below `sm:` — the reference shows it on a
 * phone viewport, so it stays visible at every width, just smaller.
 *
 * Every number is real (`itemCount`/`usedBytes` come from the caller's own
 * `useHistory()` read) — no seeded stats, per this codebase's standing rule
 * against invented figures.
 */
function HistoryHero({
  itemCount,
  usedBytes,
  selecting,
  onToggleSelect,
  confirmClear,
  onRequestClear,
  onConfirmClear,
  onCancelClear,
}: {
  itemCount: number;
  usedBytes: number;
  selecting: boolean;
  onToggleSelect: () => void;
  confirmClear: boolean;
  onRequestClear: () => void;
  onConfirmClear: () => void;
  onCancelClear: () => void;
}) {
  return (
    <div className="lux-enter relative overflow-hidden rounded-[1.75rem] bg-gradient-to-br from-blue-50 via-violet-50/70 to-indigo-50 p-5 ring-1 ring-inset ring-violet-900/[0.06] dark:from-blue-500/[0.08] dark:via-violet-500/[0.06] dark:to-indigo-500/[0.08] dark:ring-white/10 sm:p-6">
      {/* Same one-shot static glow the rest of this page uses — painted once,
          never animated (see the note further down on why nothing here loops). */}
      <span
        aria-hidden
        className="pointer-events-none absolute -left-10 -top-14 h-48 w-48 rounded-full bg-[radial-gradient(circle,rgba(37,99,255,0.14),transparent_70%)]"
      />

      {/* Clear-all — tucked into the corner rather than a full utility row;
          Select (below) is the header's one prominent action now. Same
          confirm-before-destroy behaviour as before, just relocated. */}
      <div className="relative flex justify-end">
        {confirmClear ? (
          <span className="flex items-center gap-1 text-sm">
            <button
              type="button"
              onClick={onConfirmClear}
              className="rounded-lg px-2.5 py-1.5 font-bold text-rose-500 transition active:scale-95"
            >
              Clear all?
            </button>
            <button
              type="button"
              onClick={onCancelClear}
              className="rounded-lg px-2.5 py-1.5 font-semibold text-muted-foreground transition active:scale-95"
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={onRequestClear}
            aria-label="Clear all downloads"
            className="-mr-1.5 -mt-1.5 rounded-lg p-2 text-muted-foreground/70 transition hover:text-rose-500 active:scale-95"
          >
            <Trash2 className="h-[18px] w-[18px]" />
          </button>
        )}
      </div>

      <div className="relative -mt-8 flex items-center gap-4 sm:-mt-9">
        <div className="min-w-0 flex-1">
          <span className="text-[13px] font-bold uppercase tracking-wide text-primary">History</span>
          <h1 className="mt-1 text-[1.7rem] font-extrabold leading-[1.08] tracking-[-0.03em] text-foreground sm:text-4xl">
            Your{" "}
            <span className="bg-gradient-to-r from-blue-600 via-violet-600 to-fuchsia-600 bg-clip-text text-transparent dark:from-blue-400 dark:via-violet-400 dark:to-fuchsia-400">
              Downloads
            </span>
          </h1>
          <p className="mt-2 max-w-sm text-pretty text-sm leading-relaxed text-muted-foreground">
            Manage, organize and access all your downloaded content in one place.
          </p>
        </div>

        {/* Folder + cloud, badged with the page's own three media kinds —
            drawn, not shipped as an asset. `aria-hidden`: purely decorative,
            the real facts are the stat pills below. */}
        <div aria-hidden className="relative h-24 w-24 shrink-0 sm:h-32 sm:w-32">
          <span className="absolute inset-0 rounded-full bg-gradient-to-br from-violet-500/30 to-blue-500/30 blur-2xl" />
          <span className="absolute inset-2 flex items-center justify-center rounded-[1.5rem] bg-gradient-to-br from-violet-500 to-blue-600 shadow-xl motion-safe:animate-float">
            <History className="h-10 w-10 text-white sm:h-14 sm:w-14" />
          </span>
          <span className="absolute -left-1 top-1 flex h-8 w-8 items-center justify-center rounded-xl bg-card shadow-md ring-1 ring-border/60 sm:h-9 sm:w-9">
            <ImageIcon className="h-3.5 w-3.5 text-fuchsia-500 sm:h-4 sm:w-4" />
          </span>
          <span className="absolute -right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-card shadow-md ring-1 ring-border/60 sm:h-9 sm:w-9">
            <Play className="h-3.5 w-3.5 fill-current text-blue-500 sm:h-4 sm:w-4" />
          </span>
          <span className="absolute -bottom-1 left-1/3 flex h-8 w-8 items-center justify-center rounded-xl bg-card shadow-md ring-1 ring-border/60 sm:h-9 sm:w-9">
            <Music2 className="h-3.5 w-3.5 text-violet-500 sm:h-4 sm:w-4" />
          </span>
        </div>
      </div>

      {/* Stats + Select, one wrapping row — two real facts as pill-stats, the
          Private Cloud badge, then the header's one prominent action. */}
      <div className="relative mt-5 flex flex-wrap items-center gap-2">
        <StatPill icon={Layers} value={String(itemCount)} label={itemCount === 1 ? "Item" : "Items"} />
        <StatPill icon={HardDrive} value={formatBytes(usedBytes)} label="Total Size" />
        <span className="inline-flex items-center gap-1.5 rounded-2xl bg-card px-3.5 py-2.5 text-[13px] font-bold text-primary shadow-sm ring-1 ring-inset ring-border/50">
          Private Cloud <Cloud className="h-4 w-4" />
        </span>
        <button
          type="button"
          onClick={onToggleSelect}
          aria-pressed={selecting}
          className={cn(
            "lux-btn ml-auto inline-flex items-center gap-1.5 rounded-2xl px-4 py-2.5 text-[13px] font-bold transition duration-150 active:scale-95",
            selecting
              ? "bg-foreground text-background shadow-sm"
              : "bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-md shadow-violet-500/25 hover:shadow-lg hover:shadow-violet-500/30",
          )}
        >
          <span className="relative z-[2] inline-flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4" /> {selecting ? "Done" : "Select"}
          </span>
        </button>
      </div>
    </div>
  );
}

function StatPill({
  icon: Icon,
  value,
  label,
}: {
  icon: typeof Layers;
  value: string;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-2 rounded-2xl bg-card px-3.5 py-2 shadow-sm ring-1 ring-inset ring-border/50">
      <Icon className="h-4 w-4 text-primary" aria-hidden />
      <span className="flex flex-col leading-none">
        <span className="text-sm font-extrabold text-foreground">{value}</span>
        <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      </span>
    </span>
  );
}

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
  const { items, toggleFavorite, removeDownload, clearHistory } = useHistory();
  const [tab, setTab] = useState<"recent" | "favorites" | "failed">("recent");
  const [kind, setKind] = useState<KindFilter>("all");
  const [query, setQuery] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

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

  if (items.length === 0) {
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
          <HistoryHero
            itemCount={items.length}
            usedBytes={usedBytes}
            selecting={selecting}
            onToggleSelect={() => { tap(); setSelecting((v) => !v); setSelected(new Set()); }}
            confirmClear={confirmClear}
            onRequestClear={() => { tap(); setConfirmClear(true); }}
            onConfirmClear={() => { tap(); clearHistory(); setConfirmClear(false); }}
            onCancelClear={() => { tap(); setConfirmClear(false); }}
          />
        ) : (
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
              {f.label} <Count>{counts[f.key]}</Count>
            </Chip>
          ))}
          <Chip active={tab === "favorites"} onClick={() => setTab(tab === "favorites" ? "recent" : "favorites")}>
            <Heart className={cn("h-3.5 w-3.5", tab === "favorites" && "fill-current")} /> Favorites <Count>{favCount}</Count>
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
        <MediaGallery
          items={filtered}
          onToggleFavorite={toggleFavorite}
          onRemove={removeDownload}
          groupByDay
          selection={{ active: selecting, selected, onToggle: toggleSelected }}
          emptyText={tab === "favorites" ? "No favorites yet — tap the heart on any download to save it here." : "No downloads match your search."}
        />
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
