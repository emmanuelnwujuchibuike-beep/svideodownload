"use client";

import {
  Check,
  Clock,
  Copy,
  Download,
  Heart,
  Image as ImageIcon,
  LayoutGrid,
  List as ListIcon,
  Loader2,
  Music,
  Play,
  Trash2,
  Video,
} from "lucide-react";
import { type ComponentType, type ReactNode, useEffect, useMemo, useState } from "react";

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

export function MediaGallery({
  items,
  onToggleFavorite,
  onRemove,
  initialGrid = 18,
  initialList = 8,
  emptyText = "No downloads yet.",
}: {
  items: DownloadRecord[];
  onToggleFavorite: (id: string) => void;
  onRemove: (id: string) => void;
  initialGrid?: number;
  initialList?: number;
  emptyText?: string;
}) {
  const [view, setView] = useState<ViewMode>("grid");
  const [cols, setCols] = useState<number>(3);
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
  const openAt = (idx: number) => {
    haptic("light");
    openPlayerQueue(sorted, idx);
  };

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
      ) : view === "grid" ? (
        <div className="grid gap-1.5 sm:gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {shown.map((item, i) => (
            <GalleryTile key={item.id} item={item} onOpen={() => openAt(i)} onToggleFavorite={() => onToggleFavorite(item.id)} />
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
          {shown.map((item, i) => (
            <ListRow key={item.id} item={item} onOpen={() => openAt(i)} onToggleFavorite={() => onToggleFavorite(item.id)} onRemove={() => onRemove(item.id)} />
          ))}
        </div>
      )}

      {sorted.length > limit ? (
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
function GalleryTile({ item, onOpen, onToggleFavorite }: { item: DownloadRecord; onOpen: () => void; onToggleFavorite: () => void }) {
  const platform = PLATFORMS[item.platform] ?? PLATFORMS.generic;
  const Icon = BRAND_ICONS[item.platform];
  const KindIcon = KIND_ICON[item.kind] ?? Video;
  return (
    <div className="group relative aspect-square overflow-hidden rounded-xl bg-black/40">
      <button type="button" onClick={onOpen} aria-label={`Watch ${item.title}`} className="absolute inset-0 h-full w-full">
        <SmartThumb src={item.thumbnail} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.04]" fallback={<KindIcon className="h-7 w-7" />} />
        <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent px-2 pb-1.5 pt-6">
          <span className="line-clamp-1 text-left text-[11px] font-medium text-white/95">{item.title}</span>
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
      <button
        type="button"
        onClick={() => { tap(); onToggleFavorite(); }}
        aria-label={item.favorite ? "Unfavorite" : "Favorite"}
        aria-pressed={item.favorite}
        className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur transition duration-150 hover:bg-black/55 active:scale-[0.82]"
      >
        <Heart className={cn("h-3.5 w-3.5", item.favorite && "fill-rose-500 text-rose-500")} />
      </button>
    </div>
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
