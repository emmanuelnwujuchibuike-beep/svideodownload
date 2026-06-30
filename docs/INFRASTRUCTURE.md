# Frenzsave Infrastructure & Edge Setup

Where each piece runs and what to provision when. Short version:

| Concern | Provider | Set up… | Status in code |
|---|---|---|---|
| Web/app + API | Vercel | already | ✅ |
| Download/transcode worker | Railway | already | ✅ |
| Auth + Postgres + Storage + Realtime | Supabase | already | ✅ |
| Redis (rate limit, daily caps, hot-read cache) | **Upstash** | **now** | ✅ coded, ⬜ provision |
| CDN + edge cache | Vercel (built-in) | already | ✅ |
| WAF / DDoS / media CDN | **Cloudflare** | **Phase 3** | ⬜ |

## Upstash Redis — set this up now

It's already integrated in code ([lib/cache.ts](../lib/cache.ts),
[lib/rate-limit.ts](../lib/rate-limit.ts)). Until it's provisioned, both fall
back to **per-instance in-memory** state — which means on Vercel's serverless
fleet the rate limits and daily caps are **not shared across instances** and the
hot-read cache is cold on every new lambda. Provisioning fixes all of that with
two env vars. No code change.

1. Create a database at https://console.upstash.com → **Redis** → pick the region
   **closest to your Vercel + Railway region** (latency matters; the cache is on
   the request path).
2. Copy the **REST** credentials (not the TCP ones) from the database page.
3. Add to **both Vercel and Railway** (Production + Preview):

   ```
   UPSTASH_REDIS_REST_URL=https://<your-db>.upstash.io
   UPSTASH_REDIS_REST_TOKEN=<token>
   ```

4. Redeploy. Verify via `GET /api/health` → `cacheBackend` should read `redis`.

Optional tuning (already supported, sane defaults):
`RATE_LIMIT_ENABLED`, `RATE_LIMIT_METADATA_PER_MIN`, `RATE_LIMIT_DOWNLOAD_PER_MIN`,
`RATE_LIMIT_ASSISTANT_PER_MIN`, `RATE_LIMIT_TRACK_PER_MIN`.

What it immediately powers: shared sliding-window rate limits, per-UTC-day
download caps, the metadata/URL cache, and the new `getCached()` hot-read cache.

## CDN + edge caching — already handled by Vercel

You do **not** need Cloudflare in front of Vercel right now, and adding it can hurt
(double caching, SSL/redirect loops, fighting Vercel's own CDN). Vercel already
serves static assets and `next/image` from a global CDN and honours the
`s-maxage` / `stale-while-revalidate` headers we set via
[lib/api/edge-cache.ts](../lib/api/edge-cache.ts). The anonymous home feed
(`/api/v1/app/feed`) is now edge-cached this way; personalized responses send
`private, no-store` so no user's data is ever served to another from the edge.

To add more edge caching, wrap a **public, non-personalized** GET response in
`publicCache(res, { sMaxAge, swr })`. Never wrap a personalized response.

## Cloudflare — defer to Phase 3 (media), with one optional exception

Cloudflare earns its place when we hit the **media pipeline**, not before:

- **Cloudflare R2** — object storage with **zero egress fees**, for serving
  downloaded/published media cheaply at scale (vs. Supabase Storage egress).
- **Cloudflare Stream** — managed adaptive-bitrate (HLS) video: upload once, it
  transcodes to multiple resolutions and serves from Cloudflare's CDN. This is the
  Phase 3 "professional streaming" requirement, largely turnkey.
- **WAF / DDoS / Bot management** — most valuable in front of the **Railway
  worker** (the expensive, abusable endpoint), via DNS proxy + a rate-limit rule.

**Optional now:** if the worker is getting hit, you can put just the worker's
domain behind Cloudflare (orange-cloud the DNS record, add a WAF rate-limit rule)
without touching Vercel. That's a security move, independent of the CDN question.

### When you do adopt Cloudflare media (Phase 3)

You'll add env vars roughly like `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL` (or
`CLOUDFLARE_STREAM_TOKEN`), and the worker's store-media step uploads there
instead of (or in addition to) Supabase Storage. The `media_url` on posts already
abstracts where media lives, so this is a worker-side swap, not a schema change.

## Summary recommendation

1. **Now:** provision Upstash (2 env vars, both platforms). Real correctness +
   scale win, zero code change.
2. **Now (optional):** Cloudflare in front of the Railway worker only, for WAF, if
   abuse is a concern.
3. **Phase 3:** Cloudflare R2 + Stream for the media pipeline. Skip Cloudflare in
   front of Vercel — it's redundant with Vercel's CDN.
