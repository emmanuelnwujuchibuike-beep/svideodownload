"use client";

import { X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { isPersistentZone, sizeFromScript } from "@/lib/monetization/ad-schema";
import type { AdTiming } from "@/lib/monetization/ad-timing";
import { cn } from "@/lib/utils";
import type { AdSlotData, AdZone } from "@/lib/monetization/types";

import { loadZoneAd } from "./ad-cache";
import { AdSenseUnit } from "./adsense-unit";
import { ExoClickUnit } from "./exoclick-unit";
import { injectAdMarkup } from "./inject";

function beacon(kind: "impression" | "click", zone: string, adId: string) {
  navigator.sendBeacon?.(
    "/api/track",
    new Blob([JSON.stringify({ kind, zone, adId })], { type: "application/json" }),
  );
}

/**
 * Will this ad row actually paint a visible box?
 *
 * ── The bug this fixes (owner, 2026-08-09) ───────────────────────────────────
 * "the hero section in the landing and download page turns pure black when I
 * click on download, especially a multiple download."
 *
 * `onResolved` used to report `Boolean(found)` — whether a ROW EXISTS. But the
 * render below returns `null` for several rows that do exist, and `pop` renders
 * `display: contents`, which is deliberately invisible. So a slot could answer
 * "yes, I have an ad" and then paint nothing at all.
 *
 * `FullscreenInterstitial` believes that answer literally: `shown = open &&
 * hasAd === true` puts up an **opaque full-screen `bg-black`** and waits for the
 * creative. With an invisible one it is a pure black screen over the whole page.
 * The every-3rd-download trigger is why a BATCH surfaces it — several
 * completions in a row walk the counter onto a multiple of three.
 *
 * The predicate below mirrors the render branches exactly. Keep them in step: a
 * new format needs a case here AND a branch there, and the test file asserts
 * they agree.
 *
 * `adsense` is excluded on purpose — a configured AdSense unit may still return
 * no creative (unapproved account, no demand) and collapse to nothing, so only
 * the unit itself can answer. That comes back later through `onFill`.
 */
function rendersVisibly(ad: AdSlotData | null): boolean {
  if (!ad) return false;
  switch (ad.format) {
    case "native":
      return !!ad.targetUrl;
    case "display":
      return !!ad.scriptCode;
    case "adsense":
      return !!ad.adClient && !!ad.adSlotId;
    /*
      Excluded for the same reason as `adsense` directly above: a configured
      ExoClick zone is not a filled one — the network returns nothing when it
      has no demand for the visitor's geo/device and the `<ins>` stays empty.
      Only the unit itself can answer, and it does, through `onFill` below.
    */
    case "exoclick":
      return false;
    /*
      `pop` and `video` are REAL ads that paint no box of their own: a pop binds
      a handler for the next interaction (`display: contents`), and a video is
      played by the placement that owns a player, not by this component. Both
      must report "nothing to frame", or every wrapper that reserves space for a
      creative reserves it around emptiness.
    */
    case "pop":
    case "video":
      return false;
    default:
      return false;
  }
}

/**
 * Async, non-blocking ad slot. Premium users get nothing. Rendering depends on
 * the ad's format:
 *  - "native"  → declarative house card (we track the click)
 *  - "display" → network banner rendered inside an isolated <iframe srcdoc> so
 *                even `document.write` codes (classic Adsterra/PropellerAds
 *                banners) work without wiping the page
 *  - "adsense" → a real `<ins class="adsbygoogle">` in the top-level document,
 *                which is the only place AdSense may run
 *  - "video"   → handled by the placements that own a player; this component
 *                renders nothing for it
 *
 *  - "pop"     → a self-injecting script, run in the page rather than in the
 *                display iframe
 *
 * ── About the pop format ──────────────────────────────────────────────────────
 *
 * Pop-under and OnClick creatives bind a handler that opens a window on the
 * visitor's next interaction, which a sandboxed frame cannot do — that is why
 * pasting one into a `display` placement yields a blank box that earns nothing.
 *
 * It was removed once on the instruction to drop click-hijacking formats, and
 * restored on the later instruction to bring it back. Both were deliberate, so
 * neither direction is a bug to be "fixed" in passing. What is not restored is
 * running one unknowingly: the `popunder` switch defaults to OFF and gates this
 * server-side.
 */
export function AdSlot({
  zone,
  className,
  dismissible = true,
  fullBleed = false,
  onResolved,
  onAdTiming,
}: {
  zone: AdZone;
  className?: string;
  dismissible?: boolean;
  /**
   * The placement owns a full-bleed surface and the unit should use all of it.
   *
   * Set by the Reels slide, which is a whole 9:16 screen. Only the ExoClick
   * branch honours it today — the other formats come at fixed creative sizes
   * that stretching would only blur — so it is deliberately a hint rather than a
   * contract, and defaults to the constrained in-page treatment.
   */
  fullBleed?: boolean;
  /**
   * Called once with whether this zone actually had an ad to show.
   *
   * Exists because a slot that renders nothing is invisible to its PARENT, and
   * several parents draw chrome around it — a "Sponsored" label, a border, a
   * close button, a reserved height. Those wrappers rendered unconditionally
   * and produced a decorated empty box whenever a zone was unseeded, which is
   * the "empty white space" this component was reported for. The slot is the
   * only thing that knows, so it has to be the thing that says.
   */
  onResolved?: (hasAd: boolean) => void;
  /**
   * The creative's own duration and end, forwarded from the player.
   *
   * Only the ExoClick (video) branch can report it — the other formats have no
   * timeline to report. A gate that receives nothing falls back to its admin
   * number, which is exactly the intended behaviour for a display creative.
   * See `lib/monetization/ad-timing.ts`.
   */
  onAdTiming?: (timing: AdTiming) => void;
}) {
  const [ad, setAd] = useState<AdSlotData | null>(null);
  const [closed, setClosed] = useState(false);
  const tracked = useRef(false);
  const notified = useRef(false);

  useEffect(() => {
    let alive = true;
    /*
      Batched and memoised — see `ad-cache.ts`. Every placement on the page
      resolves from ONE request instead of one each, which is most of why ads
      used to arrive after the visitor had already finished and left.
    */
    loadZoneAd(zone)
      .then((found) => {
        if (!alive) return;
        setAd(found);
        /*
          Fires for the empty case too — that is the case wrappers need. Guarded
          so a re-render cannot re-notify a parent that has already collapsed.

          AdSense is the exception and answers later. A configured AdSense row
          is not a visible ad: an unapproved account or simply no demand returns
          no creative and the unit collapses to nothing, which would leave the
          parent's card and "Sponsored" label wrapped around empty space. For
          that format the answer comes from `data-ad-status` via `onFill` below.

          ExoClick is the same shape and is excluded for the same reason — its
          `<ins>` is filled asynchronously or not at all, so `ExoClickUnit`
          watches the element and reports through the same `onFill` seam.
        */
        if (!notified.current && found?.format !== "adsense" && found?.format !== "exoclick") {
          notified.current = true;
          /*
            Whether it will PAINT, not whether a row was found — see
            `rendersVisibly`. Reporting mere existence is what let an invisible
            creative raise a full-screen black interstitial over the page.
          */
          onResolved?.(rendersVisibly(found));
        }
      })
      .catch(() => {
        // A failed request is indistinguishable from an unseeded zone as far as
        // the wrapper is concerned: there is nothing to show, so do not frame it.
        if (!alive || notified.current) return;
        notified.current = true;
        onResolved?.(false);
      });
    return () => {
      alive = false;
    };
    // `onResolved` deliberately omitted: an inline arrow from the parent would
    // change identity every render and re-run the fetch on a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zone]);

  /*
    An impression is counted when the slot is SEEN, not when its data arrives.

    ── What this was measuring before (owner audit, 2026-08-09) ──────────────
    The beacon fired as soon as `loadZoneAd` resolved, which happens for every
    placement on the page during hydration — including the ones far below the
    fold that the visitor never scrolls to. So "ad impressions" was really "ad
    slots rendered", and since estimated revenue is `impressions / 1000 × CPM`,
    every revenue figure on the dashboard inherited that inflation. It also made
    CTR structurally too low, because the clicks were real while the
    denominator was not.

    ── The rule ──────────────────────────────────────────────────────────────
    50% of the slot visible for one continuous second — the IAB Display standard,
    and what every ad network reconciles against. Matching it means our number
    can be compared to the network's instead of merely disagreeing with it.

    A tab in the background does not accrue: `IntersectionObserver` reports a
    hidden tab's elements as intersecting, so the timer is also gated on
    `visibilityState`. Counted at most once per slot, and the observer
    disconnects the moment it fires.

    Where there is no IntersectionObserver, the impression is counted on load as
    before. Under-reporting a real impression costs revenue we earned; the old
    behaviour is the safer fallback for the handful of browsers that need it.
  */
  const hostRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ad || tracked.current) return;

    const fire = () => {
      if (tracked.current) return;
      tracked.current = true;
      beacon("impression", zone, ad.id);
    };

    /*
      A `pop` creative has NO visible box — it renders `display: contents` and
      binds a handler for the next interaction. There is nothing to be 50%
      visible, so viewability does not apply and it counts on load.
    */
    const host = hostRef.current;
    if (ad.format === "pop" || !host || typeof IntersectionObserver === "undefined") {
      fire();
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    const stop = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        const visible = !!entry?.isIntersecting && document.visibilityState === "visible";
        if (visible && !timer) {
          timer = setTimeout(() => {
            fire();
            observer.disconnect();
          }, 1000);
        } else if (!visible) {
          stop();
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(host);
    const onVisibility = () => {
      if (document.visibilityState !== "visible") stop();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ad, zone]);

  if (!ad || closed) return null;

  /*
    Furniture is never dismissible, regardless of what the caller passed.

    The bottom banner, the under-download unit and the homepage strip are part of
    the page's layout — the SofaScore model, where the ad occupies a designed
    slot rather than floating over the content with an X in the corner. A close
    button on those reads as an interruption to be dismissed, which is precisely
    the impression the placement is designed to avoid.

    Decided from the ZONE rather than from the call site because it is a property
    of the placement, and leaving it to each caller is how the two that matter
    most end up inconsistent.
  */
  const canDismiss = dismissible && !isPersistentZone(zone);

  const closeBtn = canDismiss ? (
    <button
      type="button"
      onClick={() => setClosed(true)}
      aria-label="Close ad"
      className="absolute -right-2 -top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow transition hover:text-foreground"
    >
      <X className="h-3.5 w-3.5" />
    </button>
  ) : null;

  // Native / house ad.
  if (ad.format === "native" && ad.targetUrl) {
    return (
      <div ref={hostRef} className={cn("relative", className)}>
        {closeBtn}
        <a
          href={ad.targetUrl}
          target="_blank"
          rel="nofollow sponsored noopener"
          onClick={() => beacon("click", zone, ad.id)}
          className="block overflow-hidden rounded-2xl border border-border bg-card transition hover:border-foreground/20"
        >
          {ad.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={ad.imageUrl} alt="" className="h-32 w-full object-cover" />
          ) : null}
          <div className="flex items-center justify-between gap-2 p-3">
            <span className="text-sm font-medium">{ad.headline ?? "Sponsored"}</span>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
              Ad
            </span>
          </div>
        </a>
      </div>
    );
  }

  // Display banner inside an isolated iframe (handles document.write embeds).
  if (ad.format === "display" && ad.scriptCode) {
    /*
      Sized to the AD, not to a default.

      Width and height used to fall back to 300×250 whenever the row left them
      blank, so a 468×60 leaderboard was rendered into a 300×250 box — cropped
      horizontally and floating in dead space vertically. The frame now takes
      the row's declared size when it has one, and otherwise fills the width it
      is given, which is what every responsive network tag expects.

      The height still needs a number: an iframe has no intrinsic height and
      collapses to zero without one, and a cross-origin frame cannot be measured
      to find out. So an unsized row gets a modest default rather than a tall
      one — too short shows a scroll-free partial banner, too tall shows a band
      of blank inside the card.
    */
    /*
      Explicit columns win; otherwise the size is read out of the embed's own
      `atOptions` block, which declares it. Every banner seeded on this site
      left the columns null while the script said 300×250 or 468×60 — so the
      frame had nothing to use and cropped the ad.
    */
    const declared = sizeFromScript(ad.scriptCode);
    const width = ad.width ?? declared?.width ?? null;
    const height = ad.height ?? declared?.height ?? null;

    const hasSize = typeof width === "number" && width > 0;
    const w = hasSize ? width : undefined;
    const h = height ?? 100;
    const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;overflow:hidden}</style></head><body>${ad.scriptCode}</body></html>`;
    return (
      <div className={cn("flex justify-center", className)}>
        <DisplayFrame hostRef={hostRef} srcDoc={srcDoc} width={w} height={h}>
          {closeBtn}
        </DisplayFrame>
      </div>
    );
  }

  // AdSense — must run in the top-level document, never in the display iframe.
  if (ad.format === "adsense" && ad.adClient && ad.adSlotId) {
    return (
      <div ref={hostRef} className={cn("relative flex justify-center", className)}>
        {closeBtn}
        <AdSenseUnit
          client={ad.adClient}
          slotId={ad.adSlotId}
          /*
            🔴 A full-bleed slot forces a RESPONSIVE unit (owner, 2026-08-30:
            "make adsense video ad to be able to work and fit in the slot when i
            want to switch").

            These placements are shaped for a creative that spans the column. An
            AdSense row carrying a fixed `width`/`height` — or a layout like
            `rectangle` — would render a 300x250 island in the middle of a slot
            built for something full-width, which is the mismatch that makes a
            network switch look broken.

            `auto` is AdSense's own responsive mode and the fixed dimensions are
            dropped, so the unit sizes itself to the slot exactly as the ExoClick
            video does. Non-full-bleed placements are untouched: there a declared
            size is the operator's deliberate choice.
          */
          layout={fullBleed ? "auto" : ad.adLayout}
          width={fullBleed ? null : ad.width}
          height={fullBleed ? null : ad.height}
          className="w-full"
          /* The real answer for this format — see the fetch above. */
          onFill={(filled) => {
            if (notified.current) return;
            notified.current = true;
            onResolved?.(filled);
          }}
        />
      </div>
    );
  }

  /*
    ExoClick — a VIDEO zone, played from its VAST response.

    The zone id is NOT passed down: `ExoClickUnit` asks `/api/ads/exoclick` for
    this zone by name, and the server resolves the id, fetches the VAST document
    (which has no CORS header, so the browser cannot) and returns a playable
    creative. Passing the id to the client would also make the endpoint an open
    relay for arbitrary ExoClick inventory.

    Server-gated by the `exoclick` switch and this zone's own switch, both off by
    default, so reaching this branch means an operator deliberately opted in.
  */
  if (ad.format === "exoclick" && ad.adSlotId) {
    return (
      <div ref={hostRef} className={cn("relative flex justify-center", className)}>
        {closeBtn}
        <ExoClickUnit
          zone={zone}
          fill={fullBleed}
          className="w-full"
          onAdTiming={onAdTiming}
          /* The real answer for this format — see the fetch above. */
          onFill={(filled) => {
            if (notified.current) return;
            notified.current = true;
            onResolved?.(filled);
          }}
        />
      </div>
    );
  }

  /*
    `pop` — a self-injecting script, executed in the page rather than in the
    display iframe.

    It has to run at document level: pop-under and OnClick creatives work by
    binding a handler that opens a window on the visitor's next interaction, and
    a sandboxed frame cannot do that (which is why pasting one into a `display`
    placement produces a blank box that earns nothing).

    Renders no visible element — `display: contents` keeps the host out of the
    layout entirely, so it can sit inside any wrapper without adding a box. The
    injected markup is torn down on unmount.

    Gated server-side by the `popunder` switch, which is off by default.
  */
  if (ad.format === "pop" && ad.scriptCode) {
    return <PopHost code={ad.scriptCode} className={className} />;
  }

  /*
    Anything left renders nothing.

    Reached by a `video` row (whose player is owned by the reward and result
    placements, not by this component) and by any row missing the fields its own
    format requires — an AdSense row with no publisher id, a display row with no
    script. Those are prevented at write time by `adCreateSchema` and by the
    database CHECK, so reaching here means a row predates the validation. Render
    nothing rather than a frame around nothing.
  */
  return null;
}

/**
 * A network banner in an isolated frame, sized to FIT the screen it is on.
 *
 * ── The bug (owner, 2026-08-09) ──────────────────────────────────────────────
 * "the ad slot below the download placeholder is not responsive on small screen
 * device."
 *
 * Display creatives come at fixed pixel sizes — 468×60, 300×250, 728×90 — and
 * this frame took the declared width with `max-width: 100%` on top. That reads
 * like responsive markup and is not: `max-width` shrinks the IFRAME ELEMENT, and
 * the document inside it keeps its own width and is simply cut off at the new
 * edge (its body is `overflow: hidden`, so there is not even a scrollbar to
 * reveal the rest). On a 360px phone a 468px leaderboard lost its right-hand
 * third — the half of a banner that usually carries the offer and the button.
 *
 * ── Scale, do not crop ───────────────────────────────────────────────────────
 * The frame keeps its real dimensions and is transformed down by whatever factor
 * makes it fit, so the whole creative is visible, in proportion, and entirely
 * clickable. Only ever DOWN: enlarging a banner past the size it was built for
 * would just make it blurry.
 *
 * The host box takes the scaled height, because `transform` does not affect
 * layout — without it the card would reserve the unscaled height and leave a
 * band of blank underneath the ad, which is the "empty white space" complaint
 * this component has already been through once.
 *
 * That also keeps viewability honest. The impression observer watches this host,
 * so it measures the box the visitor can actually see rather than a taller one
 * the layout was merely holding open.
 *
 * Rows that declare NO size are left alone — a responsive network tag sizes
 * itself, and scaling one would fight it.
 */
function DisplayFrame({
  hostRef,
  srcDoc,
  width,
  height,
  children,
}: {
  hostRef: React.RefObject<HTMLDivElement | null>;
  srcDoc: string;
  width: number | undefined;
  height: number;
  children?: React.ReactNode;
}) {
  const [scale, setScale] = useState(1);

  /*
    🔴 `useLayoutEffect`, not `useEffect` (owner, 2026-08-10: CLS measured at
    0.684 on the landing page).

    The scale starts at 1 and the host's height is `height * scale`. With a
    passive `useEffect` the browser PAINTS the full-height box first and the
    measured scale arrives afterwards, so an oversized banner rendered tall and
    then snapped shorter — a layout shift, on the page with the tightest budget
    in the project, caused by the code that was meant to make ads behave.

    `useLayoutEffect` measures and sets the scale before that first paint, so
    the box is only ever the size it ends up. Same work, one frame earlier, and
    the shift stops existing rather than being animated away.
  */
  useIsomorphicLayoutEffect(() => {
    const host = hostRef.current;
    if (!width || !host || typeof ResizeObserver === "undefined") return;

    /*
      `clientWidth` is the width the host ACTUALLY got after `max-width: 100%`
      clamped it, which is exactly the number needed. No feedback loop: the
      transform changes nothing about layout width, so re-measuring after a
      scale returns the same value and the observer settles immediately.
    */
    const measure = () => {
      const available = host.clientWidth;
      if (available > 0) setScale(Math.min(1, available / width));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [hostRef, width]);

  return (
    <div
      ref={hostRef}
      className="relative w-full overflow-hidden"
      style={width ? { width, maxWidth: "100%", height: Math.round(height * scale) } : undefined}
    >
      {children}
      <iframe
        title="Advertisement"
        srcDoc={srcDoc}
        width={width}
        height={height}
        /*
          EAGER, not lazy.

          These placements are put where they are on purpose and are mostly
          above the fold. Lazy-loading them meant the frame did not even begin
          fetching until it neared the viewport, which on the under-download
          slot is part of why an ad could still be blank when the visitor had
          already pressed Download.
        */
        loading="eager"
        /*
          `allow-top-navigation-by-user-activation` is deliberately ABSENT.

          With it, a script inside this frame can navigate the WHOLE PAGE on any
          click it can attribute to the visitor — which is exactly the reported
          "a blank slot that takes me to a different site when I click it".
          Adsterra's Social Bar and OnClick creatives do this by design, and
          pasting one into a `display` placement is enough: the banner renders
          as an invisible full-size click layer.

          Without the token, the frame simply cannot touch the top-level
          location. `allow-popups` stays, so a legitimate banner click still
          opens the advertiser in a new tab — the behaviour a real display ad
          needs, and the only one it needs.

          `allow-same-origin` stays because networks serve protocol-relative
          (`//…`) script URLs that will not resolve in an opaque origin.
        */
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        style={{
          border: 0,
          display: "block",
          // Scaled from the top-left so the creative stays flush with the card's
          // padding instead of drifting toward the middle as it shrinks.
          ...(width && scale < 1 ? { transform: `scale(${scale})`, transformOrigin: "top left" } : null),
          // Only a row that declared no size is allowed to stretch.
          ...(width ? null : { width: "100%" }),
        }}
      />
    </div>
  );
}

/**
 * `useLayoutEffect` on the client, `useEffect` on the server.
 *
 * React warns when `useLayoutEffect` runs during SSR, and rightly — there is no
 * layout to read. This component never renders anything meaningful on the
 * server (it gates on a fetch), so the effect simply does not need to run there.
 */
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** Injects a self-executing ad script into the page and cleans it up. */
function PopHost({ code, className }: { code: string; className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    injectAdMarkup(host, code);
    return () => {
      host.innerHTML = "";
    };
  }, [code]);

  return <div ref={hostRef} className={className} aria-hidden style={{ display: "contents" }} />;
}
