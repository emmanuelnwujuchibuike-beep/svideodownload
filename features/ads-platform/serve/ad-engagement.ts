"use client";

import { parseEngagement, type AdEngagement } from "@/lib/ads-platform/engagement";

/**
 * The client side of /api/ads/engagement. Non-critical, so it fails open: any
 * error means "no counts", and the ad shows its rail without numbers rather
 * than a made-up figure.
 */

function visitorId(): string | null {
  try {
    // the analytics visitor id (lib/analytics/client.ts VISITOR_KEY) — read, never minted here
    return localStorage.getItem("frenz_vid");
  } catch {
    return null;
  }
}

/** One read per campaign per page life — the rail of every showing of the same ad agrees. */
const cache = new Map<string, Promise<AdEngagement | null>>();

export function loadAdEngagement(campaignId: string): Promise<AdEngagement | null> {
  const hit = cache.get(campaignId);
  if (hit) return hit;
  const v = visitorId();
  const p = fetch(`/api/ads/engagement?c=${encodeURIComponent(campaignId)}${v ? `&v=${encodeURIComponent(v)}` : ""}`, { credentials: "same-origin", cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then(parseEngagement)
    .catch(() => null);
  cache.set(campaignId, p);
  // a failure is not remembered: the next showing tries again
  void p.then((e) => {
    if (!e) cache.delete(campaignId);
  });
  return p;
}

/** Like / unlike / share. Resolves to the server's counts, or null (the caller rolls its optimistic change back). */
export async function reactToAd(campaignId: string, kind: "like" | "share", on: boolean): Promise<AdEngagement | null> {
  try {
    const res = await fetch("/api/ads/engagement", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ c: campaignId, kind, on, v: visitorId() }),
    });
    const e = parseEngagement(await res.json().catch(() => null));
    if (e) cache.set(campaignId, Promise.resolve(e));
    return e;
  } catch {
    return null;
  }
}
