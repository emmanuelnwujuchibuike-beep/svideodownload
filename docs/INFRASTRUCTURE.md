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

### Cloudflare R2 for main media — wired in code, provision to activate

R2 is the main store for large media (videos, audio, reels, story media). Small
profile images stay on Supabase. The routing lives in
[lib/storage](../lib/storage): server uploads go through `putServerMedia`; browser
uploads get a presigned R2 PUT URL from `/api/uploads/presign` (nothing flows
through our server). **Until the env vars below are set, everything transparently
falls back to Supabase Storage — uploads keep working, no code change.**

**Set up (one-time):**

1. Cloudflare dashboard → **R2** → **Create bucket** (e.g. `frenz-media`).
2. **R2 → Manage API Tokens → Create API Token** (Object Read & Write). Copy the
   Access Key ID + Secret Access Key and your **Account ID**.
3. Make the bucket public for reads: **bucket → Settings → Public access →**
   either connect a **custom domain** (recommended, e.g. `media.frenz.app`) or
   enable the **r2.dev** subdomain. That URL is `R2_PUBLIC_BASE_URL`.
4. Add these env vars to **Vercel and Railway** (Production + Preview), then redeploy:

   ```
   R2_ACCOUNT_ID=<cloudflare account id>
   R2_ACCESS_KEY_ID=<r2 token access key>
   R2_SECRET_ACCESS_KEY=<r2 token secret>
   R2_BUCKET=frenz-media
   R2_PUBLIC_BASE_URL=https://media.frenz.app   # or https://pub-xxxx.r2.dev
   ```

5. **CORS on the bucket** (so browser presigned PUTs work): bucket → Settings →
   CORS policy → allow your site origin(s) with `PUT`, `GET`, headers `*`:

   ```json
   [{ "AllowedOrigins": ["https://frenz.app","https://*.vercel.app"],
      "AllowedMethods": ["GET","PUT"], "AllowedHeaders": ["*"], "MaxAgeSeconds": 3600 }]
   ```

New media then lands in R2 and is served via the Cloudflare CDN (zero egress).
Existing Supabase-hosted media keeps working — `posts.media_url` stores absolute
URLs, so old and new coexist with no migration.

**Cloudflare Stream (adaptive-bitrate video) — code shipped, opt-in by env.**
Stored R2 files download the whole video before playing; Stream serves HLS with a
quality ladder and instant range-based start (TikTok-style). The integration lives
in `lib/media/stream.ts` (`createStreamDirectUpload`, `copyToStream`, playback URL
builders) and `features/media/smart-video.tsx` (`SmartVideo`, already used by
`PostViewer`): a post with a `streamUid` plays through Stream, otherwise it falls
back to the R2/Supabase `<video>` — fully additive.

To turn it on:
1. Enable **Stream** in Cloudflare; create an API token with **Stream:Edit**.
2. Set `CF_STREAM_ACCOUNT_ID`, `CF_STREAM_API_TOKEN`, and the public
   `NEXT_PUBLIC_CF_STREAM_CUSTOMER_CODE` (from any embed URL) on Vercel + Railway.
3. Add a `stream_uid text` column to `posts`; on upload create a direct-upload
   ticket (`createStreamDirectUpload`) or backfill existing R2 videos with
   `copyToStream(mediaUrl)`, store the returned `uid` in `stream_uid`, and add
   `stream_uid` to the feed SELECT in `lib/social/home-feed.ts`.

## Summary recommendation

1. **Now:** provision Upstash (2 env vars, both platforms). Real correctness +
   scale win, zero code change.
2. **Now:** provision R2 (5 env vars, both platforms) to move main media off
   Supabase egress. Code is already wired; falls back to Supabase until set.
3. **Optional:** Cloudflare WAF in front of the Railway worker if abuse is a
   concern. Skip Cloudflare in front of Vercel — redundant with Vercel's CDN.
4. **Later (Phase 3):** Cloudflare Stream for ABR video.
