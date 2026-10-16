// PGlite harness for 0247 (Frenz Exclusive Part 2). Run from %TEMP%\pgt:
//   node t0247.mjs <repo>/supabase/migrations [scratch-0247.sql] [--mutant] [--no-0239]
// Applies 0227, 0231, 0237, (0239), then 0247 TWICE, and checks the money functions' behaviour.
// --mutant re-installs 0227's settle_sub_purchase after 0247: the recovery checks must FAIL.
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const dir = process.argv[2];
const m0247 = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : `${dir}/0247_sub_settlement_hardening.sql`;
const MUTANT = process.argv.includes("--mutant");
const NO_0239 = process.argv.includes("--no-0239");

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
create table public.creator_notification_prefs (viewer_id uuid, target_id uuid);`;
// statement splitter: ';' ends a statement only outside $$ bodies, quotes and -- comments
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
await db.exec(`insert into auth.users (id) select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid from generate_series(1, 9) g`);
for (const f of ["0227_sub_monetization.sql", "0231_sub_promo_dismiss.sql", "0237_sub_post_thumbs.sql", ...(NO_0239 ? [] : ["0239_private_post_interactions.sql"])]) await run(db, readFileSync(`${dir}/${f}`, "utf8"));
// existing rows BEFORE 0247 (an older failed row with no failure_source, an old report)
const C = U(1);
const ins = (ref, sub, extra = "") => db.exec(`insert into sub_purchases (creator_id, subscriber_id, price_cents, fee_cents, total_cents, fee_bp, charged_currency, charged_minor, reference${extra ? ", " + extra.split("=")[0] : ""}) values ('${C}', '${sub}', 1000, 100, 1100, 1000, 'NGN', 165000, '${ref}'${extra ? ", " + extra.split("=")[1] : ""})`);
await ins("legacy_failed", U(8), "status='failed'");
await db.exec(`insert into reports (reporter_id, target_type, target_id, reason) values ('${U(2)}', 'post', '${U(9)}', 'Spam')`);

const sql0247 = readFileSync(m0247, "utf8");
await run(db, sql0247);
await run(db, sql0247); // idempotent
if (MUTANT) {
  const old = readFileSync(`${dir}/0227_sub_monetization.sql`, "utf8");
  const start = old.indexOf("create or replace function public.settle_sub_purchase");
  const end = old.indexOf("$$;", old.indexOf("$$", old.indexOf("$$", start) + 2)) + 3;
  await run(db, old.slice(start, end));
}

const q = async (s, p) => (await db.query(s, p)).rows;
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; console.log("FAIL:", m); } else console.log("ok:", m); };
const settle = async (ref, amt = 165000, cur = "NGN") => (await q(`select settle_sub_purchase($1, $2, $3, 'prov') r`, [ref, amt, cur]))[0].r;
const reverse = async (ref, st = "refunded") => (await q(`select reverse_sub_purchase($1, $2, null, 'test') r`, [ref, st]))[0].r;
const status = async (ref) => (await q(`select status, failure_source from sub_purchases where reference=$1`, [ref]))[0];
const member = async (sub) => (await q(`select status, period_end > now() as live from creator_memberships where creator_id=$1 and member_id=$2`, [C, sub]))[0];
const audits = async (action, ref) => Number((await q(`select count(*)::int n from financial_audit_log where action=$1 and coalesce(reference,'')=$2`, [action, ref]))[0].n);
const ledger = async (ref) => Number((await q(`select count(*)::int n from sub_ledger l join sub_purchases p on p.id=l.purchase_id where p.reference=$1 and l.kind='earning'`, [ref]))[0].n);

// 1 · a checkout the app marked failed while still open settles from a later verified charge
await ins("p_abandoned", U(2), "status, failure_source='failed', 'verify_abandoned'");
let r = await settle("p_abandoned");
ok(r.ok === true && r.recovered === true, "app-assigned verify_abandoned failure recovers on a verified charge");
ok((await member(U(2)))?.live === true, "the recovered payment grants access");
ok((await audits("sub_purchase_recovered", "p_abandoned")) === 1, "the recovery is audited");
// legacy row (failed, no failure_source, from before 0247)
r = await settle("legacy_failed");
ok(r.ok === true, "an older failed row with no failure_source recovers on a verified charge");

// 2 · duplicate settlement never duplicates money
const lifetime = async () => Number((await q(`select lifetime_cents from sub_balances where creator_id=$1`, [C]))[0]?.lifetime_cents ?? 0);
const before = await lifetime();
r = await settle("p_abandoned");
ok(r.ok === true && r.duplicate === true, "a second settle answers duplicate");
ok((await ledger("p_abandoned")) === 1, "one earning ledger row, not two");
ok((await lifetime()) === before, "balance unchanged by the duplicate");

// 3 · wrong amount or currency never settles, and is audited
await ins("p_short", U(3));
r = await settle("p_short", 100000);
ok(r.ok === false && r.reason === "amount_mismatch", "a short payment is refused");
r = await settle("p_short", 165000, "USD");
ok(r.ok === false && r.reason === "amount_mismatch", "a foreign currency is refused");
ok((await audits("sub_payment_mismatch", "p_short")) === 2, "both mismatches audited");
ok((await status("p_short")).status === "initiated" && !(await member(U(3))), "no access, row untouched");
// a recoverable failed row is held to the same amount rule
await ins("p_short_failed", U(3), "status, failure_source='failed', 'verify_failed'");
r = await settle("p_short_failed", 1);
ok(r.ok === false && r.reason === "amount_mismatch", "recovery still requires the quoted amount");

// 4 · a reversed purchase can never be reactivated
r = await reverse("p_abandoned");
ok(r.ok === true && (await status("p_abandoned")).status === "refunded", "refund reverses a paid purchase");
r = await settle("p_abandoned");
ok(r.ok === false && r.reason === "not_payable", "a refunded purchase cannot settle again");
ok((await audits("sub_settle_refused", "p_abandoned")) === 1, "the refused settle is audited");
await ins("p_prov_rev", U(4), "status, failure_source='failed', 'provider_reversed'");
r = await settle("p_prov_rev");
ok(r.ok === false && r.reason === "not_payable", "a Paystack-reversed failure is final");

// a refund before the purchase settled makes it final
await ins("p_early_refund", U(4));
r = await reverse("p_early_refund");
ok(r.ok === true && r.unpaid === true, "refund before settlement answers unpaid");
ok((await status("p_early_refund")).failure_source === "reversal_before_payment", "and marks it final");
r = await settle("p_early_refund");
ok(r.ok === false && r.reason === "not_payable", "it can never settle afterwards");
ok((await audits("sub_reversal_before_settlement", "p_early_refund")) === 1, "audited");

// 5 · a removed membership is not reactivated by an old checkout
await db.exec(`insert into creator_memberships (creator_id, member_id, status, billing, ended_at) values ('${C}', '${U(5)}', 'removed', 'sub', now())`);
await ins("p_removed", U(5));
const lifetimeBefore = await lifetime();
r = await settle("p_removed");
ok(r.ok === false && r.reason === "removed", "settle refuses a removed member");
ok((await status("p_removed")).status === "refund_due", "the charge is recorded as refund_due");
ok((await member(U(5))).status === "removed", "membership stays removed");
ok((await ledger("p_removed")) === 0 && (await lifetime()) === lifetimeBefore, "the creator earns nothing from it");
ok((await audits("sub_payment_after_removal", "p_removed")) === 1, "the refund owed is audited");
r = await settle("p_removed");
ok(r.reason === "removed" && r.duplicate === true && (await audits("sub_payment_after_removal", "p_removed")) === 1, "a repeat is a quiet duplicate");
r = await reverse("p_removed");
ok(r.ok === true && r.refund_due_closed === true && (await status("p_removed")).status === "refunded", "the admin's Paystack refund closes it");
ok((await lifetime()) === lifetimeBefore, "closing it moves no money");
// a paid member who is removed, then refunded, stays removed (could re-subscribe before 0247)
await ins("p_paid_then_removed", U(6));
await settle("p_paid_then_removed");
await db.exec(`update creator_memberships set status='removed', ended_at=now() where member_id='${U(6)}'`);
await reverse("p_paid_then_removed");
ok((await member(U(6))).status === "removed", "a refund never turns 'removed' into 'ended'");

// 6 · unknown references are audited, never settled
r = await settle("p_nowhere");
ok(r.ok === false && r.reason === "not_found" && (await audits("sub_settle_refused", "p_nowhere")) === 1, "an unknown reference is refused and audited");

// 7 · constraints and the report targets
let threw = false;
try { await db.exec(`update sub_purchases set status='bogus' where reference='p_short'`); } catch { threw = true; }
ok(threw, "status check still refuses unknown states");
threw = false;
try { await db.exec(`update sub_purchases set failure_source='whatever' where reference='p_short'`); } catch { threw = true; }
ok(threw, "failure_source check refuses unknown sources");
for (const t of ["post", "comment", "user", "sub_post", "sub_comment"]) await db.exec(`insert into reports (reporter_id, target_type, target_id, reason) values ('${U(3)}', '${t}', gen_random_uuid(), 'x')`);
ok(true, "every old report type and both new ones are accepted");
threw = false;
try { await db.exec(`insert into reports (reporter_id, target_type, target_id, reason) values ('${U(3)}', 'wallpaper', gen_random_uuid(), 'x')`); } catch { threw = true; }
ok(threw, "an unknown report type is still refused");
ok(Number((await q(`select count(*)::int n from reports where target_type='post'`))[0].n) >= 1, "the pre-existing report survived");

// 8 · grants and policies unchanged
for (const fn of ["settle_sub_purchase(text, bigint, text, text)", "reverse_sub_purchase(text, text, uuid, text)"]) {
  for (const role of ["anon", "authenticated"]) ok(!(await q(`select has_function_privilege('${role}', 'public.${fn}', 'execute') v`))[0].v, `${role} cannot execute ${fn.split("(")[0]}`);
  ok((await q(`select has_function_privilege('service_role', 'public.${fn}', 'execute') v`))[0].v, `service_role can execute ${fn.split("(")[0]}`);
}
const pol = await q(`select tablename, policyname, cmd from pg_policies where schemaname='public' and tablename in ('sub_posts','creator_memberships','sub_purchases','sub_balances','sub_ledger','financial_audit_log','sub_post_media','sub_post_likes','sub_post_comments','sub_payout_accounts') order by 1`);
const want = { sub_posts: "sub posts owner", creator_memberships: "creator memberships parties read", sub_purchases: "sub purchases parties read", sub_balances: "sub balances owner read", sub_ledger: "sub ledger owner read", financial_audit_log: "financial audit admin read" };
for (const [t, name] of Object.entries(want)) ok(pol.filter((p) => p.tablename === t).length === 1 && pol.find((p) => p.tablename === t)?.policyname === name && pol.find((p) => p.tablename === t)?.cmd === "SELECT", `${t}: only "${name}" (SELECT)`);
for (const t of ["sub_post_media", "sub_post_likes", "sub_post_comments", "sub_payout_accounts"]) ok(!pol.some((p) => p.tablename === t), `${t}: no client policy`);
const cols = await q(`select column_name from information_schema.columns where table_name in ('sub_posts','sub_post_comments') and column_name in ('moderated_at','moderated_by','hidden_at','hidden_by')`);
ok(cols.length === (NO_0239 ? 2 : 4), "moderation columns present");

console.log(failures ? `\n${failures} FAILED${MUTANT ? " (expected under --mutant)" : ""}` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
