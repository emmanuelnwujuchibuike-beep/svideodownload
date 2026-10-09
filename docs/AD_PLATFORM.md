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

---

# Part 3 — payments on the existing rails (2026-10-08)

Migration: `0197_ad_platform_payments.sql`. Code: `lib/ads-platform/payment-server.ts`
(advertiser flow, webhooks, activation) and `lib/ads-platform/admin-payments.ts`
(admin view). Pages: `/advertise/payment` (the return from checkout) and
`/advertise/campaigns` (my campaigns).

## No second payment system

| Need | What it reuses |
|---|---|
| Payment record | `ai_topup_attempts` (purpose `ad_campaign`), extended in 0197 with the quote, provider amount and currency, FX rate, stored Bachs request, charge id, verified/refund/dispute fields |
| Webhook dedupe | `payment_provider_events` (Paystack key = `event:reference`) |
| Provider choice | `lib/payments/router.ts`, with a new purpose `ad_campaign`. Admin edits it in AI plans → Payment routing → "Ad campaigns". Default: NG → Bachs then Paystack, elsewhere Paystack. |
| USD → NGN | `resolveCheckoutRate` + `quoteCheckout`: the live rate, cached, plus the operator's markup. The rate is stored on the attempt. |
| Bachs client | `lib/payments/bachs.ts` + `bachsCheckoutRequest`/`postBachsCheckout` |
| Paystack client | `lib/paystack/paystack.ts` + `initializeAdCheckout` (purpose `frenz_ad_campaign`) |
| Webhooks | the existing `/api/bachs/webhook` and `/api/paystack/webhook`. The ad branch sits **before** every wallet/plan line, so an ad payment can never credit AI credits. |

Ads are **not** paid from AI credits (owner, Part 3). Part 1's
`pay_ad_campaign_with_credits` and `settle_ad_campaign_payment` are dropped.

## Flow

```
submit (Part 2) → price locked + ad_payment_quotes row (open, expires after quote_ttl_minutes)
"Continue to secure payment" → POST /api/ads/payment/create {campaignId, quoteId}
   ad_payment_begin   (one tx: quote open + unexpired + equals the campaigns' totals,
                       one open attempt per application, campaigns → payment_processing)
   router candidates  → Bachs (USD; Bachs converts at its page) or Paystack (NGN at our rate)
signed webhook / verify-on-return → ad_payment_settle (lock, idempotent: provider, purpose,
   amount and currency vs the attempt, the checkout window) → campaigns paid → activateCampaign (idempotent)
```

- **Fallback:** only after a provider **refused** (a 4xx, or Paystack's own
  message: nothing was created). If the outcome is uncertain (timeout, 5xx,
  409 in-progress), the attempt becomes `verification_required` and nothing
  else is opened. Recovery:
  - Bachs: replay the stored body with the same Idempotency-Key, within 24 h.
  - Paystack: verify our reference.
- **Amounts:**
  - Paystack: the NGN amount must cover the attempt's.
  - Bachs: a USD amount must cover the USD price. An NGN `collection.succeeded`
    on **our** checkout session counts as full payment, because Bachs reports
    underpayment separately as `collection.underpaid`.
  - A mismatch becomes `mismatch` and is never activated.
- **Quotes:** an admin price or promo change never touches an open quote. An
  expired quote is refused at begin.
- **Late payment:** a payment settling more than `checkout_honour_hours`
  (24 h) after the checkout opened becomes `verification_required` for a
  person. It is never activated at an old price.
- **Refunds and disputes:**
  - Bachs `refund.paid`, `dispute.created`/`updated` (by charge id).
  - Paystack `refund.processed`, `charge.dispute.*` (by our reference).
  - These run `ad_payment_reverse`. A campaign that never started is
    removed. Otherwise a refund follows `refund_after_start` (remove/pause/keep)
    and a chargeback follows `chargeback_action` (pause/remove).
  - A partial refund is recorded and the campaign is left to the admin.
- **Emergency switch:** `ad_platform_settings.payments_enabled = false` stops
  new payments. Live campaigns are untouched.
- **Return page:** checks the server at 0/2/4/8/15/30 s while the payment is
  settling, then offers "Check again". No setInterval, no Realtime.
- **Admin:** Admin → Ad placements → **Campaign payments**. Rows have every
  required column, filters, a reconciliation list (`ad_payment_inconsistencies`)
  and two idempotent repairs: check with the provider, retry activation.

## Verification

- 0197 was executed against PGlite: 41 payment checks covering T1–T24
  (118 with Parts 1–2). Mutants of the amount check, the quote check and the
  checkout window were each caught.
- `lib/ads-platform/payments.test.ts`: routing, the fallback rule (T2/T3),
  error classification, webhook ordering, the SQL contract.
- Not run: a live charge against a Bachs sandbox or Paystack test key. No key
  is in this environment, and Paystack's docs site refuses automated reads
  (403). Refund and dispute payload fields are read defensively from every
  documented location.

## To go live (owner)

1. **Prices:** there is no admin screen until Part 6. Use SQL, e.g. 7 days
   top banner at $5:
   `insert into ad_pricing_plans (placement_id, duration_id, currency, price_minor) select p.id, d.id, 'USD', 500 from ad_placements p, ad_durations d where p.code='global_top_banner' and d.duration_days=7;`
2. **Open applications:** `update ad_platform_settings set applications_open = true;`
3. **Bachs API key permissions:** `payments:read`, `payments:write`,
   `products:read`, `refunds:read`, `disputes:read`.
4. **Bachs webhook endpoint `/api/bachs/webhook`:** subscribe it to
   `collection.succeeded`, `collection.failed`, `collection.underpaid`,
   `refund.paid`, `dispute.created` and `dispute.updated`, alongside the
   existing subscription events.
5. **Paystack:** the existing webhook URL already receives all events.
6. **Env vars:** nothing new. `BACHS_SECRET_KEY`, `BACHS_WEBHOOK_SECRET` and
   the Paystack secret (admin settings) are already in use.

## Gap Ledger (Part 3)

| Item | Status |
|---|---|
| Issuing a refund from the admin (`POST /v1/refunds` / Paystack refund API). Today refunds are issued in the provider dashboards and their webhooks update us. | planned |
| A live end-to-end payment on a sandbox | **owner action** (needs keys) |
| Rendering live campaigns on the site | Part 4 |

# Part 3 extension — the payment flow on the Frenz AI UI (2026-10-08)

Commit b4f7bc5, plus the tap-once follow-up (80a9ece).

| § | What shipped |
|---|---|
| 51–52 | One step rail: Character Replace's stepper became `features/ai/design/ai-step-rail.tsx` (`AiStepRail`). The ad flow shows Format / Placement / Creative / Review / Payment. The progress line moves by transform only. |
| 53–55 | The Review step is the payment page: `CampaignSummaryCard` (details, total, NGN note), a secure-checkout line, rules confirmation, and the CTA on the sticky `AiActionBar` (mobile). CTA states: "Continue to Payment" → "Preparing Payment…" → "Opening Secure Checkout…". The CTA is disabled while a request is in flight. |
| 56–58 | `payment-return.tsx`: one status block per server state, with compact Payment / Verified / Live marks. "Paid" appears only when the server reports `success`. Pending, could-not-verify and failed each have their own copy. Leaving the page aborts the request (`AbortController`). There is no polling loop. |
| 59 | When the quote expires, the flow stops on "Your payment session expired" and offers Review Campaign, which loads a fresh catalog. A server price that differs from the estimate is shown before payment. The price is never re-quoted silently. |
| 60+ | Dark mode: every ad surface uses app tokens or `dark:` pairs. |
| perf | The upload step is code-split and warmed one step early. `/advertise/create` dropped from 19.9 kB to 17.5 kB. |
| follow-up | Every advertising button answers the first tap: `AiButtonLink tapOnce` → `TapOnceLink`, with the Earn button's pending look. The wizard shows "Saving…" and "Discarding…". This is pinned by `features/ads-platform/instant-buttons.test.ts`. |

# Part 5 — serving, rotation and delivery on SHARED slots (2026-10-08)

Briefs: docs/AD_PLATFORM_PART5_BRIEF.md and the owner's shared-slot addendum,
docs/AD_PLATFORM_PART5_SLOTS_ADDENDUM.md (both verbatim). Local commits only.

## The shape

```
Admin config -> Supabase (ad_serving_snapshot) -> /api/ads/self (CDN, 5-min bucket)
   + settings.ad_slot_provider_order                  (only when inventory self:true)
existing container (one physical slot) -> useSlotProvider(slot) -> resolveSlotProvider(order)
   - "frenzsave": paid creative rendered IN this container
   - "network":   the container's existing network unit, unchanged
   - null:        nothing (collapses as before)
local rotation (one setTimeout) -> CDN media -> impression (>=50 %, 1 s) -> batched rpc/track_ad_events
```

- **Registry:** `lib/ads-platform/slot-registry.ts`. One identity per physical
  location. The slot id **is** the existing network zone id where one exists.
- **Resolver:** `resolveSlotProvider` takes the first *available* provider in
  the admin's order. The order lives in `settings.ad_slot_provider_order`
  (`{ slotId: ["frenzsave","network"] }`); the registry default is paid first,
  and an admin can reverse it with no deploy. When a network zone reports empty,
  the next provider takes the slot. Deciding loads no provider: the decision
  reads the cached payload and the shared inventory.
- **Slot fit (§55):** `creativeFitsSlot`. A 10:1 top-banner creative never
  lands in a 1.6:1 card, and a 9:16 video never lands in a card.
- **Moments** (download complete, return to tab, AI save) are slots too. A
  paid campaign claims the moment (`lib/ads-platform/moment-events.ts`). The
  network unit for the same moment checks the claim and stands down, so one
  moment shows one ad.

## Slot inventory (audit of the codebase, 2026-10-08)

Providers inside a "zone" are whatever rows the operator configures for it
(AdSense, Adsterra/iframe, script, native, ExoClick rows); that ladder is untouched.

| # | Physical location | Component | Existing provider(s) | Canonical slot | Paid (Frenzsave) | Duplicate? | Action |
|---|---|---|---|---|---|---|---|
| 1 | Fixed under header, content pages (not `/`, `/library`) | TopPageBannerAd | zone `top_banner` | `top_banner` | global_top_banner, 10:1 | no | **shared**. The paid creative renders in this container; the separate 32 px strip was removed (owner: "use the existing top banner slot") |
| 2 | Sticky top of /downloads | StickyTopAd | zone `bottom_banner` | `downloads_top` | global_top_banner | ⚠ same zone row as #3 on the same page | **shared**. The duplicate is reported, not changed |
| 3 | Bottom bar above the nav, all pages | TopBannerAd (AppBottomAd) | zones `bottom_banner`, `mobile_bottom_banner` + ExoClick bottomnav in ONE container | `bottom_banner` | — | no (already one container) | kept |
| 4 | Under the Download button | AdSurface (DownloadPageCore, Downloader) | zone `under_download` | `under_download` | download_page_banner, 320×200 | no | **shared** |
| 5 | Under the download result | ResultAd | zone `download_result_page` | `download_result_page` | download_result_banner, 320×200 | no | **shared** |
| 6 | Feed, every few posts | FeedAdSlot → AdSurface | zone `feed_inline` | `feed_inline` | feed_banner | no | **shared** |
| 7 | Feed, Hilltop positions | HilltopFeedAd | Hilltop | (network-only) | — | no (its own composed positions) | kept |
| 8 | Reels slide, every 3 reels (and AI Reels) | ReelsAdSlide | zone `reels_interstitial` | `reels_interstitial` | reels_banner | no | **shared** (wallpaper reels: network only) |
| 9 | Landing: above the platform strip; SEO pages | AdSurface | zone `homepage_top` | `homepage_top` | — | no | kept |
| 10 | Landing: between sections | LazyAdSurface | zone `landing_section_break` | `landing_section_break` | — | no | kept |
| 11 | Landing: under the wallpaper button | LazyAdSurface + HilltopSlot + LazyExoClickSlot | zone `landing_under_wallpaper` + Hilltop + ExoClick, **all three mounted** | `landing_under_wallpaper` | — | ⚠ **B: three providers in one location** | reported. Consolidating changes live network revenue, so it waits for the owner's call (Part 6 admin order) |
| 12 | Downloader: above the fetch box | AdSurface | zone `downloader_above_fetch` | same | — | no | kept |
| 13 | On the fetched result | ExoClickSticky + FetchedAd + ResultOffer | ExoClick, zone `result_top`, offer | `result_top` | — | separate stacked units | kept |
| 14 | While the file prepares | PreparingAd | zone `download_preparing` | same | — | no | kept |
| 15 | Multi-Link (4 places) | MultiLinkPanel, SourceCard, FetchAdGate | zones `multilink_*` | same | — | no | kept |
| 16 | History: above the grid / between periods | HistoryGridAd (ExoClick), AdSurface + HilltopSlot | ExoClick; zone `history_between_periods` + Hilltop **together** | same | — | ⚠ B: zone + Hilltop at one spot | reported (as #11) |
| 17 | Download history top/bottom; history complete | DownloadHistoryAd, HistoryCompleteAd | zones `download_history_*` | same | — | no | kept |
| 18 | History story ad (media viewer) | StoryAdSlide | zone `history_story_ad` | same | — | no | kept (it is not social Stories) |
| 19 | Blog sidebar | AdSurface | zone `sidebar` | same | — | no | kept |
| 20 | Download-complete moment | DownloadCompleteAd + VAST download-complete + Monetag moment | zone `download_complete`, Hilltop/ExoClick VAST, Monetag | `download_complete` | download_completed_interstitial | already coordinated (panel stands down for the VAST) | **shared** (claim) |
| 21 | Return / idle moment | IdleInterstitial + VAST idle/back-swipe | zone `idle_interstitial`, VAST | `idle_interstitial` | interstitial | no | **shared** (claim) |
| 22 | Download / batch / wallpaper gates | DownloadInterstitial, batch gates, wallpaper reward ad | zones `idle_interstitial`, `batch_*`, `multilink_fetch_gate`; GPT rewarded | same | — | no | kept |
| 23 | Exit intent | ExitIntent | zone `exit_intent_popup` | same | — | no | kept |
| 24 | Page-level scripts | AdScripts, MonetagClient, HilltopVideoSlider, GoogleTag | zone `global`, Monetag, Hilltop, AdSense | same | — | no | kept |
| 25 | Unmounted components | RewardedAdGate (`reward_video`), WallpaperRewardGate, AdSenseUnit, ExoClickUnit, MonetagTags, BatchAdGate | — | — | — | D: unused (no mount found) | left in place, listed |
| 26 | **Frenz AI hub, end of page** | SelfAdSlot | none existed | `ai_hub_card` | ai_banner | — | **new** (addendum §7: no slot existed, sold placement, admin can disable) |
| 27 | **Between two people's Stories** | StoryViewer → SelfStoryCard | none existed (social Stories had no ad) | `stories_between` | stories_card | — | **new** |
| 28 | **Beside an AI video save** | SelfMoments | none (network reward ads for AI were removed 2026-09-13) | `ai_save_moment` | ai_video_save_reward | — | **new**. It never gates the save |

- **TOTAL EXISTING PHYSICAL AD LOCATIONS DISCOVERED: 25** (rows 1–25; the zone catalogue has 31 zone ids, several sharing a location).
- **TOTAL CANONICAL SLOTS AFTER CONSOLIDATION: 28** (25 + 3 new).
- **NEW PHYSICAL SLOTS CREATED: 3** (`ai_hub_card`, `stories_between`, `ai_save_moment`). Each has no network zone; each is in the registry, and each is off when the admin disables its placement.
- **DUPLICATE PHYSICAL SLOTS REMOVED/CONSOLIDATED: 1.** The separate paid top strip I had first built was folded into the existing `top_banner` / `downloads_top` containers.
- **Pre-existing network duplicates found and reported, not changed:** #2/#3 (one zone row on one page twice), #11 (three providers mounted in one spot), #16 (two providers in one spot).

## Verified (local production build, fake campaign injected at the network layer)

| Check | Result |
|---|---|
| Top banner: 10 ads, 5 s local rotation | in the existing `top_banner` container (1 container), 37 px creative in its 54 px bar on a phone. **0** payload requests per swap; the network zone is not requested while paid holds the slot |
| Media | current creative + the next image only; videos never preloaded |
| Events | visible, loaded and impression (≥50 %, 1 s), then click: batched to `rpc/track_ad_events`, nothing per frame or tick |
| Download-complete moment | only on the manager's completion event; focus on Close, scroll locked then restored, Escape closes; a batch shows one ad |
| AI save | the sponsor video appears beside the save; a broken video closes itself; the save never waits |
| AI hub card / under-download card | rendered in their slots (320×200, `aspect-ratio`, no shift) |
| Expired / empty / global off | 1 payload request, 0 media, 0 events, nothing shown |
| No live campaign (`self:false`) | **0** payload requests, 0 ad-layer chunks loaded |
| Ads on vs off: landing | LCP 192–220 ms vs 220–224 ms; CLS 0.003 both |
| Ads on vs off: /ai, /academy | LCP 168→176 ms, 132→148 ms; CLS unchanged |
| Bundle | the slot hooks import only the shared inventory check + the lean box registry; the engine (`paid-runtime`), every renderer and the moments are dynamic imports fetched only when a campaign is live. All route budgets pass: landing 220 kB (ceiling 218 kB cold-entry measure passes), `/home` 368.9 kB (ceiling 370) |
| Tests | `features/ads-platform/serve/part5-serving.test.ts` (37) + the scan for no polling or Realtime now covers `serve/`; 2 mutants (failed-creative skip, reward limit) caught |

Not measured here: real iPhone/Android devices, throttled 3G, memory. A real
campaign will need a live probe after the push (as in Part 1). A fresh local
build reloads the page a few times (deploy check), with or without ads; the
one "extra" payload request seen in testing was that new document, not the
rotation.

## The 25 questions (§47)

1. Ads every 5 s? **No.** Rotation is local; 0 requests per swap (measured).
2. Client-side rotation? **Yes.**
3. Media proxied through Vercel/Railway? **No.** Straight from the storage CDN; no `next/image`.
4. Queries indexed? Serving reads `ad_serving_snapshot` (0195, active rows only) once per bucket per region; no history tables.
5. Only active campaigns? **Yes.** Server stage 1 plus browser stage 2 to the second.
6. Unpaid campaigns? **No.** `payment_verified` is required (server); the guard trigger blocks unpaid `active`.
7. Expired campaigns? **No.** The window is re-checked in the browser at each render (test + e2e).
8. Blocked creatives? **No.** `validation_status`/`url_validation_status` must be `valid`.
9. Same interstitial twice in a row? **No**, while another exists (200-moment test).
10. Can one broken creative break the system? **No.** It is skipped for the session and the rotation continues.
11. Empty inventory clean? **Yes.** Nothing rendered, no retry.
12. Global disable stops loading? **Yes.** `self:false` means 0 requests and 0 chunks.
13. Analytics batched? **Yes.** ≤20 per batch, 10 s, or on page hide.
14. Realtime avoided? **Yes** (scanned by a test).
15. Timers/observers cleaned up? **Yes.** One timeout, stopped while hidden and on unmount; IntersectionObservers disconnected.
16. Videos paused/unloaded? **Yes.** They play only at ≥50 % visible, pause when hidden, `src` is released on unmount, and they share the video coordinator.
17. Anonymous? **Yes** (all e2e runs were guests).
18. Signed-in? Same path; ad-free plans get nothing (`useShowAds`). Not run with a real session.
19/20. iOS PWA / Android? Built on the existing safe-area, visibility and coordinator patterns; **not device-tested**.
21. Frenz AI experience? Only the hub end card, never inside a creation flow; the AI save never waits.
22. Railway/Vercel cost? At most one CDN-cached function run per bucket per region; nothing per impression, click or rotation.
23. Admin config? Formats, placements, durations, video limit, slot count, rotation, gap, global switch and provider order are all data.
24. Payment/campaign architecture? Untouched.
25. Ad failure leaves the product working? **Yes.** Every path fails empty; network units fall back unchanged.

## Gap Ledger (Part 5)

| Item | Status |
|---|---|
| Admin screen for slots + provider order (registry + `ad_slot_provider_order`) | **Part 6**. Upgrade the existing admin; no duplicate (owner, 2026-10-08) |
| Network duplicates #2/#3, #11, #16 | **owner decision**. Consolidation changes live revenue |
| Network-first order for a *moment*: no paid fallback when the network then fails to fill | known limit (the VAST answer arrives async) |
| `ai_save_moment` vs the standing "no reward ads for AI" rule | built non-gating; **owner decision** stays open (HANDOFF) |
| Slot id on ad_events rows | derivable (campaign → placement → slot); `track_ad_events` unchanged |
| Device + throttled-network measurements | not run in this environment |

# Part 6 — the advertiser dashboard and campaign management (2026-10-08)

Brief: docs/AD_PLATFORM_PART6_BRIEF.md (verbatim). Shared-slot rules apply:
campaigns use the canonical slots; nothing here creates a slot.

## Reused (audit)

The existing pieces, all reused: the member session (no separate advertiser
login) and `advertiserRoute` (session, rate limit, plain-word refusals); the
campaigns, creatives, quotes and the `ai_topup_attempts` ledger, with
Paystack and Bachs, their webhooks and `ad_payment_settle`; `activate_ad_campaign`
(now also the advertiser's resume); signed uploads into the private staging
bucket and the server-side byte probe; `ad_campaign_daily_stats` (aggregates);
`ad_campaign_events` (audit); `sendSmartPush` (push + Notification Center) and
`sendProductEmail`; the Frenz AI panels, chips and buttons; the existing
/advertise/campaigns page, upgraded in place.

## What was added

| Piece | What |
|---|---|
| `supabase/migrations/0198_ad_platform_dashboard.sql` | creative status `staged`; `ad_swap_creative`, `ad_edit_creative_details`, `ad_advertiser_pause` (owner, row lock, expected version, audit); `ad_campaign_extensions`; `ad_price_for` (the ONE price rule, now also behind `ad_campaign_quote`); `ad_extension_quote`; `ad_apply_extension`; extension branches in `ad_payment_begin` / `ad_payment_settle` (copied from 0197, then extended); `ad_my_summary` / `ad_my_payments` (owner-scoped, browser-callable). Write functions are service-role only. |
| `lib/ads-platform/campaign-manage.ts` | replacement ticket and finalize-then-swap, details edit (link checked server-side, never fetched), pause/resume, extension quote; admin policy `settings.ad_advertiser_controls` |
| `lib/ads-platform/ad-notify.ts` | push + in-app + **email** for: payment verified, live, needs review, creative approved/rejected, paused, resumed, extended, extension held. Each channel is guarded on its own; never able to break money. |
| `POST /api/ads/advertiser/manage` | the one action endpoint; reads never come here |
| `features/ads-platform/my-campaigns.tsx` (upgraded) + `dashboard/*` | Overview · Campaigns (search, filter, sort, pagination) · Analytics (7 / 30 / lifetime) · Payments · Rules & help; campaign detail in place (`?c=<id>`) |

## How a live edit works

1. **Replace the image or video:** the new file is staged (never served). Its
   bytes are probed exactly like a new ad's. If valid, `ad_swap_creative`
   swaps it in one transaction: the old creative becomes `removed` (row and
   file kept for audit), the new one becomes `active`. The campaign id,
   payment, slot, start and end are unchanged. If the file is invalid, nothing
   changes and the advertiser is told.
2. **Headline, description, link:** the link is checked (https only, no
   scripts or credentials, admin blocklist; never fetched, so there is no SSRF
   surface), then applied in one statement. A refused link leaves the old one.
3. Every write takes the version the advertiser saw; a concurrent edit is
   refused as `stale`, never silently overwritten. Blocked or expired
   campaigns can't edit.

## Extensions

`ad_extension_quote` prices placement × duration from the admin rows (same
promotion rule), opens one quote, and checks out through the same Paystack/Bachs
path. `ad_payment_settle` applies it once (`ad_apply_extension`): the end
moves by days plus bonus; the id, start and payment record stay. A duplicate
webhook returns `already`. A payment that lands after the campaign stopped is
`held` for a person, not lost or applied. Changing placement or format on a
live campaign is NOT offered: that is a new campaign (the platform cannot move
a paid slot safely).

## Verified

- **SQL executed** in PGlite with the real 0151/0186/0188/0195–0198: **48/48**
  checks. They cover staged-not-served, refused swap keeping the old creative,
  IDOR, stale, blocked, the atomic swap, an admin pause the advertiser can't
  lift, resume through activation, extension quote → begin → short payment
  refused → settle (+7 days, same id and start) → duplicate webhook ignored,
  expired campaign, owner-scoped summary and payments, and grants. Two mutants
  (no validation check on swap; no owner check) each failed.
- `lib/ads-platform/part6-dashboard.test.ts` (28) + full suite green.
- Browser (local production build, fake signed-in advertiser and fake data at
  the network layer), 390 px and 1280 px: overview totals, campaigns,
  analytics, payments, detail; an edit sends only the changed field with the
  version; the extension shows the server's price first; an expired campaign
  shows no edit actions; someone else's id shows "Campaign not found"; no
  horizontal overflow. Every dashboard read went browser → Supabase; the only
  app function the dashboard called was the edit action.
- Budgets: /advertise/campaigns is static (177 kB first load); all route budgets
  pass.

Not run: a real upload + swap against live storage, and a real extension
payment on a sandbox (needs keys). Both reuse code paths verified in Parts 2–3.

## Gaps (Part 6)

| Item | Status |
|---|---|
| Destination reputation (phishing / malware feeds, redirect chase) | still syntax + admin blocklist (as Part 2); a feed is a Part 7 decision |
| "Approaching expiry" reminder | not sent: there is no cron by design; could ride the lifecycle sync later |
| Refund of an extension | via the provider dashboard, then the admin (Part 7) |
| Old creative files | kept for audit (rows `removed`); no cleanup job yet |
| Hidden analytics multiplier | **declined**: advertisers see the database's real counts |
| Admin screens for `ad_advertiser_controls`, slots, prices, campaigns | **Part 7** (upgrade the existing admin) |
| 0198 applied to production | on push, then a live probe (runner hard law) |

---

# Part 7 — the admin side (2026-10-09)

No separate brief exists. The scope is every item that the Gap Ledgers of
Parts 1–6 assigned to "Part 7 / the admin". It was built by upgrading the
existing Admin → Ads panel, with no second admin. Slots and campaign lengths
keep their places in Ad placements. Campaign payments keeps its tab.

- Migration: `0204_ad_admin_moderation.sql`
- Admin → Ads → **Campaigns** (`features/admin/ad-campaigns-desk.tsx`) and
  **Self-serve rules** (`features/admin/ad-platform-controls.tsx`). Both load
  lazily, fetch only once their tab is shown, and never poll.
- Routes (admin-only, 404 otherwise):
  - `/api/admin/ads/campaigns`
  - `/api/admin/ads/advertisers`
  - `/api/admin/ads/platform`
  - `/api/admin/ads/pricing`
- Server code:
  - `lib/ads-platform/admin-campaigns.ts`
  - `lib/ads-platform/admin-platform.ts`
  - `lib/ads-platform/admin-shared.ts` (client-safe)

## What the admin can do

**Campaigns** has four views: Needs review (paid or validating), Live & paused,
Refunds owed, and All. Each campaign card shows:

- the advertiser and their status, the placement, the length, and the money
- the creatives (image or video preview, headline, link, media and link check
  states)
- the review flags in plain words, delivery totals, and the audit history

The actions each run one database call (`admin_moderate_ad_campaign`) under a
row lock, using the version the admin saw:

| Action | From | What happens |
|---|---|---|
| Approve | paid, validating | Checks that were only **pending** (media, link) pass. Invalid or blocked ones stay refused. Then `activate_ad_campaign` reruns every check. If something still blocks the campaign, the admin sees why in plain words. |
| Pause | active | `admin_paused`. The advertiser cannot lift it (0198 only lifts `advertiser_paused`). |
| Resume | paused | Through activation again. The original dates and the slot are kept. |
| Reject | paid, validating | A reason is required and shown to the advertiser. A refund is owed. |
| Remove | anything not removed | A reason is required, and the admin must confirm. A refund is owed if it was paid. |

The advertiser hears about each decision by push and email (`ad-notify`). New
notices: `paused_by_frenzsave`, `rejected`, and `removed`. The last two
mention the refund when one is owed.

**Refunds owed.** On reject or remove of a paid campaign, `ad_refund_owed`
records what is owed:

- the whole amount if the campaign never started
- otherwise the unused share of its paid time, rounded down

Nothing is paid automatically. The admin sends the refund in the Paystack or
Bachs dashboard, then clicks **Mark refunded** (or **Waive**, with a note). The
provider's refund webhook already updates the payment record
(`ad_payment_reverse`, 0197). The decision can be made once.

**Advertisers.** The admin can set an advertiser to active, restricted,
suspended or disabled (`admin_set_advertiser_status`). Any status other than
active needs a reason and pauses that advertiser's live campaigns at once.
Reactivating resumes nothing automatically: the admin resumes each campaign.

**Self-serve rules** puts the 0195/0197 columns on screen:

- **Switches:** the kill switch (`ads_enabled`), applications open, and
  checkout open
- **Numbers:** slot count, quote lifetime, and the late-checkout window
- **Policies:** the refund-after-start policy and the chargeback action
- **Advertiser controls:** the five `settings.ad_advertiser_controls` switches
- **Blocked destinations:** a host and its subdomains, normalized from
  whatever the admin pastes
- **Prices:** a placement × length grid in USD (quotes are USD, 0198)
- **Promotions:** create, edit, and on/off. The database applies the biggest
  matching discount.

## A bug fixed on the way

0195's `activate_ad_campaign` moved a **paused** campaign that failed a check
(for example, its placement was switched off) to `validating`. The next
activation then treated it as new: a second slot and fresh start and end
dates, which is free time. 0204 re-creates the function, copied whole, with
one change: a paused campaign keeps its status and records the flags.
Advertiser resumes (0198) benefit too.

## Verified

- **0204 executed in PGlite** on the real 0195–0198, applied twice, with 20
  checks:
  - approve passes pending checks and goes live
  - approve cannot lift an invalid creative
  - a stale version is refused
  - an admin pause cannot be lifted by the advertiser
  - a paused campaign failing a check stays paused, and resumes with its
    original end and one slot
  - remove needs a reason
  - removed halfway, the campaign is owed 499 of 1000
  - rejected before it ran, it is owed 1000
  - a refund is marked once and cannot be waived afterwards
  - a suspension needs a reason and pauses live campaigns
  - a suspended advertiser's campaign cannot resume
  - grants are service-role only

  Four mutants each turned the run red: the 0195 paused rule, a full refund
  after a start, approve lifting invalid media, and suspension without pausing.
- `lib/ads-platform/part7-admin.test.ts` pins:
  - the SQL rules, with teeth
  - the desk offering only legal transitions, with teeth
  - words for every activation flag
  - blocked-domain normalization
  - every handler gated, with teeth
  - the lazy, show-only fetching
- The full suite and the build are green. Every route budget passes (`/admin`
  is 372 kB first load).

Not run:
- A browser pass on the two panels. The admin page needs a real admin
  session, which this container cannot reach.
- A live probe of 0204 (production is blocked from here). It is listed in
  HANDOFF.

## Gaps (Part 7)

| Item | Status |
|---|---|
| Paying a refund through the provider's API (Paystack has `/refund`, Bachs is unknown) | **not built**. The admin refunds in the dashboard. Automating it moves money and needs the owner's say. |
| Refund of an **extension** on its own | still through the provider dashboard. The campaign's owed amount covers the base payment only. |
| Destination reputation feed (phishing / malware) | **decision needed**. Today there is the syntactic check plus the admin blocklist, which is now editable. |
| A paused campaign's clock keeps running | still **decision needed** (Part 1 ledger). |
| Bulk actions, an admin email to an advertiser, CSV export | not built (no ask yet) |
| 0204 applied to production | on push, then a live probe |

---

# Part 8 — analytics, fraud prevention, safety, advertiser quality (2026-10-09)

Brief: `docs/AD_PLATFORM_PART8_BRIEF.md`. Migration: `0206_ad_traffic_quality.sql`.

## Audit (before any change)

| Area | Found | Class | Part 8 |
|---|---|---|---|
| Ad event ingest `track_ad_events` | Browser → Supabase RPC, batched (20 / 10 s / page hide), dedupe by event id, granted to anon | **insecure**: public ids + anon key = unlimited fake events counted for paying advertisers. No rate limit, no window check, wrong types accepted | rewritten in place (same cheap path) |
| Impression rule | ≥50 % visible for 1 s (IntersectionObserver) | implemented, but a hidden tab could still count | also requires a visible tab |
| CTR | clicks ÷ impressions | could exceed 100 % (a click needed no view) | a click counts only after a view |
| Viewability / fill rate | none | missing | see metric definitions |
| Reward completion | client `onEnded`, and `/complete` had no minimum time | insecure by design (documented). It unlocks downloads only, never credits | 5 s server floor and a completion-vs-length check |
| Fraud and risk | the Upstash limiter (not on ad ingest), a manual reward restriction, a UA regex used only for tagging | incomplete | a risk layer inside the ingest, flags, an admin centre |
| IP hashing | three schemes in six places, some unsalted | duplicated / insecure | ads use one daily-salted hash (others left for Part 9) |
| Destination checks | syntax + admin blocklist; never fetched; never re-scanned | incomplete | heuristics, reputation, a restricted redirect probe, rescan |
| Creative checks | magic bytes + range probe + format rules | implemented. Two problems: unchecked bytes could be published (overwrite race), and there is no content check | lock-then-check, type match, content moderation |
| Admin and alerts | Part 7 desk. `sendAdminAlertOnce` exists; no fraud alerts | incomplete | Traffic & safety tab + hourly alert digest |
| Retention | raw events pruned at 35 days on CDN misses | implemented | configurable, plus hash and flag retention, cron |
| `/api/media/download` proxy | streams any Supabase object; a `/wallpapers/` substring skips sign-in | **insecure** (not ads) | **Part 9** (media paths) |

## Event pipeline

**EVENT → VALIDATION → DEDUP → RISK → QUALIFYING COUNTS → AGGREGATES → ADMIN REVIEW**, all inside the one batched RPC. There is no new service and no per-event function.

**Validation.** An event is refused, and counted only in `ad_invalid_daily`, when:
- the creative and campaign do not match;
- the campaign is not paid, not active, outside its window, or its advertiser is inactive (with 15 minutes of grace for an in-flight batch);
- the event type does not fit the format (for example, a reward completion on a banner);
- its client time is older than 24 h or more than 10 min in the future.

**Dedup.** By event id, as before.

**Risk.** Any one signal keeps the row as evidence (`qualifying = false`) but does not count it. Thresholds live in `ad_platform_settings.traffic_rules` and are editable.

| Signal | Rule |
|---|---|
| Bot | an automation user agent, or none |
| Internal | an admin |
| Self | the advertiser's own account |
| Frequency | more than 20 impressions per visitor per campaign per hour, or more than 200 per network |
| Click without a view | no view of the same creative by the same visitor within 30 min |
| Repeat clicks | more than 3 per visitor per campaign per day, or more than 30 per network |
| Completion | no start, or faster than 0.8 × the video length (by the browser's clock) |

**Ingest rate.** More than 600 events per minute from one network, or more than 240 from one visitor, refuses that batch. Nothing is banned.

**Shared networks.** 30 visitors behind one network all count (PGlite check). A network on its own never filters anyone.

**Escalation.** Each batch checks today's counters for the campaigns it touched and raises one flag per kind, campaign and day (`ad_risk_flags`):
- `invalid_traffic`: at least 100 events, more than 50 % of them filtered
- `click_anomaly`: at least 50 filtered clicks
- `creative_load_failures`
- `self_traffic` (on the advertiser)

Also raised:
- `payment_*`, from a trigger on the payment ledger: chargeback, mismatch, verification required, refunds
- `unsafe_destination`, from the blocklist rescan, which also pauses the campaign

## Metric definitions (advertiser and admin use the same ones)

**Impression (view).** At least 50 % of the ad on screen for one continuous second, in a visible tab, and qualifying. This meets the common display-viewability bar, so **every counted impression is a viewable impression**. No separate viewability rate is shown.

**Click.** The ad's detail opened after a view, qualifying, and capped per visitor per day.

**CTR.** Clicks ÷ impressions, both qualifying. Shown as "—" with no impressions.

**Watched to the end.** `video_complete` / `reward_video_complete`, both qualifying.

**Filtered.** `invalid_impressions + invalid_clicks`. Advertisers see the total; the reasons are admin-only.

**Fill rate.** **Not measured** for self-serve. Measuring it would need an "eligible slot" event per rotation, which the brief forbids for cost. It is not shown anywhere.

**Spend.** From verified payment records (`ad_my_payments` / `ad_my_summary`). Refunds and chargebacks are separate rows. Network-provider metrics are never mixed in.

The public text is `TRAFFIC_QUALITY_POLICY` on `/advertise/rules#traffic-quality`. It says what each figure means, that invalid traffic is filtered, and that nothing is guaranteed. It does not say how detection works.

## Destination safety (`lib/ads-platform/url-safety.ts`, `server.ts` `checkDestination`)

**Always, with no network.** The checks run in this order:
1. syntax (https, no IP literals, no credentials, port 443 only)
2. block: redirect parameters carrying a URL, known open redirectors, `.zip` / `.mov` domains, an embedded URL in the path
3. review: a brand's name in a stranger's domain (look-alike digits normalised), internationalized hosts
4. the admin blocklist

**Deep.** Runs at submission, link edit and activation:
- **Reputation:** Google Safe Browsing v4, when `GOOGLE_SAFE_BROWSING_API_KEY` is set. This sends the URL to Google; the page itself is never fetched.
- **Redirects:** a restricted probe of where the link really goes:
  - HEAD only, https and port 443 only
  - DNS answers checked, with private, loopback, link-local, CGNAT and metadata addresses refused, and the socket pinned to the checked address
  - at most 5 hops in 4 s, with no body read
  - every hop re-checked
  - landing on another domain → a person reviews it

**Safe-failure.**
- A blocked link is refused.
- A doubt holds the link for a person (`pending`). Pending links never serve.
- If reputation is configured but unreachable, the link goes to review.
- If the link is unreachable, it goes to review.
- An admin approval remembers the exact URL (`url_approved_url`), so later automated passes don't hold it again.

**Live campaigns.**
- When an admin blocks a domain, `ad_rescan_blocked_destinations` blocks matching creatives and pauses their campaigns. Serving drops them within one 5-minute bucket.
- The rescan also runs every hour.

## Creative safety (`creative-moderation.ts`, `advertiser-server.ts`)

**Locked before checking.** The upload is copied (inside Supabase) to `*.checked`, a path the browser's signed upload URL cannot write. It is probed and published from there, which closes the audit's overwrite race.

**Type match.** The sniffed type must equal the declared one (`type_mismatch`).

**Content.** This reuses the repo's existing Claude moderation integration (`ANTHROPIC_API_KEY`, `MODERATION_MODEL`, direct fetch):
- The image, or a video's poster, is passed **by signed storage URL**, so the bytes never pass through Vercel.
- The headline, description, business name and link host are checked at submit and at edit.
- A rejection blocks the creative.
- A review publishes the bytes but holds activation (`safety_review`), and refuses a live edit or replacement. The live creative keeps serving.
- No key configured means `skipped`, a recorded gap rather than a pass.
- A failed call means review.
- A video without a poster means review. Frames beyond the poster are not inspected.

**Payment and safety stay separate.** Payment never makes a creative valid, and a valid creative is never live without verified payment (the 0195 guard is unchanged).

## Admin: Traffic & safety (Admin → Ads)

- **Flags:** severity, evidence counts (never an IP or hash), when first and last seen, hits.
- **Decisions:** Dismiss or Confirm, each with a required note. Confirming a traffic flag can exclude that day's counts, recorded in the evidence and in `ad_campaign_events`.
- **Recheck:** reruns every creative and link check on a campaign.
- **7-day traffic:** counted vs filtered per campaign, and the filtered reasons.
- **Creatives and links** that failed or wait on a person.
- **Payment items:** a count, linking to Campaign payments.
- **Traffic rules:** each edited within bounds.

Pausing, removing and suspending stay in the Campaigns tab (Part 7), with no duplicate. Normal campaigns still activate automatically: only failures and threshold crossings wait.

## Privacy and retention

- The IP is never stored. `ip_hash` = sha256(private salt, UTC day, IP), so it cannot be linked across days, and it is dropped after `ip_hash_retention_days` (default 7).
- Raw events are deleted after `raw_retention_days` (default 35, editable).
- Resolved flags are deleted after `flag_retention_days` (default 365).
- Daily stats are kept: they hold no personal data.
- Advertisers can read only their own daily stats (0195 RLS). `ad_invalid_daily` and `ad_risk_flags` are admins only, and `ad_private_settings` no client role can read.
- Ad events respect the analytics opt-out (`frenz_analytics_off`).

## Monitoring and housekeeping

The hourly job `app/api/cron/ad-housekeeping` is clocked by `.github/workflows/cron-ad-housekeeping.yml` and needs the `CRON_SECRET` Actions secret, like the other crons. It runs:
- retention
- the blocklist rescan
- creative file cleanup: removed creatives after 30 days, abandoned *staged* replacements after a day, never an active creative
- **one** deduped admin email for new high and medium flags (`sendAdminAlertOnce`)

Decisions never wait on the alert.

## Media paths

- Uploads go browser → signed URL → Supabase Storage (private staging).
- Checks are range reads of at most ~8 MB, and moderation reads by signed URL.
- Publishing is a storage-to-storage copy.
- Delivery is a Supabase public CDN URL straight to the `<img>` / `<video>`.

No ad media passes through a Vercel route or Railway. The one route that *could* proxy any public object, `/api/media/download`, is insecure and is fixed in Part 9.

## Verified

- **PGlite:** 0206 ran on the real 0195–0205, applied twice, with 33 checks. The 0204 suite still passes 20/20 against the new copies. Five mutants each failed: no view check, no click cap, no bot rule, no eligibility window, no speed check.
- **Tests:** `lib/ads-platform/part8-traffic.test.ts` covers the URL heuristics, private addresses, the probe's limits, moderation parsing and its safe failure, the upload lock, the 0206 pins (with teeth), the client fields, advertiser transparency, and the reward floor. Three older tests that encoded "the link is never fetched" were updated to the new design. The full suite is green.

**Not run here.** These need production or secrets:
- Safe Browsing (no key)
- Claude moderation calls (no key in this container)
- the redirect probe against the internet (the network policy blocks outbound requests)
- a live probe of 0206
- load testing beyond PGlite

The brief's test areas 9–11 (payment races, wrong amount or currency, refunds and chargebacks) were covered by Part 3's 0197 suite. 0206 adds only the flags.

## Limits (honest)

- Client-reported events can still be forged by someone who mimics a real browser. The rules cut volume, repetition and impossibilities; they cannot prove a human. No fraud system can promise that.
- `visitor_id` is minted by the browser, so a determined script rotates it. The per-network limits are the backstop.
- Network-provider ads (Monetag, ExoClick, AdSense, Hilltop, Offerium) report through their own dashboards. Frenzsave does not see their invalid-traffic decisions, and `verifyOfferiumPostback` is still unbuilt.
- The reward unlock cannot be proven watched without a provider server-to-server callback. The 5 s floor removes instant replays only.
