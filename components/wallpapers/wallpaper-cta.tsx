import { ArrowRight, Image as ImageIcon, Microscope } from "lucide-react";
import NextImage from "next/image";
import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * The admin wallpaper, as an optimized <img> behind the content.
 *
 * ── 🔴 This tile is the LANDING PAGE'S LCP ELEMENT (measured, 2026-08-10) ─────
 *
 * Not a guess and not the same answer as last time. Running a
 * `largest-contentful-paint` PerformanceObserver against the live page under
 * Lighthouse's own mobile throttling (4x CPU, 1.6 Mbps) reports exactly two
 * candidates: the hero paragraph at 5416ms (22508px²), then THIS anchor at
 * 7960ms (27224px²). The card is bigger than the paragraph, so the moment its
 * background finishes decoding it takes over as the largest paint — and the
 * time it takes to arrive IS the reported LCP.
 *
 * The previous fix (a35cc7f) named the phone-mockup poster instead. That was
 * wrong for a structural reason worth writing down: the mockup is the SECOND
 * grid column, so on a phone it renders after the entire left-hand stack — a
 * long way below the fold, where LCP does not look. It was never a candidate.
 *
 * ── Why a CSS background could not be made fast ──────────────────────────────
 *
 * Two faults, and neither is fixable while it stays a background:
 *
 *  • BYTES. It was the Supabase ORIGINAL — measured at 111 KB of JPEG for a
 *    tile that renders about 170px wide. A background cannot go through the
 *    image optimizer, so there was no size to serve but the full one.
 *
 *  • CACHING. Supabase storage answers that object with `Cache-Control:
 *    no-cache` (verified with curl), so every visitor re-fetched all 111 KB on
 *    every visit. Routing it through `next/image` re-serves it from Next's own
 *    image cache with a 31-day immutable TTL (`minimumCacheTTL` in
 *    next.config.ts), which fixes repeat views as well as first ones.
 *
 * `priority` emits the preload, so the fetch starts from the HTML rather than
 * after the stylesheet parses and the element lays out — which is the extra
 * few hundred milliseconds a background costs by construction. The manual
 * `<link rel="preload" fetchPriority="low">` that used to sit in hero.tsx is
 * removed with this: it was preloading the LCP element at LOW priority.
 *
 * ── Why this does not repeat the "positioned layer covers the text" bug ──────
 *
 * It is the FIRST child, painted below the scrim, and every content node in
 * both variants already carries `relative z-[1]` for exactly this reason. The
 * gradient stays on the element itself as the no-image fallback, so a failed
 * or absent wallpaper still renders the branded tile.
 *
 * `next/image` is safe here specifically because this is a Supabase public URL
 * (the same origin the phone mockup already optimizes). The recorded 403s are
 * on SOURCE CDNs — yt-dlp-resolved thumbnails whose signatures expire — which
 * never reach this component.
 */
function WallpaperBackdrop({ url, sizes }: { url: string; sizes: string }) {
  return (
    <NextImage
      src={url}
      alt=""
      fill
      sizes={sizes}
      priority
      /*
        🔴 `object-cover` — RESTORED (owner, 2026-08-10).

        I briefly changed this to `object-contain` and it was the wrong reading of
        "show the full image". The clarification: "they should FILL THE WHOLE
        SPACE but not zoom, they could shrink, but not zoom."

        `contain` letterboxed the tile — the brand gradient showed as bands above
        and below the wallpaper, which is the opposite of filling the space.

        `cover` is not a zoom. It is the smallest scale that fills the box, and
        since admin wallpapers are far larger than this tile it always SHRINKS
        them to fit — exactly "could shrink, but not zoom". It never magnifies
        beyond what filling requires.
      */
      className="pointer-events-none select-none object-cover"
    />
  );
}

/**
 * The "Wallpaper Gallery" entry tile — landing hero and the signed-in downloads
 * dashboard.
 *
 * ── One component, because there were two copies (2026-08-09) ────────────────
 * The same ~30 lines of markup lived in `components/landing/hero.tsx` and in
 * `features/downloads/downloads-page.tsx`, with the second added later as a
 * deliberate copy of the first. Two copies of a styled CTA is how "I changed the
 * button and it still looks the same" happens — you change the branch the owner
 * is not looking at. Collapsed to one.
 *
 * ── Filled, not outlined (owner, 2026-08-09) ─────────────────────────────────
 * "make the wallpaper button in the landing page and download page to be more
 * visible with a more visible premium color."
 *
 * It was a white card with a violet icon, sitting directly beneath a white
 * "Explore Features" card on the landing and a white paste box on the dashboard
 * — so the one row meant to advertise a whole feature read as the least
 * important thing on screen. It is now a filled violet→fuchsia gradient with
 * white type and a coloured glow.
 *
 * Violet/fuchsia rather than the brand blue ON PURPOSE. The primary action on
 * both surfaces is the blue Download CTA; painting this the same blue would make
 * two competing primaries and cost the download button its emphasis. A different
 * premium hue reads as "the other thing you can do here", which is what it is.
 *
 * ── Zero client JavaScript ───────────────────────────────────────────────────
 * A plain server-rendered `Link`. The landing page has no headroom in its
 * cold-entry budget — an earlier version of this row was a client island that
 * warmed the route on idle and pushed the page through the ceiling on its own
 * (budget.test caught it at 303 kB). The dwell flourish, the sheen and the
 * "View" cue are all CSS (`.frenz-wp-*` in globals.css) on a 2s delay, and
 * `prefetch` plus `/wallpapers`'s own `loading.tsx` is what makes the tap
 * instant. Nothing here hydrates. Keep it that way.
 */
/**
 * The scrim that sits between the wallpaper and the words.
 *
 * ── Why a scrim and not just a darker image ─────────────────────────────────
 * Owner, 2026-08-09: the background must "show the texts and icon clearly". The
 * admin can pick ANY wallpaper — a bright beach, a white marble, a pale sky —
 * and white text on a light photo is unreadable. Nothing about the chosen image
 * can be relied upon, so legibility has to come from a layer WE control.
 *
 * It is deliberately two stops darker than looks necessary on a mid-tone photo,
 * because the failure is asymmetric: a slightly-too-dark scrim costs a little
 * of the picture, while a slightly-too-light one costs the label entirely.
 *
 * The brand gradient stays underneath at reduced opacity so the tile still reads
 * as the Wallpaper Gallery button rather than as an arbitrary photo, and so the
 * no-image case and the image case are recognisably the same control.
 */
/*
  ── NEUTRAL, and only where the words are (owner, 2026-08-09) ────────────────
  "the wallpaper button should show the image clearly without blending it with
  purple."

  The first version was a violet→fuchsia wash at 70-85% opacity. That reads the
  brief backwards: it guaranteed legibility by hiding the photo, and it tinted
  whatever the admin uploaded into the same purple rectangle it replaced — so
  choosing an image changed almost nothing.

  Two changes fix it:

  • BLACK, not violet. A neutral scrim darkens without recolouring, so a green
    landscape stays green. The brand colour is still there — it is the fallback
    gradient underneath, which is what shows when no image is set.

  • A GRADIENT, not a flat fill, weighted toward the text. Most of the image is
    barely touched; the darkening concentrates where the label actually sits.
    Legibility is a local problem and it deserves a local answer.

  Each variant gets its own direction because the text sits in a different
  place: bottom-anchored on the card, left-to-right across the row.
*/
/*
  🔴 The card scrim is SHORTER and lighter than it was (owner, 2026-08-10:
  "give more space for the background image").

  It was `from-black/85 via-black/35 to-black/5` across the WHOLE tile, so even
  the top of the picture was veiled to protect a subtitle that no longer exists.
  With one line of title left, the darkening only has to cover the bottom third —
  `via-transparent` at the midpoint means the upper two thirds of the artwork are
  now completely untouched.

  The floor stays deliberately dark (`from-black/80`) at the very bottom: the
  admin can pick ANY wallpaper, including a white one, and the title is white.
  Legibility still cannot depend on the picture — that reasoning is unchanged,
  it just applies to a much smaller band now.
*/
const SCRIM_CARD = "absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent";
const SCRIM_ROW = "absolute inset-0 bg-gradient-to-r from-black/80 via-black/55 to-black/25";

export function WallpaperCta({
  className,
  /**
   * The admin's chosen wallpaper, resolved server-side by `getCtaWallpaper`.
   *
   * Passed IN rather than fetched here: this component renders inside
   * `downloads-page.tsx`, which is `"use client"`, so it cannot do a database
   * read of its own. Every caller resolves it at a server boundary and hands it
   * down — which also keeps the landing page's read on the ISR path instead of
   * making the tile dynamic.
   */
  backgroundUrl,
  /**
   * `row` — the full-width row used on the downloads dashboard.
   * `card` — the tall two-column tile from `public/landing hero section.jpg`:
   *          icon tile top-left, VIEW pill top-right, title and sub stacked
   *          below, circular arrow bottom-right.
   *
   * Same component either way, so the icon, the dwell flourish, the sheen and
   * the VIEW cue cannot drift between the two surfaces — which is exactly what
   * happened when this markup existed twice.
   */
  variant = "row",
}: {
  className?: string;
  backgroundUrl?: string | null;
  variant?: "row" | "card";
}) {
  if (variant === "card") return <WallpaperCard className={className} backgroundUrl={backgroundUrl} />;
  return (
    <Link
      href="/wallpapers"
      prefetch
      /*
        ── The colour is the element's OWN BACKGROUND ─────────────────────────
        Owner, 2026-08-09: "the colours are spilling at the edge, make the
        colour to have zero border radius." Then, after the first attempt: the
        button rendered with no text at all.

        Both symptoms, and why this shape is the right one:

        1. THE SPILL. There were two sources, and neither was the background.
           An outer bloom at `-inset-1` with `rounded-3xl` sat behind a
           `rounded-2xl` button — a BIGGER box with a BIGGER radius, so its
           corners bulged past the button's own. And `shadow-violet-500/30`
           throws colour in every direction by definition; a shadow is never
           clipped by a border radius. Both are gone.

        2. THE MISSING TEXT — my own regression. Moving the gradient into an
           `absolute inset-0` CHILD made it a POSITIONED element, and positioned
           elements paint above static siblings. So the colour layer covered the
           title and the subtitle. (The icon and the "VIEW" cue survived only
           because their CSS animations apply a transform, which promotes them.)

        A `background-image` on the element itself has neither problem: a
        background is always painted behind its own content, and it is clipped
        by `border-radius` for free. There is no layer to disagree about the
        shape and nothing to paint over the words.
      */
      className={cn(
        "frenz-wp group relative flex w-full items-center gap-4 overflow-hidden rounded-2xl px-4 py-3.5 text-left",
        "bg-gradient-to-r from-violet-600 via-purple-600 to-fuchsia-600 text-white",
        "ring-1 ring-inset ring-white/15 shadow-md",
        "transition duration-200 hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.995]",
        className,
      )}
    >
      {/* The wallpaper itself, optimized and preloaded — see WallpaperBackdrop.
          The gradient above stays as the fallback: with no admin selection the
          button is exactly what it was. */}
      {backgroundUrl ? (
        <WallpaperBackdrop url={backgroundUrl} sizes="(min-width: 1024px) 640px, 100vw" />
      ) : null}
      {/* Legibility layer — see the SCRIM notes. Only when there is a photo to darken. */}
      {backgroundUrl ? <span aria-hidden className={cn(SCRIM_ROW, "pointer-events-none")} /> : null}
      <span className="frenz-wp-icon relative z-[1] flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/20 text-white ring-1 ring-inset ring-white/25 backdrop-blur-sm">
        <ImageIcon className="relative h-5 w-5" />
        <span
          aria-hidden
          className="frenz-wp-sheen pointer-events-none absolute inset-y-0 -left-full w-1/2 bg-gradient-to-r from-transparent via-white/70 to-transparent"
        />
      </span>
      {/*
        🔴 `relative z-[1]` on every content node, because the scrim above is a
        POSITIONED element and positioned elements paint over static siblings.
        Without this the photo's darkening layer covers the words — which is
        exactly the regression that shipped when the gradient was briefly moved
        into an `absolute inset-0` child.
      */}
      <span className="relative z-[1] min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-base font-bold leading-tight text-white drop-shadow-sm">Wallpaper Gallery</span>
          {/*
            The dwell cue (owner, 2026-08-09: "when a user stays at the button
            section for 2 secs, the wallpaper icon should animate premium
            attractive, writing a small text that says view with a microscope").

            A real label for what the tile does, not decoration — so
            `prefers-reduced-motion` keeps the words and drops only the movement.
          */}
          <span className="frenz-wp-cue inline-flex items-center gap-1 rounded-full bg-white/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-white ring-1 ring-inset ring-white/30">
            <Microscope className="h-3 w-3" />
            View
          </span>
        </span>
        <span className="mt-0.5 block text-xs text-white/85 drop-shadow-sm">Stunning quality, updated daily</span>
      </span>
      <ArrowRight className="relative z-[1] h-5 w-5 shrink-0 text-white/90 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

/**
 * The tall two-column tile from `public/landing hero section.jpg`.
 *
 * Same content and the SAME animations as the row — icon tile, dwell flourish,
 * sheen, VIEW cue — rearranged into the reference's shape: icon top-left, VIEW
 * top-right, title and sub-line stacked, a circular arrow bottom-right.
 *
 * The gradient is again the element's own background, for the reason recorded
 * on the row above: a positioned colour layer paints over its own text, and a
 * background is clipped by `border-radius` for free.
 */
function WallpaperCard({ className, backgroundUrl }: { className?: string; backgroundUrl?: string | null }) {
  return (
    <Link
      href="/wallpapers"
      prefetch
      className={cn(
        "frenz-wp group relative flex min-h-[11rem] flex-col overflow-hidden rounded-3xl p-4 text-left",
        "bg-gradient-to-br from-violet-600 via-purple-600 to-fuchsia-600 text-white",
        "ring-1 ring-inset ring-white/15 shadow-md",
        "transition duration-200 hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.995]",
        className,
      )}
    >
      {/* 🔴 The landing page's LCP element — see WallpaperBackdrop for the
          measurement and for why this stopped being a CSS background. */}
      {backgroundUrl ? (
        <WallpaperBackdrop url={backgroundUrl} sizes="(min-width: 1024px) 300px, 50vw" />
      ) : null}
      {backgroundUrl ? <span aria-hidden className={cn(SCRIM_CARD, "pointer-events-none")} /> : null}
      {/*
        ── ONE badge, not two (owner, 2026-08-10) ──────────────────────────────
        "make the wallpaper button less cluster like in the design."

        The clutter was structural, not stylistic: this card carried a 48px
        icon tile in the top-left AND a View pill in the top-right, so a
        160px-wide tile spent its entire top row on two competing badges before
        the title had any room. `public/landingnew.jpg` has one — the pill —
        and the artwork does the rest of the talking, which is the right call
        for a tile whose whole subject is a picture.

        🔴 The animations are NOT lost with the tile (owner, earlier: "don't
        remove the existing wallpaper button icon and design animation"). They
        move onto the pill's glyph: `frenz-wp-icon` is the 2s flourish and
        `frenz-wp-sheen` the highlight sweep. They sit on a span INSIDE the
        pill rather than on the pill itself because `frenz-wp-cue` is already
        an `animation` on that element, and an element has only one animation
        property — putting a second class there would silently cancel the
        reveal.

        🔴 z-[1] on the content: the scrim is positioned and would otherwise
        paint over it.
      */}
      <span className="relative z-[1] flex items-start justify-end gap-2">
        <span className="frenz-wp-cue inline-flex items-center gap-1.5 rounded-full bg-black/35 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-white ring-1 ring-inset ring-white/30 backdrop-blur-sm">
          <span className="frenz-wp-icon relative flex h-3.5 w-3.5 items-center justify-center overflow-hidden rounded-[4px]">
            <Microscope className="h-3 w-3" />
            <span
              aria-hidden
              className="frenz-wp-sheen pointer-events-none absolute inset-y-0 -left-full w-1/2 bg-gradient-to-r from-transparent via-white/80 to-transparent"
            />
          </span>
          View
        </span>
      </span>

      {/*
        ── Less text, more picture (owner, 2026-08-10) ────────────────────────
        "make the wallpaper button on the landing page to be less cluster in text
        and give more space for the background image."

        The subtitle is GONE. "Stunning quality, updated daily." was two lines of
        the card's four, and it says nothing the tile does not already show — the
        artwork behind it IS the argument for tapping. On a tile whose whole
        subject is a picture, a sentence describing the picture is the clutter.

        The title also drops to one line by shortening to "Wallpapers": at this
        width "Wallpaper Gallery" wrapped, which is what made the bottom of the
        card a four-line text block sitting on the image.

        Net effect is roughly half the card handed back to the artwork, which is
        what was asked for. The scrim shrinks to match — see SCRIM_CARD.
      */}
      <span className="relative z-[1] mt-auto flex items-end justify-between gap-3 pt-4">
        <span className="min-w-0">
          <span className="block text-base font-bold leading-tight text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)]">
            Wallpapers
          </span>
        </span>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20 ring-1 ring-inset ring-white/25 transition group-hover:bg-white/30">
          <ArrowRight className="h-4 w-4 text-white transition-transform group-hover:translate-x-0.5" />
        </span>
      </span>
    </Link>
  );
}
