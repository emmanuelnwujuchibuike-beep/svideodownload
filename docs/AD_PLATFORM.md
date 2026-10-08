# Advertising Platform — Part 1: engine + data foundation

Owner brief, 2026-10-07: a premium self-serve advertising platform. **Part 1**
(this document) is the engine and the data model. It has no advertiser screens
and no admin screens. Parts 2–7 build on it.

- Migration: `supabase/migrations/0195_ad_platform_foundation.sql`
- Engine: `lib/ads-platform/*`
- Browser: `features/ads-platform/*`
- Serving route: `app/api/ads/self/route.ts`

---

## 1 · Audit — what already existed

| Area | What is there | Verdict |
|---|---|---|
| Auth / roles | `auth.users` + `profiles`, `public.is_admin()` (0144: `is_admin or role='admin'`) | **Reused.** An advertiser is a member with an `advertisers` row. There is no second auth system. |
| Payments | `ai_topup_attempts` is the one payment-attempt ledger for Paystack **and** Bachs (0186, `purpose`). Webhooks: `app/api/paystack/webhook`, `app/api/bachs/webhook`, de-duplicated by `payment_provider_events`. | **Extended.** `purpose` gains `ad_campaign`. A campaign stores the attempt `reference`. No new payment table. |
| Wallet | `ai_product_balances` / `ai_product_ledger` hold CREDIT units (0184). `buy_ai_plan_with_credits` (0194) is the "spend credits atomically" pattern. Non-withdrawable credit is spent first (0187). | **Reused.** `pay_ad_campaign_with_credits` copies that pattern line for line. |
| Network ads | `public.ads` / `ad_impressions` / `ad_clicks` (0004, 0090). The operator pastes in AdSense, ExoClick, HilltopAds and Monetag zones, catalogued in `lib/monetization/ad-schema.ts` (`AD_ZONES`). | **Left alone.** It is a different product: inventory the operator configures, with no advertiser, payment or end date. Merging the two would have put a money contract into a table that holds pasted scripts. |
| "House ad" | the `native` format in `public.ads` | Operator-only, with no payment, schedule or validation. Kept as-is. Self-serve campaigns are the new path. |
| Ad gating | `/api/ads/inventory`: one CDN-cached answer per 5-minute bucket that says whether asking is worthwhile (2026-10-05). | **Extended** with `self: boolean`. With no live campaign, a page makes **zero** self-serve requests. |
| Analytics | The browser writes straight to Postgres via `rpc/track_events` (0172). There is no Vercel courier. | **Reused.** `track_ad_events` is the same shape, and `postIngest` sends it. |
| Storage | The public-bucket + service-role-write pattern (`ai-showcase`, 0182). The CDN serves reads directly. | **Reused.** New bucket `ad-creatives`. |
| Settings | `settings` (key/jsonb) and per-feature JSON | Not used here. The ad config is typed tables with CHECK constraints, because the SQL functions read the same numbers. |
| Content surfaces | Feed, Reels, Stories, AI pages, the downloader, the download result | Untouched in Part 1. Placements are seeded with matching page codes. Mounting is Part 4. |

**Duplicated:** nothing was duplicated. **Risky:** see §10.

## 2 · Data model (0195)

```
ad_platform_settings   singleton: ads_enabled (global kill switch), applications_open, default_slot_count
ad_formats             TOP_BANNER … REWARD_VIDEO: media types, size, rotation_seconds,
                       slot_count, no_consecutive_repeat, max_duration_seconds, file/dimension limits,
                       min_gap_seconds (frequency), enabled
ad_placements          global_top_banner, feed_banner, … ai_video_save_reward → format + page_scope, enabled
ad_durations           1/2/7/14/30 days (seeded, admin-editable), enabled
ad_pricing_plans       placement × duration × currency (CREDIT | USD | NGN) → price_minor. NONE seeded.
ad_promotions          extra_days, discount_percent, window, optional placement/duration. NONE seeded.
advertisers            user_id (unique) → business/display name, contact, status
ad_campaigns           advertiser, placement, duration, status, price snapshot, payment ref, window, version
ad_creatives           media in storage, destination_url, validation verdicts, url_validation_status
ad_slots               placement × slot_number → campaign (a position, not "one advertiser")
ad_campaign_events     lifecycle + operator audit (activated, paused, campaign_started, campaign_expired…)
ad_events              viewer events, once each (browser-minted id), pruned after 35 days
ad_campaign_daily_stats durable per-day counters per campaign × creative × placement
```

**Three lengths, never the same thing:**

| Setting | Where | Example |
|---|---|---|
| How often a banner swaps | `ad_formats.rotation_seconds` | 5 s |
| How long a campaign runs | `ad_durations.duration_days` (+ promotion `extra_days`) | 7 (+2) days |
| How long a video may be | `ad_formats.max_duration_seconds` | 15 s |

## 3 · The one engine

`getEligibleAds({ placement, format, page, now, user })` in
`lib/ads-platform/eligibility.ts` is the only place serving rules live. Two
stages of one rule set:

1. **`eligibleForPlacement`** runs on the server, on a CDN miss. It checks the
   global switch, that the placement and format are enabled, that the campaign
   is `active` with a payment verified and its advertiser `active`, that the
   creative is valid with a valid destination (re-checked syntactically), that
   the media type is allowed, and that a video is within the **current** admin
   limit. It then orders by slot and caps at the format's slot count.
2. **`servableNow`** runs in the browser, on the cached payload. It applies the
   campaign window to the second, the placement's page scope, and the
   campaign's own page targeting.

There is no `getFeedAds` or `getAIAds`. The SQL `ad_serving_snapshot()` is a
**privacy filter**, not a second copy of the rules: it ships only rows that
could serve, and no email, price, payment or moderation field.

## 4 · Payment → validation → live

```
draft → awaiting_payment ─┬─ wallet:  pay_ad_campaign_with_credits   (one transaction)
                          └─ card:    payment_processing → settle_ad_campaign_payment (webhook-verified, Part 3)
      → paid → activate_ad_campaign → active        (all checks pass, slot taken)
                                    → validating    (flags written; never live by accident)
```

- **The price** is set by the database only: `ad_campaign_quote` uses enabled
  admin rows. The best live promotion is applied automatically, and the
  discount is rounded down.
- **The wallet debit and the `paid` status** happen in one transaction with the
  campaign row locked. Paying twice does nothing.
- **Activation** is the only way into `active`. It re-checks the payment, the
  advertiser, every creative, the placement, and that a slot is free (under an
  advisory lock). Anything flagged stays in `validating`.
- **The table defends itself:** `ad_campaigns_paid_chk` plus the
  `ad_campaigns_guard` trigger refuse an unpaid live campaign and any rewrite
  of a verified payment, whoever the writer is.
- **Concurrency:** `transition_ad_campaign` takes `p_expected_version`. A second
  writer holding the same version gets `stale`.
- **Admin emergency control:** the global switch (`ads_enabled`), a per-placement
  `enabled`, and per-campaign pause / remove / reject (transitions). Disabling a
  duration or a placement stops new sales only. A paid campaign keeps serving
  until an admin stops it.
- **Expiry needs no cron.** The engine filters on time.
  `ad_campaigns_sync_lifecycle` records `expired` and `campaign_started` and
  prunes old events. It runs on a serving-route CDN miss, at most once per
  bucket per region.

## 5 · Request budget (verified by `features/ads-platform/ads-platform-client.test.ts`)

| Situation | Requests |
|---|---|
| No live campaign (today) | **0**. The inventory every page already loads says `self:false`. |
| Campaigns live | **1 per 5-minute bucket per tab**, CDN-cached, shared by every placement and every page change. A reload reuses `sessionStorage`. |
| 5-second rotation, no-repeat, page targeting | **0**. Pure functions run on the cached copy. |
| Viewer events | **1 batched RPC to Postgres** (≤20 events, 10 s, or page hide). No Vercel or Railway. Deduplicated in the browser **and** by `event_id`. |
| Server invocations | `/api/ads/self` runs at most once per bucket per region, however much traffic there is. |
| Realtime | **None.** A test fails on `setInterval`, `.channel(` or `postgres_changes` anywhere in the platform. |

Media is not in the payload. A creative is fetched from the storage CDN only
when it is about to be shown.

## 6 · Impressions

`loaded` (fetched/mounted) ≠ `visible` (≥50 % in viewport) ≠ `impression`
(≥50 % for one continuous second, the IAB rule) ≠ `click` ≠ the video
`*_complete` events. `observeImpression` implements this rule with one
IntersectionObserver per element and no polling.

## 7 · RLS

- **Public:** enabled formats, placements, durations, prices and live promotions
  (the buyer's menu), plus the settings flags.
- **Advertiser:** their own `advertisers` row, campaigns, creatives, audit and
  stats.
- **Admin:** everything, via `(select public.is_admin())`, evaluated per
  statement, never per row.
- **Writes from the browser: none.** Every write is a service-role route or a
  security-definer function. Every new function is revoked from
  `anon`/`authenticated` except `track_ad_events`.

## 8 · Storage

Bucket `ad-creatives`: public read straight from the CDN, 50 MB cap, and a
mime allowlist (webp/jpeg/png/avif/mp4/webm). It has no `storage.objects`
policy. Advertisers will upload with **signed upload URLs** (Part 2), so bytes
go browser → Supabase and never pass through Vercel or Railway memory.

## 9 · Verification

- `lib/ads-platform/engine.test.ts`: every eligibility rule, the reward-video
  limits (15 s valid, 30 s invalid, admin 20 s → 18 valid and 21 invalid, admin
  lowering a limit takes a live video out), the three lengths kept apart,
  destination URLs, rotation (no consecutive duplicate over 1,000 picks), and
  the payload.
- `lib/ads-platform/sql-contract.test.ts`: TS and SQL agree on statuses,
  transitions, event types and seeds. It also pins the money path, dedupe, RLS
  and grants.
- `features/ads-platform/ads-platform-client.test.ts`: the request budget, event
  batching and dedupe, and the no-polling guard (with a teeth case).
- **0195 was executed against a real Postgres (PGlite)** with stubs for
  `auth`/`storage`, using a harness that was not committed: 60 checks covering
  seeds, quote, wallet debit and idempotency, guard, activation flags, slot
  cap, lifecycle, card settle, RLS per role, and grants. Mutants of the guard,
  the dedupe and the slot cap each turned it red.
- Nine mutations of the TS engine and client (payment check, video limit, slot
  cap, no-repeat, time filter, bucket memo, event dedupe, https rule,
  transition map) each failed at least one test.

## 10 · Gap Ledger and risks (honest)

| Item | Status |
|---|---|
| Advertiser application UI, creative upload with signed URLs, server-side media probing (duration, dimensions, size must be measured by us and never taken from the browser) | **planned** (Part 2) |
| Destination reputation check (safe-browsing, redirect chase). Today only the syntactic check runs. Applications stay closed (`applications_open=false`) until this exists. | **planned** (Part 2) |
| Card checkout for a campaign (attempt row `purpose=ad_campaign`, `payment_processing`) and the webhook branch calling `settleCardPaymentAndActivate` | **planned** (Part 3). The SQL is done and tested. |
| Rendering components (top banner, interstitials, reward video) mounted after first paint | **planned** (Part 4). The engine, payload and client are done. |
| Admin screens (prices, durations, promotions, placements, campaigns, advertisers, kill switch) | **planned** (Part 6). The data, RLS and functions are done. |
| Refund when an admin rejects or removes a **paid** campaign | **planned** (Part 7). Today a rejection after payment does not refund automatically. |
| Campaign export in the account data export (campaigns hang off `advertisers`, not a user column) | **planned**. Recorded in `lib/portability/tables.ts`. |
| A paused campaign's clock keeps running (pausing does not extend `end_at`) | **decision needed** from the owner. |
| ⚠️ The `ai_video_save_reward` placement conflicts with the 2026-09-13 standing rule "no reward ads for AI, ever" (made after a network ad gate stalled AI jobs). This brief is newer and asks for it explicitly, so it is seeded. It must **never gate** the save: if no ad is available, the save goes ahead (Part 4). | **flagged to the owner** |
| ⚠️ Impression counts are client-reported. Dedupe stops replays and double fires, but a determined script can still forge views. Per-visitor caps and anomaly flags are planned. | risk |
| ⚠️ Propagation: an admin switch reaches visitors within one 5-minute bucket (+60 s stale-while-revalidate), not instantly. | by design |
| ⚠️ 0195 must be **probed live after the push**: every table, function, the bucket and the purpose constraint (runner hard laws). | open until pushed |

---

# Part 2 — the advertiser application (2026-10-07)

- Migration: `0196_ad_platform_applications.sql`
- Pages: `/advertise` (the product), `/advertise/create` (the application), `/advertise/rules`
- Entry points: the footer ("Advertise") and Account → Advertise. No new navigation.

## Flow

**Format → Placement → Duration → Creative → Details → Preview → Rules → Review.**

- Everything is on one page, in client state that is persisted to
  sessionStorage. A sign-in round trip or a reload loses nothing.
- Guests can explore the first three steps. Sign-in (the existing Frenzsave
  account) is asked for at the upload step.
- Choosing a format immediately shows an **example preview** of that format.
  The example brand is Frenz AI: a real third-party brand would read as that
  company advertising here.
- The upload step shows the same preview with the real file once uploaded.

## What the server decides

| Checkpoint | Route | What it does |
|---|---|---|
| Save draft | `POST /api/ads/advertiser/draft` | Re-checks format, placements and duration against the current catalogue. One campaign per placement, grouped by `application_id`. |
| Upload ticket | `POST /api/ads/advertiser/upload` | A signed PUT target in the **private** `ad-creatives-staging` bucket. The declared type and size are checked only to refuse early. |
| Finalize | `POST /api/ads/advertiser/upload/finalize` | Reads the **real bytes** by range (`media-probe.ts`): magic-byte type, true size, dimensions with EXIF/matrix rotation, MP4 moov or WebM duration. It validates against the current format row, then copies a passing file into the public bucket (inside Supabase) or deletes it. |
| Submit | `POST /api/ads/advertiser/submit` | Requires the rules checkbox plus its version, checks the destination (syntax + `ad_blocked_domains`, never fetched, so there is no SSRF surface), requires a valid creative, then **locks the price** per campaign with `ad_campaign_quote`. Moves the application to `awaiting_payment`. |

The menu is read straight from Postgres (`rpc/ad_catalog`, public, one read
per visit, cached for 5 minutes). It contains only enabled, priced options and
live promotions. The browser price is an estimate that follows the SQL rule
for rule; the locked amount comes from the database.

## Gap Ledger (Part 2)

| Item | Status |
|---|---|
| Payment (Bachs + Paystack checkout, webhooks, activation) | Part 3 |
| Resumable (TUS) uploads: today it is a single signed PUT with progress | planned |
| MOV (QuickTime) uploads: refused with "export as MP4" | decision |
| Orphan cleanup of abandoned public creatives / staging uploads: staging is cleared per application on the next ticket | planned |
| Reputation check of destinations (safe-browsing): today syntax + admin blocklist | planned |
| Admin screens for prices, durations, promotions, blocklist | Part 6 |
