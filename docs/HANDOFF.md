# Hand-off — start here in a new session (updated 2026-10-08)

For AI assistants and engineers picking this repo up without prior context.
Read `AGENTS.md` first, then this file. This is the **current state**; the
governing rules live in `AGENTS.md`, `docs/CONSTITUTION.md` and the registries.

## 1 · Where things stand

| Area | State |
|---|---|
| **Self-serve ad platform** | Parts 1–6 shipped: engine, advertiser application, payments, serving on the **shared slots** (Part 5; the old "Part 4 rendering" was folded into it), advertiser dashboard with live edits, pause/resume and extensions (Part 6, migration 0198). Full write-up and Gap Ledgers: `docs/AD_PLATFORM.md`. **Next: Part 7 = admin screens** (slots + provider order, `ad_advertiser_controls`, prices, campaigns, refunds). Upgrade the existing admin Ads panel; never build a second one. The owner sends the Part 7 brief. |
| Slots | One physical slot, many providers: `lib/ads-platform/slot-registry.ts` + `resolveSlotProvider`; order in `settings.ad_slot_provider_order`. A paid ad never adds a container. |
| Payments | Paystack + Bachs as two rails under one router (`lib/payments/router.ts`, purposes `wallet_topup`, `ai_subscription`, `ad_campaign`). See `docs/PAYMENTS.md`. |
| Frenz AI credits | One wallet in CREDIT units (`ai_product_balances` / `ai_product_ledger`). Ads are **not** paid from credits. Since 0199, transfers keep their kind: the sender picks withdrawable or non-withdrawable and the recipient gets the same kind. The split shows on `/ai/usage` and the rewards dashboard; totals show elsewhere. |
| Social | Stories PWA reply band + ••• options; follow links to TikTok/Instagram/X (`components/social/follow-links.tsx`). |

### Ad platform: owner decisions still open

1. **Reward ads on AI saves.** The `ai_video_save_reward` placement and the
   `ai_save_moment` slot exist because the ad brief asks for them, but they
   conflict with the earlier standing rule "no reward ads for AI, ever". It is
   built **non-gating**: no ad available means the save proceeds. Keep or drop?
2. **Three network-ad duplicates from before Part 5** (`docs/AD_PLATFORM.md`,
   Part 5 slot table #2/#3, #11, #16). Consolidating them changes live revenue.
3. **Does pausing extend a campaign's end date?** Today it does not.
4. **The example brand in ad previews** is Frenz AI. Real third-party brands
   were declined, because they would read as that company advertising here.
5. **Refunds are issued in the provider dashboards for now.** An admin refund
   button is Part 7.

Declined (keep declined): a hidden analytics multiplier for advertisers.
Advertisers see the database's real counts.

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
migration reaches production.

⚠️ **A local migration can reach production before any push.** On 2026-10-08,
0199 was found already applied in production while `origin` was still at
`d80aba1`, which did not contain it. Something applies local migration files
to the live database. Treat a file in `supabase/migrations/` as live the moment
it exists. PGlite-test it **before** writing it there, and keep site code and
migration compatible in either deploy order.

Execute new SQL in **PGlite**
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
- Part 3: `49f3b1c`, UI extension `b4f7bc5`
- Part 5: `773f297`, perf `f50266c`, admin slot list `c950db3`
- Part 6: `075ee4e` (migration 0198)
- Stories reply band: `e86c021`; follow links: `d80aba1`
- Credit kinds on transfer: `cc33ad0` (migration 0199)
- 0198 + 0199 were probed live (read-only) on 2026-10-08: every object is
  present, and the browser is refused on the write functions.
