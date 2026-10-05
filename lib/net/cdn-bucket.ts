/**
 * A five-minute time bucket for GLOBAL, identical-for-everyone answers that
 * the CDN should serve instead of the function (ad inventory, announcement).
 *
 * The client puts `?b=<bucket>` on the URL, the route answers
 * `public, max-age=0, s-maxage=300`. A fresh URL every five minutes means no
 * browser cache and no Cloudflare TTL rewrite (it stretches `public` browser
 * TTLs to 7200 s — the "admin switch took two hours" bug of 2026-09-03) can
 * pin an old answer for longer than one bucket. Inside a bucket, repeats are
 * CDN hits: no invocation, no CPU, no Observability event.
 */
export const CDN_BUCKET_MS = 5 * 60 * 1000;

/** The header those routes answer with. */
export const CDN_BUCKET_CACHE_CONTROL = "public, max-age=0, s-maxage=300, stale-while-revalidate=60";

export function cdnBucket(now: number = Date.now()): number {
  return Math.floor(now / CDN_BUCKET_MS);
}
