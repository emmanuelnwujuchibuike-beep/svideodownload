"use client";

import { BadgeCheck, EyeOff, Film, Images, Loader2, Lock, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { GLASS, primaryPill, quietPill } from "@/features/friends/ui";
import { haptic } from "@/lib/motion/haptics";
import { usd } from "@/lib/creator/membership/engine";
import { cn } from "@/lib/utils";

import { forgetSubPosts, loadSubPosts } from "./sub-posts-cache";

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
                ) : p.open?.media[0]?.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a subscriber's five-minute private link; next/image would cache it on our server
                  <img src={p.open.media[0].url} alt="" loading={idx < 9 ? "eager" : "lazy"} decoding="async" draggable={false} onContextMenu={(e) => e.preventDefault()} className="pointer-events-none h-full w-full object-cover" />
                ) : p.open?.media[0]?.kind === "video" ? (
                  <video src={`${p.open.media[0].url}#t=0.1`} muted playsInline preload="metadata" disablePictureInPicture className="pointer-events-none h-full w-full object-cover" />
                ) : null}
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
  /** the creator's public handle — the bottom-edge mark links to their profile */
  creatorHandle?: string | null;
}

/** The private viewer: a portal with no URL, no share action, covered whenever the app is not in front. */
function PrivateViewer({ postId, initial, isCreator, onClose, onDeleted }: { postId: string; initial: Opened | null; isCreator: boolean; onClose: () => void; onDeleted: (id: string) => void }) {
  // already opened by the gallery (or earlier in this tab) and still valid: shown at once, no second check
  const [data, setData] = useState<Opened | null>(() => (fresh(openedCache.get(postId)) ? openedCache.get(postId)! : fresh(initial) ? initial : null));
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [covered, setCovered] = useState(false);
  const [deleting, setDeleting] = useState(false);
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
    tiled watermark and the creator's bottom-edge mark ride on the media itself.
  */
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Subscriber post" className="fixed inset-0 z-[80] bg-black text-white" onContextMenu={block}>
      <div className="absolute inset-x-0 bottom-[env(safe-area-inset-bottom)] top-[var(--frenz-safe-top,0px)] select-none overflow-hidden [-webkit-touch-callout:none] [-webkit-user-select:none]" onDragStart={block}>
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
              const ratio = m.width && m.height ? m.width / m.height : null;
              return (
                <div key={i} className="flex h-full w-full shrink-0 snap-center items-center justify-center [container-type:size]">
                  {/* sized to the media's own shape, so the creator's mark sits on the media's bottom edge */}
                  <div className="relative max-h-full max-w-full" style={ratio ? { width: "100cqw", height: `min(100cqh, calc(100cqw / ${ratio}))` } : { width: "100%", height: "100%" }}>
                    {m.kind === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element -- a five-minute private link; next/image would cache it on our server
                      <img src={m.url} alt={data.caption ?? "Subscriber photo"} draggable={false} onContextMenu={block} className={cn("pointer-events-none h-full w-full", ratio ? "object-cover" : "object-contain")} />
                    ) : (
                      <video src={m.url} controls playsInline autoPlay={i === 0} preload="metadata" controlsList="nodownload noplaybackrate noremoteplayback" disablePictureInPicture disableRemotePlayback onContextMenu={block} className={cn("h-full w-full bg-black", ratio ? "object-cover" : "object-contain")} />
                    )}
                    {/*
                      The creator's address along the bottom edge (owner 2026-10-12, "like onlyfans.com/<user>"):
                      a screenshot that leaves Frenz still says where to find them — their PUBLIC profile, never
                      this private post. Above a video's controls, so it never covers them.
                    */}
                    {data.creatorHandle ? (
                      <a
                        href={`/u/${encodeURIComponent(data.creatorHandle)}`}
                        className={cn("absolute right-3 z-[2] select-none text-[12.5px] font-semibold tracking-[0.01em] text-white/85 [text-shadow:0_1px_3px_rgba(0,0,0,0.75)]", m.kind === "video" ? "bottom-14" : "bottom-2.5")}
                      >
                        frenzsave.com/u/{data.creatorHandle}
                      </a>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {data?.watermark ? (
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -inset-1/2 flex rotate-[-24deg] flex-wrap content-start gap-x-16 gap-y-20 opacity-[0.12]">
              {Array.from({ length: 40 }, (_, i) => (
                <span key={i} className="whitespace-nowrap text-[13px] font-semibold text-white">
                  {data.watermark} · frenzsave.com
                </span>
              ))}
            </div>
          </div>
        ) : null}

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
            ) : null}
            <button type="button" aria-label="Close" onClick={onClose} className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-black/35 transition active:bg-white/10">
              <X className="h-5 w-5" aria-hidden />
            </button>
          </span>
        </div>

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
