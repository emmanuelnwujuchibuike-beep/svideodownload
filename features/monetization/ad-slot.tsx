"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { isPersistentZone } from "@/lib/monetization/ad-schema";
import { cn } from "@/lib/utils";
import type { AdSlotData, AdZone } from "@/lib/monetization/types";

import { loadZoneAd } from "./ad-cache";
import { AdSenseUnit } from "./adsense-unit";
import { injectAdMarkup } from "./inject";

function beacon(kind: "impression" | "click", zone: string, adId: string) {
  navigator.sendBeacon?.(
    "/api/track",
    new Blob([JSON.stringify({ kind, zone, adId })], { type: "application/json" }),
  );
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
  onResolved,
}: {
  zone: AdZone;
  className?: string;
  dismissible?: boolean;
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
        */
        if (!notified.current && found?.format !== "adsense") {
          notified.current = true;
          onResolved?.(Boolean(found));
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

  useEffect(() => {
    if (!ad || tracked.current) return;
    tracked.current = true;
    beacon("impression", zone, ad.id);
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
      <div className={cn("relative", className)}>
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
    const hasSize = typeof ad.width === "number" && ad.width > 0;
    const w = hasSize ? ad.width! : undefined;
    const h = ad.height ?? (hasSize ? 250 : 100);
    const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;overflow:hidden}</style></head><body>${ad.scriptCode}</body></html>`;
    return (
      <div className={cn("flex justify-center", className)}>
        <div className="relative w-full" style={w ? { width: w, maxWidth: "100%" } : undefined}>
          {closeBtn}
          <iframe
            title="Advertisement"
            srcDoc={srcDoc}
            width={w}
            height={h}
            /*
              EAGER, not lazy.

              These placements are put where they are on purpose and are mostly
              above the fold. Lazy-loading them meant the frame did not even
              begin fetching until it neared the viewport, which on the
              under-download slot is part of why an ad could still be blank when
              the visitor had already pressed Download.
            */
            loading="eager"
            /*
              `allow-top-navigation-by-user-activation` is deliberately ABSENT.

              With it, a script inside this frame can navigate the WHOLE PAGE on
              any click it can attribute to the visitor — which is exactly the
              reported "a blank slot that takes me to a different site when I
              click it". Adsterra's Social Bar and OnClick creatives do this by
              design, and pasting one into a `display` placement is enough: the
              banner renders as an invisible full-size click layer.

              Without the token, the frame simply cannot touch the top-level
              location. `allow-popups` stays, so a legitimate banner click still
              opens the advertiser in a new tab — the behaviour a real display
              ad needs, and the only one it needs.

              `allow-same-origin` stays because networks serve protocol-relative
              (`//…`) script URLs that will not resolve in an opaque origin.
            */
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            /* `width: 100%` only when the row declared no size — otherwise the
               `width` attribute above is the exact one the unit was built for. */
            style={{ border: 0, display: "block", maxWidth: "100%", ...(w ? null : { width: "100%" }) }}
          />
        </div>
      </div>
    );
  }

  // AdSense — must run in the top-level document, never in the display iframe.
  if (ad.format === "adsense" && ad.adClient && ad.adSlotId) {
    return (
      <div className={cn("relative flex justify-center", className)}>
        {closeBtn}
        <AdSenseUnit
          client={ad.adClient}
          slotId={ad.adSlotId}
          layout={ad.adLayout}
          width={ad.width}
          height={ad.height}
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
