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

/*
  Owner, 2026-10-16: "anonymous users can like an Ad more than once every visit and it counts but signed
  in users likes only stays ones to that account". A signed-out visitor's LIKE is keyed by a per-visit id
  — minted once per page load, kept in memory only — so a new visit can like again and it counts, while
  within one visit a like is still one like (tap again = unlike). A signed-in member is keyed by account
  on the server ("u:<id>") whatever is sent here, so their like stays once per account. Shares keep the
  persistent visitor id (once per visitor).
*/
const VISIT_ID = `pv${(globalThis.crypto?.randomUUID?.() ?? `${Date.now()}${Math.random()}`).replace(/[^A-Za-z0-9]/g, "").slice(0, 30)}`;

export function likeActorId(): string {
  return VISIT_ID;
}

/** One read per campaign per page life — the rail of every showing of the same ad agrees. */
const cache = new Map<string, Promise<AdEngagement | null>>();

export function loadAdEngagement(campaignId: string): Promise<AdEngagement | null> {
  const hit = cache.get(campaignId);
  if (hit) return hit;
  // "liked" is per visit for a signed-out visitor (see VISIT_ID); the server ignores it for a member
  const v = likeActorId();
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
      body: JSON.stringify({ c: campaignId, kind, on, v: kind === "like" ? likeActorId() : visitorId() }),
    });
    const e = parseEngagement(await res.json().catch(() => null));
    if (e) cache.set(campaignId, Promise.resolve(e));
    return e;
  } catch {
    return null;
  }
}
