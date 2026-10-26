// 0279 (Frenz Coin Part 3) — the coin wallet's accounting, against the REAL functions in PGlite.
// Run from a folder under %TEMP% (where @electric-sql/pglite is installed), next to credit_wallet.shared.mjs:
//   node 0279_frenz_coin.pglite.mjs <repo>/supabase/migrations [--mutant=<name>]
//
// Builds the wallet from the migrations (credit_wallet.shared.mjs), applies 0278 and 0279 twice each, then drives coin
// funding, pending holds, transfers at every fee bracket and boundary, withdrawals through hold / reject / complete /
// bank return, the eligibility and limits, and the guards — checking the coin invariants AND full conservation of
// money after every step. Credits and SUB are exercised alongside to show they are unchanged.
// (The whole Part 2 suite also runs with 0279 on top: APPLY_0279=1 node 0278_financial_safety.pglite.mjs …)
//
// ⚠️ PGlite is ONE connection: interleaving is in coin_concurrency.pg.mjs.
//
// --mutant=<name> breaks one protection and the run must FAIL:
//   no-coin-guard    the coin wallet guard trigger is dropped        -> an AI-credit writer moves coins
//   no-daily-limit   transfer_coins skips the 24-hour sum            -> over the daily limit
//   no-fee-ceil      the percentage fee rounds DOWN                  -> fees a cent short at the boundaries
//   spend-pending    transfer_coins spends the pending part too      -> money on hold leaves the wallet
//   fee-twice        a second fee-posting trigger and no unique key  -> fee income counted twice
//   no-ledger-guard  0278's ledger guard is dropped                  -> a coin movement is rewritten
//   withdraw-ignores-held  request_coin_withdrawal checks balance, not available -> pending money withdrawn
// (spend-pending and withdraw-ignores-held also drop the pending ≤ balance constraint, which alone stops them too)
import { PGlite } from "@electric-sql/pglite";

import { applyDeposits, coinMigration, migration, SCOPED, split, STUB, U, walletStatements } from "./credit_wallet.shared.mjs";

const dir = process.argv[2];
const MUTANT = (process.argv.find((a) => a.startsWith("--mutant=")) ?? "").split("=")[1] ?? "";
const db = new PGlite();
const run = async (stmts) => { for (const s of stmts) { try { await db.exec(s); } catch (e) { console.log("SQL ERROR:", e.message, "\n", s.slice(0, 300)); process.exit(2); } } };
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; console.log("FAIL:", m); } else console.log("ok:", m); };
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const one = async (sql, params = []) => (await q(sql, params))[0];
const rpc = async (sql, params = []) => Object.values((await one(sql, params)) ?? {})[0];
const throws = async (sql, params = []) => { try { await db.query(sql, params); return null; } catch (e) { return e.message; } };

await run(split(STUB));
await run(walletStatements(dir));
await run(migration(dir));
await run(migration(dir));
await run(coinMigration(dir));
await run(coinMigration(dir));
// Frenz Coin Part 4 regression: APPLY_0280=1 runs this WHOLE Part 3 suite with 0280 on top
await run(applyDeposits(dir));
await db.exec(`insert into auth.users (id, email, email_confirmed_at) select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'u' || g || '@t.test', now() from generate_series(1, 60) g`);
await db.exec(`insert into public.profiles (id) select id from auth.users`);
await db.exec("grant usage on schema public to anon, authenticated");
await db.exec("grant select, insert, update, delete on all tables in schema public to anon, authenticated");

// the confirmed schedule (lib/coin/config.ts COIN_DEFAULTS)
const TRANSFER = { enabled: true, version: 1, percentBp: 1000, lowThresholdCents: 10000, highThresholdCents: 50000, flatBelowCents: 100, flatMidCents: 0, flatAboveCents: 500, minCents: 1, maxCents: 500000, dailyMaxCents: 10000000 };
const WITHDRAW = { enabled: true, version: 1, percentBp: 600, flatCents: 0, minCents: 1, maxCents: 500000, maxPerDay: 50, maxMonthCents: 100000000, requireQualification: false, requireEmailConfirmed: true, payoutCurrency: "NGN", payoutMinorPerUsd: null };
const ADMIN = U(59);

// ── mutants ──
const fnBody = async (name) => (await one("select pg_get_functiondef(p.oid) d from pg_proc p where p.proname = $1", [name])).d;
const mutate = async (name, from, to) => { const b = await fnBody(name); const m = b.replace(from, to); if (m === b) throw new Error(`mutant on ${name} did not apply`); await db.exec(m); };
if (MUTANT === "no-coin-guard") await db.exec("drop trigger ai_product_balances_coin_guard on public.ai_product_balances; drop trigger ai_product_ledger_coin_guard on public.ai_product_ledger");
if (MUTANT === "no-daily-limit") await mutate("transfer_coins", "if v_sent + p_amount > (p_rules ->> 'dailyMaxCents')::bigint then", "if false then");
if (MUTANT === "no-fee-ceil") await mutate("coin_transfer_fee", "v_pct := (p_amount * v_bp + 9999) / 10000;", "v_pct := (p_amount * v_bp) / 10000;");
// the pending ≤ balance constraint is the second wall (observed: with only the check removed it aborts the statement); both go
const dropStateWall = () => db.exec("alter table public.ai_product_balances drop constraint ai_product_balances_coin_state_chk");
if (MUTANT === "spend-pending") { await mutate("transfer_coins", "if v_s_bal - v_s_pend < v_total then", "if v_s_bal < v_total then"); await dropStateWall(); }
if (MUTANT === "withdraw-ignores-held") { await mutate("request_coin_withdrawal", "if v_bal - v_pend < p_gross then", "if v_bal < p_gross then"); await dropStateWall(); }
if (MUTANT === "no-ledger-guard") await db.exec("drop trigger ai_product_ledger_guard on public.ai_product_ledger");
if (MUTANT === "fee-twice") {
  await db.exec("drop index public.platform_fee_ledger_source_uidx");
  await mutate("post_transfer_fee", "on conflict (source, source_ledger_id) do nothing;", ";");
  await db.exec("create trigger ai_product_ledger_post_fee_again after insert on public.ai_product_ledger for each row when (new.kind = 'transfer_fee') execute function public.post_transfer_fee()");
}

const coin = async (u) => (await one("select balance_cents::int b, pending_cents::int p, held_cents::int h from ai_product_balances where user_id = $1 and product = 'frenz_coin'", [u])) ?? null;
const fund = (u, cents, ref, pending = false) => rpc("select adjust_coin_balance($1, $2, $3, 'test funding', $4, $5)", [u, cents, ref, ADMIN, pending]);
const wallet = (u) => rpc("select ensure_wallet_number($1)", [u]);
const send = (from, to, cents, key, rules = TRANSFER) => rpc("select transfer_coins($1, $2, $3, $4, null, $5::jsonb)", [from, to, cents, key, JSON.stringify(rules)]);
const withdraw = (u, cents, key, rules = WITHDRAW) => rpc("select request_coin_withdrawal($1, $2, 'paystack', '{\"bankCode\": \"058\", \"accountNumber\": \"0123456789\"}'::jsonb, $3, $4::jsonb)", [u, cents, key, JSON.stringify(rules)]);
const resolve = (id, status, ref = null) => rpc("select resolve_withdrawal($1, $2, $3, 'test', $4)", [id, status, ADMIN, ref]);

/** Every coin wallet reconciles to its own ledger, and money is conserved across the whole system. */
const invariants = async (label) => {
  const bad = await q(`select b.user_id, b.balance_cents, b.pending_cents, b.held_cents, l.s, l.pend, l.held from ai_product_balances b
    left join (select user_id, sum(delta_cents) s, coalesce(sum(delta_cents) filter (where status = 'reserved' and delta_cents > 0), 0) pend,
                      coalesce(-sum(delta_cents) filter (where status = 'reserved' and delta_cents < 0), 0) held
                 from ai_product_ledger where product = 'frenz_coin' group by user_id) l on l.user_id = b.user_id
    where b.product = 'frenz_coin' and (b.balance_cents <> coalesce(l.s, 0) or b.pending_cents <> coalesce(l.pend, 0) or b.held_cents <> coalesce(l.held, 0)
      or b.pending_cents > b.balance_cents or b.balance_cents < 0 or b.held_cents < 0)`);
  ok(bad.length === 0, `${label}: balance = Σ ledger, pending = Σ reserved credits, held = Σ reserved debits, available ≥ 0${bad.length ? " " + JSON.stringify(bad) : ""}`);
  const c = await one(`select
      (select coalesce(sum(delta_cents), 0) from ai_product_ledger where product = 'frenz_coin' and kind = 'adjustment')::bigint funded,
      (select coalesce(sum(balance_cents + held_cents), 0) from ai_product_balances where product = 'frenz_coin')::bigint wallets,
      (select coalesce(sum(net_cents), 0) from withdrawal_requests where source = 'coin' and status = 'completed')::bigint paid_out,
      (select coalesce(sum(case when source = 'coin_withdrawal_fee_reversal' then -amount else amount end), 0) from platform_fee_ledger where source like 'coin_%')::bigint fees,
      (select coalesce(sum(-delta_cents), 0) from ai_product_ledger where product = 'frenz_coin' and kind = 'transfer_fee')::bigint transfer_fees,
      (select coalesce(sum(amount), 0) from platform_fee_ledger where source = 'coin_transfer_fee')::bigint posted_transfer_fees,
      (select coalesce(sum(fee_cents), 0) from withdrawal_requests where source = 'coin' and status = 'completed')::bigint withdrawal_fees,
      (select coalesce(sum(case when source = 'coin_withdrawal_fee' then amount else -amount end), 0) from platform_fee_ledger where source in ('coin_withdrawal_fee', 'coin_withdrawal_fee_reversal'))::bigint posted_withdrawal_fees`);
  const n = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Number(v)]));
  ok(n.funded === n.wallets + n.paid_out + n.fees, `${label}: conservation — funded ${n.funded} = in wallets/held ${n.wallets} + paid out ${n.paid_out} + fee income ${n.fees}`);
  ok(n.transfer_fees === n.posted_transfer_fees && n.withdrawal_fees === n.posted_withdrawal_fees, `${label}: fee income = fees charged (transfers ${n.transfer_fees}=${n.posted_transfer_fees}, withdrawals ${n.withdrawal_fees}=${n.posted_withdrawal_fees})`);
};

// ── schema ──
ok((await one("select count(*)::int n from ai_product_balances where product = 'frenz_coin'")).n === 0, "no coin wallet exists until one is needed");
ok(!!(await throws("insert into ai_product_balances (user_id, product, balance_cents, currency) values ($1, 'frenz_coin', 100, 'USD')", [U(1)])), "a coin wallet cannot be written outside the coin functions");
ok(!!(await throws("select credit_product_balance($1, 'frenz_coin', 100, 'grant', 'sneak', 'USD')", [U(1)])), "an AI-credit writer naming frenz_coin is refused");
ok(!!(await throws("insert into ai_product_balances (user_id, product, balance_cents, currency, pending_cents) values ($1, 'character_replace', 0, 'CREDIT', 5)", [U(1)])), "pending/held are always 0 on an AI-credit wallet");
await invariants("start");

// ── funding, pending ──
const A = U(1), B = U(2), C = U(3);
const [wA, wB, wC] = [await wallet(A), await wallet(B), await wallet(C)];
let r = await fund(A, 100000, "fund-a-1");
ok(r.ok && (await coin(A)).b === 100000, "an operator funds a coin wallet (audited adjustment)");
ok((await fund(A, 100000, "fund-a-1")).duplicate === true && (await coin(A)).b === 100000, "the same funding reference twice credits once");
ok(!!(await throws("select credit_product_balance($1, 'frenz_coin', 1, 'grant', 'x2', 'USD')", [A])), "credit_product_balance cannot touch an existing coin wallet either");
ok(!!(await throws("select reserve_product_charge($1, 'frenz_coin', gen_random_uuid(), 10, 'USD', null)", [A])), "an AI job charge cannot spend coins");
ok(!!(await throws("select adjust_product_balance($1, 'frenz_coin', -10, 'adj-x', 'x', $2, 'USD')", [A, ADMIN])), "the AI-credit adjustment cannot move coins");
r = await fund(B, 20000, "fund-b-pending", true);
ok((await coin(B)).b === 20000 && (await coin(B)).p === 20000, "a pending credit is in the balance but not available");
r = await send(B, wC, 100, "b-pend-1");
ok(!r.ok && r.reason === "insufficient" && Number(r.available) === 0, "pending money cannot be sent");
r = await withdraw(B, 100, "b-pend-w1");
ok(!r.ok && r.reason === "insufficient", "pending money cannot be withdrawn");
r = await rpc("select release_coin_pending($1, 'fund-b-pending', $2)", [B, ADMIN]);
ok(r.ok && (await coin(B)).p === 0, "released, it becomes available");
ok((await rpc("select release_coin_pending($1, 'fund-b-pending', $2)", [B, ADMIN])).duplicate === true, "a release twice releases once");
await invariants("funding");

// ── the fee schedule, at every boundary (the SQL formula itself) ──
const fees = [
  [1, 1, 100, "below"], [99, 10, 100, "below"], [5000, 500, 100, "below"], [9999, 1000, 100, "below"],
  [10000, 1000, 0, "mid"], [10001, 1001, 0, "mid"], [25000, 2500, 0, "mid"], [49999, 5000, 0, "mid"], [50000, 5000, 0, "mid"],
  [50001, 5001, 500, "above"], [60000, 6000, 500, "above"], [123457, 12346, 500, "above"],
];
for (const [amount, pct, flat, bracket] of fees) {
  const f = await rpc("select coin_transfer_fee($1, $2::jsonb)", [amount, JSON.stringify(TRANSFER)]);
  ok(Number(f.percent) === pct && Number(f.flat) === flat && f.bracket === bracket && Number(f.total) === amount + pct + flat, `fee for ${amount}¢: ${pct} + ${flat} (${bracket}), total ${amount + pct + flat}`);
}

// ── transfers: the three worked examples ──
for (const [cents, total, key] of [[5000, 5600, "ex-50"], [25000, 27500, "ex-250"], [60000, 66500, "ex-600"]]) {
  const before = (await coin(A)).b;
  const recBefore = (await coin(C))?.b ?? 0;
  r = await send(A, wC, cents, key);
  ok(r.ok && Number(r.total) === total && (await coin(A)).b === before - total && (await coin(C)).b === recBefore + cents, `send $${cents / 100}: the sender pays ${total / 100}, the recipient receives ${cents / 100}`);
}
const t = await one("select * from coin_transfers where idempotency_key = 'ex-600'");
ok(t && Number(t.fee_percent_cents) === 6000 && Number(t.fee_flat_cents) === 500 && t.bracket === "above" && t.rules_snapshot.percentBp === 1000 && t.rules_snapshot.fee.total === 66500, "the transfer stores its fee parts and the rules it was priced under");
r = await send(A, wC, 60000, "ex-600");
ok(r.duplicate === true && Number(r.total) === 66500 && Number((await one("select count(*) n from coin_transfers where sender_id = $1 and idempotency_key = 'ex-600'", [A])).n) === 1, "the same key again answers the first transfer and charges nothing");
const aLeft = (await coin(A)).b; // 100000 - 5600 - 27500 - 66500 = 400
ok(aLeft === 400, `after the three examples A has $4.00 (${aLeft})`);
// Part 7: coins RECEIVED in a transfer are settled — spendable at once, no hold (only deposits are held)
{
  const c = await coin(C);
  ok(c.p === 0 && c.b >= 1000, `received coins are settled: C holds ${c.b}, none pending`);
  const bBefore = (await coin(B)).b;
  r = await send(C, wB, 1000, "recv-spend-1");
  ok(r.ok && (await coin(B)).b === bBefore + 1000, "the recipient can send received coins on immediately");
}
r = await send(A, wC, 300, "insufficient-1");
ok(!r.ok && r.reason === "insufficient" && Number(r.needed) === 430 && (await coin(A)).b === 400, "$3.00 + $1.30 fee is more than $4.00: refused, nothing moved");
ok(Number((await one("select count(*) n from coin_transfers where idempotency_key = 'insufficient-1'")).n) === 0, "a refused transfer writes no record");
r = await send(A, wA, 100, "self-1");
ok(!r.ok && r.reason === "self", "a transfer to oneself is refused");
r = await send(A, "1234567890", 100, "nobody-1");
ok(!r.ok && r.reason === "no_account", "an unknown wallet number is refused");
r = await send(U(9), wC, 100, "nowallet-1");
ok(!r.ok && r.reason === "no_wallet", "a member without a coin wallet cannot send");
r = await send(A, wC, 0, "zero-1");
ok(!r.ok && r.reason === "invalid", "a zero amount is refused");
r = await send(A, wC, 50, "small-1", { ...TRANSFER, minCents: 100 });
ok(!r.ok && r.reason === "amount_out_of_range", "below the configured minimum is refused");
r = await send(A, wC, 50, "rules-1", { ...TRANSFER, percentBp: 99999 });
ok(!r.ok && r.reason === "rules_invalid", "rules out of bounds are refused before anything moves");
r = await send(A, wC, 50, "rules-2", { ...TRANSFER, percentBp: 10.5 });
ok(!r.ok && r.reason === "rules_invalid", "a fractional rule is refused");
r = await send(A, wC, 50, "off-1", { ...TRANSFER, enabled: false });
ok(!r.ok && r.reason === "disabled", "transfers switched off are refused");
await invariants("transfers");

// ── standing ──
const D = U(4);
await fund(D, 100000, "fund-d");
const wD = await wallet(D);
await db.exec(`update profiles set is_suspended = true where id = '${D}'`);
ok((await send(D, wC, 100, "d-1")).reason === "suspended", "a suspended sender is refused");
await db.exec(`update profiles set is_suspended = false where id = '${D}'`);
await db.exec(`insert into reward_profiles (user_id, restricted, restricted_reason) values ('${D}', true, 'admin')`);
ok((await send(D, wC, 100, "d-2")).reason === "restricted", "a restricted sender is refused");
await db.exec(`update reward_profiles set restricted = false where user_id = '${D}'`);
await db.exec(`insert into wallet_topup_reversals (provider, event_key, kind, reference, user_id, credits_credited, credits_due, credits_recovered, shortfall_credits, state, ledger_reference) values ('paystack', 'sf-d', 'refund', 'frenz_cr_topup_d', '${D}', 100, 100, 40, 60, 'recovered', 'x')`);
// 0281 (APPLY_0281=1): an AI-credit shortfall pauses AI credits only — coins are NOT paused by it
if (SCOPED) {
  ok((await send(D, wC, 100, "d-3")).ok === true, "0281: an open AI-credit shortfall does NOT pause coin transfers");
  ok((await withdraw(D, 1000, "d-w1")).ok === true, "0281: nor coin withdrawals");
} else {
  ok((await send(D, wC, 100, "d-3")).reason === "recovery_due", "an open refund shortfall blocks coin transfers too");
  ok((await withdraw(D, 1000, "d-w1")).reason === "recovery_due", "and coin withdrawals");
}
await db.exec(`update wallet_topup_reversals set shortfall_cleared_at = now() where event_key = 'sf-d'`);
await db.exec(`update profiles set is_suspended = true where id = '${C}'`);
ok((await send(D, wC, 100, "d-4")).reason === "recipient_unavailable", "nobody can send to a suspended account");
await db.exec(`update profiles set is_suspended = false where id = '${C}'`);
ok((await send(D, wC, 100, "d-5")).ok === true, "once cleared, the transfer goes through");

// ── the daily limit, at the boundary ──
const E = U(5);
await fund(E, 1000000, "fund-e");
const daily = { ...TRANSFER, dailyMaxCents: 10000 };
ok((await send(E, wD, 6000, "e-1", daily)).ok, "6000 of a 10000 daily limit");
r = await send(E, wD, 4001, "e-2", daily);
ok(!r.ok && r.reason === "daily_limit" && Number(r.sent) === 6000, "4001 more would pass it: refused");
ok((await send(E, wD, 4000, "e-3", daily)).ok, "exactly up to the limit is allowed (amounts, not fees)");
ok((await send(E, wD, 1, "e-4", daily)).reason === "daily_limit", "one cent more is not");
ok((await send(E, wD, 6000, "e-1", daily)).duplicate === true, "a replay at the limit is answered, never counted");
await invariants("limits");

// ── withdrawals ──
const W = U(6);
await fund(W, 50000, "fund-w");
r = await withdraw(W, 10000, "w-1");
ok(r.ok && Number(r.fee) === 600 && Number(r.net) === 9400, "$100 withdrawal: 6% fee $6, $94 paid out");
let s = await coin(W);
ok(s.b === 40000 && s.h === 10000, "available → held: the gross leaves the balance and is held");
const w1 = r.id;
const row = await one("select * from withdrawal_requests where id = $1", [w1]);
ok(row.source === "coin" && Number(row.gross_cents) === 10000 && Number(row.fee_cents) === 600 && Number(row.net_cents) === 9400 && Number(row.amount_usd_cents) === 9400 && row.rate_snapshot.percentBp === 600 && row.rate_snapshot.fee.net === 9400, "the request stores gross, fee, net and the rules it was priced under");
ok((await withdraw(W, 10000, "w-1")).duplicate === true && (await coin(W)).h === 10000, "the same key again holds nothing twice");
ok((await withdraw(W, 1000, "w-2")).reason === "open_exists", "one open coin withdrawal at a time");
ok(!!(await throws("update ai_product_ledger set delta_cents = -1 where reference = $1", ["coin-withdrawal:" + w1])), "the hold row cannot be rewritten");
ok((await resolve(w1, "approved")).ok && (await resolve(w1, "processing", "frenz_fwd_x")).ok, "approved, then processing with a payout reference");
ok((await coin(W)).h === 10000, "an uncertain (processing) payout keeps the money held");
ok((await resolve(w1, "completed")).ok, "the provider confirms: completed");
s = await coin(W);
ok(s.b === 40000 && s.h === 0, "completed: the hold is settled, nothing returns");
ok(Number((await one("select count(*) n from platform_fee_ledger where source = 'coin_withdrawal_fee' and reference = $1", ["coin-withdrawal:" + w1])).n) === 1, "the withdrawal fee is posted once");
ok((await resolve(w1, "completed")).reason === "final" && Number((await one("select count(*) n from platform_fee_ledger where source = 'coin_withdrawal_fee'")).n) === 1, "resolving again is refused; no second fee");
await invariants("withdrawal completed");
r = await rpc("select reverse_paid_withdrawal($1, $2, 'bank returned it')", [w1, ADMIN]);
ok(r.ok && (await coin(W)).b === 50000, "the bank returned the payout: the gross comes back");
ok((await rpc("select reverse_paid_withdrawal($1, $2, 'again')", [w1, ADMIN])).duplicate === true && (await coin(W)).b === 50000, "a bank return twice restores once");
ok(Number((await one("select count(*) n from platform_fee_ledger where source = 'coin_withdrawal_fee_reversal'")).n) === 1, "the fee income is given back with its own counter-entry");
await invariants("bank return");
r = await withdraw(W, 1001, "w-3", { ...WITHDRAW, flatCents: 50, payoutMinorPerUsd: 150000 });
ok(r.ok && Number(r.fee) === 61 + 50 && Number(r.net) === 890 && Number(r.payout_minor) === 1335000, "6% of $10.01 rounds UP to 61¢, plus a configured 50¢ flat fee; NGN payout = net × rate, floored");
ok((await resolve(r.id, "rejected")).ok, "rejected");
s = await coin(W);
ok(s.b === 50000 && s.h === 0, "rejection returns the whole hold");
ok((await one("select status from ai_product_ledger where reference = $1 and kind = 'withdrawal'", ["coin-withdrawal:" + r.id])).status === "reversed", "the hold row is marked reversed");
ok((await resolve(r.id, "rejected")).reason === "final" && (await coin(W)).b === 50000, "a second rejection returns nothing more");
ok(Number((await one("select count(*) n from platform_fee_ledger where reference = $1", ["coin-withdrawal:" + r.id])).n) === 0, "a rejected withdrawal posts no fee");
await invariants("withdrawal rejected");

// ── withdrawal eligibility and limits ──
ok((await withdraw(W, 50, "w-small", { ...WITHDRAW, flatCents: 100 })).reason === "below_fee", "an amount the fees would swallow is refused");
ok((await withdraw(W, 50, "w-min", { ...WITHDRAW, minCents: 100 })).reason === "amount_out_of_range", "below the minimum is refused");
ok((await withdraw(W, 100, "w-off", { ...WITHDRAW, enabled: false })).reason === "disabled", "withdrawals switched off are refused");
ok((await withdraw(W, 100, "w-qual", { ...WITHDRAW, requireQualification: true })).reason === "not_qualified", "when the admin requires qualification, an unqualified member is refused");
await db.exec(`update auth.users set email_confirmed_at = null where id = '${W}'`);
ok((await withdraw(W, 100, "w-email")).reason === "email_unconfirmed", "an unconfirmed email is refused (the default)");
await db.exec(`update auth.users set email_confirmed_at = now() where id = '${W}'`);
await db.exec(`update profiles set is_suspended = true where id = '${W}'`);
ok((await withdraw(W, 100, "w-susp")).reason === "suspended", "a suspended member cannot withdraw");
await db.exec(`update profiles set is_suspended = false where id = '${W}'`);
r = await withdraw(W, 100, "w-day-1", { ...WITHDRAW, maxPerDay: 3 });
await resolve(r.id, "cancelled");
// completed / reversed earlier today count; the cancelled ones do not
ok((await withdraw(W, 100, "w-day-2", { ...WITHDRAW, maxPerDay: 1 })).reason === "day_limit", "the per-day count is enforced");
ok((await withdraw(W, 100, "w-month", { ...WITHDRAW, maxMonthCents: 10050 })).reason === "month_limit", "the 30-day sum counts what was withdrawn before (100 00 + 100 > 100 50)");
ok(["no_wallet", "insufficient_withdrawable"].includes((await rpc("select request_withdrawal($1, 5, 0, 'paystack', '{}'::jsonb, '{}'::jsonb, 'pending')", [W])).reason), "the AI-credit withdrawal never sees coins (a coin-only member has no credit wallet to withdraw from)");
// a replay key already used by another source is a conflict, never a coin answer
await db.exec(`insert into withdrawal_requests (user_id, credits, amount_usd_cents, status, payout_method, source, idempotency_key) values ('${W}', 1, 0, 'rejected', 'paystack', 'credits', 'shared-key')`);
ok((await withdraw(W, 100, "shared-key")).reason === "idempotency_conflict", "a key used by a credit withdrawal is not answered as a coin one");
await invariants("withdrawal rules");

// ── credits and SUB still behave exactly as before ──
const K = U(7);
await db.query("select credit_product_balance($1, 'character_replace', 500, 'recharge', 'k-dep', 'CREDIT')", [K]);
await db.exec(`insert into reward_profiles (user_id, qualification_status, qualified_at) values ('${K}', 'approved', now())`);
r = await rpc("select request_credit_withdrawal($1, 200, 200, 2000, 'paystack', '{}'::jsonb, '{}'::jsonb, 'pending', 'k-1', 5, 100000)", [K]);
ok(r.ok, "an AI-credit withdrawal still requests");
ok((await resolve(r.id, "rejected")).ok && Number((await one("select withdrawable_cents::int w from ai_product_balances where user_id = $1 and product = 'character_replace'", [K])).w) === 500, "and its rejection returns the credits as before");
await db.exec(`insert into sub_balances (creator_id, available_cents, lifetime_cents) values ('${K}', 5000, 5000)`);
await db.exec(`insert into sub_ledger (creator_id, kind, amount_cents, pending_after, available_after, reference) values ('${K}', 'earning', 5000, 0, 5000, 'seed-k')`);
r = await rpc("select request_sub_withdrawal($1, 1000, 1000, 500, 'paystack', '{}'::jsonb, '{}'::jsonb, 'k-sub-1', false, 20)", [K]);
ok(r.ok, "a SUB withdrawal still requests");
await resolve(r.id, "approved");
ok((await resolve(r.id, "completed")).ok, "and completes through the same resolve_withdrawal");
const sb = await one("select available_cents::int a, held_cents::int h, withdrawn_cents::int w from sub_balances where creator_id = $1", [K]);
ok(sb.a === 3980 && sb.h === 0 && sb.w === 1020, `the SUB balance moved exactly as before (available ${sb.a}, held ${sb.h}, withdrawn ${sb.w})`);
const cwBefore = await one("select balance_cents::int b from ai_product_balances where user_id = $1 and product = 'character_replace'", [K]);
await fund(K, 777, "k-coin");
ok(Number((await one("select balance_cents::int b from ai_product_balances where user_id = $1 and product = 'character_replace'", [K])).b) === cwBefore.b, "coins never change the AI-credit balance");
await invariants("credits and SUB");

// ── corrections and guards ──
r = await rpc("select adjust_coin_balance($1, -100, 'corr-1', 'refund of a mistaken credit', $2, false)", [W, ADMIN]);
ok(r.ok && Number((await one("select count(*) n from financial_audit_log where action = 'coin_adjustment' and reference = 'corr-1'")).n) === 1, "an operator correction is audited");
ok((await rpc("select adjust_coin_balance($1, -99999999, 'corr-2', 'too much', $2, false)", [W, ADMIN])).reason === "insufficient", "a correction can never take more than is available");
ok((await rpc("select adjust_coin_balance($1, 100, 'corr-3', '', $2, false)", [W, ADMIN])).reason === "invalid", "a correction needs a reason");
const cRow = (await one("select id from ai_product_ledger where product = 'frenz_coin' and kind = 'transfer_in' limit 1")).id;
ok(!!(await throws("update ai_product_ledger set delta_cents = 1 where id = $1", [cRow])), "a coin movement cannot be rewritten");
ok(!!(await throws("delete from ai_product_ledger where id = $1", [cRow])), "nor deleted");
ok(!!(await throws("update coin_transfers set amount_cents = 1")), "coin_transfers is append-only");
ok(!!(await throws("delete from platform_fee_ledger")), "fee income is append-only");
await invariants("corrections");

// ── account deletion: coins block the purge ──
await db.exec(`update profiles set deletion_requested_at = now() where id = '${W}'`);
const blk = await rpc("select account_financial_blockers($1)", [W]);
ok(!blk.ok && blk.reasons.includes("coin_balance"), "coins in the wallet block an account purge");
ok((await rpc("select retain_financial_records($1)", [W])).reason === "blocked", "and retain refuses to proceed");

// ── RLS: no member can call or write any of it ──
await db.exec("set role authenticated");
await db.exec(`select set_config('test.uid', '${A}', false)`);
ok(!!(await throws("select transfer_coins($1, $2, 1, 'rls-1', null, $3::jsonb)", [A, wC, JSON.stringify(TRANSFER)])), "a member cannot call transfer_coins");
ok(!!(await throws("select request_coin_withdrawal($1, 1, 'paystack', '{}'::jsonb, 'rls-2', $2::jsonb)", [A, JSON.stringify(WITHDRAW)])), "a member cannot call request_coin_withdrawal");
ok(!!(await throws("select adjust_coin_balance($1, 100, 'rls-3', 'x', $1, false)", [A])), "a member cannot credit themselves");
ok(!!(await throws("select resolve_coin_withdrawal($1, 'completed', null, null, null)", [w1])), "a member cannot resolve a withdrawal");
ok((await q("select id from coin_transfers")).length === 0, "a member reads no coin transfer (RLS, no policy)");
const own = await q("select product from ai_product_balances");
ok(own.every((x) => x.product === "frenz_coin" || x.product === "character_replace") && own.length <= 2, "a member sees only their own wallet rows");
const upd = await db.query("update ai_product_balances set balance_cents = 99999999 where user_id = $1 and product = 'frenz_coin'", [A]).catch(() => ({ affectedRows: 0 }));
ok(!upd.affectedRows, "a member cannot change their coin balance");
await db.exec("reset role");
await invariants("end");

console.log(failures === 0 ? `\nALL PASSED${MUTANT ? ` (mutant ${MUTANT} SURVIVED — the suite has no teeth for it)` : ""}` : `\n${failures} FAILED${MUTANT ? ` (mutant ${MUTANT} caught)` : ""}`);
process.exit(failures === 0 ? (MUTANT ? 3 : 0) : 1);
