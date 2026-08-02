"use client";

import {
  Check,
  Clock,
  Copy,
  Download,
  Heart,
  History,
  Image as ImageIcon,
  LayoutGrid,
  List as ListIcon,
  Loader2,
  Music,
  Play,
  Search,
  Trash2,
  Video,
} from "lucide-react";
import { type ComponentType, type ReactNode, useEffect, useMemo, useState } from "react";

import type { MediaKind } from "@/types";

import { SmartThumb } from "@/components/ui/smart-thumb";
import { startDownload } from "@/features/downloads/manager";
import { openPlayerQueue } from "@/features/downloads/player-store";
import { estimateBytes } from "@/features/history/usage";
import { haptic } from "@/lib/motion/haptics";
import { BRAND_ICONS } from "@/lib/platform-icons";
import { PLATFORMS } from "@/lib/platforms";
import { cn, formatBytes } from "@/lib/utils";
import type { DownloadRecord } from "@/types";

import { useHistory } from "./use-history";

const INITIAL_GRID = 18;
const INITIAL_LIST = 8;

type SortKey = "time" | "az" | "size" | "platform";
type ViewMode = "grid" | "list";

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

// View prefs persist per-browser (owner: "users can choose how many grid cols they
// want or if they prefer list form"). Only ever read on the client — the panel
// itself renders nothing until the local history loads, so there is no SSR render
// to mismatch against.
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

/** Sort a copy of `items` by the chosen key. "Top platform" ranks by how many
 *  downloads each platform has (most-downloaded first), then newest within it. */
function sortItems(items: DownloadRecord[], sort: SortKey): DownloadRecord[] {
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

export function HistoryPanel() {
  const { items, toggleFavorite, removeDownload, clearHistory } = useHistory();
  const [tab, setTab] = useState<"recent" | "favorites">("recent");
  const [query, setQuery] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  const [view, setView] = useState<ViewMode>("grid");
  const [cols, setCols] = useState<number>(3);
  const [sort, setSort] = useState<SortKey>("time");
  const [limit, setLimit] = useState(INITIAL_GRID);

  // Load persisted view prefs after mount (client-only; see VIEW_KEY comment).
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

  const favCount = useMemo(() => items.filter((i) => i.favorite).length, [items]);

  const filtered = useMemo(() => {
    const base = tab === "favorites" ? items.filter((i) => i.favorite) : items;
    const q = query.trim().toLowerCase();
    const matched = q
      ? base.filter((i) => i.title.toLowerCase().includes(q) || i.platformName.toLowerCase().includes(q))
      : base;
    return sortItems(matched, sort);
  }, [items, tab, query, sort]);

  if (items.length === 0) return null;

  const initial = view === "grid" ? INITIAL_GRID : INITIAL_LIST;
  const shown = filtered.slice(0, limit);
  const openAt = (idx: number) => {
    haptic("light");
    openPlayerQueue(filtered, idx);
  };

  return (
    <section id="history" className="border-t border-border/60 py-14 sm:py-20">
      {/* Minimal side padding (owner) so the media grid stretches to the far edges,
          iOS-Photos-style; the header/controls ride the same edge. */}
      <div className="mx-auto max-w-6xl px-2 sm:px-4">
        {/* Header */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-2xl font-bold tracking-[-0.02em] sm:text-3xl">
              <History className="h-6 w-6 text-primary" /> Your downloads
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {items.length} saved · stored privately on your private cloud
            </p>
          </div>

          {confirmClear ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Clear all?</span>
              <button type="button" onClick={() => { clearHistory(); setConfirmClear(false); }} className="rounded-lg bg-red-500/10 px-3 py-1.5 font-medium text-red-400 transition hover:bg-red-500/20">
                Yes, clear
              </button>
              <button type="button" onClick={() => setConfirmClear(false)} className="rounded-lg px-3 py-1.5 font-medium text-muted-foreground transition hover:text-foreground">
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmClear(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition hover:border-red-500/40 hover:text-red-400">
              <Trash2 className="h-3.5 w-3.5" /> Clear all
            </button>
          )}
        </div>

        {/* Controls: tabs · search · sort · view · (grid) columns */}
        <div className="mb-5 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-xl bg-secondary p-1">
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

          <div className="flex flex-wrap items-center gap-2">
            {/* Sort */}
            <label className="inline-flex items-center gap-2 rounded-xl bg-secondary/60 px-3 py-1.5 text-sm">
              <span className="text-muted-foreground">Sort</span>
              <select
                value={sort}
                onChange={(e) => { const s = e.target.value as SortKey; setSort(s); persist(SORT_KEY, s); setLimit(initial); }}
                aria-label="Sort downloads"
                className="bg-transparent font-semibold text-foreground outline-none"
              >
                {SORTS.map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>
            </label>

            {/* View toggle */}
            <div className="inline-flex rounded-xl bg-secondary/60 p-1">
              <ViewButton active={view === "grid"} label="Grid" onClick={() => { setView("grid"); persist(VIEW_KEY, "grid"); setLimit(INITIAL_GRID); }}>
                <LayoutGrid className="h-4 w-4" />
              </ViewButton>
              <ViewButton active={view === "list"} label="List" onClick={() => { setView("list"); persist(VIEW_KEY, "list"); setLimit(INITIAL_LIST); }}>
                <ListIcon className="h-4 w-4" />
              </ViewButton>
            </div>

            {/* Columns — grid only */}
            {view === "grid" ? (
              <div className="inline-flex items-center gap-1 rounded-xl bg-secondary/60 p-1">
                {COLUMN_CHOICES.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => { setCols(n); persist(COLS_KEY, String(n)); }}
                    aria-label={`${n} columns`}
                    aria-pressed={cols === n}
                    className={cn(
                      "h-8 w-8 rounded-lg text-sm font-bold tabular-nums transition",
                      cols === n ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
            {tab === "favorites" ? "No favorites yet — tap the heart on any download to save it here." : "No downloads match your search."}
          </p>
        ) : view === "grid" ? (
          <div
            className="grid gap-1.5 sm:gap-2"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
          >
            {shown.map((item, i) => (
              <GalleryTile key={item.id} item={item} onOpen={() => openAt(i)} onToggleFavorite={() => toggleFavorite(item.id)} />
            ))}
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
            {shown.map((item, i) => (
              <ListRow
                key={item.id}
                item={item}
                onOpen={() => openAt(i)}
                onToggleFavorite={() => toggleFavorite(item.id)}
                onRemove={() => removeDownload(item.id)}
              />
            ))}
          </div>
        )}

        {filtered.length > limit ? (
          <div className="mt-5 text-center">
            <button type="button" onClick={() => setLimit((n) => n + initial)} className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-2.5 text-sm font-semibold shadow-soft transition hover:bg-secondary">
              Show more ({filtered.length - limit})
            </button>
          </div>
        ) : filtered.length > initial ? (
          <div className="mt-5 text-center">
            <button type="button" onClick={() => setLimit(initial)} className="text-sm font-medium text-muted-foreground transition hover:text-foreground">
              Show less
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** iOS-Photos-style square tile: cropped thumbnail, platform + kind badges, a
 *  favorite heart, and a title scrim. Tapping opens the story-style player queue. */
function GalleryTile({ item, onOpen, onToggleFavorite }: { item: DownloadRecord; onOpen: () => void; onToggleFavorite: () => void }) {
  const platform = PLATFORMS[item.platform] ?? PLATFORMS.generic;
  const Icon = BRAND_ICONS[item.platform];
  const KindIcon = KIND_ICON[item.kind] ?? Video;
  return (
    <div className="group relative aspect-square overflow-hidden rounded-xl bg-black/40">
      <button type="button" onClick={onOpen} aria-label={`Watch ${item.title}`} className="absolute inset-0 h-full w-full">
        <SmartThumb
          src={item.thumbnail}
          alt=""
          className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.04]"
          fallback={<KindIcon className="h-7 w-7" />}
        />
        {/* Scrim + title */}
        <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent px-2 pb-1.5 pt-6">
          <span className="line-clamp-1 text-left text-[11px] font-medium text-white/95">{item.title}</span>
        </span>
        {/* Play affordance */}
        <span className="absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md">
            <Play className="ml-0.5 h-5 w-5 fill-white" />
          </span>
        </span>
      </button>

      {/* Platform badge (top-left) */}
      <span className={cn("pointer-events-none absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br text-white shadow", platform.accent)}>
        {Icon ? <Icon className="h-3.5 w-3.5" /> : <KindIcon className="h-3.5 w-3.5" />}
      </span>

      {/* Favorite toggle (top-right) */}
      <button
        type="button"
        onClick={onToggleFavorite}
        aria-label={item.favorite ? "Unfavorite" : "Favorite"}
        aria-pressed={item.favorite}
        className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur transition hover:bg-black/55 active:scale-90"
      >
        <Heart className={cn("h-3.5 w-3.5", item.favorite && "fill-rose-500 text-rose-500")} />
      </button>
    </div>
  );
}

/** Compact list row with the fuller action set (favorite / copy / re-download / remove). */
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
      {/* Square, compact cover — a wide aspect-video thumb crowded the row on a
          phone (owner). Fixed 56/64px keeps the text and actions roomy. */}
      <button type="button" onClick={onOpen} aria-label={`Watch ${item.title}`} className="group relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-black/40 sm:h-16 sm:w-16">
        <SmartThumb src={item.thumbnail} alt="" className="h-full w-full object-cover" fallback={<KindIcon className="h-5 w-5" />} />
        <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/25 group-hover:opacity-100">
          <Play className="h-5 w-5 fill-white text-white drop-shadow" />
        </span>
        <span className={cn("absolute bottom-0.5 left-0.5 flex h-4 w-4 items-center justify-center rounded bg-gradient-to-br text-white shadow", platform.accent)}>
          {Icon ? <Icon className="h-2.5 w-2.5" /> : <KindIcon className="h-2.5 w-2.5" />}
        </span>
      </button>

      {/* Text — every line is single + truncated, so nothing wraps roughly. */}
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

      {/* Compact action cluster — favourite always; the rest reveal from sm+ where
          there is room, so a phone row never gets crowded. */}
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

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium transition",
        active ? "bg-background shadow" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function ViewButton({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label} view`}
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition",
        active ? "bg-background text-foreground shadow" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function Count({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-muted-foreground/15 px-1.5 text-[10px] font-bold text-muted-foreground">{children}</span>;
}

function IconButton({ children, label, onClick, active, disabled }: { children: ReactNode; label: string; onClick: () => void; active?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "rounded-lg p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-50",
        active && "text-primary hover:text-primary",
      )}
    >
      {children}
    </button>
  );
}
