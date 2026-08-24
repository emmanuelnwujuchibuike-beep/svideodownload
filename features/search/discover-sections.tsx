import { Flame, Play, Plus, UserRound, Users } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { FrenzLogo } from "@/components/brand/frenz-logo";
import { FollowPill } from "@/features/search/follow-pill";
import { Avatar, NameLine, SectionCard, SectionHeader } from "@/features/search/search-primitives";
import { VideoMoreButton } from "@/features/search/video-more-button";
import { TRENDING_CARD_COUNT, type DiscoverVideo, type SearchDiscover } from "@/lib/social/discover";
import type { TrendingTag } from "@/lib/social/hashtags";
import type { SuggestedCreator } from "@/lib/social/suggest";
import { formatCompactNumber } from "@/lib/utils";

/**
 * The /search empty state: discovery row, Trending Now, Suggested for you,
 * Popular videos.
 *
 * ── 🔴 EVERY SECTION HERE IS A SERVER COMPONENT ───────────────────────────
 * This is the entire first screen, and it ships as HTML with no component
 * JavaScript at all. The only client code in the whole block is a Follow pill
 * and a share button — small leaves at the edges, not a client boundary around
 * the tree. `SearchExperience` receives this as a `ReactNode` prop, so putting
 * an interactive search field on top of it does NOT drag it across the
 * client boundary; it stays RSC output the client shell simply positions.
 *
 * That is why this page can carry four rails of imagery and still paint its
 * first screen without waiting on hydration.
 */

/**
 * The three browse cards. Rendered BELOW the client shell's recent/trending
 * shortcuts, which is why the circular row is a separate export — the
 * reference puts those circles directly under the tabs, above everything else,
 * and the shortcuts sit between them and these cards.
 */
export function DiscoverSections({
  discover,
  canFollow,
}: {
  discover: SearchDiscover;
  canFollow: boolean;
}) {
  return (
    <div className="space-y-3.5">
      <TrendingNow tags={discover.tags.slice(0, TRENDING_CARD_COUNT)} />
      <SuggestedForYou creators={discover.creators} canFollow={canFollow} />
      <PopularVideos videos={discover.videos} />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Discovery row — Frenzsave, Your story, then the people worth meeting.
   ──────────────────────────────────────────────────────────────────────── */

export function DiscoveryRow({
  creators,
  viewerHandle,
}: {
  creators: SuggestedCreator[];
  /** The signed-in viewer's @handle, for the "Your story" circle. Null = guest. */
  viewerHandle: string | null;
}) {
  if (creators.length === 0 && !viewerHandle) return null;
  return (
    <nav aria-label="Discover creators" className="srch-rail -mx-3 gap-3.5 px-3 pb-1 pt-0.5">
      <Circle href="/explore" label="Frenzsave">
        <span className="srch-ring flex h-full w-full items-center justify-center rounded-full">
          <FrenzLogo size={40} tile className="rounded-full" />
        </span>
      </Circle>

      <Circle href={viewerHandle ? `/u/${viewerHandle}` : "/login?next=/search"} label="Your story" badge>
        <span className="flex h-full w-full items-center justify-center rounded-full bg-secondary text-muted-foreground">
          <UserRound className="h-7 w-7" aria-hidden />
        </span>
      </Circle>

      {creators.map((c) => (
        <Circle key={c.id} href={`/u/${c.handle}`} label={c.handle} verified={c.isVerified}>
          {/* 62px = the 70px ring minus its 2.5px gradient edge and 2px gap. */}
          <Avatar src={c.avatarUrl} name={c.displayName} size={62} />
        </Circle>
      ))}
    </nav>
  );
}

/**
 * One circle: a static gradient ring, a background-coloured gap, and the image.
 * Three nested spans and no filter — the ring is a plain CSS gradient painted
 * once, never a conic sweep or an animated border.
 */
function Circle({
  href,
  label,
  badge = false,
  verified = false,
  children,
}: {
  href: string;
  label: string;
  /** The "+" corner marker, for the viewer's own story circle. */
  badge?: boolean;
  verified?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className="srch-press flex w-[74px] flex-col items-center gap-1.5">
      <span className="srch-ring relative flex h-[70px] w-[70px] items-center justify-center rounded-full p-[2.5px]">
        <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-background p-[2px]">
          {children}
        </span>
        {badge ? (
          <span className="absolute -bottom-0.5 -right-0.5 flex h-[22px] w-[22px] items-center justify-center rounded-full border-[2.5px] border-background bg-primary text-primary-foreground">
            <Plus className="h-3 w-3" strokeWidth={3} aria-hidden />
          </span>
        ) : null}
      </span>
      <NameLine
        name={label}
        verified={verified}
        className="max-w-full justify-center text-[11.5px] font-medium text-muted-foreground"
        tickClassName="h-3 w-3"
      />
    </Link>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Trending Now
   ──────────────────────────────────────────────────────────────────────── */

function TrendingNow({ tags }: { tags: TrendingTag[] }) {
  if (tags.length === 0) return null;
  return (
    <SectionCard>
      <SectionHeader icon={<Flame className="h-[19px] w-[19px]" />} title="Trending Now" href="/explore" />
      <div className="grid grid-cols-1 gap-2 px-3 pb-3.5 sm:grid-cols-2">
        {tags.map((tag, i) => (
          <TrendingTagCard key={`${tag.source}:${tag.tag}`} tag={tag} rank={i + 1} />
        ))}
      </div>
    </SectionCard>
  );
}

function TrendingTagCard({ tag, rank }: { tag: TrendingTag; rank: number }) {
  return (
    <Link
      href={`/search?q=%23${encodeURIComponent(tag.tag)}&type=hashtag`}
      className="srch-press flex items-center gap-3 rounded-2xl bg-secondary/70 p-2.5 pr-2.5"
    >
      {/* The top three read as a ranking; the rest are just positions. */}
      <span
        aria-hidden
        className={`w-4 shrink-0 text-center text-[15px] font-bold tabular-nums ${
          rank <= 3 ? "text-primary" : "text-muted-foreground"
        }`}
      >
        {rank}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-semibold">#{tag.tag}</span>
        <span className="mt-0.5 block text-[12px] text-muted-foreground">
          {formatCompactNumber(tag.postCount)} {tag.postCount === 1 ? "post" : "posts"}
        </span>
      </span>
      {tag.thumbnailUrl ? (
        <Image
          src={tag.thumbnailUrl}
          alt=""
          width={44}
          height={44}
          loading="lazy"
          decoding="async"
          className="h-11 w-11 shrink-0 rounded-xl bg-secondary object-cover"
        />
      ) : (
        <span aria-hidden className="srch-ring h-11 w-11 shrink-0 rounded-xl opacity-70" />
      )}
    </Link>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Suggested for you
   ──────────────────────────────────────────────────────────────────────── */

function SuggestedForYou({ creators, canFollow }: { creators: SuggestedCreator[]; canFollow: boolean }) {
  if (creators.length === 0) return null;
  return (
    <SectionCard className="srch-defer">
      <SectionHeader
        icon={<Users className="h-[19px] w-[19px]" />}
        title="Suggested for you"
        href="/friends/discover"
      />
      <div className="srch-rail gap-2.5 px-3 pb-3.5">
        {creators.slice(0, 10).map((c) => (
          <article
            key={c.id}
            className="w-[144px] rounded-2xl border border-border/60 bg-secondary/50 p-2.5"
          >
            <Link href={`/u/${c.handle}`} className="srch-press block">
              <Image
                src={c.avatarUrl ?? "/brand/frenz-logo-tile.png"}
                alt=""
                width={128}
                height={160}
                loading="lazy"
                decoding="async"
                className="mb-2.5 h-[150px] w-full rounded-xl bg-secondary object-cover"
              />
              <NameLine name={c.displayName} verified={c.isVerified} className="text-[13.5px] font-semibold" />
              <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">@{c.handle}</span>
              <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
                {formatCompactNumber(c.followersCount)} followers
              </span>
            </Link>
            <FollowPill
              targetId={c.id}
              initialFollowing={c.isFollowing}
              canFollow={canFollow}
              displayName={c.displayName}
              className="mt-2.5 w-full"
            />
          </article>
        ))}
      </div>
    </SectionCard>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Popular videos
   ──────────────────────────────────────────────────────────────────────── */

function PopularVideos({ videos }: { videos: DiscoverVideo[] }) {
  if (videos.length === 0) return null;
  return (
    <SectionCard className="srch-defer">
      <SectionHeader icon={<Play className="h-[19px] w-[19px]" />} title="Popular videos" href="/reels" />
      <div className="srch-rail gap-2.5 px-3 pb-3.5">
        {videos.map((v) => (
          <VideoCard key={v.id} video={v} />
        ))}
      </div>
    </SectionCard>
  );
}

/**
 * 🔴 A COVER IMAGE, NEVER A `<video>`. Ten `<video preload="metadata">` tiles
 * in one rail is ten media pipelines and ten range requests for artwork the
 * poster already provides — and it is how a page ends up with several clips
 * playing at once. Nothing on this page autoplays, and nothing here is a video
 * element at all; the reel itself plays in the reels viewer, one at a time,
 * where the shared video coordinator can enforce that.
 */
function VideoCard({ video: v }: { video: DiscoverVideo }) {
  return (
    <article className="w-[164px]">
      <Link href={v.href} prefetch={false} className="srch-press block">
        <span className="relative block aspect-[9/16] w-full overflow-hidden rounded-2xl bg-secondary">
          {v.thumbnailUrl ? (
            <Image
              src={v.thumbnailUrl}
              alt=""
              fill
              sizes="164px"
              loading="lazy"
              className="object-cover"
            />
          ) : (
            <span aria-hidden className="srch-ring absolute inset-0 opacity-40" />
          )}
          {/* Play indicator — a mark on the artwork, not a control. */}
          <span
            aria-hidden
            className="absolute left-1/2 top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/35 text-white"
          >
            <Play className="h-4 w-4 translate-x-[1px] fill-current" />
          </span>
        </span>
        <span className="mt-2 flex items-center gap-1 text-[12px] font-medium text-muted-foreground">
          <Play className="h-3 w-3 fill-current" aria-hidden />
          {formatCompactNumber(v.viewsCount)}
        </span>
        <span className="mt-1 block truncate text-[13.5px] font-semibold">{v.title}</span>
      </Link>
      <div className="mt-1.5 flex items-center gap-1.5">
        <Link href={`/u/${v.publisher.handle}`} className="srch-press flex min-w-0 flex-1 items-center gap-1.5">
          <Avatar src={v.publisher.avatarUrl} name={v.publisher.displayName} size={20} />
          <NameLine
            name={v.publisher.handle}
            verified={v.publisher.isVerified}
            className="text-[12px] text-muted-foreground"
            tickClassName="h-3 w-3"
          />
        </Link>
        <VideoMoreButton href={v.href} title={v.title} />
      </div>
    </article>
  );
}
