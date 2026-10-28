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

## By country (2026-10-27) — Paystack first in Nigeria, Flutterwave first elsewhere

Owner: "make Nigeria users use Paystack as first choice of payment, deposit, plan and withdraw provider, but they can
decide to switch. Outside Nigeria … Flutterwave as first choice." This supersedes "Flutterwave first in every market"
below **for Nigeria only**.

- **Routing v3** (`lib/ai/credits/wallet-config.ts`): every purpose defaults to `NG` Paystack → Flutterwave and
  `other` Flutterwave → Paystack. A table saved under v2 has its NG Flutterwave-first rows read as Paystack-first. A save
  under v3 is kept as saved, so an admin can still put Flutterwave first for Nigeria. `memberChoice` (on by default)
  lets the member's `provider` pick reorder the two: top-ups, AI plans, site plans, SUBs, the blue tick and coin
  deposits all accept it.
- **Frenz Coin deposits (0299):** a Paystack rail beside Flutterwave's, through the router (purpose `wallet_topup`).
  Paystack charges naira at the live rate, and the attempt row pins it. References are `frenz_coin_dep_<uuid>` (no
  `_fw_`) and the webhook purpose is `frenz_coin_deposit`. The same `settle_coin_deposit`, the same hold, and refunds
  are logged for an admin, as with Flutterwave. The second rail is tried only after a definite refusal, under its own
  idempotency key (`…-alt1`).
- **Frenz Coin withdrawals:** the destination bank's country picks the rail (`lib/rewards/payout-rail.ts`): NG, GH, ZA
  and KE go to Paystack, beyond them to Flutterwave. Today every coin withdrawal is to a Nigerian bank, so Paystack pays
  it. Exclusive withdrawals keep Admin → SUB → Payout provider.
- **Not built, owner decisions:** paying a bank outside Nigeria in its own currency. That needs a bank-details form
  per country, an approved payout rate per currency (no rate is ever assumed), and, for Paystack in Ghana, Kenya or
  South Africa, a Paystack account registered in that country. Paystack pays out only inside its account's country,
  and the Frenz account is Nigerian.

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

## Frenz Coin Part 2 (2026-10-25) — financial safety prerequisites (migration 0278)

Hardening of the money that already exists, before any new wallet is built on it. The live money functions (0187
`request_withdrawal`, 0202 `transfer_credits`, 0256 `resolve_withdrawal`) are unchanged: the new rules live in new
functions that take the same locks and then call them. Before 0278 runs the app falls back to the live functions.
**Migration 0278 must be applied by hand, after 0277.**

- **Top-up refunds and chargebacks (H1).** `wallet_topup_reversals` + `reverse_wallet_topup`: once per provider event,
  never more than the top-up credited (recharge + pack bonus) in total, taken only from what is still in the wallet —
  deposited credits first, then other withdrawable credits, then tokens. What was already spent or sent is a
  SHORTFALL: recorded on the row, the account restricted (`reward_profiles.restricted`, reason
  `wallet_topup_shortfall`), the audit row lists the transfers since the top-up and any open withdrawal. Balances never
  go negative and no ledger row is rewritten. A dispute HOLDS the credits (a `reserved` reversal row) until an admin
  records the outcome: lost → settled, won → restored exactly as it left. Paystack `refund.processed` /
  `charge.dispute.create` apply on their own after the ORIGINAL charge is re-verified (`/transaction/verify`); a
  partial refund takes back its share, rounded up; another currency changes nothing and goes to review;
  `charge.dispute.resolve` is logged, not trusted. Flutterwave: this integration has no refund/chargeback event
  contract, so refund-, chargeback- or dispute-shaped events about a top-up are logged for an admin, who records the
  reversal in Admin → Rewards → Top-up refunds & chargebacks (the original charge is re-verified with Flutterwave).
  Anything uncertain is a 500 retry, never a guess.
- **Eligibility and suspension (M1, M2).** `request_credit_withdrawal` requires the admin-approved qualification
  (`qualified_at` set or status `approved`, the rewards page's own rule) and refuses a suspended or restricted member
  or one with an open shortfall — under the wallet lock. `transfer_credits_checked` refuses a suspended / restricted
  sender, an open shortfall, and a suspended RECIPIENT (owner decision to confirm: receiving was not restricted before).
- **Limits in the transaction (M3).** The rolling 24-hour transfer limit and the credit withdrawal per-day count and
  30-day sum are counted under the wallet row lock. A replay (same idempotency key) is answered, never counted twice.
  The withdraw form now sends a stable replay key. The per-day count now covers credit withdrawals only (the app
  counted SUB withdrawals too).
- **Retention (H3).** The ledger, transfers, withdrawals, SUB ledger and purchases, top-up attempts, verification
  purchases and plan renewals no longer CASCADE with `auth.users`; the user id stays as a stable pseudonymous key.
  A deletion request is refused while withdrawable credits, SUB money or debt, an open withdrawal, a payment in flight
  or a recovery is open. The purge calls `retain_financial_records` first (re-check, bank details redacted to bank +
  last four, token-only balance closed with a ledger row, audited) and skips the account on anything but a clean answer.
- **Fresh password for money (M4).** `lib/admin/financial-gate.ts`: withdrawal moves and payouts, wallet credits and
  adjustments, SUB reversals and dispute restores, top-up reversals, and `/api/admin/landing` saves that CHANGE a
  money setting. Refusals and outcomes go to `financial_audit_log`. The dashboard prompts through `sensitiveFetch`.
- **Settings audit (M5).** `frenzRewards` (surface `rewards`) and `frenzAiPlans.wallet` + the deposit minimum
  (surface `ai_wallet`) are written to `config_audit_log` BEFORE the save, awaited; no audit row → nothing saved. A
  failed save is now an error (it used to be ignored), with a `settings.update.failed` row. SUB settings count in the
  rewards version.
- **Ledger integrity.** `platform_fee_ledger` is the counter-entry of every transfer fee (trigger + backfill).
  `ai_product_ledger` allows only its legitimate in-place changes (same-transaction fill-in, the once-only
  `notified_at`, reserved → settled | refunded | reversed, settled → refunded, FK set-null) and no deletes;
  `sub_ledger`, `financial_audit_log`, `credit_transfers` and `platform_fee_ledger` are append-only. An operator
  correction needs `set local frenz.ledger_maintenance = 'on'` and is audited by the guard.
- **Tests.** `supabase/tests/0278_financial_safety.pglite.mjs` (logic, 9 mutants) and
  `supabase/tests/credit_wallet_concurrency.pg.mjs` (a real local PostgreSQL, separate connections, forced overlap,
  mutant `no-lock`), both built from the migrations by `credit_wallet.shared.mjs`.

**Still open:** withdrawal fees have no counter-entry yet (only transfer fees); a bank-returned AI-credit payout is still
restored by hand (0254); a Flutterwave payout reversed after success is not handled (needs a sandbox check of its
events); Paystack's dispute-resolution wording and whether `refund.processed` amounts are per refund (assumed) need
sandbox confirmation; a deleted member's later notifications (e.g. a bank return after deletion) would fail on the
notifications foreign key.

## Frenz Coin Part 3 (2026-10-25) — schema and accounting foundation (migration 0279)

Frenz Coin is a **separate wallet product** on the existing wallet tables: product `frenz_coin` in
`ai_product_balances` / `ai_product_ledger`, unit `USD` (integer cents). AI Credits are not converted, read or changed.
Config: `frenzCoin` in the landing settings (lib/coin/config.ts), **off by default**, audited first and versioned like
every money setting (surface `frenz_coin`). No UI, checkout, PIN or payout call yet. **Migration 0279 runs by hand after
0278.**

- **Balance model.** `balance_cents` = Σ coin ledger deltas; `pending_cents` = reserved positive rows (on hold, not
  spendable); `held_cents` = reserved negative rows (reserved for a withdrawal, outside the balance).
  available = balance − pending; total owned = balance + held = available + pending + held. `withdrawable_cents` /
  `deposited_cents` stay 0 on a coin row (constraint). Pending / held are 0 on every other product (constraint).
- **Only the coin functions write a coin wallet** (`frenz.coin_writer`, trigger `coin_wallet_guard`): an AI-credit
  charge, refund, recharge or adjustment naming `frenz_coin` is refused.
- **Transfers** (`transfer_coins`, record in `coin_transfers`): both coin wallets locked in user-id order; standing
  (suspended / restricted / open shortfall sender, suspended recipient) and the rolling 24-hour limit under the lock; the
  sender pays amount + fee from AVAILABLE coins, the recipient gets the amount. Fee = ceil(amount × 10%) + $1 below
  $100, + $0 from $100 to $500 inclusive, + $5 above $500 (all configurable). The rules are stored on the transfer.
- **Withdrawals** (`withdrawal_requests.source = 'coin'`, `request_coin_withdrawal`): available → held; fee =
  ceil(gross × 6%) + flat (0) taken FROM the amount, net = gross − fee (owner to confirm); NGN payout amount stored when
  a rate is configured. Resolution via `resolve_withdrawal` (coin dispatch → `resolve_coin_withdrawal`): completed
  settles the hold and posts the fee; rejected / cancelled returns it; bank return → `reverse_coin_paid_withdrawal`
  restores the gross and posts a fee reversal. Credits and sub run 0256 / 0254's code word for word.
- **Fee income.** `platform_fee_ledger` sources `coin_transfer_fee`, `coin_withdrawal_fee`,
  `coin_withdrawal_fee_reversal` (fee income given back), each unique per ledger row. Conservation, proven in tests:
  funded = in wallets (balance + held) + paid out (completed net) + fee income.
- **Tests.** `supabase/tests/0279_frenz_coin.pglite.mjs` (7 mutants), `supabase/tests/coin_concurrency.pg.mjs` (real
  PostgreSQL, mutant `no-lock`); the Part 2 suites also run with 0279 on top (`APPLY_0279=1`).

**Open for Part 4:** deposits (the `recharge` ledger kind fires 0187's reward trigger for any product — a coin deposit
needs its own kind or a product filter there); the coin payout path through `payWithdrawal` (compatible:
`amount_usd_cents` = net) is not exposed; transfer-fee refunds have no reversal path yet (a correction is an audited
`adjust_coin_balance`).

## Frenz Coin Part 4 (2026-10-25) — deposits, the 72-hour hold, transfers fail closed (migration 0280)

Run 0280 by hand AFTER 0279. Frenz Coin stays **off** (`frenzCoin.enabled` and `frenzCoin.deposits.enabled` are false by default).

**Deposits** ride the existing Flutterwave collection (`lib/coin/deposits.ts`), on the same attempt ledger (`ai_topup_attempts`, purpose `coin_deposit`, reference `frenz_coin_dep_fw_<uuid>`). USD only: one coin is $1 (100 cents) and a naira checkout for coins would need an exchange-rate / markup policy nobody has decided.

1. `POST /api/coin/deposits` → `begin_coin_deposit` writes the attempt (member, amount, provider amount and currency, the hold, the audited rules) BEFORE the checkout. One open deposit per member (advisory lock); a replayed idempotency key returns the attempt it made.
2. Settlement: the webhook (verified by transaction id), `POST /api/coin/deposits/verify` (the member's own reference, asked of Flutterwave) and the ai-reconcile cron all call `settleCoinDeposit` → `chargeMatches` (exact amount, currency, reference) → `settle_coin_deposit` (re-checks the paid amount and currency against the attempt under its row lock; once per reference). A redirect is never proof of payment.
3. The coins land **pending**: a ledger row of the new kind `deposit` (status reserved) and `pending_cents` rise with the balance. `coin_deposits.release_at` = the database's `now()` at settlement + the hold the attempt was opened with — never under 72 hours (constraint, SQL clamp, config clamp, admin schema). Pending coins cannot be sent or withdrawn (0279 spends `balance − pending` only).
4. Release: only `release_coin_deposit` / `release_due_coin_deposits`, at or after `release_at` by the database clock, once. Called by the cron and before a member's own wallet read. `release_coin_pending` refuses a deposit row; the `coin_deposits` guard refuses rewriting the hold or marking a deposit released early.

**Rewards.** 0187's `reward_on_topup_trg` fired on every `recharge` row. A coin deposit is `deposit` (never `recharge`), and the trigger is restated with `new.product <> 'frenz_coin'`. 0255's affiliate trigger only lists AI purposes. Coin deposits are also left out of collected revenue (members' money, owed back to them) and labelled "Frenz Coin deposit" in the admin payment alert.

**Refunds and chargebacks** (`coin_deposit_reversals`). Flutterwave sends no documented refund or chargeback event to this integration: such events are logged for review, and an admin records the reversal (`/api/admin/wallet/coin-deposit-reversals`, fresh password) after the original charge is re-verified. `reverse_coin_deposit` is once per event and never more than the deposit in total:
- on hold → taken back whole from its own pending coins (no shortfall possible); a dispute freezes the release until an admin records the outcome;
- released → recovered from available coins only; the rest is a shortfall, the account is restricted (`coin_deposit_shortfall`), recipients are never clawed back; a dispute holds what it can (`held_cents`) until won (returned) or lost (gone);
- a partial refund is recorded for review and applied by no code (an admin uses the audited `adjust_coin_balance`).

**Transfers fail closed.** `POST /api/coin/transfers` needs a financial transaction authorization (`lib/coin/authorization.ts`). None exists — the messaging quick-lock PIN is not one — so every request is refused with 403 before the database. Enabling transfers needs a financial PIN (setup, slow hash, attempt limits and lockout, an email-verified reset, audit) wired into `authorizeCoinTransfer`. The database path is unchanged from 0279 except that a replayed idempotency key naming another amount or recipient is refused (`idempotency_conflict`). After a transfer commits, the recipient is told once (claim on the ledger row's `notified_at`).

**Wallet reads.** `GET /api/coin/wallet` (available, pending, held, total, deposits on hold with release times, what the wallet can do) and `GET /api/coin/history` (the member's coin ledger, keyset pages of 20, 50 at most, public handle of the other member of a transfer, no metadata or admin notes).

**Tests.** `supabase/tests/0280_coin_deposits.pglite.mjs` (logic + 5 mutants), `supabase/tests/coin_deposits_concurrency.pg.mjs` (real PostgreSQL + no-lock mutant); `APPLY_0280=1` re-runs the Part 2 and Part 3 suites with 0280 on top.

### The Frenz Coin designs (design/frenz-coin-wallet-design.zip — reference for the UI part, not changed)

| Screen | Purpose | Backend in Part 4 |
|---|---|---|
| Main.dc.html | Wallet: balance card, wallet number, Deposit / Withdraw / Transfer / Save, auto-save rule, savings vault, monthly in/out, activity grouped by day with pending rows | `GET /api/coin/wallet`, `GET /api/coin/history` (vault, auto-save, monthly totals: not built) |
| Deposit.dc.html | Amount, quick amounts, payment method (card, Apple Pay, bank transfer), summary with a card fee | `POST /api/coin/deposits` (card fee and method choice: not built) |
| Transfer.dc.html | Recipient (recent, wallet number, QR), amount, note, fee line | `POST /api/coin/transfers` (fails closed), the existing wallet-number lookup |
| TransferReview.dc.html | Confirm: recipient, note, fee, wallet after, "confirm with Face ID / passcode" | needs the financial authorization dependency |
| Receipt.dc.html | Transfer receipt: status, date, parties, note, fee, reference | `GET /api/coin/history` entries (a receipt reference format: not built) |
| Vault.dc.html, AutoRules.dc.html | Savings vault, auto-save / auto-withdraw rules | not in scope (no backend) |
| Withdraw.dc.html | Withdraw from wallet or vault, instant (1%) vs standard (free) speed | not in Part 4 (coin withdrawals and NGN payouts excluded) |

Where the designs and the confirmed rules differ (owner to settle before the UI part): the designs show **1 FC = $0.01** (rules: 1 coin = $1), **"coins land instantly"** on deposit (rules: 72-hour hold), a **0.00 FC transfer fee** (rules: 10% + bracket flat fee), withdrawal speeds of **1% / free** (Part 3 setting: 6%), and a **card fee** on deposits (no deposit fee is configured).

## Frenz Coin Part 4.1 (2026-10-25) — restrictions scoped to their product, coin deposits in Admin → Payments (migration 0281)

Run 0281 by hand AFTER 0280 (and again after re-running any of 0278–0280).

**Restrictions.** Before 0281 an automatic shortfall wrote the account flag `reward_profiles.restricted`, which every money path reads (AI-credit transfers and withdrawals, SUB withdrawals, affiliate payouts, coins, and the public trust signal). So an AI-credit chargeback froze coins and SUB earnings, and a coin chargeback froze AI credits and SUB earnings. Now:

| Kind | Where it lives | Set by | Pauses |
|---|---|---|---|
| Suspension | `profiles.is_suspended` | moderation | everything |
| Account-wide restriction | `reward_profiles.restricted` | an administrator only (Admin → Rewards → Restrict: fresh password, `financial_audit_log`) | AI credits, coins, SUB withdrawals, rewards, affiliate payouts |
| AI-credit shortfall | open row in `wallet_topup_reversals` | `reverse_wallet_topup` | AI-credit transfers and withdrawals (`credit_wallet_block_reason`) |
| Frenz Coin shortfall | open row in `coin_deposit_reversals` | `reverse_coin_deposit` | coin transfers and withdrawals (`coin_wallet_block_reason`) |

Clearing a product shortfall touches nothing else. `reward_profiles_restriction_explicit_chk` forbids the two automatic reasons on the account flag. 0281 moves any already written off the account, one audit row each (`restriction_rescoped_to_product`).

Consequence (owner to note): a member with an open AI-credit shortfall can now still withdraw SUB earnings and use coins (and the reverse). If a case calls for it, an administrator restricts the account explicitly.

**Admin → Payments.** Coin deposits are listed under their own purpose, "Frenz Coin deposits", instead of "unknown". **Recheck** runs `reconcileCoinDepositAttempt`, the same leased path as the cron:
- the attempt row decides the member, amount, currency and provider; Flutterwave is asked about that reference;
- the charge must match exactly; settlement is once per reference in SQL, and the coins land on hold;
- a closed attempt is answered from the database; another provider's coin row answers `unsupported`;
- every recheck is audited (`admin_payment_recheck`), and mismatches separately (`coin_deposit_mismatch`).

## Frenz Coin Part 4.2 (2026-10-25) — the transaction PIN (migration 0282)

Run 0282 by hand AFTER 0281, and again after re-running 0279–0281, because those grant `transfer_coins` back. Set `FRENZ_COIN_PIN_PEPPER` (server-only, ≥ 32 random characters) first. Without it, PINs and transfers fail closed. Frenz Coin itself still ships off.

**The PIN.** Six digits, typed twice; not one repeated digit or a straight run. Never the messaging quick-lock PIN.
- Stored as `scrypt(HMAC-SHA256(pepper, user + PIN), 16-byte salt)` (N 2¹⁵, r 8, p 1, 32 bytes; parameters stored per PIN).
- Node's built-in scrypt is used; no new dependency.
- The hash never leaves the database: no API role (service role included) can read `coin_pins`, and the comparison happens in SQL.

**A transfer** (`POST /api/coin/transfers` with `pin`):
1. `begin_coin_pin_attempt` counts the attempt now, under the PIN row lock, and returns a single-use attempt (2 minutes) with the salt.
2. The server derives the key.
3. `transfer_coins_with_pin` consumes the attempt, compares the key, then runs `transfer_coins`, all in one transaction.

There is no reusable token. The attempt, PIN, recipient, amount, idempotency key and the server's fee rules are bound by being one call. `transfer_coins` is revoked from every API role, so this is the only way in. Every PIN failure (wrong, locked, not set, replayed) gives the same 403.

**Limits** (`frenzCoin.pin`, audited settings, clamped again in SQL):

| Setting | Default | Bounds |
|---|---|---|
| Attempts before a lock (`maxAttempts`) | 5 | 3–10 |
| First lock (`lockMinutes`) | 15 min, doubling each time | 5–1440; max 24 h, never permanent |
| Reset code lifetime (`resetTtlMinutes`) | 10 min | 5–30 |
| Reset codes per hour (`resetMaxPerHour`) | 3 | 1–10 |
| Wrong tries per code (`resetCodeMaxAttempts`) | 5 | 3–10 |

- Per-member and per-IP limiters in front (Upstash, or in-memory without it).
- The database counter is the durable limit across instances.

**Change** (`/api/coin/pin/change`): the current PIN through the same counted attempt, then the new one, in one transaction.

**Reset** (`/api/coin/pin/reset`, then `/reset/confirm`):
- Needs the signed-in session **and** the confirmed email.
- The code is 8 CSPRNG digits; only its HMAC is stored. 10 minutes, single use; a new code supersedes the old (one live code per member); a few wrong tries kill it.
- Completing it sets the new PIN, clears the locks and voids open attempts, atomically.
- The request always gives the same answer.

**Audit** (`financial_audit_log`; never a PIN, key, hash or code): `coin_pin_set`, `coin_pin_changed`, `coin_pin_failed`, `coin_pin_locked`, `coin_pin_reset_requested`, `coin_pin_reset_throttled`, `coin_pin_reset_failed`, `coin_pin_reset_completed`, `coin_transfer_authorized`, `coin_transfer_refused`.

**Tests:**
- `supabase/tests/0282_coin_pin.pglite.mjs` (logic plus 5 mutants);
- `supabase/tests/coin_pin_concurrency.pg.mjs` (real PostgreSQL plus a no-lock mutant);
- `lib/coin/pin.server.test.ts`, `lib/coin/authorization.test.ts`, `app/api/coin/coin-routes.test.ts`, `app/api/coin/pin/pin-routes.test.ts`;
- `APPLY_0282=1` stacks 0282 under the earlier suites.

## Frenz Coin closeout (2026-10-25) — withdrawals, corrections, notifications (migration 0283)

Run order (by hand, each after the one before): **0278 → 0279 → 0280 → 0281 → 0282 → 0283**. Re-running an earlier one restores its grants and bodies, so re-run everything after it as well. Frenz Coin stays **off**.

**Withdrawals.**
1. `POST /api/coin/withdrawals` checks the session, the confirmed email and the bank details. The bank names the account holder (Paystack account lookup). Only then is the transaction PIN taken.
2. `request_coin_withdrawal_with_pin` checks the PIN and holds the full gross in one transaction. The fee (6% by default) comes **from** the gross: $100 → $6 fee → $94 net. `request_coin_withdrawal` is revoked from every API role.
3. An admin reviews, approves and pays through the existing routes (`/api/admin/rewards/withdrawals/[id]`, `/[id]/paystack`), with a fresh password and an audit row. `GET /api/admin/wallet/coin-withdrawals` lists coin withdrawals. The rewards queue now labels them "Frenz Coin" (it said "credits" before).
4. The payout amount uses `frenzCoin.withdrawals.payoutRateSource`, which defaults to `none`, meaning **no coin payout can be sent**:
   - `fixed` uses `payoutMinorPerUsd`;
   - `market` uses the live market rate the AI-credit and SUB payouts already use, with no markup.
   The amount and how it was worked out (`payout_fx`) are recorded once (`record_coin_payout_quote`) before anything is sent; a retry pays the recorded amount.
5. Provider outcomes use the existing rails:
   - a provider-verified success settles the hold and posts the fee once;
   - a failure or rejection returns the gross, with no fee;
   - a late success after release is refused by the ledger and flagged for review;
   - a bank return restores the full gross and reverses the fee income, once;
   - the 10-minute cron verifies stuck payouts by reference.

**Corrections.**
- `POST /api/admin/wallet/coin-transfers/[id]/correct` (admins, fresh password, reason, replay key):
  - `fee_refund`: the transfer's fee goes back to the sender, once per transfer, and the fee income is reversed;
  - `sender_credit`: a platform-funded credit to the sender, never more than the transfer in total.
  The recipient is never debited, and members cannot reverse transfers.
- Partial deposit refunds held for review are applied with `action: "apply_partial"`: only their share, rounded up, once, and only after the hold.

**Notifications** (types `coin_deposit_update`, `coin_transfer_received`, `coin_transfer_sent`, `coin_withdrawal_update`, `coin_pin_security`). Each is sent after the money moved and once, keyed in `coin_notification_claims`.

| Event | How it is sent |
|---|---|
| Deposit held / released | the cron sweep |
| Transfer received / sent | right after the transfer |
| Withdrawal requested | right after the request |
| Withdrawal approved / rejected / paid / returned | in-app row written by the database in the same transaction; push added once by the sweep |
| PIN changed / reset | in-app, plus an email to the confirmed address; never the PIN or a code |

**Hardening.**
- PIN keys and reset-code hashes are compared over every byte (`coin_pin_bytes_equal`).
- Internal helpers are closed to the service role. Supabase's default privileges would otherwise grant them (found by `supabase/tests/coin_supabase_integration.pg.mjs`).

### Deployment prerequisites (no secrets here)

| Item | What is needed |
|---|---|
| `FRENZ_COIN_PIN_PEPPER` | ≥ 32 random characters (e.g. `openssl rand -base64 48`), server-only env (Vercel encrypted env, production + preview separately), never in the database or the client. Changing it invalidates every PIN: members must reset by email. There is no rotation scheme; plan any rotation with a forced-reset notice. |
| Flutterwave collection | Secret key, webhook secret hash (`verif-hash`, checked in constant time), USD verified, amount unit confirmed; the webhook URL `/api/flutterwave/webhook`. |
| Flutterwave / Paystack payouts | Transfers enabled, funded NGN balance, server IP whitelisted if IP whitelisting is on, Paystack "OTP for transfers" off. |
| Naira payout rate | An owner decision: `payoutRateSource` `fixed` (with `payoutMinorPerUsd`) or `market` (live, no markup). Until then coin payouts refuse. Any markup is unapproved and not implemented. |
| Admins | Every money action needs a fresh password (`requireFinancialAdmin`); account-wide restriction too. |
| Regulatory | Holding and transferring stored value, the payout of members' funds and Flutterwave's acceptance of the use case are unconfirmed. |

### Wallet mockups that need correcting before the UI part (design/frenz-coin-wallet-design.zip, not modified)

| Screen | Mockup says | Approved rule |
|---|---|---|
| Main, Deposit, Transfer, Vault, Withdraw | 1 FC = $0.01 (24,850 FC ≈ $248.50) | 1 coin = $1 |
| Deposit | "Coins land instantly"; a card fee line ($1.25) | 72-hour hold; no deposit fee approved |
| Transfer, TransferReview, Receipt | Fee 0.00 FC; "Arrives instantly" | 10% + $1 (< $100), 10% ($100–$500), 10% + $5 (> $500), paid by the sender on top |
| TransferReview | "Confirm with Face ID / passcode" | the 6-digit transaction PIN (device biometrics are not a server-verified factor) |
| Withdraw | Instant (1%) / Standard (free) speeds; $120.00 → $118.80 | 6% from the gross ($100 → $94); one speed; an admin pays |
| Vault, AutoRules | savings vault, auto-save, auto-withdraw | not built (no backend) |
