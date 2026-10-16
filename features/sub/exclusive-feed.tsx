"use client";

import { EyeOff, Film, Images, Loader2, Lock, RefreshCw, Sparkles } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { primaryPill, quietPill } from "@/features/friends/ui";
import { usd } from "@/lib/creator/membership/engine";
import { cn } from "@/lib/utils";

// the existing private viewer (access re-checked by /api/sub/posts/[id] on open), loaded on the first tap
const PrivateViewer = dynamic(() => import("./sub-gallery").then((m) => m.PrivateViewer), { ssr: false });

/**
 * The Exclusive feed (Frenz Exclusive Part 3). Everything shown comes from /api/sub/feed, which
 * decides access on the server on every request: posts from creators the viewer subscribes to,
 * then — first page only — locked previews from followed creators with the server's price.
 *
 * Paging: one request at a time (a ref guards rapid scrolling), the previous request aborted on
 * unmount, ids de-duplicated across pages, the next page asked for ~600 px before the end.
 * Tiles carry ONE five-minute preview link; the post's media are signed when it is opened.
 */

interface Creator {
  id: string;
  handle: string;
  name: string;
  avatarUrl: string | null;
  verified: boolean;
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
}
interface Card {
  id: string;
  creatorId: string;
  createdAt: string;
  coverUrl: string | null;
  items: number;
  hasVideo: boolean;
}
type DiscoverCreator = Creator & { priceCents: number; totalCents: number; periodDays: number };
interface Page {
  posts: Post[];
  creators: Record<string, Creator>;
  next: string | null;
  subscriptions: number;
  discover?: { cards: Card[]; creators: Record<string, DiscoverCreator> };
  ready: boolean;
}

const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

export function ExclusiveFeed() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [creators, setCreators] = useState<Record<string, Creator>>({});
  const [discover, setDiscover] = useState<Page["discover"]>(undefined);
  const [subscriptions, setSubscriptions] = useState<number | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [more, setMore] = useState<"idle" | "loading" | "error">("idle");
  const [open, setOpen] = useState<string | null>(null);
  const busy = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const seen = useRef(new Set<string>());
  const sentinel = useRef<HTMLDivElement>(null);

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
      const page = (await res.json()) as Page;
      if (ctl.signal.aborted) return;
      if (!cursor) seen.current = new Set();
      const fresh = page.posts.filter((p) => !seen.current.has(p.id));
      fresh.forEach((p) => seen.current.add(p.id));
      setPosts((cur) => (cursor ? [...cur, ...fresh] : fresh));
      setCreators((cur) => ({ ...(cursor ? cur : {}), ...page.creators }));
      if (!cursor) {
        setDiscover(page.discover);
        setSubscriptions(page.subscriptions);
      }
      setNext(page.next);
      setStatus("ready");
      setMore("idle");
    } catch (e) {
      if ((e as { name?: string }).name === "AbortError") return;
      if (cursor) setMore("error");
      else setStatus("error");
    } finally {
      // only the CURRENT request releases the guard (an aborted older one must not free a newer one's)
      if (abort.current === ctl) busy.current = false;
    }
  }, []);

  useEffect(() => {
    void load(null);
    return () => {
      abort.current?.abort();
      // an aborted request must not leave the guard set: a remount (or StrictMode's second run) loads again
      busy.current = false;
    };
  }, [load]);

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
        <button type="button" onClick={() => (setStatus("loading"), void load(null))} className={quietPill}>
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
              <FeedCard post={p} creator={creators[p.creatorId]} eager={i < 2} onOpen={() => setOpen(p.id)} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyFeed subscribed={(subscriptions ?? 0) > 0} />
      )}

      {next ? (
        <div ref={sentinel} className="flex justify-center py-2">
          {more === "error" ? (
            <button type="button" onClick={() => (setMore("idle"), void load(next))} className={quietPill}>
              <RefreshCw className="h-4 w-4" aria-hidden /> Load more
            </button>
          ) : (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Loading more" />
          )}
        </div>
      ) : null}

      {discover?.cards.length ? <Discover cards={discover.cards} creators={discover.creators} /> : null}

      {open ? <PrivateViewer postId={open} initial={null} isCreator={false} onClose={() => setOpen(null)} onDeleted={() => setOpen(null)} /> : null}
    </div>
  );
}

function Avatar({ c, size = 40 }: { c: Creator | undefined; size?: number }) {
  return c?.avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element -- a profile photo at its own CDN size
    <img src={c.avatarUrl} alt="" width={size} height={size} loading="lazy" decoding="async" className="shrink-0 rounded-full object-cover ring-2 ring-background" style={{ width: size, height: size }} />
  ) : (
    <span className="flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-accent font-bold text-primary-foreground ring-2 ring-background" style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden>
      {(c?.name ?? "?").replace(/^@/, "").charAt(0).toUpperCase()}
    </span>
  );
}

function FeedCard({ post, creator, eager, onOpen }: { post: Post; creator: Creator | undefined; eager: boolean; onOpen: () => void }) {
  const [broken, setBroken] = useState(false);
  return (
    <article className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-card">
      <header className="flex items-center gap-3 px-4 pb-3 pt-3.5">
        <Avatar c={creator} />
        <div className="min-w-0 flex-1">
          {creator ? (
            <Link href={`/u/${creator.handle}?tab=sub`} prefetch={false} className="block truncate text-[14.5px] font-semibold hover:underline">
              {creator.name}
            </Link>
          ) : null}
          <p className="truncate text-[12.5px] text-muted-foreground">
            {creator ? `@${creator.handle} · ` : ""}
            {ago(post.createdAt)}
          </p>
        </div>
        {post.hidden ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[11.5px] font-semibold text-muted-foreground" title="Only subscribers know this post exists">
            <EyeOff className="h-3.5 w-3.5" aria-hidden /> Subscribers only
          </span>
        ) : null}
      </header>
      <button type="button" onClick={onOpen} className="group relative block aspect-[4/5] w-full overflow-hidden bg-muted text-left" aria-label={`Open ${creator?.name ?? "this"} exclusive post`}>
        {post.previewUrl && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element -- a five-minute private link, never cached or proxied
          <img src={post.previewUrl} alt="" loading={eager ? "eager" : "lazy"} decoding="async" draggable={false} onError={() => setBroken(true)} onContextMenu={(e) => e.preventDefault()} className="h-full w-full object-cover transition duration-300 group-active:scale-[0.99]" />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/15 via-accent/10 to-transparent">
            {post.hasVideo ? <Film className="h-8 w-8 text-muted-foreground" aria-hidden /> : <Images className="h-8 w-8 text-muted-foreground" aria-hidden />}
          </span>
        )}
        <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/45 px-2.5 py-1 text-[11.5px] font-semibold text-white backdrop-blur-md">
          {post.hasVideo ? <Film className="h-3.5 w-3.5" aria-hidden /> : <Images className="h-3.5 w-3.5" aria-hidden />}
          {post.items}
        </span>
      </button>
      {post.caption ? <p className="line-clamp-3 whitespace-pre-line px-4 py-3 text-[14.5px] leading-snug">{post.caption}</p> : <div className="h-1" />}
    </article>
  );
}

function EmptyFeed({ subscribed }: { subscribed: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-border px-6 py-12 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-accent/15 ring-1 ring-inset ring-primary/20">
        <Sparkles className="h-6 w-6 text-primary" aria-hidden />
      </span>
      <div>
        <p className="text-[16px] font-semibold">{subscribed ? "No exclusive posts yet" : "Your exclusive feed is empty"}</p>
        <p className="mt-1 max-w-sm text-[13.5px] leading-relaxed text-muted-foreground">
          {subscribed ? "When the creators you subscribe to share something for subscribers, it shows up here first." : "Subscribe to a creator to see the posts they share only with subscribers, all in one place."}
        </p>
      </div>
      <Link href="/explore" prefetch={false} className={cn(quietPill, "mt-1")}>
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
  return (
    <article className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-card">
      <Link href={`/u/${creator.handle}?tab=sub`} prefetch={false} className="relative block aspect-[16/10] overflow-hidden bg-muted" aria-label={`${creator.name}'s exclusive posts`}>
        {card.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- the creator's PUBLIC teaser, on the CDN
          <img src={card.coverUrl} alt="" loading="lazy" decoding="async" className="h-full w-full scale-105 object-cover blur-[2px] brightness-75" />
        ) : (
          // no public cover: a solid brand ground, dark enough for the white label in light AND dark mode
          <span className="block h-full w-full bg-gradient-to-br from-primary via-accent to-primary/80" />
        )}
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-white">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/35 ring-1 ring-inset ring-white/25 backdrop-blur-md">
            <Lock className="h-5 w-5" aria-hidden />
          </span>
          <span className="text-[12.5px] font-semibold [text-shadow:0_1px_3px_rgba(0,0,0,0.5)]">
            {card.items} {card.hasVideo ? "item" : "photo"}
            {card.items === 1 ? "" : "s"} for subscribers
          </span>
        </span>
      </Link>
      <div className="flex items-center gap-3 p-3.5">
        <Avatar c={creator} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold">{creator.name}</p>
          <p className="truncate text-[12.5px] text-muted-foreground">
            {usd(creator.totalCents)} for {creator.periodDays} days
          </p>
        </div>
        <button type="button" onClick={() => void subscribe()} disabled={state === "busy"} className={primaryPill}>
          {state === "busy" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Lock className="h-4 w-4" aria-hidden />}
          Subscribe
        </button>
      </div>
      {typeof state === "object" ? (
        <p role="alert" className="px-3.5 pb-3 text-[12.5px] font-medium text-rose-500">
          {state.error}
        </p>
      ) : null}
    </article>
  );
}

function FeedSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading your exclusive feed">
      {[0, 1].map((i) => (
        <div key={i} className="overflow-hidden rounded-3xl border border-border/70 bg-card">
          <div className="flex items-center gap-3 px-4 pb-3 pt-3.5">
            <span className="h-10 w-10 animate-pulse rounded-full bg-muted" />
            <span className="h-3.5 w-36 animate-pulse rounded-full bg-muted" />
          </div>
          <div className="aspect-[4/5] w-full animate-pulse bg-muted" />
          <div className="space-y-2 px-4 py-3">
            <span className="block h-3 w-4/5 animate-pulse rounded-full bg-muted" />
            <span className="block h-3 w-2/5 animate-pulse rounded-full bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}
