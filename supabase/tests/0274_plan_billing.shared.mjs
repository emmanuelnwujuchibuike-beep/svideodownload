// Shared by the 0274 harnesses (PGlite: logic + mutants; plan_billing_concurrency.pg.mjs: real concurrent connections).
// Stubs of 0004 / 0167 / 0273 (the columns 0274 reads and writes), a statement splitter, and 0274 as written or with
// ONE protection removed (--mutant). No dependencies beyond node:fs.
import { readFileSync } from "node:fs";

export const STUB = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create table auth.users (id uuid primary key, email text);
create type public.user_role as enum ('user', 'pro', 'admin');
create type public.billing_plan as enum ('free', 'pro', 'business');
create type public.subscription_status as enum ('active', 'trialing', 'past_due', 'canceled', 'incomplete', 'unpaid');
create table public.profiles (id uuid primary key references auth.users (id), role public.user_role not null default 'user');
create table public.subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan public.billing_plan not null default 'free', status public.subscription_status, provider text not null default 'paystack',
  customer_ref text, subscription_ref text, email_token text, current_period_end timestamptz,
  cancel_at_period_end boolean not null default false, updated_at timestamptz not null default now(), last_reference text);
create table public.ai_subscriptions (
  user_id uuid primary key references auth.users (id) on delete cascade, plan text not null, status text not null default 'active',
  provider text not null default 'paystack', plan_code text, customer_ref text, subscription_ref text, email_token text, last_reference text,
  current_period_start timestamptz, current_period_end timestamptz, cancel_at_period_end boolean not null default false,
  activated_at timestamptz, canceled_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint ai_subscriptions_status_chk check (status in ('active', 'trialing', 'past_due', 'canceled', 'expired')));
create unique index ai_subscriptions_subscription_ref_idx on public.ai_subscriptions (subscription_ref) where subscription_ref is not null;`;

export const split = (sql) => { const out = []; let cur = ""; let inD = false; let inQ = false;
  for (let i = 0; i < sql.length; i++) {
    if (!inQ && sql.startsWith("$$", i)) { inD = !inD; cur += "$$"; i++; continue; }
    if (!inD && sql[i] === "'") inQ = !inQ;
    if (!inD && !inQ && sql.startsWith("--", i)) { const nl = sql.indexOf("\n", i); i = nl < 0 ? sql.length : nl; cur += "\n"; continue; }
    if (sql[i] === ";" && !inD && !inQ) { if (cur.trim()) out.push(cur); cur = ""; } else cur += sql[i]; }
  if (cur.trim()) out.push(cur); return out; };

/** 0274 as written, or with ONE protection removed (the run must then fail). */
/**
 * 0274 then 0275 (0275 re-creates apply_plan_renewal: a duplicate closes its open review), as written or with ONE
 * protection removed. A mutant is applied to EVERY copy of its anchor (0275 re-creates the function, so a cut made only
 * in 0274 would be silently undone) and an anchor that is missing fails loudly.
 */
export function migration(dir, mutant) {
  let sql = readFileSync(`${dir}/0274_flutterwave_plan_billing.sql`, "utf8") + "\n" + readFileSync(`${dir}/0275_plan_renewal_duplicate_closes_review.sql`, "utf8");
  const cutAll = (a, b) => { if (!sql.includes(a)) throw new Error(`mutant anchor missing: ${a.slice(0, 60)}`); sql = sql.replaceAll(a, b); };
  if (mutant === "no-unique") {
    cutAll("  constraint plan_renewals_tx_uniq unique (provider, transaction_id)\n", "  constraint plan_renewals_tx_nouniq check (true)\n");
    cutAll(`  if exists (select 1 from public.plan_renewals where provider = p_provider and transaction_id = p_transaction_id) then
    return jsonb_build_object('result', 'duplicate');
  end if;`, "");
    cutAll(`  if exists (select 1 from public.plan_renewals where provider = p_provider and transaction_id = p_transaction_id) then
    return public.plan_renewal_duplicate(p_provider, p_transaction_id, p_admin);
  end if;`, "");
    cutAll("  on conflict (provider, transaction_id) do nothing\n", "");
  }
  if (mutant === "no-identity") cutAll("if v_provider is distinct from p_provider or v_ref is distinct from p_subscription_ref then", "if false then");
  if (mutant === "no-recheck") cutAll("if v_end is not null and now() <= v_cutoff then return 'not_expired'; end if;", "");
  if (mutant === "no-lock") sql = sql.replaceAll(" for update;", ";");
  // 0275's change undone: a duplicate answers without closing its review (Part 3.3.1 L3)
  if (mutant === "no-close") cutAll("  update public.plan_billing_reviews\n     set status = 'applied', resolution_note = coalesce(resolution_note, 'already applied')", "  update public.plan_billing_reviews\n     set status = status, resolution_note = coalesce(resolution_note, 'already applied')");
  return sql;
}

