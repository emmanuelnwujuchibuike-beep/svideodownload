// 0281 (Frenz Coin Part 4.1) — restrictions scoped to their product, against the REAL functions in PGlite.
//   node 0281_restriction_scope.pglite.mjs <repo>/supabase/migrations [--mutant=<name>]
//
// Builds the wallet (credit_wallet.shared.mjs), applies 0278, 0279 and 0280, and FIRST creates the state 0280 left behind:
// an AI-credit shortfall and a coin shortfall that wrote the account flag (reward_profiles.restricted), beside an
// administrator's own restriction. Then 0281 (twice): the automatic ones must move off the account (audited, once), the
// administrator's must stay. Then, on fresh members, every money path is driven:
//   a coin shortfall pauses coin transfers and withdrawals — and NOT AI-credit transfers, AI-credit withdrawals or SUB
//   withdrawals; an AI-credit shortfall pauses AI credits — and NOT coins or SUB; an administrator's account-wide
//   restriction and a suspension pause ALL of them; clearing one product's shortfall clears nothing else.
//
// --mutant=<name> breaks one protection and the run must FAIL:
//   shared-block            transfer_coins asks the AI-credit block reason again   -> an AI-credit shortfall freezes coins
//   restrict-account        reverse_coin_deposit writes the account flag again      -> a coin shortfall freezes credits and SUB
//   coin-ignores-shortfall  coin_wallet_block_reason forgets the coin shortfall      -> coins move with a shortfall open
//   clear-all               lifting a coin shortfall clears ANY restriction          -> an admin's restriction is lost
import { PGlite } from "@electric-sql/pglite";

import { coinMigration, depositMigration, depositPrerequisites, migration, scopeMigration, split, STUB, U, walletStatements } from "./credit_wallet.shared.mjs";

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
await run(depositPrerequisites(dir));
for (const m of [migration, coinMigration, depositMigration]) { await run(m(dir)); await run(m(dir)); }
await db.exec(`insert into auth.users (id, email, email_confirmed_at) select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'u' || g || '@t.test', now() from generate_series(1, 60) g`);
await db.exec(`insert into public.profiles (id) select id from auth.users`);

const DEP = { enabled: true, version: 1, holdHours: 72, minCents: 100, maxCents: 500000 };
const TRANSFER = { enabled: true, version: 1, percentBp: 1000, lowThresholdCents: 10000, highThresholdCents: 50000, flatBelowCents: 100, flatMidCents: 0, flatAboveCents: 500, minCents: 1, maxCents: 500000, dailyMaxCents: 10000000 };
const WITHDRAW = { enabled: true, version: 1, percentBp: 600, flatCents: 0, minCents: 1, maxCents: 500000, maxPerDay: 50, maxMonthCents: 100000000, requireQualification: false, requireEmailConfirmed: true, payoutCurrency: "NGN", payoutMinorPerUsd: null };
const ADMIN = U(59);

// ── helpers (the real functions) ──
const wallet = (u) => rpc("select ensure_wallet_number($1)", [u]);
let seq = 0;
const coinDeposit = async (u, cents) => {
  const r = `frenz_coin_dep_fw_00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
  await rpc("select begin_coin_deposit($1, $2, $3, 'flutterwave', $3, 'USD', $4, $5::jsonb)", [u, r, cents, "key-" + r.slice(-12), JSON.stringify(DEP)]);
  await rpc("select settle_coin_deposit($1, 'ch', $2, 'USD')", [r, cents]);
  // "72 hours later" (the guard is off for this one statement — see 0280_coin_deposits.pglite.mjs)
  await db.exec("alter table public.coin_deposits disable trigger coin_deposits_guard");
  await db.query("update public.coin_deposits set settled_at = settled_at - interval '72 hours 1 second', release_at = release_at - interval '72 hours 1 second' where reference = $1", [r]);
  await db.exec("alter table public.coin_deposits enable trigger coin_deposits_guard");
  await rpc("select release_coin_deposit($1)", [r]);
  return r;
};
const coinRefund = (event, ref) => rpc("select reverse_coin_deposit('flutterwave', $1, 'refund', $2, null, null, 'USD', $3, 'test')", [event, ref, ADMIN]);
const coinDispute = (event, ref) => rpc("select reverse_coin_deposit('flutterwave', $1, 'dispute', $2, null, null, 'USD', $3, 'test')", [event, ref, ADMIN]);
const creditTopup = (u, credits, ref) => db.query("select credit_product_balance($1, 'character_replace', $2, 'recharge', $3, 'CREDIT')", [u, credits, ref]);
const creditRefund = (event, ref) => rpc("select reverse_wallet_topup('paystack', $1, 'refund', $2, null, 1000, 'NGN', null, null)", [event, ref]);
const sendCoins = (from, to, cents, key) => rpc("select transfer_coins($1, $2, $3, $4, null, $5::jsonb)", [from, to, cents, key, JSON.stringify(TRANSFER)]);
const withdrawCoins = (u, cents, key) => rpc("select request_coin_withdrawal($1, $2, 'paystack', '{}'::jsonb, $3, $4::jsonb)", [u, cents, key, JSON.stringify(WITHDRAW)]);
const sendCredits = (from, to, n, key) => rpc("select transfer_credits_checked($1, $2, $3, 1, $4, null, 'withdrawable', 100000)", [from, to, n, key]);
const withdrawCredits = (u, n, key) => rpc("select request_credit_withdrawal($1, $2, $2, 2000, 'paystack', '{}'::jsonb, '{}'::jsonb, 'pending', $3, 5, 100000)", [u, n, key]);
const withdrawSub = (u, key) => rpc("select request_sub_withdrawal($1, 1000, 1000, 500, 'paystack', '{}'::jsonb, '{}'::jsonb, $2, false, 20)", [u, key]);
const seedSub = (u) => db.exec(`insert into sub_balances (creator_id, available_cents, lifetime_cents) values ('${u}', 5000, 5000); insert into sub_ledger (creator_id, kind, amount_cents, pending_after, available_after, reference) values ('${u}', 'earning', 5000, 0, 5000, 'seed-${u}')`);
const qualify = (u) => db.exec(`insert into reward_profiles (user_id, qualification_status, qualified_at) values ('${u}', 'approved', now()) on conflict (user_id) do update set qualification_status = 'approved', qualified_at = now()`);
const adminRestrict = (u, reason) => db.query("insert into reward_profiles (user_id, restricted, restricted_reason, updated_at) values ($1, true, $2, now()) on conflict (user_id) do update set restricted = true, restricted_reason = $2", [u, reason]);
const flag = async (u) => (await one("select restricted, restricted_reason from reward_profiles where user_id = $1", [u])) ?? { restricted: false, restricted_reason: null };
const coinBlock = (u) => rpc("select coin_wallet_block_reason($1)", [u]);
const creditBlock = (u) => rpc("select credit_wallet_block_reason($1)", [u]);
/** A member with AI credits (qualified), SUB earnings and released coins. */
const member = async (u) => {
  await wallet(u);
  await qualify(u);
  await creditTopup(u, 1000, `frenz_cr_topup_m${u.slice(-3)}`);
  await seedSub(u);
  return coinDeposit(u, 40000);
};
const sink = U(50);
const sinkWallet = await wallet(sink);

// ═══ before 0281: the state 0280 leaves behind ═══
const L1 = U(1), L2 = U(2), L3 = U(3);
await wallet(L1); await wallet(L2); await wallet(L3);
// L1: a coin shortfall (written onto the account by 0280)
const l1dep = await coinDeposit(L1, 20000);
await sendCoins(L1, sinkWallet, 15000, "l1-send");
await coinRefund("legacy-l1", l1dep);
// L2: an AI-credit shortfall (written onto the account by 0278)
await creditTopup(L2, 100, "frenz_cr_topup_l2");
await sendCredits(L2, sinkWallet, 60, "l2-send");
await creditRefund("legacy-l2", "frenz_cr_topup_l2");
// L3: an administrator's restriction, and then a coin shortfall too
await adminRestrict(L3, "fraud review: chargebacks");
const l3dep = await coinDeposit(L3, 20000);
await db.query("update reward_profiles set restricted = false where user_id = $1", [L3]);
await sendCoins(L3, sinkWallet, 15000, "l3-send");
await adminRestrict(L3, "fraud review: chargebacks");
await coinRefund("legacy-l3", l3dep);
ok((await flag(L1)).restricted_reason === "coin_deposit_shortfall" && (await flag(L2)).restricted_reason === "wallet_topup_shortfall", "before 0281: both shortfalls were written onto the account (the defect)");
ok((await flag(L3)).restricted_reason === "fraud review: chargebacks", "before 0281: the admin's restriction kept its own reason");

// ═══ 0281, twice ═══
await run(scopeMigration(dir));
await run(scopeMigration(dir));

// ── mutants ──
const fnBody = async (name) => (await one("select pg_get_functiondef(p.oid) d from pg_proc p where p.proname = $1", [name])).d;
const mutate = async (name, from, to) => { const b = await fnBody(name); const m = b.split(from).join(to); if (m === b) throw new Error(`mutant on ${name} did not apply`); await db.exec(m); };
if (MUTANT === "shared-block") await mutate("transfer_coins", "public.coin_wallet_block_reason(p_sender)", "public.credit_wallet_block_reason(p_sender)");
if (MUTANT === "restrict-account") await mutate("reverse_coin_deposit", "  -- 0281: the shortfall row itself pauses this product", "  if v_short > 0 then insert into public.reward_profiles (user_id, restricted, restricted_reason, updated_at) values (v_user, true, 'shortfall', now()) on conflict (user_id) do update set restricted = true, updated_at = now(); end if;\n  -- 0281: the shortfall row itself pauses this product");
if (MUTANT === "coin-ignores-shortfall") await mutate("coin_wallet_block_reason", "if exists (select 1 from public.coin_deposit_reversals where user_id = p_user and shortfall_cents > 0 and shortfall_cleared_at is null) then return 'recovery_due'; end if;", "");
if (MUTANT === "clear-all") await mutate("lift_coin_shortfall_restriction", "where user_id = p_user and restricted and restricted_reason = 'coin_deposit_shortfall';", "where user_id = p_user and restricted;");

// ── the backfill ──
ok(!(await flag(L1)).restricted && !(await flag(L2)).restricted, "0281 moved both automatic shortfall restrictions off the account");
ok((await flag(L3)).restricted === true && (await flag(L3)).restricted_reason === "fraud review: chargebacks", "the administrator's restriction is untouched");
const moved = await q("select target_id, details from financial_audit_log where action = 'restriction_rescoped_to_product' order by target_id");
ok(moved.length === 2 && moved.map((m) => m.target_id).join() === [L1, L2].join() && moved.find((m) => m.target_id === L1).details.product === "frenz_coin", "one audit row per moved restriction, naming the product — and none from the second run");
ok((await coinBlock(L1)) === "recovery_due" && (await creditBlock(L1)) === null, "L1 (coin shortfall): coins still paused by the shortfall row, AI credits free");
ok((await creditBlock(L2)) === "recovery_due" && (await coinBlock(L2)) === null, "L2 (AI-credit shortfall): AI credits still paused, coins free");
ok(!!(await throws("update reward_profiles set restricted = true, restricted_reason = 'coin_deposit_shortfall' where user_id = $1", [L1])), "an automatic shortfall reason can never again be an account restriction");
ok(!!(await throws("insert into reward_profiles (user_id, restricted, restricted_reason) values ($1, true, 'wallet_topup_shortfall')", [U(40)])), "…for either product");
const g = await one("select has_function_privilege('authenticated', 'public.coin_wallet_block_reason(uuid)', 'execute') a, has_function_privilege('service_role', 'public.coin_wallet_block_reason(uuid)', 'execute') s");
ok(!g.a && g.s, "coin_wallet_block_reason: service role only");

// ═══ a coin shortfall pauses coins only ═══
const M = U(10), Mto = U(11);
const mDep = await member(M);
const mToWallet = await wallet(Mto);
ok((await sendCoins(M, sinkWallet, 30000, "m-send-1"))?.ok === true, "M sends $300 of the $400 deposit (+$30 fee)");
let r = await coinRefund("m-refund", mDep);
ok(r?.shortfall === 33000 && r.recovered === 7000, "the deposit is refunded: $70 recovered, $330 short");
ok(!(await flag(M)).restricted, "nothing is written onto the account");
ok((await sendCoins(M, mToWallet, 100, "m-send-2"))?.reason === "recovery_due", "coin transfer: paused (recovery_due)");
ok((await withdrawCoins(M, 500, "m-wd-1"))?.reason === "recovery_due", "coin withdrawal: paused (recovery_due)");
ok((await sendCredits(M, mToWallet, 10, "m-cr-send"))?.ok === true, "AI-credit transfer: NOT paused by a coin shortfall");
ok((await withdrawCredits(M, 200, "m-cr-wd"))?.ok === true, "AI-credit withdrawal: NOT paused by a coin shortfall");
ok((await withdrawSub(M, "m-sub-wd"))?.ok === true, "SUB withdrawal: NOT paused by a coin shortfall");
const mBlock = await rpc("select account_financial_blockers($1)", [M]);
ok(mBlock.reasons.includes("coin_recovery_due") && !mBlock.reasons.includes("recovery_due"), "the purge blocker names the coin shortfall only");
ok(Number((await one("select balance_cents b from ai_product_balances where user_id = $1 and product = 'frenz_coin'", [sink])).b) >= 30000, "the recipient was not clawed back");
const mRev = (await one("select id from coin_deposit_reversals where event_key = 'm-refund'")).id;
r = await rpc("select clear_coin_deposit_shortfall($1, $2, 'recovered by bank transfer')", [mRev, ADMIN]);
// the refund took back the last $70 — a new (released) deposit to spend
await coinDeposit(M, 5000);
ok(r?.ok === true && (await coinBlock(M)) === null && (await sendCoins(M, mToWallet, 100, "m-send-3"))?.ok === true, "cleared by an admin: coins move again");
ok((await rpc("select clear_coin_deposit_shortfall($1, $2, 'again')", [mRev, ADMIN]))?.duplicate === true, "cleared once");

// ═══ an AI-credit shortfall pauses AI credits only ═══
const P = U(12), Pto = U(13);
await member(P);
const pToWallet = await wallet(Pto);
await creditTopup(P, 100, "frenz_cr_topup_p1");
await sendCredits(P, pToWallet, 1000, "p-cr-send-1");
r = await creditRefund("p-refund", "frenz_cr_topup_p1");
ok(r?.shortfall > 0, `an AI-credit top-up is refunded after being sent on: shortfall ${r?.shortfall}`);
ok(!(await flag(P)).restricted, "nothing is written onto the account");
ok((await sendCredits(P, pToWallet, 1, "p-cr-send-2"))?.reason === "recovery_due", "AI-credit transfer: paused (recovery_due)");
ok((await withdrawCredits(P, 20, "p-cr-wd"))?.reason === "recovery_due", "AI-credit withdrawal: paused (recovery_due)");
ok((await sendCoins(P, pToWallet, 100, "p-send"))?.ok === true, "coin transfer: NOT paused by an AI-credit shortfall");
ok((await withdrawCoins(P, 500, "p-wd"))?.ok === true, "coin withdrawal: NOT paused by an AI-credit shortfall");
ok((await withdrawSub(P, "p-sub-wd"))?.ok === true, "SUB withdrawal: NOT paused by an AI-credit shortfall");
const pRev = (await one("select id from wallet_topup_reversals where event_key = 'p-refund'")).id;
r = await rpc("select clear_wallet_topup_shortfall($1, $2, 'written off')", [pRev, ADMIN]);
ok(r?.ok === true && (await creditBlock(P)) === null, "cleared by an admin: AI credits move again");

// ═══ an administrator's account-wide restriction, and a suspension, pause everything ═══
const Q = U(14), Qto = U(15);
const qDep = await member(Q);
const qToWallet = await wallet(Qto);
await sendCoins(Q, sinkWallet, 30000, "q-send-1");
await creditTopup(Q, 100, "frenz_cr_topup_q1");
await sendCredits(Q, sinkWallet, 1050, "q-cr-send-1");
await creditRefund("q-cr-refund", "frenz_cr_topup_q1");
await coinRefund("q-refund", qDep);
await adminRestrict(Q, "fraud review: account takeover");
for (const [what, call] of [
  ["coin transfer", () => sendCoins(Q, qToWallet, 100, "q-x1")],
  ["coin withdrawal", () => withdrawCoins(Q, 500, "q-x2")],
  ["AI-credit transfer", () => sendCredits(Q, qToWallet, 1, "q-x3")],
  ["AI-credit withdrawal", () => withdrawCredits(Q, 20, "q-x4")],
  ["SUB withdrawal", () => withdrawSub(Q, "q-x5")],
]) {
  const out = await call();
  ok(out?.ok !== true && ["restricted", "recovery_due"].includes(out?.reason), `admin restriction: ${what} refused (${out?.reason})`);
}
const qCoin = (await one("select id from coin_deposit_reversals where event_key = 'q-refund'")).id;
const qCredit = (await one("select id from wallet_topup_reversals where event_key = 'q-cr-refund'")).id;
await rpc("select clear_coin_deposit_shortfall($1, $2, 'recovered')", [qCoin, ADMIN]);
await rpc("select clear_wallet_topup_shortfall($1, $2, 'recovered')", [qCredit, ADMIN]);
ok((await flag(Q)).restricted === true && (await flag(Q)).restricted_reason === "fraud review: account takeover", "clearing BOTH product shortfalls leaves the admin's restriction in place");
ok((await coinBlock(Q)) === "restricted" && (await creditBlock(Q)) === "restricted" && (await withdrawSub(Q, "q-x6"))?.reason === "restricted", "…and it still pauses coins, AI credits and SUB");
// a won dispute clears its own shortfall, not the admin's restriction
const R = U(16);
const rDep = await member(R);
await sendCoins(R, sinkWallet, 36000, "r-send");
await coinDispute("r-dispute", rDep);
await adminRestrict(R, "manual hold");
await rpc("select resolve_coin_deposit_dispute((select id from coin_deposit_reversals where event_key = 'r-dispute'), 'won', $1, 'won')", [ADMIN]);
ok((await flag(R)).restricted === true && (await coinBlock(R)) === "restricted", "a won dispute clears its shortfall but not the admin's restriction");
await db.query("update reward_profiles set restricted = false, restricted_reason = null where user_id = $1", [R]);
ok((await coinBlock(R)) === null, "with the admin's restriction lifted by the admin, coins move again");

const S = U(17);
await member(S);
await db.query("update profiles set is_suspended = true where id = $1", [S]);
ok((await coinBlock(S)) === "suspended" && (await creditBlock(S)) === "suspended", "suspension pauses coins and AI credits");
ok((await sendCoins(S, sinkWallet, 100, "s-send"))?.reason === "suspended" && (await withdrawCredits(S, 20, "s-wd"))?.reason === "suspended", "…in the real transfer and withdrawal functions");

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
