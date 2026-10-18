# Payments — Paystack under one Frenz AI billing system

> **The rule:** the browser never grants anything. Credits, plans and balances
> change only after a **verified server-side provider event** (a signed webhook,
> or the server asking the provider about a reference it created itself).

Last updated 2026-10-17 — Bachs removed (see the last section).

## The shape

```
UI (Top up credits · Get AI Pro · Pay for an ad campaign)
   │  POST /api/ai/wallet/topup   POST /api/ai/subscriptions/checkout   POST /api/ads/payment/create
   ▼
Payment router  lib/payments/router.ts   ← market from the edge (cf-ipcountry), purpose
   │  ordered candidates — today [paystack] in every market
   └──────────── Paystack  lib/paystack/*
   ▼
Attempt ledger  ai_topup_attempts  (provider, purpose, item, price, provider checkout id)
   ▼  verified event / verified return
ONE crediting function   creditVerifiedCharacterReplaceRecharge  → credit_product_balance (idempotent per reference)
ONE subscription store   upsertAiSubscription                     → ai_subscriptions (provider column)
   ▼
Wallet (credits, ai_product_ledger) · AI plan entitlement
```

There is one wallet, one ledger, one subscription row per member. A provider is
a rail, recorded on the attempt and on the subscription — never a second system.

## Routing

`frenzAiPlans.wallet.routing`: for each market (`NG`, `other`) and purpose
(`wallet_topup`, `ai_subscription`, `ad_campaign`) a **primary** and an optional
**fallback**. Since 2026-10-17 every route is Paystack with no fallback; the
router stays the one place a provider is chosen, so a future provider needs no
page changes. A saved setting that still names `bachs` reads as Paystack.

* The market is read server-side from `cf-ipcountry` (Cloudflare, in front of the
  site), then `x-vercel-ip-country`. A body field or `x-country` is never read.
* A rail is *usable* only when configured (AI plans: the plan has a Paystack
  `PLN_…` code).
* **Fallback happens only when the previous rail could not CREATE a checkout.**
  Once a checkout URL exists it is returned and nothing else is opened — two
  open checkouts for one purchase is how somebody pays twice.

## Paystack

`lib/paystack/*`, `/api/paystack/webhook`, the verify-on-return routes. Since
0184 a Paystack top-up buys **credits** (⌊paid USD cents ÷ cents per credit⌋,
the pack bonus only for a pack of exactly that size) — metadata is writable by
anyone with the public key, so it is never the amount credited.

## States the UI may show

Preparing → redirecting → (return) **verifying** → added / still confirming /
failed. "Payment successful" only after the server says `credited` or
`activated`. A check that could not complete is *pending*, never *failed* — the
webhook will finish it.

## Tests

`lib/ai/credits/wallet-credits.test.ts` (what a payment buys, forged packs),
`lib/ads-platform/payments.test.ts` (routing, the fallback rule, held legacy
rows), the existing Paystack suites.

## Bachs removed

Owner, 2026-10-17: remove Bachs (bachs.io) completely. Paystack was already the
admin's default.

**Removed from the code** — the client (`lib/payments/bachs.ts`), the top-up and
AI-plan adapters (`lib/ai/wallet/bachs-topup.ts`, `lib/ai/credits/bachs-plans.ts`),
the webhook (`/api/bachs/webhook`), the admin product check
(`/api/admin/ai/plans/verify-bachs`), the Bachs plan cancel route
(`/api/ai/subscriptions/cancel`), the ad-campaign Bachs checkout, replay,
verify and webhook handlers, the routing/plan/admin settings for Bachs, the
picker label, the env vars `BACHS_SECRET_KEY`, `BACHS_WEBHOOK_SECRET`,
`BACHS_API_BASE`. Nothing in the code can create, verify, settle or refund a
Bachs payment any more; a Bachs webhook delivery reaches no route (404).

**Kept, unchanged — financial history.** No migration: the provider columns
are shared with Paystack and their check constraints must keep allowing
`'bachs'` so the old rows stay valid (`ai_topup_attempts.provider`,
`payment_provider_events.provider`, `ad_campaigns.payment_method`, 0186/0188/0195).
Rows with `provider = 'bachs'` are never relabelled, deleted, settled or released
by code:
* the ad payment server holds them (`legacyProvider` in
  `lib/ads-platform/payment-server.ts`: never redirected to, never re-asked,
  skipped by the reconcile sweep);
* the verify-on-return routes answer a Bachs reference (`frenz_bachs_…`) with
  "pending", with no network call and no write
  (`lib/payments/removed-providers.ts`) — it never reaches the Paystack path;
* the SQL's `p_provider = 'bachs'` branch in `ad_payment_settle` (0197/0198) is
  now unreachable and left as it is (changing it needs a migration for no gain).

**Production at removal (read-only aggregate check, 2026-10-17):** no Bachs-billed
AI subscription; 0 Bachs webhook events ever logged; 2 ad-campaign payments
settled (campaigns since expired); 2 wallet top-ups failed before any checkout
existed (nothing paid); **5 attempts still `pending`** with a Bachs checkout id —
4 wallet top-ups (Oct 7–10, $12.00 in all) and 1 AI-plan purchase (Oct 12,
$10.00). Because no Bachs webhook ever arrived, those 5 must be checked by hand
in the Bachs dashboard: one that Bachs shows as paid was never credited, and
the member is owed that credit (or a refund through Bachs).

**Outside the code — the owner must:**
1. Revoke the Bachs secret key in the Bachs dashboard (a live key exists in the
   local `.env.local`; it was never committed to git).
2. Delete the webhook endpoint `https://<site>/api/bachs/webhook` in the Bachs
   developer portal (and with it the signing secret).
3. Remove `BACHS_SECRET_KEY` / `BACHS_WEBHOOK_SECRET` (and `BACHS_API_BASE` if
   set) from the hosting environment (Vercel) and from `.env.local`.
4. Reconcile the 5 pending attempts above in the Bachs dashboard.
