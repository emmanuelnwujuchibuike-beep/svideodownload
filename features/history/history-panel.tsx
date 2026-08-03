"use client";

import {
  Cloud,
  Download,
  Heart,
  History,
  Search,
  Share2,
  SlidersHorizontal,
  SquareDashedMousePointer,
  Trash2,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";

import { startDownload } from "@/features/downloads/manager";
import { totalUsedBytes } from "@/features/history/usage";
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

export function HistoryPanel({ standalone = false }: { standalone?: boolean }) {
  const { items, toggleFavorite, removeDownload, clearHistory } = useHistory();
  const [tab, setTab] = useState<"recent" | "favorites">("recent");
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
    let base = tab === "favorites" ? items.filter((i) => i.favorite) : items;
    if (tab !== "favorites" && kind !== "all") base = base.filter((i) => i.kind === kind);
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
      else await navigator.clipboard.writeText(text);
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
    if (!standalone) return null;
    return (
      <section className="py-16 text-center">
        <div className="mx-auto max-w-md px-4">
          <History className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <h2 className="mt-4 text-xl font-bold">No downloads yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">Videos, reels, photos and audio you download will show up here.</p>
        </div>
      </section>
    );
  }

  return (
    // Standalone (the /history page) has the header directly above it, so it needs
    // almost no top padding — the big gap was the embedded py-14 stacking on the
    // page's own top padding (owner). Embedded on /library it keeps the divider + gap.
    <section id="history" className={cn(standalone ? "pb-16 pt-2" : "border-t border-border/60 py-14 sm:py-20")}>
      {/* Minimal side padding (owner) so the media grid stretches to the far edges. */}
      <div className="mx-auto max-w-6xl px-2 sm:px-4">
        {/* Header */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-2xl font-bold tracking-[-0.02em] sm:text-3xl">
              <History className="h-6 w-6 text-primary" /> Your downloads
            </h2>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
              {items.length} saved · Stored privately on your cloud
              <Cloud className="h-3.5 w-3.5" />
            </p>
          </div>

          {/* Select — the reference's top-right control. */}
          <button
            type="button"
            onClick={() => { tap(); setSelecting((s) => !s); setSelected(new Set()); }}
            aria-pressed={selecting}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-sm font-semibold shadow-sm transition duration-150 active:scale-[0.96]",
              selecting ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            <SquareDashedMousePointer className="h-4 w-4" /> {selecting ? "Done" : "Select"}
          </button>

          {confirmClear ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Clear all?</span>
              <button type="button" onClick={() => { tap(); clearHistory(); setConfirmClear(false); }} className="rounded-xl bg-red-500/10 px-3.5 py-2 font-semibold text-red-500 transition duration-150 hover:bg-red-500/20 active:scale-[0.95]">
                Yes, clear
              </button>
              <button type="button" onClick={() => { tap(); setConfirmClear(false); }} className="rounded-xl px-3.5 py-2 font-semibold text-muted-foreground transition duration-150 hover:text-foreground active:scale-[0.95]">
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => { tap(); setConfirmClear(true); }} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3.5 py-2 text-sm font-semibold text-muted-foreground shadow-sm transition duration-150 hover:border-red-500/40 hover:text-red-500 active:scale-[0.96]">
              <Trash2 className="h-3.5 w-3.5" /> Clear all
            </button>
          )}
        </div>

        {/* Type filter chips with live counts, and Favorites as its own chip —
            the reference's row (public/new downloadhistory.jpg). Counts are real
            and recomputed from the history, so a chip never advertises items
            that aren't there. */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {KIND_FILTERS.map((f) => (
              <Chip key={f.key} active={tab !== "favorites" && kind === f.key} onClick={() => { setTab("recent"); setKind(f.key); }}>
                {f.label} <Count>{counts[f.key]}</Count>
              </Chip>
            ))}
          </div>
          <Chip active={tab === "favorites"} onClick={() => setTab(tab === "favorites" ? "recent" : "favorites")}>
            <Heart className={cn("h-3.5 w-3.5", tab === "favorites" && "fill-current")} /> Favorites <Count>{favCount}</Count>
          </Chip>
        </div>

        {/* Search + storage used */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="relative min-w-0 flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search downloads…"
              aria-label="Search downloads"
              className="h-11 w-full rounded-xl bg-background px-3 pl-9 text-sm outline-none ring-1 ring-inset ring-border transition focus:ring-2 focus:ring-primary"
            />
          </div>
          <span className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl bg-secondary/60 px-3.5 text-sm font-semibold shadow-sm ring-1 ring-inset ring-border/40">
            <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
            <span className="text-primary">{formatBytes(usedBytes)} used</span>
          </span>
        </div>

        <MediaGallery
          items={filtered}
          onToggleFavorite={toggleFavorite}
          onRemove={removeDownload}
          groupByDay
          selection={{ active: selecting, selected, onToggle: toggleSelected }}
          emptyText={tab === "favorites" ? "No favorites yet — tap the heart on any download to save it here." : "No downloads match your search."}
        />
      </div>

      {/* Selection action bar — the reference's footer. It only exists while
          Select is on, and each action states how many items it will touch, so
          "Delete" can never be a surprise. */}
      {selecting ? (
        <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] z-30 mx-auto mt-4 max-w-6xl px-2 sm:px-4">
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/70 bg-card/95 p-3 shadow-elevated backdrop-blur-xl">
            <span className="mr-auto text-sm text-muted-foreground">
              {selected.size === 0 ? "Select items to take action" : `${selected.size} selected`}
            </span>
            <button type="button" disabled={selected.size === 0} onClick={() => void shareSelected()} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-semibold transition hover:bg-secondary disabled:opacity-40">
              <Share2 className="h-4 w-4" /> Share
            </button>
            <button type="button" disabled={selected.size === 0} onClick={() => redownloadSelected()} className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-semibold transition hover:bg-secondary disabled:opacity-40">
              <Download className="h-4 w-4" /> Download again
            </button>
            <button type="button" disabled={selected.size === 0} onClick={() => deleteSelected()} className="inline-flex items-center gap-1.5 rounded-xl border border-rose-500/40 px-3 py-2 text-sm font-semibold text-rose-500 transition hover:bg-rose-500/10 disabled:opacity-40">
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => { tap(); onClick(); }}
      aria-pressed={active}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition duration-150 active:scale-[0.95]",
        active
          ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white shadow-sm"
          : "bg-secondary/70 text-muted-foreground ring-1 ring-inset ring-border/40 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Count({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-muted-foreground/15 px-1.5 text-[10px] font-bold text-muted-foreground">{children}</span>;
}
