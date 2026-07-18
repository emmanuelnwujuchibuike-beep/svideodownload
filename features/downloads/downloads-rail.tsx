"use client";

import { Cloud, Download, FileVideo, Film, Folder, GraduationCap, Image as ImageIcon, Music, Settings2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { useHistory } from "@/features/history/use-history";
import {
  getAutoDownload,
  getPreferredQuality,
  QUALITY_OPTIONS,
  setAutoDownload,
  setPreferredQuality,
  type PreferredQuality,
} from "@/lib/download-hub/auto-download";
import { getLessonMeta } from "@/lib/learning/catalog";
import type { DownloadRecord, PlatformId } from "@/types";
import { cn, formatBytes } from "@/lib/utils";

const REEL_PLATFORMS: PlatformId[] = ["tiktok", "instagram", "snapchat"];

/**
 * Guides surfaced in the rail. Deliberately the three that match what someone
 * standing in their own library is most likely to be about to do — organise it,
 * publish from it, or work out what they are allowed to do with it.
 */
const RAIL_LESSONS = [
  "how-to-build-a-creator-workflow",
  "what-you-can-and-cannot-download",
  "how-to-improve-video-quality",
] as const;

function itemBytes(rec: DownloadRecord): number {
  if (rec.size && rec.size > 0) return rec.size;
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
      const sz = itemBytes(r);
      byBucket[b] += sz;
      counts[b] += 1;
      used += sz;
    }
    return { used, byBucket, counts };
  }, [items]);

  /*
   * Donut segments show COMPOSITION — what proportion of your library is video
   * vs audio vs images — and fill the ring completely.
   *
   * It previously showed the fraction of a hardcoded `TOTAL_GB = 128` allowance,
   * captioned "Used of 128 GB". There is no such allowance: Frenz Cloud does not
   * exist, this is local device storage, and the real capacity is unknowable from
   * here. It was an invented quota presented as a measured one. Composition is
   * both honest and more useful, since it answers a question the data can
   * actually answer.
   */
  const R = 52;
  const C = 2 * Math.PI * R;
  let offset = 0;
  const segments = SEG.flatMap((s) => {
    const frac = used > 0 ? byBucket[s.key] / used : 0;
    const len = frac * C;
    // Skip empty buckets. `strokeLinecap="round"` paints a visible dot for a
    // zero-length dash, so an empty library rendered a stray blob on the ring.
    if (len <= 0) return [];
    const seg = { color: s.color, dash: `${len} ${C - len}`, gap: -offset };
    offset += len;
    return [seg];
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
            <span className="text-[10px] text-muted-foreground">
              {items.length === 1 ? "1 file" : `${items.length} files`}
            </span>
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
        {/* "Manage Storage" used to sit here with no onClick at all — a button
            that did nothing. This page IS storage management, so the honest
            replacement is a link to the guide on keeping a library findable. */}
        <Link
          href="/learn/how-to-organise-your-media"
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-secondary py-2 text-sm font-semibold transition hover:bg-secondary/70"
        >
          <GraduationCap className="h-4 w-4" /> Organising your media
        </Link>
      </section>

      {/* Quick actions */}
      <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-soft">
        <h3 className="mb-3 text-sm font-bold">Quick Actions</h3>
        <div className="space-y-1">
          <QuickAction icon={Download} title="Download from Link" sub="Paste video link" href="#download" />
          <QuickAction icon={Cloud} title="Import from Cloud" sub="Google Drive, Dropbox" soon />
          <AutoDownloadToggle />
          <QualityPreference />
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
        {/* "View All Categories" linked to /downloads — the page you are already
            on, and this card already lists every category. Removed rather than
            re-pointed: there was no third destination it could honestly mean. */}
      </section>

      {/* Learning Academy — RFC §4: every download surface connects to the
          guides. Placed after Categories so it reads as a next step rather than
          competing with the library itself. */}
      <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-soft">
        <h3 className="mb-3 text-sm font-bold">Learn</h3>
        <ul className="space-y-1">
          {RAIL_LESSONS.map((slug) => {
            const lesson = getLessonMeta(slug);
            if (!lesson) return null;
            return (
              <li key={slug}>
                <Link
                  href={`/learn/${lesson.slug}`}
                  className="flex items-center gap-3 rounded-xl p-2 transition hover:bg-secondary"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
                    <GraduationCap className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{lesson.title}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {lesson.minutes} min read
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
        <Link
          href="/learn"
          className="mt-3 block text-center text-xs font-semibold text-primary hover:underline"
        >
          All guides
        </Link>
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

/**
 * Skip-the-preview preference.
 *
 * This was previously a bare `useState(false)` — it saved nothing, did nothing,
 * and reset on every navigation, while presenting itself as a stored setting.
 * A control that lies about persisting is worse than a dead button, because the
 * user believes they configured something.
 *
 * It is now real on both counts: persisted via `lib/download-hub/auto-download`
 * and actually honoured by `DownloadBox`, which starts the best rendition
 * immediately instead of rendering the format picker.
 */
function AutoDownloadToggle() {
  const [on, setOn] = useState(false);

  // Read after mount, never during render — localStorage during render is a
  // hydration mismatch.
  useEffect(() => setOn(getAutoDownload()), []);

  const toggle = () => {
    const next = !on;
    setOn(next);
    setAutoDownload(next);
  };

  return (
    <button type="button" onClick={toggle} aria-pressed={on} className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition hover:bg-secondary">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary text-primary"><Download className="h-4 w-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">Auto Download</span>
        <span className="block text-[11px] text-muted-foreground">Skip the quality picker</span>
      </span>
      <span className={cn("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition", on ? "bg-primary" : "bg-secondary ring-1 ring-inset ring-border")}>
        <span className={cn("inline-block h-5 w-5 rounded-full bg-white shadow transition-transform", on ? "translate-x-5" : "translate-x-0.5")} />
      </span>
    </button>
  );
}

/**
 * Default quality for Auto Download.
 *
 * Replaces a "Download Quality — choose default quality" row that linked to
 * `/account`, which has no quality setting: the control advertised a
 * destination that could not deliver on it. This is the setting itself.
 */
function QualityPreference() {
  const [quality, setQuality] = useState<PreferredQuality>("best");

  useEffect(() => setQuality(getPreferredQuality()), []);

  /*
     The select sits BELOW the label rather than beside it. Side by side, it ate
     enough of a 320px rail that "Download Quality" wrapped to two lines and its
     subtitle to three, leaving the row twice the height of its neighbours.
  */
  return (
    <div className="rounded-xl p-2">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
          <Settings2 className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <label htmlFor="rail-quality" className="block truncate text-sm font-semibold">
            Download Quality
          </label>
          <span className="block truncate text-[11px] text-muted-foreground">
            Used by Auto Download
          </span>
        </span>
      </div>
      <select
        id="rail-quality"
        value={quality}
        onChange={(e) => {
          const next = e.target.value as PreferredQuality;
          setQuality(next);
          setPreferredQuality(next);
        }}
        className="mt-2 h-9 w-full rounded-lg bg-secondary/60 px-2.5 text-xs font-medium text-foreground outline-none ring-1 ring-inset ring-transparent focus:ring-primary"
      >
        {QUALITY_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
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
