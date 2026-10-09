"use client";

import NextImage from "next/image";
import { useEffect, useRef, useState } from "react";

import { BACKDROP_QUALITY } from "@/components/wallpapers/backdrop-quality";
import { cn } from "@/lib/utils";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  THE WALLPAPER CTA'S ROTATING BACKDROP
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner brief (2026-08-16): "make the wallpaper in the wallpaper button to
 * change smoothly without breaking any performance or causing overheating on
 * small devices every 2secs and wallpapers that will be changed will be the
 * last 10 wallpapers uploaded in wallpaper pages… immediately the landing has
 * finished opening… it shouldn't obstruct the lcp or break any performance or
 * accessibility rule. Lcp should be below 1.6 secs."
 *
 * ── Why this is a SEPARATE client file, not a `"use client"` at the top of
 *    wallpaper-cta.tsx ─────────────────────────────────────────────────────
 *
 * That file's own history records the exact mistake this avoids: "an earlier
 * version of this row was a client island that warmed the route on idle and
 * pushed the page through the ceiling on its own (budget.test caught it at
 * 303 kB)." Marking the whole card client-side again would cost every
 * caller — including `/downloads`, which doesn't rotate anything — bytes it
 * never asked for. This file is the only thing that hydrates; `WallpaperCta`
 * and `WallpaperCard` stay plain server-rendered links, exactly as before,
 * and reach for this component only when a caller actually passes
 * `rotateUrls`.
 *
 * ── How the FIRST frame stays untouched (the LCP guarantee) ────────────────
 *
 * A `"use client"` component still renders to real HTML on the server — only
 * its hydration is deferred. So index 0 here, rendered unconditionally with
 * `priority` and no gate, produces the identical `<link rel="preload">` and
 * the identical first-paint `<img>` this tile always had. The other nine
 * images do not exist in that HTML at all — they are added to the DOM only
 * from inside a `useEffect`, which cannot run before the browser has already
 * parsed and painted the server HTML. There is no code path in which a
 * visitor's LCP candidate is anything other than exactly what it was before
 * this feature existed.
 *
 * ── "Every 2 seconds, immediately once the landing has finished opening" ───
 *
 * The rotation starts from `useEffect`, which by definition runs AFTER the
 * component has mounted into a painted page — that already IS "once the
 * landing has finished opening," with no extra timer needed to express it. A
 * short additional delay before the OTHER NINE images are even added to the
 * DOM (not before the interval starts — before they exist at all) keeps the
 * decode work for images 2-10 off the same task as the initial paint.
 *
 * ── Why this can't overheat a small device ──────────────────────────────────
 *
 * The only thing that repeats is a `setInterval` doing ONE React state update
 * every 2000ms — nothing here is a per-frame animation, nothing runs on the
 * compositor at 60fps, and there is no `backdrop-blur` or CSS filter in the
 * loop (the two effects flagged elsewhere in this project's own history as
 * the actual cause of "phone gets warm"). The crossfade itself is a plain
 * `opacity` transition, which is compositor-only and does not repeat once
 * settled. The interval is also explicitly PAUSED while the tab is hidden
 * (`document.hidden`) and never started at all under
 * `prefers-reduced-motion: reduce` — both real work avoided, not merely
 * throttled.
 */
export function RotatingWallpaperLayers({ urls, sizes }: { urls: string[]; sizes: string }) {
  const [active, setActive] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const root = useRef<HTMLSpanElement | null>(null);

  /*
    🔴 IT ONLY TURNS WHILE SOMEONE CAN SEE IT (Download page refinement,
    2026-10-09: "pause or suspend nonessential work when the page is hidden …
    minimal CPU/GPU activity").

    The interval used to run from mount to unmount, skipping a tick when the tab
    was hidden but still waking the page every 2 s — and still crossfading, and
    decoding the next photo, while the tile was scrolled far out of view. Now the
    timer exists only while the tile intersects the viewport AND the tab is
    visible; it is cleared, not skipped, the rest of the time.
  */
  useEffect(() => {
    if (urls.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // 2026-10-09 landing speed test (LCP 4.3 s): no second frame is fetched until the page has
    // loaded and the browser is idle, and the rotation never ticks before that frame exists.
    let started = false;
    let idleId: number | null = null;
    let revealTimer: ReturnType<typeof setTimeout> | null = null;
    const start = () => {
      started = true;
      setRevealed(true);
      sync();
    };
    const whenIdle = () => {
      if (typeof window.requestIdleCallback === "function") idleId = window.requestIdleCallback(start, { timeout: 3000 });
      else revealTimer = setTimeout(start, 1500);
    };
    if (document.readyState === "complete") whenIdle();
    else window.addEventListener("load", whenIdle, { once: true });
    let onScreen = true;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const sync = () => {
      const run = started && onScreen && !document.hidden;
      if (run && intervalId === null) intervalId = setInterval(() => setActive((i) => (i + 1) % urls.length), 2000);
      if (!run && intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };
    const io =
      typeof IntersectionObserver === "function" && root.current
        ? new IntersectionObserver(([entry]) => {
            onScreen = !!entry?.isIntersecting;
            sync();
          })
        : null;
    if (io && root.current) io.observe(root.current);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      started = false;
      window.removeEventListener("load", whenIdle);
      if (idleId !== null) window.cancelIdleCallback?.(idleId);
      if (revealTimer) clearTimeout(revealTimer);
      if (intervalId !== null) clearInterval(intervalId);
      io?.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [urls.length]);

  /*
    Only three frames are ever mounted — the one fading out, the one showing and
    the one coming next (so it is fetched and decoded before its turn). All ten
    used to stay in the DOM, which kept ten decoded photos in memory for a tile
    that shows one. A frame that comes round again is in the HTTP cache already.
  */
  const n = urls.length;
  const keep = (i: number) => (revealed ? i === active || i === (active + 1) % n || i === (active - 1 + n) % n : i === 0);

  return (
    <span ref={root} aria-hidden className="pointer-events-none absolute inset-0">
      {urls.map((url, i) => {
        if (!keep(i)) return null;
        return (
          <NextImage
            key={url}
            src={url}
            alt=""
            fill
            sizes={sizes}
            priority={i === 0}
            loading={i === 0 ? undefined : "lazy"}
            /*
              🔴 Index 0 IS the landing page's LCP element — this component's
              whole design is that its first frame is byte-identical to the
              static `WallpaperBackdrop` it replaces. That guarantee now
              includes the quality: leaving it at the default here would have
              left the LCP path on the 186 kB variant while the non-rotating
              caller got the 42 kB one, which is the "you fixed the branch the
              owner does not hit" failure. Measurement and reasoning live on
              `BACKDROP_QUALITY` in backdrop-quality.ts; the value is imported
              rather than repeated so the two cannot drift apart.

              It applies to all ten frames, not just the first. Nine of them are
              decode work on a phone every 2 seconds, and none is ever the LCP.
            */
            quality={BACKDROP_QUALITY}
            className={cn(
              "pointer-events-none select-none object-cover transition-opacity duration-700 ease-out motion-reduce:transition-none",
              i === active ? "opacity-100" : "opacity-0",
            )}
          />
        );
      })}
    </span>
  );
}
