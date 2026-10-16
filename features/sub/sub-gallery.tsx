"use client";

import { BadgeCheck, EyeOff, Film, Flag, Heart, Images, Loader2, Lock, MessageCircle, Plus, Send, Trash2, X } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { GLASS, primaryPill, quietPill } from "@/features/friends/ui";
import { haptic } from "@/lib/motion/haptics";
import { WATERMARK_CORNER_SECONDS, WATERMARK_CORNERS } from "@/lib/media/watermark-mark-geometry";
import { usd } from "@/lib/creator/membership/engine";
import { cn, formatCompactNumber } from "@/lib/utils";

import { forgetSubPosts, loadSubPosts } from "./sub-posts-cache";

// reporting exclusive content (Frenz Exclusive Part 2): the shared sheet, loaded only when opened
const ReportSheet = dynamic(() => import("@/features/social/report-sheet").then((m) => m.ReportSheet), { ssr: false });

/**
 * SUB POSTS — a creator's subscriber-only gallery and the private viewer
 * (owner briefs 2026-10-11).
 *
 * What a viewer without access gets from the server: covers, dates and item
 * counts. Never a caption, a media key or a URL — the lock here is a picture of
 * the server's decision, not the protection itself.
 *
 * The viewer has no URL of its own and no share, copy-link, repost or embed
 * action: a post opens only here. Its media links come from the server per open,
 * expire in five minutes, and are dropped when the viewer closes.
 *
 * Capture protection, honestly: a web app cannot block screenshots or screen
 * recording on any platform. What this does is real but limited — the content is
 * covered the moment the app is hidden or loses focus (app switcher, another
 * app on top), long-press save / drag / the context menu / picture-in-picture /
 * the download control are off, and a light watermark names the viewer. See
 * docs/SUB_MONETIZATION.md for what needs a native app.
 */

interface Card {
  id: string;
  caption: string | null;
  coverUrl: string | null;
  items: number;
  hasVideo: boolean;
  createdAt: string;
  /** a subscriber's page arrives already opened — a tap shows the post at once (2026-10-12) */
  open?: Opened;
  /** the ~480 px private preview (0237) — what the tile loads, instead of the original */
  thumbUrl?: string | null;
}

/**
 * Posts opened in this tab, kept until their links are about to expire: reopening a post,
 * or one fetched on its own after the page's links ran out, never waits on the server again.
 * Memory only — never storage, so nothing private outlives the tab.
 */
const openedCache = new Map<string, Opened>();
const fresh = (o: Opened | undefined | null): o is Opened => !!o && Date.parse(o.expiresAt) - Date.now() > 30_000;

export interface SubQuoteView {
  priceCents: number;
  feeCents: number;
  totalCents: number;
  feePercent: number;
  periodDays: number;
}

export function SubGallery({ creatorId, creatorName, quote, signedIn, loginNext, onCompose, onAccess }: { creatorId: string; creatorName: string; quote: SubQuoteView | null; signedIn: boolean; loginNext: string; onCompose?: () => void; onAccess?: (subscribed: boolean) => void }) {
  const [state, setState] = useState<{ posts: Card[]; access: boolean; isCreator: boolean; next: string | null; ready: boolean; accessUntil?: string | null } | null>(null);
  // the tab's "for paid subscribers only" notice gives way to "You're subscribed" (2026-10-12)
  useEffect(() => {
    if (state) onAccess?.(state.access && !state.isCreator);
  }, [state, onAccess]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // once per creator, shared with the tab warm-up and kept four minutes (sub-posts-cache.ts) — no polling
  useEffect(() => {
    let cancelled = false;
    void loadSubPosts(creatorId)
      .then((j) => !cancelled && setState(j as NonNullable<typeof state>))
      .catch(() => !cancelled && setState({ posts: [], access: false, isCreator: false, next: null, ready: false }));
    return () => {
      cancelled = true;
    };
  }, [creatorId]);

  /*
    Once the covers are on screen and the browser is idle, the FIRST post's first photo is fetched
    into the cache, so opening it is instant — one file, never the whole gallery.
  */
  useEffect(() => {
    const first = state?.posts[0]?.open?.media[0];
    if (!first || first.kind !== "image") return;
    const go = () => {
      const img = new Image();
      img.decoding = "async";
      img.src = first.url;
    };
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(go, { timeout: 2500 });
      return () => window.cancelIdleCallback(id);
    }
    const t = setTimeout(go, 1200);
    return () => clearTimeout(t);
  }, [state?.posts]);

  /*
    Older VIDEO posts have no preview (only a browser can draw a video's first frame — no ffmpeg on
    Vercel, nothing on the worker). When the CREATOR opens their own tab, once idle, their browser makes
    one per such post, uploads it privately and saves it — once; every tile then loads instantly for
    everyone. Shown at once here from the local image.
  */
  const backfilling = useRef(false);
  useEffect(() => {
    if (!state?.isCreator || backfilling.current) return;
    const todo = state.posts.filter((p) => !p.thumbUrl && !p.coverUrl && p.open?.media[0]?.kind === "video");
    if (!todo.length) return;
    backfilling.current = true;
    const run = async () => {
      const { makeThumbFromVideoUrl } = await import("@/lib/media/make-thumb");
      for (const p of todo) {
        const media = p.open!.media[0]!;
        const t = await makeThumbFromVideoUrl(media.url);
        if (!t.blob) continue;
        const plan = await fetch("/api/sub/posts/upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "image", ext: "jpg" }) }).then((r) => r.json()).catch(() => null);
        if (!plan?.ok) continue;
        const put = await fetch(plan.uploadUrl as string, { method: "PUT", body: t.blob, headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store" } }).catch(() => null);
        if (!put?.ok) continue;
        const saved = await fetch(`/api/sub/posts/${p.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idx: 0, thumbKey: plan.key, width: t.width, height: t.height }) }).catch(() => null);
        if (!saved?.ok) continue;
        const local = URL.createObjectURL(t.blob);
        setState((cur) => (cur ? { ...cur, posts: cur.posts.map((x) => (x.id === p.id ? { ...x, thumbUrl: local } : x)) } : cur));
        forgetSubPosts(creatorId);
      }
    };
    const go = () => void run().catch(() => {});
    if ("requestIdleCallback" in window) window.requestIdleCallback(go, { timeout: 4000 });
    else setTimeout(go, 1500);
  }, [state, creatorId]);

  const more = async () => {
    if (!state?.next || loadingMore) return;
    setLoadingMore(true);
    const j = await fetch(`/api/sub/posts?creator=${creatorId}&before=${encodeURIComponent(state.next)}`).then((r) => r.json()).catch(() => null);
    setLoadingMore(false);
    if (j) setState((s) => (s ? { ...s, posts: [...s.posts, ...j.posts], next: j.next } : s));
  };

  const subscribe = async () => {
    haptic("selection");
    setPaying(true);
    setNote(null);
    const res = await fetch("/api/sub/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ creatorId, returnPath: loginNext }) }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { url?: string; error?: string } | null;
    if (res?.ok && j?.url) {
      window.location.assign(j.url);
      return;
    }
    setPaying(false);
    setNote(j?.error ?? "Couldn't open the payment. Try again.");
  };

  const removed = useCallback((id: string) => {
    forgetSubPosts(creatorId);
    setState((s) => (s ? { ...s, posts: s.posts.filter((p) => p.id !== id) } : s));
  }, [creatorId]);

  if (!state) {
    return (
      <div className="grid grid-cols-3 gap-1.5" aria-busy="true" aria-label="Loading subscriber posts">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="aspect-[4/5] animate-pulse rounded-2xl bg-black/[0.05] motion-reduce:animate-none dark:bg-white/[0.06]" />
        ))}
      </div>
    );
  }

  return (
    <div>
      {/* a subscriber is told so, and until when (owner 2026-10-12: "indicating he is a paid subscriber") */}
      {state.access && !state.isCreator ? (
        <div className="mb-3 flex items-center gap-3 rounded-[22px] border border-emerald-500/25 bg-emerald-500/[0.08] px-4 py-3.5">
          <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-500 text-white">
            <BadgeCheck className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[15px] font-bold leading-tight">You&apos;re subscribed to {creatorName}</p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">
              {state.accessUntil ? `Your access runs until ${new Date(state.accessUntil).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}. ` : ""}Tap any post to open it.
            </p>
          </div>
        </div>
      ) : null}

      {/* the price and the subscribe action, for anyone without access */}
      {!state.access && quote ? (
        <div className={cn("mb-3 rounded-[22px] px-4 py-3.5", GLASS)}>
          <div className="flex items-start gap-3">
            <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 text-white">
              <Lock className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-bold leading-tight">Subscribe to {creatorName}</p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                <b className="text-foreground">{usd(quote.priceCents)}</b> for {quote.periodDays} days of their subscriber posts.
              </p>
            </div>
          </div>
          {signedIn ? (
            <button type="button" onClick={() => void subscribe()} disabled={paying} className={cn(primaryPill, "mt-3 w-full justify-center bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600")}>
              {paying ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {paying ? "Opening secure payment…" : "Subscribe"}
            </button>
          ) : (
            <Link href={`/login?next=${encodeURIComponent(loginNext)}`} prefetch={false} className={cn(primaryPill, "mt-3 w-full justify-center")}>
              Sign in to subscribe
            </Link>
          )}
          <p className="mt-2 text-center text-[11.5px] text-muted-foreground">Paid securely with Paystack. Unlocks only once the payment is confirmed.</p>
          {note ? <p className="mt-2 text-center text-[12.5px] font-medium text-rose-600">{note}</p> : null}
        </div>
      ) : null}

      {state.isCreator && onCompose ? (
        <button type="button" onClick={onCompose} className={cn(quietPill, "mb-3 w-full justify-center")}>
          <Plus className="h-4 w-4" aria-hidden /> New subscriber post
        </button>
      ) : null}

      {!state.ready ? (
        <p className="py-8 text-center text-[13px] text-muted-foreground">Subscriber posts arrive with the next update.</p>
      ) : state.posts.length ? (
        <ul className="grid grid-cols-3 gap-1.5">
          {state.posts.map((p, idx) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => (state.access ? setOpen(p.id) : void 0)}
                aria-label={state.access ? `Open subscriber post${p.caption ? `: ${p.caption.slice(0, 60)}` : ""}` : "Subscriber only. Subscribe to unlock."}
                className="relative block aspect-[4/5] w-full overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-500/25 via-violet-500/20 to-blue-500/25 transition active:scale-[0.98] motion-reduce:active:scale-100"
              >
                {p.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- the creator's PUBLIC cover, never the private file
                  <img src={p.coverUrl} alt="" loading={idx < 9 ? "eager" : "lazy"} decoding="async" draggable={false} className="h-full w-full object-cover" />
                ) : p.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a five-minute private link to the small preview
                  <img src={p.thumbUrl} alt="" loading={idx < 9 ? "eager" : "lazy"} decoding="async" draggable={false} onContextMenu={(e) => e.preventDefault()} className="pointer-events-none h-full w-full object-cover" />
                ) : null}
                {/* 🔴 COVER FIRST (owner 2026-10-12: "not supposed to load the media when loading the cover"):
                    a tile shows the public cover or the small private preview and NEVER the original photo or
                    video — the media loads when the post is opened (and the first one is pre-loaded once the
                    covers are up, below). */}
                {!state.access ? (
                  <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/35 text-white backdrop-blur-[2px]">
                    <Lock className="h-5 w-5" aria-hidden />
                    <span className="text-[10.5px] font-bold uppercase tracking-[0.08em]">Subscriber only</span>
                  </span>
                ) : null}
                <span className="absolute right-1.5 top-1.5 inline-flex items-center gap-0.5 rounded-full bg-black/45 px-1.5 py-0.5 text-[10.5px] font-semibold text-white">
                  {p.hasVideo ? <Film className="h-3 w-3" aria-hidden /> : <Images className="h-3 w-3" aria-hidden />}
                  {p.items > 1 ? p.items : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-10 text-center text-[13.5px] text-muted-foreground">{state.isCreator ? "Nothing for subscribers yet. Your first post goes here." : "No subscriber posts yet."}</p>
      )}

      {state.next ? (
        <button type="button" onClick={() => void more()} disabled={loadingMore} className={cn(quietPill, "mt-3 w-full justify-center")}>
          {loadingMore ? "Loading…" : "Show more"}
        </button>
      ) : null}

      {open ? <PrivateViewer postId={open} initial={state.posts.find((p) => p.id === open)?.open ?? null} isCreator={state.isCreator} onClose={() => setOpen(null)} onDeleted={(id) => { removed(id); setOpen(null); }} /> : null}
    </div>
  );
}

interface Opened {
  caption: string | null;
  media: { kind: "image" | "video"; url: string; width: number | null; height: number | null }[];
  expiresAt: string;
  watermark: string | null;
  /** the creator's public handle — the roving mark links to their profile */
  creatorHandle?: string | null;
}

/** The private viewer: a portal with no URL, no share action, covered whenever the app is not in front. */
function PrivateViewer({ postId, initial, isCreator, onClose, onDeleted }: { postId: string; initial: Opened | null; isCreator: boolean; onClose: () => void; onDeleted: (id: string) => void }) {
  // already opened by the gallery (or earlier in this tab) and still valid: shown at once, no second check
  const [data, setData] = useState<Opened | null>(() => (fresh(openedCache.get(postId)) ? openedCache.get(postId)! : fresh(initial) ? initial : null));
  const [index, setIndex] = useState(0);
  // each item's real shape (measured on load) and the stage's — decides fill vs show-whole
  const [shapes, setShapes] = useState<Record<number, number>>({});
  const [stageRatio, setStageRatio] = useState<number | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const read = () => el.clientHeight && setStageRatio(el.clientWidth / el.clientHeight);
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, [data]);
  const [error, setError] = useState<string | null>(null);
  const [covered, setCovered] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reporting, setReporting] = useState(false);
  const dataRef = useRef(data);
  dataRef.current = data;
  const reported = useRef(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/sub/posts/${postId}`, { cache: "no-store" }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as (Opened & { error?: string }) | null;
    if (!res?.ok || !j) {
      setData(null);
      setError(j?.error ?? "This post couldn't be opened.");
      return;
    }
    openedCache.set(postId, j);
    setData(j);
  }, [postId]);

  useEffect(() => {
    if (!dataRef.current) void load();
  }, [load]);

  // lock the page behind the viewer while it is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // cover on hide / blur; on return, uncover — and fetch fresh links if these expired
  useEffect(() => {
    const hide = () => setCovered(true);
    const show = () => {
      if (document.visibilityState !== "visible" || !document.hasFocus()) return;
      setCovered(false);
      const d = dataRef.current;
      if (d && Date.parse(d.expiresAt) - Date.now() < 30_000) void load();
    };
    const onVisibility = () => (document.visibilityState === "hidden" ? hide() : show());
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", hide);
    window.addEventListener("focus", show);
    window.addEventListener("pagehide", hide);
    /*
      Screenshot shortcuts (owner 2026-10-11). The ONLY capture signal a browser
      gets: Print Screen (Windows, often keyup only), Cmd+Shift+3/4/5 (Mac) and
      Win+Shift+S (Windows Snip, when the browser sees it). Phones send nothing.
      The content is covered at once and the creator is told (lib/sub/capture.ts);
      one report per open, the server de-duplicates again.
    */
    const report = (kind: "print_screen" | "mac_shortcut" | "snip_shortcut") => {
      setCovered(true);
      if (isCreator || reported.current) return;
      reported.current = true;
      void fetch(`/api/sub/posts/${postId}/capture`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }), keepalive: true }).catch(() => {});
    };
    const captureKind = (e: KeyboardEvent) =>
      e.key === "PrintScreen" || e.code === "PrintScreen" ? ("print_screen" as const) : e.metaKey && e.shiftKey && ["Digit3", "Digit4", "Digit5"].includes(e.code) ? ("mac_shortcut" as const) : e.metaKey && e.shiftKey && e.code === "KeyS" ? ("snip_shortcut" as const) : null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      const k = captureKind(e);
      if (k) report(k);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const k = captureKind(e);
      if (k) report(k);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", hide);
      window.removeEventListener("focus", show);
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [load, onClose, isCreator, postId]);

  const del = async () => {
    if (!window.confirm("Delete this subscriber post and its files?")) return;
    haptic("selection");
    setDeleting(true);
    const res = await fetch(`/api/sub/posts/${postId}`, { method: "DELETE" }).catch(() => null);
    setDeleting(false);
    if (res?.ok) onDeleted(postId);
    else setError("Couldn't delete it.");
  };

  const block = (e: React.SyntheticEvent) => e.preventDefault();

  const many = (data?.media.length ?? 0) > 1;

  /*
    Shown like the History player (owner 2026-10-12): the media fills the screen edge to edge,
    full WIDTH always (owner 2026-10-12: "supposed to reach full width"), its height from
    its own shape up to the screen — a very tall photo is trimmed top and bottom rather than
    shrunk into side bars. It starts BELOW the safe area (status bar,
    Dynamic Island) and ends above the home indicator — it never goes behind them. The top
    bar floats over the media; several items swipe sideways like a carousel. The viewer's
    corner-hopping watermark (viewer's handle + the creator's profile link) rides on the media.
  */
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Subscriber post" className="fixed inset-0 z-[80] bg-black text-white" onContextMenu={block}>
      <div ref={stageRef} className="absolute inset-x-0 bottom-[env(safe-area-inset-bottom)] top-[var(--frenz-safe-top,0px)] select-none overflow-hidden [-webkit-touch-callout:none] [-webkit-user-select:none]" onDragStart={block}>
        {error ? (
          <p className="flex h-full items-center justify-center px-6 text-center text-[14px] text-white/80">{error}</p>
        ) : !data ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-white/60" aria-label="Loading" />
          </div>
        ) : (
          <div
            className="flex h-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            onScroll={(e) => {
              const el = e.currentTarget;
              const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
              if (i !== index) setIndex(i);
            }}
          >
            {data.media.map((m, i) => {
              /*
                FULL WIDTH, LIKE THE HISTORY PLAYER (owner 2026-10-12: "this viewer isn't showing in full width").
                The slide is the whole stage; the media FILLS it (object-cover) when its shape is close to the
                screen's — a phone video, a portrait photo — and is shown whole (contain) only when it is truly
                different (a landscape clip). The shape is MEASURED from the media itself once it loads, so a
                post with no stored size (every older video) is never letterboxed by a guess.
              */
              const known = m.width && m.height ? m.width / m.height : null;
              const r = shapes[i] ?? known;
              const fill = !r || !stageRatio || Math.abs(r - stageRatio) / stageRatio <= 0.28;
              const fit = fill ? "object-cover" : "object-contain";
              const measure = (w: number, h: number) => w && h && setShapes((cur) => (cur[i] ? cur : { ...cur, [i]: w / h }));
              return (
                <div key={i} className="relative h-full w-full shrink-0 snap-center overflow-hidden">
                  {m.kind === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a five-minute private link; next/image would cache it on our server
                    <img src={m.url} alt={data.caption ?? "Subscriber photo"} draggable={false} onContextMenu={block} onLoad={(e) => measure(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)} className={cn("pointer-events-none absolute inset-0 h-full w-full", fit)} />
                  ) : (
                    <video src={m.url} controls playsInline autoPlay={i === 0} preload="metadata" controlsList="nodownload noplaybackrate noremoteplayback" disablePictureInPicture disableRemotePlayback onContextMenu={block} onLoadedMetadata={(e) => measure(e.currentTarget.videoWidth, e.currentTarget.videoHeight)} className={cn("absolute inset-0 h-full w-full bg-black", fit)} />
                  )}
                </div>
              );
            })}
          </div>
        )}
        {data && (data.watermark || data.creatorHandle) ? <RovingWatermark viewer={data.watermark} creatorHandle={data.creatorHandle ?? null} /> : null}

        {/* the top bar floats over the media, inside the safe area like the History player */}
        <div className="absolute inset-x-0 top-0 z-[3] flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent px-3 pb-6 pt-2">
          <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-white/80 [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]">
            <Lock className="h-3.5 w-3.5" aria-hidden /> Subscriber only
            {many ? <span className="ml-1 rounded-full bg-black/45 px-2 py-0.5 text-[11px] normal-case tracking-normal">{index + 1} / {data!.media.length}</span> : null}
          </span>
          <span className="flex items-center gap-1">
            {isCreator ? (
              <button type="button" aria-label="Delete this post" disabled={deleting} onClick={() => void del()} className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/35 transition active:bg-white/10">
                {deleting ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Trash2 className="h-5 w-5" aria-hidden />}
              </button>
            ) : (
              <button type="button" aria-label="Report this post" onClick={() => setReporting(true)} className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/35 transition active:bg-white/10">
                <Flag className="h-[18px] w-[18px]" aria-hidden />
              </button>
            )}
            <button type="button" aria-label="Close" onClick={onClose} className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/35 transition active:bg-white/10">
              <X className="h-5 w-5" aria-hidden />
            </button>
          </span>
        </div>
        {reporting ? <ReportSheet targetType="sub_post" targetId={postId} open={reporting} onClose={() => setReporting(false)} /> : null}

        {/* caption over the media's foot, out of a video's controls */}
        {data?.caption ? (
          <div className={cn("pointer-events-none absolute inset-x-0 bottom-0 z-[3] bg-gradient-to-t from-black/70 to-transparent px-4 pt-10", data.media[index]?.kind === "video" ? "pb-20" : "pb-10")}>
            {data.caption ? <p className="max-h-[30vh] overflow-y-auto whitespace-pre-line text-[14.5px] leading-relaxed text-white/95 [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]">{data.caption}</p> : null}
          </div>
        ) : null}
        {data && many ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 z-[3] flex justify-center gap-1.5">
            {data.media.map((_, i) => (
              <span key={i} className={cn("h-1.5 rounded-full transition-all", i === index ? "w-4 bg-white" : "w-1.5 bg-white/45")} />
            ))}
          </div>
        ) : null}

        {/* likes and comments — subscribers and the creator only (0239); there is no save for a private post */}
        {data ? <PrivateInteractions postId={postId} isCreator={isCreator} /> : null}
        {covered ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black">
            <EyeOff className="h-6 w-6 text-white/70" aria-hidden />
            <p className="text-[13px] text-white/70">Hidden while Frenz isn&apos;t in front</p>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

interface PrivateComment {
  id: string;
  body: string;
  createdAt: string;
  mine: boolean;
  author: { name: string; handle: string | null; avatarUrl: string | null };
}

/**
 * Like and comment on a private post (owner 2026-10-12: "like and comment like a public post, but only
 * subscribers — not save"). The server checks access on every read and write; the heart answers on the
 * tap and is put back if the server refuses. One summary read when the post opens; comments load only
 * when the panel is opened.
 */
function PrivateInteractions({ postId, isCreator }: { postId: string; isCreator: boolean }) {
  const [sum, setSum] = useState<{ likes: number; liked: boolean; comments: number } | null>(null);
  const [panel, setPanel] = useState(false);
  const [comments, setComments] = useState<PrivateComment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [reportComment, setReportComment] = useState<string | null>(null);
  const commentsRequested = useRef(false);

  useEffect(() => {
    let alive = true;
    void fetch(`/api/sub/posts/${postId}/like`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { likes?: number; liked?: boolean; comments?: number } | null) => alive && j && setSum({ likes: j.likes ?? 0, liked: !!j.liked, comments: j.comments ?? 0 }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [postId]);

  const toggleLike = () => {
    if (!sum) return;
    haptic("selection");
    const prev = sum;
    const next = { ...sum, liked: !sum.liked, likes: sum.likes + (sum.liked ? -1 : 1) };
    setSum(next);
    void fetch(`/api/sub/posts/${postId}/like`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ like: next.liked }) })
      .then((r) => !r.ok && setSum(prev))
      .catch(() => setSum(prev));
  };

  const loadComments = useCallback(() => {
    if (commentsRequested.current) return;
    commentsRequested.current = true;
    void fetch(`/api/sub/posts/${postId}/comments`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { comments?: PrivateComment[]; error?: string }) => {
        setComments(j.comments ?? []);
        if (j.error) setNote(j.error);
      })
      .catch(() => {
        commentsRequested.current = false;
        setComments([]);
      });
  }, [postId]);

  // a post with comments has them read in the background as it opens, so the tray opens already filled
  useEffect(() => {
    if (sum && sum.comments > 0) loadComments();
  }, [sum, loadComments]);

  const openPanel = () => {
    haptic("selection");
    setPanel(true);
    loadComments();
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setNote(null);
    const res = await fetch(`/api/sub/posts/${postId}/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: text }) }).catch(() => null);
    const j = (await res?.json().catch(() => null)) as { id?: string; error?: string } | null;
    setSending(false);
    if (!res?.ok || !j?.id) return setNote(j?.error ?? "Couldn't post that.");
    setDraft("");
    setComments((c) => [...(c ?? []), { id: j.id!, body: text, createdAt: new Date().toISOString(), mine: true, author: { name: "You", handle: null, avatarUrl: null } }]);
    setSum((s0) => (s0 ? { ...s0, comments: s0.comments + 1 } : s0));
  };

  const remove = (c: PrivateComment) => {
    const prev = comments;
    setComments((list) => (list ?? []).filter((x) => x.id !== c.id));
    setSum((s0) => (s0 ? { ...s0, comments: Math.max(0, s0.comments - 1) } : s0));
    void fetch(`/api/sub/posts/${postId}/comments`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ commentId: c.id }) })
      .then((r) => !r.ok && setComments(prev))
      .catch(() => setComments(prev));
  };

  if (!sum) return null;
  return (
    <>
      {reportComment ? <ReportSheet targetType="sub_comment" targetId={reportComment} open onClose={() => setReportComment(null)} /> : null}
      {/* the engagement rail — frosted discs with a hairline ring, the reels rail's look */}
      <div className="absolute bottom-28 right-3 z-[4] flex flex-col items-center gap-4">
        <button type="button" onClick={toggleLike} aria-pressed={sum.liked} aria-label={sum.liked ? "Unlike" : "Like"} className="group flex flex-col items-center gap-1 text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.6)]">
          <span className={cn("flex h-12 w-12 items-center justify-center rounded-full bg-black/30 ring-1 ring-inset ring-white/15 backdrop-blur-md transition group-active:scale-90 motion-reduce:transition-none", sum.liked && "bg-rose-500/20 ring-rose-400/40")}>
            <Heart className={cn("h-6 w-6 transition-transform motion-reduce:transition-none", sum.liked && "scale-110 fill-rose-500 text-rose-500")} aria-hidden />
          </span>
          <span className="text-[12px] font-semibold tabular-nums">{formatCompactNumber(sum.likes)}</span>
        </button>
        <button type="button" onClick={openPanel} aria-label="Comments" className="group flex flex-col items-center gap-1 text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.6)]">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/30 ring-1 ring-inset ring-white/15 backdrop-blur-md transition group-active:scale-90 motion-reduce:transition-none">
            <MessageCircle className="h-6 w-6" aria-hidden />
          </span>
          <span className="text-[12px] font-semibold tabular-nums">{formatCompactNumber(sum.comments)}</span>
        </button>
      </div>
      {panel ? (
        <>
          {/* a tap above the tray closes it, like the reels and feed sheets */}
          <button type="button" aria-label="Close comments" tabIndex={-1} onClick={() => setPanel(false)} className="absolute inset-0 z-[5] cursor-default bg-black/40" />
          {/* 2026-10-14 (owner): the same height as the reels and feed comment sheets, not a small strip */}
          <section aria-label="Comments" className="absolute inset-x-0 bottom-0 z-[6] flex h-[68%] flex-col overflow-hidden rounded-t-[28px] bg-zinc-950/[0.97] text-white shadow-[0_-24px_60px_-20px_rgba(0,0,0,0.9)] ring-1 ring-inset ring-white/[0.08] backdrop-blur-2xl">
            {/* a hairline of gold across the top edge — the private, members-only mark */}
            <span aria-hidden className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-amber-300/60 to-transparent" />
            <span aria-hidden className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-white/25" />
            <header className="flex items-center justify-between gap-3 px-5 pb-3 pt-2.5">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-[16px] font-bold tracking-tight">
                  Comments
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11.5px] font-semibold tabular-nums text-white/80">{formatCompactNumber(sum.comments)}</span>
                </p>
                <p className="mt-0.5 flex items-center gap-1 text-[11.5px] font-medium text-amber-200/80">
                  <Lock className="h-3 w-3" aria-hidden />
                  Only subscribers can see these
                </p>
              </div>
              <button type="button" aria-label="Close comments" onClick={() => setPanel(false)} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.08] transition active:scale-90 motion-reduce:active:scale-100">
                <X className="h-5 w-5" aria-hidden />
              </button>
            </header>
            <div className="h-px shrink-0 bg-white/[0.07]" />
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
              {comments === null ? (
                <ul className="space-y-5" aria-busy="true" aria-label="Loading comments">
                  {[0, 1, 2].map((k) => (
                    <li key={k} className="flex items-start gap-3">
                      <span className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-white/10 motion-reduce:animate-none" />
                      <span className="flex-1 space-y-2 pt-1">
                        <span className="block h-3 w-24 animate-pulse rounded-full bg-white/10 motion-reduce:animate-none" />
                        <span className="block h-3 w-3/4 animate-pulse rounded-full bg-white/[0.07] motion-reduce:animate-none" />
                      </span>
                    </li>
                  ))}
                </ul>
              ) : comments.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 py-8 text-center">
                  <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-300/20 to-rose-400/20 ring-1 ring-inset ring-white/10">
                    <MessageCircle className="h-6 w-6 text-amber-200" aria-hidden />
                  </span>
                  <div>
                    <p className="text-[15px] font-semibold">No comments yet</p>
                    <p className="mt-1 text-[13px] text-white/55">Be the first to say something.</p>
                  </div>
                </div>
              ) : (
                <ul className="space-y-5">
                  {comments.map((c) => (
                    <li key={c.id} className="flex items-start gap-3">
                      <span className="shrink-0 rounded-full bg-gradient-to-br from-amber-300 via-rose-400 to-violet-500 p-[1.5px]">
                        {c.author.avatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={c.author.avatarUrl} alt="" className="h-10 w-10 rounded-full border-2 border-zinc-950 object-cover" />
                        ) : (
                          <span className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-zinc-950 bg-zinc-800 text-[14px] font-bold">{c.author.name.charAt(0).toUpperCase()}</span>
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="flex items-baseline gap-2 text-[13px]">
                          <span className="truncate font-semibold">{c.author.name}</span>
                          <span className="shrink-0 text-[11.5px] text-white/45">{shortAgo(c.createdAt)}</span>
                        </p>
                        <p className="mt-0.5 whitespace-pre-line break-words text-[14.5px] leading-snug text-white/90">{c.body}</p>
                      </div>
                      {c.mine || isCreator ? (
                        <button type="button" aria-label="Delete comment" onClick={() => remove(c)} className="-mr-2 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white/45 transition active:bg-white/10 active:text-rose-400">
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </button>
                      ) : null}
                      {!c.mine ? (
                        <button type="button" aria-label="Report comment" onClick={() => setReportComment(c.id)} className="-mr-2 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white/45 transition active:bg-white/10 active:text-white">
                          <Flag className="h-4 w-4" aria-hidden />
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {note ? <p role="alert" className="px-5 pb-1 text-[12.5px] font-medium text-rose-400">{note}</p> : null}
            <div className="shrink-0 border-t border-white/[0.07] bg-zinc-950 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">
              {/* one-tap reactions — the quickest way to answer a post */}
              <div className="mb-3 flex justify-between px-1">
                {QUICK_REACTIONS.map((e) => (
                  <button key={e} type="button" aria-label={`Add ${e}`} onClick={() => setDraft((d) => (d + e).slice(0, 1000))} className="flex h-10 w-10 items-center justify-center rounded-full text-[22px] transition active:scale-90 active:bg-white/10 motion-reduce:active:scale-100">
                    {e}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 rounded-full bg-white/[0.08] p-1.5 pl-4 ring-1 ring-inset ring-white/10 focus-within:ring-white/25">
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value.slice(0, 1000))}
                  onKeyDown={(e) => e.key === "Enter" && void send()}
                  placeholder="Add a comment…"
                  aria-label="Add a comment"
                  enterKeyHint="send"
                  className="min-h-10 min-w-0 flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-white/45"
                />
                <button type="button" onClick={() => void send()} disabled={!draft.trim() || sending} aria-label="Post comment" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-[0_6px_18px_-6px_rgba(124,58,237,0.8)] transition active:scale-90 disabled:from-white/15 disabled:to-white/15 disabled:shadow-none motion-reduce:active:scale-100">
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
                </button>
              </div>
            </div>
          </section>
        </>
      ) : null}
    </>
  );
}

const QUICK_REACTIONS = ["❤️", "🔥", "😍", "👏", "😂", "🙌", "💯"] as const;

/** "now", "5m", "3h", "2d", "4w" — the compact stamp comment lists use. */
function shortAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s) || s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  if (s < 604_800) return `${Math.floor(s / 86_400)}d`;
  return `${Math.floor(s / 604_800)}w`;
}

/**
 * The viewer's mark on a private post — ONE badge that hops corners, not a
 * pattern scattered across the media (owner, 2026-10-14: "remove the private
 * post watermark that is scattered on the screen, and use the watermarks that
 * appears at the top and bottom switching every 3 seconds"). Same corners and
 * timing as a downloaded video's watermark (lib/media/watermark-mark-geometry.ts).
 * Clear of the top bar, and above a video's controls.
 *
 * It is the ONLY mark (owner, 2026-10-14: "the one moving alone is enough, and
 * add /the user's name that opens the profile page in the moving watermark"):
 * the creator's fixed bottom-edge address is gone and its link rides here —
 * "@viewer · frenzsave.com/u/<creator>", a tap opening the creator's PUBLIC
 * profile, never this private post.
 */
function RovingWatermark({ viewer, creatorHandle }: { viewer: string | null; creatorHandle: string | null }) {
  const [k, setK] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setK((v) => (v + 1) % WATERMARK_CORNERS.length), WATERMARK_CORNER_SECONDS * 1000);
    return () => window.clearInterval(id);
  }, []);
  const corner = WATERMARK_CORNERS[k]!;
  const where = creatorHandle ? `frenzsave.com/u/${creatorHandle}` : "frenzsave.com";
  const text = viewer ? `${viewer} · ${where}` : where;
  const cls = cn(
    "absolute z-[2] select-none whitespace-nowrap rounded-full bg-black/30 px-2.5 py-1 text-[12px] font-semibold text-white/75 [text-shadow:0_1px_2px_rgba(0,0,0,0.6)]",
    corner.startsWith("top") ? "top-16" : "bottom-28",
    corner.endsWith("left") ? "left-3" : "right-3",
  );
  return creatorHandle ? (
    <a href={`/u/${encodeURIComponent(creatorHandle)}`} aria-label={`Open @${creatorHandle}'s profile`} className={cls}>
      {text}
    </a>
  ) : (
    <span aria-hidden className={cn("pointer-events-none", cls)}>
      {text}
    </span>
  );
}
