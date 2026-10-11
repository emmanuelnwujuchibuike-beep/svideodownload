"use client";

import { EyeOff, Film, Images, Loader2, Lock, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { GLASS, primaryPill, quietPill } from "@/features/friends/ui";
import { haptic } from "@/lib/motion/haptics";
import { usd } from "@/lib/creator/membership/engine";
import { cn } from "@/lib/utils";

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
}

export interface SubQuoteView {
  priceCents: number;
  feeCents: number;
  totalCents: number;
  feePercent: number;
  periodDays: number;
}

export function SubGallery({ creatorId, creatorName, quote, signedIn, loginNext, onCompose }: { creatorId: string; creatorName: string; quote: SubQuoteView | null; signedIn: boolean; loginNext: string; onCompose?: () => void }) {
  const [state, setState] = useState<{ posts: Card[]; access: boolean; isCreator: boolean; next: string | null; ready: boolean } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // lazily, once, when the tab is opened (no prefetch, no polling)
  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/sub/posts?creator=${creatorId}`)
      .then((r) => r.json())
      .then((j) => !cancelled && setState(j))
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

  const removed = useCallback((id: string) => setState((s) => (s ? { ...s, posts: s.posts.filter((p) => p.id !== id) } : s)), []);

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
                {usd(quote.priceCents)} + {usd(quote.feeCents)} fee ({quote.feePercent}%) = <b className="text-foreground">{usd(quote.totalCents)}</b> for {quote.periodDays} days of their subscriber posts.
              </p>
            </div>
          </div>
          {signedIn ? (
            <button type="button" onClick={() => void subscribe()} disabled={paying} className={cn(primaryPill, "mt-3 w-full justify-center bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600")}>
              {paying ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {paying ? "Opening secure payment…" : `Subscribe for ${usd(quote.totalCents)}`}
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
          {state.posts.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => (state.access ? setOpen(p.id) : void 0)}
                aria-label={state.access ? `Open subscriber post${p.caption ? `: ${p.caption.slice(0, 60)}` : ""}` : "Subscriber only. Subscribe to unlock."}
                className="relative block aspect-[4/5] w-full overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-500/25 via-violet-500/20 to-blue-500/25 transition active:scale-[0.98] motion-reduce:active:scale-100"
              >
                {p.coverUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- the creator's PUBLIC cover, never the private file
                  <img src={p.coverUrl} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover" />
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

      {open ? <PrivateViewer postId={open} isCreator={state.isCreator} onClose={() => setOpen(null)} onDeleted={(id) => { removed(id); setOpen(null); }} /> : null}
    </div>
  );
}

interface Opened {
  caption: string | null;
  media: { kind: "image" | "video"; url: string; width: number | null; height: number | null }[];
  expiresAt: string;
  watermark: string | null;
}

/** The private viewer: a portal with no URL, no share action, covered whenever the app is not in front. */
function PrivateViewer({ postId, isCreator, onClose, onDeleted }: { postId: string; isCreator: boolean; onClose: () => void; onDeleted: (id: string) => void }) {
  const [data, setData] = useState<Opened | null>(null);
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
    setData(j);
  }, [postId]);

  useEffect(() => {
    void load();
  }, [load]);

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

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Subscriber post" className="fixed inset-0 z-[80] flex flex-col bg-black text-white" onContextMenu={block}>
      <div className="flex items-center justify-between px-3 py-2" style={{ paddingTop: "calc(var(--frenz-safe-top, 0px) + 0.5rem)" }}>
        <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-white/70">
          <Lock className="h-3.5 w-3.5" aria-hidden /> Subscriber only
        </span>
        <span className="flex items-center gap-1">
          {isCreator ? (
            <button type="button" aria-label="Delete this post" disabled={deleting} onClick={() => void del()} className="inline-flex h-11 w-11 items-center justify-center rounded-full transition active:bg-white/10">
              {deleting ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Trash2 className="h-5 w-5" aria-hidden />}
            </button>
          ) : null}
          <button type="button" aria-label="Close" onClick={onClose} className="inline-flex h-11 w-11 items-center justify-center rounded-full transition active:bg-white/10">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </span>
      </div>
      <div className="relative min-h-0 flex-1 select-none overflow-y-auto [-webkit-touch-callout:none] [-webkit-user-select:none]" onDragStart={block}>
        {error ? (
          <p className="px-6 py-16 text-center text-[14px] text-white/80">{error}</p>
        ) : !data ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-white/60" aria-label="Loading" />
          </div>
        ) : (
          <div className="mx-auto w-full max-w-xl space-y-2 pb-6">
            {data.media.map((m, i) =>
              m.kind === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element -- a five-minute private link; next/image would cache it on our server
                <img key={i} src={m.url} alt={data.caption ?? "Subscriber photo"} draggable={false} onContextMenu={block} className="pointer-events-none w-full" style={m.width && m.height ? { aspectRatio: `${m.width} / ${m.height}` } : undefined} />
              ) : (
                <video key={i} src={m.url} controls playsInline preload="metadata" controlsList="nodownload noplaybackrate noremoteplayback" disablePictureInPicture disableRemotePlayback onContextMenu={block} className="w-full bg-black" />
              ),
            )}
            {data.caption ? <p className="whitespace-pre-line px-4 pt-2 text-[15px] leading-relaxed text-white/90">{data.caption}</p> : null}
            {!isCreator ? <p className="px-4 pt-3 text-center text-[11.5px] text-white/45">Private to subscribers. Screenshots taken with a keyboard shortcut are reported to the creator.</p> : null}
          </div>
        )}
        {data?.watermark ? (
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -inset-1/2 flex rotate-[-24deg] flex-wrap content-start gap-x-16 gap-y-20 opacity-[0.12]">
              {Array.from({ length: 40 }, (_, i) => (
                <span key={i} className="whitespace-nowrap text-[13px] font-semibold text-white">
                  {data.watermark} · Frenz
                </span>
              ))}
            </div>
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
