"use client";

import { useEffect, useRef, useState } from "react";

import type { AdSlotData, AdZone } from "@/lib/monetization/types";

/**
 * Async, non-blocking ad slot. Fetches its config for the zone after mount
 * (premium users get `null` → renders nothing), injects the network script or
 * native markup, then beacons an impression. Never blocks first paint.
 */
export function AdSlot({ zone, className }: { zone: AdZone; className?: string }) {
  const [ad, setAd] = useState<AdSlotData | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const tracked = useRef(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/ads?zone=${zone}`)
      .then((r) => (r.ok ? r.json() : { ad: null }))
      .then((d) => {
        if (alive) setAd(d.ad ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [zone]);

  // Inject network <script> embeds (native/house ads render declaratively below).
  useEffect(() => {
    if (!ad || !ad.scriptCode || !hostRef.current) return;
    const host = hostRef.current;
    const range = document.createRange();
    range.selectNode(host);
    host.appendChild(range.createContextualFragment(ad.scriptCode));
    return () => {
      host.innerHTML = "";
    };
  }, [ad]);

  // Beacon a single impression once we have a fill.
  useEffect(() => {
    if (!ad || tracked.current) return;
    tracked.current = true;
    navigator.sendBeacon?.(
      "/api/track",
      new Blob([JSON.stringify({ kind: "impression", zone, adId: ad.id })], {
        type: "application/json",
      }),
    );
  }, [ad, zone]);

  if (!ad) return null;

  const beaconClick = () =>
    navigator.sendBeacon?.(
      "/api/track",
      new Blob([JSON.stringify({ kind: "click", zone, adId: ad.id })], {
        type: "application/json",
      }),
    );

  // Native / house ad — declarative card.
  if (ad.format === "native" && ad.targetUrl) {
    return (
      <a
        href={ad.targetUrl}
        target="_blank"
        rel="nofollow sponsored noopener"
        onClick={beaconClick}
        className={`block overflow-hidden rounded-2xl border border-border bg-card transition hover:border-foreground/20 ${className ?? ""}`}
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
    );
  }

  // Script-embed ad (Adsterra / PropellerAds / …).
  return <div ref={hostRef} className={className} aria-hidden />;
}
