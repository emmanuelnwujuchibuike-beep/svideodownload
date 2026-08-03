"use client";

import { History, Search, Trash2 } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import { haptic } from "@/lib/motion/haptics";
import { playSound } from "@/lib/notifications/sound-fx";
import { cn } from "@/lib/utils";

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
export function HistoryPanel({ standalone = false }: { standalone?: boolean }) {
  const { items, toggleFavorite, removeDownload, clearHistory } = useHistory();
  const [tab, setTab] = useState<"recent" | "favorites">("recent");
  const [query, setQuery] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  const favCount = useMemo(() => items.filter((i) => i.favorite).length, [items]);

  const filtered = useMemo(() => {
    const base = tab === "favorites" ? items.filter((i) => i.favorite) : items;
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter((i) => i.title.toLowerCase().includes(q) || i.platformName.toLowerCase().includes(q));
  }, [items, tab, query]);

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
            <p className="mt-1 text-sm text-muted-foreground">{items.length} saved · stored privately on your private cloud</p>
          </div>

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

        {/* Tabs + search */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-xl bg-secondary p-1 shadow-sm ring-1 ring-inset ring-border/40">
            <TabButton active={tab === "recent"} onClick={() => setTab("recent")}>
              Recent <Count>{items.length}</Count>
            </TabButton>
            <TabButton active={tab === "favorites"} onClick={() => setTab("favorites")}>
              Favorites <Count>{favCount}</Count>
            </TabButton>
          </div>

          <div className="relative sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search downloads…"
              aria-label="Search downloads"
              className="h-10 w-full rounded-xl bg-background px-3 pl-9 text-sm outline-none ring-1 ring-inset ring-border transition focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>

        <MediaGallery
          items={filtered}
          onToggleFavorite={toggleFavorite}
          onRemove={removeDownload}
          emptyText={tab === "favorites" ? "No favorites yet — tap the heart on any download to save it here." : "No downloads match your search."}
        />
      </div>
    </section>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => { tap(); onClick(); }}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition duration-150 active:scale-[0.95]",
        active ? "bg-background text-foreground shadow-sm ring-1 ring-inset ring-border/60" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Count({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-muted-foreground/15 px-1.5 text-[10px] font-bold text-muted-foreground">{children}</span>;
}
