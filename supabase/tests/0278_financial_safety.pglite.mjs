// 0278 (Frenz Coin Part 2) — financial safety, against the REAL wallet functions in PGlite.
// Run from a folder under %TEMP% (where @electric-sql/pglite is installed), next to credit_wallet.shared.mjs:
//   node 0278_financial_safety.pglite.mjs <repo>/supabase/migrations [--mutant=<name>]
//
// Builds the wallet from the migrations themselves (credit_wallet.shared.mjs), does some business BEFORE 0278
// (a fee to backfill, history that used to cascade), applies 0278 twice, then drives top-up refunds and
// disputes, eligibility, suspension, the in-transaction limits, idempotency, the ledger guards, the fee
// counter-entries and account deletion — checking the wallet invariants after every step.
//
// ⚠️ PGlite is ONE connection: real interleaving is in credit_wallet_concurrency.pg.mjs.
//
// --mutant=<name> breaks one protection and the run must FAIL:
//   no-cap            a partial refund is not capped by what is left of the top-up -> over-reversal
//   no-restrict       a shortfall does not restrict the account                     -> spent credits keep moving
//   no-qualification  request_credit_withdrawal skips the qualification check     -> unapproved withdrawal
//   no-suspension     credit_wallet_block_reason ignores is_suspended               -> suspended member moves money
//   no-daily-limit    transfer_credits_checked skips the 24-hour sum                -> over the daily limit
//   no-month-limit    request_credit_withdrawal skips the 30-day sum                -> over the monthly limit
//   no-ledger-guard   the ai_product_ledger guard trigger is dropped                -> a movement is rewritten
//   keep-cascade      the ledger's cascade to auth.users is put back                -> deletion erases history
//   no-fee-post       the fee counter-entry trigger is dropped                      -> fee income unrecorded
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
await db.exec(`insert into auth.users (id, email, email_confirmed_at) select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'u' || g || '@t.test', now() from generate_series(1, 60) g`);
await db.exec(`insert into public.profiles (id) select id from auth.users`);

const bal = async (u) => (await one("select balance_cents::int b, withdrawable_cents::int w, deposited_cents::int d from ai_product_balances where user_id = $1 and product = 'character_replace'", [u])) ?? { b: 0, w: 0, d: 0 };
const deposit = (u, credits, ref, bonus = 0) =>
  db.query("select credit_product_balance($1, 'character_replace', $2, 'recharge', $3, 'CREDIT')", [u, credits, ref]).then(() => (bonus ? db.query("select credit_product_balance($1, 'character_replace', $2, 'bonus', $3, 'CREDIT')", [u, bonus, ref]) : null));
const grant = (u, credits, ref) => db.query("select credit_product_balance($1, 'character_replace', $2, 'grant', $3, 'CREDIT')", [u, credits, ref]);
const wallet = async (u) => rpc("select ensure_wallet_number($1)", [u]);
const invariants = async (label) => {
  const bad = await q(`select b.user_id, b.balance_cents, b.withdrawable_cents, b.deposited_cents, coalesce(l.s, 0) s from ai_product_balances b
    left join (select user_id, sum(delta_cents) s from ai_product_ledger group by user_id) l on l.user_id = b.user_id
    where b.balance_cents <> coalesce(l.s, 0) or b.balance_cents < 0 or b.withdrawable_cents > b.balance_cents or b.deposited_cents > b.withdrawable_cents`);
  ok(bad.length === 0, `${label}: every balance equals its ledger, never negative, deposited <= withdrawable <= balance${bad.length ? " " + JSON.stringify(bad) : ""}`);
};

// ── before 0278: business that 0278 must backfill and preserve ──
const PRE_A = U(50), PRE_B = U(51);
await grant(PRE_A, 200, "pre-grant");
const preWallet = await wallet(PRE_B);
const preT = await rpc("select transfer_credits($1, $2, 100, 5, 'pre-key-1', null, 'usable')", [PRE_A, preWallet]);
ok(preT.ok, "before 0278: a transfer with a 5-credit fee");

// ── 0278, twice (idempotent) ──
await run(migration(dir));
await run(migration(dir));
// Frenz Coin Part 3 regression: APPLY_0279=1 runs this WHOLE Part 2 suite with 0279 on top (credits and SUB must not change)
if (process.env.APPLY_0279 === "1") {
  await run(coinMigration(dir));
  await run(coinMigration(dir));
  // Frenz Coin Part 4 regression: APPLY_0279=1 APPLY_0280=1 adds 0280 on top of that
  await run(applyDeposits(dir));
}
await db.exec("grant usage on schema public to anon, authenticated");
await db.exec("grant select, insert, update, delete on all tables in schema public to anon, authenticated");

// ── mutants ──
const fnBody = async (name) => (await one("select pg_get_functiondef(p.oid) d from pg_proc p where p.proname = $1", [name])).d;
const mutate = async (name, from, to) => { const b = await fnBody(name); const m = b.replace(from, to); if (m === b) throw new Error(`mutant on ${name} did not apply`); await db.exec(m); };
if (MUTANT === "no-cap") await mutate("reverse_wallet_topup", "v_remain := greatest(0, v_credited - v_already)", "v_remain := v_credited");
if (MUTANT === "no-restrict") await mutate("reverse_wallet_topup", /if v_short > 0 then[\s\S]*?on conflict \(user_id\) do update[\s\S]*?end if;/, "");
if (MUTANT === "no-qualification") await mutate("request_credit_withdrawal", "if v_prof.user_id is null or not (v_prof.qualified_at is not null or v_prof.qualification_status = 'approved') then", "if false then");
if (MUTANT === "no-suspension") await mutate("credit_wallet_block_reason", "if exists (select 1 from public.profiles where id = p_user and is_suspended) then return 'suspended'", "if false then return 'suspended'");
if (MUTANT === "no-daily-limit") await mutate("transfer_credits_checked", "if v_sent + p_amount > p_daily_max then", "if false then");
if (MUTANT === "no-month-limit") await mutate("request_credit_withdrawal", "if v_month + p_count_credits > p_max_credits_month then", "if false then");
if (MUTANT === "no-ledger-guard") await db.exec("drop trigger ai_product_ledger_guard on public.ai_product_ledger");
if (MUTANT === "keep-cascade") await db.exec("alter table public.ai_product_ledger add constraint ai_product_ledger_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade");
if (MUTANT === "no-fee-post") await db.exec("drop trigger ai_product_ledger_post_fee on public.ai_product_ledger");

// ── 4 · the fee counter-entry: backfilled, and posted for new fees ──
ok(Number((await one("select count(*) n from platform_fee_ledger where payer_id = $1 and amount = 5", [PRE_A])).n) === 1, "the fee taken before 0278 was backfilled into platform_fee_ledger");
await invariants("after 0278");

// ── H1 · refunds and chargebacks of a top-up ──
const A = U(1), B = U(2), C = U(3);
await deposit(A, 100, "frenz_cr_topup_a1", 10);
let r = await rpc("select reverse_wallet_topup('paystack', 'refund:1', 'refund', 'frenz_cr_topup_a1', null, 1000, 'NGN', null, null)");
ok(r.ok && r.due === 110 && r.recovered === 110 && r.shortfall === 0, "a full refund of an unspent top-up takes back the credits AND the pack bonus");
ok((await bal(A)).b === 0 && (await bal(A)).w === 0 && (await bal(A)).d === 0, "the wallet is back to zero, withdrawable and deposited too");
r = await rpc("select reverse_wallet_topup('paystack', 'refund:1', 'refund', 'frenz_cr_topup_a1', null, 1000, 'NGN', null, null)");
ok(r.duplicate === true && (await bal(A)).b === 0, "the same refund event again changes nothing");
r = await rpc("select reverse_wallet_topup('flutterwave', 'admin:x', 'refund', 'frenz_cr_topup_a1', null, 1000, 'NGN', null, null)");
ok(r.ok && r.due === 0, "a second refund of a fully reversed top-up (even via another rail key) owes nothing more");
ok(Number((await one("select count(*) n from ai_product_ledger where reference = 'frenz_cr_topup_a1' and kind in ('recharge', 'bonus')")).n) === 2, "the original recharge and bonus rows are kept");
await invariants("full refund");

await deposit(A, 100, "frenz_cr_topup_a2");
r = await rpc("select reverse_wallet_topup('paystack', 'refund:p1', 'refund', 'frenz_cr_topup_a2', 300, 1000, 'NGN', null, null)");
ok(r.due === 30 && r.recovered === 30, "a 30% partial refund takes back 30% of the credits");
r = await rpc("select reverse_wallet_topup('paystack', 'refund:p2', 'refund', 'frenz_cr_topup_a2', 333, 1000, 'NGN', null, null)");
ok(r.due === 34, "a partial share is rounded UP (33.3 -> 34)");
r = await rpc("select reverse_wallet_topup('paystack', 'refund:p3', 'refund', 'frenz_cr_topup_a2', 900, 1000, 'NGN', null, null)");
ok(r.due === 36, "partial refunds together never take more than the top-up credited (100 - 30 - 34 = 36)");
ok(Number((await one("select coalesce(sum(credits_due), 0) s from wallet_topup_reversals where reference = 'frenz_cr_topup_a2'")).s) === 100, "in total exactly the 100 credits came back");
await invariants("partial refunds");

// spent and sent before the chargeback: a shortfall, a restriction, nothing negative
await deposit(B, 100, "frenz_cr_topup_b1");
const cWallet = await wallet(C);
r = await rpc("select transfer_credits_checked($1, $2, 60, 3, 'b-send-1', null, 'withdrawable', 100000)", [B, cWallet]);
ok(r.ok, "the member sends 60 deposited credits (+3 fee) before the chargeback");
r = await rpc("select reverse_wallet_topup('paystack', 'refund:b1', 'refund', 'frenz_cr_topup_b1', null, 1000, 'NGN', null, null)");
ok(r.due === 100 && r.recovered === 37 && r.shortfall === 63, "what is left (37) is taken back, the 63 already sent is a shortfall");
ok((await bal(B)).b === 0, "the wallet ends at zero, never negative");
ok((await bal(C)).b === 60, "the recipient's credits are not touched automatically");
// 0281 (APPLY_0281=1): a shortfall pauses AI credits through its own row and is NOT written onto the account
if (SCOPED) ok(!(await one("select restricted from reward_profiles where user_id = $1", [B]))?.restricted && (await rpc("select credit_wallet_block_reason($1)", [B])) === "recovery_due", "0281: the shortfall pauses AI credits (recovery_due) without an account restriction");
else ok((await one("select restricted, restricted_reason from reward_profiles where user_id = $1", [B]))?.restricted === true, "the account is restricted for the shortfall");
const audit = await one("select details from financial_audit_log where action = 'wallet_topup_refund' and reference = 'frenz_cr_topup_b1'");
ok(audit && audit.details.shortfall === 63 && audit.details.transfers_out_since_topup === 1 && audit.details.credits_sent_since_topup === 60, "the audit row names the shortfall and where the credits went");
await deposit(B, 50, "frenz_cr_topup_b2");
await db.exec(`update reward_profiles set qualification_status = 'approved', qualified_at = now() where user_id = '${B}'`);
r = await rpc("select transfer_credits_checked($1, $2, 10, 1, 'b-send-2', null, 'withdrawable', 100000)", [B, cWallet]);
ok(!r.ok && ["restricted", "recovery_due"].includes(r.reason), "a member with an open shortfall cannot send");
r = await rpc("select request_credit_withdrawal($1, 20, 20, 200, 'paystack', '{}'::jsonb, '{}'::jsonb, 'pending', 'b-wd-1', 5, 100000)", [B]);
ok(!r.ok && ["restricted", "recovery_due"].includes(r.reason), "a member with an open shortfall cannot withdraw");
// an admin restriction that is not ours: lifting a shortfall must not clear it
const sid = (await one("select id from wallet_topup_reversals where event_key = 'refund:b1'")).id;
r = await rpc("select clear_wallet_topup_shortfall($1, $2, 'recovered by bank transfer')", [sid, U(59)]);
ok(r.ok && r.lifted === !SCOPED, SCOPED ? "0281: an admin settles the shortfall (there was no account restriction to lift)" : "an admin settles the shortfall and the restriction it caused is lifted");
r = await rpc("select transfer_credits_checked($1, $2, 10, 1, 'b-send-3', null, 'withdrawable', 100000)", [B, cWallet]);
ok(r.ok, "after the shortfall is settled the member can send again");
await invariants("shortfall");

// a dispute HOLDS, then the outcome decides
const D = U(4);
await deposit(D, 100, "frenz_cr_topup_d1");
r = await rpc("select reverse_wallet_topup('paystack', 'dispute:1', 'dispute', 'frenz_cr_topup_d1', null, 1000, 'NGN', null, null)");
ok(r.state === "held" && (await bal(D)).b === 0, "a dispute holds the disputed credits (they cannot be spent or withdrawn)");
ok((await one("select status from ai_product_ledger where reference = 'topup-reversal:paystack:dispute:1'")).status === "reserved", "the hold is a reserved reversal row");
r = await rpc("select resolve_wallet_topup_dispute((select id from wallet_topup_reversals where event_key = 'dispute:1'), 'won', $1, 'won in the dashboard')", [U(59)]);
ok(r.ok && r.state === "restored", "a dispute won gives the credits back");
const dAfter = await bal(D);
ok(dAfter.b === 100 && dAfter.w === 100 && dAfter.d === 100, "exactly as they left: withdrawable and deposited");
ok((await one("select status from ai_product_ledger where reference = 'topup-reversal:paystack:dispute:1'")).status === "refunded", "the hold row is marked refunded")
r = await rpc("select resolve_wallet_topup_dispute((select id from wallet_topup_reversals where event_key = 'dispute:1'), 'won', $1, 'again')", [U(59)]);
ok(r.duplicate === true && (await bal(D)).b === 100, "recording the outcome twice restores once");
await deposit(D, 40, "frenz_cr_topup_d2");
await rpc("select reverse_wallet_topup('paystack', 'dispute:2', 'dispute', 'frenz_cr_topup_d2', null, 400, 'NGN', null, null)");
r = await rpc("select resolve_wallet_topup_dispute((select id from wallet_topup_reversals where event_key = 'dispute:2'), 'lost', $1, 'lost')", [U(59)]);
ok(r.state === "lost" && (await bal(D)).b === 100 && (await one("select status from ai_product_ledger where reference = 'topup-reversal:paystack:dispute:2'")).status === "settled", "a dispute lost settles the hold")
r = await rpc("select reverse_wallet_topup('paystack', 'refund:none', 'refund', 'frenz_cr_topup_unknown', null, 1000, 'NGN', null, null)");
ok(r.ok === false && r.reason === "not_credited" && Number((await one("select count(*) n from financial_audit_log where action = 'wallet_topup_reversal_unmatched'")).n) === 1, "a refund for a reference we never credited changes nothing and is audited");
await invariants("disputes");

// ── M1 · qualification, M2 · suspension ──
const E = U(5);
await deposit(E, 500, "frenz_cr_topup_e1");
r = await rpc("select request_credit_withdrawal($1, 120, 100, 1000, 'paystack', '{}'::jsonb, '{}'::jsonb, 'pending', 'e-wd-1', 5, 100000)", [E]);
ok(!r.ok && r.reason === "not_qualified", "an unapproved member cannot withdraw by calling the server directly");
ok(Number((await one("select count(*) n from withdrawal_requests where user_id = $1", [E])).n) === 0 && (await bal(E)).w === 500, "and nothing was held");
await db.exec(`insert into reward_profiles (user_id, qualification_status) values ('${E}', 'applied') on conflict (user_id) do update set qualification_status = 'applied'`);
r = await rpc("select request_credit_withdrawal($1, 120, 100, 1000, 'paystack', '{}'::jsonb, '{}'::jsonb, 'pending', 'e-wd-1', 5, 100000)", [E]);
ok(!r.ok && r.reason === "not_qualified", "an application under review is not an approval");
await db.exec(`update reward_profiles set qualification_status = 'approved', qualified_at = now() where user_id = '${E}'`);
r = await rpc("select request_credit_withdrawal($1, 120, 100, 1000, 'paystack', '{}'::jsonb, '{}'::jsonb, 'pending', 'e-wd-1', 5, 100000)", [E]);
ok(r.ok && (await bal(E)).w === 380, "an approved member withdraws, and amount + flat-fee credits are held");
const eWd = r.id;
r = await rpc("select request_credit_withdrawal($1, 120, 100, 1000, 'paystack', '{}'::jsonb, '{}'::jsonb, 'pending', 'e-wd-1', 5, 100000)", [E]);
ok(r.duplicate === true && r.id === eWd && (await bal(E)).w === 380, "the same replay key answers the same withdrawal and holds nothing twice");
r = await rpc("select request_credit_withdrawal($1, 50, 50, 500, 'paystack', '{}'::jsonb, '{}'::jsonb, 'pending', 'e-wd-2', 5, 100000)", [E]);
ok(!r.ok && r.reason === "open_exists" && (await bal(E)).w === 380, "a second open withdrawal is refused cleanly (no exception, nothing held)");
const F = U(6);
await deposit(F, 300, "frenz_cr_topup_f1");
await db.exec(`insert into reward_profiles (user_id, qualified_at, qualification_status) values ('${F}', now(), 'none')`);
await db.exec(`update profiles set is_suspended = true where id = '${F}'`);
r = await rpc("select request_credit_withdrawal($1, 100, 100, 1000, 'paystack', '{}'::jsonb, '{}'::jsonb, 'pending', 'f-wd-1', 5, 100000)", [F]);
ok(!r.ok && r.reason === "suspended", "a suspended member cannot withdraw");
await grant(F, 50, "f-grant");
r = await rpc("select transfer_credits_checked($1, $2, 10, 1, 'f-send-2', null, 'usable', 100000)", [F, cWallet]);
ok(!r.ok && r.reason === "suspended", "a suspended member cannot send, with a balance to send");
const fW = await wallet(F);
await grant(C, 100, "c-grant");
r = await rpc("select transfer_credits_checked($1, $2, 10, 1, 'c-send-1', null, 'usable', 100000)", [C, fW]);
ok(!r.ok && r.reason === "recipient_unavailable", "nobody can send to a suspended account");
await db.exec(`update profiles set is_suspended = false where id = '${F}'`);
r = await rpc("select request_credit_withdrawal($1, 100, 100, 1000, 'paystack', '{}'::jsonb, '{}'::jsonb, 'pending', 'f-wd-1', 5, 100000)", [F]);
ok(r.ok, "a legacy auto-qualified member (qualified_at set) withdraws once the suspension is lifted");
await invariants("eligibility");

// ── M3 · limits inside the transaction ──
const G = U(7), H = U(8);
await grant(G, 1000, "g-grant");
const hW = await wallet(H);
r = await rpc("select transfer_credits_checked($1, $2, 60, 0, 'g-1', null, 'usable', 100)", [G, hW]);
ok(r.ok, "60 of a 100 daily limit");
const gBefore = await bal(G);
r = await rpc("select transfer_credits_checked($1, $2, 50, 0, 'g-2', null, 'usable', 100)", [G, hW]);
ok(!r.ok && r.reason === "daily_limit" && r.sent === 60, "50 more would pass the limit: refused");
ok((await bal(G)).b === gBefore.b && Number((await one("select count(*) n from credit_transfers where sender_id = $1", [G])).n) === 1, "a refused transfer leaves no partial change");
r = await rpc("select transfer_credits_checked($1, $2, 40, 0, 'g-3', null, 'usable', 100)", [G, hW]);
ok(r.ok, "exactly up to the limit is allowed (60 + 40 = 100)");
r = await rpc("select transfer_credits_checked($1, $2, 60, 0, 'g-1', null, 'usable', 100)", [G, hW]);
ok(r.ok && r.duplicate === true, "a replay of an earlier transfer is answered, never counted again, even at the limit");
r = await rpc("select transfer_credits_checked($1, $2, 1, 0, 'g-4', null, 'usable', 100)", [G, hW]);
ok(!r.ok && r.reason === "daily_limit", "the limit is the rolling 24-hour sum of amounts");

const I = U(9);
await grant(I, 1000, "i-grant");
await db.exec(`update ai_product_balances set withdrawable_cents = 1000 where user_id = '${I}'`);
await db.exec(`insert into reward_profiles (user_id, qualification_status, qualified_at) values ('${I}', 'approved', now())`);
r = await rpc("select request_credit_withdrawal($1, 110, 100, 1000, 'paystack', '{}'::jsonb, '{}'::jsonb, 'pending', 'i-1', 1, 250)", [I]);
ok(r.ok, "first withdrawal of the day");
await rpc("select resolve_withdrawal($1, 'approved', $2, null, null)", [r.id, U(59)]);
await rpc("select resolve_withdrawal($1, 'completed', $2, null, 'manual-1')", [r.id, U(59)]);
r = await rpc("select request_credit_withdrawal($1, 110, 100, 1000, 'paystack', '{}'::jsonb, '{}'::jsonb, 'pending', 'i-2', 1, 250)", [I]);
ok(!r.ok && r.reason === "day_limit", "the per-day count is enforced in the transaction");
r = await rpc("select request_credit_withdrawal($1, 160, 150, 1500, 'paystack', '{}'::jsonb, '{}'::jsonb, 'pending', 'i-3', 5, 250)", [I]);
ok(!r.ok && r.reason === "month_limit", "the 30-day credit limit counts what was held before plus what is asked now (110 + 150 > 250)");
r = await rpc("select request_credit_withdrawal($1, 140, 140, 1400, 'paystack', '{}'::jsonb, '{}'::jsonb, 'pending', 'i-4', 5, 250)", [I]);
ok(r.ok, "up to the 30-day limit is allowed (110 + 140 = 250)");
await invariants("limits");

// ── settlement / reversal repeated: once ──
r = await rpc("select resolve_withdrawal($1, 'rejected', $2, 'no', null)", [r.id, U(59)]);
const iAfter = await bal(I);
r = await rpc("select resolve_withdrawal((select id from withdrawal_requests where idempotency_key = 'i-4'), 'rejected', $1, 'again', null)", [U(59)]);
ok(r.ok === false && (await bal(I)).b === iAfter.b, "a rejection twice returns the credits once");

// ── AI jobs: reserve / settle / refund still work under the guard ──
const job1 = (await one("insert into ai_jobs (user_id) values ($1) returning id", [G])).id;
const job2 = (await one("insert into ai_jobs (user_id) values ($1) returning id", [G])).id;
await db.query("select reserve_product_charge($1, 'character_replace', $2, 30, 'CREDIT', null)", [G, job1]);
await db.query("select settle_product_charge($1, 'character_replace', $2)", [G, job1]);
await db.query("select refund_product_charge($1, 'character_replace', $2, 'failed after settle')", [G, job1]);
await db.query("select reserve_product_charge($1, 'character_replace', $2, 20, 'CREDIT', null)", [G, job2]);
await db.query("select refund_product_charge($1, 'character_replace', $2, 'failed')", [G, job2]);
ok((await q("select status from ai_product_ledger where kind = 'processing_charge' and user_id = $1 order by created_at", [G])).every((x) => x.status === "refunded"), "AI job reserve -> settle -> refund and reserve -> refund still run under the ledger guard");
ok(!(await throws("delete from ai_jobs where id = $1", [job2])), "deleting an AI job still clears the ledger's job_id (ON DELETE SET NULL is allowed)");
await db.query("select adjust_product_balance($1, 'character_replace', -5, 'adj-1', 'correction', $2, 'CREDIT')", [G, U(59)]);
await invariants("AI jobs");

// ── 5 · the guards ──
const anyRow = (await one("select id from ai_product_ledger where kind = 'recharge' limit 1")).id;
ok(!!(await throws("update ai_product_ledger set delta_cents = delta_cents + 1 where id = $1", [anyRow])), "a recorded movement cannot be rewritten");
ok(!!(await throws("update ai_product_ledger set balance_after_cents = 1 where id = $1", [anyRow])), "balance_after is fixed once written");
ok(!!(await throws("delete from ai_product_ledger where id = $1", [anyRow])), "a ledger row cannot be deleted");
ok(!!(await throws("update ai_product_ledger set status = 'reserved' where kind = 'processing_charge' and user_id = $1", [G])), "a status cannot move backwards");
ok(!!(await throws("update credit_transfers set amount = 1")), "credit_transfers is append-only");
ok(!!(await throws("delete from financial_audit_log")), "financial_audit_log is append-only");
ok(!!(await throws("update platform_fee_ledger set amount = 1")), "platform_fee_ledger is append-only");
await db.exec("begin");
await db.exec("set local frenz.ledger_maintenance = 'on'");
await db.query("update ai_product_ledger set note = 'corrected by an operator' where id = $1", [anyRow]);
await db.exec("commit");
ok(Number((await one("select count(*) n from financial_audit_log where action = 'ledger_maintenance_update' and target_id = $1", [anyRow])).n) === 1, "an operator correction is possible only in maintenance mode and is audited by the guard itself");

// ── 4 · fees ──
const fees = await one("select coalesce(sum(-delta_cents), 0)::int s from ai_product_ledger where kind = 'transfer_fee'");
const posted = await one("select coalesce(sum(amount), 0)::int s from platform_fee_ledger");
ok(fees.s > 5 && fees.s === posted.s, `every transfer fee has its counter-entry (${fees.s} = ${posted.s})`);

// ── RLS: the browser can call none of it and write nothing ──
await db.exec("set role authenticated");
await db.exec(`select set_config('test.uid', '${G}', false)`);
ok(!!(await throws("select reverse_wallet_topup('paystack', 'x', 'refund', 'frenz_cr_topup_a1', null, null, null, null, null)")), "a member cannot call reverse_wallet_topup");
ok(!!(await throws("select transfer_credits_checked($1, $2, 1, 0, 'rls', null, 'usable', 100)", [G, hW])), "a member cannot call transfer_credits_checked");
ok(!!(await throws("select request_credit_withdrawal($1, 1, 1, 1, 'paystack', '{}'::jsonb, '{}'::jsonb, 'pending', 'rls', 5, 5)", [G])), "a member cannot call request_credit_withdrawal");
// (the harness re-grants table privileges the way Supabase's defaults do, so RLS — no policy — is the wall here)
ok((await q("select id from wallet_topup_reversals")).length === 0 && (await q("select id from platform_fee_ledger")).length === 0, "a member reads no reversal and no fee row (RLS with no policy)");
ok(!!(await throws("insert into platform_fee_ledger (source, source_ledger_id, reference, payer_id, amount, unit) values ('credit_transfer_fee', gen_random_uuid(), 'x', $1, 1, 'CREDIT')", [G])), "a member cannot write platform_fee_ledger");
const upd = await db.query("update ai_product_balances set balance_cents = 999999 where user_id = $1", [G]).catch(() => ({ affectedRows: 0 }));
ok(!upd.affectedRows, "a member cannot change their own balance");
await db.exec("reset role");

// ── H3 · account deletion ──
const request = (u) => db.exec(`update profiles set deletion_requested_at = now() - interval '31 days' where id = '${u}'`);
const purge = async (u) => { const out = await rpc("select retain_financial_records($1)", [u]); if (out.ok) { const e = await throws("delete from auth.users where id = $1", [u]); if (e) return { ok: false, reason: "delete_failed: " + e }; } return out; };
// 1 · no financial activity
const N1 = U(20);
ok((await rpc("select account_financial_blockers($1)", [N1])).ok === true, "deletion 1: no activity, nothing blocks");
ok((await rpc("select retain_financial_records($1)", [N1])).reason === "not_requested", "retain refuses an account that did not ask to be deleted");
await request(N1);
ok((await purge(N1)).ok && !(await one("select 1 x from auth.users where id = $1", [N1])), "deletion 1: purged");
// 2 · a completed transfer (tokens) between two members; 5 · activity with another member
const N2 = U(21), N3 = U(22);
await grant(N2, 100, "n2-grant");
const n3W = await wallet(N3);
r = await rpc("select transfer_credits_checked($1, $2, 50, 3, 'n2-send', 'thanks', 'usable', 100000)", [N2, n3W]);
await request(N2);
const blk2 = await rpc("select account_financial_blockers($1)", [N2]);
ok(blk2.ok === true && blk2.tokens === 47, "deletion 2: only tokens are left, nothing blocks (47 tokens)");
const p2 = await purge(N2);
ok(p2.ok && p2.tokens_closed === 47, "deletion 2: the token balance is closed with a ledger row");
ok(Number((await one("select count(*) n from credit_transfers where sender_id = $1 and recipient_id = $2", [N2, N3])).n) === 1, "deletion 2/5: the counterparty keeps the transfer record");
ok(Number((await one("select count(*) n from ai_product_ledger where user_id = $1", [N3])).n) === 1, "deletion 5: the counterparty's received row is untouched");
ok(Number((await one("select count(*) n from ai_product_ledger where user_id = $1", [N2])).n) >= 4, "deletion 2: the deleted member's own ledger is retained under their id");
ok(Number((await one("select count(*) n from platform_fee_ledger where payer_id = $1", [N2])).n) === 1, "deletion 2: the fee counter-entry is retained");
ok(!(await one("select 1 x from ai_product_balances where user_id = $1", [N2])), "deletion 2: the balance row itself is gone (it was zero)");
// 3 · a pending withdrawal
const N4 = U(23);
await deposit(N4, 200, "frenz_cr_topup_n4");
await db.exec(`insert into reward_profiles (user_id, qualification_status, qualified_at) values ('${N4}', 'approved', now())`);
r = await rpc("select request_credit_withdrawal($1, 200, 200, 2000, 'paystack', '{\"bankName\": \"Bank\", \"accountNumber\": \"0123456789\", \"accountName\": \"N Four\"}'::jsonb, '{}'::jsonb, 'pending', 'n4-1', 5, 100000)", [N4]);
await request(N4);
const blk3 = await rpc("select account_financial_blockers($1)", [N4]);
ok(!blk3.ok && blk3.reasons.includes("open_withdrawal"), "deletion 3: an open withdrawal blocks the purge");
ok((await purge(N4)).reason === "blocked" && !!(await one("select 1 x from auth.users where id = $1", [N4])), "deletion 3: the account is not purged");
await rpc("select resolve_withdrawal($1, 'approved', $2, null, null)", [r.id, U(59)]);
await rpc("select resolve_withdrawal($1, 'completed', $2, null, 'bank-ref-1')", [r.id, U(59)]);
const p3 = await purge(N4);
ok(p3.ok && p3.withdrawals_redacted === 1, "deletion 3: once paid, it purges and the bank details are redacted");
const red = await one("select payout_details d, status from withdrawal_requests where id = $1", [r.id]);
ok(red && red.status === "completed" && red.d.redacted === true && red.d.last4 === "6789" && !red.d.accountNumber && !red.d.accountName, "deletion 3: the completed withdrawal stays, with the bank and last four only");
// 4 · a nonzero (withdrawable) balance
const N5 = U(24);
await deposit(N5, 75, "frenz_cr_topup_n5");
await request(N5);
const blk4 = await rpc("select account_financial_blockers($1)", [N5]);
ok(!blk4.ok && blk4.reasons.includes("withdrawable_balance"), "deletion 4: withdrawable credits block the purge");
ok((await purge(N5)).reason === "blocked" && (await bal(N5)).b === 75, "deletion 4: nothing is closed or lost");
await invariants("deletion");

console.log(failures === 0 ? `\nALL PASSED${MUTANT ? ` (mutant ${MUTANT} SURVIVED — the suite has no teeth for it)` : ""}` : `\n${failures} FAILED${MUTANT ? ` (mutant ${MUTANT} caught)` : ""}`);
process.exit(failures === 0 ? (MUTANT ? 3 : 0) : 1);
