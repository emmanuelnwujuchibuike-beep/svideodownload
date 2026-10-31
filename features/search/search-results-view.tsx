"use client";

import { ChevronRight, Hash, MapPin, Play, RotateCw, SearchX } from "lucide-react";
import { PendingLink } from "@/features/frenz-ui/pending";
import { useState, type ReactNode } from "react";

import { FollowPill } from "@/features/search/follow-pill";
import { Avatar, SafeImage } from "@/features/search/media";
import { NameLine } from "@/features/search/search-primitives";
import { SearchAction } from "@/features/search/tag-chip";
import { VideoTile } from "@/features/search/video-tile";
import { Skeleton, SkeletonSection } from "@/features/ui/skeleton";
import type { TrendingTag } from "@/lib/social/hashtags";
import type { PlaceResult } from "@/lib/social/places";
import type { SearchPerson, SearchResult, SearchType } from "@/lib/social/search";
import type { Sound } from "@/lib/social/sounds";
import { postViewHref } from "@/lib/social/post-url";
import { cn, formatCompactNumber } from "@/lib/utils";
import { profilePath } from "@/lib/social/profile-url";

/**
 * Search results, per tab, plus the searching / empty / error states.
 *
 * ── Rendering stays bounded ───────────────────────────────────────────────
 * `searchAll` caps every list at 30 rows server-side, so there is no
 * thousand-row set to virtualize — virtualization here would be machinery
 * guarding against a case the API cannot produce. What DOES matter on a phone
 * is how much lands in the DOM on the first frame, so each list renders a
 * page of 12 and reveals the rest on demand. No observer, no scroll listener:
 * one button, one state flip.
 *
 * ── A row either NAVIGATES or SEARCHES, never both ────────────────────────
 * People, sounds and posts lead somewhere else, so they are prefetching links.
 * Hashtags and places lead back to this very page, so they are NOT links at
 * all — they run the search in place. See `search-commit.tsx` for the report
 * that forced that distinction.
 */

const FIRST_PAGE = 12;

export function SearchResultsView({
  query,
  type,
  result,
  status,
  canFollow,
  onRetry,
  onSeeAll,
}: {
  query: string;
  type: SearchType;
  result: SearchResult;
  status: "idle" | "loading" | "error";
  canFollow: boolean;
  onRetry: () => void;
  /** "See all" on a Top section: switch to that section's chip. */
  onSeeAll: (t: SearchType) => void;
}) {
  const isEmpty =
    result.people.length === 0 &&
    result.posts.length === 0 &&
    result.sounds.length === 0 &&
    result.tags.length === 0 &&
    result.places.length === 0;

  // A NEW query with nothing on screen yet is the only time skeletons show.
  // While REFINING a query the previous results stay put and simply dim —
  // replacing a screen the user is reading with grey boxes is the flash this
  // page is specifically supposed to avoid.
  if (status === "loading" && isEmpty) return <ResultsSkeleton />;
  if (status === "error" && isEmpty) return <ErrorState onRetry={onRetry} />;
  if (isEmpty) return <NoResults query={query} />;

  /*
    Search & Discover design (2026-10-26): "Top shows a few of each section with See all; Users / Videos /
    Sounds / Hashtags show only that section." See all switches to that section's chip (no navigation).
  */
  const top = type === "all";
  const few = <T,>(items: T[], n: number) => (top ? items.slice(0, n) : items);
  const seeAll = (t: SearchType, total: number, shown: number) => (top && total > shown ? () => onSeeAll(t) : undefined);

  return (
    <div className={cn("transition-opacity duration-200", status === "loading" ? "opacity-55" : "opacity-100")} aria-busy={status === "loading"}>
      {result.people.length > 0 ? (
        <Group title={top ? "People" : null} onSeeAll={seeAll("people", result.people.length, 3)}>
          <Paged items={few(result.people, 3)} render={(p) => <PersonRow key={p.id} person={p} canFollow={canFollow} />} more="Show all people" list={CARD_LIST} />
        </Group>
      ) : null}

      {result.tags.length > 0 ? (
        <Group title={top ? "Hashtags" : null} onSeeAll={seeAll("hashtag", result.tags.length, 3)}>
          <Paged items={few(result.tags, 3)} render={(t) => <TagRow key={t.tag} tag={t} />} more="Show all hashtags" list="flex flex-col gap-2.5" />
        </Group>
      ) : null}

      {result.posts.length > 0 ? (
        <Group title={top ? "Videos" : null} onSeeAll={seeAll("video", result.posts.length, 4)}>
          <ul className="grid grid-cols-2 gap-2.5">
            {few(result.posts, 4).map((p) => (
              <li key={p.id}>
                <VideoTile video={{ ...p, href: postViewHref(p) }} caption sizes="(max-width: 640px) 50vw, 300px" />
              </li>
            ))}
          </ul>
        </Group>
      ) : null}

      {result.sounds.length > 0 ? (
        <Group title={top ? "Sounds" : null} onSeeAll={seeAll("sound", result.sounds.length, 3)}>
          <Paged items={few(result.sounds, 3)} render={(s) => <SoundRow key={s.id} sound={s} />} more="Show all sounds" list={CARD_LIST} />
        </Group>
      ) : null}

      {result.places.length > 0 ? (
        <Group title={top ? "Places" : null} onSeeAll={seeAll("place", result.places.length, 3)}>
          <Paged items={few(result.places, 3)} render={(p) => <PlaceRow key={p.label} place={p} />} more="Show all places" list={CARD_LIST} />
        </Group>
      ) : null}
    </div>
  );
}

const CARD_LIST = "divide-y divide-frenz-line/70 overflow-hidden rounded-[24px] border border-frenz-line bg-frenz-card";

function Group({ title, onSeeAll, children }: { title: string | null; onSeeAll?: () => void; children: ReactNode }) {
  return (
    <section className={title ? undefined : "pt-1"}>
      {title ? (
        <div className="flex items-center justify-between px-1 pb-2.5 pt-5">
          <h2 className="font-heading text-[19px] font-bold tracking-[-0.4px]">{title}</h2>
          {onSeeAll ? (
            <button type="button" onClick={onSeeAll} className="h-11 px-1 text-[15px] font-bold text-frenz-blue">
              See all
            </button>
          ) : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** First 12 rows now, the rest on a tap. */
function Paged<T>({ items, render, more, list }: { items: T[]; render: (item: T) => ReactNode; more: string; list: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, FIRST_PAGE);
  return (
    <>
      <ul className={list}>{shown.map(render)}</ul>
      {!all && items.length > FIRST_PAGE ? (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="mt-2.5 h-11 w-full rounded-full bg-frenz-fill text-[14px] font-bold text-frenz-violet transition-transform active:scale-[0.97]"
        >
          {more} ({items.length})
        </button>
      ) : null}
    </>
  );
}

/* ── Rows ──────────────────────────────────────────────────────────────── */

const ROW = "flex min-w-0 flex-1 items-center gap-3 text-left";
const ROW_LI = "flex items-center gap-3 px-3.5 py-3";

function RowBody({
  leading,
  title,
  subtitle,
}: {
  leading: ReactNode;
  title: ReactNode;
  subtitle: ReactNode;
}) {
  return (
    <>
      {leading}
      <span className="min-w-0 flex-1">
        {title}
        <span className="mt-0.5 block truncate text-[14px] text-frenz-muted">{subtitle}</span>
      </span>
    </>
  );
}

/** A row that goes somewhere else. `prefetch` so the tap is instant. */
function LinkRow({
  href,
  trailing,
  ...body
}: {
  href: string;
  leading: ReactNode;
  title: ReactNode;
  subtitle: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <li className={ROW_LI}>
      <PendingLink href={href} prefetch={false} className={ROW} inner={ROW}>
        <RowBody {...body} />
      </PendingLink>
      {trailing}
    </li>
  );
}

/** A row that re-runs the search on this page. Never a navigation. */
function ActionRow({
  term,
  type,
  ariaLabel,
  trailing,
  ...body
}: {
  term: string;
  type: SearchType;
  ariaLabel: string;
  leading: ReactNode;
  title: ReactNode;
  subtitle: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <li className={ROW_LI}>
      <SearchAction term={term} type={type} ariaLabel={ariaLabel} className={ROW}>
        <RowBody {...body} />
      </SearchAction>
      {trailing}
    </li>
  );
}

function PersonRow({ person: p, canFollow }: { person: SearchPerson; canFollow: boolean }) {
  return (
    <LinkRow
      href={`${profilePath(p.handle)}`}
      leading={<Avatar src={p.avatarUrl} size={52} />}
      title={<NameLine name={p.displayName} verified={p.isVerified} className="font-heading text-[16px] font-bold" />}
      subtitle={`@${p.handle} · ${formatCompactNumber(p.followersCount)} followers`}
      trailing={
        <FollowPill
          targetId={p.id}
          initialFollowing={p.isFollowing}
          canFollow={canFollow}
          displayName={p.displayName}
        />
      }
    />
  );
}

function TagRow({ tag }: { tag: TrendingTag }) {
  return (
    <li>
      <SearchAction
        term={`#${tag.tag}`}
        type="hashtag"
        ariaLabel={`Search #${tag.tag}`}
        className="flex h-[76px] w-full items-center gap-3.5 rounded-[24px] bg-frenz-fill px-4 text-left transition-transform active:scale-[0.97] motion-reduce:active:scale-100"
      >
        <span aria-hidden className="frenz-icon-glass text-frenz-violet flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[14px]">
          <Hash className="h-5 w-5" strokeWidth={2.6} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-heading text-[17px] font-bold">#{tag.tag}</span>
          <span className="block text-[14px] text-frenz-muted">
            {formatCompactNumber(tag.postCount)} {tag.postCount === 1 ? "post" : "posts"}
          </span>
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-frenz-muted" aria-hidden />
      </SearchAction>
    </li>
  );
}

function SoundRow({ sound: s }: { sound: Sound }) {
  const mins = Math.floor(s.durationSec / 60);
  const secs = String(Math.round(s.durationSec % 60)).padStart(2, "0");
  return (
    <LinkRow
      href={`/sound/${s.id}`}
      leading={
        <span className="relative h-[52px] w-[52px] shrink-0 overflow-hidden rounded-[14px] bg-frenz-gradient-x">
          {s.coverArtUrl ? (
            <SafeImage src={s.coverArtUrl} alt="" width={52} height={52} loading="lazy" decoding="async" fallback={null} className="h-full w-full object-cover" />
          ) : null}
          <span aria-hidden className="absolute inset-0 flex items-center justify-center bg-black/10 text-white">
            <Play className="h-4 w-4 translate-x-[1px] fill-current" />
          </span>
        </span>
      }
      title={<span className="block truncate font-heading text-[16px] font-bold">{s.title}</span>}
      subtitle={`${s.artistLabel} · ${formatCompactNumber(s.usageCount)} ${s.usageCount === 1 ? "video" : "videos"}`}
      trailing={s.durationSec > 0 ? <span className="shrink-0 text-[14px] font-semibold tabular-nums text-frenz-muted">{mins}:{secs}</span> : undefined}
    />
  );
}

function PlaceRow({ place: p }: { place: PlaceResult }) {
  return (
    <ActionRow
      // A place answers "who is here?", so tapping one lists those people.
      term={p.label}
      type="people"
      ariaLabel={`Find creators in ${p.label}`}
      leading={
        <span className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-2xl bg-frenz-fill text-frenz-violet">
          <MapPin className="h-5 w-5" aria-hidden />
        </span>
      }
      title={<span className="block truncate text-[14.5px] font-semibold">{p.label}</span>}
      subtitle={`${formatCompactNumber(p.creatorCount)} ${p.creatorCount === 1 ? "creator" : "creators"}`}
      trailing={
        p.avatars.length ? (
          <span className="flex -space-x-2 pr-1" aria-hidden>
            {p.avatars.map((a, i) => (
              <Avatar key={i} src={a} size={24} className="ring-2 ring-card" />
            ))}
          </span>
        ) : undefined
      }
    />
  );
}

/* ── States ───────────────────────────────────────────────────────────── */

/**
 * Structure, not a spinner. Three rows and a short grid, shimmering via the
 * app's existing `shimmer` utility — a CSS animation on one element, not an
 * animated loader occupying the middle of the screen.
 */
function ResultsSkeleton() {
  return (
    <SkeletonSection label="Searching" className="space-y-1">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-3 px-2 py-2">
          <Skeleton className="h-[46px] w-[46px] rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-9 w-20 rounded-xl" />
        </div>
      ))}
    </SkeletonSection>
  );
}

function NoResults({ query }: { query: string }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <span aria-hidden className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
        <SearchX className="h-7 w-7" />
      </span>
      <p className="text-[16px] font-semibold">No results found</p>
      <p className="mt-1.5 max-w-xs text-[13.5px] text-muted-foreground">
        Nothing matched &ldquo;{query}&rdquo;. Try a different spelling, a shorter word, or search a #hashtag or
        @username.
      </p>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center" role="alert">
      <p className="text-[16px] font-semibold">That search didn&rsquo;t go through</p>
      <p className="mt-1.5 max-w-xs text-[13.5px] text-muted-foreground">
        Check your connection — everything else on this page still works.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="srch-press srch-ring mt-5 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13.5px] font-semibold text-white"
      >
        <RotateCw className="h-4 w-4" aria-hidden /> Try again
      </button>
    </div>
  );
}
