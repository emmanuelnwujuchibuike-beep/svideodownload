import "server-only";

/**
 * Ask Cloudflare to forget cached copies of deleted media (Stories Part 1, 2026-10-26).
 *
 * Every upload is served `public, max-age=31536000, immutable`
 * (lib/storage/cache-control.ts), so deleting an object from R2 does NOT stop
 * Cloudflare's edge serving a copy it already holds. Purging by URL closes that.
 * It cannot reach a copy already saved in a viewer's own browser — nothing can.
 *
 * OPTIONAL and free: configured by two env vars, otherwise a no-op that says so
 * (`configured: false`), so the sweep reports the gap instead of hiding it.
 *
 *   CLOUDFLARE_ZONE_ID          the zone that serves R2_PUBLIC_BASE_URL
 *   CLOUDFLARE_PURGE_API_TOKEN  an API token with only Zone → Cache Purge → Purge
 *
 * The URLs are never logged.
 */

/** Cloudflare accepts at most 30 files per purge-by-URL request. */
const PER_REQUEST = 30;

export interface PurgeResult {
  configured: boolean;
  purged: number;
  errors: number;
}

export async function purgeCdnUrls(urls: readonly string[]): Promise<PurgeResult> {
  const zone = process.env.CLOUDFLARE_ZONE_ID?.trim();
  const token = process.env.CLOUDFLARE_PURGE_API_TOKEN?.trim();
  const out: PurgeResult = { configured: !!zone && !!token, purged: 0, errors: 0 };
  if (!out.configured || urls.length === 0) return out;

  for (let i = 0; i < urls.length; i += PER_REQUEST) {
    const files = urls.slice(i, i + PER_REQUEST);
    try {
      const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(zone!)}/purge_cache`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ files }),
      });
      const body = (await res.json().catch(() => null)) as { success?: boolean } | null;
      if (res.ok && body?.success) out.purged += files.length;
      else {
        out.errors += 1;
        console.warn("[storage/cdn-purge] purge refused", { status: res.status, count: files.length });
      }
    } catch (e) {
      out.errors += 1;
      console.warn("[storage/cdn-purge] purge failed", { error: e instanceof Error ? e.name : "unknown", count: files.length });
    }
  }
  return out;
}
