"use client";

import { useEffect, useRef, useState } from "react";

import { setBottomAdBarPresent } from "@/lib/dom/bottom-ad-bar";
import { useScrollDirection } from "@/lib/dom/use-scroll-direction";
import { cn } from "@/lib/utils";

import { AdSlot } from "./ad-slot";
import { ExoClickSticky } from "./exoclick-sticky";
import { useShowAds } from "./use-show-ads";

/**
 * The marketing pages' persistent ad bar — pinned to the BOTTOM of the viewport,
 * DIRECTLY ABOVE the app-style bottom nav (owner, 2026-08-02: "move the top header
 * banner ad to the bottom on the bottom nav"). It previously sat under the header;
 * the header now stays fixed on scroll and this bar docks above MobileAppNav.
 *
 * `fixed`, not `sticky`: it is mounted from the marketing LAYOUT *after* the page
 * content (and is deferred), so it has no top-of-flow anchor for `sticky`, and
 * `fixed` also means mounting it late never shifts the LCP-critical hero.
 *
 * ── Where it sits ─────────────────────────────────────────────────────────────
 *
 * Its `bottom` rests just above the bottom nav: `max(env(safe-area-inset-bottom),
 * --frenz-bottomnav-h)`. MobileAppNav publishes its own height (which already
 * includes the home-indicator safe-area pad) as `--frenz-bottomnav-h`; on desktop
 * the nav is `display:none`, so that height is 0 and the bar instead rests on the
 * safe-area inset at the very bottom. The bar publishes its OWN height as
 * `--frenz-bottomad-h` so the layout reserves that much space and content clears it.
 *
 * The zone id stays `bottom_banner` — a config key an operator already filled, not a
 * position — and `isPersistentZone` still treats it as chrome (no dismiss control).
 * Its DISPLAY name in the admin is "Bottom banner" (see lib/monetization/ad-schema).
 */
export function TopBannerAd() {
  const { showAds, ready } = useShowAds();
  const [hasPrimary, setHasPrimary] = useState<boolean | null>(null);
  const [hasLegacy, setHasLegacy] = useState<boolean | null>(null);
  /*
    Is an ExoClick bottom-nav banner configured? (owner, 2026-08-31: "configure
    the bottom nav to use this exoclick banner link and separate it with others
    network banner like adsterra".)

    The bar has to know, because it returns null before rendering anything when
    no OTHER network filled — so a site running ONLY the ExoClick banner would
    never get a bar for it to sit in. `ExoClickSticky` still resolves its own
    tag and self-hides; this only decides whether the container exists.
  */
  const [hasExoBottomNav, setHasExoBottomNav] = useState(false);
  /*
    🔴 CONFIGURED IS NOT FILLED (owner, 2026-08-31: "something like white line
    like the ad slot but the bottom nav still persist").

    `hasExoBottomNav` only says a banner is set up in the admin. The bar used
    that as its visibility, so a configured zone that did not fill still drew
    its top border and its padding — a thin white line above the nav, framing
    nothing at all. The unit itself is the only thing that knows whether a
    creative arrived, and it now says so.
  */
  const [exoFilled, setExoFilled] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/ads/config")
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: { exoclickBottomNav?: unknown }) => {
        if (alive) setHasExoBottomNav(Boolean(d.exoclickBottomNav));
      })
      .catch(() => {
        /* No banner is the safe outcome. */
      });
    return () => {
      alive = false;
    };
  }, []);
  const barRef = useRef<HTMLDivElement | null>(null);

  /*
    Revealed while the reader is scrolling DOWN — the moment the nav steps
    aside. Scrolling back up hands the space to the nav again.
  */
  const revealed = useScrollDirection() === "down";

  /*
    🔴 MOUNTED AND SHOWN ARE TWO DIFFERENT QUESTIONS (owner, 2026-08-31: "if i
    navigate the bottom banner will stopped showing in the landing and download
    page too").

    Gating the whole bar on `filled` deadlocked it, and that was my own
    regression from the previous fix. ExoClick's loader fills an <ins> that is in
    the DOM with real layout; an <ins> inside a `display:none` bar can never be
    filled, so `exoFilled` could never become true, so the bar could never stop
    being `display:none`. First load sometimes beat the race; a re-serve after a
    client-side navigation never did, which is exactly the shape of the report.

    So the two are separated:
      • CONFIGURED decides whether the bar EXISTS, so the loader always has a
        live placeholder to fill.
      • FILLED decides whether it has any CHROME — border, background, padding —
        and whether it may reveal itself. An unfilled bar is a zero-height,
        border-less element parked off-screen: present for the loader, invisible
        to the reader. That is what kills the white line without hiding the
        element the ad needs.
  */
  const configured = hasPrimary === true || hasLegacy === true || hasExoBottomNav;
  const filled = hasPrimary === true || hasLegacy === true || exoFilled;
  const askLegacy = hasPrimary === false;

  /*
    Tell the bottom NAV whether there is a real bar for it to step aside for.
    Without this the nav hid on a pathname alone and left nothing behind it —
    see `lib/dom/bottom-ad-bar.ts`.
  */
  useEffect(() => {
    setBottomAdBarPresent(filled);
    return () => setBottomAdBarPresent(false);
  }, [filled]);

  // Publish the bar's height so the marketing layout can RESERVE that much space at
  // the bottom and the page content clears the ad instead of hiding under it. 0 when
  // hidden, so an ad-free site keeps its exact layout.
  useEffect(() => {
    const root = document.documentElement;
    if (!filled || !barRef.current) {
      root.style.setProperty("--frenz-bottomad-h", "0px");
      return;
    }
    const bar = barRef.current;
    const setH = () => root.style.setProperty("--frenz-bottomad-h", `${bar.offsetHeight}px`);
    setH();
    const ro = new ResizeObserver(setH);
    ro.observe(bar);
    return () => {
      ro.disconnect();
      root.style.setProperty("--frenz-bottomad-h", "0px");
    };
  }, [filled]);

  // Nothing configured at all: no bar, no placeholder, no layout cost.
  if (!ready || !showAds || !configured) return null;

  return (
    <div
      ref={barRef}
      style={{
        // Sit above the bottom nav (its height already includes the safe-area pad);
        // on desktop the nav is display:none so the var is 0 and the bar rests on the
        // safe-area inset at the very bottom instead.
        bottom: "max(env(safe-area-inset-bottom), var(--frenz-bottomnav-h, 0px))",
        /*
          🔴 THE TWO BARS TRADE PLACES (owner, 2026-08-31: "the bottom ad banner
          slot should pop up smoothly like a luxurious design ... they should
          transform smoothly and premiumly like a design and not like an ad pop
          up").

          Scrolling DOWN, the nav slides out and this slides DOWN by exactly the
          nav-s height to take the space it left — so the two move as one
          gesture rather than one vanishing and another appearing. Scrolling UP,
          this drops away below the fold and the nav returns.

          Both bars run the same duration and the same easing off the SAME
          shared scroll signal (lib/dom/use-scroll-direction.ts), which is what
          keeps them from ever disagreeing for a frame.

          Driven by transform, never by `bottom` or `height`: animating either
          of those would relayout the page underneath on every frame.
        */
        // Only a bar with something IN it may take the nav's place.
        transform:
          revealed && filled
            ? "translateY(var(--frenz-bottomnav-h, 0px))"
            : "translateY(calc(100% + var(--frenz-bottomnav-h, 0px)))",
      }}
      className={cn(
        // z-40: below the header (z-50) and the mobile drawer (z-[70]), above content.
        // Solid, no blur — matches the de-glassed nav/header chrome. A top border
        // divides it from the content above; the nav below carries its own border.
        "fixed inset-x-0 z-40",
        "transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] will-change-transform motion-reduce:transition-none",
        // The chrome is the part that must never appear around nothing. The
        // ELEMENT still exists either way, so the loader keeps a placeholder.
        filled && "border-t border-border/60 bg-card",
      )}
      aria-hidden={!filled}
    >
      {/*
        🔴 THE HOME INDICATOR EATS THE BOTTOM OF THE CREATIVE IN A PWA (owner,
        2026-08-31: "add a small padding at the bottom ad so it doesnt pack down
        and cutting off some part in pwa but is perfect on broswer").

        The bar docks at `max(env(safe-area-inset-bottom), --frenz-bottomnav-h)`
        and then, once revealed, translates DOWN by the nav's height to take the
        space the nav vacated. Those cancel: the bar's bottom edge lands on the
        true bottom of the viewport — which on an installed PWA is underneath
        the home indicator, so the last strip of the ad is covered.

        In a browser tab `env(safe-area-inset-bottom)` is 0, which is why it
        looked right there and only there. The inset is added back as PADDING
        rather than by changing the dock position, so the bar's own background
        still runs to the edge (a gap under a docked bar reads as a rendering
        bug) and only the creative is inset. The extra 6px is the "small
        padding" asked for, and it applies on both so the unit never sits flush
        against the very bottom pixel.
      */}
      <div
        className={cn(
          "mx-auto flex w-full max-w-5xl items-center justify-center",
          // No padding before there is anything to pad — an unfilled bar must
          // have no height of its own.
          filled && "px-3 pt-2",
        )}
        style={filled ? { paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.5rem)" } : undefined}
      >
        <div className={cn(hasPrimary !== true && "hidden")}>
          <AdSlot zone="bottom_banner" dismissible={false} onResolved={setHasPrimary} />
        </div>

        {/*
          🔴 ITS OWN SLOT, beside the zone — never through it.

          `bottom_banner` is the AD ZONE where the Adsterra row and every other
          network row lives. Serving ExoClick through that same zone would make
          the two compete for one placement, so an operator could not run both.
          A separate settings key and a separate element is what "separate it
          with others network banner like adsterra" asks for, and it matches how
          the sticky and history ExoClick banners are already modelled.

          Renders nothing at all unless an ExoClick banner is configured and the
          viewer is on an ad-supported plan — the component decides that itself.
        */}
        {hasExoBottomNav ? <ExoClickSticky slot="bottomnav" onFill={setExoFilled} /> : null}

        {askLegacy ? (
          <div className={cn("md:hidden", hasLegacy !== true && "hidden")}>
            <AdSlot zone="mobile_bottom_banner" dismissible={false} onResolved={setHasLegacy} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
