"use client";

import {
  Check,
  ChevronDown,
  Clock,
  Copy,
  Download,
  Heart,
  Image as ImageIcon,
  LayoutGrid,
  List as ListIcon,
  Loader2,
  MoreHorizontal,
  Music,
  Play,
  Trash2,
  Video,
} from "lucide-react";
import { type ComponentType, type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { SmartThumb } from "@/components/ui/smart-thumb";
import { startDownload } from "@/features/downloads/manager";
import { openPlayerQueue } from "@/features/downloads/player-store";
import { estimateBytes } from "@/features/history/usage";
import { haptic } from "@/lib/motion/haptics";
import { playSound } from "@/lib/notifications/sound-fx";
import { BRAND_ICONS } from "@/lib/platform-icons";
import { PLATFORMS } from "@/lib/platforms";
import { cn, formatBytes } from "@/lib/utils";
import type { DownloadRecord, MediaKind } from "@/types";

/**
 * The iOS-Photos-style download gallery — a Grid ⇄ List toggle, a 2–5 column
 * picker, and a sort control (Recent / Alphabetical / Largest / Top platform),
 * with view prefs persisted per-browser. Tapping any tile opens the story-style
 * player QUEUE so the whole gallery can be swiped through. Shared by the landing
 * history (HistoryPanel) and the signed-in Downloads page so both look identical
 * (owner). Callers pass ALREADY-FILTERED items (tab/search); the gallery owns the
 * sort + view.
 */

export type SortKey = "time" | "az" | "size" | "platform";
type ViewMode = "grid" | "list";

/** Premium tactile feedback fired on every history control — a soft haptic + the
 *  same nav "tap" tone the bottom nav uses (owner: "haptic sound in all the buttons
 *  in the history page"). */
function tap() {
  haptic("light");
  playSound("tap");
}

const KIND_ICON: Record<MediaKind, ComponentType<{ className?: string }>> = {
  video: Video,
  audio: Music,
  image: ImageIcon,
};

const SORTS: { key: SortKey; label: string }[] = [
  { key: "time", label: "Recent" },
  { key: "az", label: "Alphabetical" },
  { key: "size", label: "Largest" },
  { key: "platform", label: "Top platform" },
];

const COLUMN_CHOICES = [2, 3, 4, 5] as const;

const VIEW_KEY = "frenz:gallery-view";
const COLS_KEY = "frenz:gallery-cols";
const SORT_KEY = "frenz:gallery-sort";

/** `137` → `2:17`. Used for the duration chip on a history tile. */
function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

function timeAgo(ts: number): string {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return "just now";
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)}h ago`;
  const d = h / 24;
  if (d < 7) return `${Math.floor(d)}d ago`;
  return new Date(ts).toLocaleDateString();
}

function formatDateTime(ts: number): { date: string; time: string } {
  const d = new Date(ts);
  const thisYear = d.getFullYear() === new Date().getFullYear();
  return {
    date: d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(thisYear ? {} : { year: "numeric" }) }),
    time: d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
  };
}

/** Sort a copy of `items`. "Top platform" ranks by how many downloads each
 *  platform has (most first), then newest within it. */
export function sortItems(items: DownloadRecord[], sort: SortKey): DownloadRecord[] {
  const arr = [...items];
  if (sort === "az") return arr.sort((a, b) => a.title.localeCompare(b.title));
  if (sort === "size") return arr.sort((a, b) => estimateBytes(b) - estimateBytes(a));
  if (sort === "platform") {
    const counts = new Map<string, number>();
    for (const it of arr) counts.set(it.platform, (counts.get(it.platform) ?? 0) + 1);
    return arr.sort((a, b) => {
      const d = (counts.get(b.platform) ?? 0) - (counts.get(a.platform) ?? 0);
      if (d) return d;
      if (a.platform !== b.platform) return a.platform.localeCompare(b.platform);
      return b.createdAt - a.createdAt;
    });
  }
  return arr.sort((a, b) => b.createdAt - a.createdAt);
}

export interface GallerySelection {
  active: boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
}

export function MediaGallery({
  items,
  onToggleFavorite,
  onRemove,
  initialGrid = 18,
  initialList = 8,
  emptyText = "No downloads yet.",
  groupByDay = false,
  selection,
}: {
  items: DownloadRecord[];
  onToggleFavorite: (id: string) => void;
  onRemove: (id: string) => void;
  initialGrid?: number;
  initialList?: number;
  emptyText?: string;
  /** Break the grid into Today / Yesterday / This week / Earlier sections, each
   *  with a count and collapsible (the history reference,
   *  public/new downloadhistory.jpg). Only meaningful with the Recent sort — any
   *  other order would put the same day in several places, so it's ignored. */
  groupByDay?: boolean;
  /** Multi-select mode: tiles toggle instead of opening the player. */
  selection?: GallerySelection;
}) {
  const [view, setView] = useState<ViewMode>("grid");
  /*
    TWO columns by default (owner, 2026-08-09: "make the grid cols selectable,
    grid cols 2 as default").

    The reference image is drawn at three, and three is what this defaulted to —
    but at three, on a phone, a downloaded video is a 110px thumbnail with a
    one-line title under it, and you cannot tell two clips of the same creator
    apart. Two is the width at which a thumbnail is actually a preview. The
    picker is right there for anyone who wants to see more at once, and the
    choice persists per browser.
  */
  const [cols, setCols] = useState<number>(2);
  const [sort, setSort] = useState<SortKey>("time");
  const [limit, setLimit] = useState(initialGrid);

  // Load persisted view prefs after mount (client-only — the panels this renders
  // in only paint after the local history loads, so there is no SSR mismatch).
  useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      if (v === "grid" || v === "list") setView(v);
      const c = Number(localStorage.getItem(COLS_KEY));
      if (COLUMN_CHOICES.includes(c as (typeof COLUMN_CHOICES)[number])) setCols(c);
      const s = localStorage.getItem(SORT_KEY);
      if (s && SORTS.some((o) => o.key === s)) setSort(s as SortKey);
    } catch {
      /* storage blocked — defaults are fine */
    }
  }, []);

  const persist = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  };

  const sorted = useMemo(() => sortItems(items, sort), [items, sort]);
  const initial = view === "grid" ? initialGrid : initialList;
  const shown = sorted.slice(0, limit);

  /*
    Day groups. Only for the Recent sort — under "Largest" or "Alphabetical" the
    same day would appear in several places, so a "Today" heading would be a lie.
    Grouping shows EVERYTHING rather than paging, because the headings are the
    way you navigate a long history; a "Show more" under them would fight that.
  */
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const grouped = useMemo(() => {
    if (!groupByDay || sort !== "time") return null;
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const today = midnight.getTime();
    const yesterday = today - 86_400_000;
    const week = today - 6 * 86_400_000;

    const buckets: { key: string; label: string; items: DownloadRecord[] }[] = [
      { key: "today", label: "Today", items: [] },
      { key: "yesterday", label: "Yesterday", items: [] },
      { key: "week", label: "This week", items: [] },
      { key: "earlier", label: "Earlier", items: [] },
    ];
    for (const item of sorted) {
      const t = item.createdAt;
      const bucket = t >= today ? 0 : t >= yesterday ? 1 : t >= week ? 2 : 3;
      buckets[bucket]!.items.push(item);
    }
    return buckets.filter((b) => b.items.length > 0);
  }, [groupByDay, sort, sorted]);
  const openAt = (idx: number) => {
    haptic("light");
    openPlayerQueue(sorted, idx);
  };

  /*
    Deep-link review (owner, 2026-08-04): the download-complete card links here
    with `?review=<id>` instead of opening its own isolated player, so the clip
    is reviewed in history with the whole library as its queue.

    Runs ONCE per id: the ref guard stops the player reopening every time
    `sorted` changes (a sort switch, a new download landing) — which would yank
    a visitor who had already closed it straight back in. The query param is
    then stripped with `replaceState`, so a refresh or a Back doesn't replay it.
    A missing id simply does nothing; history is already the right place to be.
  */
  const reviewed = useRef<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined" || sorted.length === 0) return;
    const id = new URLSearchParams(window.location.search).get("review");
    if (!id || reviewed.current === id) return;
    reviewed.current = id;
    const idx = sorted.findIndex((item) => item.id === id);
    if (idx >= 0) openPlayerQueue(sorted, idx);
    const url = new URL(window.location.href);
    url.searchParams.delete("review");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    // `sorted` is intentionally the only dependency — see the note above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted]);

  return (
    <div>
      {/* Controls: sort · view · (grid) columns */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="inline-flex h-11 items-center gap-2 rounded-xl bg-secondary/60 px-3.5 text-sm shadow-sm ring-1 ring-inset ring-border/40">
          <span className="text-muted-foreground">Sort</span>
          <select
            value={sort}
            onChange={(e) => { tap(); const s = e.target.value as SortKey; setSort(s); persist(SORT_KEY, s); setLimit(initial); }}
            aria-label="Sort downloads"
            className="bg-transparent font-semibold text-foreground outline-none"
          >
            {SORTS.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
        </label>

        <div className="inline-flex rounded-xl bg-secondary/60 p-1 shadow-sm ring-1 ring-inset ring-border/40">
          <ViewButton active={view === "grid"} label="Grid" onClick={() => { setView("grid"); persist(VIEW_KEY, "grid"); setLimit(initialGrid); }}>
            <LayoutGrid className="h-4 w-4" />
          </ViewButton>
          <ViewButton active={view === "list"} label="List" onClick={() => { setView("list"); persist(VIEW_KEY, "list"); setLimit(initialList); }}>
            <ListIcon className="h-4 w-4" />
          </ViewButton>
        </div>

        {view === "grid" ? (
          <div className="inline-flex items-center gap-1 rounded-xl bg-secondary/60 p-1 shadow-sm ring-1 ring-inset ring-border/40">
            {COLUMN_CHOICES.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => { tap(); setCols(n); persist(COLS_KEY, String(n)); }}
                aria-label={`${n} columns`}
                aria-pressed={cols === n}
                className={cn(
                  "h-9 w-9 rounded-xl text-sm font-bold tabular-nums transition duration-150 active:scale-[0.9]",
                  cols === n ? "bg-background text-foreground shadow-sm ring-1 ring-inset ring-border/60" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {n}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {sorted.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground">{emptyText}</p>
      ) : view === "grid" && grouped ? (
        <div className="space-y-5">
          {grouped.map((g) => (
            <section key={g.key}>
              <button
                type="button"
                onClick={() => { tap(); setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] })); }}
                aria-expanded={!collapsed[g.key]}
                className="mb-2 flex w-full items-center justify-between gap-3 text-left"
              >
                <span className="text-lg font-bold tracking-tight">{g.label}</span>
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  {g.items.length} item{g.items.length === 1 ? "" : "s"}
                  <ChevronDown className={cn("h-4 w-4 transition-transform", collapsed[g.key] && "-rotate-90")} />
                </span>
              </button>
              {collapsed[g.key] ? null : (
                <div className="grid gap-1.5 sm:gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                  {g.items.map((item) => (
                    <GalleryTile
                      key={item.id}
                      item={item}
                      onOpen={() => openAt(sorted.indexOf(item))}
                      onToggleFavorite={() => onToggleFavorite(item.id)}
                      onRemove={() => onRemove(item.id)}
                      selection={selection}
                    />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      ) : view === "grid" ? (
        <div className="grid gap-1.5 sm:gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {shown.map((item, i) => (
            <GalleryTile key={item.id} item={item} onOpen={() => openAt(i)} onToggleFavorite={() => onToggleFavorite(item.id)} onRemove={() => onRemove(item.id)} selection={selection} />
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
          {shown.map((item, i) => (
            <ListRow key={item.id} item={item} onOpen={() => openAt(i)} onToggleFavorite={() => onToggleFavorite(item.id)} onRemove={() => onRemove(item.id)} />
          ))}
        </div>
      )}

      {/* Grouped view renders everything under its headings, so paging would
          only get in the way of them. */}
      {grouped && view === "grid" ? null : sorted.length > limit ? (
        <div className="mt-5 text-center">
          <button type="button" onClick={() => setLimit((n) => n + initial)} className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-2.5 text-sm font-semibold shadow-soft transition hover:bg-secondary">
            Show more ({sorted.length - limit})
          </button>
        </div>
      ) : sorted.length > initial ? (
        <div className="mt-5 text-center">
          <button type="button" onClick={() => setLimit(initial)} className="text-sm font-medium text-muted-foreground transition hover:text-foreground">
            Show less
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** iOS-Photos-style square tile. */
/**
 * One history tile — built to public/mainhistorypage.jpg.
 *
 * The reference's anatomy, corner by corner:
 *   top-left     a small rounded badge for what the item IS
 *   top-right    a circular "…" that opens the item's actions
 *   bottom-left  a media glyph and, for a video, its length
 *   bottom       the title over a scrim
 *
 * ── Why "…" replaced the heart ────────────────────────────────────────────────
 * The heart was the only action a tile had, so everything else — copy the link,
 * download it again, remove it — lived exclusively in List view. Someone in Grid
 * view had no way to reach them at all. The menu keeps favouriting as its first
 * entry and gives the other three a home, which is what the reference's "…"
 * implies and what the page was missing.
 *
 * ── Why the duration is sometimes absent ──────────────────────────────────────
 * `durationSeconds` is only known when the extractor reported it, and every
 * record saved before that field existed has none. A missing length shows the
 * glyph alone, exactly as the reference's photo tiles do — never "0:00", which
 * would be a statement about the file rather than a gap in what we know.
 */
function GalleryTile({
  item,
  onOpen,
  onToggleFavorite,
  onRemove,
  selection,
}: {
  item: DownloadRecord;
  onOpen: () => void;
  onToggleFavorite: () => void;
  onRemove: () => void;
  selection?: GallerySelection;
}) {
  const platform = PLATFORMS[item.platform] ?? PLATFORMS.generic;
  const Icon = BRAND_ICONS[item.platform];
  const KindIcon = KIND_ICON[item.kind] ?? Video;
  const selecting = !!selection?.active;
  const picked = !!selection?.selected.has(item.id);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // Close on any outside tap. A menu pinned to a tile in a scrolling grid that
  // stays open while you scroll away is worse than no menu.
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("pointerdown", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("pointerdown", close);
    };
  }, [menuOpen]);

  return (
    <div className={cn("group relative aspect-square overflow-hidden rounded-2xl bg-black/40", picked && "ring-2 ring-primary")}>
      <button
        type="button"
        // In select mode the whole tile toggles instead of opening the player —
        // otherwise picking items would launch a video on every tap.
        onClick={selecting ? () => { tap(); selection!.onToggle(item.id); } : onOpen}
        aria-label={selecting ? `${picked ? "Deselect" : "Select"} ${item.title}` : `Watch ${item.title}`}
        aria-pressed={selecting ? picked : undefined}
        className="absolute inset-0 h-full w-full"
      >
        <SmartThumb src={item.thumbnail} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.04]" fallback={<KindIcon className="h-7 w-7" />} />
        <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent px-2 pb-1.5 pt-10">
          {/* The duration chip sits ABOVE the title, as in the reference. */}
          <span className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-white/90">
            <KindIcon className="h-3.5 w-3.5 drop-shadow" />
            {item.kind === "video" && item.durationSeconds ? formatClock(item.durationSeconds) : null}
          </span>
          <span className="line-clamp-1 block text-left text-[11px] font-medium text-white/95">{item.title}</span>
        </span>
        <span className="absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md">
            <Play className="ml-0.5 h-5 w-5 fill-white" />
          </span>
        </span>
      </button>

      <span className={cn("pointer-events-none absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br text-white shadow", platform.accent)}>
        {Icon ? <Icon className="h-3.5 w-3.5" /> : <KindIcon className="h-3.5 w-3.5" />}
      </span>

      {/* In select mode the corner shows the tick instead of the menu — opening
          a menu mid-selection is an easy mis-tap with an annoying result. */}
      {selecting ? (
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full ring-2 ring-white/80 transition",
            picked ? "bg-primary text-primary-foreground" : "bg-black/30",
          )}
        >
          {picked ? <Check className="h-3.5 w-3.5" /> : null}
        </span>
      ) : (
        <>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); tap(); setMenuOpen((o) => !o); }}
            onPointerDown={(e) => e.stopPropagation()}
            aria-label={`Actions for ${item.title}`}
            aria-expanded={menuOpen}
            className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur transition duration-150 hover:bg-black/60 active:scale-[0.85]"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>

          {/* A favourite is worth seeing at a glance without opening anything,
              so it keeps a corner of its own once it is set. */}
          {item.favorite ? (
            <span aria-hidden className="pointer-events-none absolute right-1.5 top-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/40 backdrop-blur">
              <Heart className="h-3.5 w-3.5 fill-rose-500 text-rose-500" />
            </span>
          ) : null}

          {menuOpen ? (
            <div
              role="menu"
              onPointerDown={(e) => e.stopPropagation()}
              className="absolute right-1.5 top-10 z-20 w-40 overflow-hidden rounded-xl border border-border/70 bg-card/95 text-left shadow-elevated backdrop-blur-xl animate-in fade-in zoom-in-95 duration-150 motion-reduce:animate-none"
            >
              <TileAction
                icon={<Heart className={cn("h-3.5 w-3.5", item.favorite && "fill-rose-500 text-rose-500")} />}
                label={item.favorite ? "Unfavourite" : "Favourite"}
                onClick={() => { onToggleFavorite(); setMenuOpen(false); }}
              />
              <TileAction
                icon={<Download className="h-3.5 w-3.5" />}
                label="Download again"
                onClick={() => {
                  startDownload({
                    url: item.url,
                    formatId: item.formatId,
                    kind: item.kind,
                    title: item.title,
                    thumbnail: item.thumbnail,
                    platform: item.platform,
                    platformName: item.platformName,
                    qualityLabel: item.qualityLabel,
                    durationSeconds: item.durationSeconds ?? null,
                  });
                  setMenuOpen(false);
                }}
              />
              <TileAction
                icon={copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                label={copied ? "Copied" : "Copy link"}
                onClick={() => {
                  void navigator.clipboard?.writeText(item.url).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1200);
                  }).catch(() => {});
                }}
              />
              <TileAction
                icon={<Trash2 className="h-3.5 w-3.5" />}
                label="Remove"
                destructive
                onClick={() => { onRemove(); setMenuOpen(false); }}
              />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function TileAction({
  icon,
  label,
  destructive,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => { tap(); onClick(); }}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-2.5 text-xs font-semibold transition hover:bg-secondary",
        destructive && "text-rose-500 hover:bg-rose-500/10",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/** Compact, professional list row. */
function ListRow({ item, onOpen, onToggleFavorite, onRemove }: { item: DownloadRecord; onOpen: () => void; onToggleFavorite: () => void; onRemove: () => void }) {
  const [copied, setCopied] = useState(false);
  const [redownloading, setRedownloading] = useState(false);
  const platform = PLATFORMS[item.platform] ?? PLATFORMS.generic;
  const Icon = BRAND_ICONS[item.platform];
  const KindIcon = KIND_ICON[item.kind] ?? Video;
  const { date, time } = formatDateTime(item.createdAt);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(item.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };
  const reDownload = () => {
    setRedownloading(true);
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
    setTimeout(() => setRedownloading(false), 1200);
  };

  return (
    <div className="flex items-center gap-3 border-b border-border/50 px-2.5 py-2.5 last:border-b-0 hover:bg-secondary/40 sm:px-3">
      <button type="button" onClick={onOpen} aria-label={`Watch ${item.title}`} className="group relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-black/40 sm:h-16 sm:w-16">
        <SmartThumb src={item.thumbnail} alt="" className="h-full w-full object-cover" fallback={<KindIcon className="h-5 w-5" />} />
        <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/25 group-hover:opacity-100">
          <Play className="h-5 w-5 fill-white text-white drop-shadow" />
        </span>
        <span className={cn("absolute bottom-0.5 left-0.5 flex h-4 w-4 items-center justify-center rounded bg-gradient-to-br text-white shadow", platform.accent)}>
          {Icon ? <Icon className="h-2.5 w-2.5" /> : <KindIcon className="h-2.5 w-2.5" />}
        </span>
      </button>

      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <p className="truncate text-sm font-semibold leading-tight">{item.title}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {item.platformName} · {item.qualityLabel} · {formatBytes(estimateBytes(item))}
        </p>
        <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-muted-foreground/70">
          <Clock className="h-3 w-3 shrink-0" />
          <span className="tabular-nums">{date} · {time}</span>
          <span aria-hidden>·</span>
          {timeAgo(item.createdAt)}
        </p>
      </button>

      <div className="flex shrink-0 items-center">
        <IconButton label="Favorite" onClick={onToggleFavorite} active={item.favorite}>
          <Heart className={cn("h-4 w-4", item.favorite && "fill-current")} />
        </IconButton>
        <span className="hidden sm:inline-flex">
          <IconButton label="Copy link" onClick={copyLink}>
            {copied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
          </IconButton>
        </span>
        <IconButton label="Re-download" onClick={reDownload} disabled={redownloading}>
          {redownloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        </IconButton>
        <IconButton label="Remove" onClick={onRemove}>
          <Trash2 className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  );
}

function ViewButton({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => { tap(); onClick(); }}
      aria-label={`${label} view`}
      aria-pressed={active}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-sm font-semibold transition duration-150 active:scale-[0.94]",
        active ? "bg-background text-foreground shadow-sm ring-1 ring-inset ring-border/60" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function IconButton({ children, label, onClick, active, disabled }: { children: ReactNode; label: string; onClick: () => void; active?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => { tap(); onClick(); }}
      disabled={disabled}
      className={cn(
        "rounded-xl p-2 text-muted-foreground transition duration-150 hover:bg-secondary hover:text-foreground active:scale-[0.88] disabled:opacity-50",
        active && "text-primary hover:text-primary",
      )}
    >
      {children}
    </button>
  );
}
