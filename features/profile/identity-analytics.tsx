"use client";

import { Award, Bookmark, Eye, Heart, MessageCircle, Share2, Sparkles, TrendingUp } from "lucide-react";
import Link from "next/link";

import { AnimatedCount } from "@/features/ui/animated-count";
import { formatCompactNumber } from "@/lib/utils";

/**
 * Identity Analytics™ (Profile · Part 4-5) — the owner-only "Living Statistics"
 * panel. Turns the raw engagement columns already stored on every post
 * (views/likes/comments/shares/saves) into premium animated stat cards, plus a
 * real "Top content" highlight (the owner's highest-viewed post). Everything is
 * summed from REAL data — there are no fabricated trends, ranks or growth
 * curves: the profile has no time-series store yet, so Reputation, growth over
 * time and AI insights are honestly announced as coming, never faked. Private to
 * the owner (rendered only in the creator rail), matching the brief's
 * privacy-first stance.
 */
export interface IdentityAnalyticsData {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
}

export interface TopContent {
  id: string;
  title: string | null;
  thumbnailUrl: string | null;
  views: number;
  likes: number;
}

const METRICS: { key: keyof IdentityAnalyticsData; label: string; Icon: typeof Eye }[] = [
  { key: "views", label: "Views", Icon: Eye },
  { key: "likes", label: "Likes", Icon: Heart },
  { key: "comments", label: "Comments", Icon: MessageCircle },
  { key: "shares", label: "Shares", Icon: Share2 },
  { key: "saves", label: "Saves", Icon: Bookmark },
];

export function IdentityAnalytics({ data, topContent }: { data: IdentityAnalyticsData; topContent: TopContent | null }) {
  return (
    <section className="rounded-3xl border border-border/70 bg-card p-5 shadow-sm">
      <div className="mb-3.5 flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-tile text-white shadow-sm">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <h2 className="text-base font-bold leading-tight">Identity Analytics</h2>
          <p className="text-[11px] text-muted-foreground">Your engagement across Frenzsave</p>
        </div>
      </div>

      {/* Living Statistics — animated engagement totals */}
      <div className="grid grid-cols-3 gap-2">
        {METRICS.map(({ key, label, Icon }) => (
          <div key={key} className="rounded-2xl border border-border/60 bg-secondary/30 p-2.5 text-center">
            <Icon className="mx-auto h-4 w-4 text-muted-foreground" />
            <AnimatedCount value={data[key]} className="mt-1 block text-lg font-extrabold tracking-tight" />
            <span className="block text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">{label}</span>
          </div>
        ))}
      </div>

      {/* Content performance — the owner's real best post by views */}
      {topContent ? (
        <Link
          href={`/p/${topContent.id}`}
          className="mt-3 flex items-center gap-3 rounded-2xl border border-border/60 bg-secondary/20 p-2.5 transition hover:bg-secondary/45"
        >
          <span className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-secondary">
            {topContent.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={topContent.thumbnailUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <TrendingUp className="h-5 w-5 text-muted-foreground" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1 text-[11px] font-semibold text-primary">
              <TrendingUp className="h-3 w-3" /> Top content
            </span>
            <span className="block truncate text-sm font-semibold">{topContent.title || "Your best post"}</span>
            <span className="block text-xs text-muted-foreground">
              {formatCompactNumber(topContent.views)} views · {formatCompactNumber(topContent.likes)} likes
            </span>
          </span>
        </Link>
      ) : null}

      {/* Honest roadmap — no fabricated ranks, trends or AI numbers */}
      <div className="mt-3 flex items-center gap-2 rounded-2xl border border-dashed border-border/60 p-2.5 text-xs text-muted-foreground">
        <Award className="h-4 w-4 shrink-0" />
        <span>
          Growth trends &amp; AI insights — <span className="font-semibold text-foreground/80">coming soon</span>
        </span>
      </div>
    </section>
  );
}
