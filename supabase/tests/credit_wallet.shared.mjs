// The AI-credit wallet's REAL schema and money functions, for the 0278 harnesses (Frenz Coin Part 2).
//
// Used by 0278_financial_safety.pglite.mjs (logic, mutants) and credit_wallet_concurrency.pg.mjs (separate
// connections). Both get the same database: a few stub tables the wallet only reads (auth.users, profiles,
// notifications, ai_jobs), then the wallet's own statements taken VERBATIM from the migrations, in order,
// with the newest definition of each function winning exactly as it does in production:
//
//   0151 / 0186 / 0197  ai_topup_attempts                0154  balances, ledger, settle_product_charge
//   0187  withdrawable part, reward_profiles, withdrawal_requests, reserve / refund / adjust, request_withdrawal
//   0191  qualification columns                          0193 / 0199 / 0202  wallet numbers, transfers, deposits
//   0227  SUB money tables, withdrawal columns, financial_audit_log, request_sub_withdrawal
//   0254 / 0256 / 0258  reversal, resolve_withdrawal, flat fee   0268 / 0274  verification_purchases, plan_renewals
//
// 0278 and 0279 are NOT included: each harness applies them (twice), so a run can also look at the state before them.
import { readFileSync } from "node:fs";

/** Split a migration the way PostgreSQL reads it: `;` ends a statement outside quotes, comments and $$ bodies. */
export const split = (sql) => {
  const out = [];
  let cur = "";
  let inD = false;
  let inQ = false;
  for (let i = 0; i < sql.length; i++) {
    if (!inQ && sql.startsWith("$$", i)) { inD = !inD; cur += "$$"; i++; continue; }
    if (!inD && sql[i] === "'") inQ = !inQ;
    if (!inD && !inQ && sql.startsWith("--", i)) { const nl = sql.indexOf("\n", i); i = nl < 0 ? sql.length : nl; cur += "\n"; continue; }
    if (sql[i] === ";" && !inD && !inQ) { if (cur.trim()) out.push(cur); cur = ""; } else cur += sql[i];
  }
  if (cur.trim()) out.push(cur);
  return out;
};

export const STUB = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create function public.is_admin() returns boolean language sql stable as $$ select false $$;
create function public.uuid_generate_v4() returns uuid language sql as $$ select gen_random_uuid() $$;
create table public.profiles (id uuid primary key references auth.users (id) on delete cascade, handle text, display_name text, is_suspended boolean not null default false, deletion_requested_at timestamptz);
create table public.notifications (id bigint generated always as identity primary key, user_id uuid not null references auth.users (id) on delete cascade, actor_id uuid, type text, data jsonb, post_id uuid, created_at timestamptz default now());
create table public.ai_jobs (id uuid primary key default gen_random_uuid(), user_id uuid references auth.users (id) on delete cascade);
-- only so 0254's restore function (declared with its %rowtype) compiles. SUB access is not tested here.
create table public.creator_memberships (id uuid primary key default gen_random_uuid(), creator_id uuid, member_id uuid, status text, billing text, price_cents integer, period_index integer, period_start timestamptz, period_end timestamptz, joined_at timestamptz, ended_at timestamptz);`;

/** The statements of `file` that pass `keep` (every statement when `keep` is omitted). */
const from = (dir, file, keep) => split(readFileSync(`${dir}/${file}`, "utf8")).filter((s) => (keep ? keep(s.trim()) : true));
const fn = (...names) => (s) => names.some((n) => s.startsWith(`create or replace function public.${n}(`));
const re = (...patterns) => (s) => patterns.some((p) => p.test(s));

export function walletStatements(dir) {
  return [
    ...from(dir, "0151_ai_topup_attempts.sql", re(/^create table if not exists public\.ai_topup_attempts/, /^create index if not exists ai_topup_attempts_/, /^alter table public\.ai_topup_attempts enable/)),
    ...from(dir, "0154_ai_product_wallet.sql"),
    ...from(dir, "0186_ai_topup_attempts_provider.sql", re(/^alter table public\.ai_topup_attempts/)),
    ...from(dir, "0187_rewards_referrals.sql", (s) =>
      re(/^alter table public\.ai_product_(balances|ledger)/, /^create table if not exists public\.(reward_profiles|withdrawal_requests)/, /^create index if not exists withdrawal_requests_/, /^alter table public\.(reward_profiles|withdrawal_requests) enable/)(s) ||
      fn("reserve_product_charge", "refund_product_charge", "adjust_product_balance", "request_withdrawal", "resolve_withdrawal")(s)),
    ...from(dir, "0191_reward_qualification_review.sql", re(/^alter table public\.reward_profiles/)),
    ...from(dir, "0193_credit_transfers.sql"),
    ...from(dir, "0197_ad_platform_payments.sql", re(/^alter table public\.ai_topup_attempts (drop constraint if exists|add constraint) ai_topup_attempts_status_chk/, /^alter table public\.ai_topup_attempts add column/)),
    ...from(dir, "0199_credit_transfer_kinds.sql"),
    ...from(dir, "0202_deposited_credits.sql"),
    ...from(dir, "0227_sub_monetization.sql", (s) =>
      re(/^create table if not exists public\.(sub_purchases|sub_balances|sub_ledger|financial_audit_log)/, /^create (unique )?index if not exists (sub_purchases|sub_balances|sub_ledger|financial_audit_log|withdrawal_requests)_/, /^alter table public\.withdrawal_requests/, /^alter table public\.(sub_purchases|sub_balances|sub_ledger|financial_audit_log) enable/)(s) ||
      fn("release_sub_earnings", "request_sub_withdrawal", "resolve_withdrawal")(s)),
    ...from(dir, "0254_payout_reversal_dispute_restore.sql"),
    ...from(dir, "0256_withdrawal_rejection_settles_debt.sql"),
    ...from(dir, "0258_withdrawal_flat_fee.sql"),
    ...from(dir, "0268_paid_verification.sql", re(/^create table if not exists public\.verification_purchases/)),
    ...from(dir, "0274_flutterwave_plan_billing.sql", re(/^create table if not exists public\.plan_renewals/)),
  ];
}

export const MIGRATION = "0278_financial_safety_prerequisites.sql";
export const migration = (dir) => split(readFileSync(`${dir}/${MIGRATION}`, "utf8"));
/** Frenz Coin Part 3: the coin foundation, applied after 0278. */
export const COIN_MIGRATION = "0279_frenz_coin_foundation.sql";
export const coinMigration = (dir) => split(readFileSync(`${dir}/${COIN_MIGRATION}`, "utf8"));

/** Frenz Coin Part 4: deposits, the hold and deposit reversals, applied after 0279. */
export const DEPOSIT_MIGRATION = "0280_frenz_coin_deposits.sql";
export const depositMigration = (dir) => split(readFileSync(`${dir}/${DEPOSIT_MIGRATION}`, "utf8"));
/**
 * What 0280 needs from production that the wallet statements above leave out: 0271's Flutterwave attempt provider, and
 * 0187's reward_on_activity (0280 restates the trigger that calls it). Verbatim from the migrations.
 */
export const depositPrerequisites = (dir) => [
  ...from(dir, "0271_payment_provider_flutterwave.sql", re(/^alter table public\.ai_topup_attempts/)),
  ...from(dir, "0187_rewards_referrals.sql", fn("reward_on_activity")),
];
/** Frenz Coin Part 4.1: restrictions scoped to their product, applied after 0280. */
export const SCOPE_MIGRATION = "0281_frenz_coin_restriction_scope.sql";
export const scopeMigration = (dir) => split(readFileSync(`${dir}/${SCOPE_MIGRATION}`, "utf8"));
/** 0281's product-scoped restrictions are in force in this run (APPLY_0281=1, which needs 0280 too). */
export const SCOPED = process.env.APPLY_0281 === "1";
/**
 * APPLY_0280=1: a suite of an earlier part re-runs with 0280 on top (twice, like every migration here);
 * APPLY_0281=1 adds 0281 after it.
 */
export const applyDeposits = (dir) =>
  process.env.APPLY_0280 === "1"
    ? [...depositPrerequisites(dir), ...depositMigration(dir), ...depositMigration(dir), ...(SCOPED ? [...scopeMigration(dir), ...scopeMigration(dir)] : []), ...(SCOPED && PIN ? [...pinMigration(dir), ...pinMigration(dir)] : [])]
    : [];
/** Frenz Coin Part 4.2: the transaction PIN (APPLY_0282=1, after 0281). */
export const PIN_MIGRATION = "0282_frenz_coin_transaction_pin.sql";
export const pinMigration = (dir) => split(readFileSync(`${dir}/${PIN_MIGRATION}`, "utf8"));
const PIN = process.env.APPLY_0282 === "1";
/** Closeout: withdrawals with the PIN, quotes, corrections, notifications (0283). APPLY_0283=1 stacks it under a suite. */
export const CLOSEOUT_MIGRATION = "0283_frenz_coin_closeout.sql";
export const closeoutMigration = (dir) => split(readFileSync(`${dir}/${CLOSEOUT_MIGRATION}`, "utf8"));
export const applyCloseout = (dir) => (process.env.APPLY_0283 === "1" ? [...closeoutMigration(dir), ...closeoutMigration(dir)] : []);

export const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
