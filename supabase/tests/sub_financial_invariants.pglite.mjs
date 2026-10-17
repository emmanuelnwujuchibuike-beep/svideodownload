// Frenz Exclusive Part 12 — financial invariants, against the REAL money functions in PGlite.
// Run from %TEMP%\pgt (where @electric-sql/pglite is installed):
//   node sub_financial_invariants.pglite.mjs <repo>/supabase/migrations [--mutant=<name>]
// Applies 0227, 0231, 0237, 0239, 0247, 0250 for real, then drives settlement, renewal, refunds,
// disputes, withdrawals and payouts, checking the money invariants after EVERY step.
//
// ⚠️ PGlite is ONE connection: two transactions can't interleave here, so true concurrency is NOT
// exercised. "Concurrent" cases run the same calls back to back; what serialises them in production
// is the row lock each function takes (`for update` on the purchase / balance / withdrawal) and the
// unique indexes, which ARE checked below.
//
// --mutant=<name> breaks one protection and the run must FAIL:
//   dup-settle      settle_sub_purchase forgets "already paid"  -> double earning
//   dup-reverse     reverse_sub_purchase forgets "already reversed" -> double clawback
//   open-withdrawal drops the one-open-withdrawal unique index    -> two holds on one balance
//   dup-resolve     resolve_withdrawal forgets final states        -> funds released twice
//   dup-wd-reverse  reverse_paid_withdrawal forgets "already reversed" -> payout returned twice
//   dup-restore     restore_disputed_sub_purchase forgets "already restored" -> earning restored twice
//   wd-reverse-debt reverse_paid_withdrawal ignores debt            -> returned payout withdrawable while owed
//   restore-no-claw restore_disputed_sub_purchase skips the clawback check -> a never-earned purchase mints money
//   restore-own-end restore gives access only to the purchase's own end -> a later paid renewal loses its days
//   reject-ignores-debt resolve_withdrawal (0256) releases a rejection without settling debt -> withdrawable while owed
//   flat-not-covered request_sub_withdrawal (0258) checks the balance against the amount only -> the flat fee overdraws
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const dir = process.argv[2];
const MUTANT = (process.argv.find((a) => a.startsWith("--mutant=")) ?? "").split("=")[1] ?? "";

const stub = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create function public.is_admin() returns boolean language sql stable as $$ select false $$;
create table public.notifications (id bigint generated always as identity primary key, user_id uuid, actor_id uuid, type text, data jsonb, post_id uuid, created_at timestamptz default now());
create table public.reward_profiles (user_id uuid primary key, qualification_status text, qualified_at timestamptz, restricted boolean default false, qualification_reviewed_by uuid);
create table public.withdrawal_requests (id uuid primary key default gen_random_uuid(), user_id uuid, credits integer not null default 0, amount_usd_cents integer not null default 0, rate_snapshot jsonb, status text, payout_method text, payout_details jsonb, review_note text, reviewed_by uuid, payout_reference text, created_at timestamptz default now(), updated_at timestamptz default now(), completed_at timestamptz);
create table public.reports (id uuid primary key default gen_random_uuid(), reporter_id uuid, target_type text not null, target_id uuid not null, reason text not null, note text, status text not null default 'open', created_at timestamptz not null default now(),
  constraint reports_target_chk check (target_type in ('post','comment','user')), constraint reports_status_chk check (status in ('open','actioned','dismissed')));
create table public.creator_notification_prefs (viewer_id uuid, target_id uuid);
-- the AI wallet, so we can prove Exclusive never moves it
create table public.ai_product_balances (user_id uuid, product text, balance_cents bigint not null default 0, withdrawable_cents bigint not null default 0, updated_at timestamptz default now(), primary key (user_id, product));
create table public.ai_product_ledger (id bigint generated always as identity primary key, user_id uuid, product text, kind text, status text, delta_cents bigint, balance_after_cents bigint, currency text, reference text, note text, credit_class text, withdrawable_part bigint, metadata jsonb, updated_at timestamptz default now());
create unique index ai_product_ledger_ref_uidx on public.ai_product_ledger (user_id, product, kind, reference) where reference is not null;`;
const split = (sql) => { const out = []; let cur = ""; let inD = false; let inQ = false;
  for (let i = 0; i < sql.length; i++) {
    if (!inQ && sql.startsWith("$$", i)) { inD = !inD; cur += "$$"; i++; continue; }
    if (!inD && sql[i] === "'") inQ = !inQ;
    if (!inD && !inQ && sql.startsWith("--", i)) { const nl = sql.indexOf("\n", i); i = nl < 0 ? sql.length : nl; cur += "\n"; continue; }
    if (sql[i] === ";" && !inD && !inQ) { if (cur.trim()) out.push(cur); cur = ""; } else cur += sql[i]; }
  if (cur.trim()) out.push(cur); return out; };
const run = async (db, sql) => { for (const s of split(sql)) { try { await db.exec(s); } catch (e) { console.log("SQL ERROR:", e.message, "\n", s.slice(0, 300)); process.exit(2); } } };

const db = new PGlite();
await run(db, stub);
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
await db.exec(`insert into auth.users (id) select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid from generate_series(1, 40) g`);
for (const f of ["0227_sub_monetization.sql", "0231_sub_promo_dismiss.sql", "0237_sub_post_thumbs.sql", "0239_private_post_interactions.sql", "0247_sub_settlement_hardening.sql", "0250_sub_membership_lifecycle.sql", "0254_payout_reversal_dispute_restore.sql", "0256_withdrawal_rejection_settles_debt.sql", "0258_withdrawal_flat_fee.sql"]) await run(db, readFileSync(`${dir}/${f}`, "utf8"));
// 0254 and 0256 applied a second time: they must be idempotent
await run(db, readFileSync(dir + "/0254_payout_reversal_dispute_restore.sql", "utf8"));
await run(db, readFileSync(dir + "/0256_withdrawal_rejection_settles_debt.sql", "utf8"));
await run(db, readFileSync(dir + "/0258_withdrawal_flat_fee.sql", "utf8"));
// Supabase's defaults: clients hold table privileges on public and RLS is the only wall. Without this
// the client checks below would pass for the wrong reason (no grant at all instead of RLS).
await db.exec("grant usage on schema public to anon, authenticated");
await db.exec("grant select, insert, update, delete on all tables in schema public to anon, authenticated");

// ── mutants: break exactly one protection ──
const fnBody = async (name) => (await db.query("select pg_get_functiondef(p.oid) as d from pg_proc p where p.proname = $1", [name])).rows[0].d;
if (MUTANT === "dup-settle") await db.exec((await fnBody("settle_sub_purchase")).replace(/if v_p\.status = 'paid' then return[^;]*;\s*end if;/, ""));
if (MUTANT === "dup-reverse") await db.exec((await fnBody("reverse_sub_purchase")).replace(/if v_p\.status in \('refunded', 'disputed', 'reversed'\) then return[^;]*;\s*end if;/, ""));
if (MUTANT === "open-withdrawal") await db.exec("drop index public.withdrawal_requests_one_open_uidx");
if (MUTANT === "dup-wd-reverse") await db.exec((await fnBody("reverse_paid_withdrawal")).replace(/if v_w\.status = 'reversed' then return[^;]*;\s*end if;/, ""));
if (MUTANT === "dup-restore") await db.exec((await fnBody("restore_disputed_sub_purchase")).replace(/if v_p\.status = 'paid' and exists[\s\S]*?end if;/, "").replace("if v_p.status <> 'disputed' then", "if v_p.status not in ('disputed', 'paid') then"));
if (MUTANT === "wd-reverse-debt") await db.exec((await fnBody("reverse_paid_withdrawal")).replace("available_cents = available_cents + v_w.gross_cents - least(debt_cents, v_w.gross_cents)", "available_cents = available_cents + v_w.gross_cents").replace("debt_cents = debt_cents - least(debt_cents, v_w.gross_cents),", ""));
if (MUTANT === "restore-no-claw") await db.exec((await fnBody("restore_disputed_sub_purchase")).replace(/if not exists \(select 1 from public\.sub_ledger where kind = 'clawback'[\s\S]*?end if;/, ""));
if (MUTANT === "restore-own-end") await db.exec((await fnBody("restore_disputed_sub_purchase")).replace("and status = 'paid';", "and id = v_p.id;"));
if (MUTANT === "dup-resolve") { const b = await fnBody("resolve_withdrawal"); const m = b.replace(/if v_w\.status in \('completed', 'rejected', 'cancelled'(, 'reversed')?\) then return[^;]*;\s*end if;/, ""); if (m === b) throw new Error("mutant dup-resolve did not apply"); await db.exec(m); }
if (MUTANT === "flat-not-covered") { const b = await fnBody("request_sub_withdrawal"); const m = b.replace("if v_b.available_cents < v_total then", "if v_b.available_cents < p_gross_cents then"); if (m === b) throw new Error("mutant flat-not-covered did not apply"); await db.exec(m); }
if (MUTANT === "reject-ignores-debt") { const b = await fnBody("resolve_withdrawal"); const m = b.replace("v_pay := least(coalesce(v_b.debt_cents, 0), v_w.gross_cents);", "v_pay := 0;"); if (m === b) throw new Error("mutant reject-ignores-debt did not apply"); await db.exec(m); }

const q = async (s, p) => (await db.query(s, p)).rows;
const one = async (s, p) => (await q(s, p))[0];
const call = async (s, p) => (await one(s, p)).r;
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; console.log("FAIL:", m); } else console.log("ok:", m); };
const throws = async (s) => { try { await db.exec(s); return false; } catch { return true; } };

const C = U(1); // creator
const C2 = U(2); // another creator
const S = (n) => U(10 + n); // subscribers
let refN = 0;
const purchase = async (creator, sub, { price = 1000, minor = 165000, currency = "NGN", hold = 0 } = {}) => {
  const ref = `frenz_sub_t${++refN}`;
  const fee = Math.floor((price * 1000) / 10000);
  await db.exec(`insert into sub_purchases (creator_id, subscriber_id, price_cents, fee_cents, total_cents, fee_bp, charged_currency, charged_minor, reference, hold_days) values ('${creator}', '${sub}', ${price}, ${fee}, ${price + fee}, 1000, '${currency}', ${minor}, '${ref}', ${hold})`);
  return ref;
};
const settle = (ref, minor = 165000, cur = "NGN") => call("select settle_sub_purchase($1, $2, $3, 'trx') as r", [ref, minor, cur]);
const reverse = (ref, status) => call("select reverse_sub_purchase($1, $2, null, 'test') as r", [ref, status]);
let key = 0;
const withdraw = (user, gross, k = `k-${++key}`) => call("select request_sub_withdrawal($1, $2, 1000, 500, 'paystack', '{}'::jsonb, '{}'::jsonb, $3, false) as r", [user, gross, k]);
const resolve = (id, status) => call("select resolve_withdrawal($1::uuid, $2, null, 'test', null) as r", [id, status]);
/** the legal path to a paid payout: approved, processing, completed */
const payOut = async (id) => { await resolve(id, "approved"); await resolve(id, "processing"); return resolve(id, "completed"); };
const bal = (c) => one("select pending_cents::int p, available_cents::int a, held_cents::int h, debt_cents::int d, lifetime_cents::int l, withdrawn_cents::int w from sub_balances where creator_id = $1", [c]);
const access = async (creator, sub) => !!(await one("select 1 x from creator_memberships where creator_id = $1 and member_id = $2 and status = 'active' and billing = 'sub' and period_end > now()", [creator, sub]));
const aiSnapshot = async () => JSON.stringify(await q("select * from ai_product_balances order by user_id")) + JSON.stringify(await q("select count(*)::int n from ai_product_ledger"));

/** The money invariants for one creator — checked after every step. */
const invariants = async (c, label) => {
  const b = await bal(c);
  if (!b) return;
  const paid = (await one("select coalesce(sum(price_cents), 0)::int s from sub_purchases where creator_id = $1 and status = 'paid'", [c])).s;
  const unreleased = (await one("select coalesce(sum(price_cents), 0)::int s from sub_purchases where creator_id = $1 and status = 'paid' and released_at is null", [c])).s;
  const ledger = (await one("select coalesce(sum(amount_cents) filter (where kind in ('earning', 'clawback', 'dispute_restore')), 0)::int s from sub_ledger where creator_id = $1", [c])).s;
  const open = (await one("select coalesce(sum(gross_cents), 0)::int s from withdrawal_requests where user_id = $1 and source = 'sub' and status in ('pending', 'reviewing', 'approved', 'processing')", [c])).s;
  const done = (await one("select coalesce(sum(gross_cents), 0)::int s from withdrawal_requests where user_id = $1 and source = 'sub' and status = 'completed'", [c])).s;
  const bad = [];
  if (b.p < 0 || b.a < 0 || b.h < 0 || b.d < 0) bad.push("a negative balance field");
  if (b.p + b.a + b.h + b.w - b.d !== b.l) bad.push(`pending+available+held+withdrawn-debt (${b.p + b.a + b.h + b.w - b.d}) != lifetime (${b.l})`);
  if (b.l !== paid) bad.push(`lifetime ${b.l} != paid purchases ${paid}`);
  if (ledger !== b.l) bad.push(`ledger earnings+clawbacks ${ledger} != lifetime ${b.l}`);
  if (b.p !== unreleased) bad.push(`pending ${b.p} != unreleased paid ${unreleased}`);
  if (b.h !== open) bad.push(`held ${b.h} != open withdrawals ${open}`);
  if (b.w !== done) bad.push(`withdrawn ${b.w} != completed withdrawals ${done}`);
  ok(!bad.length, `invariants hold after: ${label}${bad.length ? " — " + bad.join("; ") : ""}`);
};

await db.exec(`insert into ai_product_balances (user_id, product, balance_cents, withdrawable_cents) values ('${C}', 'character_replace', 5000, 2000), ('${S(1)}', 'character_replace', 700, 0)`);
const aiBefore = await aiSnapshot();

// 1 · a successful settlement: access, earning, ledger
const r1 = await purchase(C, S(1));
const s1 = await settle(r1);
ok(s1.ok === true && !s1.duplicate, "1. a verified charge settles");
ok(await access(C, S(1)), "1. the subscriber has access");
ok((await bal(C)).a === 1000 && (await bal(C)).l === 1000, "1. the creator earns the PRICE (1000); the 100 fee is the platform's, on top");
await invariants(C, "settlement");

// 2-3 · duplicate and back-to-back settlement (webhook + return page + reconcile)
const dup = [await settle(r1), await settle(r1), await settle(r1)];
ok(dup.every((d) => d.ok && d.duplicate), "2/3. three more settles of the same reference: all 'duplicate'");
ok((await bal(C)).l === 1000 && (await one("select count(*)::int n from sub_ledger where kind = 'earning' and purchase_id = (select id from sub_purchases where reference = $1)", [r1])).n === 1, "2/3. one earning, one ledger row");
await invariants(C, "duplicate settlement");

// 4 · wrong amount or currency never grants access
const r4 = await purchase(C, S(2));
ok((await settle(r4, 164999)).reason === "amount_mismatch", "4. one kobo short: refused");
ok((await settle(r4, 165000, "USD")).reason === "amount_mismatch", "4. right number, wrong currency: refused");
ok(!(await access(C, S(2))) && (await one("select status from sub_purchases where reference = $1", [r4])).status === "initiated", "4. no access, purchase still open, nothing credited");
ok((await one("select count(*)::int n from financial_audit_log where action = 'sub_payment_mismatch' and reference = $1", [r4])).n === 2, "4. both mismatches are on the audit log");
ok((await settle("frenz_sub_never_issued")).reason === "not_found", "4. an unknown reference settles nothing (and is audited)");
await invariants(C, "mismatches");

// 6-7 · failed / abandoned, then a late success
const r6 = await purchase(C, S(3));
await db.exec(`update sub_purchases set status = 'failed', failure_source = 'verify_abandoned' where reference = '${r6}'`);
ok(!(await access(C, S(3))), "6. an abandoned checkout grants nothing");
const s7 = await settle(r6);
ok(s7.ok && s7.recovered === true && (await access(C, S(3))), "7. Paystack later verifies the charge: it settles (recovered) and access is granted");
const r6b = await purchase(C, S(4));
await db.exec(`update sub_purchases set status = 'failed', failure_source = 'provider_reversed' where reference = '${r6b}'`);
ok((await settle(r6b)).reason === "not_payable" && !(await access(C, S(4))), "6. a provider-final failure (refunded before settling) never settles");
await invariants(C, "late success");

// 8 · renewal: extends from the current end; its replay changes nothing
const endBefore = (await one("select period_end from creator_memberships where creator_id = $1 and member_id = $2", [C, S(1)])).period_end;
const r8 = await purchase(C, S(1));
await settle(r8);
const endAfter = (await one("select period_end from creator_memberships where creator_id = $1 and member_id = $2", [C, S(1)])).period_end;
ok(Math.round((new Date(endAfter) - new Date(endBefore)) / 86400000) === 30, "8. a renewal before expiry adds exactly 30 days to the current end");
await settle(r8);
ok((await one("select period_end from creator_memberships where creator_id = $1 and member_id = $2", [C, S(1)])).period_end.getTime() === new Date(endAfter).getTime(), "8. the renewal's replay adds nothing");
await invariants(C, "renewal");

// 10 · expiry: the access predicate is the period end
await db.exec(`update creator_memberships set period_end = now() - interval '1 minute' where creator_id = '${C}' and member_id = '${S(3)}'`);
ok(!(await access(C, S(3))), "10. after the period end there is no access");

// 13 · two withdrawals against one balance; the same key replayed
const bBefore = await bal(C);
const w1 = await withdraw(C, 1500, "same-key");
ok(w1.ok && w1.fee === 150 && w1.net === 1350, "13. a withdrawal holds its gross; fee 10% (150) and net (1350) are the server's");
const w1again = await withdraw(C, 1500, "same-key");
ok(w1again.ok && w1again.duplicate && w1again.id === w1.id, "13. the same idempotency key replayed: the same withdrawal");
const w2 = await withdraw(C, 500);
ok(!w2.ok && w2.reason === "open_exists", "13. a second open withdrawal on the same balance is refused");
ok((await bal(C)).h === 1500 && (await bal(C)).a === bBefore.a - 1500, "13. exactly one hold");
await invariants(C, "withdrawal hold");
ok(!(await withdraw(C, 0)).ok && !(await withdraw(C, -5)).ok, "17. zero and negative withdrawals are invalid");
ok((await withdraw(C2, 500)).reason === "insufficient", "19. a creator with no earnings can't withdraw (the user id is the only key; the app passes the session's)");

// 14 · rejection releases once; a duplicate rejection does nothing
const rej = await resolve(w1.id, "rejected");
ok(rej.ok, "14. the admin (or a failed transfer) rejects it");
const rej2 = await resolve(w1.id, "rejected");
ok(!rej2.ok && rej2.reason === "final", "14. rejecting it again is refused (final)");
ok((await bal(C)).h === 0 && (await bal(C)).a === bBefore.a, "14. the hold came back exactly once");
await invariants(C, "rejection");

// 15 · a payout, then a duplicate confirmation
const w3 = await withdraw(C, 1000);
await resolve(w3.id, "approved");
await resolve(w3.id, "processing");
const done1 = await resolve(w3.id, "completed");
const done2 = await resolve(w3.id, "completed");
ok(done1.ok && !done2.ok && done2.reason === "final", "15. a duplicate payout confirmation is refused");
ok((await bal(C)).w === 1000 && (await one("select count(*)::int n from sub_ledger where kind = 'withdrawal_paid' and withdrawal_id = $1", [w3.id])).n === 1, "15. withdrawn once, one ledger row");
ok(!(await resolve(w3.id, "rejected")).ok, "15. a completed payout can't be rejected afterwards (no double release)");
await invariants(C, "payout");

// 11-12 · refunds and disputes: full reversal, duplicate events, debt when the money already left
const r11 = await purchase(C, S(5));
await settle(r11);
const before11 = await bal(C);
const rv = await reverse(r11, "refunded");
ok(rv.ok, "11. a full refund reverses the purchase");
ok(!(await access(C, S(5))), "11. the refund takes the access back");
ok((await bal(C)).l === before11.l - 1000, "11. lifetime drops by the price");
const rv2 = [await reverse(r11, "refunded"), await reverse(r11, "disputed")];
ok(rv2.every((x) => x.ok && x.duplicate), "12. the same refund again, or a dispute on it: 'duplicate', nothing more");
ok((await one("select count(*)::int n from sub_ledger where kind = 'clawback' and purchase_id = (select id from sub_purchases where reference = $1)", [r11])).n === 1, "12. one clawback row");
await invariants(C, "refund + duplicates");
// all the money withdrawn, then a dispute: the shortfall becomes DEBT, never a negative balance
const w4 = await withdraw(C, (await bal(C)).a);
ok((await payOut(w4.id)).ok, "12. the payout completes through approved and processing");
const r12 = (await q("select reference from sub_purchases where creator_id = $1 and status = 'paid' order by created_at limit 1", [C]))[0].reference;
await reverse(r12, "disputed");
const b12 = await bal(C);
ok(b12.a === 0 && b12.d === 1000, "12. a dispute after the money left: available 0, debt 1000 (never negative)");
await invariants(C, "dispute into debt");
// the next earning pays the debt first
const r12b = await purchase(C, S(6));
await settle(r12b);
ok((await bal(C)).d === 0 && (await bal(C)).a === 0, "12. the next 1000 earning settles the 1000 debt first");
await invariants(C, "debt settled by next earning");
const rbefore = await reverse("frenz_sub_unknown", "refunded");
ok(!rbefore.ok && rbefore.reason === "not_found", "12. a refund for an unknown reference changes nothing");
ok((await reverse(r12b, "chargeback_lol")).reason === "invalid", "12. an unknown reversal kind is refused");

// a hold on the earnings (hold_days): pending until released, invariants on the way
const r16 = await purchase(C2, S(7), { hold: 3 });
await settle(r16);
ok((await bal(C2)).p === 1000 && (await bal(C2)).a === 0, "16. a held earning is pending, not withdrawable");
await invariants(C2, "held earning");
await reverse(r16, "refunded");
ok((await bal(C2)).p === 0 && (await bal(C2)).d === 0, "16. refunding an unreleased earning leaves no debt");
await invariants(C2, "refund of held earning");

// 21 · a payout the bank sent back (Part 12 follow-up, 0254): once, from completed only
await settle(await purchase(C, S(10), { price: 2000 }));
const bR = await bal(C);
const wR = await withdraw(C, 1500);
const wrong = await call("select reverse_paid_withdrawal($1::uuid, null, 'early') as r", [wR.id]);
ok(!wrong.ok && wrong.reason === "not_completed", "21. a withdrawal not yet paid can't be 'reversed' (rejection is its path)");
ok((await payOut(wR.id)).ok, "21. the payout completes");
const paidOut = await bal(C);
const rr1 = await call("select reverse_paid_withdrawal($1::uuid, null, 'Paystack transfer.reversed (verified)') as r", [wR.id]);
const rr2 = await call("select reverse_paid_withdrawal($1::uuid, null, 'again') as r", [wR.id]);
ok(rr1.ok && rr2.ok && rr2.duplicate, "21. the reversal applies once; a duplicate event answers 'duplicate'");
const afterR = await bal(C);
ok(afterR.a === paidOut.a + wR.gross && afterR.w === paidOut.w - wR.gross, "21. the gross is back in available, withdrawn falls by the same");
ok((await one("select count(*)::int n from sub_ledger where kind = 'withdrawal_reversed' and withdrawal_id = $1", [wR.id])).n === 1, "21. one ledger row for it");
ok(!(await resolve(wR.id, "completed")).ok && !(await resolve(wR.id, "rejected")).ok, "21. a reversed payout can't be completed or rejected afterwards");
await invariants(C, "payout reversed by the bank");
await db.exec(`insert into withdrawal_requests (user_id, credits, amount_usd_cents, status, source) values ('${S(8)}', 500, 100, 'completed', 'credits')`);
const credId = (await one("select id from withdrawal_requests where user_id = $1 and source = 'credits'", [S(8)])).id;
const cr = await call("select reverse_paid_withdrawal($1::uuid, null, 'x') as r", [credId]);
ok(!cr.ok && cr.reason === "manual" && (await one("select status from withdrawal_requests where id = $1", [credId])).status === "completed", "21. an AI-credit payout reversal is NOT applied here: audited for a manual return, nothing moved");

// 22 · a dispute the platform won (admin, 0254): once, debt first, access back
const r22 = await purchase(C2, S(9));
await settle(r22);
const w22 = await withdraw(C2, 1000);
ok((await payOut(w22.id)).ok, "22. setup payout completes");
await reverse(r22, "disputed");
ok((await bal(C2)).d === 1000 && !(await access(C2, S(9))), "22. setup: the dispute after the payout left debt 1000 and ended the access");
await invariants(C2, "dispute before restore");
ok((await call("select restore_disputed_sub_purchase($1, null, 'won') as r", [r22])).reason === "invalid", "22. no admin, no restore");
const rs1 = await call("select restore_disputed_sub_purchase($1, $2, 'Won in the Paystack dashboard') as r", [r22, U(19)]);
const rs2 = await call("select restore_disputed_sub_purchase($1, $2, 'again') as r", [r22, U(19)]);
ok(rs1.ok && rs2.ok && rs2.duplicate, "22. the restore applies once; a second click answers 'duplicate'");
const b22 = await bal(C2);
ok(b22.d === 0 && b22.a === 0, "22. the restored 1000 pays the 1000 debt first (nothing double-credited)");
ok(await access(C2, S(9)), "22. the access the payment bought is back (its period has not ended)");
ok((await one("select count(*)::int n from sub_ledger where kind = 'dispute_restore'")).n === 1, "22. one dispute_restore ledger row");
ok((await call("select restore_disputed_sub_purchase($1, $2, 'x') as r", [r12b, U(19)])).reason === "not_disputed", "22. a purchase that was never disputed can't be 'restored'");
await invariants(C2, "dispute won and restored");

// 23 · a payout the bank sent back while the creator OWES (a dispute after the payout): debt first
const C3 = U(3), C4 = U(4), C5 = U(5);
const r23 = await purchase(C3, S(11));
await settle(r23);
const w23 = await withdraw(C3, 1000);
ok((await payOut(w23.id)).ok, "23. setup: everything withdrawn and paid out");
await reverse(r23, "disputed");
ok((await bal(C3)).d === 1000, "23. setup: the dispute left debt 1000");
await call("select reverse_paid_withdrawal($1::uuid, null, 'bank returned it') as r", [w23.id]);
const b23 = await bal(C3);
ok(b23.d === 0 && b23.a === 0 && b23.w === 0, "23. the returned 1000 settles the 1000 debt: nothing withdrawable while owed");
ok(b23.l === 0, "23. lifetime earnings are not raised by a returned payout");
await invariants(C3, "payout reversal settles debt first");

// 24 · an AI-credit payout reversal is audited ONCE however often the event repeats
await call("select reverse_paid_withdrawal($1::uuid, null, 'x') as r", [credId]);
await call("select reverse_paid_withdrawal($1::uuid, null, 'x') as r", [credId]);
ok((await one("select count(*)::int n from financial_audit_log where action = 'withdrawal_reversal_manual' and target_id = $1", [credId])).n === 1, "24. three reversal events for an AI-credit payout: one audit row, nothing moved");

// 25 · restoring a disputed purchase gives back a LATER paid renewal's days too
const r25a = await purchase(C4, S(12));
await settle(r25a);
const r25b = await purchase(C4, S(12));
await settle(r25b);
const end25 = (await one("select period_end from sub_purchases where reference = $1", [r25b])).period_end.getTime();
await reverse(r25a, "disputed");
ok(await access(C4, S(12)), "25. setup: after the dispute the renewal's 30 days still give access");
await call("select restore_disputed_sub_purchase($1, $2, 'won') as r", [r25a, U(19)]);
const m25 = await one("select period_end, status, billing from creator_memberships where creator_id = $1 and member_id = $2", [C4, S(12)]);
ok(m25.period_end.getTime() === end25 && m25.status === "active", "25. restored up to the latest paid end (the renewal's), not the disputed purchase's own end");
await invariants(C4, "restore with a later renewal");

// 26 · a dispute on a refund_due purchase (paid to a removed member, never earned) can't be 'restored'
await db.exec(`insert into creator_memberships (creator_id, member_id, status, billing) values ('${C4}', '${S(13)}', 'removed', 'free')`);
const r26 = await purchase(C4, S(13));
await settle(r26);
ok((await one("select status from sub_purchases where reference = $1", [r26])).status === "refund_due", "26. setup: paid by a removed member -> refund_due, nothing earned");
await reverse(r26, "disputed");
const b26 = await bal(C4);
const rs26 = await call("select restore_disputed_sub_purchase($1, $2, 'won') as r", [r26, U(19)]);
ok(!rs26.ok && rs26.reason === "nothing_clawed_back", "26. restore refused: the dispute never took an earning back");
ok(JSON.stringify(await bal(C4)) === JSON.stringify(b26) && (await one("select status from creator_memberships where creator_id = $1 and member_id = $2", [C4, S(13)])).status === "removed", "26. no money minted, the removed member stays removed");
await invariants(C4, "refused restore of a never-earned purchase");

// 27 · an expired paid period gives no access back, and a free membership is never turned into an ended paid one
const r27 = await purchase(C5, S(14));
await settle(r27);
await reverse(r27, "disputed");
await db.exec(`update sub_purchases set period_start = now() - interval '60 days', period_end = now() - interval '30 days' where reference = '${r27}'`);
await db.exec(`update creator_memberships set billing = 'free', status = 'active', period_end = null, ended_at = null where creator_id = '${C5}' and member_id = '${S(14)}'`);
const rs27 = await call("select restore_disputed_sub_purchase($1, $2, 'won late') as r", [r27, U(19)]);
const m27 = await one("select status, billing, period_end from creator_memberships where creator_id = $1 and member_id = $2", [C5, S(14)]);
ok(rs27.ok && m27.billing === "free" && m27.status === "active" && m27.period_end === null, "27. the earning comes back, but an expired period changes no membership (the free one is untouched)");
await invariants(C5, "restore after the paid period ended");

// 28 · a REJECTED / CANCELLED withdrawal settles refund debt first (0256), once
const C6 = U(6), C7 = U(7), C8 = U(8), C9 = U(9);
const ret = (id) => one("select amount_cents::int a, available_after::int av, note from sub_ledger where kind = 'withdrawal_return' and withdrawal_id = $1", [id]);
const audited = async (id, action) => (await one("select details from financial_audit_log where action = $1 and target_id = $2 order by id desc limit 1", [action, id]))?.details;

// 28a · no debt: the whole gross comes back to available, lifetime untouched
await settle(await purchase(C6, S(15)));
const w28a = await withdraw(C6, 1000);
ok((await bal(C6)).h === 1000 && (await bal(C6)).a === 0, "28a. setup: 1000 held");
ok((await resolve(w28a.id, "rejected")).ok, "28a. rejected");
const b28a = await bal(C6);
ok(b28a.a === 1000 && b28a.h === 0 && b28a.d === 0 && b28a.l === 1000 && b28a.w === 0, "28a. no debt: 1000 back to available, lifetime still 1000 (no new earning)");
const r28a = await ret(w28a.id);
ok(r28a.a === 1000 && r28a.note === "Withdrawal rejected", "28a. one withdrawal_return row for the full gross, plain note");
await invariants(C6, "rejection with no debt");

// 28b · debt SMALLER than the released amount (cancelled, the same branch)
const p28b = await purchase(C7, S(16), { price: 500 });
await settle(p28b);
await settle(await purchase(C7, S(17), { price: 1000 }));
const w28b = await withdraw(C7, 1500);
await reverse(p28b, "disputed");
ok((await bal(C7)).d === 500 && (await bal(C7)).a === 0, "28b. setup: 1500 held, a dispute left debt 500");
ok((await resolve(w28b.id, "cancelled")).ok, "28b. cancelled");
const b28b = await bal(C7);
ok(b28b.d === 0 && b28b.a === 1000 && b28b.h === 0, "28b. debt 500 settled first, the other 1000 available");
ok((await ret(w28b.id)).a === 1500 && /500 cents/.test((await ret(w28b.id)).note) && (await audited(w28b.id, "withdrawal_cancelled")).debt_settled === 500, "28b. the ledger keeps the full 1500 released, the note and the audit name the 500 settled");
await invariants(C7, "cancellation with debt smaller than the release");

// 28c · debt EQUAL to the released amount
const p28c = await purchase(C8, S(18));
await settle(p28c);
const w28c = await withdraw(C8, 1000);
await reverse(p28c, "disputed");
ok((await bal(C8)).d === 1000, "28c. setup: 1000 held, debt 1000");
await resolve(w28c.id, "rejected");
const b28c = await bal(C8);
ok(b28c.d === 0 && b28c.a === 0 && b28c.h === 0 && b28c.l === 0, "28c. debt equal to the release: all of it settles the debt, nothing becomes withdrawable");
await invariants(C8, "rejection with debt equal to the release");

// 28d · debt GREATER than the released amount (an earlier payout already left)
const p28d = await purchase(C9, S(19));
await settle(p28d);
const w28d1 = await withdraw(C9, 1000);
ok((await payOut(w28d1.id)).ok, "28d. setup: 1000 paid out");
await settle(await purchase(C9, S(20), { price: 500 }));
const w28d2 = await withdraw(C9, 500);
await reverse(p28d, "disputed");
ok((await bal(C9)).d === 1000 && (await bal(C9)).h === 500, "28d. setup: 500 held, debt 1000");
await resolve(w28d2.id, "rejected");
const b28d = await bal(C9);
ok(b28d.d === 500 && b28d.a === 0 && b28d.h === 0, "28d. debt greater than the release: the 500 pays 500 of it, 500 still owed, nothing withdrawable");
await invariants(C9, "rejection with debt greater than the release");

// 28e · repeated rejection: once
const before28e = JSON.stringify(await bal(C6));
const again = [await resolve(w28a.id, "rejected"), await resolve(w28a.id, "cancelled")];
ok(again.every((r) => !r.ok && r.reason === "final") && JSON.stringify(await bal(C6)) === before28e, "28e. rejecting (or cancelling) again answers 'final' and moves nothing");
ok((await one("select count(*)::int n from sub_ledger where kind = 'withdrawal_return' and withdrawal_id = $1", [w28a.id])).n === 1, "28e. still one withdrawal_return row");
await invariants(C6, "repeated rejection");

// 28f · a PAID withdrawal can't be rejected (nor a reversed one)
const before28f = JSON.stringify(await bal(C9));
ok(!(await resolve(w28d1.id, "rejected")).ok && JSON.stringify(await bal(C9)) === before28f, "28f. rejecting a completed payout is refused, nothing released");
ok((await resolve(wR.id, "rejected")).reason === "final", "28f. a payout the bank returned (reversed) is final too");
await invariants(C9, "rejection after payout");

// 28g · rejection and payout confirmation BACK TO BACK (one PGlite connection: the second call sees the first's
// commit; in production the withdrawal row lock serialises them the same way)
await settle(await purchase(C6, S(21)));
const w28g = await withdraw(C6, 1000);
await resolve(w28g.id, "approved");
await resolve(w28g.id, "processing");
const first = await resolve(w28g.id, "completed");
const second = await resolve(w28g.id, "rejected");
ok(first.ok && !second.ok && second.reason === "final", "28g. paid first: the rejection is refused");
const b28g = await bal(C6);
ok(b28g.w === 1000 && b28g.h === 0, "28g. the money is withdrawn once, never also released");
await invariants(C6, "payout then rejection, back to back");

// 29 · the flat withdrawal fee (0258): on top of the amount, the balance must cover both, and it moves with the rest
const C10 = U(10);
await settle(await purchase(C10, S(22)));
const flatW = (gross, flat, k) => call("select request_sub_withdrawal($1, $2, 1000, 500, 'paystack', '{}'::jsonb, '{}'::jsonb, $3, false, $4) as r", [C10, gross, k, flat]);
const tooMuch = await flatW(1000, 20, "flat-1");
ok(!tooMuch.ok && tooMuch.reason === "insufficient" && (await bal(C10)).a === 1000, "29. 1000 available, 1000 + a 20 flat fee asked: refused, nothing held");
const fw = await flatW(980, 20, "flat-2");
const fwRow = await one("select gross_cents, fee_cents, net_cents, amount_usd_cents from withdrawal_requests where id = $1", [fw.id]);
ok(fw.ok && fwRow.gross_cents === 1000 && fwRow.net_cents === 882 && fwRow.fee_cents === 118 && fwRow.amount_usd_cents === 882, "29. 980 + 20 flat: 1000 leaves the balance; payout 882 (980 less 10%); fee 98 + 20");
ok((await bal(C10)).a === 0 && (await bal(C10)).h === 1000, "29. the whole 1000 (amount + flat fee) is held");
await invariants(C10, "withdrawal with a flat fee held");
await resolve(fw.id, "rejected");
ok((await bal(C10)).a === 1000 && (await bal(C10)).h === 0, "29. rejected: all 1000 returns, the flat fee too");
await invariants(C10, "flat-fee withdrawal rejected");
const fw2 = await flatW(980, 20, "flat-3");
await payOut(fw2.id);
ok((await bal(C10)).w === 1000 && (await bal(C10)).a === 0, "29. paid: withdrawn counts the 1000 that left the balance");
await invariants(C10, "flat-fee withdrawal paid");
const below = await flatW(400, 20, "flat-4");
ok(!below.ok && (below.reason === "below_minimum" || below.reason === "insufficient"), "29. the minimum (500) still applies to the amount itself");
const legacy = await call("select request_sub_withdrawal($1, 500, 1000, 500, 'paystack', '{}'::jsonb, '{}'::jsonb, 'flat-5', false) as r", [U(11)]);
ok(legacy && legacy.ok === false, "29. a caller that sends no flat fee still resolves to the one function (default 0)");
ok((await one("select count(*)::int n from pg_proc where proname = 'request_sub_withdrawal'")).n === 1, "29. exactly one request_sub_withdrawal exists (the 9-argument one was dropped)");

// 18-19 · clients can't run the money functions or write the money tables (Supabase grants + RLS)
const availBefore = (await bal(C)).a;
await db.exec(`set role authenticated; select set_config('test.uid', '${C}', false)`);
ok(await throws(`select settle_sub_purchase('${r4}', 165000, 'NGN', 'x')`), "18. a signed-in user can't call settle_sub_purchase");
ok(await throws(`select request_sub_withdrawal('${C}', 100, 0, 0, 'paystack', '{}', '{}', 'k', false)`), "18. ...nor request_sub_withdrawal directly");
ok(await throws(`select resolve_withdrawal('${w3.id}', 'rejected', null, null, null)`), "18. ...nor resolve_withdrawal");
ok(await throws(`select reverse_sub_purchase('${r1}', 'refunded', null, null)`), "18. ...nor reverse_sub_purchase");
ok(await throws(`select reverse_paid_withdrawal('${w3.id}', null, 'x')`), "18. ...nor reverse_paid_withdrawal (0254)");
ok(await throws(`select restore_disputed_sub_purchase('${r1}', '${C}', 'x')`), "18. ...nor restore_disputed_sub_purchase (0254)");
await db.exec(`update sub_balances set available_cents = 999999 where creator_id = '${C}'`); // RLS: no update policy, so 0 rows
ok(await throws(`insert into sub_ledger (creator_id, kind, amount_cents, pending_after, available_after, reference) values ('${C}', 'earning', 5, 0, 0, 'x')`), "18. ...nor write the ledger (RLS: no insert policy)");
ok(await throws(`insert into sub_purchases (creator_id, subscriber_id, price_cents, fee_cents, total_cents, fee_bp, charged_currency, charged_minor, reference, status) values ('${C2}', '${C}', 1, 0, 1, 0, 'NGN', 1, 'forged', 'paid')`), "18. ...nor forge a paid purchase");
ok((await q("select * from sub_balances where creator_id = $1", [C2])).length === 0, "19. a creator can't even read another creator's balance");
await db.exec("reset role");
ok((await bal(C)).a === availBefore, "18. ...nor change their own balance (the update matched no row under RLS)");

// 17 · a self-subscription is impossible
ok(await throws(`insert into sub_purchases (creator_id, subscriber_id, price_cents, fee_cents, total_cents, fee_bp, charged_currency, charged_minor, reference) values ('${C}', '${C}', 1000, 100, 1100, 1000, 'NGN', 1, 'self')`), "17. a creator can't buy their own subscription");

// 20 · none of it touched the AI wallet
ok((await aiSnapshot()) === aiBefore, "20. after every Exclusive settlement, refund, withdrawal and payout, AI balances and the AI ledger are unchanged");

console.log(failures ? `\n${failures} FAILED` : "\nALL OK");
process.exit(failures ? 1 : 0);
