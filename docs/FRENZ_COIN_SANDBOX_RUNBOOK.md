# Frenz Coin — sandbox integration runbook (Part 8)

Status: **prepared, not run.** No disposable Supabase project and no provider test keys exist yet. Frenz Coin stays OFF in
production throughout. Nothing here is ever pointed at production or live keys.

## 0. Gate — run before anything else

```bash
FRENZ_PRODUCTION_SUPABASE_REF=<production ref> FRENZ_SANDBOX_SUPABASE_REF=<disposable ref> \
  node scripts/coin-sandbox-preflight.mjs --env-file .env.sandbox
```

It must print **All checks passed**. It refuses: the production project, an unnamed project, live Flutterwave or
Paystack keys, a missing transaction-PIN pepper. It reads environment variables only and never prints a value.
(`scripts/coin-sandbox-preflight.test.ts` pins the refusals.)

## 1. Environment the owner provides

| Item | Why |
|---|---|
| A **disposable** Supabase project, its ref written down by a person | migrations, grants, RLS and RPCs on the real Supabase stack |
| `.env.sandbox` pointing at it (URL, anon key, service-role key) | the app under test |
| Flutterwave **test** keys `FLWSECK_TEST-…` / `FLWPUBK_TEST-…` + a test `FLUTTERWAVE_SECRET_HASH` | deposits, refunds, payouts |
| Paystack **test** key `sk_test_…` (payout backup, bank-account resolution) | withdrawals |
| `FRENZ_COIN_PIN_PEPPER` — a sandbox-only random value (32+ chars) | PINs fail closed without it |
| A Resend test domain / key, one test push subscription | delivery checks |
| A public HTTPS URL for webhooks (preview deploy or tunnel) registered in the Flutterwave test dashboard | webhook delivery |

## 2. Database (disposable project only)

1. Apply `supabase/migrations/0278` → `0284` in order (each is safe to re-run; re-run once to prove it).
2. Run the existing suites' checks against it where they apply (the `.pg.mjs` suites target a local server by design —
   their checks are mirrored here by hand): no coin/PIN function executable by `anon` / `authenticated`; the revoked
   helpers (`transfer_coins`, `request_coin_withdrawal`, `coin_pin_check`, `coin_pin_lock`, `coin_pin_bytes_equal`,
   `lift_coin_shortfall_restriction`, `lift_topup_shortfall_restriction`, `coin_take_back_held_deposit`) not executable
   even by `service_role`; PIN tables unreadable by every API role; RLS on every coin table.
   A safe probe for "executable?" without running a body: call the RPC with a malformed typed argument — `42501` = not
   executable, `22P02` = executable, rejected before the call (Part 8 validated this on a local Postgres: 0 rows written).
3. Set `frenzCoin` in the sandbox's settings: `enabled: true`, deposits on, hold **1** hour (then 0, 72, 2160).

## 3. Provider test cases

Expected outcomes are the existing code's — this runbook adds no behaviour.

| # | Case | How | Expected |
|---|---|---|---|
| D1 | Deposit success | Wallet → Deposit $10, pay with a Flutterwave test card | attempt row before checkout; on return `on_hold`; coins pending for the configured hold; one ledger row |
| D2 | Duplicate events | replay the webhook; reload the return page; run the reconcile cron | still one credit (claim per reference) |
| D3 | Amount mismatch | pay a different amount (or replay a webhook with an edited amount — the signature must then fail) | `mismatch`, nothing credited, admin review |
| D4 | Currency mismatch | a charge in NGN for a USD attempt | `mismatch`, nothing credited |
| D5 | Reference mismatch / foreign reference | verify a reference that isn't the member's | 404, nothing credited |
| D6 | Hold release | wait the configured hold (1 h) or set 0 | released once, by the database clock |
| R1 | Full refund | refund in the Flutterwave test dashboard → Admin → Frenz Coin → Deposit reversals → record "Refund" | charge re-verified; coins taken back; spent part → shortfall |
| R2 | Partial refund | partial refund in dashboard → record with the refunded minor amount | state `review`; apply after release → `applied` |
| R3 | Chargeback | test dispute (if the sandbox supports it) → record "Chargeback" → "won"/"lost" | `disputed` → `restored` / `lost` |
| P1 | Successful payout | withdraw → admin approve → Pay to bank (rate source **fixed**, a sandbox rate) | naira amount + rate recorded BEFORE sending; `processing` → `completed` |
| P2 | Confirmed failure | a test account the rail rejects | rejected, gross returned once |
| P3 | Unknown outcome | provider timeout / 5xx | stays `processing` with its reference; reconcile resolves; no blind retry |
| P4 | Never sent | reject a transfer the provider has no record of | refused until the admin confirms "never sent", then rejected and audited |
| P5 | Bank return | a returned transfer (if the test rail can simulate it) | `reversed`, full gross restored once, fee income reversed once |
| N1 | Notifications | each case above | one push + one receipt email to the member it belongs to; admin alert per the channel setting |

## 4. Contracts still unverified (do not invent behaviour)

- **Flutterwave refunds and disputes** have no event contract in this integration: they are recorded by an
  administrator after checking the dashboard, and the original charge is re-verified first (fail-closed, by design).
- **Whether the test rail can simulate a bank return (P5) or a chargeback (R3)** — unknown until tried; if not, record
  them as untested.
- **`FLUTTERWAVE_AMOUNT_UNIT`**: defaults to "major" when unset (owner, 2026-10-24); D1 must confirm the charged amount
  equals the deposit exactly before any live use.
- **Market payout rate**: public mid-market feeds, not a payout-provider rate (see the Part 8 report) — use `fixed` in
  the sandbox.
