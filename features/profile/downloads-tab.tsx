"use client";

import { CalendarClock, HardDrive, Layers, Lock, Search, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
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

type Range = "all" | "today" | "week";

/**
 * Download Center (Profile · Part 6) — the owner's personal library of every
 * video they've grabbed with the downloader on this account AND device (the
 * local history store), including downloads made before they had an account.
 * Purely client-side so it opens instantly and never blocks on the network.
 *
 * This part turns the plain grid into a premium library: a real storage summary
 * (item count, library size, platforms — all summed from the actual history),
 * instant search, and platform + time filters. The AI Collections, Private Vault
 * and cross-device Cloud Sync from the brief need a server library + encryption
 * that don't exist yet, so they're honestly announced, never faked.
 */
export function DownloadsTab({ emptyText }: { emptyText: string }) {
  const { items } = useHistory();
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState<string>("all");
  const [range, setRange] = useState<Range>("all");

  const platforms = useMemo(() => {
    const set = new Set<string>();
    for (const r of items) if (r.platformName) set.add(r.platformName);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [items]);

  const summary = useMemo(() => {
    let bytes = 0;
    for (const r of items) bytes += r.size ?? 0;
    return { count: items.length, size: bytes, platforms: platforms.length };
  }, [items, platforms.length]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const now = Date.now();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    return items.filter((r) => {
      if (platform !== "all" && r.platformName !== platform) return false;
      if (range !== "all") {
        const t = new Date(r.createdAt).getTime();
        if (range === "today" && t < startOfToday.getTime()) return false;
        if (range === "week" && t < weekAgo) return false;
      }
      if (q) {
        const hay = `${r.title ?? ""} ${r.platformName ?? ""} ${r.url ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, query, platform, range]);

  // A brand-new library — nothing downloaded yet.
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

  const RANGES: { id: Range; label: string }[] = [
    { id: "all", label: "All" },
    { id: "today", label: "Today" },
    { id: "week", label: "This week" },
  ];

  return (
    <div>
      {/* Storage summary — real totals from the library */}
      <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
        {[
          { Icon: HardDrive, value: fmtSize(summary.size) ?? "0 KB", label: "Library" },
          { Icon: IoDownloadOutline, value: String(summary.count), label: summary.count === 1 ? "Download" : "Downloads" },
          { Icon: Layers, value: String(summary.platforms), label: summary.platforms === 1 ? "Platform" : "Platforms" },
        ].map(({ Icon, value, label }) => (
          <div key={label} className="glass-strong rounded-2xl px-3 py-3.5 text-center">
            <Icon className="mx-auto h-4 w-4 text-muted-foreground" />
            <span className="mt-1.5 block text-lg font-extrabold tracking-tight sm:text-xl">{value}</span>
            <span className="block text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>

      {/* Search + time range */}
      <div className="mt-4 flex flex-col gap-2.5 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your downloads…"
            aria-label="Search your downloads"
            className="w-full rounded-2xl border border-border/60 bg-card/60 py-2.5 pl-9 pr-3 text-sm outline-none backdrop-blur transition placeholder:text-muted-foreground focus:border-primary/50 focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div className="flex shrink-0 items-center gap-0.5 self-start rounded-2xl border border-border/60 bg-card/60 p-0.5 backdrop-blur sm:self-auto">
          {RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setRange(r.id)}
              aria-pressed={range === r.id}
              className={cn(
                "flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition",
                range === r.id ? "bg-brand-tile text-white shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {r.id === "all" ? null : <CalendarClock className="h-3.5 w-3.5" />}
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Platform filter chips */}
      {platforms.length > 1 ? (
        <div className="mt-3 flex items-center gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {["all", ...platforms].map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPlatform(p)}
              aria-pressed={platform === p}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                platform === p
                  ? "border-transparent bg-foreground text-background"
                  : "border-border/60 bg-card/60 text-muted-foreground hover:text-foreground",
              )}
            >
              {p === "all" ? "All platforms" : p}
            </button>
          ))}
        </div>
      ) : null}

      {/* Library grid */}
      {filtered.length === 0 ? (
        <div className="mt-4 rounded-3xl border border-dashed border-border/70 bg-card/50 p-10 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
            <Search className="h-6 w-6" />
          </span>
          <p className="mt-3 text-sm text-muted-foreground">No downloads match your search.</p>
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {filtered.map((r) => (
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
      )}

      {/* Honest roadmap — the cloud/AI/vault layer needs a server library + encryption */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-2xl border border-dashed border-border/60 p-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5" /> AI Collections</span>
        <span className="inline-flex items-center gap-1.5"><Lock className="h-3.5 w-3.5" /> Private Vault</span>
        <span className="inline-flex items-center gap-1.5"><HardDrive className="h-3.5 w-3.5" /> Cloud Sync</span>
        <span className="font-semibold text-foreground/80">— coming soon</span>
      </div>
    </div>
  );
}
