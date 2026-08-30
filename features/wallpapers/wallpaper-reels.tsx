"use client";

import { motion } from "framer-motion";
import { ReelsAdSlide } from "@/features/monetization/reels-ad-slide";
import { WallpaperRewardGate } from "@/features/monetization/wallpaper-reward-gate";
import { Bookmark, Crown, Download, Heart, Loader2, MessageCircle, Send, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";

import { loadZoneAd } from "@/features/monetization/ad-cache";
import { useShowAds } from "@/features/monetization/use-show-ads";
import { useEntitlements } from "@/features/auth/use-entitlements";
import { startDownload } from "@/features/downloads/manager";
import { resolutionBadge, wallpaperCredit, type Wallpaper, type WallpaperComment } from "@/lib/wallpapers";
import { haptic } from "@/lib/motion/haptics";
import { playSound } from "@/lib/notifications/sound-fx";
import { cn } from "@/lib/utils";

/**
 * An ad after every N wallpapers — the same number the reels deck uses.
 *
 * Deliberately the same promise on both surfaces: the owner asked for one
 * shared ad system, and a different cadence on each would be a difference
 * nobody asked for.
 */
const WALLPAPER_AD_EVERY = 3;

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
 *
 * ── Less chrome, more wallpaper (owner, 2026-08-09) ───────────────────────────
 * "make the reels wallpaper premium to be less cluster so the wallpaper can show
 * fully, make the upgrade prompt to not occupy spaces."
 *
 * Three changes, each aimed at the same thing — this screen exists to show ONE
 * picture, and every control on top of it is covering part of the product:
 *
 * 1. THE CHROME STAYS PUT. A tap-to-clear-everything mode shipped here first
 *    and was reversed the same day (owner): "the wallpapers in wallpaper reels
 *    shouldn't show clear complete screen on tap, so users won't screenshot to
 *    skip downloading through the download button that has ad and limit."
 *
 *    That is the correct call and worth writing down, because "let the artwork
 *    breathe" is such an appealing instinct. A viewer that clears every control
 *    on tap hands over a pristine full-screen wallpaper to screenshot — the
 *    same picture, without the ad, without the daily count, without ever
 *    touching the button this page's whole economy runs through. Decluttering
 *    here means FEWER, SMALLER controls; it does not mean none.
 *
 * 2. THE RAIL LOST ITS FOURTH BUTTON AND ITS CAPTIONS. "Save to device" was a
 *    duplicate of the Download button an inch below it, so it is gone rather
 *    than shrunk. What remains — like, comment, save — carries counts and no
 *    word labels: three glyphs everyone already knows, taking a third of the
 *    height the old rail did.
 *
 * 3. THE UPGRADE PROMPT COSTS NO SPACE. It was a full card pinned above the
 *    fold, permanently covering a band of every wallpaper. It is now a crown
 *    chip on the caption line that expands into the offer only when tapped —
 *    and it is not rendered at all for a member who already pays, who was
 *    previously being sold something they own.
 */

/**
 * Wallpapers already counted this session. Module-level, so scrolling back up
 * past one — or reopening the viewer — doesn't count it again. A built-in
 * placeholder has no database row, so it is never counted at all.
 */
const viewed = new Set<string>();

/**
 * A URL the browser can actually fetch from this page.
 *
 * The wallpaper bytes live on storage hosts that reflect CORS for the two
 * production origins only, so a direct `fetch` from any other origin throws
 * and "Save to device" did nothing at all (owner, twice).
 *
 * This is the identical failure `/api/media/download` was built to solve for
 * member media — wallpapers simply never routed through it. Same-origin means
 * no preflight, no allowlist to keep in step with every deploy domain, and a
 * real `Content-Disposition` on the way back.
 *
 * A relative path (the built-in wallpapers ship with the app) is already
 * same-origin and is left alone; proxying it would spend egress for nothing.
 */
function fetchableUrl(raw: string, name: string): string {
  if (!/^https?:\/\//i.test(raw)) return raw;
  return `/api/media/download?url=${encodeURIComponent(raw)}&name=${encodeURIComponent(name)}`;
}

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
  onDownload,
}: {
  items: Wallpaper[];
  startIndex?: number;
  canEngage: boolean;
  onClose: () => void;
  /**
   * Start a download. Owned by the PARENT, not this component, because the
   * allowance, the ad and the notification are one policy shared by the grid and
   * the viewer — see `useWallpaperDownload`. When the viewer had its own copy,
   * the two surfaces drifted into showing ads on different schedules.
   */
  onDownload: (wallpaper: Wallpaper) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(startIndex);
  /*
    🔴 The wallpaper ad SHARES the reels zone (owner, 2026-08-30: "make same
    reels style ad full to be in wallpaper page, they should both share one ad
    zone id and slot style and everything").

    Same zone id, same component, same cadence — so a change to one is a
    change to both, which is the whole point of sharing rather than copying.

    Like the history story ad, it is NOT spliced into `items`. This viewer
    drives `index` from an IntersectionObserver over real DOM children, so an
    injected slide would desync the observer's `data-i` from the array — the
    same index-space bug the reels deck hit three times. Instead the ad is an
    OVERLAY that appears when a boundary is crossed and dismisses back to the
    wallpaper the visitor was already on.
  */
  const { showAds, ready: adsReady } = useShowAds();
  /*
    Whether the shared zone actually has a creative. Probed ONCE, before any ad
    slide is composed — an unseeded zone must insert NO slide rather than an
    empty one, exactly as the reels deck does it.
  */
  const [adSeeded, setAdSeeded] = useState(false);
  /** True while the slide on screen is the ad rather than a wallpaper. */
  const [adActive, setAdActive] = useState(false);
  useEffect(() => {
    if (!adsReady || !showAds) return;
    let alive = true;
    void loadZoneAd("reels_interstitial")
      .then((ad) => {
        if (alive) setAdSeeded(!!ad);
      })
      .catch(() => {
        /* No ad is the safe direction — leave the viewer as pure content. */
      });
    return () => {
      alive = false;
    };
  }, [adsReady, showAds]);
  /*
    The wallpaper waiting on the reward gate.

    🔴 The download is HELD, not cancelled, and never lost: whatever the gate
    does — runs, fails, finds no creative — `release` fires and the file
    downloads. A reward that can strand someone between a tap and their file
    is worse than no reward at all.
  */
  const [pendingDownload, setPendingDownload] = useState<(typeof items)[number] | null>(null);
  const [state, setState] = useState<Record<string, { liked: boolean; saved: boolean; likes: number }>>(() =>
    Object.fromEntries(items.map((w) => [w.id, { liked: !!w.viewerLiked, saved: !!w.viewerSaved, likes: w.likes }])),
  );
  const [comments, setComments] = useState<string | null>(null);
  const [signInPrompt, setSignInPrompt] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  /*
    Drag down to dismiss (owner: "users can drag down to close wallpaper in
    wallpaper reels").

    Armed ONLY at the very top of the scroller. Below that, a downward drag
    already means "go to the previous wallpaper", and a gesture that means two
    things depending on momentum is a gesture nobody can rely on. At scrollTop 0
    there is nothing above to scroll to, so the drag is free — which is exactly
    where every viewer that does this puts it.
  */
  const [dragY, setDragY] = useState(0);
  const dragFrom = useRef<number | null>(null);
  const { isPremium, ready: planReady } = useEntitlements();

  const current = items[index];

  /*
    ── Double-tap to like, the pop-heart, and a liking action that feels alive
       (owner, 2026-08-16: "Let wallpaper liking feel more alive with haptic
       sound and pop animated heart that grows big like Instagram and make
       lively haptic sound. And double tap should like a wallpaper.") ────────

    Same burst recipe `reel-viewer.tsx` uses for its own double-tap-to-like,
    corrected this same session to actually read as Instagram's: a bounce past
    full size, a hold, then a fade — never a drift, because Instagram's heart
    does not float away, it appears where you tapped and stays there while it
    fades. Reused rather than reinvented so every "double-tap to like" gesture
    in the app moves the same way — see the note there for why the OLD,
    still-drifting version was wrong.

    `lastTapRef` is a single ref, not one per wallpaper: only the CENTRED
    wallpaper (`current`) responds to a tap at all (matching the rail buttons,
    which only ever act on `current`), so two taps close together can only be
    a double-tap on the one wallpaper already on screen — nothing between
    items to disambiguate.
  */
  const [bursts, setBursts] = useState<{ id: number; x: number; y: number }[]>([]);
  const lastTapRef = useRef(0);
  const DOUBLE_TAP_WINDOW_MS = 280;

  /*
    Jump to the tapped wallpaper without animating past everything before it.

    Selected by `data-i`, NOT by child position: ad slides are real children of
    this scroller now, so the Nth child stops being the Nth wallpaper as soon as
    one is composed in. Looking the attribute up keeps this correct however the
    slides are interleaved.
  */
  useEffect(() => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-i="${startIndex}"]`);
    el?.scrollIntoView({ block: "start", behavior: "instant" as ScrollBehavior });
  }, [startIndex, adSeeded]);

  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio > 0.6) {
            const el = e.target as HTMLElement;
            /*
              🔴 THE AD SLIDE CARRIES NO WALLPAPER CHROME (owner, 2026-08-30:
              "the ad is bow being covered by the wallpaper template, it doesnt
              suppose to have those like tray, download and all").

              All the chrome — rail, caption, Download, close, counter — is
              drawn ONCE over the whole viewer rather than per slide, so it kept
              painting over the ad: a like button for a wallpaper that was not on
              screen, and a Download button that would have downloaded the
              wallpaper behind it. Tracking whether the ACTIVE slide is the ad is
              what lets the one wrapper step aside for it.
            */
            if (el.dataset.ad !== undefined) {
              setAdActive(true);
              continue;
            }
            /*
              Ad slides carry no `data-i`, so this is `NaN` for them and they
              are skipped — the viewer's notion of "which wallpaper am I on"
              stays in wallpaper-space no matter how many ads are interleaved.
              That is the whole reason the ad slide is identified by its absence
              of an index rather than by a sentinel value.
            */
            const i = Number(el.dataset.i);
            if (!Number.isNaN(i)) {
              setAdActive(false);
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
  }, [items.length, adSeeded]);

  useEffect(() => {
    // Escape unwinds one layer at a time — sheet, then offer, then the viewer.
    // Closing the whole viewer from inside a comment sheet loses the wallpaper
    // as well as the sheet, which is never what the key meant.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (comments) setComments(null);
      else if (upgradeOpen) setUpgradeOpen(false);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflowY;
    document.body.style.overflowY = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflowY = prev;
    };
  }, [onClose, comments, upgradeOpen]);

  const engage = useCallback(
    async (wallpaper: Wallpaper, action: "like" | "unlike" | "save" | "unsave") => {
      if (!canEngage || wallpaper.builtIn) {
        setSignInPrompt(true);
        return;
      }
      /*
        The celebratory direction gets the lively feedback; unliking, saving
        and unsaving stay the same quiet "selection" tick they always were —
        a "more alive" LIKE should not make every tap on this screen buzz
        harder, only the one that means "I like this".
      */
      if (action === "like") {
        haptic("medium");
        playSound("reaction");
      } else {
        haptic("selection");
      }
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

/**
 * A URL the browser can actually fetch from this page.
 *
 * The wallpaper bytes live on storage hosts that reflect CORS for the two
 * production origins only, so a direct `fetch` from a preview deploy — or any
 * origin not on that allowlist — throws, and "Save to device" did nothing at
 * all (owner, twice).
 *
 * This is the identical failure that `/api/media/download` was built to solve
 * for member media; wallpapers simply never routed through it. Same-origin
 * means no preflight, no allowlist to keep in step with every deploy domain,
 * and a real Content-Disposition on the way back.
 *
 * A relative path (the built-in wallpapers ship with the app) is already
 * same-origin and is left alone — proxying it would spend egress for nothing.
 */

  if (!current) return null;

  /** How far down the viewer must travel before letting go closes it. */
  const DISMISS_PX = 110;

  return (
    <div
      data-media-protected
      className="fixed inset-0 z-[100] bg-black"
      onTouchStart={(e) => {
        // Only from the top, and only a single finger — a pinch is a zoom.
        const atTop = (scroller.current?.scrollTop ?? 0) <= 0;
        dragFrom.current = atTop && e.touches.length === 1 ? (e.touches[0]?.clientY ?? null) : null;
      }}
      onTouchMove={(e) => {
        if (dragFrom.current === null) return;
        const dy = (e.touches[0]?.clientY ?? 0) - dragFrom.current;
        // Downward only. An upward drag from the top is a normal scroll and must
        // stay one, or the first flick of every session would feel broken.
        if (dy <= 0) {
          setDragY(0);
          return;
        }
        // Damped, so it tracks the finger without running away and reads as
        // resistance rather than a free fall.
        setDragY(Math.min(dy * 0.6, 260));
      }}
      onTouchEnd={() => {
        dragFrom.current = null;
        setDragY((y) => {
          if (y > DISMISS_PX) {
            haptic("light");
            onClose();
          }
          return 0;
        });
      }}
      style={{
        transform: dragY ? `translateY(${dragY}px) scale(${1 - Math.min(dragY / 2200, 0.06)})` : undefined,
        // No transition WHILE dragging (it must track the finger exactly), one
        // on release so it springs back instead of snapping.
        transition: dragY ? "none" : "transform 220ms var(--ease-out)",
        borderRadius: dragY ? "1.5rem" : undefined,
        overflow: dragY ? "hidden" : undefined,
      }}
    >
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
        {/*
          The SAME slide the reels deck renders — one zone, one look, one place
          to change either.
        */}
        {/*
          The rewarded gate for a wallpaper download. Which network fills it is
          set per moment in Reward networks, so pointing it at Offerium later
          needs no change here.
        */}
        <WallpaperRewardGate
          open={pendingDownload !== null}
          onDone={() => {
            const w = pendingDownload;
            setPendingDownload(null);
            if (w) onDownload(w);
          }}
        />
        {items.map((w, i) => (
          <Fragment key={w.id}>
          <div
            data-i={i}
            className="relative h-[100dvh] w-full snap-start snap-always"
            /*
              Tap the artwork to clear the screen. A `click` — not a touch
              handler — because the browser only fires one when the gesture was
              a tap and NOT a scroll, which is precisely the distinction that
              matters inside a scroll-snap viewer. Rolling our own from
              touchstart/touchend would have to re-derive that, badly.

              Double-tap-to-like rides the SAME click stream: two clicks inside
              the window are a double-tap, restricted to the centred wallpaper
              (see the state comment above). Never un-likes — a second
              double-tap on an already-liked wallpaper is a no-op here exactly
              like Instagram's own, so an enthusiastic visitor tapping several
              times in a row can't toggle the like off by accident.
            */
            onClick={(e) => {
              setUpgradeOpen(false);
              if (w.id !== current?.id) return;
              const now = Date.now();
              if (now - lastTapRef.current < DOUBLE_TAP_WINDOW_MS) {
                lastTapRef.current = 0;
                setBursts((b) => [...b.slice(-4), { id: now + Math.random(), x: e.clientX, y: e.clientY }]);
                if (!state[w.id]?.liked) void engage(w, "like");
              } else {
                lastTapRef.current = now;
              }
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={w.url}
              alt={w.name}
              loading={Math.abs(i - index) <= 1 ? "eager" : "lazy"}
              decoding="async"
              className="h-full w-full object-cover"
            />
            {/* Scrims exist to keep the controls legible over a light image, so
                they leave with the controls — a darkened band over an
                unobstructed wallpaper would be dimming it for no reason. */}
            <div
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-black/50 to-transparent transition-opacity duration-300",
              )}
            />
            <div
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-x-0 bottom-0 h-52 bg-gradient-to-t from-black/70 to-transparent transition-opacity duration-300",
              )}
            />
          </div>
          {/*
            🔴 A REAL SLIDE, not an overlay (owner, 2026-08-30: "scrolling on ad
            on wallpaper page still gets stuck, i dont want users have to click
            on continue to scroll" / "it doesnt go smootly and the next gets
            stuck untill i scroll and scroll and scroll").

            The ad used to be a `fixed inset-0` overlay ON TOP of this scroller.
            An overlay is not part of the scroll container, so the touches that
            should have scrolled the viewer landed on the overlay and moved
            nothing — the deck felt jammed, and the only real way out was a
            button. Adding swipe-to-dismiss on top of that only made a second
            gesture compete with the browser's own scrolling, which is why it
            still stuttered.

            As a genuine `snap-start` child it needs no gesture handling, no
            dismiss control and no escape hatch at all: it scrolls because it is
            a thing in a scroller, with the same momentum and snapping as every
            wallpaper. This is what the reels deck has always done.

            It carries NO `data-i` — that is what keeps it invisible to the
            IntersectionObserver above, so wallpaper indices, view counting and
            the action rail all stay in wallpaper-space. An ad slide is composed
            only when the shared zone has actually answered with a creative, so
            an unconfigured site is unchanged rather than showing a black screen
            every third wallpaper.
          */}
          {adSeeded && (i + 1) % WALLPAPER_AD_EVERY === 0 && i < items.length - 1 ? (
            <div data-ad className="relative h-[100dvh] w-full snap-start snap-always">
              {/*
                🔴 ONLY THE NEARBY AD IS MOUNTED (owner, 2026-08-30: "the
                wallpaper perfomance and scroll is broken").

                This viewer renders EVERY item — 266 of them in the owner's
                library — so composing an ad after every third one mounted ~88
                `ReelsAdSlide`s at once, each an ExoClick unit with its own VAST
                request and its own <video>. That is what broke scrolling.

                The slide itself always renders, so the scroll geometry and the
                snap points never change; only the expensive contents are gated,
                on the same one-slide window `loading="eager"` already uses for
                the artwork above. An ad that is two screens away has nothing to
                play to nobody.
              */}
              {Math.abs(i - index) <= 1 ? <ReelsAdSlide /> : null}
            </div>
          ) : null}
          </Fragment>
        ))}
      </div>

      {/* Double-tap-to-like heart bursts — see the state comment above for why
          this is the same pop-then-hold-then-fade curve reel-viewer.tsx uses. */}
      {bursts.map((b) => (
        <span
          key={b.id}
          aria-hidden
          style={{ position: "fixed", left: b.x, top: b.y - 18, zIndex: 45 }}
          className="pointer-events-none -translate-x-1/2 -translate-y-1/2"
        >
          <motion.span
            initial={{ opacity: 0, scale: 0.3 }}
            animate={{ opacity: [0, 1, 1, 1, 0], scale: [0.3, 1.3, 0.92, 1.06, 1] }}
            transition={{ duration: 0.95, ease: "easeOut", times: [0, 0.28, 0.45, 0.6, 1] }}
            onAnimationComplete={() => setBursts((x) => x.filter((i) => i.id !== b.id))}
            className="block drop-shadow-[0_4px_18px_rgba(0,0,0,0.45)]"
          >
            <Heart className="h-24 w-24 fill-rose-500 text-rose-500" />
          </motion.span>
        </span>
      ))}

      {/*
        One wrapper for ALL the chrome, so immersive mode is a single opacity
        change on a single element rather than a class toggled on nine of them.
        `pointer-events-none` while hidden is what makes the tap-to-restore land
        on the artwork underneath instead of on an invisible button.

        It is also what the AD slide hides behind: every control in here belongs
        to `current`, the wallpaper, so on an ad slide they are all either
        meaningless or actively wrong — a Download button that would download the
        wallpaper you scrolled past. One flag, one wrapper, all of it gone.
      */}
      <div
        className={cn(
          "transition-opacity duration-200 motion-reduce:transition-none",
          adActive && "pointer-events-none opacity-0",
        )}
        aria-hidden={adActive}
      >

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
        Action rail — hard right, and now three buttons instead of four.

        "Save to device" left because it did exactly what the Download button an
        inch below it does; two controls for one action is clutter that also
        makes people wonder which one is right. What remains is glyph-only: a
        heart, a speech bubble and a bookmark need no captions, and dropping them
        took the rail from roughly 260px of the picture to about 150.
      */}
      <div
        className="absolute right-2 z-20 flex flex-col items-center gap-2.5"
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 8.5rem)" }}
      >
        <RailButton
          count={state[current.id]?.likes ?? current.likes}
          active={state[current.id]?.liked}
          onClick={() => void engage(current, state[current.id]?.liked ? "unlike" : "like")}
          aria-label={state[current.id]?.liked ? "Unlike" : "Like"}
        >
          <Heart className={cn("h-5 w-5", state[current.id]?.liked && "fill-rose-500 text-rose-500")} />
        </RailButton>
        <RailButton
          count={current.comments}
          onClick={() => (canEngage ? setComments(current.id) : setSignInPrompt(true))}
          aria-label="Comments"
        >
          <MessageCircle className="h-5 w-5" />
        </RailButton>
        <RailButton
          active={state[current.id]?.saved}
          onClick={() => void engage(current, state[current.id]?.saved ? "unsave" : "save")}
          aria-label={state[current.id]?.saved ? "Remove from saved" : "Save to profile"}
        >
          <Bookmark className={cn("h-5 w-5", state[current.id]?.saved && "fill-white")} />
        </RailButton>
      </div>

      {/* Caption + the one primary action */}
      <div
        className="pointer-events-none absolute inset-x-0 z-10 px-4 text-white"
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 1.25rem)" }}
      >
        <p className="pr-16 text-lg font-bold tracking-tight drop-shadow">{current.name}</p>

        {/* Category, resolution and the upgrade chip share ONE line. The chip is
            what used to be a full card pinned above this — same offer, no
            vertical footprint until someone asks for it. */}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pr-16">
          {/* The sharer's @handle on member uploads, the category on curated
              ones — see `wallpaperCredit`. */}
          <span className="text-sm text-white/70">{wallpaperCredit(current)}</span>
          {(() => {
            const badge = resolutionBadge(current.width, current.height);
            return badge ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/12 px-2.5 py-1 text-[11px] font-bold text-white ring-1 ring-inset ring-white/20 backdrop-blur-md">
                {badge.short}
                <span aria-hidden className="text-white/35">
                  |
                </span>
                <span className="font-semibold text-white/75">{badge.long}</span>
              </span>
            ) : null;
          })()}
          {/* Views appear only once there are some — a fresh wallpaper shows no
              number rather than a "0 views" that reads like nobody cares. */}
          {current.views > 0 ? (
            <span className="text-xs text-white/55">{current.views.toLocaleString()} views</span>
          ) : null}
          {/* Never shown to someone who already pays for it. `planReady` gates
              the render so a Pro member never sees it flash on first paint. */}
          {planReady && !isPremium ? (
            <button
              type="button"
              onClick={() => setUpgradeOpen(true)}
              className="pointer-events-auto inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-amber-400/25 to-amber-200/15 px-2.5 py-1 text-[11px] font-bold text-amber-200 ring-1 ring-inset ring-amber-300/35 backdrop-blur-md transition active:scale-95"
            >
              <Crown className="h-3 w-3" /> Pro
            </button>
          ) : null}
        </div>

        {/* One full-width primary action, as in the reference. */}
        <button
          type="button"
          onClick={() => setPendingDownload(current)}
          className="pointer-events-auto mt-3 flex w-full items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-[#2563FF] to-[#6D5CFF] px-5 py-3.5 text-base font-bold text-white shadow-[0_10px_30px_-10px_rgba(37,99,255,0.9)] ring-1 ring-inset ring-white/20 transition active:scale-[0.98]"
        >
          <Download className="h-5 w-5" />
          Download
          {/* Honest label: downloads are free, and every second one is followed
              by a skippable interstitial — so a member who pays sees the word
              without the ad marker beside it. */}
          <span className="ml-1 inline-flex items-center gap-1 rounded-lg bg-white/15 px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-wide">
            {planReady && !isPremium ? <Sparkles className="h-3 w-3" /> : null}
            Free
          </span>
        </button>
      </div>

      {/* The offer itself — only ever on screen because someone tapped for it. */}
      {upgradeOpen ? <UpgradeSheet onClose={() => setUpgradeOpen(false)} /> : null}
      </div>

      {/* Outside the chrome wrapper: a sheet is a MODE, not chrome. Fading it
          with the rest of the controls would leave a half-transparent,
          untappable comment box over the picture. */}
      {comments ? <CommentSheet wallpaperId={comments} onClose={() => setComments(null)} /> : null}
      {signInPrompt ? <SignInPrompt onClose={() => setSignInPrompt(false)} /> : null}
    </div>
  );
}

/**
 * One rail control. Glyph-only by design — the count rides on the button as a
 * small badge instead of a caption underneath, which is what let the rail lose
 * roughly 40% of its height without losing any information.
 *
 * A zero count renders nothing at all rather than a "0": on a library that is
 * still filling up, a column of zeroes reads as failure, and the absence says
 * the same thing more kindly.
 */
function RailButton({
  children,
  count,
  active,
  onClick,
  ...rest
}: {
  children: React.ReactNode;
  count?: number;
  active?: boolean;
  onClick: () => void;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex h-11 w-11 items-center justify-center rounded-full bg-black/30 text-white ring-1 ring-inset ring-white/15 backdrop-blur-md transition active:scale-90"
      {...rest}
    >
      {children}
      {count !== undefined && count > 0 ? (
        <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-black/65 px-1.5 text-[10px] font-bold leading-4 tabular-nums backdrop-blur-md">
          {count > 999 ? `${Math.floor(count / 1000)}k` : count}
        </span>
      ) : null}
    </button>
  );
}

/**
 * The Pro offer, opened from the crown chip.
 *
 * A bottom sheet rather than the pinned card it replaced. The card was on screen
 * for every wallpaper whether or not anyone was interested, permanently covering
 * a band of the artwork the page exists to display — which is a poor trade even
 * on its own terms, since an offer nobody asked for is also the one nobody
 * reads. This says the same three things to the people who tapped a crown.
 */
function UpgradeSheet({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="absolute inset-0 z-30 flex items-end justify-center bg-black/60 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm animate-in fade-in slide-in-from-bottom-4 rounded-3xl bg-card p-5 shadow-2xl duration-200 motion-reduce:animate-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-400 to-amber-500 text-white shadow-lg shadow-amber-500/25">
            <Crown className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="font-bold">Upgrade to Pro</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              An ad-free experience, unlimited downloads and exclusive premium wallpapers.
            </p>
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onClose} className="btn-lux btn-lux-secondary flex-1 justify-center">
            Not now
          </button>
          <Link href="/pricing" className="btn-lux btn-lux-primary flex-1 justify-center">
            See plans
          </Link>
        </div>
      </div>
    </div>
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
