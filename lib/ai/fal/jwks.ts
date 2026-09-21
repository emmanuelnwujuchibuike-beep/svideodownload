import "server-only";

import { FAL_JWKS_URL, type FalJwk } from "@/lib/ai/fal/signature";

/**
 * fal's webhook public keys, cached for a day (their documented ceiling) and
 * refreshed once when a delivery fails to verify — a rotation must not refuse
 * genuine callbacks until the day is out. A fetch that fails keeps the last
 * good set (a stale-but-genuine key still verifies a genuine delivery); with
 * nothing cached, the route refuses, because an unverifiable webhook is an
 * unverified one.
 */
const TTL_MS = 24 * 60 * 60 * 1000;
const MIN_REFRESH_GAP_MS = 60 * 1000;

let cache: { at: number; keys: FalJwk[] } | null = null;
let lastRefreshAttempt = 0;

async function fetchKeys(): Promise<FalJwk[] | null> {
  lastRefreshAttempt = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    const res = await fetch(FAL_JWKS_URL, { signal: controller.signal, cache: "no-store", headers: { accept: "application/json" } });
    clearTimeout(timer);
    if (!res.ok) return null;
    const body = (await res.json()) as { keys?: unknown };
    if (!body || !Array.isArray(body.keys)) return null;
    return body.keys.filter((k): k is FalJwk => !!k && typeof k === "object" && typeof (k as FalJwk).x === "string");
  } catch {
    return null;
  }
}

export async function falWebhookKeys(opts: { refresh?: boolean } = {}): Promise<FalJwk[]> {
  const fresh = cache && Date.now() - cache.at < TTL_MS;
  const mayRefresh = Date.now() - lastRefreshAttempt > MIN_REFRESH_GAP_MS;
  if (cache && fresh && !(opts.refresh && mayRefresh)) return cache.keys;
  if (cache && !mayRefresh) return cache.keys;
  const keys = await fetchKeys();
  if (keys && keys.length) cache = { at: Date.now(), keys };
  return cache?.keys ?? [];
}

/** For tests and the admin health panel. */
export function resetFalKeyCache(): void {
  cache = null;
  lastRefreshAttempt = 0;
}
