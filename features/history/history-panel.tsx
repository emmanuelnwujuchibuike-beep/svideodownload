"use client";

import {
  Check,
  Copy,
  Download,
  Heart,
  History,
  Loader2,
  Trash2,
  Video,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import { downloadToDisk } from "@/lib/client-download";
import { cn } from "@/lib/utils";
import type { DownloadRecord } from "@/types";

import { useHistory } from "./use-history";

export function HistoryPanel() {
  const { items, toggleFavorite, removeDownload, clearHistory } = useHistory();
  const [tab, setTab] = useState<"recent" | "favorites">("recent");

  if (items.length === 0) return null;

  const shown = tab === "favorites" ? items.filter((i) => i.favorite) : items;

  return (
    <section id="history" className="border-t border-border/60 py-16">
      <div className="container max-w-4xl">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-2xl font-bold">
            <History className="h-6 w-6 text-primary" /> Your downloads
          </h2>
          <button
            type="button"
            onClick={clearHistory}
            className="text-sm text-muted-foreground transition hover:text-red-400"
          >
            Clear all
          </button>
        </div>

        <div className="mb-4 inline-flex rounded-lg bg-secondary p-1">
          {(["recent", "favorites"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "rounded-md px-4 py-1.5 text-sm font-medium capitalize transition",
                tab === t
                  ? "bg-background shadow"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {shown.length === 0 ? (
          <p className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
            No favorites yet — tap the heart on any download to save it here.
          </p>
        ) : (
          <ul className="space-y-2">
            {shown.map((item) => (
              <HistoryRow
                key={item.id}
                item={item}
                onToggleFavorite={() => toggleFavorite(item.id)}
                onRemove={() => removeDownload(item.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function HistoryRow({
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
    downloadToDisk({
      url: item.url,
      formatId: item.formatId,
      kind: item.kind,
      title: item.title,
    });
    setTimeout(() => setRedownloading(false), 1200);
  };

  return (
    <li className="glass flex items-center gap-3 rounded-xl p-2.5">
      <div className="relative h-12 w-20 shrink-0 overflow-hidden rounded-md bg-black/40">
        {item.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.thumbnail}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <Video className="h-5 w-5" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.title}</p>
        <p className="text-xs text-muted-foreground">
          {item.platformName} · {item.qualityLabel} ·{" "}
          {new Date(item.createdAt).toLocaleDateString()}
        </p>
      </div>

      <div className="flex items-center gap-1">
        <IconButton label="Favorite" onClick={onToggleFavorite} active={item.favorite}>
          <Heart className={cn("h-4 w-4", item.favorite && "fill-current")} />
        </IconButton>
        <IconButton label="Copy link" onClick={copyLink}>
          {copied ? <Check className="h-4 w-4 text-green-400" /> : <Copy className="h-4 w-4" />}
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
    </li>
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
