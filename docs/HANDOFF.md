# Hand-off — start here in a new session (updated 2026-10-08)

For AI assistants and engineers picking this repo up without prior context.
Read `AGENTS.md` first, then this file. This is the **current state**; the
governing rules live in `AGENTS.md`, `docs/CONSTITUTION.md` and the registries.

## 1 · Where things stand

| Area | State |
|---|---|
| **Self-serve ad platform** | Parts 1–6 shipped (engine, application, payments, serving through the shared slots, advertiser dashboard). Slot management groundwork is in the existing Ad placements tab (`c950db3`). Full write-up and Gap Ledgers: `docs/AD_PLATFORM.md`. **Next: Part 7** (the admin side), built by upgrading the existing admin under the shared-slot rules. The owner has an interim change list to do first. |
| Payments | Paystack + Bachs as two rails under one router (`lib/payments/router.ts`, purposes `wallet_topup`, `ai_subscription`, `ad_campaign`). See `docs/PAYMENTS.md`. |
| Frenz AI credits | One wallet in CREDIT units (`ai_product_balances` / `ai_product_ledger`). Ads are **not** paid from credits. The balance has a withdrawable part (`withdrawable_cents`, 0187), and the rest is non-withdrawable. |
| Credit transfers | 0193 + **0199**: the sender chooses non-withdrawable or withdrawable. The amount and the fee come only from that kind, and the recipient receives the same kind. Cashing out still needs the recipient's own approval (0191). The credits page (`/ai/usage`) shows the two kinds apart. The AI and download credit strip keeps the total. The 6-argument 0193 function is kept for the deploy window. |

| One experience | Since 2026-10-09 there is no Full Bleed / Downloader mode. The `frenz_mode` cookie, the switcher and the switch prompt are gone. Members' bottom nav: Home (`/downloads`), Feed (`/home`, the complete feed), History, Chats, Profile. Guests: Home, Earn (`/quests`), History, Support, Profile. Every tab has a label. |
| Chat streaks | 0200 `conversation_streaks`, kept by a trigger on `messages`. A day counts when BOTH people sent a message (UTC). The flame shows beside a chat from 2 days. The streak left the site and app headers. Every streak celebration is the card-less `StreakFireBurst`. |

### Live probes owed (production)

This container's network policy blocks `frenzsave.com` and `*.supabase.co`, so these
were not probed live from here. Probe each object after the push:

- **0198:** table `ad_campaign_extensions`; functions `ad_swap_creative`, `ad_edit_creative_details`, `ad_advertiser_pause`, `ad_price_for`, `ad_campaign_quote`, `ad_extension_quote`, `ad_apply_extension`, `ad_my_summary`, `ad_my_payments`; creative status `staged`. The full list is in `docs/AD_PLATFORM.md` (Part 6 files).
- **0200:** `conversation_streaks` (`.select("conversation_id").limit(1)`) and the `bump_conversation_streak_trg` trigger. Send a message in a test chat from both sides and read the row back.
- **0199:** `credit_transfers.credit_class` (`.select("credit_class").limit(1)`). Also call the 7-argument `transfer_credits` through the service role with a bad kind and expect `{ok:false, reason:"invalid"}`.

### Ad platform: owner decisions still open

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

Supabase migrations auto-apply on push (GitHub integration), so a broken
migration reaches production. Before pushing, execute new SQL in **PGlite**
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
