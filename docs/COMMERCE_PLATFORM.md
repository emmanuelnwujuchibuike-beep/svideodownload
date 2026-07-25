# Enterprise Commerce Platform

One commerce layer — secure by default, transparent billing, reliable
transactions — across every Frenzsave surface. This document is the
human-readable companion to the machine-readable registry in
[`lib/platform/commerce-platform.ts`](../lib/platform/commerce-platform.ts), kept
honest by
[`commerce-platform.test.ts`](../lib/platform/commerce-platform.test.ts).

## Position: honest about what exists

Unlike the other platform briefs, the commerce substrate is genuinely *smaller*
than the brief — and this registry says so rather than papering over it. The real
revenue today is **subscriptions + advertising + affiliates + API billing**; the
marketplace, creator payouts, promotions, formal invoices and refund workflows are
`planned`, several sitting over concept-stage products the Reality Ledger will not
let us pretend ship.

## What runs today

| Layer | Reality | Anchor |
|---|---|---|
| Payments | Paystack REST client; HMAC-SHA512 webhook verification | `lib/paystack/paystack.ts` |
| Checkout | Hosted Paystack checkout for a chosen plan | `app/api/checkout/route.ts` |
| Webhook | Signature-verified callback settles subscription state | `app/api/paystack/webhook/route.ts` |
| Subscriptions | Provider status → local `subscriptions` + entitlement | `lib/paystack/sync.ts` |
| Billing portal | Manage card / cancel via Paystack | `app/api/billing/portal/route.ts` |
| Plans | Plan + per-plan limits; one sub unlocks the tier everywhere | `lib/monetization/plan.ts` |
| Pricing | Editable display pricing, admin-set, no redeploy | `lib/monetization/pricing.ts` |
| Revenue routing | Ad / affiliate / premium-prompt / API-upsell by context | `lib/monetization/decision-engine.ts` |
| Ads / affiliates | Placements, impressions, clicks; tracked affiliate offers | `lib/monetization/{ads,affiliates}.ts` |
| API billing | Keys + per-key daily usage against the plan limit | `lib/api/keys.ts` |
| Analytics | Revenue/MRR (from the real admin price), subscribers | `lib/monetization/stats.ts` |

## Commerce philosophy

One platform · multiple revenue models · secure by default · transparent billing.
Two rules make this concrete and are already enforced:

- **Never invent a number.** MRR is derived from the *admin-set display price*, not
  a guessed env var — a price of "contact us" returns null rather than a fabricated
  figure (`lib/monetization/stats.ts`). The same rule that keeps the Reality Ledger
  honest keeps the revenue dashboard honest.
- **Secure by default.** The webhook verifies Paystack's HMAC-SHA512 signature
  before it will move a subscription; the payment client is dormant unless the
  secret key is set, so a misconfigured deploy can't half-charge anyone.

## Subscription tiers

**Free / Pro / Business** are live (`lib/monetization/plan.ts`). Trials, creator/
professional/enterprise plans, family plans, organization billing and true
usage-based billing are `planned`.

## Honestly planned

Named by the brief, not built — marked `planned` in the registry:

- **Services**: an in-app refund workflow (Paystack dashboard handles refunds
  today), the Marketplace transaction service, creator payouts + settlements,
  formal invoice/receipt + tax hooks, the promotion service and a fraud layer.
- **Payments**: multiple providers (only Paystack is wired; the seams are
  provider-shaped), split payments, in-app refunds/partial refunds.
- **Billing / promotions**: invoices + tax hooks, dunning (a failed renewal
  downgrades today, but there's no active recovery sequence), coupons, referrals,
  loyalty/credits, campaigns and bundles.
- **Commerce Intelligence (AI)**: fraud analysis, narrated insights, promotion
  recommendations, subscription optimization, revenue forecasting, support
  assistance — analytics today are real but *descriptive*, not predictive.

## Governance

The registry is subject to the constitution's truth rule (`docs/CONSTITUTION.md`,
Article I.3): a `live`/`partial` row must point at a file that exists, a `planned`
row must name none, and every live commerce *type* must be powered by a service
that really exists. The test fails the build otherwise. The operator view is the
admin **Commerce** section (under Money); live revenue/subscribers are in
**Revenue**.
