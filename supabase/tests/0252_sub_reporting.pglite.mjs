// PGlite harness for 0252 (Frenz Exclusive Part 7). Run from %TEMP%\pgt:
//   node t0252.mjs <repo>/supabase/migrations [path-to-0252.sql] [--mutant]
// Applies 0227, 0237, 0239, 0247, 0248, 0250, then 0252 TWICE. Data is made by the REAL settle and reverse
// functions; every aggregate is checked against a hand-computed answer.
// --mutant applies a broken 0252 (refund_due counted as settled, every purchase "new", grants left open).
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const dir = process.argv[2];
const file = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : `${dir}/0252_sub_reporting.sql`;
const MUTANT = process.argv.includes("--mutant");
const stub = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create function public.is_admin() returns boolean language sql stable as $$ select false $$;
create table public.notifications (id bigint generated always as identity primary key, user_id uuid, actor_id uuid, type text, data jsonb, post_id uuid, created_at timestamptz default now());
create table public.reward_profiles (user_id uuid primary key, qualification_status text, qualified_at timestamptz, restricted boolean default false, qualification_reviewed_by uuid);
create table public.withdrawal_requests (id uuid primary key default gen_random_uuid(), user_id uuid, credits integer not null default 0, amount_usd_cents integer not null default 0, rate_snapshot jsonb, status text, payout_method text, payout_details jsonb, review_note text, reviewed_by uuid, payout_reference text, created_at timestamptz default now(), updated_at timestamptz default now(), completed_at timestamptz);
create table public.reports (id uuid primary key default gen_random_uuid(), reporter_id uuid, target_type text not null, target_id uuid not null, reason text not null, note text, status text not null default 'open', created_at timestamptz not null default now(), constraint reports_target_chk check (target_type in ('post','comment','user')));`;
const split = (sql) => { const out = []; let cur = ""; let inD = false; let inQ = false;
  for (let i = 0; i < sql.length; i++) {
    if (!inQ && sql.startsWith("$$", i)) { inD = !inD; cur += "$$"; i++; continue; }
    if (!inD && sql[i] === "'") inQ = !inQ;
    if (!inD && !inQ && sql.startsWith("--", i)) { const nl = sql.indexOf("\n", i); i = nl < 0 ? sql.length : nl; cur += "\n"; continue; }
    if (sql[i] === ";" && !inD && !inQ) { if (cur.trim()) out.push(cur); cur = ""; } else cur += sql[i]; }
  if (cur.trim()) out.push(cur); return out; };
const run = async (db, sql) => { for (const s of split(sql)) { try { await db.exec(s); } catch (e) { console.log("SQL ERROR:", e.message, "\n", s.slice(0, 200)); process.exit(2); } } };

const db = new PGlite();
await run(db, stub);
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A = U(1), B = U(2), S1 = U(11), S2 = U(12), S3 = U(13), S4 = U(14);
await db.exec(`insert into auth.users (id) values ${[A, B, S1, S2, S3, S4].map((u) => `('${u}')`).join(",")}`);
for (const f of ["0227_sub_monetization.sql", "0237_sub_post_thumbs.sql", "0239_private_post_interactions.sql", "0247_sub_settlement_hardening.sql", "0248_sub_post_audience_feed.sql", "0250_sub_membership_lifecycle.sql"]) await run(db, readFileSync(`${dir}/${f}`, "utf8"));

let sql = readFileSync(file, "utf8");
if (MUTANT) sql = sql.slice(0, sql.indexOf("do $$")).replaceAll("p.status <> 'refund_due'", "true").replaceAll(") as is_new", ") or true as is_new");
await run(db, sql);
await run(db, sql);

const q = async (s, p) => (await db.query(s, p)).rows;
let failures = 0;
const ok = (c, m, got) => { if (!c) { failures++; console.log("FAIL:", m, got === undefined ? "" : JSON.stringify(got)); } else console.log("ok:", m); };
let n = 0;
// a purchase settled by the REAL function, then optionally back-dated (paid_at and its ledger row together)
const buy = async (creator, sub, { price = 1000, fee = 100, cur = "NGN", minor = 165000, daysAgo = 0 } = {}) => {
  const ref = `frenz_sub_${String(++n).padStart(32, "0")}`;
  await db.exec(`insert into sub_purchases (creator_id, subscriber_id, price_cents, fee_cents, total_cents, fee_bp, charged_currency, charged_minor, reference, period_days, hold_days) values ('${creator}', '${sub}', ${price}, ${fee}, ${price + fee}, 1000, '${cur}', ${minor}, '${ref}', 30, 0)`);
  const r = (await q(`select public.settle_sub_purchase($1, $2, $3, 'x') r`, [ref, minor, cur]))[0].r;
  if (daysAgo) {
    await db.exec(`update sub_purchases set paid_at = now() - interval '${daysAgo} days', created_at = now() - interval '${daysAgo} days' where reference = '${ref}'`);
    await db.exec(`update sub_ledger set created_at = now() - interval '${daysAgo} days' where reference = 'purchase:' || (select id from sub_purchases where reference = '${ref}')::text`);
  }
  return { ref, r };
};

// ── creator A: S1 new long ago (outside 30 days), S1 renewal, S2 new (USD), S3 new then refunded ──
await buy(A, S1, { daysAgo: 60 });
await buy(A, S1, { daysAgo: 5 });
await buy(A, S2, { cur: "USD", minor: 1100, daysAgo: 3 });
const refunded = await buy(A, S3, { price: 2000, fee: 200, minor: 330000, daysAgo: 2 });
await q(`select public.reverse_sub_purchase($1, 'refunded', null, 'test')`, [refunded.ref]);
// S4: a payment that arrived after removal (refund_due) — earns nothing, is not "settled"
await db.exec(`insert into creator_memberships (creator_id, member_id, status, billing, price_cents, period_end) values ('${A}', '${S4}', 'removed', 'sub', 1000, now() + interval '5 days')`);
const due = await buy(A, S4, { minor: 999999 });
ok(due.r.reason === "removed", "a payment after removal becomes refund_due (0247, unchanged)");
// an unfinished checkout — never counted
await db.exec(`insert into sub_purchases (creator_id, subscriber_id, price_cents, fee_cents, total_cents, fee_bp, charged_currency, charged_minor, reference, period_days, hold_days) values ('${A}', '${S2}', 1000, 100, 1100, 1000, 'NGN', 165000, 'frenz_sub_open000000000000000000000000', 30, 0)`);
// creator B: one purchase that must never appear in A's numbers
await buy(B, S1, { price: 5000, fee: 500, minor: 825000, daysAgo: 1 });
// cancellation for S2 (standing, current period)
await db.exec(`update creator_memberships set cancelled_at = now() - interval '1 day', cancel_period = period_index where creator_id = '${A}' and member_id = '${S2}'`);
// withdrawals for A
await db.exec(`insert into withdrawal_requests (user_id, source, status, gross_cents, fee_cents, net_cents, amount_usd_cents, created_at, completed_at) values
  ('${A}', 'sub', 'completed', 500, 50, 450, 450, now() - interval '4 days', now() - interval '3 days'),
  ('${A}', 'sub', 'pending', 300, 30, 270, 270, now() - interval '1 day', null)`);

const since30 = `now() - interval '30 days'`;
const before = (await q(`select (select count(*) from sub_ledger)::int l, (select count(*) from sub_purchases)::int p, (select sum(available_cents)::int from sub_balances) b`))[0];
const s = (await q(`select public.sub_creator_summary('${A}', ${since30}) s`))[0].s;
const after = (await q(`select (select count(*) from sub_ledger)::int l, (select count(*) from sub_purchases)::int p, (select sum(available_cents)::int from sub_balances) b`))[0];

// earnings: S1 renewal 1000 + S2 1000 + S3 2000 (the refund is a separate clawback) — S1's first purchase is outside 30 days
ok(Number(s.earned_cents) === 4000, "earned in the period = the ledger's earnings in the period (USD cents)", s.earned_cents);
ok(Number(s.clawed_cents) === 2000, "clawed back = the refunded purchase's price", s.clawed_cents);
ok(Number(s.renewals) === 1 && Number(s.new_subs) === 2, "S1's second purchase is a renewal; S2 and S3 are new (S1's first purchase made it a renewal even from outside the period)", { n: s.new_subs, r: s.renewals });
ok(s.gross_by_currency.NGN === 165000 + 330000 && s.gross_by_currency.USD === 1100 && Object.keys(s.gross_by_currency).length === 2, "what subscribers paid stays per currency, never summed across NGN and USD", s.gross_by_currency);
ok(!JSON.stringify(s.gross_by_currency).includes("999999"), "the refund_due payment is not counted as settled");
ok(Number(s.refunds) === 1, "one refund in the period", s.refunds);
ok(Number(s.cancellations) === 1, "one standing cancellation", s.cancellations);
ok(Number(s.ending_now) === 1, "one subscriber paid up but ending (cancelled for the current period)", s.ending_now);
ok(Number(s.withdrawals_requested) === 2 && Number(s.withdrawals_requested_cents) === 800, "withdrawals requested in the period (gross)", s);
ok(Number(s.withdrawals_completed) === 1 && Number(s.withdrawals_completed_net_cents) === 450, "completed withdrawals (net paid)", s);
ok(JSON.stringify(before) === JSON.stringify(after), "reading the summary writes nothing (no ledger, purchase or balance change)");

// the period boundary: a 4-day window drops S1's renewal (5 days ago)
const s4 = (await q(`select public.sub_creator_summary('${A}', now() - interval '4 days') s`))[0].s;
ok(Number(s4.earned_cents) === 3000 && Number(s4.renewals) === 0 && Number(s4.new_subs) === 2, "a shorter period excludes what fell before it", s4);

// daily: zero-filled, and the days add up to the summary
const days = await q(`select * from public.sub_creator_daily('${A}', ${since30})`);
ok(days.length === 31, "31 UTC days for a 30-day window, zero-filled", days.length);
ok(days.reduce((t, d) => t + Number(d.earned_cents), 0) === 4000 && days.reduce((t, d) => t + Number(d.clawed_cents), 0) === 2000, "daily earnings and clawbacks add up to the summary");
ok(days.reduce((t, d) => t + Number(d.new_subs), 0) === 2 && days.reduce((t, d) => t + Number(d.renewals), 0) === 1, "daily new/renewal counts add up to the summary");

// creator B sees only B
const sb = (await q(`select public.sub_creator_summary('${B}', ${since30}) s`))[0].s;
ok(Number(sb.earned_cents) === 5000 && sb.gross_by_currency.NGN === 825000 && Number(sb.new_subs) === 1, "another creator's summary holds only their own money", sb);

// admin
const a = (await q(`select public.sub_admin_summary(${since30}) s`))[0].s;
ok(Number(a.creator_share_cents) === 1000 + 1000 + 2000 + 5000, "admin: creator share of purchases settled in the period", a.creator_share_cents);
ok(Number(a.platform_fee_cents) === 100 + 100 + 200 + 500, "admin: platform fee of purchases settled in the period", a.platform_fee_cents);
ok(a.gross_by_currency.NGN === 165000 + 330000 + 825000 && a.gross_by_currency.USD === 1100, "admin: gross per currency", a.gross_by_currency);
ok(Number(a.refunds) === 1 && Number(a.refunded_creator_cents) === 2000, "admin: refunds in the period", a);
ok(Number(a.refund_due_open) === 1, "admin: one payment owed back (refund_due)", a.refund_due_open);
ok(Number(a.withdrawals_open) === 1 && Number(a.withdrawals_open_cents) === 300, "admin: open withdrawals", a);
ok(Number(a.new_subs) === 3 && Number(a.renewals) === 1, "admin: new and renewal across creators", { n: a.new_subs, r: a.renewals });

// permissions
const fx = await q(`select proname, prosecdef, has_function_privilege('authenticated', oid, 'execute') auth, has_function_privilege('anon', oid, 'execute') anon from pg_proc where proname in ('sub_creator_summary','sub_creator_daily','sub_admin_summary')`);
ok(fx.length === 3 && fx.every((f) => !f.auth && !f.anon), "no client role can execute the reporting functions", fx);
ok(fx.every((f) => !f.prosecdef), "they run as the caller (security invoker), never with elevated rights");
const idx = await q(`select indexname from pg_indexes where indexname in ('sub_purchases_pair_paid_idx','sub_purchases_paid_idx','sub_purchases_reversed_idx','sub_ledger_creator_kind_idx')`);
ok(idx.length === 4, "the four indexes exist");
const pol = await q(`select tablename, policyname from pg_policies where tablename in ('sub_purchases','sub_ledger','sub_balances') order by 1`);
ok(pol.map((p) => `${p.tablename}:${p.policyname}`).join() === "sub_balances:sub balances owner read,sub_ledger:sub ledger owner read,sub_purchases:sub purchases parties read", "money-table policies unchanged", pol);

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
