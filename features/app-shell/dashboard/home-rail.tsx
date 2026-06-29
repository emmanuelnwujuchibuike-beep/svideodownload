"use client";

import { Bookmark, Clapperboard, Download, Hash, Link2, Music, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { SuggestList } from "@/features/app-shell/suggest-list";
import { BRAND_ICONS, FLAGSHIP_IDS } from "@/lib/platform-icons";
import { PLATFORMS } from "@/lib/platforms";
import type { SuggestedCreator } from "@/lib/social/suggest";
import { formatCompactNumber } from "@/lib/utils";

const SHORTCUTS = [
  { label: "Reels", href: "/explore", icon: Clapperboard, tint: "bg-rose-500/15 text-rose-500" },
  { label: "Trending", href: "/explore?sort=trending", icon: TrendingUp, tint: "bg-amber-500/15 text-amber-500" },
  { label: "Saved", href: "/saved", icon: Bookmark, tint: "bg-blue-500/15 text-blue-500" },
  { label: "My Downloads", href: "/downloads", icon: Download, tint: "bg-emerald-500/15 text-emerald-500" },
];

const HASHTAGS = [
  { tag: "TravelDiaries", views: 23_100_000, icon: Hash, color: "from-sky-500 to-blue-600" },
  { tag: "FunnyVideos", views: 18_700_000, icon: Hash, color: "from-rose-500 to-pink-600" },
  { tag: "MusicVibes", views: 12_400_000, icon: Music, color: "from-violet-500 to-purple-600" },
  { tag: "FootballGoals", views: 15_200_000, icon: Hash, color: "from-emerald-500 to-teal-600" },
  { tag: "GamingLife", views: 8_700_000, icon: Hash, color: "from-fuchsia-500 to-purple-600" },
];

export function HomeRail({ suggestions }: { suggestions: SuggestedCreator[] }) {
  const router = useRouter();
  const [url, setUrl] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    router.push(url.trim() ? `/downloads?u=${encodeURIComponent(url.trim())}` : "/downloads");
  };

  return (
    <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] w-80 shrink-0 flex-col gap-4 overflow-y-auto py-4 pr-4 xl:flex">
      {/* Download Now */}
      <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-soft">
        <h3 className="flex items-center gap-2 text-base font-bold text-foreground">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-violet-600 text-white"><Download className="h-4 w-4" /></span>
          Download Now
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">Paste a link from any platform to download videos.</p>
        <form onSubmit={submit} className="mt-3 space-y-2">
          <div className="relative">
            <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste link here…" aria-label="Paste link" className="h-11 w-full rounded-xl bg-secondary/60 pl-9 pr-3 text-sm text-foreground outline-none ring-1 ring-inset ring-transparent transition focus:bg-background focus:ring-primary" />
          </div>
          <button type="submit" className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 py-2.5 text-sm font-semibold text-white transition hover:opacity-95">
            <Download className="h-4 w-4" /> Download
          </button>
        </form>
        <p className="mt-3 text-xs font-semibold text-muted-foreground">Supports:</p>
        <div className="mt-2 flex items-center gap-2">
          {FLAGSHIP_IDS.slice(0, 4).map((id) => {
            const Icon = BRAND_ICONS[id];
            return (
              <span key={id} title={PLATFORMS[id].name} className={`flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br ${PLATFORMS[id].accent} text-white`}>
                {Icon ? <Icon className="h-4 w-4" /> : null}
              </span>
            );
          })}
          <Link href="/downloads" className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-muted-foreground">…</Link>
        </div>
      </section>

      {/* Quick shortcuts */}
      <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-soft">
        <h3 className="mb-3 text-sm font-bold text-foreground">Quick Shortcuts</h3>
        <div className="space-y-1">
          {SHORTCUTS.map((s) => (
            <Link key={s.label} href={s.href} className="flex items-center gap-3 rounded-xl p-2 transition hover:bg-secondary">
              <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${s.tint}`}><s.icon className="h-4 w-4" /></span>
              <span className="flex-1 text-sm font-semibold text-foreground">{s.label}</span>
              <span className="text-muted-foreground">›</span>
            </Link>
          ))}
        </div>
      </section>

      {/* Suggested friends */}
      {suggestions.length > 0 ? (
        <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-soft">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-bold text-foreground">Suggested Friends</h3>
            <Link href="/explore" className="text-xs font-medium text-primary hover:underline">See all</Link>
          </div>
          <SuggestList items={suggestions.map((s) => ({ id: s.id, handle: s.handle, displayName: s.displayName, avatarUrl: s.avatarUrl, isVerified: s.isVerified, followersCount: s.followersCount }))} />
        </section>
      ) : null}

      {/* Popular hashtags */}
      <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-soft">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-bold text-foreground">Popular Hashtags</h3>
          <Link href="/explore?sort=trending" className="text-xs font-medium text-primary hover:underline">See all</Link>
        </div>
        <ul className="space-y-3">
          {HASHTAGS.map((h) => (
            <li key={h.tag}>
              <Link href="/explore?sort=trending" className="flex items-center gap-3">
                <span className={`flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br ${h.color} text-white`}><h.icon className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">{h.tag}</span>
                  <span className="block text-[11px] text-muted-foreground">{formatCompactNumber(h.views)} views</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}
