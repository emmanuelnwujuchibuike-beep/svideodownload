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

- **0211 (admin test mode ×10):** column `ad_campaigns.stats_multiplier`, function `admin_set_ad_stats_boost`, and the re-created `ad_my_summary` (now returns `boosted`). Admin → Ads → Campaigns → each card has a "Dashboard sample data ×10" switch. Display only, per campaign, off by default, labelled "Sample data" on the advertiser dashboard; stored stats and billing stay real. Turn it off when the Frenzsave advert is done.

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
