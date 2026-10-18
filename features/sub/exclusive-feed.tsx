"use client";

import { Check, Clock, EyeOff, Film, ImageOff, Images, Loader2, Lock, RefreshCw, Lightbulb } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { VerifiedTick } from "@/components/badges/identity-badges";
import { itemsLabel, membershipChip, priceLine } from "@/features/sub/exclusive-labels";
import { firstPageIsReplay, type LinkBirth, mayAutoRefresh, refreshPreview } from "@/features/sub/feed-previews";
import { cancelOpening, startOpening } from "@/features/sub/opened-cache";
import { exPrimary, exQuiet } from "@/features/sub/ui";
import { cn } from "@/lib/utils";
import { profilePath } from "@/lib/social/profile-url";

// the existing private viewer (access re-checked by /api/sub/posts/[id] on open), loaded on the first tap
const PrivateViewer = dynamic(() => import("./sub-gallery").then((m) => m.PrivateViewer), { ssr: false });
// 0261: the age check, loaded only when a Mature post is tapped
const AgeGateSheet = dynamic(() => import("@/features/age/age-gate-sheet").then((m) => m.AgeGateSheet), { ssr: false });

/**
 * The Exclusive feed (Frenz Exclusive Part 3). Everything shown comes from the server, which
 * decides access on every request: posts from creators the viewer subscribes to, then — first
 * page only — locked previews from followed creators with the server's price.
 *
 * Paging: one request at a time (a ref guards rapid scrolling), the previous request aborted on
 * unmount, ids de-duplicated across pages, the next page asked for ~600 px before the end.
 * Tiles carry ONE five-minute preview link; the post's media are signed when it is opened.
 *
 * Part 15 (2026-10-17):
 *  · The first page arrives with the page itself (`initial`, rendered on the server for this
 *    viewer, never cached) — no second request after hydration. The app's router cache keeps
 *    pages for hours, so a first page seen before (or older than a minute) is shown and asked
 *    for again at once: what the server decides NOW replaces it.
 *  · A preview that fails after its link ran out is re-signed through the batched, access-checked
 *    refresh (feed-previews.ts); any other failure says so and offers a retry.
 *  · A post starts opening at the first touch (opened-cache.ts); a scroll cancels it.
 */

export interface Creator {
  id: string;
  handle: string;
  name: string;
  avatarUrl: string | null;
  verified: boolean;
  accessUntil?: string | null;
}
interface Post {
  id: string;
  creatorId: string;
  createdAt: string;
  caption: string | null;
  items: number;
  hasVideo: boolean;
  previewUrl: string | null;
  hidden: boolean;
  /** 0261: Mature (18+) */
  mature?: true;
  /** 0261: Mature and not confirmed 18+ — the server sent no preview or caption */
  ageLocked?: true;
}
interface Card {
  id: string;
  creatorId: string;
  createdAt: string;
  coverUrl: string | null;
  items: number;
  hasVideo: boolean;
  /** 0261: Mature (18+); its cover is only sent to a viewer who confirmed they're 18+ */
  mature?: true;
}
type DiscoverCreator = Creator & { priceCents: number; feeCents: number; feePercent: number; totalCents: number; periodDays: number };
export interface ExclusiveFeedPageView {
  posts: Post[];
  creators: Record<string, Creator>;
  next: string | null;
  subscriptions: number;
  discover?: { cards: Card[]; creators: Record<string, DiscoverCreator> };
  ready: boolean;
  issuedAt: number;
  previewTtl: number;
}
type Shown = Post & { birth: LinkBirth };

/** first pages already shown in this tab — one replayed from the router cache is asked for again */
const shownPages = new Set<number>();

const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const now = () => (typeof performance !== "undefined" ? performance.now() : 0);
const born = (page: ExclusiveFeedPageView, receivedAt: number) => (p: Post): Shown => ({ ...p, birth: { issuedAt: page.issuedAt, receivedAt, ttl: page.previewTtl } });

export function ExclusiveFeed({ initial = null }: { initial?: ExclusiveFeedPageView | null }) {
  const [posts, setPosts] = useState<Shown[]>(() => (initial ? initial.posts.map(born(initial, now())) : []));
  const [creators, setCreators] = useState<Record<string, Creator>>(() => initial?.creators ?? {});
  const [discover, setDiscover] = useState<ExclusiveFeedPageView["discover"]>(() => initial?.discover);
  const [subscriptions, setSubscriptions] = useState<number | null>(() => initial?.subscriptions ?? null);
  const [next, setNext] = useState<string | null>(() => initial?.next ?? null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(() => (initial ? "ready" : "loading"));
  const [more, setMore] = useState<"idle" | "loading" | "error">("idle");
  const [open, setOpen] = useState<string | null>(null);
  const [ageGate, setAgeGate] = useState(false);
  const busy = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const seen = useRef(new Set<string>(initial?.posts.map((p) => p.id) ?? []));
  const sentinel = useRef<HTMLDivElement>(null);
  // decided once per mount (StrictMode's second effect run must not count the page as replayed)
  const replayed = useRef<boolean | null>(null);

  const load = useCallback(async (cursor: string | null) => {
    if (busy.current) return;
    busy.current = true;
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    if (cursor) setMore("loading");
    try {
      const res = await fetch(`/api/sub/feed${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store", signal: ctl.signal });
      if (res.status === 401) {
        window.location.href = "/login?next=/exclusive";
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const page = (await res.json()) as ExclusiveFeedPageView;
      if (ctl.signal.aborted) return;
      if (!cursor) seen.current = new Set();
      const fresh = page.posts.filter((p) => !seen.current.has(p.id)).map(born(page, now()));
      fresh.forEach((p) => seen.current.add(p.id));
      setPosts((cur) => (cursor ? [...cur, ...fresh] : fresh));
      setCreators((cur) => ({ ...(cursor ? cur : {}), ...page.creators }));
      if (!cursor) {
        shownPages.add(page.issuedAt);
        setDiscover(page.discover);
        setSubscriptions(page.subscriptions);
      }
      setNext(page.next);
      setStatus("ready");
      setMore("idle");
    } catch (e) {
      if ((e as { name?: string }).name === "AbortError") return;
      if (cursor) setMore("error");
      // a failed re-check of a page already on screen leaves it there (opening a post asks the server anyway)
      else setStatus((s) => (s === "ready" ? s : "error"));
    } finally {
      // only the CURRENT request releases the guard (an aborted older one must not free a newer one's)
      if (abort.current === ctl) busy.current = false;
    }
  }, []);

  useEffect(() => {
    if (initial) {
      if (replayed.current === null) {
        replayed.current = firstPageIsReplay(initial.issuedAt, shownPages.has(initial.issuedAt));
        shownPages.add(initial.issuedAt);
      }
      if (!replayed.current) return;
    }
    void load(null);
    return () => {
      abort.current?.abort();
      // an aborted request must not leave the guard set: a remount (or StrictMode's second run) loads again
      busy.current = false;
    };
  }, [load, initial]);

  // the next page, a little before the end; never while one is loading or after an error (Retry asks again)
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !next || more !== "idle") return;
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && void load(next), { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [next, more, load]);

  if (status === "loading") return <FeedSkeleton />;
  if (status === "error")
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-[15px] font-semibold">Couldn&apos;t load your exclusive feed</p>
        <p className="text-[13.5px] text-muted-foreground">Check your connection and try again.</p>
        <button type="button" onClick={() => (setStatus("loading"), void load(null))} className={exQuiet}>
          <RefreshCw className="h-4 w-4" aria-hidden /> Try again
        </button>
      </div>
    );

  return (
    <div className="space-y-6">
      {posts.length ? (
        <ul className="space-y-4">
          {posts.map((p, i) => (
            <li key={p.id}>
              <FeedCard post={p} creator={creators[p.creatorId]} eager={i < 2} onOpen={() => (p.ageLocked ? setAgeGate(true) : setOpen(p.id))} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyFeed subscribed={(subscriptions ?? 0) > 0} />
      )}

      {next ? (
        <div ref={sentinel} className="flex justify-center py-2">
          {more === "error" ? (
            <button type="button" onClick={() => (setMore("idle"), void load(next))} className={exQuiet}>
              <RefreshCw className="h-4 w-4" aria-hidden /> Load more
            </button>
          ) : (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading more" />
          )}
        </div>
      ) : null}

      {discover?.cards.length ? <Discover cards={discover.cards} creators={discover.creators} /> : null}

      {open ? <PrivateViewer postId={open} initial={null} isCreator={false} onClose={() => setOpen(null)} onDeleted={() => setOpen(null)} /> : null}
      {ageGate ? (
        <AgeGateSheet
          onClose={() => setAgeGate(false)}
          onVerified={() => {
            setAgeGate(false);
            // the first page again: the server now sends the Mature posts' previews
            void load(null);
          }}
        />
      ) : null}
    </div>
  );
}

function Avatar({ c, size = 40 }: { c: Creator | undefined; size?: number }) {
  return c?.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- a profile photo at its own CDN size
    <img src={c.avatarUrl} alt="" width={size} height={size} loading="lazy" decoding="async" className="shrink-0 rounded-full object-cover ring-1 ring-black/[0.06] dark:ring-white/10" style={{ width: size, height: size }} />
  ) : (
    <span className="flex shrink-0 items-center justify-center rounded-full bg-primary/10 font-bold text-primary ring-1 ring-inset ring-primary/15 dark:bg-primary/20 dark:text-sky-200" style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden>
      {(c?.name ?? "?").replace(/^@/, "").charAt(0).toUpperCase()}
    </span>
  );
}

/** The creator's name with the server's verified flag (profiles.is_verified — users can't set it, 0257). */
function CreatorName({ c, link, className }: { c: Creator; link: boolean; className?: string }) {
  const name = link ? (
    // a 40px-tall hit area around a 22px line (negative margin: the row doesn't grow)
    <Link href={`${profilePath(c.handle)}?tab=sub`} prefetch={false} className="-my-[9px] truncate py-[9px] hover:underline">
      {c.name}
    </Link>
  ) : (
    <span className="truncate">{c.name}</span>
  );
  return (
    <span className={cn("flex min-w-0 items-center gap-1", className)}>
      {name}
      {c.verified ? <VerifiedTick size="sm" className="h-4 w-4" /> : null}
    </span>
  );
}

const chipTone = {
  active: "bg-primary/[0.08] text-primary dark:bg-primary/20 dark:text-sky-200",
  ending: "bg-amber-500/12 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300",
  ended: "bg-black/[0.05] text-muted-foreground dark:bg-white/[0.07]",
} as const;

function FeedCard({ post, creator, eager, onOpen }: { post: Shown; creator: Creator | undefined; eager: boolean; onOpen: () => void }) {
  const chip = membershipChip(creator?.accessUntil);
  const what = itemsLabel(post.items, post.hasVideo);
  const preview = usePreview(post);
  return (
    <article className="ex-card overflow-hidden">
      <header className="flex items-center gap-3 px-4 pb-3 pt-3.5">
        <Avatar c={creator} />
        <div className="min-w-0 flex-1">
          {creator ? <CreatorName c={creator} link className="text-[14.5px] font-semibold" /> : null}
          <p className="truncate text-[12.5px] text-muted-foreground">
            {creator ? `@${creator.handle} · ` : ""}
            {ago(post.createdAt)}
          </p>
        </div>
        {chip ? (
          <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] font-semibold", chipTone[chip.tone])} title={chip.label} aria-label={chip.label}>
            {chip.tone === "active" ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Clock className="h-3.5 w-3.5" aria-hidden />}
            {chip.text}
          </span>
        ) : null}
      </header>
      <div className="relative">
        <button
          type="button"
          onClick={onOpen}
          // Part 15: the post (and the viewer's code) start loading at the first touch; a scroll cancels it
          onPointerDown={() => {
            // a Mature post the viewer hasn't confirmed their age for would only answer 403
            if (post.ageLocked) return void import("@/features/age/age-gate-sheet");
            startOpening(post.id);
            void import("./sub-gallery");
          }}
          onPointerCancel={() => cancelOpening(post.id)}
          className="relative block aspect-[4/5] w-full overflow-hidden bg-black/[0.04] text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary dark:bg-white/[0.06]"
          aria-label={post.ageLocked ? `${creator?.name ?? "This"} exclusive post is Mature (18+). Confirm your age to open it.` : `Open ${creator?.name ?? "this"} exclusive post, ${what}`}
        >
          {post.ageLocked ? (
            <span className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-frenz-ink px-6 text-center text-white">
              <span className="font-heading text-2xl font-extrabold">18+</span>
              <span className="text-[14px] font-semibold">Mature post</span>
              <span className="text-[12.5px] text-white/75">Tap to confirm your age</span>
            </span>
          ) : (
            <PrivatePreview post={post} preview={preview} eager={eager} />
          )}
          {post.mature && !post.ageLocked ? (
            <span className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-black/55 px-2.5 py-1 text-[11.5px] font-extrabold text-white" aria-hidden>
              18+
            </span>
          ) : null}
          <span className="pointer-events-none absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/55 px-2.5 py-1 text-[11.5px] font-semibold text-white" aria-hidden>
            {post.hasVideo ? <Film className="h-3.5 w-3.5" /> : <Images className="h-3.5 w-3.5" />}
            {post.items}
          </span>
          {post.hidden ? (
            <span className="pointer-events-none absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/55 px-2.5 py-1 text-[11.5px] font-semibold text-white" title="Only subscribers know this post exists">
              <EyeOff className="h-3.5 w-3.5" aria-hidden /> Subscribers only
            </span>
          ) : null}
        </button>
        {preview.phase === "failed" ? (
          // beside the tile's own button, never inside it; runs only when tapped
          <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center">
            <button type="button" onClick={() => void preview.refresh()} className={cn(exQuiet, "pointer-events-auto")}>
              <RefreshCw className="h-4 w-4" aria-hidden /> Retry preview
            </button>
          </div>
        ) : null}
      </div>
      {post.caption ? <p className="line-clamp-3 whitespace-pre-line px-4 py-3 text-[14.5px] leading-snug">{post.caption}</p> : <div className="h-1" />}
    </article>
  );
}

/**
 * A feed tile's private preview: a plain <img> on its five-minute link (never next/image — the
 * optimizer would fetch and cache a private file on our server), inside the tile's fixed 4:5 box
 * so nothing moves while it loads. A link that ran out is re-signed once, automatically; any
 * other failure shows a retry, which only ever runs when tapped.
 */
function usePreview(post: Shown) {
  const [link, setLink] = useState<{ url: string | null; birth: LinkBirth }>({ url: post.previewUrl, birth: post.birth });
  const [phase, setPhase] = useState<"show" | "refreshing" | "failed" | "gone">("show");
  // a newer page re-signed this post: take its link (synchronously, no stale frame)
  const [lastUrl, setLastUrl] = useState(post.previewUrl);
  if (post.previewUrl !== lastUrl) {
    setLastUrl(post.previewUrl);
    setLink({ url: post.previewUrl, birth: post.birth });
    setPhase("show");
  }
  const refresh = async () => {
    setPhase("refreshing");
    const r = await refreshPreview(post.id);
    if (r.kind === "url") {
      setLink({ url: r.url, birth: r.birth });
      setPhase("show");
    } else if (r.kind === "none") {
      setLink((l) => ({ ...l, url: null }));
      setPhase("show");
    } else setPhase(r.kind);
  };
  // a link that ran out is re-signed once per link lifetime (monotonic clock); anything else is a real failure (no loop)
  const lastAuto = useRef<number | null>(null);
  const onError = () => {
    if (!mayAutoRefresh(link.birth, lastAuto.current)) return setPhase("failed");
    lastAuto.current = now();
    void refresh();
  };
  return { link, phase, refresh, onError };
}

function PrivatePreview({ post, preview, eager }: { post: Shown; preview: ReturnType<typeof usePreview>; eager: boolean }) {
  const { link, phase, onError } = preview;
  const icon = post.hasVideo ? <Film className="h-8 w-8 text-muted-foreground/70" aria-hidden /> : <Images className="h-8 w-8 text-muted-foreground/70" aria-hidden />;

  if (phase === "failed" || phase === "gone")
    return (
      <span className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 pb-12 text-center text-muted-foreground">
        <ImageOff className="h-7 w-7" aria-hidden />
        <span className="text-[13px] font-medium">{phase === "gone" ? "This post isn't available any more." : "The preview didn't load."}</span>
      </span>
    );
  if (!link.url) return <span className="flex h-full w-full items-center justify-center">{icon}</span>;
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- a five-minute private link, never cached or proxied */}
      <img
        key={link.url}
        src={link.url}
        alt=""
        loading={eager ? "eager" : "lazy"}
        fetchPriority={eager ? "high" : "auto"}
        decoding="async"
        draggable={false}
        onError={onError}
        onContextMenu={(e) => e.preventDefault()}
        className="h-full w-full object-cover"
      />
      {phase === "refreshing" ? (
        <span className="absolute inset-0 flex items-center justify-center bg-black/[0.04] dark:bg-white/[0.04]">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Refreshing the preview" />
        </span>
      ) : null}
    </>
  );
}

function EmptyFeed({ subscribed }: { subscribed: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 ex-card px-6 py-12 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-accent/15 ring-1 ring-inset ring-primary/20">
        <Lightbulb className="h-6 w-6 text-primary" aria-hidden />
      </span>
      <div>
        <p className="text-[16px] font-semibold">{subscribed ? "No exclusive posts yet" : "Your exclusive feed is empty"}</p>
        <p className="mt-1 max-w-sm text-[13.5px] leading-relaxed text-muted-foreground">
          {subscribed ? "When the creators you subscribe to share something for subscribers, it shows up here first." : "Subscribe to a creator to see the posts they share only with subscribers, all in one place."}
        </p>
      </div>
      <Link href="/explore" prefetch={false} className={cn(exQuiet, "mt-1")}>
        Find creators
      </Link>
    </div>
  );
}

function Discover({ cards, creators }: { cards: Card[]; creators: Record<string, DiscoverCreator> }) {
  return (
    <section aria-labelledby="exclusive-discover" className="space-y-3">
      <div>
        <h2 id="exclusive-discover" className="text-[16px] font-bold tracking-[-0.01em]">
          From creators you follow
        </h2>
        <p className="text-[13px] text-muted-foreground">Exclusive posts you can unlock with a subscription.</p>
      </div>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {cards.map((c) => (
          <li key={c.id}>
            <LockedPreviewCard card={c} creator={creators[c.creatorId]} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * A locked exclusive post: what the creator chose to make public (their cover, if any), who it
 * is from, what a subscription costs, and the existing checkout. Never the caption or a private
 * link. The price shown is the server's; checkout recomputes it on the server anyway.
 *
 * Part 15: a light tile (no saturated gradient), one lock mark, the standard item wording, and the
 * total the subscriber pays. The fee breakdown is shown at checkout only (owner, 2026-10-17).
 */
export function LockedPreviewCard({ card, creator }: { card: Card; creator: DiscoverCreator | undefined }) {
  const [state, setState] = useState<"idle" | "busy" | { error: string }>("idle");
  if (!creator) return null;
  const subscribe = async () => {
    setState("busy");
    const res = await fetch("/api/sub/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ creatorId: creator.id, returnPath: "/exclusive" }) }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { url?: string; error?: string } | null;
    if (res?.status === 401) {
      window.location.href = "/login?next=/exclusive";
      return;
    }
    if (res?.ok && j?.url) {
      window.location.href = j.url;
      return;
    }
    setState({ error: j?.error ?? "Couldn't open the payment. Try again." });
  };
  const price = priceLine(creator);
  const what = itemsLabel(card.items, card.hasVideo);
  return (
    <article className="ex-card overflow-hidden">
      <Link href={`${profilePath(creator.handle)}?tab=sub`} prefetch={false} className="relative block aspect-[16/10] overflow-hidden bg-gradient-to-br from-primary/[0.07] via-transparent to-accent/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary" aria-label={`${creator.name}'s exclusive posts — ${what}, for subscribers`}>
        {card.coverUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- the creator's PUBLIC teaser, on the CDN */}
            <img src={card.coverUrl} alt="" loading="lazy" decoding="async" className="h-full w-full scale-110 object-cover blur-md" />
            <span className="absolute inset-0 bg-white/30 dark:bg-black/40" aria-hidden />
          </>
        ) : null}
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-2" aria-hidden>
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-primary shadow-sm ring-1 ring-black/[0.06] dark:bg-neutral-900 dark:text-sky-300 dark:ring-white/10">
            <Lock className="h-5 w-5" />
          </span>
          <span className="rounded-full bg-white/90 px-2.5 py-1 text-[12px] font-semibold text-neutral-800 ring-1 ring-black/[0.05] dark:bg-neutral-900/90 dark:text-neutral-100 dark:ring-white/10">
            {what} · subscribers only{card.mature ? " · 18+" : ""}
          </span>
        </span>
      </Link>
      <div className="space-y-3 p-3.5">
        <div className="flex items-center gap-3">
          <Avatar c={creator} size={36} />
          <CreatorName c={creator} link={false} className="min-w-0 flex-1 text-[14px] font-semibold" />
        </div>
        {/* owner: the card shows only what is paid; the fee breakdown belongs to checkout. It wraps, never truncates */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <p className="min-w-0 grow basis-[10.5rem] text-[14px] font-semibold tabular-nums">{price}</p>
          <button type="button" onClick={() => void subscribe()} disabled={state === "busy"} className={exPrimary}>
            {state === "busy" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Lock className="h-4 w-4" aria-hidden />}
            Subscribe
          </button>
        </div>
      </div>
      {typeof state === "object" ? (
        <p role="alert" className="px-3.5 pb-3 text-[12.5px] font-medium text-rose-600 dark:text-rose-400">
          {state.error}
        </p>
      ) : null}
    </article>
  );
}

export function FeedSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading your exclusive feed">
      {[0, 1].map((i) => (
        <div key={i} className="overflow-hidden ex-card">
          <div className="flex items-center gap-3 px-4 pb-3 pt-3.5">
            <span className="h-10 w-10 animate-pulse rounded-full ex-skel" />
            <span className="h-3.5 w-36 animate-pulse rounded-full ex-skel" />
          </div>
          <div className="aspect-[4/5] w-full animate-pulse ex-skel" />
          <div className="space-y-2 px-4 py-3">
            <span className="block h-3 w-4/5 animate-pulse rounded-full ex-skel" />
            <span className="block h-3 w-2/5 animate-pulse rounded-full ex-skel" />
          </div>
        </div>
      ))}
    </div>
  );
}
