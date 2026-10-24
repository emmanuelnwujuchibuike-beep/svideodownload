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

Part 4 (2026-10-23): one copy for every page a credit top-up returns to
(`lib/ai/wallet/topup-return.ts`: credited / still confirming / not completed /
couldn't check), and `useTopupReturn` + `TopupReturnNotice` on the lip-sync,
text-to-audio and voice-cloning workspaces, which used to ignore the return. "Check
again" re-asks about the SAME reference — never a second payment. Paid
verification shows no Pay button while a payment may still be on its way. Checkout
buttons latch synchronously (one checkout per tap burst).

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

## Flutterwave (Part 2, 2026-10-23) — the primary rail, OFF until the account is confirmed

Owner: Flutterwave first for every one-off payment, charging **USD** (every Frenz price is
USD), in every market; Paystack the backup in **NGN** at the live rate. Secrets only in env
(Vercel / `.env.local`), never in `settings`.

**The capability gate** (`lib/flutterwave/config.ts`). A checkout opens on Flutterwave only
when it has `FLUTTERWAVE_SECRET_KEY` and `FLUTTERWAVE_SECRET_HASH` (env or Admin → Flutterwave),
USD is verified, the purpose is enabled and the amount unit is `major`.
**On by default since 2026-10-24** (owner: "Flutterwave should never be off on default, it should
be on and working immediately after push"): the three switches default to USD / every purpose /
`major` when unset, so the key and hash are all a deploy needs. To switch it off: save the
switches in Admin → Flutterwave (a saved list wins, even an empty one), or set
`FLUTTERWAVE_ENABLED_PURPOSES=none` / `FLUTTERWAVE_VERIFIED_CURRENCIES=none` /
`FLUTTERWAVE_AMOUNT_UNIT=unconfirmed`. AI plans and Pro / Business additionally need a USD
Flutterwave payment-plan id (a non-USD plan is refused and Paystack takes the checkout);
existing Paystack subscriptions renew and cancel at Paystack, and a Flutterwave renewal waits in
Admin → Flutterwave → Reviews until `FLUTTERWAVE_RENEWAL_TX_LOOKUP=confirmed`.

**Naira in Nigeria (2026-10-24).** Flutterwave shows the methods of the currency charged — bank
transfer, USSD, account and OPay exist only for NGN; a USD checkout offers card / PayPal. So a
ONE-OFF Flutterwave checkout (top-up, SUB, verification, ads) for a member in Nigeria (the edge's
country) is charged in NGN at the same live rate Paystack uses (`lib/payments/flutterwave-charge.ts`);
everyone else pays USD. NGN is on by default (`DEFAULT_VERIFIED_CURRENCIES`); without NGN confirmed
or a rate, Nigeria pays USD — never a closed checkout. The naira amount and rate are written on
the attempt row first and every settle path matches the verified charge against the row (the
credit / grant is still the USD price). Subscriptions stay USD, card only (a Flutterwave plan limit).

**Plans are sold only at the price members are shown (Part 6).** `lib/payments/plan-compat.ts`,
applied by both plan checkouts and by Admin → "Check with Flutterwave": a Flutterwave payment
plan is used only when it is active, in USD, on the plan's interval, with a fixed amount EQUAL
to the shown price — AI Pro / Max: the plan's `priceCents` (when the AI prices are in USD);
Pro / Business: the /pricing display price (`settings.pricing`, a plain `$` amount). Otherwise
Flutterwave refuses before anything is created, the exact reason is logged and shown by the
admin check, and Paystack's own plan may take the checkout (the definite-refusal rule). Before
Part 6 a plan's own amount was charged even when it differed from the page.

**Admin controls (Flutterwave Part 5).** Admin → Flutterwave: the masked, write-only key and
hash (fresh password to save), **Test connection** (one read-only verify of an impossible
reference — fixed copy, never the key or the provider's text; audited), and **Payments and
reconciliation** — every attempt across `ai_topup_attempts`, `sub_purchases`,
`verification_purchases` plus the webhook log, filtered by provider / purpose / state /
reference, with **Recheck with provider** on open attempts (`lib/payments/admin-transactions.ts`:
a reference only, the purpose's existing settle path, idempotent, fresh password, rate limited,
written to `financial_audit_log`). Admin → AI Plans → **Payment routing**: which provider takes
each purpose per market; the server refuses Flutterwave without Paystack behind it or a
self-backup (`paymentRoutingProblem`).

**Routing.** The same router (`lib/payments/router.ts`). Defaults: `flutterwave` → `paystack`
for every market and purpose; `sub_purchase` and `verification` now ask the router too.
`usableRails(purpose)` (`lib/payments/rails.ts`) is the one `usable`. `firstRail` moves to the
backup only after a **definite** refusal (a 4xx, or our own refusal before calling); a timeout,
a 5xx or a non-JSON body is **unknown** — the attempt is held (`verification_required` /
`initiated` with no link) and resolved by reference before any new checkout. A saved route
naming a removed provider (`bachs`) reads as the whole default route, so Paystack stays the
fallback.

⚠️ If the AI plans card has been saved since routing existed (2026-10-07), the stored table
says Paystack-only for `wallet_topup`, `ai_subscription` and `ad_campaign`, and those three
will not try Flutterwave even with the gate open, until the table changes (Part 5 makes it
editable). `sub_purchase` and `verification` are new keys, so they take the default
(Flutterwave → Paystack). Not checked against production from here.

**Attempts first.** Every flow writes its row BEFORE calling a provider, synchronously:
`ai_topup_attempts` (wallet — the Paystack row moved out of `after()` too; ads via
`ad_payment_begin`), `sub_purchases`, `verification_purchases` (`provider`, 0271). The row
holds the provider, our reference, the expected minor amount and currency, the purpose and the
member. References name the provider (`lib/payments/references.ts`): `frenz_cr_topup_fw_…`,
`frenz_sub_fw_…`, `frenz_vf_fw_…`, `frenz_ad_fw_…`.

**Settling.** `/api/flutterwave/webhook`: `verif-hash` (constant time) → claim in
`payment_provider_events` → **re-verify by transaction id** with the API → the verified
`tx_ref` must equal the event's → the purpose's existing settle function, which checks the
charge against OUR row (`chargeMatches`, or the SQL for SUB/ads). The return pages send only
the reference (Flutterwave's `tx_ref`); `status`/`transaction_id` in the URL are stripped and
never read. Wallet: `lib/ai/wallet/flutterwave-settle.ts` credits the row's USD price through
the same `credit_product_balance` (once per reference). SUB: `settle_sub_purchase`.
Verification: the same one-winner grant. Ads: `ad_payment_settle`.

**Not in Part 2:** Flutterwave refunds/chargebacks (no handler; a refund must be reconciled by
hand), Flutterwave subscriptions, Flutterwave payouts (withdrawals stay on Paystack Transfers;
`withdrawal_requests.payout_method`/`payout_reference` already exist for a future rail), the
wallet cron sweep for Flutterwave top-ups (Part 3 — today: webhook, return page, and the held-
attempt check), the picker/admin UI (Parts 4–5). Migration **0271** must be applied by hand.

## Part 2.1 (2026-10-23) — correctness and safety follow-up

**Exact amounts.** `chargeMatches` (`lib/payments/charge.ts`) now requires the verified amount to
EQUAL the attempt's stored amount, in integer minor units of the same currency — no tolerance.
`underpaid` and `overpaid` are separate outcomes; neither grants anything. Provider amounts are
parsed as exact decimals (`majorToMinor`: "10.005" or float noise like 0.30000000000000004 is
unreadable, never rounded into a match). Enforced for every Flutterwave purpose:
wallet → attempt `mismatch`; SUB → no settle, `financial_audit_log` `sub_payment_mismatch`, the
purchase stays open; verification → `failed` with `failure_source = review_<kind>`; ads →
`ad_payment_release(…, 'mismatch')` (held, campaigns not released, no new checkout). The SQL
settles (`settle_sub_purchase` "at least", `ad_payment_settle` "+1") are unchanged for Paystack.

**Amount unit.** The docs never state major vs minor units. The gate now also needs
`FLUTTERWAVE_AMOUNT_UNIT=major`, set only after a sandbox charge proves it.

**Saved routes.** `frenzAiPlans.wallet.routingVersion`: a table without it (version 1, saved
before Flutterwave) reads its Paystack-only routes as the new default (Flutterwave → Paystack);
version 2 (every save from now) is authoritative. A route "Flutterwave, no fallback" always reads
as Flutterwave → Paystack. The gate still decides whether Flutterwave is usable at all. The admin
landing save schema now accepts `flutterwave`, the `sub_purchase`/`verification` purposes and
`routingVersion` (it rejected the card's own table after Part 2).

**Paystack secret.** Exposure: the stored `settings.paystack.secretKey` is readable by any admin
session straight from the database API (RLS `settings admin all`, 0001). No route returns it
(the admin GET masks it) and nothing logs it. Mitigation, opt-in: `PAYSTACK_SECRET_SOURCE=env` +
`PAYSTACK_SECRET_KEY` → the env secret is used, the stored one ignored and never re-written.
Staged rollout (owner):
1. In Vercel, set `PAYSTACK_SECRET_KEY` to the SAME live key that is in the admin panel now, and
   `PAYSTACK_SECRET_SOURCE=env`. Redeploy. Admin → Paystack shows source `env`.
2. Verify one small real top-up end to end (checkout, webhook, credit) and one payout check.
3. Rotate the key in the Paystack dashboard; put the new one in Vercel; redeploy.
4. Then clear the old stored secret from `settings.paystack` (a manual SQL update — the admin
   form can't blank it), so the table no longer holds a live key.

**Pop-under.** OFF unless an admin saved a literal `true`. The tag loads on the first press at an
enabled spot; other scripts' windows are counted, never blocked (`lib/monetization/open-observer.ts`),
except a pop-under arriving within 1.5 s after the direct link opened on that tap. The decision runs
inside the tap (a listener at the end of the same click). The blocking guard is no longer installed
by this feature.

## Flutterwave from the admin dashboard (2026-10-23)

Admin → (the Paystack panel's tabs) → **Flutterwave**: the secret key, the webhook secret hash
(with a Generate button and the webhook URL to copy into Flutterwave), the two capability ticks
(USD confirmed; amount unit proven in the sandbox) and the purposes to put on Flutterwave first,
with each purpose's live/closed reason. Saved by `/api/admin/flutterwave` (admin + fresh password)
into **`payment_provider_settings`** (migration **0272**) — a PRIVATE table (RLS on, no policy, no
client grants), so unlike Paystack's `settings` row no browser session can read the secret. GET
returns masks and sources only. Precedence: the dashboard's value first, the Vercel env var as the
fallback (`lib/flutterwave/config.ts` `resolveFlutterwaveConfig`), cached 15 s.

## Part 3 (2026-10-23) — scheduled reconciliation and recovery

**The clock:** the existing `app/api/cron/ai-reconcile/route.ts`, called by
`.github/workflows/cron-ai-reconcile.yml` (`*/10 * * * *`, `Authorization: Bearer $CRON_SECRET`,
`concurrency: cron-ai-reconcile`). `cronAuthorized` (lib/cron/auth.ts) accepts the CRON_SECRET
env token, the stored cron token digest, or a signed-in admin; anything else is 403. No new cron.

**Wallet top-ups** (`lib/ai/wallet/reconcile-topups.ts`): one routine settles one open attempt
(`pending` / `verification_required`) from the provider written on its row — Paystack through
`settleCharacterReplaceCharge` (resolveCredit), Flutterwave through `settleFlutterwaveTopup`
(exact match). A failed verify leaves it open; a charge that isn't the attempt's goes to
`mismatch` (review, never re-asked); Paystack's 4xx "not found" on a never-handed-out unknown
checkout closes it. Each attempt is claimed by a compare-and-set on `updated_at` before its
provider is asked. Callers: the cron (20 per run, oldest first, 2 min – 7 days old, 5-minute
recheck, 45 s budget), the member's wallet read (opportunistic), and every new top-up checkout
(an unknown-outcome attempt on EITHER rail is resolved first, else 409 "still confirming").
Paystack initialization now treats only a 4xx as a refusal; a timeout/5xx is held.

**AI plan purchases** (`lib/ai/credits/plan-attempts.ts`): the checkout writes an
`ai_topup_attempts` row (purpose `ai_subscription`, provider paystack, our reference
`frenz_ai_plan_<uuid>`, plan in `item_id`, the EXACT Paystack plan charge in
`provider_amount`/`provider_currency`) before calling Paystack with that reference. Recovery
verifies it (member, purpose, plan, success, exact amount and currency) and activates through the
existing idempotent `activateAiPlanFromVerifiedCharge`. Renewals and lifecycle stay on the
Paystack webhook (their references are Paystack's, never ours). The verify-on-return route uses
the same routine for our references. Cron: 10 per run, 30 s budget. No migration was needed.

## Part 3.3 (2026-10-23) — recurring billing on Flutterwave: identity, an atomic ledger, reviews

Flutterwave plans (AI Pro / AI Max, Pro / Business) after the Part 3.2 audit. **Recurring billing stays OFF** (the
`ai_subscription` / `site_subscription` purposes are gated as before). Migration **0274** (run by hand after 0271–0273).

- **Identity at activation.** The subscription Flutterwave created for the verified FIRST charge is looked up by that
  charge's transaction id (`GET /v3/subscriptions?transaction_id=` — documented for first charges) and must be exactly
  one, on our plan, for the payer's email, active, at the charged amount. Its id, the plan id and the **contract**
  (amount, currency, interval of the first charge) are stored on the row. Not visible yet → the attempt stays open and
  is re-checked (a review says so); conflicting → no plan, a review.
- **Renewals.** Flutterwave documents no field tying a renewal transaction to its subscription. A renewal is extended
  automatically ONLY when `FLUTTERWAVE_RENEWAL_TX_LOOKUP=confirmed` (env, set after the sandbox test below) and the
  transaction resolves to the STORED subscription, plan and contract. Otherwise a charge from a subscriber is a review
  item (Admin → Flutterwave → "Plan billing waiting for review"); an admin "Apply" re-verifies it and applies it once.
  An email or an amount never proves anything; a charge from nobody we bill is ignored.
- **One writer.** `apply_plan_renewal` locks the subscription row, checks identity + contract, claims the transaction in
  `plan_renewals` (unique per provider transaction) and extends from max(paid-through, now) — in ONE transaction. It
  never touches `cancel_at_period_end`. Proven on PostgreSQL: `supabase/tests/0274_plan_billing.pglite.mjs` (logic,
  mutants) and `supabase/tests/plan_billing_concurrency.pg.mjs` (real concurrent connections, mutant `no-lock`).
- **Webhook.** The event claim never fails open (`claimProviderEventStrict` → retry). A transaction on one of our plan
  references is the first charge only if its id is the one that settled the attempt; any other id is a later charge →
  the renewal path. A pending renewal is acknowledged but not marked processed.
- **Cancellation.** `subscription.cancelled` carries `data.plan` as an OBJECT; the plan id + email must match exactly one
  stored subscription and Flutterwave must list that id as cancelled → `cancel_at_period_end` (paid access to the
  paid-through time, no grace). A member's cancel is by the stored id and reported only once confirmed.
- **Expiry.** `expire_flutterwave_site_plan` re-checks under the row lock: a renewal that landed first wins.
- **Upgrades** stay on the rail billing the current plan (neither provider can cancel the other's subscription). A
  Flutterwave upgrade cancels the old subscription by its id only after the new one is active; a failure is a review.
- **Missed renewals.** The 10-minute cron lists `GET /v3/transactions` per subscriber near renewal (date window, ≤3 pages,
  time budget, stop on 429), re-verifies each by id, and sends it through the same path.

**Sandbox evidence required before setting `FLUTTERWAVE_RENEWAL_TX_LOOKUP=confirmed`:** with a TEST key, subscribe a test
card to a short-interval (daily) payment plan, let ONE renewal charge, then record (1) the renewal's `charge.completed`
payload and its `tx_ref` (is it the original reference?), (2) `GET /v3/transactions/{renewal id}/verify`, and (3)
`GET /v3/subscriptions?transaction_id={renewal id}` — it must return exactly the subscription created by the first
charge. Also confirm (4) the `subscription.cancelled` payload shape and (5) the unit of `subscription.amount`.

### Part 3.3.2 (2026-10-23) — renewal ownership and activation hardening

- **No email-derived targets.** A renewal review is queued with NO member, subscription or plan on it unless Flutterwave
  proved them; an email match is only counted in the reason, never stored as a target.
- **Admin "Apply" re-proves ownership at apply time** (`proveRenewalOwnership`, shared with the automatic path): the
  renewal lookup must be confirmed (`FLUTTERWAVE_RENEWAL_TX_LOOKUP`), the transaction re-verified (success, the review's
  exact amount and currency), Flutterwave must link it to exactly one subscription stored on exactly one row, on that
  row's plan, with the charge's, the subscription's and the row's customer emails all present and equal. The review's
  own fields are not trusted. No manual adjudication; unproven reviews are resolved or dismissed by hand.
- **0275** — `apply_plan_renewal` closes a transaction's open review on "duplicate" too (already applied); same lock,
  checks and unique ledger key. Run by hand after 0274.
- **0276** (Part 4 closure) — `begin_sub_purchase` / `begin_verification_purchase`: the purchase row is inserted under a
  transaction-scoped advisory lock on the SUB pair / the member, and an `initiated` purchase from the last 30 minutes
  answers `open` instead (its link is handed back, or "still being confirmed") — two simultaneous requests can no longer
  both open a checkout. A lock, not a unique index: purchase rows are history and old `initiated` rows are legitimate, so
  no cleanup is needed. Before it runs the app falls back to the plain insert. Proven by
  `supabase/tests/0276_open_checkout_guard.pglite.mjs` (SQL) and `open_checkout_guard.pg.mjs` (real server, forced race,
  `--mutant=no-lock` must fail). Run by hand after 0271.
- **Activation** requires both customer emails, and is held to the Flutterwave plan id stored with the attempt at
  checkout (`ai_topup_attempts.metadata.provider_plan_id`); an attempt without one goes to review.
- **AI plans** need a fixed amount on the Flutterwave plan, like Pro / Business — no list-price substitute.
