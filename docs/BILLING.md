# Frenz billing — every money flow and the rules behind it

The single reference for how money moves on Frenz (owner, 2026-10-11: "build the
complete Frenz billing and business decisions"). Every number marked **(admin)**
is a default the operator changes in the admin panel, never in code.

There are **two separate balances**, and nothing moves between them:

1. **The AI wallet** — credits, for Frenz AI tools (and cash-out of the cashable kind).
2. **SUB** — real money creators earn from paid subscriptions (owner brief
   2026-10-11, migration 0227). See `docs/SUB_MONETIZATION.md` for the design.

## 1. The AI wallet: credits

- **1 credit = $0.10** (`frenzAiPlans.credits.centsPerCredit` = 10, owner 2026-10-07).
- One wallet per member: `ai_product_balances` (product `character_replace`, unit
  `CREDIT`), and one ledger: `ai_product_ledger`. Every movement is one atomic SQL
  function that writes both, with a unique reference so a retry never moves money twice.
- The wallet holds two kinds (0187, 0202). In the app:
  - **Credits**: cashable (`withdrawable_cents`). Rewards earned after a member
    qualifies, plus bought credits (`deposited_cents`, a part of Credits with its
    own withdrawal rate and fee).
  - **Tokens**: everything else (rewards before qualification, pack bonuses, gifts,
    admin adjustments). Spendable on anything, never cashable.
- **Spend order everywhere:** Tokens first, then Credits (cashable LAST, owner
  2026-10-07), and inside Credits, earned before deposited.

### Money in

| Flow | How | Where |
|---|---|---|
| Top-up (buy credits) | Checkout routed per market **(admin)**; credited only after the provider confirms. **Paystack is shown first and "Recommended"**; Bachs sits behind "More payment methods" (owner 2026-10-11) | `lib/ai/wallet/*`, `features/ai/wallet/payment-provider-picker.tsx` |
| Credit packs | 50 / 100 / 250 / 500 / 1,000 credits, optional bonus credits (Tokens) **(admin)** | `wallet-config.ts` |
| AI plans (Free / AI Pro / AI Max) | Subscription, monthly plan credits; same Paystack-recommended picker | `lib/ai/credits/*` |
| Ad campaigns | Paystack or Bachs checkout in local currency at the live rate plus a markup **(admin)** | `lib/ads-platform/payment-server.ts` |

### Money spent inside Frenz

| Flow | Rule | Fee |
|---|---|---|
| AI features | Reserved before the job, settled on success, refunded in full on failure (by kind) | none |
| Credit transfers (member → member) | Sender chooses Credits or Tokens; the recipient gets the same kind; deposited stays deposited | 5 % on earned, 10 % on deposited, paid by the sender on top **(admin)** |

Credits **cannot** buy a SUB subscription, and SUB money never becomes credits.

### Money out: credit withdrawals

- Only **Credits** (cashable) can be withdrawn. Withdrawals are off until enabled
  **(admin)**; a member must be approved for withdrawals first (0191).
- Rates: **10 credits = $1** for earned Credits, deposited Credits at their own rate less
  **10 %** **(admin)**. Limits: 100 to 10,000 credits a request, one a day, 50,000 a
  month **(admin)**. The credits are held when requested and returned on rejection.
- Reached from the AI credit dashboard's **Withdraw** button (it replaced "Explore AI
  tools", owner 2026-10-11), which offers AI Credits or SUB earnings.

## 2. SUB: paid subscriptions (0227)

| Step | Rule | Fee |
|---|---|---|
| Creator sets a price | **$1 to $1,000** a period **(admin)**, in integer USD cents | — |
| Subscriber pays | Creator's price **plus the purchase fee**, through Paystack, in naira at the live rate. A $10 price costs **$11**; the creator earns $10 | **10 %** on top, paid by the subscriber **(admin)** |
| Access | **30 days** per payment **(admin)**; no automatic renewal (planned) | — |
| Earnings | Credited only by `settle_sub_purchase` after Paystack's verified charge — a short or foreign-currency payment grants nothing and is audited. With `holdDays` 0 (owner: instant) they are available at once | — |
| Withdrawal | Creator withdraws any amount ≥ **$5** **(admin)** to a Nigerian bank; Paystack names the account holder first. With `autoPayout` on (owner: instant) it is paid through Paystack Transfers immediately, no admin step; `requireQualification` off (owner: no withdrawal requirements) | **10 %** of the amount withdrawn: $100 → **$90** to the bank **(admin)** |
| Auto-withdrawal | A creator saves a bank once (Paystack names the holder) and switches it on: each verified subscription is withdrawn to it straight away through the same SQL and rules; the cron sweeps what a hold released later | the same **10 %** withdrawal fee |
| Refund / dispute / reversal | Paystack `refund.processed` / `charge.dispute.create`, or an admin reversal with a reason: the access it bought ends and the price comes off the creator's balance; what was already withdrawn becomes **debt** settled by later earnings | the purchase fee is not re-charged |

Guarantees (all in SQL, under the balance lock): the browser never supplies a balance,
fee, qualification or payout detail; one open withdrawal per member per source; a
replay key per withdrawal (a double tap or retry can't pay twice); every money decision
lands in `financial_audit_log`.

## Payout rails (both balances)

- **Paystack Transfers (owner 2026-10-11)**: the member picks a Nigerian bank and an
  account number; **Paystack names the account holder** before the request is stored (a
  typed name is never trusted). The server pays the USD value at the **live naira market
  rate** (no markup, recorded on the withdrawal) with the fixed reference
  `frenz_wd_<id>` (Paystack refuses a reused reference). Paystack's webhook completes it,
  or — if the transfer fails or is reversed — rejects it and returns the money to the
  balance it came from (credits to the AI wallet, SUB to SUB). The cron verifies any
  transfer whose webhook never came. Credit withdrawals wait for an admin to press
  **Pay with Paystack**; SUB withdrawals go at once while `autoPayout` is on.
- **Manual bank transfer** (credits only): an admin pays outside Frenz and records the
  reference.
- **Paystack account requirements:** a verified business with **Transfers** enabled,
  enough NGN balance, and "OTP for transfers" **off** (otherwise each transfer waits for
  an OTP in the dashboard). Webhook events to add: `transfer.success`,
  `transfer.failed`, `transfer.reversed`, `refund.processed`, `charge.dispute.create`.

## What earns the platform money

| Source | Rate |
|---|---|
| Credits sold (top-ups, packs) | the price of the credits |
| AI plans | the plan price |
| Credit transfers | 5 % / 10 % (earned / deposited) |
| Deposited-credit withdrawals | 10 % |
| **SUB purchases** | **10 %** on top of every subscription price |
| **SUB withdrawals** | **10 %** of every amount withdrawn |
| Ad campaigns | the campaign price, plus the FX markup on local-currency checkout |

## Decisions still open for the owner

- Automatic renewal of SUB by a saved card (today each period is a new payment).
- Payout countries beyond Nigeria (Paystack also pays Ghana, Kenya and South Africa).
- Whether credit withdrawals should also pay out automatically below a threshold.
- Instant SUB payouts mean a refund after a withdrawal becomes creator debt; a hold
  (`holdDays`) is one switch away if chargebacks appear.
