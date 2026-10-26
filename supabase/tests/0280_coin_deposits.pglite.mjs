// 0280 (Frenz Coin Part 4) — coin deposits, the 72-hour hold, deposit reversals and the reward triggers, against the
// REAL functions in PGlite. Run from a folder under %TEMP% (where @electric-sql/pglite is installed), next to
// credit_wallet.shared.mjs:
//   node 0280_coin_deposits.pglite.mjs <repo>/supabase/migrations [--mutant=<name>]
//
// Builds the wallet from the migrations (credit_wallet.shared.mjs), applies 0278, 0279 and 0280 twice each, plus the
// REAL reward trigger (0187 reward_on_activity + its original trigger, replaced by 0280's) and the REAL affiliate trigger
// (0255). process_reward_event is replaced by a recorder, so "did the reward trigger fire" is observed directly,
// whatever the reward rules say. Then: opening deposits, settling them (exact amount and currency), the hold (pending
// coins cannot be sent or withdrawn, and nothing releases them early), the release, refunds and disputes at both phases
// with the shortfall path, the coin transfer replay rule, and the invariants + conservation of money after every step.
//
// Time: the hold is 72 hours of the database clock. A test cannot wait, so "72 hours later" is simulated by moving a
// deposit's settled_at and release_at back together with its guard trigger switched off FOR THAT STATEMENT ONLY (a
// superuser in a test database). The guard refusing that same move from an ordinary caller is tested first.
//
// ⚠️ PGlite is ONE connection: interleaving is in coin_deposits_concurrency.pg.mjs.
//
// --mutant=<name> breaks one protection and the run must FAIL:
//   reward-kind       a deposit is booked as 'recharge' and 0187's unfiltered trigger is back -> a coin deposit is rewarded
//   no-amount-check   settle_coin_deposit skips the paid amount / currency check            -> a short payment is credited
//   early-release     release_coin_deposit skips release_at and the guard is dropped         -> coins spendable inside the hold
//   pending-bypass    release_coin_pending no longer refuses a deposit row                    -> the hold skipped by reference
//   no-reversal-cap   reverse_coin_deposit forgets earlier reversals of the deposit           -> a deposit taken back twice
import { readFileSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";

import { coinMigration, depositMigration, depositPrerequisites, migration, scopeMigration, SCOPED, split, STUB, U, walletStatements } from "./credit_wallet.shared.mjs";

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
const read = (f) => readFileSync(`${dir}/${f}`, "utf8");
const stmt = (file, startsWith) => { const s = split(read(file)).find((x) => x.trim().startsWith(startsWith)); if (!s) throw new Error(`${file}: no statement ${startsWith}`); return s; };

await run(split(STUB));
await run(walletStatements(dir));
// 0271's Flutterwave attempt provider and 0187's reward_on_activity (credit_wallet.shared.mjs depositPrerequisites)
await run(depositPrerequisites(dir));
// the reward and affiliate triggers, VERBATIM: 0187's original trigger, 0255's affiliate queue
await run([
  "create table public.share_links (token text primary key)",
  stmt("0187_rewards_referrals.sql", "create table if not exists public.referral_attributions"),
  stmt("0255_rewards_v2.sql", "create table if not exists public.affiliate_accounts"),
  stmt("0255_rewards_v2.sql", "create table if not exists public.affiliate_commissions"),
  stmt("0255_rewards_v2.sql", "create or replace function public.queue_affiliate_commission("),
]);
const original187 = /execute '(create trigger reward_on_topup_trg[^\n]*)';/.exec(read("0187_rewards_referrals.sql"))[1].replace(/''/g, "'");
const affiliate255 = /\n\s*(create trigger ai_topup_attempts_affiliate_trg[^\n]*);/.exec(read("0255_rewards_v2.sql"))[1];
await run([original187, affiliate255]);
// the recorder: every call the reward trigger makes, whatever the reward rules would decide
await run([
  "create table public.test_reward_calls (event text, actor uuid, source_type text, source_id text)",
  "create or replace function public.process_reward_event(p_event text, p_actor uuid, p_source_type text, p_source_id text, p_metadata jsonb default '{}'::jsonb) returns jsonb language plpgsql as $$ begin insert into public.test_reward_calls values (p_event, p_actor, p_source_type, p_source_id); return '[]'::jsonb; end $$",
]);
await run(migration(dir));
await run(migration(dir));
await run(coinMigration(dir));
await run(coinMigration(dir));
await run(depositMigration(dir));
await run(depositMigration(dir));
// Part 4.1 regression: APPLY_0281=1 runs this WHOLE Part 4 suite with 0281 (product-scoped restrictions) on top
if (SCOPED) {
  await run(scopeMigration(dir));
  await run(scopeMigration(dir));
}
await db.exec(`insert into auth.users (id, email, email_confirmed_at) select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'u' || g || '@t.test', now() from generate_series(1, 60) g`);
await db.exec(`insert into public.profiles (id) select id from auth.users`);

const DEP = { enabled: true, version: 3, holdHours: 72, minCents: 100, maxCents: 500000 };
const TRANSFER = { enabled: true, version: 3, percentBp: 1000, lowThresholdCents: 10000, highThresholdCents: 50000, flatBelowCents: 100, flatMidCents: 0, flatAboveCents: 500, minCents: 1, maxCents: 500000, dailyMaxCents: 10000000 };
const WITHDRAW = { enabled: true, version: 3, percentBp: 600, flatCents: 0, minCents: 1, maxCents: 500000, maxPerDay: 50, maxMonthCents: 100000000, requireQualification: false, requireEmailConfirmed: true, payoutCurrency: "NGN", payoutMinorPerUsd: null };
const ADMIN = U(59);

// ── mutants ──
const fnBody = async (name) => (await one("select pg_get_functiondef(p.oid) d from pg_proc p where p.proname = $1", [name])).d;
const mutate = async (name, from, to) => { const b = await fnBody(name); const m = b.split(from).join(to); if (m === b) throw new Error(`mutant on ${name} did not apply`); await db.exec(m); };
if (MUTANT === "reward-kind") {
  await mutate("settle_coin_deposit", "'frenz_coin', 'deposit', 'reserved'", "'frenz_coin', 'recharge', 'reserved'");
  await db.exec("drop trigger reward_on_topup_trg on public.ai_product_ledger");
  await db.exec(original187);
}
if (MUTANT === "no-amount-check") await mutate("settle_coin_deposit", "if p_paid_minor <> v_a.provider_amount or upper(p_paid_currency) <> upper(v_a.provider_currency) then", "if false then");
if (MUTANT === "early-release") {
  await mutate("release_coin_deposit", "if v_d.release_at > now() then", "if false then");
  await db.exec("drop trigger coin_deposits_guard on public.coin_deposits");
}
if (MUTANT === "pending-bypass") await mutate("release_coin_pending", "if v_row.kind = 'deposit' then", "if false then");
if (MUTANT === "no-reversal-cap") await mutate("reverse_coin_deposit", "v_due := greatest(0, v_d.amount_cents - v_already);", "v_due := v_d.amount_cents;");

// ── helpers ──
const coin = async (u) => (await one("select balance_cents::int b, pending_cents::int p, held_cents::int h from ai_product_balances where user_id = $1 and product = 'frenz_coin'", [u])) ?? { b: 0, p: 0, h: 0 };
const wallet = (u) => rpc("select ensure_wallet_number($1)", [u]);
let seq = 0;
const ref = () => `frenz_coin_dep_fw_00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
const begin = (u, reference, cents, key, rules = DEP, minor = cents, cur = "USD") =>
  rpc("select begin_coin_deposit($1, $2, $3, 'flutterwave', $4, $5, $6, $7::jsonb)", [u, reference, cents, minor, cur, key, JSON.stringify(rules)]);
const settle = (reference, minor, cur = "USD", charge = "ch-" + reference.slice(-6)) => rpc("select settle_coin_deposit($1, $2, $3, $4)", [reference, charge, minor, cur]);
const release = (reference) => rpc("select release_coin_deposit($1)", [reference]);
const releaseDue = (u = null) => rpc("select release_due_coin_deposits($1, 100)", [u]);
const reverse = (event, kind, reference, refunded = null, paid = null) => rpc("select reverse_coin_deposit('flutterwave', $1, $2, $3, $4, $5, 'USD', $6, 'test')", [event, kind, reference, refunded, paid, ADMIN]);
const send = (from, to, cents, key, rules = TRANSFER) => rpc("select transfer_coins($1, $2, $3, $4, null, $5::jsonb)", [from, to, cents, key, JSON.stringify(rules)]);
const withdraw = (u, cents, key) => rpc("select request_coin_withdrawal($1, $2, 'paystack', '{\"bankCode\": \"058\", \"accountNumber\": \"0123456789\"}'::jsonb, $3, $4::jsonb)", [u, cents, key, JSON.stringify(WITHDRAW)]);
/** "72 hours later" for one deposit: settled_at and release_at move back together (the guard is off for this statement only). */
const guarded = MUTANT !== "early-release";
const age = async (reference, hours = 72) => {
  if (guarded) await db.exec("alter table public.coin_deposits disable trigger coin_deposits_guard");
  await db.query(`update public.coin_deposits set settled_at = settled_at - make_interval(hours => $2::int, secs => 1), release_at = release_at - make_interval(hours => $2::int, secs => 1) where reference = $1`, [reference, hours]);
  if (guarded) await db.exec("alter table public.coin_deposits enable trigger coin_deposits_guard");
};
/** One settled deposit for `u`, still on hold. */
const deposit = async (u, cents) => { const r = ref(); await begin(u, r, cents, "key-" + r.slice(-12)); await settle(r, cents); return r; };
const rewardCalls = async () => (await q("select event, source_id from test_reward_calls")).map((r) => `${r.event}:${r.source_id}`);

/** Every coin wallet reconciles to its ledger; deposits match their rows; money is conserved. */
const invariants = async (label) => {
  const bad = await q(`select b.user_id, b.balance_cents, b.pending_cents, b.held_cents, l.s, l.pend, l.held from ai_product_balances b
    left join (select user_id, sum(delta_cents) s, coalesce(sum(delta_cents) filter (where status = 'reserved' and delta_cents > 0), 0) pend,
                      coalesce(-sum(delta_cents) filter (where status = 'reserved' and delta_cents < 0), 0) held
                 from ai_product_ledger where product = 'frenz_coin' group by user_id) l on l.user_id = b.user_id
    where b.product = 'frenz_coin' and (b.balance_cents <> coalesce(l.s, 0) or b.pending_cents <> coalesce(l.pend, 0) or b.held_cents <> coalesce(l.held, 0)
      or b.pending_cents > b.balance_cents or b.balance_cents < 0 or b.held_cents < 0)`);
  ok(bad.length === 0, `${label}: balance = Σ ledger, pending = Σ reserved credits, held = Σ reserved debits, available ≥ 0${bad.length ? " " + JSON.stringify(bad) : ""}`);
  const pend = await q(`select d.reference from coin_deposits d join ai_product_ledger l on l.id = d.ledger_id
    where (d.status in ('held', 'disputed')) <> (l.status = 'reserved') or l.delta_cents <> d.amount_cents or l.kind <> 'deposit'`);
  ok(pend.length === 0, `${label}: a deposit is pending exactly while it is held or disputed${pend.length ? " " + JSON.stringify(pend) : ""}`);
  const c = await one(`select
      (select coalesce(sum(delta_cents), 0) from ai_product_ledger where product = 'frenz_coin' and (kind in ('adjustment', 'deposit', 'refund') or (kind = 'reversal' and status <> 'reserved')))::bigint funded,
      (select coalesce(sum(balance_cents + held_cents), 0) from ai_product_balances where product = 'frenz_coin')::bigint wallets,
      (select coalesce(sum(net_cents), 0) from withdrawal_requests where source = 'coin' and status = 'completed')::bigint paid_out,
      (select coalesce(sum(case when source = 'coin_withdrawal_fee_reversal' then -amount else amount end), 0) from platform_fee_ledger where source like 'coin_%')::bigint fees,
      (select coalesce(sum(amount_cents), 0) from coin_deposits)::bigint deposited,
      (select coalesce(sum(delta_cents), 0) from ai_product_ledger where product = 'frenz_coin' and kind = 'deposit')::bigint deposit_rows`);
  const n = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Number(v)]));
  ok(n.funded === n.wallets + n.paid_out + n.fees, `${label}: conservation — funded ${n.funded} = in wallets/held ${n.wallets} + paid out ${n.paid_out} + fee income ${n.fees}`);
  ok(n.deposited === n.deposit_rows, `${label}: Σ settled deposits ${n.deposited} = Σ deposit ledger rows ${n.deposit_rows}`);
};

const A = U(1), B = U(2), C = U(3), D = U(4), E = U(5), R = U(6), S = U(7), T = U(8);
const [wA, wB, wC, wD] = [await wallet(A), await wallet(B), await wallet(C), await wallet(D)];
await wallet(E); await wallet(S); await wallet(T);

// ── permissions and schema ──
for (const f of ["begin_coin_deposit(uuid, text, bigint, text, bigint, text, text, jsonb)", "settle_coin_deposit(text, text, bigint, text)", "release_coin_deposit(text)", "release_due_coin_deposits(uuid, integer)", "reverse_coin_deposit(text, text, text, text, bigint, bigint, text, uuid, text)", "resolve_coin_deposit_dispute(uuid, text, uuid, text)", "clear_coin_deposit_shortfall(uuid, uuid, text)"]) {
  const r = await one(`select has_function_privilege('authenticated', 'public.${f}', 'execute') a, has_function_privilege('anon', 'public.${f}', 'execute') b, has_function_privilege('service_role', 'public.${f}', 'execute') s`);
  ok(!r.a && !r.b && r.s, `${f.split("(")[0]}: service role only`);
}
for (const f of ["coin_take_back_held_deposit(text, text, text)", "lift_coin_shortfall_restriction(uuid)"]) {
  const r = await one(`select has_function_privilege('authenticated', 'public.${f}', 'execute') a, has_function_privilege('service_role', 'public.${f}', 'execute') s`);
  ok(!r.a && !r.s, `${f.split("(")[0]}: internal — nobody may call it directly`);
}
for (const t of ["coin_deposits", "coin_deposit_reversals"]) {
  const r = await one(`select has_table_privilege('authenticated', 'public.${t}', 'select') a, has_table_privilege('anon', 'public.${t}', 'insert') b, (select relrowsecurity from pg_class where relname = '${t}') rls`);
  ok(!r.a && !r.b && r.rls, `${t}: no client access, RLS on`);
}
ok(!!(await throws("insert into ai_product_ledger (user_id, product, kind, status, delta_cents, currency, reference) values ($1, 'character_replace', 'deposit', 'settled', 100, 'CREDIT', 'x')", [A])), "the kind 'deposit' is Frenz Coin only");
await invariants("start");

// ── opening a deposit ──
const r1 = ref();
ok((await begin(A, r1, 5000, "bad key"))?.reason === "invalid", "an invalid idempotency key is refused");
for (const [why, rules] of [["hold 0", { ...DEP, holdHours: 0 }], ["hold 71", { ...DEP, holdHours: 71 }], ["hold 2161", { ...DEP, holdHours: 2161 }], ["fractional hold", { ...DEP, holdHours: 72.5 }], ["no rules", null], ["min > max", { ...DEP, minCents: 600, maxCents: 500 }]]) {
  ok((await begin(A, r1, 5000, "key-rules-1", rules))?.reason === "rules_invalid", `rules refused before anything is written: ${why}`);
}
ok((await begin(A, r1, 5000, "key-off-01", { ...DEP, enabled: false }))?.reason === "disabled", "deposits switched off: refused (the server's switch reaches the database)");
ok((await begin(A, r1, 99, "key-min-01"))?.reason === "amount_out_of_range", "below the minimum: refused");
ok((await begin(A, r1, 500001, "key-max-01"))?.reason === "amount_out_of_range", "above the maximum: refused");
await db.query("update profiles set is_suspended = true where id = $1", [E]);
ok((await begin(E, ref(), 5000, "key-susp-1"))?.reason === "suspended", "a suspended member cannot deposit");
await db.query("update profiles set is_suspended = false where id = $1", [E]);
ok((await one("select count(*)::int n from ai_topup_attempts where purpose = 'coin_deposit'")).n === 0, "no refused request left an attempt row");

let r = await begin(A, r1, 5000, "key-a-0001");
ok(r?.ok === true && r.hold_hours === 72, "a valid deposit opens, with the 72-hour hold");
const att = await one("select user_id, provider, purpose, status, amount_cents::int a, currency, provider_amount::int pa, provider_currency, metadata from ai_topup_attempts where reference = $1", [r1]);
ok(att.user_id === A && att.provider === "flutterwave" && att.purpose === "coin_deposit" && att.status === "pending" && att.a === 5000 && att.currency === "USD" && att.pa === 5000 && att.provider_currency === "USD", "the attempt row binds member, amount, currency, provider and reference BEFORE any checkout");
ok(att.metadata.idempotency_key === "key-a-0001" && att.metadata.coin.holdHours === 72 && att.metadata.coin.rules.version === 3, "the attempt stores the hold and the rules it was opened under");
r = await begin(A, ref(), 5000, "key-a-0001");
ok(r?.reason === "existing" && r.reference === r1, "the same key again answers the attempt already made (no second attempt)");
ok((await begin(A, ref(), 7000, "key-a-0001"))?.reason === "idempotency_conflict", "the same key for another amount is refused");
r = await begin(A, ref(), 2000, "key-a-0002");
ok(r?.reason === "open" && r.reference === r1, "one open deposit at a time: a second request is handed the open one");
ok((await one("select count(*)::int n from ai_topup_attempts where purpose = 'coin_deposit' and user_id = $1", [A])).n === 1, "still exactly one attempt");

// ── settling: the exact amount and currency ──
ok((await settle("frenz_coin_dep_fw_nothing", 5000))?.reason === "not_found", "an unknown reference settles nothing");
const before = await coin(A);
r = await settle(r1, 4999);
ok(r?.reason === "mismatch" && (await one("select status from ai_topup_attempts where reference = $1", [r1])).status === "mismatch", "an underpayment is a mismatch, held for a person");
ok(JSON.stringify(await coin(A)) === JSON.stringify(before) && !(await one("select 1 x from coin_deposits where reference = $1", [r1])), "a mismatch credits nothing");
ok((await settle(r1, 5000))?.reason === "not_settleable", "a mismatched attempt is never settled later by code");
const r2 = ref();
await begin(A, r2, 5000, "key-a-0003");
ok((await settle(r2, 5000, "NGN"))?.reason === "mismatch", "the right amount in another currency is a mismatch");
ok((await settle(ref(), 6000))?.reason === "not_found", "a reference with no attempt is not settled");
const r3 = ref();
await begin(A, r3, 5000, "key-a-0004");
ok((await settle(r3, 5001))?.reason === "mismatch", "an overpayment is a mismatch too (no extra value is ever granted)");
const r4 = ref();
r = await begin(A, r4, 5000, "key-a-0005");
r = await settle(r4, 5000);
ok(r?.ok === true && r.amount === 5000 && r.hold_hours === 72, "the exact payment settles");
let w = await coin(A);
ok(w.b === 5000 && w.p === 5000 && w.b - w.p === 0, "credited as PENDING: balance 5000, pending 5000, available 0");
const d4 = await one("select status, hold_hours, extract(epoch from release_at - settled_at)::int secs, settled_at <= now() s from coin_deposits where reference = $1", [r4]);
ok(d4.status === "held" && d4.hold_hours === 72 && d4.secs === 72 * 3600 && d4.s, "settled_at is the database clock and release_at is exactly 72 hours later");
const led = await one("select kind, status, delta_cents::int d, currency, reference from ai_product_ledger where product = 'frenz_coin' and user_id = $1", [A]);
ok(led.kind === "deposit" && led.status === "reserved" && led.d === 5000 && led.currency === "USD" && led.reference === "coin-deposit:" + r4, "one ledger row: kind deposit, reserved, +5000 USD cents");
ok((await one("select status from ai_topup_attempts where reference = $1", [r4])).status === "success", "the attempt is marked success");
r = await settle(r4, 5000);
ok(r?.ok === true && r.duplicate === true && (await coin(A)).b === 5000, "settling again (webhook + return page + sweep) credits nothing more");
ok((await one("select count(*)::int n from ai_product_balances where user_id = $1 and product = 'character_replace'", [A])).n === 0, "a coin deposit never touches an AI-credit wallet");
await invariants("after settling");

// ── a late success, a longer configured hold ──
const r5 = ref();
await begin(B, r5, 3000, "key-b-0001");
await db.query("update ai_topup_attempts set status = 'abandoned' where reference = $1", [r5]);
r = await settle(r5, 3000);
ok(r?.ok === true && (await coin(B)).p === 3000, "money that arrives after the checkout was given up is still credited (verified by the provider), pending");
const r6 = ref();
await begin(B, r6, 2000, "key-b-0002", { ...DEP, holdHours: 96 });
await settle(r6, 2000);
ok((await one("select extract(epoch from release_at - settled_at)::int s from coin_deposits where reference = $1", [r6])).s === 96 * 3600, "the hold is the one the deposit was opened with (96 hours here), never shortened by later rules");

// ── rewards: a coin deposit is never an AI-credit top-up ──
await db.query("insert into referral_attributions (referred_user_id, referrer_id) values ($1, $2), ($3, $2)", [A, R, S]);
await db.query("insert into affiliate_accounts (user_id, status, rate_bp) values ($1, 'approved', 1000)", [R]);
const r7 = ref();
await begin(A, r7, 4000, "key-a-0006");
// a coin attempt is open for A, so the second deposit goes through after the first settled; settle it
await settle(r7, 4000);
let calls = await rewardCalls();
ok(!calls.some((c) => c.includes("coin-deposit")) && calls.length === 0, `a coin deposit fires no reward event (calls: ${JSON.stringify(calls)})`);
ok((await one("select count(*)::int n from affiliate_commissions where purpose = 'coin_deposit' or reference like 'frenz_coin_dep_fw_%'")).n === 0, "a coin deposit queues no affiliate commission");
// the AI-credit top-up, as before
await db.query("select credit_product_balance($1, 'character_replace', 500, 'recharge', 'frenz_cr_topup_test-1', 'CREDIT')", [S]);
calls = await rewardCalls();
ok(calls.length === 1 && calls[0] === "wallet_topup:frenz_cr_topup_test-1", "an AI-credit recharge still fires the wallet_topup reward event");
await db.query("insert into ai_topup_attempts (reference, user_id, provider, purpose, status, amount_cents, currency) values ('frenz_cr_topup_aff-1', $1, 'flutterwave', 'wallet_topup', 'pending', 1000, 'USD')", [S]);
await db.query("update ai_topup_attempts set status = 'success' where reference = 'frenz_cr_topup_aff-1'");
ok((await one("select count(*)::int n from affiliate_commissions where reference = 'frenz_cr_topup_aff-1' and affiliate_id = $1", [R])).n === 1, "an AI-credit top-up still queues its affiliate commission");
await invariants("after the reward checks");

// ── the hold: pending coins cannot move ──
const r8 = await deposit(C, 10000);
w = await coin(C);
ok(w.b === 10000 && w.p === 10000, "C has 10000 on hold and nothing available");
r = await send(C, wD, 100, "send-c-hold-1");
ok(r?.reason === "insufficient" && Number(r.available) === 0, "pending coins cannot be transferred");
r = await withdraw(C, 500, "wd-c-hold-1");
ok(r?.ok !== true, `pending coins cannot be withdrawn (${r?.reason})`);
ok((await release(r8))?.reason === "on_hold", "release before the hold expires: refused");
ok(Number((await releaseDue(C))?.released) === 0, "the due-release pass skips a deposit still on hold");
r = await rpc("select release_coin_pending($1, $2, $3)", [C, "coin-deposit:" + r8, ADMIN]);
ok(r?.reason === "deposit_hold" && (await coin(C)).p === 10000, "release_coin_pending cannot skip a deposit's hold by reference");
ok(!!(await throws("update coin_deposits set release_at = now() where reference = $1", [r8])), "the release time cannot be rewritten");
ok(!!(await throws("update coin_deposits set status = 'released', released_at = now() where reference = $1", [r8])), "a deposit cannot be marked released before its time");
ok(!!(await throws("update ai_product_balances set pending_cents = 0 where user_id = $1 and product = 'frenz_coin'", [C])), "pending cannot be zeroed outside the coin functions");
ok(!!(await throws("delete from coin_deposits where reference = $1", [r8])), "a deposit row is permanent");
ok((await coin(C)).p === 10000, "the hold is intact");
await invariants("during the hold");

// ── the release ──
await age(r8);
r = await release(r8);
ok(r?.ok === true && r.released === 10000, "after 72 hours the deposit is released");
w = await coin(C);
ok(w.b === 10000 && w.p === 0, "available 10000, pending 0");
ok((await one("select status from ai_product_ledger where reference = $1", ["coin-deposit:" + r8])).status === "settled" && (await one("select status from coin_deposits where reference = $1", [r8])).status === "released", "its ledger row settled, its deposit released");
r = await release(r8);
ok(r?.duplicate === true && (await coin(C)).p === 0 && (await coin(C)).b === 10000, "releasing twice changes nothing");
r = await send(C, wD, 5000, "send-c-free-1");
ok(r?.ok === true && r.total === 5600 && (await coin(D)).b === 5000, "released coins move: $50 costs the sender $56, the recipient gets $50");
await age(r4); await age(r5);
r = await releaseDue();
ok(Number(r?.released) === 2 && Number(r?.cents) === 8000, "the due-release pass releases every due deposit, once");
ok(Number((await releaseDue())?.released) === 0, "a second pass releases nothing");
ok((await coin(B)).p === 2000, "B's 96-hour deposit is still on hold");
await invariants("after the releases");

// ── reversals while ON HOLD ──
const h1 = await deposit(E, 4000);
r = await reverse("evt-h1", "refund", h1);
ok(r?.ok === true && r.phase === "held" && r.state === "recovered" && r.recovered === 4000 && r.shortfall === 0, "a refund during the hold takes the deposit back whole, no shortfall");
w = await coin(E);
ok(w.b === 0 && w.p === 0, "E: balance and pending both back to 0");
ok((await one("select status from coin_deposits where reference = $1", [h1])).status === "reversed", "the deposit is reversed");
ok((await one("select status from ai_product_ledger where reference = $1", ["coin-deposit:" + h1])).status === "refunded", "its pending row is refunded (kept, not deleted)");
r = await reverse("evt-h1", "refund", h1);
ok(r?.duplicate === true && (await coin(E)).b === 0, "the same event again changes nothing");
r = await reverse("evt-h1-admin", "refund", h1);
ok(r?.ok === true && r.due === 0 && (await coin(E)).b === 0, "another event for the same deposit (admin + webhook) takes nothing more");
await age(h1);
ok((await release(h1))?.duplicate === true && (await coin(E)).b === 0, "a reversed deposit is never released");
await invariants("after a held refund");

const h2 = await deposit(E, 3000);
r = await reverse("evt-h2", "dispute", h2);
ok(r?.state === "disputed" && (await one("select status from coin_deposits where reference = $1", [h2])).status === "disputed", "a dispute during the hold freezes the deposit");
await age(h2);
ok(Number((await releaseDue(E))?.released) === 0 && (await coin(E)).p === 3000, "a disputed deposit is not released, even after its time");
const disp2 = (await one("select id from coin_deposit_reversals where event_key = 'evt-h2'")).id;
r = await rpc("select resolve_coin_deposit_dispute($1, 'won', $2, 'upheld')", [disp2, ADMIN]);
ok(r?.state === "restored" && (await one("select status from coin_deposits where reference = $1", [h2])).status === "held", "won: the hold resumes");
ok(Number((await releaseDue(E))?.released) === 1 && (await coin(E)).p === 0 && (await coin(E)).b === 3000, "and the deposit is released by the next pass (its time has passed)");
ok((await rpc("select resolve_coin_deposit_dispute($1, 'lost', $2, 'again')", [disp2, ADMIN]))?.duplicate === true, "an outcome is recorded once");
const h3 = await deposit(T, 2500);
await reverse("evt-h3", "dispute", h3);
const disp3 = (await one("select id from coin_deposit_reversals where event_key = 'evt-h3'")).id;
r = await rpc("select resolve_coin_deposit_dispute($1, 'lost', $2, 'lost at the bank')", [disp3, ADMIN]);
w = await coin(T);
ok(r?.state === "lost" && w.b === 0 && w.p === 0 && (await one("select status from coin_deposits where reference = $1", [h3])).status === "reversed", "lost during the hold: the deposit is taken back whole");
await invariants("after held disputes");

// ── reversals after RELEASE ──
// D: 5000 received from C, plus a 6000 deposit, released
const g1 = await deposit(D, 6000);
await age(g1); await release(g1);
r = await reverse("evt-g1", "refund", g1);
ok(r?.phase === "released" && r.recovered === 6000 && r.shortfall === 0 && (await coin(D)).b === 5000, "a refund after release, with the coins still there: taken back in full");
// S: a 20000 deposit, released, then 15000 + fee sent on to T
const g2 = await deposit(S, 20000);
await age(g2); await release(g2);
r = await send(S, (await wallet(T)), 15000, "send-s-1");
ok(r?.ok === true && r.total === 16500, "S sends $150 (fee $15)");
const tBefore = (await coin(T)).b;
r = await reverse("evt-g2", "refund", g2);
ok(r?.recovered === 3500 && r.shortfall === 16500, "a refund after the coins were spent: what is there is taken back, the rest is a shortfall");
ok((await coin(S)).b === 0 && (await coin(T)).b === tBefore, "S's wallet reaches 0, never below — and the recipient is NOT clawed back");
const prof = await one("select restricted, restricted_reason from reward_profiles where user_id = $1", [S]);
if (SCOPED) {
  ok(!prof?.restricted && (await rpc("select coin_wallet_block_reason($1)", [S])) === "recovery_due", "0281: coins are paused (recovery_due) without an account restriction");
  ok((await rpc("select credit_wallet_block_reason($1)", [S])) === null, "0281: AI credits are NOT paused by a coin shortfall");
} else {
  ok(prof?.restricted === true && prof.restricted_reason === "coin_deposit_shortfall", "the account is restricted");
  ok((await rpc("select credit_wallet_block_reason($1)", [S])) !== null, "S may not move money (credits or coins)");
}
const block = await rpc("select account_financial_blockers($1)", [S]);
ok(block.reasons.includes("coin_recovery_due"), "an open coin shortfall blocks an account purge");
const short2 = (await one("select id from coin_deposit_reversals where event_key = 'evt-g2'")).id;
ok((await rpc("select clear_coin_deposit_shortfall($1, $2, '')", [short2, ADMIN]))?.reason === "invalid", "clearing a shortfall needs a reason");
r = await rpc("select clear_coin_deposit_shortfall($1, $2, 'recovered by bank transfer')", [short2, ADMIN]);
ok(r?.ok === true && r.lifted === !SCOPED && (await rpc(SCOPED ? "select coin_wallet_block_reason($1)" : "select credit_wallet_block_reason($1)", [S])) === null, "an admin clears it: coins may move again");
ok((await rpc("select clear_coin_deposit_shortfall($1, $2, 'again')", [short2, ADMIN]))?.duplicate === true, "cleared once");
ok(!!(await throws("update coin_deposit_reversals set recovered_cents = 0 where id = $1", [short2])), "a recorded reversal cannot be rewritten");
await invariants("after released refunds");

// a dispute after release holds what it can; won gives it back, lost keeps it
const g3 = await deposit(A, 8000);
await age(g3); await release(g3);
const aBefore = await coin(A);
r = await reverse("evt-g3", "dispute", g3);
w = await coin(A);
ok(r?.state === "disputed" && r.recovered === 8000 && w.b === aBefore.b - 8000 && w.h === aBefore.h + 8000, "a dispute after release moves the coins from available to held");
const disp4 = (await one("select id from coin_deposit_reversals where event_key = 'evt-g3'")).id;
r = await rpc("select resolve_coin_deposit_dispute($1, 'won', $2, 'won')", [disp4, ADMIN]);
w = await coin(A);
ok(r?.state === "restored" && w.b === aBefore.b && w.h === aBefore.h, "won: the coins are back, nothing held");
const g4 = await deposit(A, 3000);
await age(g4); await release(g4);
const a2 = await coin(A);
await reverse("evt-g4", "dispute", g4);
const disp5 = (await one("select id from coin_deposit_reversals where event_key = 'evt-g4'")).id;
await rpc("select resolve_coin_deposit_dispute($1, 'lost', $2, 'lost')", [disp5, ADMIN]);
w = await coin(A);
ok(w.b === a2.b - 3000 && w.h === a2.h, "lost: the held coins leave for good");
await invariants("after released disputes");

// partial refunds and strangers go to a person
const g5 = await deposit(D, 4000);
const dBefore = await coin(D);
r = await reverse("evt-g5", "refund", g5, 1000, 4000);
ok(r?.state === "review" && r.due === 0 && JSON.stringify(await coin(D)) === JSON.stringify(dBefore), "a partial refund is recorded for review and changes nothing");
ok((await reverse("evt-x", "refund", "frenz_coin_dep_fw_unknown"))?.reason === "not_credited" && (await one("select count(*)::int n from financial_audit_log where action = 'coin_deposit_reversal_unmatched'")).n === 1, "a refund for no settled deposit is logged for review");
ok((await reverse("evt-y", "refund", g5)).ok === true && (await coin(D)).p === 0, "a full refund of a deposit still on hold");
r = await reverse("evt-z", "refund", g5);
ok(r?.due === 0 && (await coin(D)).b === dBefore.b - 4000, "and a second full refund of it takes nothing more");
await invariants("after reviews");

// ── coin transfers: a replayed key must name the same transfer ──
const z1 = await deposit(B, 50000);
await age(z1); await release(z1);
r = await send(B, wA, 10000, "send-b-replay");
ok(r?.ok === true && r.fee === 1000 && r.total === 11000, "exactly $100: 10% + $0 (sender pays $110)");
ok((await send(B, wA, 10000, "send-b-replay"))?.duplicate === true, "the same request again is the same transfer");
ok((await send(B, wA, 20000, "send-b-replay"))?.reason === "idempotency_conflict", "the same key for another amount is refused");
ok((await send(B, wC, 10000, "send-b-replay"))?.reason === "idempotency_conflict", "the same key for another recipient is refused");
ok((await send(B, wA, 50000 - 11000 - 1, "send-b-big"))?.reason === "insufficient", "never more than is available");
for (const [amt, total] of [[5000, 5600], [25000, 27500], [50000, 55000], [9999, 9999 + 1000 + 100], [50001, 50001 + 5001 + 500]]) {
  const fee = await rpc("select coin_transfer_fee($1, $2::jsonb)", [amt, JSON.stringify(TRANSFER)]);
  ok(Number(fee.total) === total, `fee schedule: $${(amt / 100).toFixed(2)} → sender pays $${(total / 100).toFixed(2)}`);
}
await invariants("end");

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
