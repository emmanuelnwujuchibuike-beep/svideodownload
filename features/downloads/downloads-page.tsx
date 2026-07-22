"use client";

import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Globe,
  Download,
  HardDrive,
  Heart,
  Loader2,
  MoreVertical,
  Pause,
  Play,
  RotateCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { DownloadBox } from "@/features/downloads/download-box";
import { DownloadsRail } from "@/features/downloads/downloads-rail";
import { HubWarmup } from "@/features/downloads/hub-warmup";
import { openPlayer } from "@/features/downloads/player-store";
import { useDownloadManager } from "@/features/downloads/use-download-manager";
import { useHistory } from "@/features/history/use-history";
import { estimateBytes } from "@/features/history/usage";
import { AdSurface } from "@/features/monetization/ad-surface";
import { UsageDashboard } from "@/features/downloads/usage-dashboard";
import { BRAND_ICONS } from "@/lib/platform-icons";
import type { DownloadRecord, PlatformId } from "@/types";
import { cn, formatBytes } from "@/lib/utils";

const TABS = ["All", "Videos", "Reels", "Audios", "Images", "Files"] as const;
type Tab = (typeof TABS)[number];

const REEL_PLATFORMS: PlatformId[] = ["tiktok", "instagram", "snapchat"];

function matchesTab(rec: DownloadRecord, tab: Tab): boolean {
  switch (tab) {
    case "All":
      return true;
    case "Videos":
      return rec.kind === "video" && !REEL_PLATFORMS.includes(rec.platform);
    case "Reels":
      return rec.kind === "video" && REEL_PLATFORMS.includes(rec.platform);
    case "Audios":
      return rec.kind === "audio";
    case "Images":
      return rec.kind === "image";
    case "Files":
      return false;
  }
}

export function DownloadsPage() {
  const { items, toggleFavorite, removeDownload } = useHistory();
  const { tasks, pauseDownload, resumeDownload, retryDownload, cancelDownload, pauseAll } = useDownloadManager();

  const [tab, setTab] = useState<Tab>("All");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest" | "az">("newest");
  const [limit, setLimit] = useState(8);

  const active = tasks.filter((t) => t.status !== "completed" && t.status !== "canceled");
  const totalUsed = useMemo(() => items.reduce((s, r) => s + estimateBytes(r), 0), [items]);

  const filtered = useMemo(() => {
    let list = items.filter((r) => matchesTab(r, tab));
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((r) => r.title.toLowerCase().includes(q) || r.platformName.toLowerCase().includes(q));
    }
    if (sort === "oldest") list = [...list].sort((a, b) => a.createdAt - b.createdAt);
    else if (sort === "az") list = [...list].sort((a, b) => a.title.localeCompare(b.title));
    else list = [...list].sort((a, b) => b.createdAt - a.createdAt);
    return list;
  }, [items, tab, search, sort]);

  const failed = tasks.filter((t) => t.status === "failed").length;

  // History records completed downloads, so completed = items.length. The rate is
  // over ATTEMPTS, which is the only denominator that makes the figure mean
  // anything — and null when there have been none, rather than a fabricated 100%.
  const attempts = items.length + failed;
  const completedRate = attempts > 0 ? `${Math.round((items.length / attempts) * 100)}%` : "—";

  return (
    <div className="space-y-5 pt-1">
      {/* Warms the Gateway chunk and prefetches its destinations on idle, so
          nothing lags the first time it is needed. Renders nothing. */}
      <HubWarmup />
      {/* Hero. `id="download"` is the target the rail's "Download from Link"
          quick action points at — the anchor previously existed only on the
          landing hero, so that control did nothing on this page. */}
      <section
        id="download"
        className="relative scroll-mt-20 overflow-hidden rounded-2xl bg-gradient-to-br from-blue-700 via-violet-700 to-purple-800 p-5 text-white shadow-elevated sm:p-7"
      >
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-fuchsia-400/30 blur-3xl motion-safe:animate-drift" />
        <div className="relative">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-extrabold tracking-[-0.02em] sm:text-3xl">Downloads</h1>
              <p className="mt-1 text-sm text-white/80">All your downloaded content in one place.</p>
            </div>
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/15 text-white shadow-lg ring-1 ring-white/25 motion-safe:animate-float">
              <Download className="h-7 w-7" />
            </span>
          </div>
          <div className="mt-5">
            <DownloadBox />
          </div>
        </div>
      </section>

      {/* Plan-aware storage: the usage meter (5 GB free · 59 GB Pro · unlimited
          Business), analytics, and the upgrade-or-clear gate — the same feature
          the public library carries, in the dashboard. */}
      <UsageDashboard />

      {/*
        The Hub proper: library on the left, panels on the right.

        One grid, two shapes. Below `xl` it is a single stacked column and the
        panels follow the library; at `xl` the second track appears and they
        become a sticky sidebar. The hero sits OUTSIDE this grid and spans the
        full width, because the paste bar is the primary action on every device
        and should never be squeezed into a column.
      */}
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start">
        <div className="min-w-0 space-y-5">
          {/* Filter tabs */}
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {TABS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => { setTab(t); setLimit(8); }}
                aria-pressed={tab === t}
                className={cn(
                  "shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition",
                  tab === t ? "bg-gradient-to-r from-blue-600 to-violet-600 text-white" : "bg-secondary text-muted-foreground hover:text-foreground",
                )}
              >
                {t}
              </button>
            ))}
          </div>

          {/*
            Stat cards. The last one spans both columns on mobile — with five
            cards in a two-up grid it was otherwise stranded alone on its row,
            reading as a rendering fault rather than a layout.
          */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Stat icon={Download} tint="text-violet-500" label="Total Downloads" value={items.length.toLocaleString()} sub="All time" />
            {/*
              `sub` was the literal string "100%", which read "Completed 0 · 100%"
              on an empty library. It is now the real completion rate over
              attempts (completed + failed), and an em dash when there have been
              no attempts to take a rate of.
            */}
            <Stat icon={CheckCircle2} tint="text-emerald-500" label="Completed" value={items.length.toLocaleString()} sub={completedRate} />
            <Stat icon={Loader2} tint="text-blue-500" label="In Progress" value={String(active.length)} sub={active.length ? "Active" : "—"} />
            <Stat icon={AlertCircle} tint="text-amber-500" label="Failed" value={String(failed)} sub={failed ? "Retry available" : attempts > 0 ? "0%" : "—"} />
            <Stat className="col-span-2 sm:col-span-1" icon={HardDrive} tint="text-cyan-500" label="Saved Storage" value={formatBytes(totalUsed)} sub="Space used" />
          </div>

          {/* Downloading */}
          {active.length > 0 ? (
            <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-soft sm:p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-base font-bold">Downloading ({active.length})</h2>
                <button type="button" onClick={pauseAll} className="text-xs font-semibold text-primary hover:underline">Pause all</button>
              </div>
              <div className="space-y-3">
                {active.map((t) => {
                  const pct = t.totalBytes > 0 ? Math.min(100, Math.round((t.receivedBytes / t.totalBytes) * 100)) : t.status === "downloading" ? 0 : 0;
                  const Brand = BRAND_ICONS[t.platform];
                  return (
                    <div key={t.id} className="flex items-center gap-3 rounded-xl border border-border/50 bg-background p-2.5">
                      <span className="relative h-14 w-20 shrink-0 overflow-hidden rounded-lg bg-neutral-800">
                        {t.thumbnail ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={t.thumbnail} alt="" className="h-full w-full object-cover" />
                        ) : null}
                        {Brand ? <span className="absolute bottom-1 left-1 text-white/90"><Brand className="h-3 w-3" /></span> : null}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{t.title}</p>
                        <p className="truncate text-xs text-muted-foreground">{t.qualityLabel} · {t.platformName}</p>
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                          <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-violet-500 transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          {t.status === "failed" ? <span className="text-rose-500">Failed — {t.error}</span> : t.status === "paused" ? "Paused" : (
                            <>
                              {formatBytes(t.receivedBytes)}{t.totalBytes ? ` / ${formatBytes(t.totalBytes)}` : ""}
                              {t.speed ? ` · ${formatBytes(t.speed)}/s` : ""}{t.totalBytes ? ` · ${pct}%` : ""}
                            </>
                          )}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {t.status === "failed" ? (
                          <IconBtn label="Retry" onClick={() => retryDownload(t.id)}><RotateCw className="h-4 w-4" /></IconBtn>
                        ) : t.status === "paused" ? (
                          <IconBtn label="Resume" onClick={() => resumeDownload(t.id)}><Play className="h-4 w-4" /></IconBtn>
                        ) : (
                          <IconBtn label="Pause" onClick={() => pauseDownload(t.id)}><Pause className="h-4 w-4" /></IconBtn>
                        )}
                        <IconBtn label="Cancel" onClick={() => cancelDownload(t.id)}><X className="h-4 w-4" /></IconBtn>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          {/* Downloaded */}
          <section className="rounded-2xl border border-border/60 bg-card p-4 shadow-soft sm:p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-bold">Downloaded ({filtered.length})</h2>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search"
                    aria-label="Search downloads"
                    className="h-9 w-32 rounded-lg bg-secondary/60 pl-8 pr-2 text-sm text-foreground outline-none ring-1 ring-inset ring-transparent transition focus:w-44 focus:bg-background focus:ring-primary sm:w-40"
                  />
                </div>
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as typeof sort)}
                  aria-label="Sort"
                  className="h-9 rounded-lg bg-secondary/60 px-2.5 text-sm font-medium text-foreground outline-none ring-1 ring-inset ring-transparent focus:ring-primary"
                >
                  <option value="newest">Newest</option>
                  <option value="oldest">Oldest</option>
                  <option value="az">A–Z</option>
                </select>
              </div>
            </div>

            {filtered.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/70 p-10 text-center">
                <p className="text-sm font-semibold">No downloads yet</p>
                <p className="mt-1 text-sm text-muted-foreground">Paste a link above to download your first video.</p>
              </div>
            ) : (
              <>
                <ul className="divide-y divide-border/50">
                  {filtered.slice(0, limit).map((r) => (
                    <DownloadedRow key={r.id} rec={r} onFavorite={() => toggleFavorite(r.id)} onRemove={() => removeDownload(r.id)} />
                  ))}
                </ul>
                {filtered.length > limit ? (
                  <button type="button" onClick={() => setLimit((n) => n + 8)} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-semibold text-primary transition hover:bg-secondary">
                    Show More <ChevronDown className="h-4 w-4" />
                  </button>
                ) : null}
              </>
            )}
          </section>

          {/* Admin-managed ad slot below the history list — insert or remove any
              ad for this zone from the dashboard; collapses when empty. */}
          <AdSurface zone="download_history_bottom" maxWidth="max-w-3xl" />

          {/* Premium banner */}
          <Link href="/pricing" className="relative flex items-center justify-between gap-4 overflow-hidden rounded-2xl bg-gradient-to-r from-blue-600 via-violet-600 to-fuchsia-600 p-4 text-white shadow-elevated sm:p-5">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15"><Download className="h-5 w-5" /></span>
              <div>
                <p className="text-sm font-bold sm:text-base">Faster Downloads with Frenz Premium</p>
                <p className="text-xs text-white/80">Download in 4K, no limits, ultra-fast speed and more.</p>
              </div>
            </div>
            <span className="shrink-0 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-slate-900">Upgrade Now</span>
          </Link>
        </div>

        {/* Storage, Quick Actions, Categories and Learn. A sticky sidebar at
            `xl`, a stacked column everywhere else — see DownloadsRail. */}
        <DownloadsRail />
      </div>
    </div>
  );
}

function Stat({ icon: Icon, tint, label, value, sub, className }: { icon: typeof Download; tint: string; label: string; value: string; sub: string; className?: string }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border/60 bg-card p-4 shadow-soft",
        // Compositor-only lift. `transition-transform` rather than `transition`
        // so a hover never animates layout properties.
        "motion-safe:transition-transform motion-safe:duration-200 motion-safe:hover:-translate-y-0.5",
        className,
      )}
    >
      <span className={cn("flex h-9 w-9 items-center justify-center rounded-xl bg-secondary", tint)}>
        <Icon className="h-4 w-4" />
      </span>
      <p className="mt-3 text-xl font-extrabold tabular-nums">{value}</p>
      <p className="truncate text-xs font-medium text-foreground">{label}</p>
      <p className="truncate text-[11px] text-muted-foreground">{sub}</p>
    </div>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-foreground transition hover:bg-secondary/70">
      {children}
    </button>
  );
}

const QUALITY_TINT: Record<string, string> = {
  "4K": "bg-fuchsia-500/15 text-fuchsia-500",
  MP3: "bg-rose-500/15 text-rose-500",
};

function DownloadedRow({ rec, onFavorite, onRemove }: { rec: DownloadRecord; onFavorite: () => void; onRemove: () => void }) {
  const [menu, setMenu] = useState(false);
  const Brand = BRAND_ICONS[rec.platform];
  const quality = rec.kind === "audio" ? "MP3" : rec.qualityLabel.replace(/p$/i, "").includes("4") && /4k|2160/i.test(rec.qualityLabel) ? "4K" : rec.qualityLabel;
  const tint = QUALITY_TINT[quality] ?? "bg-secondary text-muted-foreground";

  return (
    <li className="flex items-center gap-3 py-2.5">
      <button type="button" onClick={() => openPlayer(rec)} aria-label="Watch" className="relative h-12 w-16 shrink-0 overflow-hidden rounded-lg bg-neutral-800">
        {rec.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={rec.thumbnail} alt="" className="h-full w-full object-cover" />
        ) : null}
        <span className="absolute inset-0 flex items-center justify-center bg-black/25 text-white"><Play className="h-4 w-4 fill-white" /></span>
        {Brand ? <span className="absolute bottom-0.5 left-0.5 text-white/90"><Brand className="h-2.5 w-2.5" /></span> : null}
      </button>
      <button type="button" onClick={() => openPlayer(rec)} className="min-w-0 flex-1 text-left">
        <p className="truncate text-sm font-semibold">{rec.title}</p>
        <p className="truncate text-xs text-muted-foreground">{rec.platformName}{rec.favorite ? " · ★ Favorite" : ""}</p>
      </button>
      <span className="hidden text-xs text-muted-foreground sm:block">{formatBytes(estimateBytes(rec))}</span>
      <span className={cn("rounded-md px-2 py-0.5 text-[10px] font-bold uppercase", tint)}>{quality}</span>
      <button type="button" onClick={() => openPlayer(rec)} aria-label="Watch in browser" className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-r from-blue-600 to-violet-600 text-white">
        <Play className="h-4 w-4 fill-white" />
      </button>
      <div className="relative">
        <button type="button" onClick={() => setMenu((v) => !v)} aria-label="More" className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-secondary">
          <MoreVertical className="h-4 w-4" />
        </button>
        {menu ? (
          <>
            <button type="button" aria-label="Close" onClick={() => setMenu(false)} className="fixed inset-0 z-40 cursor-default" />
            <div className="absolute right-0 z-50 mt-1 w-40 overflow-hidden rounded-xl border border-border/70 bg-card py-1 shadow-elevated">
              <button type="button" onClick={() => { openPlayer(rec); setMenu(false); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-secondary">
                <Play className="h-4 w-4" /> Watch in browser
              </button>
              <button type="button" onClick={() => { onFavorite(); setMenu(false); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-secondary">
                <Heart className={cn("h-4 w-4", rec.favorite && "fill-rose-500 text-rose-500")} /> {rec.favorite ? "Unfavorite" : "Favorite"}
              </button>
              <button type="button" onClick={() => { openPlayer(rec); setMenu(false); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-secondary">
                <Globe className="h-4 w-4" /> Publish to everyone
              </button>
              <button type="button" onClick={() => { onRemove(); setMenu(false); }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-rose-500 hover:bg-secondary">
                <Trash2 className="h-4 w-4" /> Remove
              </button>
            </div>
          </>
        ) : null}
      </div>
    </li>
  );
}
