"use client";

import {
  Check,
  Copy,
  Download,
  Heart,
  History,
  Image as ImageIcon,
  Loader2,
  Music,
  Search,
  Trash2,
  Video,
} from "lucide-react";
import { type ComponentType, type ReactNode, useMemo, useState } from "react";

import type { MediaKind } from "@/types";

import { startDownload } from "@/features/downloads/manager";
import { BRAND_ICONS } from "@/lib/platform-icons";
import { PLATFORMS } from "@/lib/platforms";
import { cn } from "@/lib/utils";
import type { DownloadRecord } from "@/types";

import { useHistory } from "./use-history";

const INITIAL_VISIBLE = 6;

const KIND_ICON: Record<MediaKind, ComponentType<{ className?: string }>> = {
  video: Video,
  audio: Music,
  image: ImageIcon,
};

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

export function HistoryPanel() {
  const { items, toggleFavorite, removeDownload, clearHistory } = useHistory();
  const [tab, setTab] = useState<"recent" | "favorites">("recent");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const favCount = useMemo(() => items.filter((i) => i.favorite).length, [items]);

  const filtered = useMemo(() => {
    const base = tab === "favorites" ? items.filter((i) => i.favorite) : items;
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        i.platformName.toLowerCase().includes(q),
    );
  }, [items, tab, query]);

  if (items.length === 0) return null;

  const searching = query.trim().length > 0;
  const collapsed = !expanded && !searching;
  const shown = collapsed ? filtered.slice(0, INITIAL_VISIBLE) : filtered;
  const overflow = filtered.length - INITIAL_VISIBLE;

  return (
    <section id="history" className="border-t border-border/60 py-16 sm:py-20">
      <div className="container max-w-5xl">
        {/* Header */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-2xl font-bold tracking-[-0.02em] sm:text-3xl">
              <History className="h-6 w-6 text-primary" /> Your downloads
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {items.length} saved · stored privately on this device
            </p>
          </div>

          {confirmClear ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Clear all?</span>
              <button
                type="button"
                onClick={() => {
                  clearHistory();
                  setConfirmClear(false);
                }}
                className="rounded-lg bg-red-500/10 px-3 py-1.5 font-medium text-red-400 transition hover:bg-red-500/20"
              >
                Yes, clear
              </button>
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="rounded-lg px-3 py-1.5 font-medium text-muted-foreground transition hover:text-foreground"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground transition hover:border-red-500/40 hover:text-red-400"
            >
              <Trash2 className="h-3.5 w-3.5" /> Clear all
            </button>
          )}
        </div>

        {/* Controls */}
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="inline-flex rounded-xl bg-secondary p-1">
            <TabButton active={tab === "recent"} onClick={() => setTab("recent")}>
              Recent
              <Count>{items.length}</Count>
            </TabButton>
            <TabButton
              active={tab === "favorites"}
              onClick={() => setTab("favorites")}
            >
              Favorites
              <Count>{favCount}</Count>
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

        {filtered.length === 0 ? (
          <p className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
            {tab === "favorites"
              ? "No favorites yet — tap the heart on any download to save it here."
              : "No downloads match your search."}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {shown.map((item) => (
                <HistoryCard
                  key={item.id}
                  item={item}
                  onToggleFavorite={() => toggleFavorite(item.id)}
                  onRemove={() => removeDownload(item.id)}
                />
              ))}
            </div>

            {collapsed && overflow > 0 ? (
              <div className="mt-5 text-center">
                <button
                  type="button"
                  onClick={() => setExpanded(true)}
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-2.5 text-sm font-semibold shadow-soft transition hover:bg-secondary"
                >
                  Show all {filtered.length} downloads
                </button>
              </div>
            ) : null}

            {expanded && !searching ? (
              <div className="mt-5 text-center">
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  className="text-sm font-medium text-muted-foreground transition hover:text-foreground"
                >
                  Show less
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}

function HistoryCard({
  item,
  onToggleFavorite,
  onRemove,
}: {
  item: DownloadRecord;
  onToggleFavorite: () => void;
  onRemove: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [redownloading, setRedownloading] = useState(false);
  const platform = PLATFORMS[item.platform] ?? PLATFORMS.generic;
  const Icon = BRAND_ICONS[item.platform];
  const KindIcon = KIND_ICON[item.kind] ?? Video;

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
    // Background stream with the floating progress card — never a raw-file
    // navigation (the old path stranded iOS on a Quick Look preview).
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
    <div className="group flex items-center gap-3 rounded-2xl border border-border bg-card p-2.5 shadow-soft transition hover:border-foreground/15 hover:shadow-card">
      <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded-xl bg-black/40">
        {item.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.thumbnail} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <KindIcon className="h-5 w-5" />
          </div>
        )}
        <span
          className={cn(
            "absolute bottom-1 left-1 flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br text-white shadow",
            platform.accent,
          )}
        >
          {Icon ? <Icon className="h-3 w-3" /> : null}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{item.title}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
            <KindIcon className="h-2.5 w-2.5" />
            {item.qualityLabel}
          </span>
          <span className="text-xs text-muted-foreground">
            {item.platformName}
          </span>
          <span className="text-xs text-muted-foreground/60">·</span>
          <span className="text-xs text-muted-foreground/80">
            {timeAgo(item.createdAt)}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center">
        <IconButton label="Favorite" onClick={onToggleFavorite} active={item.favorite}>
          <Heart className={cn("h-4 w-4", item.favorite && "fill-current")} />
        </IconButton>
        <IconButton label="Copy link" onClick={copyLink}>
          {copied ? (
            <Check className="h-4 w-4 text-green-400" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </IconButton>
        <IconButton label="Re-download" onClick={reDownload} disabled={redownloading}>
          {redownloading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
        </IconButton>
        <IconButton label="Remove" onClick={onRemove}>
          <Trash2 className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-medium transition",
        active
          ? "bg-background shadow"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Count({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-muted-foreground/15 px-1.5 text-[10px] font-bold text-muted-foreground">
      {children}
    </span>
  );
}

function IconButton({
  children,
  label,
  onClick,
  active,
  disabled,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
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
