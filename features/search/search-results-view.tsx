"use client";

import { Hash, MapPin, Music, RotateCw, SearchX } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import { PostGrid } from "@/components/social/post-grid";
import { FollowPill } from "@/features/search/follow-pill";
import { Avatar, SafeImage } from "@/features/search/media";
import { NameLine } from "@/features/search/search-primitives";
import { SearchAction } from "@/features/search/tag-chip";
import { Skeleton, SkeletonSection } from "@/features/ui/skeleton";
import type { TrendingTag } from "@/lib/social/hashtags";
import type { PlaceResult } from "@/lib/social/places";
import type { SearchPerson, SearchResult, SearchType } from "@/lib/social/search";
import type { Sound } from "@/lib/social/sounds";
import { formatCompactNumber } from "@/lib/utils";

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
}: {
  query: string;
  type: SearchType;
  result: SearchResult;
  status: "idle" | "loading" | "error";
  canFollow: boolean;
  onRetry: () => void;
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

  const showPeople = result.people.length > 0;
  const showTags = result.tags.length > 0;
  const showPlaces = result.places.length > 0;
  const showSounds = result.sounds.length > 0;
  const showPosts = result.posts.length > 0;
  const labelled = type === "all";

  return (
    <div
      className={`space-y-7 transition-opacity duration-200 ${status === "loading" ? "opacity-55" : "opacity-100"}`}
      aria-busy={status === "loading"}
    >
      {showPeople ? (
        <Group title={labelled ? "People" : null}>
          <Paged
            items={result.people}
            render={(p) => <PersonRow key={p.id} person={p} canFollow={canFollow} />}
            more="Show all people"
          />
        </Group>
      ) : null}

      {showTags ? (
        <Group title={labelled ? "Hashtags" : null}>
          <Paged items={result.tags} render={(t) => <TagRow key={t.tag} tag={t} />} more="Show all hashtags" />
        </Group>
      ) : null}

      {showSounds ? (
        <Group title={labelled ? "Sounds" : null}>
          <Paged items={result.sounds} render={(s) => <SoundRow key={s.id} sound={s} />} more="Show all sounds" />
        </Group>
      ) : null}

      {showPlaces ? (
        <Group title={labelled ? "Places" : null}>
          <Paged items={result.places} render={(p) => <PlaceRow key={p.label} place={p} />} more="Show all places" />
        </Group>
      ) : null}

      {showPosts ? (
        <Group title={labelled ? "Videos & photos" : null}>
          <PostGrid posts={result.posts} layout={type === "video" ? "reel" : "card"} emptyText="" />
        </Group>
      ) : null}
    </div>
  );
}

function Group({ title, children }: { title: string | null; children: ReactNode }) {
  return (
    <section>
      {title ? (
        <h2 className="mb-2.5 px-1 text-[12px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
          {title}
        </h2>
      ) : null}
      {children}
    </section>
  );
}

/** First 12 rows now, the rest on a tap. */
function Paged<T>({
  items,
  render,
  more,
}: {
  items: T[];
  render: (item: T) => ReactNode;
  more: string;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, FIRST_PAGE);
  return (
    <>
      <ul className="space-y-1">{shown.map(render)}</ul>
      {!all && items.length > FIRST_PAGE ? (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="srch-press mt-2 w-full rounded-xl bg-secondary/70 py-2.5 text-[13px] font-semibold text-primary"
        >
          {more} ({items.length})
        </button>
      ) : null}
    </>
  );
}

/* ── Rows ──────────────────────────────────────────────────────────────── */

const ROW = "flex min-w-0 flex-1 items-center gap-3 text-left";
const ROW_LI =
  "flex items-center gap-3 rounded-2xl px-2 py-2 transition-colors duration-150 hover:bg-secondary/60";

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
        <span className="mt-0.5 block truncate text-[12.5px] text-muted-foreground">{subtitle}</span>
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
      <Link href={href} prefetch className={ROW}>
        <RowBody {...body} />
      </Link>
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
      href={`/u/${p.handle}`}
      leading={<Avatar src={p.avatarUrl} size={46} />}
      title={<NameLine name={p.displayName} verified={p.isVerified} className="text-[14.5px] font-semibold" />}
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
  const glyph = (
    <span className="srch-ring flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-2xl text-white">
      <Hash className="h-5 w-5" aria-hidden />
    </span>
  );
  return (
    <ActionRow
      term={`#${tag.tag}`}
      type="hashtag"
      ariaLabel={`Search #${tag.tag}`}
      leading={
        <SafeImage
          src={tag.thumbnailUrl ?? ""}
          alt=""
          width={46}
          height={46}
          loading="lazy"
          decoding="async"
          fallback={glyph}
          className="h-[46px] w-[46px] shrink-0 rounded-2xl bg-secondary object-cover"
        />
      }
      title={<span className="block truncate text-[14.5px] font-semibold">#{tag.tag}</span>}
      subtitle={`${formatCompactNumber(tag.postCount)} ${tag.postCount === 1 ? "post" : "posts"}`}
    />
  );
}

function SoundRow({ sound: s }: { sound: Sound }) {
  const glyph = (
    <span className="srch-ring flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-2xl text-white">
      <Music className="h-5 w-5" aria-hidden />
    </span>
  );
  return (
    <LinkRow
      href={`/sound/${s.id}`}
      leading={
        <SafeImage
          src={s.coverArtUrl ?? ""}
          alt=""
          width={46}
          height={46}
          loading="lazy"
          decoding="async"
          fallback={glyph}
          className="h-[46px] w-[46px] shrink-0 rounded-2xl bg-secondary object-cover"
        />
      }
      title={<span className="block truncate text-[14.5px] font-semibold">{s.title}</span>}
      subtitle={`${s.artistLabel} · ${formatCompactNumber(s.usageCount)} reels`}
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
        <span className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-2xl bg-secondary text-primary">
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
