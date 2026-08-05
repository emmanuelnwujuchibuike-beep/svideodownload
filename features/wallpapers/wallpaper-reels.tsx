"use client";

import { Bookmark, Download, Heart, Loader2, MessageCircle, Send, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { startDownload } from "@/features/downloads/manager";
import type { Wallpaper, WallpaperComment } from "@/lib/wallpapers";
import { haptic } from "@/lib/motion/haptics";
import { playSound } from "@/lib/notifications/sound-fx";
import { cn } from "@/lib/utils";

/**
 * The wallpaper reels viewer — full-bleed, edge to edge, one wallpaper per
 * screen, scrolled vertically like Reels (owner: "a reels style of full edge to
 * edge wallpaper, tall full wallpaper should go to the safe area and users can
 * scroll through them and like them and comment or save them in profile or
 * download them" — and "any wallpaper click should be scrollable like the reels
 * format").
 *
 * ── How the scrolling works ───────────────────────────────────────────────────
 * A CSS scroll-snap column, not a JS carousel: the browser's own snapping is
 * smoother than anything re-implemented on top of touch events, and it keeps
 * momentum, rubber-banding and accessibility for free. An IntersectionObserver
 * only tracks WHICH one is centred, so the caption and action rail describe the
 * right wallpaper; it never drives the scroll.
 *
 * Only the current image and its immediate neighbours get `loading="eager"`;
 * everything else stays lazy, so opening the viewer on a long library doesn't
 * pull down fifty full-size images.
 *
 * ── Who can do what ───────────────────────────────────────────────────────────
 * `canEngage` gates likes, saves and comments. Per the owner, those belong to a
 * signed-in member coming from the download page; a signed-out visitor arriving
 * from the landing's "Explore wallpapers" can still scroll the whole library and
 * download from it. Rather than hiding the actions (which would make the page
 * look broken), they prompt a sign-in.
 */

/**
 * Wallpapers already counted this session. Module-level, so scrolling back up
 * past one — or reopening the viewer — doesn't count it again. A built-in
 * placeholder has no database row, so it is never counted at all.
 */
const viewed = new Set<string>();

function countView(wallpaper: Wallpaper | undefined) {
  if (!wallpaper || wallpaper.builtIn || viewed.has(wallpaper.id)) return;
  viewed.add(wallpaper.id);
  // Fire-and-forget: a view is a side effect of looking at a picture, and must
  // never block the scroll or surface an error.
  void fetch("/api/wallpapers/view", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: wallpaper.id }),
    keepalive: true,
  }).catch(() => {});
}

export function WallpaperReels({
  items,
  startIndex = 0,
  canEngage,
  onClose,
  onDownloaded,
}: {
  items: Wallpaper[];
  startIndex?: number;
  canEngage: boolean;
  onClose: () => void;
  /** Fired after each successful download — the standalone page counts these
   *  to decide when to show its interstitial. */
  onDownloaded?: (wallpaper: Wallpaper) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(startIndex);
  const [state, setState] = useState<Record<string, { liked: boolean; saved: boolean; likes: number }>>(() =>
    Object.fromEntries(items.map((w) => [w.id, { liked: !!w.viewerLiked, saved: !!w.viewerSaved, likes: w.likes }])),
  );
  const [comments, setComments] = useState<string | null>(null);
  const [signInPrompt, setSignInPrompt] = useState(false);

  const current = items[index];

  // Jump to the tapped wallpaper without animating past everything before it.
  useEffect(() => {
    const el = scroller.current?.children[startIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "start", behavior: "instant" as ScrollBehavior });
  }, [startIndex]);

  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio > 0.6) {
            const i = Number((e.target as HTMLElement).dataset.i);
            if (!Number.isNaN(i)) {
              setIndex(i);
              countView(items[i]);
            }
          }
        }
      },
      { root, threshold: [0.6] },
    );
    for (const child of Array.from(root.children)) io.observe(child);
    return () => io.disconnect();
  }, [items.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (comments ? setComments(null) : onClose());
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflowY;
    document.body.style.overflowY = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflowY = prev;
    };
  }, [onClose, comments]);

  const engage = useCallback(
    async (wallpaper: Wallpaper, action: "like" | "unlike" | "save" | "unsave") => {
      if (!canEngage || wallpaper.builtIn) {
        setSignInPrompt(true);
        return;
      }
      haptic("selection");
      const liking = action === "like" || action === "unlike";
      // Optimistic: the tap must feel instant; a failure rolls the row back.
      setState((s) => {
        const cur = s[wallpaper.id]!;
        return {
          ...s,
          [wallpaper.id]: liking
            ? { ...cur, liked: action === "like", likes: cur.likes + (action === "like" ? 1 : -1) }
            : { ...cur, saved: action === "save" },
        };
      });
      try {
        const res = await fetch("/api/wallpapers/engage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: wallpaper.id, action }),
        });
        if (!res.ok) throw new Error("failed");
      } catch {
        setState((s) => {
          const cur = s[wallpaper.id]!;
          return {
            ...s,
            [wallpaper.id]: liking
              ? { ...cur, liked: action !== "like", likes: cur.likes + (action === "like" ? -1 : 1) }
              : { ...cur, saved: action !== "save" },
          };
        });
      }
    },
    [canEngage],
  );

  const download = useCallback(
    (wallpaper: Wallpaper) => {
      haptic("selection");
      playSound("tap");
      startDownload({
        url: wallpaper.downloadUrl,
        formatId: "wallpaper",
        kind: "image",
        title: `${wallpaper.name} wallpaper`,
        thumbnail: wallpaper.thumbUrl,
        platform: "generic",
        platformName: "Wallpaper",
        qualityLabel: "Full resolution",
        directUrl: wallpaper.downloadUrl,
      });
      onDownloaded?.(wallpaper);
    },
    [onDownloaded],
  );

  if (!current) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black">
      {/*
        The scroller itself is edge to edge and full height — `100dvh` so mobile
        browser chrome collapsing doesn't leave a strip of page showing. The
        image fills it; only the CONTROLS are inset to the safe area, which is
        what "tall full wallpaper should go to the safe area" asks for: the
        artwork runs under the notch, the buttons never do.
      */}
      <div
        ref={scroller}
        className="h-[100dvh] w-full snap-y snap-mandatory overflow-y-auto overscroll-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((w, i) => (
          <div key={w.id} data-i={i} className="relative h-[100dvh] w-full snap-start snap-always">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={w.url}
              alt={w.name}
              loading={Math.abs(i - index) <= 1 ? "eager" : "lazy"}
              decoding="async"
              className="h-full w-full object-cover"
            />
            {/* Scrims: the top one keeps the close button readable over a light
                image, the bottom one does the same for the caption. */}
            <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/55 to-transparent" />
            <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-black/75 to-transparent" />
          </div>
        ))}
      </div>

      {/* Close */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute left-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition active:scale-90"
        style={{ top: "calc(var(--frenz-safe-top, 0px) + 0.75rem)" }}
      >
        <X className="h-5 w-5" />
      </button>
      <span
        className="absolute right-4 z-10 rounded-full bg-black/40 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-md"
        style={{ top: "calc(var(--frenz-safe-top, 0px) + 0.9rem)" }}
      >
        {index + 1} / {items.length}
      </span>

      {/*
        Action rail — hard right, bottom-aligned (owner, 2026-08-04: "at the
        very right and at the bottom just like tiktok and snapchat").

        It used to float 7rem up, which left a band of dead space under it and
        put the buttons in the middle of the picture rather than out of the way
        of it. TikTok and Snapchat both anchor the rail to the bottom-right
        corner so the image is unobstructed and the thumb reaches the controls
        without moving — on a large phone the old position sat above the
        natural thumb arc.

        The caption's `pr-28` is what keeps the two from colliding; the rail is
        the fixed-width column and the caption flows around it.
      */}
      <div
        className="absolute right-1.5 z-20 flex flex-col items-center gap-4"
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 1.5rem)" }}
      >
        <RailButton
          label={`${state[current.id]?.likes ?? current.likes}`}
          active={state[current.id]?.liked}
          onClick={() => void engage(current, state[current.id]?.liked ? "unlike" : "like")}
          aria-label={state[current.id]?.liked ? "Unlike" : "Like"}
        >
          <Heart className={cn("h-6 w-6", state[current.id]?.liked && "fill-rose-500 text-rose-500")} />
        </RailButton>
        <RailButton label={`${current.comments}`} onClick={() => (canEngage ? setComments(current.id) : setSignInPrompt(true))} aria-label="Comments">
          <MessageCircle className="h-6 w-6" />
        </RailButton>
        <RailButton
          label="Save"
          active={state[current.id]?.saved}
          onClick={() => void engage(current, state[current.id]?.saved ? "unsave" : "save")}
          aria-label={state[current.id]?.saved ? "Remove from saved" : "Save to profile"}
        >
          <Bookmark className={cn("h-6 w-6", state[current.id]?.saved && "fill-white")} />
        </RailButton>
        <RailButton label="Save to device" onClick={() => download(current)} aria-label="Download">
          <Download className="h-6 w-6" />
        </RailButton>
      </div>

      {/* Caption */}
      <div
        className="pointer-events-none absolute inset-x-0 z-10 px-4 pr-28 text-white"
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 1.5rem)" }}
      >
        <p className="text-lg font-bold tracking-tight drop-shadow">{current.name}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-sm text-white/70">
          {current.category}
          {/* Views appear only once there are some — a fresh wallpaper shows no
              number rather than a "0 views" that reads like nobody cares. */}
          {current.views > 0 ? (
            <>
              <span aria-hidden>·</span>
              <span>{current.views.toLocaleString()} views</span>
            </>
          ) : null}
        </p>
        <button
          type="button"
          onClick={() => download(current)}
          className="pointer-events-auto mt-3 inline-flex items-center gap-2 rounded-2xl bg-white px-5 py-2.5 text-sm font-bold text-neutral-900 shadow-lg transition active:scale-95"
        >
          <Download className="h-4 w-4" /> Download
        </button>
      </div>

      {comments ? <CommentSheet wallpaperId={comments} onClose={() => setComments(null)} /> : null}
      {signInPrompt ? <SignInPrompt onClose={() => setSignInPrompt(false)} /> : null}
    </div>
  );
}

function RailButton({
  children,
  label,
  active,
  onClick,
  ...rest
}: {
  children: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-center gap-1 text-white transition active:scale-90" {...rest}>
      <span className={cn("flex h-12 w-12 items-center justify-center rounded-full bg-black/35 backdrop-blur-md", active && "bg-black/55")}>
        {children}
      </span>
      <span className="text-[11px] font-semibold drop-shadow">{label}</span>
    </button>
  );
}

/** Sign-in nudge — shown instead of silently ignoring a tap. */
function SignInPrompt({ onClose }: { onClose: () => void }) {
  return (
    <div className="absolute inset-0 z-20 flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div className="w-full max-w-sm rounded-3xl bg-card p-5 text-center shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <Heart className="mx-auto h-8 w-8 text-rose-500" />
        <p className="mt-3 font-bold">Sign in to like and save</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Downloads are open to everyone — liking, saving and commenting need an account.
        </p>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onClose} className="btn-lux btn-lux-secondary flex-1 justify-center">
            Not now
          </button>
          <Link href="/login?next=/downloads" className="btn-lux btn-lux-primary flex-1 justify-center">
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}

function CommentSheet({ wallpaperId, onClose }: { wallpaperId: string; onClose: () => void }) {
  const [items, setItems] = useState<WallpaperComment[] | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void fetch(`/api/wallpapers/comments?id=${encodeURIComponent(wallpaperId)}`)
      .then((r) => (r.ok ? r.json() : { comments: [] }))
      .then((d: { comments?: WallpaperComment[] }) => alive && setItems(d.comments ?? []))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, [wallpaperId]);

  const post = async () => {
    const text = body.trim();
    if (!text) return;
    setBusy(true);
    try {
      const res = await fetch("/api/wallpapers/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: wallpaperId, body: text }),
      });
      const json = (await res.json()) as { comment?: WallpaperComment };
      if (res.ok && json.comment) {
        setItems((c) => [json.comment!, ...(c ?? [])]);
        setBody("");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="absolute inset-0 z-20 flex flex-col justify-end bg-black/50" onClick={onClose}>
      <div
        className="flex max-h-[75vh] flex-col rounded-t-3xl bg-card pb-[env(safe-area-inset-bottom)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div aria-hidden className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-border" />
        <div className="flex items-center justify-between px-5 py-3">
          <p className="font-bold">Comments</p>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5">
          {items === null ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              <Loader2 className="mx-auto h-5 w-5 animate-spin" />
            </p>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No comments yet. Say something first.</p>
          ) : (
            <ul className="space-y-3 pb-3">
              {items.map((c) => (
                <li key={c.id} className="flex gap-2.5">
                  {c.authorAvatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.authorAvatar} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold">
                      {(c.authorName ?? "?").charAt(0).toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="text-xs font-semibold">
                      {c.authorName ?? "Member"}
                      {c.authorHandle ? <span className="ml-1 font-normal text-muted-foreground">@{c.authorHandle}</span> : null}
                    </p>
                    <p className="text-sm">{c.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-border/60 p-3">
          <input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && void post()}
            placeholder="Add a comment…"
            maxLength={500}
            className="h-11 flex-1 rounded-xl bg-background px-3.5 text-sm outline-none ring-1 ring-inset ring-border focus:ring-2 focus:ring-primary"
          />
          <button
            type="button"
            onClick={() => void post()}
            disabled={busy || !body.trim()}
            aria-label="Post comment"
            className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
