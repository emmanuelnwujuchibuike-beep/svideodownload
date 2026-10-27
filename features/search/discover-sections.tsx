import { Flame, Play, Plus, TrendingUp, UserRound } from "lucide-react";

import { PendingLink } from "@/features/frenz-ui/pending";
import { FollowPill } from "@/features/search/follow-pill";
import { Avatar, SafeImage } from "@/features/search/media";
import { NameLine, TREND_CHIP } from "@/features/search/search-primitives";
import { SearchAction } from "@/features/search/tag-chip";
import { VideoTile } from "@/features/search/video-tile";
import { TRENDING_CARD_COUNT, type DiscoverVideo, type SearchDiscover } from "@/lib/social/discover";
import type { TrendingTag } from "@/lib/social/hashtags";
import { profilePath } from "@/lib/social/profile-url";
import type { SuggestedCreator } from "@/lib/social/suggest";
import { formatCompactNumber } from "@/lib/utils";

/**
 * Discover (design/Frenz-Search-Discover-design.zip → Discover.dc.html, 2026-10-26): the creator circles,
 * Trending now (the gradient panel), Trending searches, Creators to follow and Explore videos. Used by
 * /search before anything is typed, and by /explore (the owner: "use same design for the explore page too").
 *
 * ── 🔴 EVERY SECTION HERE IS A SERVER COMPONENT ───────────────────────────
 * This is the whole first screen and it ships as HTML. The only client leaves are the Follow button, the
 * image wrappers that need `onError`, the pending links, and the controls that run a search in place
 * (`SearchAction`, which falls back to a plain link to /search where no search page is above it — /explore).
 * Trending now's "See all" is a CSS-only toggle (a hidden checkbox), so it ships no script either.
 *
 * Real data only: tags, post counts, followers and view counts come from the existing reads in
 * lib/social/discover.ts. The design's "Business · 2.5K" line is "2.5K followers" — creators carry no
 * profile type here, and a guessed one would be a fabricated label.
 */

const H2 = "font-heading text-[19px] font-bold tracking-[-0.4px]";
const SEE_ALL = "flex h-11 items-center px-1 text-[14px] font-bold text-frenz-blue";

function Heading({ id, title, href }: { id: string; title: string; href?: string }) {
  return (
    <div className="flex items-center justify-between px-1 pb-2.5 pt-[26px]">
      <h2 id={id} className={H2}>
        {title}
      </h2>
      {href ? (
        <PendingLink href={href} prefetch={false} className={SEE_ALL} spinnerSize={14}>
          See all
        </PendingLink>
      ) : null}
    </div>
  );
}

export function DiscoverSections({
  discover,
  canFollow,
  videosHref = "/explore",
  showVideos = true,
}: {
  discover: SearchDiscover;
  canFollow: boolean;
  /** Explore videos → "See all". /explore points it at /reels (it IS the explore page). */
  videosHref?: string;
  /** /explore draws its own filtered grid in this place, so it leaves this one out. */
  showVideos?: boolean;
}) {
  return (
    <div>
      <TrendingNow tags={discover.tags.slice(0, TRENDING_CARD_COUNT)} />
      <TrendingSearches terms={discover.tags.slice(TRENDING_CARD_COUNT).map((t) => `#${t.tag}`)} />
      <CreatorsToFollow creators={discover.creators} canFollow={canFollow} />
      {showVideos ? <ExploreVideos videos={discover.videos} href={videosHref} /> : null}
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   The circles — Your story, then the people worth meeting (each opens their profile).
   ──────────────────────────────────────────────────────────────────────── */

export function DiscoveryRow({
  creators,
  viewerHandle,
  loginNext = "/search",
}: {
  creators: SuggestedCreator[];
  /** The signed-in viewer's @handle, for the "Your story" circle. Null = guest. */
  viewerHandle: string | null;
  loginNext?: string;
}) {
  if (creators.length === 0 && !viewerHandle) return null;
  return (
    <nav aria-label="Discover creators" className="srch-rail -mx-4 gap-3 px-4 pb-1 pt-1">
      <Circle href={viewerHandle ? profilePath(viewerHandle) : `/login?next=${loginNext}`} label="Your story" badge>
        <span className="flex h-full w-full items-center justify-center rounded-full bg-frenz-fill text-frenz-muted">
          <UserRound className="h-7 w-7" aria-hidden />
        </span>
      </Circle>
      {creators.map((c) => (
        <Circle key={c.id} href={profilePath(c.handle)} label={c.handle} verified={c.isVerified}>
          <Avatar src={c.avatarUrl} size={56} />
        </Circle>
      ))}
    </nav>
  );
}

/** A static gradient ring, a white gap, the face. No conic sweep, no animated border. */
function Circle({ href, label, badge = false, verified = false, children }: { href: string; label: string; badge?: boolean; verified?: boolean; children: React.ReactNode }) {
  return (
    <PendingLink href={href} prefetch={false} className="flex w-[72px] shrink-0 flex-col items-center gap-1.5" inner="flex w-full flex-col items-center gap-1.5">
      <span className="relative flex h-[66px] w-[66px] items-center justify-center rounded-full bg-frenz-gradient p-[2.5px]">
        <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-frenz-card p-[2px]">{children}</span>
        {badge ? (
          <span className="absolute -bottom-0.5 -right-0.5 flex h-[22px] w-[22px] items-center justify-center rounded-full border-[2.5px] border-frenz-card bg-frenz-ink text-white">
            <Plus className="h-3 w-3" strokeWidth={3} aria-hidden />
          </span>
        ) : null}
      </span>
      <NameLine name={label} verified={verified} className="max-w-full justify-center text-[12.5px] font-semibold text-frenz-ink" tickClassName="h-3 w-3" />
    </PendingLink>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Trending now — the gradient panel: the top three, then the rest behind "See all".
   ──────────────────────────────────────────────────────────────────────── */

function TrendingNow({ tags }: { tags: TrendingTag[] }) {
  if (tags.length === 0) return null;
  const more = tags.length > 3;
  return (
    <section aria-labelledby="discover-trending" className="frenz-suggest-panel relative isolate mt-4 overflow-hidden rounded-[32px] px-4 pb-4 pt-4 text-white">
      <span aria-hidden className="pointer-events-none absolute -right-10 -top-12 h-[180px] w-[180px] rounded-full bg-white/[0.12]" />
      {/* the "See all" toggle: a real (visually hidden) checkbox, so it works with no script and is keyboard-reachable */}
      {more ? <input id="discover-trending-all" type="checkbox" className="peer sr-only" aria-label="Show all trending hashtags" /> : null}
      <div className="relative mb-3 flex items-center justify-between gap-3">
        <h2 id="discover-trending" className="flex items-center gap-2 font-heading text-[18px] font-bold tracking-[-0.3px]">
          <Flame className="h-[18px] w-[18px]" strokeWidth={2.4} aria-hidden />
          Trending now
        </h2>
        {more ? (
          <label htmlFor="discover-trending-all" className="frenz-glass-chip flex h-11 cursor-pointer items-center rounded-full px-3.5 text-[13px] font-bold transition-transform active:scale-[0.97]">
            <span className="[.peer:checked~*_&]:hidden">See all</span>
            <span className="hidden [.peer:checked~*_&]:inline">See less</span>
          </label>
        ) : null}
      </div>
      <ol className="relative flex flex-col gap-2.5">
        {tags.map((tag, i) => (
          <li key={`${tag.source}:${tag.tag}`} className={i >= 3 ? "hidden [.peer:checked~*_&]:block" : undefined}>
            <TrendingRow tag={tag} rank={i + 1} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function TrendingRow({ tag, rank }: { tag: TrendingTag; rank: number }) {
  return (
    <SearchAction
      term={`#${tag.tag}`}
      type="hashtag"
      ariaLabel={`Search #${tag.tag}`}
      className="frenz-glass-card flex h-[78px] w-full items-center gap-3.5 rounded-[22px] pl-4 pr-3 text-left text-frenz-ink transition-transform active:scale-[0.97] motion-reduce:active:scale-100"
    >
      <span aria-hidden className="w-5 shrink-0 text-center font-heading text-[22px] font-bold tabular-nums text-frenz-violet">
        {rank}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-heading text-[18px] font-bold tracking-[-0.3px]">#{tag.tag}</span>
        <span className="block text-[14px] text-frenz-muted">
          {formatCompactNumber(tag.postCount)} {tag.postCount === 1 ? "post" : "posts"}
        </span>
      </span>
      <span className="relative h-[54px] w-[62px] shrink-0 overflow-hidden rounded-[14px] bg-frenz-ink">
        <SafeImage
          src={tag.thumbnailUrl ?? ""}
          alt=""
          width={62}
          height={54}
          loading="lazy"
          decoding="async"
          fallback={<span aria-hidden className="absolute inset-0 bg-frenz-gradient opacity-80" />}
          className="h-full w-full object-cover"
        />
        <span aria-hidden className="absolute inset-0 flex items-center justify-center bg-black/25 text-white">
          <Play className="h-3.5 w-3.5 translate-x-[1px] fill-current" />
        </span>
      </span>
    </SearchAction>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Trending searches — one-tap chips (the tags beyond the panel's six)
   ──────────────────────────────────────────────────────────────────────── */


function TrendingSearches({ terms }: { terms: string[] }) {
  if (terms.length === 0) return null;
  return (
    <section aria-labelledby="discover-searches">
      <Heading id="discover-searches" title="Trending searches" />
      <div className="flex flex-wrap gap-2">
        {terms.map((t) => (
          <SearchAction key={t} term={t} type="hashtag" ariaLabel={`Search ${t}`} className={TREND_CHIP}>
            <TrendingUp className="h-4 w-4 text-frenz-violet" strokeWidth={2.4} aria-hidden />
            {t}
          </SearchAction>
        ))}
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Creators to follow
   ──────────────────────────────────────────────────────────────────────── */

function CreatorsToFollow({ creators, canFollow }: { creators: SuggestedCreator[]; canFollow: boolean }) {
  if (creators.length === 0) return null;
  return (
    <section aria-labelledby="discover-creators">
      <Heading id="discover-creators" title="Creators to follow" href="/friends/discover" />
      <div className="srch-rail -mx-4 gap-2.5 px-4 pb-1">
        {creators.slice(0, 10).map((c) => (
          <article key={c.id} className="flex w-[168px] shrink-0 flex-col items-center rounded-[24px] border border-frenz-line bg-frenz-card px-3.5 pb-3.5 pt-4 text-center">
            <PendingLink href={profilePath(c.handle)} prefetch={false} className="flex w-full flex-col items-center rounded-2xl" inner="flex w-full flex-col items-center">
              <span className="flex h-[80px] w-[80px] items-center justify-center rounded-full bg-frenz-gradient p-[2.5px]">
                <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full bg-frenz-card p-[2px]">
                  <Avatar src={c.avatarUrl} size={71} />
                </span>
              </span>
              <NameLine name={c.displayName} verified={c.isVerified} className="mt-2.5 max-w-full justify-center font-heading text-[16px] font-bold" />
              <span className="mt-0.5 block text-[13px] text-frenz-muted">{formatCompactNumber(c.followersCount)} followers</span>
            </PendingLink>
            <FollowPill targetId={c.id} initialFollowing={c.isFollowing} canFollow={canFollow} displayName={c.displayName} className="mt-3 w-full" />
          </article>
        ))}
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
   Explore videos — a 3-column grid of covers. Nothing autoplays.
   ──────────────────────────────────────────────────────────────────────── */

function ExploreVideos({ videos, href }: { videos: DiscoverVideo[]; href: string }) {
  if (videos.length === 0) return null;
  return (
    <section aria-labelledby="discover-videos">
      <Heading id="discover-videos" title="Explore videos" href={href} />
      <ul className="grid grid-cols-3 gap-2">
        {videos.slice(0, 9).map((v) => (
          <li key={v.id}>
            <VideoTile video={v} />
          </li>
        ))}
      </ul>
    </section>
  );
}
