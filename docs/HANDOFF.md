# Hand-off — start here in a new session (updated 2026-10-09)

For AI assistants and engineers picking this repo up without prior context.
Read `AGENTS.md` first, then this file. This is the **current state**; the
governing rules live in `AGENTS.md`, `docs/CONSTITUTION.md` and the registries.

## 1 · Where things stand

| Area | State |
|---|---|
| **Self-serve ad platform** | Parts 1–7 shipped (engine, application, payments, serving through the shared slots, advertiser dashboard, and the admin side). Part 7 (0204) adds two tabs to Admin → Ads: **Campaigns** (review queue, live/paused, refunds owed, advertisers) and **Self-serve rules** (kill switch, advertiser controls, blocked links, prices, promotions). Slots and campaign lengths stay in Ad placements. Full write-up and Gap Ledgers: `docs/AD_PLATFORM.md`. |
| Payments | Paystack + Bachs as two rails under one router (`lib/payments/router.ts`, purposes `wallet_topup`, `ai_subscription`, `ad_campaign`). See `docs/PAYMENTS.md`. |
| Frenz AI credits | One wallet in CREDIT units (`ai_product_balances` / `ai_product_ledger`). Ads are **not** paid from credits. The balance has a withdrawable part (`withdrawable_cents`, 0187), and the rest is non-withdrawable. |
| Credit transfers | 0193 + **0199**: the sender chooses non-withdrawable or withdrawable. The amount and the fee come only from that kind, and the recipient receives the same kind. Cashing out still needs the recipient's own approval (0191). The credits page (`/ai/usage`) shows the two kinds apart. The AI and download credit strip keeps the total. Only the 7-argument function exists (`p_class`). 0202 re-applies its revoke/grant. |

| One experience | Since 2026-10-09 there is no Full Bleed / Downloader mode. The `frenz_mode` cookie, the switcher and the switch prompt are gone. Members' bottom nav: Home (`/downloads`), Feed (`/home`, the complete feed), History, Chats, Profile. Guests: Home, Earn (`/quests`), History, Support, Profile. Every tab has a label. |
| Download page + nav (2026-10-09) | The download page follows the improved reference (compact credits card counted in K/M, one-row Multi-Link card, 5-column platform grid with "+", static Frenz AI tile, Promote button docked beside the credits card). The bottom nav is a **floating glass pill** everywhere (14px side margins, max 560px, `--frenz-nav-gap` just above the home indicator); every surface reserves `--frenz-nav-clearance`. Members' Support moved into the profile menu footer beside the theme toggle. Measured cold entry (slow 4G, 4x CPU, local server): landing LCP ~1.3s, download page body ~1.2s — real TTFB and /downloads' server reads come on top. Inline layout scripts/styles ship comment-free (`lib/perf/inline-min.ts`). |
| Chat streaks | 0200 `conversation_streaks`, kept by a trigger on `messages`. A day counts when BOTH people sent a message (UTC). The flame shows beside a chat from 2 days. The streak left the site and app headers. Every streak celebration is the card-less `StreakFireBurst`. |

| Tokens / Credits | In the credits dashboard and the send sheet, the non-withdrawable part is **Tokens** (hexagon) and the withdrawable part is **Credits** (gem). Same unit. Earn and deposit screens keep the word "credits". |
| Deposited credits (0202) | A paid deposit now lands as **withdrawable** Credits, tracked in `deposited_cents`, and is spent earned-first. They can be sent (the deposited share stays deposited for the recipient) at `transfers.depositedFeePercent`, and withdrawn at `withdrawals.deposited` (its own rate and fee). Both are admin-editable. Deposits made before 0202 stay Tokens. ⚠️ Card deposits that can be cashed out carry chargeback and laundering risk: withdrawals stay admin-approved (0191) and paid out by hand. |
| Ads (0201, 0203) | A tapped paid ad opens its details in-page (`click` + `conversion`), and visiting is behind an external-link warning (`outbound`). The advertiser dashboard shows Conversions and Site visits. The HD and batch download gates take a paid reward video first (`hd_download_reward`, `batch_download_reward`), else the network's rewarded unit. Admins switch campaign lengths on or off in Ad placements. Stacked network units under the wallpaper button and between history periods rotate in one slot. |

### Live probes owed (production)

- **Railway build (2026-10-15):** the Docker build ran out of JavaScript heap (Node's ~2 GB default) during webpack. Reproduced from a clean checkout; the commit before that day's work failed the same way, so it is the app's size, not one change. Fixed with `NODE_OPTIONS=--max-old-space-size=4096` in the Dockerfile's builder stage plus `experimental.webpackMemoryOptimizations` (peak ~4.9 GB across the build's processes). If Railway's builder has less than ~5 GB of memory, the build is killed instead. Check the next Railway build log.
- **New deploys no longer reload the app on entry, resume or back-swipe (2026-10-15):** the version check only remembers a new build. The next tap on an in-app link loads its destination as a full page and brings it in (`lib/pwa/deferred-update.ts`, `register-sw.tsx`). Verified on a production build in Chromium: no reload on entry or resume with a new build live, and tap/back/forward stay client-side otherwise. ⚠️ Locally, stop every old `next start` before testing. A stale server on the port serves the previous build's HTML, and its 404'd chunks make every link a full load.

- **Whole-page translation (2026-10-15, docs/GLOBALIZATION_PLATFORM.md "Whole-page translation"):** needs `ANTHROPIC_API_KEY` (already set for moderation) and Upstash for the shared cache. Optional: `TRANSLATE_MODEL`, `RATE_LIMIT_TRANSLATE_PER_MIN`. Pick a language on the phone and check that a few pages, a sheet and a toast change, and that English restores them.

- **0242 is taken by `0242_ad_pricing_delivery_admin…`** (written in the owner's local checkout, not yet pushed). The History viewer and brand-name migrations were renumbered 0243 and 0244 on 2026-10-15 so the two never share a number. 0242 was committed locally on 2026-10-15 as the owner left it, plus one change: its views price applies 0246's discount when 0246 exists.
- **0246 (views volume discounts + full-screen ad likes/views/shares, 2026-10-15):** column `ad_platform_settings.views_volume_discounts` (default 50K 5%, 100K 10%, 200K 15%, 300K 20%, 500K 25%, 1M 30%, edited in Admin → Advertising Pricing & Delivery → Volume discounts); tables `ad_campaign_reactions` (who liked/shared: `u:<member>` or `v:<anonymous visitor id>`, no browser access) and `ad_campaign_engagement` (counts, the advertiser reads their own under RLS); functions `ad_views_discount_percent`, `ad_react`, `ad_engagement` (service role) and re-created `ad_views_price_for` + `ad_catalog`. Works with or without 0242, run before or after it (PGlite-tested in all three orders, plus a mutant). Until it runs: no discount, and full-screen ads show the rail without counts. The ad's views are impressions × `stats_multiplier`, the same figure as the advertiser's dashboard.
- **0244 (each ad shows its own application's brand, 2026-10-15):** column `ad_campaigns.brand_name` (backfilled from the account's current name, so nothing on screen changes) and the re-created `ad_serving_snapshot` (sponsor = the campaign's brand, else `advertisers.display_name`). Run after 0243. Until it runs, ads keep showing the account's name and submit logs a warning.
- **0243 (History viewer full-screen ad, 2026-10-14, docs/AD_PLATFORM.md "History viewer full-screen ad"):** one `ad_placements` row `history_story` (INTERSTITIAL, page `history`). Insert-only. Not for sale until an admin prices it. The site code works before and after it runs.

- **0240 (views-based campaigns, 2026-10-12, docs/AD_PLATFORM.md Part 9):** columns `ad_platform_settings.views_*`, `ad_placements.views_enabled/views_rate_per_1000_minor`, `ad_durations.views_enabled`, `ad_campaigns.pricing_model/target_views`, status `completed`; table `ad_campaign_delivery`; functions `ad_views_price_for`, `ad_views_capacity`, `ad_views_credit`, `ad_views_fulfil`, `ad_views_deadline(s)`, `ad_views_claim_notices` (service role only). Views pricing ships **off** (`views_enabled=false`) — the admin turns it on. The advertiser wizard step to choose views is the next part. **0238 + 0239 were NOT live when probed 2026-10-12** (private-post alerts, likes, comments).
- **0241 (slot availability + alerts + "ends soon", docs/AD_PLATFORM.md Part 10):** run AFTER 0240. Table `ad_slot_waitlist`; columns `ad_campaign_delivery.deadline_notified_at`, `ad_campaigns.expiry_notified_for`; functions `ad_slot_availability` (anon may read), `ad_slot_waitlist_due`, `ad_views_deadline_notices`, `ad_expiring_notices` (service role). The wizard and server fail open without it.
- **My ads (was Promote), 2026-10-15:** a glass pill with the megaphone and "My ads", opening /advertise/campaigns, in the /downloads top bar and the landing header. The violet disc in the /downloads hero is gone. Install, My ads and the bell fit the bar from 375 px (measured with a replica on the production CSS). Below that, in a browser tab, Install leaves this bar.
- **Watermarked downloads (2026-10-15):** the worker now encodes at most 720p on the shorter side (720p and below unchanged, never upscaled). On a 20 s test clip, 1080p went from 20.1 s / 15.8 MB to 15.1 s / 4.9 MB. The worker must be redeployed for this. The browser side says "Downloading… n%", and on iOS, when the long wait has used up the tap, the toast asks for one more tap ("Your video is ready. Save") instead of opening Safari's file page.
- **Ad videos (2026-10-12):** every ad video now goes to the worker first (480p MP4 + JPEG cover); Stream only if the worker is unreachable. The worker must be redeployed for it to take effect.

- **0212 (admin test mode ×10 — renumbered from 0211, which is now All slots):** column `ad_campaigns.stats_multiplier`, function `admin_set_ad_stats_boost`, and the re-created `ad_my_summary` (now returns `boosted`). Admin → Ads → Campaigns → each card has a "Dashboard sample data ×10" switch. Display only, per campaign, off by default; stored stats and billing stay real. The on-screen "Sample data" label was removed by the owner (ecca614), so boosted figures are UNLABELLED — turn the switch off before a real advertiser reads the dashboard. Turn it off when the Frenzsave advert is done.
  - 2026-10-09: an "All live ×10" switch in the Campaigns toolbar sets every live campaign at once (each still through `admin_set_ad_stats_boost`, each audited).
- **0213 (advertiser removes a campaign from their list):** column `ad_campaigns.advertiser_hidden_at`, and `ad_my_summary` re-created so campaign COUNTS leave hidden ones out (lifetime figures and spend still include them). Drafts/unpaid → cancelled through `transition_ad_campaign`; expired/rejected/cancelled → hidden only, never deleted. Live, paused and paying campaigns can't be removed. Before 0213 runs the list still loads (it retries without the filter) and Remove on a finished campaign says it isn't available yet.
- **Part 10 (2026-10-09):** selective prefetch of the full-screen paid moments (`features/ads-platform/serve/moment-warm.ts` — one still image per likely moment, from memory, never a video, never on Save-Data/2G; the moment shows the ad it warmed); the PIN auto-lock idle stamp now ticks only while visible (a hidden tab used to keep it "active" forever); the media carousel buffers neighbour videos only when not saving data. Timers/realtime audited: every recurring timer is visibility-gated, the wallet channel is ref-counted, no polling loops. Media through our functions stays bounded (`MEDIA_PROXY_MAX_BYTES`).
- **SEO system (2026-10-09):** public, static explainers at `/frenz-ai` (hub + 5 live tools + Kling + 2 tutorials) and `/advertise/{pricing,banner-ads,video-ads,campaign-guide}`, all from `lib/seo/guides.ts` (tests: `lib/seo/guides.test.ts`). The `/ai` TOOLS are unchanged — still noindex/Disallow. `/advertise` and `/advertise/rules` added to the sitemap; sitemap dates are real (guide `updated`, blog post date) rather than the build time. `/frenz-ai` is excluded from the middleware matcher (no session work on a static page). Search Console steps: `docs/SEO_LAUNCH.md`. Kling 4.0 is described only as announced; Character Replace (retired) is never offered.
- **Advertiser dashboard caching (2026-10-09):** every section reads through `features/ads-platform/dashboard/use-dash.ts` (the shared SWR cache): instant on entry and back-swipe, no focus refetch, re-read after a minute or after an action. The "Sample data" label's admin check now uses `/api/ads/advertiser/viewer` (the server's `getAdminUser`, which includes ADMIN_EMAILS — the DB's `is_admin()` missed an admin by email).

### Open from 2026-10-10 (start here next session)

1. **Landing cold entry — PROFILED 2026-10-10 (later session); no landing-specific
   blocker exists.** Harness (Playwright, iPhone 13, 4× CPU, 1.6 Mbps / 150 ms,
   local `next start`, `/api/app-version` mocked), 15 interleaved cold runs:
   `/` FCP median 2.08 s vs `/tiktok-video-downloader` 2.44 s — the "0.5 s vs
   1.8–3.2 s" gap does not reproduce. The CPU trace shows what precedes first
   paint on EVERY page (even `/terms`): the first style+layout pass, ~300–600 ms
   at 4×, of which ~175 ms is `FontCache::CreateFontPlatformData` (Chromium on
   WINDOWS loading 13 system font files) plus text shaping. That cost is the
   test machine's, not an iPhone's, and it makes local FCP swing 1.3–3.2 s run
   to run. Tried and REVERTED: per-section `content-visibility` on the landing
   (n=10 injected: FCP −300 ms; n=15 on a real build: +230 ms — inside the
   noise, so it did not ship). The shared stylesheet is 395 KB raw / 58 KB gz
   and the landing uses 12 % of it — a candidate if a REAL-device trace (Safari
   Web Inspector on the iPhone) ever points at style. Don't re-run the Windows
   harness expecting a different answer.
   ⚠️ Locally, mock `/api/app-version` (`{}`) — without `VERCEL_GIT_COMMIT_SHA`
   the 4 s version check reloads the page. Run nothing else on the machine
   while measuring: concurrent vitest/builds doubled the numbers once.
2. **First History tap — FIXED 2026-10-10.** Cause (traced): the nav's
   `/history` warm-up was issued LAST, after every visible tab and link had
   viewport-prefetched its own route + JS, plus ~410 KB of Google scripts; the
   History page chunk started downloading 6.5 s after the tap. Now History is
   warmed the moment the nav mounts and the other tabs warm after `load`
   (`features/app-shell/warm-routes.ts`). Tap at 5 s: median 5.6 s → ~2.1–2.6 s
   (n=6 before, n=25 after); tap before hydration ≈ 1 s (a full page load);
   tap once warmed 0.1–0.4 s. Rare 10–19 s stalls (2 of 37 runs) showed zero
   requests in flight — consistent with local HTTP/1.1's 6-connection cap, not
   seen on HTTP/2; re-check on the phone. Still open: the Frenz AI tile
   (`/ai`, `/features`) viewport-prefetches on purpose (owner, 2026-09-09) and
   still competes; the Google ad/analytics scripts cost another ~1.8 s of the
   tap (measured by blocking them) — an owner decision, revenue.
3. **Cloudflare Stream storage is FULL** (`413`, code `10011`). Since
   2026-10-10 an ad video Stream refuses goes to the WORKER, which compresses it
   to 480p (short edge; 1080p 20 MB → 0.35 MB measured) with ffmpeg and
   publishes it from Supabase Storage (`server/services/ad-video-transcode.ts`,
   `app/api/internal/ads/transcode`). The worker must be REDEPLOYED with this
   code for it to work. With no worker, an MP4/WebM ≤ 50 MB is served as
   uploaded; anything else still gets "try again". Reels already keep playing
   their MP4 without a Stream copy. Freeing Stream storage is still the owner's
   call in the Cloudflare dashboard.
4. **Migrations 0214–0225 are all applied in production. 0226 (Professional Network, Part 12) and `0227_sub_monetization.sql` (SUB — paid subscriptions in money, subscriber-only posts, SUB withdrawals, financial audit log; Part 13 — see docs/SUB_MONETIZATION.md and docs/BILLING.md) are new and NOT yet run, in that order. **Also run `0228_follower_daily_account_delete.sql` — a live bug fix, independent of the others and safe to run first: since 0217 no member with a follower could delete their account (the follow-delete trigger wrote a stat row for the account being deleted and its foreign key refused the whole deletion; reproduced in PGlite and on production test accounts 2026-10-11).** 0227 was renamed from `0227_creator_memberships.sql` and rewritten before it ever ran (credit-billed memberships were replaced by SUB). Owner infra for SUB: (a) a PRIVATE R2 bucket (no public access, no custom domain) and `R2_PRIVATE_BUCKET` set on Vercel — without it subscriber-only uploads are refused, never stored publicly; (b) Paystack: Transfers enabled, an NGN balance, "OTP for transfers" off, and webhook events `transfer.success`, `transfer.failed`, `transfer.reversed`, `refund.processed`, `charge.dispute.create` added (same URL).** (probed live 2026-10-11, including the effects of 0224 and 0225: constraints refuse bad values, the presence history trigger logs and skips auto-away, lists nest to four levels and refuse cycles, rule owners are stamped). History of the list, in
   order. 0223 = Relationship Intelligence (Feature 19 Part 8). 0222 = Friend Profiles (Feature 19 Part 7). 0221 = People You May Know feedback (Feature 19 Part 6). 0219 = the admin "×10 for all live" switch now STANDS (new live campaigns inherit ×10 via a trigger) — after running it, press "×10 all live" once so the switch is recorded. 0220 = Contact Discovery (Feature 19 Part 5, docs/FEATURE_19_SOCIAL_GRAPH.md): keyed e-mail hashes, privacy, the daily cap, and the "contacts" follow source. 0218 = admin funding alerts (a trigger queues every successful payment;
   push + email to admins via lib/admin/funding-alerts.ts) and weekly AI prizes
   (ai_weekly_awards; 50/30/20 credits for the top 3 who spent >500 that week,
   paid by the 10-minute reconcile cron the day after a week closes). 0215 raises the public `ad-creatives` bucket to 200 MB; 0216 is Friend
   Requests (ignores, request privacy, source); 0217 is the follow platform and
   circles (follow policy + requests, follower_daily, circle kinds/icons/palette,
   and a NEW follows insert policy that enforces approval in the database).
   Each PGlite-tested twice + a mutant; code works before and after each.
5. **Verify on the owner's iPhone:** the bottom nav after minimising
   (`lib/pwa/resume-viewport.ts`) and chat avatars instant on entry (SW v26) —
   neither can be reproduced in desktop Chromium. History's top half painting
   on cold entry is CONFIRMED locally (first frame at 1.52 s shows header,
   search, filters and nav).
6. **Ad card (2026-10-10):** the paid card now takes the creative's own ratio
   inside 320 × 500 (`cardMediaBox`), with Sponsored · headline · description ·
   Visit under it. Ad images were being CROPPED by Supabase's renderer (width
   only defaults to `cover` and keeps the original height) — fixed with
   `resize=contain`. The top strip asks for an image 32–40 px tall and has no
   description field.
7. **Feature 19 (Friends, Followers, Social Graph) — Parts 1–10 and 12–17 built (Part 11 skipped by the owner) — Feature 19 is complete. Parts up to 13 were pushed 2026-10-11 (→5910533) and 0226–0228 applied; Parts 14–17 with 0229–0232 were pushed 2026-10-11 (probe them live). Open owner decision: Feature 18 creator "Reputation" ranks use followers and views, which Part 16 forbids — rename or retire them. SUB uploads need `R2_PRIVATE_BUCKET` set on Vercel. Next session: notification features.** The
   governing doc is `docs/FEATURE_19_SOCIAL_GRAPH.md` (architecture, decisions and
   a Gap Ledger per part). Part 1 already existed as Feature 18 Part 17. Planned,
   with reasons in the doc: SUB auto-renewal, close-friends-only stories
   and posts, favourite/VIP feed priority, contact sync, admin spam review.
8. **History crash fixed 2026-10-10:** the grid mounted a <video> per ad tile
   (19 at once with 60 items); tiles now hold media only near the viewport. One
   full-screen dialog at a time (`lib/ui/modal-open.ts`).

Rules learned 2026-10-10: **no www → apex redirect** (sign-in cookies live on
the host where sign-in began; the redirect bounced admin login — removed in
f05e323). **Push only when the owner says so** — every deploy shows "new
version available" on every open device. After a push, check `npx vercel ls`
shows the new deploy **Ready** (cb8cb60's deploy was silently Canceled).

This container's network policy blocks `frenzsave.com` and `*.supabase.co`, so these
were not probed live from here. Probe each object after the push:

- **0198:** table `ad_campaign_extensions`; functions `ad_swap_creative`, `ad_edit_creative_details`, `ad_advertiser_pause`, `ad_price_for`, `ad_campaign_quote`, `ad_extension_quote`, `ad_apply_extension`, `ad_my_summary`, `ad_my_payments`; creative status `staged`. The full list is in `docs/AD_PLATFORM.md` (Part 6 files).
- **0201:** `ad_campaign_daily_stats.conversions` / `outbounds` (`.select("conversions, outbounds").limit(1)`), and `track_ad_events` accepting `conversion`.
- **0202:** `ai_product_balances.deposited_cents`, the `ai_product_balances_deposited_clamp` trigger, and a test deposit landing as withdrawable + deposited.
- **0203:** `ad_placements` rows `hd_download_reward` and `batch_download_reward`.
- **0200:** `conversation_streaks` (`.select("conversation_id").limit(1)`) and the `bump_conversation_streak_trg` trigger. Send a message in a test chat from both sides and read the row back.
- **0206 (Part 8):** tables `ad_risk_flags`, `ad_invalid_daily`, `ad_ingest_counters`, `ad_private_settings` (one row); `ad_events.ip_hash/qualifying/risk_reasons/client_ts`; stats `invalid_impressions/invalid_clicks/invalid_other/load_failures`; `select public.ad_traffic_rules()` as the service role; `track_ad_events` still callable by anon. Then open Admin → Ads → Traffic & safety. Optional env: `GOOGLE_SAFE_BROWSING_API_KEY` (reputation). Content moderation uses the existing `ANTHROPIC_API_KEY`. The hourly cron needs the `CRON_SECRET` Actions secret.
- **0204:** columns `ad_campaigns.refund_status` / `refund_owed_minor`; functions `admin_moderate_ad_campaign`, `admin_set_ad_refund`, `admin_set_advertiser_status`, `ad_refund_owed`; and the re-created `activate_ad_campaign` (call it with role `advertiser` and expect `not_permitted`). Open Admin → Ads → Campaigns and check that it loads.
- **0199:** `credit_transfers.credit_class` (`.select("credit_class").limit(1)`). Also call the 7-argument `transfer_credits` through the service role with a bad kind and expect `{ok:false, reason:"invalid"}`.

### Ad platform: owner decisions still open

0. **Part 7 refund rule (my default, please confirm).** When a paid campaign
   is rejected or removed, the full amount is owed if it never ran. If it ran,
   the unused share of its paid time is owed, rounded down. Refunds are sent
   in the Paystack/Bachs dashboard and then marked in the admin. Nothing is
   paid out automatically.

1. **Reward ads on AI saves.** The `ai_video_save_reward` placement exists
   because the ad brief asks for it, but it conflicts with the earlier
   standing rule "no reward ads for AI, ever". If kept, it must **never gate**
   a save: no ad available means the save proceeds.
2. **Does pausing extend a campaign's end date?** Today it does not.
3. **The example brand in ad previews** is Frenz AI. Real third-party brands
   were declined, because they would read as that company advertising here.
4. **Refunds are issued in the provider dashboards for now.** An admin refund
   button is planned.

### Ad platform: to go live

See "To go live" in `docs/AD_PLATFORM.md`:

- Set prices in `ad_pricing_plans`. None are seeded, so nothing is for sale.
- Set `applications_open = true` in `ad_platform_settings`.
- Give the Bachs API key these permissions: `payments:read/write`,
  `products:read`, `refunds:read`, `disputes:read`. The admin's "Check with
  Bachs" fails with 403 until `products:read` is granted.
- Subscribe the Bachs webhook to the `collection.*`, `refund.paid` and
  `dispute.*` events.

## 2 · How to verify ad-platform SQL without a database

The owner RUNS migrations by hand, in order, after a push (corrected
2026-10-09 - they do not auto-apply). Check which number production is on
before assuming a feature's table exists: as of 2026-10-09 production is at
**0199**, and 0200-0206 are on main waiting to be run, in order. A broken
migration still costs a production fix, so before pushing, execute new SQL in **PGlite**
(`npm i @electric-sql/pglite` in a scratch folder, not in this repo):

- stub `auth.users`, `auth.uid()` (reading `request.jwt.claim.sub`),
  `storage.buckets`, `profiles` + `is_admin()`, `touch_content_updated_at()`
  and the `ai_topup_attempts` / `ai_product_*` tables;
- run each migration **twice** (idempotency);
- test RLS with `set role authenticated` plus `set_config('request.jwt.claim.sub', …)`;
- mutate a guard and confirm a check fails (teeth).

After pushing, **probe every new object live** (each table, column, function
and bucket), not just one.

## 3 · Hard laws learned the hard way (do not relearn them)

- **Migration runner:** it splits on `;` even inside quoted strings, so never
  put `;` in a SQL string literal (`lib/platform/migration-strings.test.ts`
  enforces this). Put every `$$` function or DO block **last**; plain DDL
  after one has silently not applied. A head-count on a missing table answers
  `error: null`, so probe with `.select("col").limit(1)`.
- **Cost:**
  - Nothing may cost money while idle: no `setInterval` fetches, no Realtime
    unless truly needed.
  - Global answers get a CDN bucket (`lib/net/cdn-bucket.ts`) instead of
    per-visitor functions.
  - Browser analytics and ad events go straight to Postgres RPCs, not Vercel.
  - `next build` never runs vitest.
  - `force-dynamic` only where a request truly needs it.
- **Performance:** the 2-second cold-entry budget is enforced by
  `lib/perf/budget.test.ts`, including a 370 kB per-route ceiling. Lazy-load
  anything not needed at first paint; admin tabs included.
- **Money:**
  - Webhooks are the authority, and a browser return proves nothing.
  - Every effect is idempotent on our own reference.
  - A provider is followed by another only after a **refusal**, never after
    an uncertain outcome.
  - An idempotency key must be stable per business operation, never minted
    per call.
- **New SQL function:** it is executable by the browser until you
  `revoke … from public, anon, authenticated`.
- **Admin check in RLS:** use `(select public.is_admin())`, never
  `public.is_admin()` per row.
- **New table:** catalogue it in `lib/platform/data-domains.ts` **and**
  `lib/portability/tables.ts`, or the orphan tests fail.
- **Uploads:** they must hold `beginCriticalActivity()`, or a deploy's
  service-worker reload kills them mid-transfer.
- **Fixed overlays:** portal any `fixed` overlay.
- **Header offset:** the site header is fixed, so marketing pages offset
  content with `pt-[calc(var(--frenz-safe-top)+…)]`.
- **CI gates:** run all four (`typecheck`, `lint`, `test` after `build`,
  `build`). Chain them with `&&`. Piping through `tail` hides exit codes.
- **Process:** commit only, and push when the owner says. Screenshot every
  finished page and section at 390 px and 320 px, and send them.

## 4 · Commits of this hand-off

- Part 1: `02cbc1d`
- Part 2: `8ea15b9`
- Admin Bachs field fix: `9b2a010`
- Part 3: see `git log --grep "ads"`
- Parts 5–6: `773f297`, `f50266c`, `075ee4e`. Slots groundwork: `c950db3`
- Credit kinds on transfers (0199): see `git log --grep "credit kind"`
