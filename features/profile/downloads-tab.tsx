"use client";

import { IoDownloadOutline, IoPlay } from "react-icons/io5";

import { useHistory } from "@/features/history/use-history";
import { cn } from "@/lib/utils";

function fmtSize(bytes?: number | null): string | null {
  if (!bytes || bytes <= 0) return null;
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

/**
 * The owner's Downloads tab — every video they've grabbed with the downloader on
 * this account AND this device (the local history store), including downloads
 * made before they ever created an account. Purely client-side so it opens
 * instantly and never blocks on the network.
 */
export function DownloadsTab({ emptyText }: { emptyText: string }) {
  const { items } = useHistory();

  if (items.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-border/70 bg-card/50 p-10 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
          <IoDownloadOutline className="h-6 w-6" />
        </span>
        <p className="mt-3 text-sm text-muted-foreground">{emptyText}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {items.map((r) => (
        <a
          key={r.id}
          href={r.url}
          target="_blank"
          rel="noreferrer"
          className="group overflow-hidden rounded-2xl border border-border/60 bg-card shadow-soft transition hover:shadow-elevated"
        >
          <div className="relative aspect-video overflow-hidden bg-neutral-900">
            {r.thumbnail ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={r.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-blue-600/25 to-violet-600/25 text-white/40">
                <IoPlay className="h-8 w-8" />
              </div>
            )}
            <span className={cn("absolute bottom-1.5 right-1.5 rounded-md bg-black/65 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur")}>
              {r.qualityLabel || r.kind}
            </span>
            {r.platformName ? (
              <span className="absolute left-1.5 top-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
                {r.platformName}
              </span>
            ) : null}
          </div>
          <div className="p-2.5">
            <p className="line-clamp-2 text-xs font-semibold leading-snug">{r.title || r.url}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {fmtSize(r.size) ? `${fmtSize(r.size)} · ` : ""}
              {new Date(r.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </p>
          </div>
        </a>
      ))}
    </div>
  );
}
