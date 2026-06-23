"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import type { AdSlotData, AdZone } from "@/lib/monetization/types";

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
 *  - "pop"     → self-injecting script executed directly in the page
 */
export function AdSlot({
  zone,
  className,
  dismissible = true,
}: {
  zone: AdZone;
  className?: string;
  dismissible?: boolean;
}) {
  const [ad, setAd] = useState<AdSlotData | null>(null);
  const [closed, setClosed] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const tracked = useRef(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/ads?zone=${zone}`)
      .then((r) => (r.ok ? r.json() : { ad: null }))
      .then((d) => alive && setAd(d.ad ?? null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [zone]);

  // Self-injecting (pop) scripts run directly in the page.
  useEffect(() => {
    if (!ad || ad.format !== "pop" || !ad.scriptCode || !hostRef.current) return;
    const host = hostRef.current;
    injectAdMarkup(host, ad.scriptCode);
    return () => {
      host.innerHTML = "";
    };
  }, [ad]);

  useEffect(() => {
    if (!ad || tracked.current) return;
    tracked.current = true;
    beacon("impression", zone, ad.id);
  }, [ad, zone]);

  if (!ad || closed) return null;

  const closeBtn = dismissible ? (
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

  // pop: invisible host the script injected itself into.
  return <div ref={hostRef} className={className} aria-hidden style={{ display: "contents" }} />;
}
