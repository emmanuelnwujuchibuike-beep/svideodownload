# FrenzSave.com

Premium multi-platform video downloader powered by [yt-dlp](https://github.com/yt-dlp/yt-dlp). TikTok-first, with support for 1000+ platforms (Instagram, YouTube, X, Facebook, Reddit, Vimeo, SoundCloud and more).

Built with **Next.js 15 (App Router)**, **TypeScript**, **Tailwind CSS**, **Supabase**, and **Upstash Redis**.

---

## ✨ Features (current foundation)

- 🎯 **Working downloader flow** — paste → auto-detect platform → fetch metadata via yt-dlp → preview → choose format → stream download.
- 🧱 **Enterprise architecture** — feature-based modules, service layer (`server/services`), repository-ready data access, SOLID-friendly separation.
- 🛡️ **Security baked in** — Zod validation, SSRF host filtering, sliding-window rate limiting (Upstash, with in-memory fallback), strict security headers.
- 🗄️ **Supabase schema** — profiles, downloads, analytics, traffic logs, settings, platform stats — with RLS policies, triggers, storage buckets, and realtime.
- 🎨 **Premium landing page** — glassmorphism, gradients, dark mode, mobile-first, animated, SEO-optimized (metadata, OG, JSON-LD, robots, dynamic sitemap).
- 🐳 **Production infra** — multi-stage Dockerfile (Next standalone + yt-dlp + ffmpeg), docker-compose (web + redis + nginx), nginx reverse proxy, GitHub Actions CI.

> This is **Phase 1**: a runnable foundation. See [Roadmap](#-roadmap) for what's intentionally stubbed for later phases.

---

## 🚀 Quick start (local)

### Prerequisites

- **Node.js ≥ 20**
- **[yt-dlp](https://github.com/yt-dlp/yt-dlp#installation)** on your `PATH` (or set `YTDLP_PATH`)
- **[ffmpeg](https://ffmpeg.org/download.html)** (required to merge video+audio and transcode audio)

Install yt-dlp + ffmpeg:

```bash
# macOS
brew install yt-dlp ffmpeg

# Windows (winget)
winget install yt-dlp.yt-dlp
winget install Gyan.FFmpeg

# Linux
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp
sudo apt-get install -y ffmpeg
```

### Run

```bash
npm install
cp .env.example .env.local   # fill in values (Supabase/Upstash optional for first run)
npm run dev
```

Open http://localhost:3000. The downloader works without Supabase or Upstash configured — those add auth, history, and distributed rate limiting.

---

## 🗄️ Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. Run the migrations (Supabase CLI or SQL editor):

   ```bash
   supabase db push
   # or paste supabase/migrations/*.sql into the SQL editor in order
   ```

3. Copy your project URL + anon key + service role key into `.env.local`.
4. Enable the Google / GitHub providers under **Authentication → Providers** (Phase 2).

The schema lives in [`supabase/migrations/`](supabase/migrations) and includes RLS, triggers (`handle_new_user`, `bump_platform_stats`), storage buckets, and a realtime publication on `downloads`.

---

## 🐳 Docker (recommended for production)

The Docker image bundles yt-dlp + ffmpeg, which is the most reliable way to run the streaming download endpoint.

```bash
cp .env.example .env.local   # production values
docker compose up --build
```

This starts:

| Service | Port | Role |
| ------- | ---- | ---- |
| `web`   | 3000 | Next.js standalone server |
| `redis` | 6379 | local cache (use Upstash in prod) |
| `nginx` | 80   | reverse proxy + per-IP rate limiting |

---

## ▲ Production: Vercel frontend + Docker worker (the split)

Vercel's serverless runtime has **no `yt-dlp`/`ffmpeg`**, so the heavy routes run
on a **Docker worker** and Vercel proxies to it. The same codebase plays both
roles, decided purely by env:

| Role | Where | Env |
| ---- | ----- | --- |
| **Frontend** | Vercel | `DOWNLOAD_WORKER_URL=https://<worker>` + `WORKER_SECRET` |
| **Worker** | Fly.io / Railway / VPS (Docker) | `DOWNLOAD_WORKER_URL` **blank** + same `WORKER_SECRET` |

When `DOWNLOAD_WORKER_URL` is set, `/api/metadata` and `/api/download` forward to
the worker (sending the secret); when blank, the app does the real
extraction/download itself. The worker rejects requests without a matching
`x-worker-secret`.

**Deploy the worker (Fly.io example):**

```bash
fly launch --no-deploy                       # creates the app from fly.toml
fly secrets set WORKER_SECRET=$(openssl rand -hex 24) \
  UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=...
fly deploy                                   # builds Dockerfile (yt-dlp + ffmpeg)
```

**Then point Vercel at it** (Project → Settings → Environment Variables):
`DOWNLOAD_WORKER_URL=https://<app>.fly.dev`, the **same** `WORKER_SECRET`, plus
the rest of `.env.example`. Redeploy.

> Note: Vercel Hobby caps function duration at 300s, so the proxied download
> connection is capped there; full-length downloads still complete on the worker
> if the client talks to it directly, or upgrade the plan.

Single-host alternative: skip Vercel and deploy **only** the Docker image
(`docker compose up`) — everything works in one place.

---

## 🧱 Project structure

```
app/                 # App Router pages + route handlers + SEO (robots, sitemap)
  api/               #   metadata, download, health endpoints
components/          # Presentational UI (landing sections, layout chrome)
features/            # Feature modules (downloader: hook + UI)
lib/                 # Cross-cutting utilities (platforms, validation, rate-limit, supabase)
server/services/     # Server-only service layer (yt-dlp wrapper)
supabase/migrations/ # SQL schema, RLS, triggers, storage, realtime
types/               # Shared domain types
middleware.ts        # Supabase session refresh + /admin guard
```

---

## 🔐 Environment variables

See [`.env.example`](.env.example) for the full annotated list. Highlights:

| Variable | Required | Purpose |
| -------- | -------- | ------- |
| `NEXT_PUBLIC_SITE_URL` | ✅ | SEO / canonical / sitemap base |
| `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` | for auth | Supabase client |
| `SUPABASE_SERVICE_ROLE_KEY` | for admin/cron | bypasses RLS — server only |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | prod | distributed rate limiting |
| `YTDLP_PATH` | optional | path to yt-dlp binary |

---

## 🗺️ Roadmap

Phase 1 (this foundation) ships the downloader, schema, landing page, and infra. Planned next:

- [ ] Auth UI (email, magic link, Google, GitHub, anonymous sessions)
- [ ] Download history, favorites, realtime status + progress
- [ ] Admin dashboard (charts, metrics, error logs)
- [ ] Monetization (AdSense slots, Stripe / LemonSqueezy premium tiers)
- [ ] PostHog + GA4 + Sentry wiring
- [ ] Per-platform SEO landing pages (`/download/[platform]`)
- [ ] Test suite (Vitest + Playwright) and Husky/lint-staged/commitlint

---

## ⚖️ Legal

Download only content you own or have the right to save, and respect each
platform's Terms of Service and applicable copyright law. This project is a
tool; responsibility for its use lies with the operator and end users. A DMCA
process and Terms/Privacy pages should be in place before public launch.
