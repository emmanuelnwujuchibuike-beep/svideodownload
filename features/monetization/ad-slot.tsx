"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { isPersistentZone } from "@/lib/monetization/ad-schema";
import { cn } from "@/lib/utils";
import type { AdSlotData, AdZone } from "@/lib/monetization/types";

import { AdSenseUnit } from "./adsense-unit";

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
 * ── `pop` is gone ─────────────────────────────────────────────────────────────
 *
 * The self-injecting branch that ran a network's script directly in the page has
 * been removed, not merely disabled. That branch is what made a pop-under or
 * Social Bar unit able to hijack the first click anywhere on the page. The
 * serving layer already filters those rows out (`isServableFormat`); deleting
 * the branch means that even a row that somehow reached this component has
 * nothing here to execute it.
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
    fetch(`/api/ads?zone=${zone}`)
      .then((r) => (r.ok ? r.json() : { ad: null }))
      .then((d) => {
        if (!alive) return;
        setAd(d.ad ?? null);
        /*
          Fires for the empty case too — that is the case wrappers need. Guarded
          so a re-render cannot re-notify a parent that has already collapsed.
        */
        if (!notified.current) {
          notified.current = true;
          onResolved?.(Boolean(d.ad));
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
    const w = ad.width ?? 300;
    const h = ad.height ?? 250;
    const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;overflow:hidden}</style></head><body>${ad.scriptCode}</body></html>`;
    return (
      <div className={cn("flex justify-center", className)}>
        <div className="relative" style={{ width: w, maxWidth: "100%" }}>
          {closeBtn}
          <iframe
            title="Advertisement"
            srcDoc={srcDoc}
            width={w}
            height={h}
            loading="lazy"
            // allow-same-origin is required so the network's protocol-relative
            // (//…) script URLs resolve; allow-popups lets the ad open on click.
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
            style={{ border: 0, display: "block", maxWidth: "100%" }}
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
        />
      </div>
    );
  }

  /*
    Anything left renders nothing.

    Reached by a `video` row (whose player is owned by the reward and result
    placements, not by this component) and by any row missing the fields its own
    format requires — an AdSense row with no publisher id, a display row with no
    script. Those are prevented at write time by `adCreateSchema` and by the
    database CHECK, so reaching here means a row predates the validation. Render
    nothing rather than a frame around nothing.

    This is also where a retired `pop` row lands if one ever gets this far: there
    is no branch left that can execute it.
  */
  return null;
}
