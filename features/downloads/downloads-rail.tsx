"use client";

import { Cloud, Download, FileVideo, Film, Folder, Image as ImageIcon, Music, Settings2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { useHistory } from "@/features/history/use-history";
import type { DownloadRecord, PlatformId } from "@/types";
import { cn, formatBytes } from "@/lib/utils";

const TOTAL_GB = 128;
const REEL_PLATFORMS: PlatformId[] = ["tiktok", "instagram", "snapchat"];

function estBytes(rec: DownloadRecord): number {
  if (rec.kind === "audio") return 5 * 1024 * 1024;
  if (rec.kind === "image") return 2 * 1024 * 1024;
  if (REEL_PLATFORMS.includes(rec.platform)) return 12 * 1024 * 1024;
  return 38 * 1024 * 1024;
}
type Bucket = "Videos" | "Reels" | "Audios" | "Images" | "Others";
function bucketOf(rec: DownloadRecord): Bucket {
  if (rec.kind === "audio") return "Audios";
  if (rec.kind === "image") return "Images";
  if (REEL_PLATFORMS.includes(rec.platform)) return "Reels";
  return "Videos";
}

const SEG: { key: Bucket; color: string; dot: string }[] = [
  { key: "Videos", color: "#8b5cf6", dot: "bg-violet-500" },
  { key: "Reels", color: "#3b82f6", dot: "bg-blue-500" },
  { key: "Audios", color: "#10b981", dot: "bg-emerald-500" },
  { key: "Images", color: "#f59e0b", dot: "bg-amber-500" },
  { key: "Others", color: "#6b7280", dot: "bg-gray-500" },
];

export function DownloadsRail() {
  const { items, clearHistory } = useHistory();

  const { used, byBucket, counts } = useMemo(() => {
    const byBucket: Record<Bucket, number> = { Videos: 0, Reels: 0, Audios: 0, Images: 0, Others: 0 };
    const counts: Record<Bucket, number> = { Videos: 0, Reels: 0, Audios: 0, Images: 0, Others: 0 };
    let used = 0;
    for (const r of items) {
      const b = bucketOf(r);
      const sz = estBytes(r);
      byBucket[b] += sz;
      counts[b] += 1;
      used += sz;
    }
    return { used, byBucket, counts };
  }, [items]);

  const usedGB = used / (1024 * 1024 * 1024);
  const pctUsed = Math.min(1, usedGB / TOTAL_GB);

  // Donut segments
  const R = 52;
  const C = 2 * Math.PI * R;
  let offset = 0;
  const segments = SEG.map((s) => {
    const frac = used > 0 ? byBucket[s.key] / used : 0;
    const len = frac * C * pctUsed;
    const seg = { color: s.color, dash: `${len} ${C - len}`, gap: -offset };
    offset += len;
    return seg;
  });

  return (
    <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-80 shrink-0 flex-col gap-4 overflow-y-auto py-4 pr-4 xl:flex">
      {/* Storage */}
      <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-soft">
        <h3 className="text-sm font-bold">Storage</h3>
        <div className="relative mx-auto mt-4 h-36 w-36">
          <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
            <circle cx="60" cy="60" r={R} fill="none" stroke="hsl(var(--secondary))" strokeWidth="11" />
            {segments.map((s, i) => (
              <circle key={i} cx="60" cy="60" r={R} fill="none" stroke={s.color} strokeWidth="11" strokeLinecap="round" strokeDasharray={s.dash} strokeDashoffset={s.gap} />
            ))}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-lg font-extrabold">{formatBytes(used)}</span>
            <span className="text-[10px] text-muted-foreground">Used of {TOTAL_GB} GB</span>
          </div>
        </div>
        <ul className="mt-4 space-y-2">
          {SEG.map((s) => (
            <li key={s.key} className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-2"><span className={cn("h-2.5 w-2.5 rounded-full", s.dot)} /> {s.key}</span>
              <span className="font-medium text-muted-foreground">{formatBytes(byBucket[s.key])}</span>
            </li>
          ))}
        </ul>
        <button type="button" className="mt-4 w-full rounded-xl bg-secondary py-2 text-sm font-semibold transition hover:bg-secondary/70">Manage Storage</button>
      </section>

      {/* Quick actions */}
      <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-soft">
        <h3 className="mb-3 text-sm font-bold">Quick Actions</h3>
        <div className="space-y-1">
          <QuickAction icon={Download} title="Download from Link" sub="Paste video link" href="#download" />
          <QuickAction icon={Cloud} title="Import from Cloud" sub="Google Drive, Dropbox" soon />
          <AutoDownloadToggle />
          <QuickAction icon={Settings2} title="Download Quality" sub="Choose default quality" href="/account" />
        </div>
      </section>

      {/* Categories */}
      <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-soft">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold">Categories</h3>
        </div>
        <ul className="space-y-1">
          <Cat icon={FileVideo} label="Videos" count={counts.Videos} />
          <Cat icon={Film} label="Reels" count={counts.Reels} />
          <Cat icon={Music} label="Audios" count={counts.Audios} />
          <Cat icon={ImageIcon} label="Images" count={counts.Images} />
          <Cat icon={Folder} label="Files" count={counts.Others} />
        </ul>
        <Link href="/downloads" className="mt-3 block text-center text-xs font-semibold text-primary hover:underline">View All Categories</Link>
      </section>

      {/* Recent history */}
      <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-soft">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold">Recent History</h3>
          {items.length > 0 ? (
            <button type="button" onClick={() => { if (confirm("Clear download history?")) clearHistory(); }} className="inline-flex items-center gap-1 text-xs font-medium text-rose-500 hover:underline">
              <Trash2 className="h-3 w-3" /> Clear All
            </button>
          ) : null}
        </div>
        {items.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">No history yet.</p>
        ) : (
          <ul className="space-y-3">
            {items.slice(0, 4).map((r) => (
              <li key={r.id}>
                <a href={r.url} target="_blank" rel="noopener noreferrer nofollow" className="flex items-center gap-2.5">
                  <span className="h-9 w-12 shrink-0 overflow-hidden rounded-md bg-neutral-800">
                    {r.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.thumbnail} alt="" className="h-full w-full object-cover" />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold">{r.title}</span>
                    <span className="block text-[10px] text-muted-foreground">{timeAgo(r.createdAt)}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}

function timeAgo(ts: number): string {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)} mins ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hours ago`;
  return `${Math.floor(s / 86400)} days ago`;
}

function QuickAction({ icon: Icon, title, sub, href, soon }: { icon: typeof Download; title: string; sub: string; href?: string; soon?: boolean }) {
  const inner = (
    <span className="flex items-center gap-3 rounded-xl p-2 transition hover:bg-secondary">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-primary"><Icon className="h-4 w-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm font-semibold">{title}{soon ? <span className="rounded bg-secondary px-1 py-0.5 text-[8px] font-bold uppercase text-muted-foreground">Soon</span> : null}</span>
        <span className="block text-[11px] text-muted-foreground">{sub}</span>
      </span>
    </span>
  );
  return href ? <Link href={href}>{inner}</Link> : <div>{inner}</div>;
}

function AutoDownloadToggle() {
  const [on, setOn] = useState(false);
  return (
    <button type="button" onClick={() => setOn((v) => !v)} aria-pressed={on} className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition hover:bg-secondary">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-primary"><Download className="h-4 w-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">Auto Download</span>
        <span className="block text-[11px] text-muted-foreground">Manage preferences</span>
      </span>
      <span className={cn("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition", on ? "bg-primary" : "bg-secondary ring-1 ring-inset ring-border")}>
        <span className={cn("inline-block h-5 w-5 rounded-full bg-white shadow transition-transform", on ? "translate-x-5" : "translate-x-0.5")} />
      </span>
    </button>
  );
}

function Cat({ icon: Icon, label, count }: { icon: typeof Download; label: string; count: number }) {
  return (
    <li className="flex items-center justify-between rounded-lg px-1 py-1.5">
      <span className="flex items-center gap-2.5 text-sm"><Icon className="h-4 w-4 text-muted-foreground" /> {label}</span>
      <span className="text-sm font-semibold tabular-nums text-muted-foreground">{count}</span>
    </li>
  );
}
