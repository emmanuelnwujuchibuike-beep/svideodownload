# Payments — Paystack and Bachs under one Frenz AI billing system

> **The rule:** the browser never grants anything. Credits, plans and balances
> change only after a **verified server-side provider event** (a signed webhook,
> or the server asking the provider about a reference it created itself).

Last updated 2026-10-07 (migrations 0184–0186).

## The shape

```
UI (Top up credits · Get AI Pro)
   │  POST /api/ai/wallet/topup        POST /api/ai/subscriptions/checkout
   ▼
Payment router  lib/payments/router.ts   ← market from the edge (cf-ipcountry), purpose
   │  ordered candidates, e.g. Nigeria: [bachs, paystack]; elsewhere: [paystack]
   ├──────────── Bachs  lib/payments/bachs.ts  (+ lib/ai/wallet/bachs-topup.ts, lib/ai/credits/bachs-plans.ts)
   └──────────── Paystack  lib/paystack/*  (unchanged)
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

`frenzAiPlans.wallet.routing` (admin → Frenz AI → AI Plans & Credits → *Payment
routing*): for each market (`NG`, `other`) and purpose (`wallet_topup`,
`ai_subscription`) a **primary** and an optional **fallback**.

* The market is read server-side from `cf-ipcountry` (Cloudflare, in front of the
  site), then `x-vercel-ip-country`. A body field or `x-country` is never read.
* A rail is *usable* only when configured (Bachs: both env vars; AI plans: the
  plan has that rail's id — Paystack `PLN_…`, Bachs `prod_…`).
* **Fallback happens only when the previous rail could not CREATE a checkout.**
  Once a checkout URL exists it is returned and nothing else is opened — two
  open checkouts for one purchase is how somebody pays twice.

Defaults: Nigeria → Bachs, fallback Paystack; other markets → Paystack.

## Bachs

API (docs.bachs.io, read 2026-10-07):

| What | Call |
|---|---|
| Credit pack | `POST /v1/checkout-sessions` `{ pricing: { currency: "USD", amount: "10.00" }, customer: { email }, reference, metadata, success_url, cancel_url }` |
| AI plan | the same endpoint with `product_cart: [{ product_id }]` of a **recurring** product (subscriptions exist only through checkout) |
| Return check | `GET /v1/checkout-sessions/{checkout_id}` — only `SUCCEEDED` counts |
| Cancel plan | `DELETE /v1/subscriptions/{id}` `{ cancel_at_period_end: true }` |
| Webhook | `X-Bachs-Signature-V2: t=…,v1=…` = HMAC-SHA256(secret, `"{t}.{raw body}"`), 300 s window |

Amounts are decimal strings; packs and plans are priced in USD and Bachs converts
at its own page.

**What a Bachs payment buys** comes from *our* attempt row (written before the
checkout, keyed by our reference): only our secret key can create a Bachs
session, so the row is the authority. When Bachs reports the payment in USD it
must also cover the row's price.

Webhook events handled (`/api/bachs/webhook`): `collection.succeeded`,
`collection.failed`, `customer.subscription.created|updated|deleted`, `invoice.*`
(`invoice.payment_failed` → `past_due`; access continues inside the paid period,
the existing rule). Every verified delivery is logged once in
`payment_provider_events`; a delivery already processed is acknowledged without
repeating anything.

### Setup checklist

1. `BACHS_SECRET_KEY` and `BACHS_WEBHOOK_SECRET` in the server environment
   (Vercel production), never `NEXT_PUBLIC_`.
2. Bachs portal → Webhooks → add `https://<site>/api/bachs/webhook` with the
   events above; copy its signing secret into `BACHS_WEBHOOK_SECRET`.
3. For each AI plan: a **recurring** product in Bachs at the plan's price and
   interval; paste its `prod_…` on the plan card (*Check with Bachs* reads it —
   the key needs `products:read` for the check).
4. The key needs `payments:write` (checkouts); `products:read` for the admin check.

## Paystack

Unchanged in what it does: `lib/paystack/*`, `/api/paystack/webhook`, the
verify-on-return routes. Since 0184 a Paystack top-up buys **credits**
(⌊paid USD cents ÷ cents per credit⌋, the pack bonus only for a pack of exactly
that size) — metadata is writable by anyone with the public key, so it is never
the amount credited.

## States the UI may show

Preparing → redirecting → (return) **verifying** → added / still confirming /
failed. "Payment successful" only after the server says `credited` or
`activated`. A check that could not complete is *pending*, never *failed* — the
webhook will finish it.

## Tests

`lib/payments/bachs.test.ts` (signature, money format, routing, the source order
that keeps a payment single), `lib/ai/credits/wallet-credits.test.ts` (what a
payment buys, forged packs), the existing Paystack suites.

## Not yet done (planned)

* The site's own Pro/Business subscriptions still run on Paystack only.
* Bachs has not been exercised end to end: the webhook secret and the AI plan
  products are needed first, and the only key is live (no sandbox key).
