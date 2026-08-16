"use client";

import NextImage from "next/image";
import { useEffect, useState } from "react";

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
  // The other nine images are added to the DOM only after this flips —
  // never before mount, so they can never be an LCP candidate.
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (urls.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const revealTimer = setTimeout(() => setRevealed(true), 50);
    const intervalId = setInterval(() => {
      // Paused, not merely slowed, while backgrounded — a tab nobody is
      // looking at has no reason to keep decoding new images.
      if (document.hidden) return;
      setActive((i) => (i + 1) % urls.length);
    }, 2000);

    return () => {
      clearTimeout(revealTimer);
      clearInterval(intervalId);
    };
  }, [urls.length]);

  return (
    <>
      {urls.map((url, i) => {
        if (i > 0 && !revealed) return null;
        return (
          <NextImage
            key={url}
            src={url}
            alt=""
            fill
            sizes={sizes}
            priority={i === 0}
            loading={i === 0 ? undefined : "lazy"}
            className={cn(
              "pointer-events-none select-none object-cover transition-opacity duration-700 ease-out motion-reduce:transition-none",
              i === active ? "opacity-100" : "opacity-0",
            )}
          />
        );
      })}
    </>
  );
}
