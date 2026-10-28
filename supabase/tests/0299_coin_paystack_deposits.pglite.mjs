// 0299 (owner, 2026-10-27: "make Nigeria users use Paystack as first choice of payment, deposit …") — a Frenz Coin deposit
// collected by PAYSTACK, against the REAL functions in PGlite. Run like 0284_coin_deposit_hold.pglite.mjs (from a folder
// where @electric-sql/pglite is installed, next to credit_wallet.shared.mjs):
//   node 0299_coin_paystack_deposits.pglite.mjs <repo>/supabase/migrations [--mutant=<name>]
//
// Builds the wallet, applies 0278–0281 and 0284, proves a Paystack deposit is REFUSED there, then applies 0299 TWICE
// (idempotent). Pinned: a Paystack deposit opens with its naira amount pinned on the attempt, settles ONLY on exactly that
// amount in that currency, lands on hold like any deposit, and its refund is recorded against provider paystack; a
// Flutterwave deposit is unchanged; any other provider is still refused by both functions and by the table checks; the
// functions stay service-role only.
//
// --mutant=<name> breaks one thing and the run must FAIL:
//   no-0299       the migration is not applied                       -> a Paystack deposit is refused
//   any-provider  begin_coin_deposit accepts any provider name        -> a 'bachs' deposit opens
import { readFileSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";

import { coinMigration, depositMigration, depositPrerequisites, migration, split, STUB, U, walletStatements } from "./credit_wallet.shared.mjs";

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
await run(depositPrerequisites(dir));
await run([
  "create table public.share_links (token text primary key)",
  stmt("0187_rewards_referrals.sql", "create table if not exists public.referral_attributions"),
  stmt("0255_rewards_v2.sql", "create table if not exists public.affiliate_accounts"),
  stmt("0255_rewards_v2.sql", "create table if not exists public.affiliate_commissions"),
  stmt("0255_rewards_v2.sql", "create or replace function public.queue_affiliate_commission("),
  "create or replace function public.process_reward_event(p_event text, p_actor uuid, p_source_type text, p_source_id text, p_metadata jsonb default '{}'::jsonb) returns jsonb language plpgsql as $$ begin return '[]'::jsonb; end $$",
]);
await run(migration(dir));
await run(coinMigration(dir));
await run(depositMigration(dir));
await run(split(read("0281_frenz_coin_restriction_scope.sql")));
await run(split(read("0284_frenz_coin_deposit_hold.sql")));
await db.exec(`insert into auth.users (id, email, email_confirmed_at) select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'u' || g || '@t.test', now() from generate_series(1, 20) g`);
await db.exec(`insert into public.profiles (id) select id from auth.users`);

const DEP = { enabled: true, version: 4, holdHours: 1, minCents: 100, maxCents: 500000 };
let seq = 0;
const psRef = () => `frenz_coin_dep_00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
const fwRef = () => `frenz_coin_dep_fw_00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
const begin = (u, provider, reference, cents, minor, currency, key) => rpc("select begin_coin_deposit($1, $2, $3, $4, $5, $6, $7, $8::jsonb)", [u, reference, cents, provider, minor, currency, key, JSON.stringify(DEP)]);
const settle = (reference, minor, currency) => rpc("select settle_coin_deposit($1, $2, $3, $4)", [reference, "ch-" + reference.slice(-6), minor, currency]);
const coin = async (u) => (await one("select balance_cents::int b, pending_cents::int p from ai_product_balances where user_id = $1 and product = 'frenz_coin'", [u])) ?? { b: 0, p: 0 };
const A = U(1), B = U(2), C = U(3), D = U(4);
const ADMIN = U(20);

// ── before 0299: Paystack can't collect a deposit ──
ok((await begin(A, "paystack", psRef(), 1000, 1_600_000, "NGN", "before-0299-a")).reason === "invalid", "before 0299 a Paystack deposit is refused (the gap this closes)");

const m = split(read("0299_frenz_coin_paystack_deposits.sql"));
if (MUTANT !== "no-0299") {
  await run(m);
  await run(m); // twice: idempotent
}
if (MUTANT === "any-provider") {
  const b = (await one("select pg_get_functiondef(p.oid) d from pg_proc p where p.proname = 'begin_coin_deposit'")).d;
  const mut = b.split("or p_provider is null or p_provider not in ('flutterwave', 'paystack')").join("");
  if (mut === b) throw new Error("mutant did not apply");
  await db.exec(mut);
}

// ── a Paystack deposit in naira: $10.00 at ₦1,600 = ₦16,000 (1,600,000 kobo) ──
const r1 = psRef();
const opened = await begin(A, "paystack", r1, 1000, 1_600_000, "NGN", "ps-deposit-0001");
ok(opened?.ok === true, "after 0299 a Paystack deposit opens");
const att = await one("select provider, provider_amount::bigint pa, provider_currency pc, amount_cents::int c, status from ai_topup_attempts where reference = $1", [r1]);
ok(att?.provider === "paystack" && Number(att.pa) === 1_600_000 && att.pc === "NGN" && att.c === 1000 && att.status === "pending", "its attempt pins Paystack, ₦16,000 and the $10.00 it credits");

ok((await settle(r1, 1_590_000, "NGN"))?.reason === "mismatch", "a short naira payment never settles");
const r2 = psRef();
await begin(B, "paystack", r2, 1000, 1_600_000, "NGN", "ps-deposit-0002");
ok((await settle(r2, 1000, "USD"))?.reason === "mismatch", "the right number in dollars never settles a naira deposit");

const r3 = psRef();
await begin(C, "paystack", r3, 2500, 4_000_000, "NGN", "ps-deposit-0003");
const s3 = await settle(r3, 4_000_000, "NGN");
ok(s3?.ok === true && Number(s3.amount) === 2500, "exactly ₦40,000 settles $25.00 of coins");
const c3 = await coin(C);
ok(c3.p === 2500 && c3.b === 2500, "on hold: pending, not spendable yet (as every deposit)");
const dep = await one("select provider, paid_minor::bigint pm, paid_currency pc, status from coin_deposits where reference = $1", [r3]);
ok(dep?.provider === "paystack" && Number(dep.pm) === 4_000_000 && dep.pc === "NGN" && dep.status === "held", "the settled deposit records Paystack and the naira paid");
const again = await settle(r3, 4_000_000, "NGN");
ok(again?.ok === true && again.duplicate === true && (await coin(C)).b === 2500, "a second settle (webhook + return page) credits nothing more");

// ── its refund is recorded against Paystack ──
const rv = await rpc("select reverse_coin_deposit('paystack', $1, 'refund', $2, null, 4000000, 'NGN', $3, 'test')", ["refund:ps:1", r3, ADMIN]);
ok(rv?.ok === true, "a Paystack refund of a coin deposit is accepted");
ok((await one("select provider from coin_deposit_reversals where event_key = 'refund:ps:1'"))?.provider === "paystack", "the reversal row names Paystack");
ok((await coin(C)).b === 0, "the refunded coins are taken back");
const rvAgain = await rpc("select reverse_coin_deposit('paystack', $1, 'refund', $2, null, 4000000, 'NGN', $3, 'test')", ["refund:ps:1", r3, ADMIN]);
ok(rvAgain?.duplicate === true, "the same refund event twice is one reversal");

// ── Flutterwave unchanged, anything else still refused ──
const r4 = fwRef();
ok((await begin(D, "flutterwave", r4, 1000, 1000, "USD", "fw-deposit-0004"))?.ok === true && (await settle(r4, 1000, "USD"))?.ok === true, "a Flutterwave deposit opens and settles exactly as before");
ok((await begin(U(5), "bachs", psRef(), 1000, 1000, "USD", "bachs-dep-0005"))?.reason === "invalid", "any other provider is still refused");
ok((await begin(U(6), null, psRef(), 1000, 1000, "USD", "null-dep-00006"))?.reason === "invalid", "no provider is refused");
ok((await rpc("select reverse_coin_deposit('bachs', 'e:x', 'refund', $1, null, 1000, 'USD', $2, 'test')", [r4, ADMIN]))?.reason === "invalid", "a reversal naming another provider is refused");
ok(!!(await throws("insert into coin_deposit_reversals (provider, event_key, kind, reference, user_id, phase, deposit_cents, due_cents, recovered_cents, state, ledger_reference) values ('bachs', 'k', 'refund', 'r', $1, 'held', 1, 0, 0, 'recovered', 'l')", [A])), "the reversals table still refuses another provider");

// ── still service-role only ──
const grants = await one("select has_function_privilege('authenticated', 'public.begin_coin_deposit(uuid, text, bigint, text, bigint, text, text, jsonb)', 'execute') a, has_function_privilege('anon', 'public.reverse_coin_deposit(text, text, text, text, bigint, bigint, text, uuid, text)', 'execute') b");
ok(grants && grants.a === false && grants.b === false, "neither function is callable by a member or a visitor");

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
