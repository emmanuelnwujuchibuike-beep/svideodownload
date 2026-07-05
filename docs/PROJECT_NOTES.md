# Frenzsave — Project Notes & Decisions

A durable, human‑readable record of the project's key decisions, conventions and
system knowledge. Mirrored from the working knowledge base so it's readable on
GitHub.

> **No secrets here.** API keys and tokens (Supabase `service_role`, Cloudflare R2
> secret, Paystack/Resend/VAPID private keys, etc.) live **only** in the
> gitignored `.env.local` and must never be committed. This file records what
> things are and why — never their secret values.

_Last updated: 2026‑07‑05._

---

## Brand & Design

- **Product name:** primary name is **Frenz**. "FrenzSave" is used only for the
  SEO/download URL and a few crucial meta spots.
- **Brand "F" logo:** the premium luxury gradient "F" in
  `components/brand/frenz-logo.tsx` (`FrenzLogo` / `FrenzMark` / `FrenzWordmark`)
  is the single source of truth — reuse it everywhere, never inline a different F.
- **Design tokens:** the design system lives in `app/globals.css` — brand palette
  (Electric Blue `#0A84FF` primary, Royal Purple `#6C4DFF` accent, `#050816` dark
  bg), motion tokens, glass/glow utilities. Use tokens, not ad‑hoc values.
- **No emoji in the UI:** never use emoji anywhere in the product design — use
  realistic, colorless line icons (lucide / react‑icons) instead.
- **Theme default stays `system`** (light/dark/system). Never force a theme; light
  mode stays bright/white.

## Engineering foundation

- **Frenz Core** is the mandatory foundation — every feature integrates with it;
  nothing bypasses it. One backend, one identity, one cloud, one security model,
  one design system, shared engines. Canonical spec: `docs/FRENZ_CORE.md`.
- **Platform architecture:** modular‑monolith; module registry in `lib/platform`;
  unified backend (`/api/v1/app/*`) + a cross‑platform SDK (`lib/sdk`) shared by
  web/iOS/Android/desktop. Perf guardrails documented in `ARCHITECTURE.md`.
- **Performance review gate (MANDATORY):** no feature is done until it passes a
  perf review — rendering efficiency (memoize list items, animate only
  transform/opacity), memory (clean listeners/timers/observers, release media),
  network (dedupe/cache/paginate), battery/thermal (pause offscreen +
  backgrounded media, one decoder), and mobile smoothness. Targets: Lighthouse
  Perf 95+, A11y/Best‑Practices/SEO 100, healthy Core Web Vitals.
- **Independent audio playback:** feed videos autoplay **muted** (HTML `muted`
  attribute) so users keep hearing their own music/podcast while scrolling. Never
  take audio focus except on the user's explicit unmute (fade via
  `lib/media/audio-playback.ts`). No Web Audio API, no hidden audio elements, no
  `navigator.mediaSession`.

## Product surfaces (shipped highlights)

- **Home dashboard** at `/home` — app shell + rich paginated Smart Feed; landing
  redirects logged‑in users here.
- **Smart Home Feed** — smart‑feed engine (reasons, content balance, spark cards,
  "while you were away"), premium `SmartFeed` on `/home` with pull‑to‑refresh,
  filters, zero‑empty fallback. Called **Smart**, never "AI".
- **Reels** — full‑screen deck (For You / Following tabs, scrubber, double‑tap
  like, decluttered rail + "More" menu, Repost, inline edit, direct download).
  Muted‑by‑default independent audio.
- **Notifications** — premium realtime Notification Center, Web Push, iOS install
  path, social push, live toast.
- **Friends (Frenz Connect)** — requests with notes, friendships, `/friends` hub,
  full‑page `/friends/discover` (search + suggestions).
- **Profiles** — Identity Ring w/ presence, living glow, live stats, Posts/Videos/
  Photos tabs, share, completion meter.
- **Creation Studio** — block‑based Story Studio (heading/text/quote/image/video/
  divider), drafts + recovery, morph publish animation.
- **Downloader** — the SEO/download product; direct download of posts (free tier
  capped at 5/day, premium unlimited).
- **Repost & Share (Phase 1 + 2)** — reels action stack is Like · Comment ·
  Repost · Save + a premium overflow (•••) sheet. **Phase 2** (attribution model)
  is a `reposts` table (a pointer to the original — never copies media) +
  `posts.reposts_count` + notify trigger, in **migration `0025_reposts.sql`
  (must be applied in Supabase)**. Repost is a toggle (`POST`/`DELETE
  /api/posts/:id/repost`), synced across surfaces via a client repost store, with
  a live count; the profile **Reposts tab** is public. Phase 2b (per-tab privacy,
  "X reposted" feed discovery, overlapping-avatar badges, repost conversations,
  grouped notifications) is deferred.

## Infrastructure & ops

- **Deploys:** GitHub → Vercel. **Always `git push origin main` after committing**
  — the owner judges progress by the live site.
- **Vercel region:** functions run in **`cdg1` (Paris)** for an Africa‑primary
  audience (was `iad1`). Supabase is Cloudflare‑fronted REST, so Paris keeps DB
  access healthy while cutting the user↔function transatlantic latency. Revisit
  with edge caching + read replicas when global.
- **Storage / egress:** app supports Cloudflare R2 + Stream (env‑gated, falls back
  to Supabase Storage). Media served via `media.frenzsave.com`. Watch Supabase
  egress; anon reads are edge‑cacheable and hot reads are Redis‑cached.
- **Worker transcode:** VP9→H.264 on Railway must cap x264 threads (`-threads 2`)
  or it OOMs.
- **Railway builds** with `npm ci` — any `package.json` change must commit the
  updated `package-lock.json` or the deploy fails.
- **`vercel.json`** schema forbids extra keys (e.g. a `comment`) on header/route
  objects — it fails validation.
- **Admin / alert email:** `nwujuchriss@gmail.com` (not the git‑config email).

## Cross‑platform SDK (native‑app groundwork)

- `lib/sdk` — dependency‑free `FrenzsaveClient` (auth injection, request dedupe,
  retry w/ backoff, timeouts, `X-Client` tag). Typed methods for `me`, `feed`, and
  core actions (`like`, `save`, `follow`, `repost`, `authorizeDownload`). Web uses
  the same client via `getApi()` / `useApi()`.
- Next: extend bearer‑token auth to the plain `/api/*` action routes so the native
  (cookieless) clients can call them, and progressively route web reads through the
  SDK so the web exercises the identical fast path.

---

_This file is intentionally free of secrets. If you're looking for keys/tokens,
they're in your local `.env.local` (gitignored)._
