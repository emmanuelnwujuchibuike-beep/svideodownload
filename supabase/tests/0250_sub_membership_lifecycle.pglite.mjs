// PGlite harness for 0250 (Frenz Exclusive Part 5). Run from %TEMP%\pgt:
//   node t0250.mjs <repo>/supabase/migrations [path-to-0250.sql] [--mutant]
// Applies 0227, 0237, 0239, 0247, 0248, inserts memberships that exist BEFORE 0250, applies 0250 TWICE,
// then drives the REAL settle_sub_purchase / reverse_sub_purchase around a cancellation.
// --mutant applies a broken 0250 (no reminder primary key, no checks): the dedupe and check cases must FAIL.
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const dir = process.argv[2];
const file = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : `${dir}/0250_sub_membership_lifecycle.sql`;
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
const C = U(1), S = U(2), R = U(3), X = U(4);
await db.exec(`insert into auth.users (id) values ('${C}'), ('${S}'), ('${R}'), ('${X}')`);
for (const f of ["0227_sub_monetization.sql", "0237_sub_post_thumbs.sql", "0239_private_post_interactions.sql", "0247_sub_settlement_hardening.sql", "0248_sub_post_audience_feed.sql"]) await run(db, readFileSync(`${dir}/${f}`, "utf8"));
// rows that exist before 0250: an active subscriber, a removed one, a free member
await db.exec(`insert into creator_memberships (creator_id, member_id, status, billing, price_cents, period_index, period_end) values
  ('${C}', '${S}', 'active', 'sub', 1000, 1, now() + interval '20 days'),
  ('${C}', '${R}', 'removed', 'sub', 1000, 1, now() + interval '20 days'),
  ('${C}', '${X}', 'active', 'free', 0, 0, null)`);

let sql = readFileSync(file, "utf8");
if (MUTANT) sql = sql.slice(0, sql.indexOf("do $$")).replace(/,\s*primary key \(membership_id, period_index, kind\)/, "");
await run(db, sql);
await run(db, sql);

const q = async (s, p) => (await db.query(s, p)).rows;
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; console.log("FAIL:", m); } else console.log("ok:", m); };
const throws = async (s) => { try { await db.exec(s); return false; } catch { return true; } };
const member = async (id) => (await q(`select * from creator_memberships where creator_id = '${C}' and member_id = '${id}'`))[0];
let n = 0;
const purchase = async (sub, status = "initiated") => {
  const ref = `frenz_sub_${String(++n).padStart(32, "0")}`;
  await db.exec(`insert into sub_purchases (creator_id, subscriber_id, price_cents, fee_cents, total_cents, fee_bp, charged_currency, charged_minor, reference, period_days, hold_days, status) values ('${C}', '${sub}', 1000, 100, 1100, 1000, 'NGN', 165000, '${ref}', 30, 0, '${status}')`);
  return ref;
};
const settle = async (ref) => (await q(`select public.settle_sub_purchase($1, 165000, 'NGN', 'x') r`, [ref]))[0].r;
const reverse = async (ref) => (await q(`select public.reverse_sub_purchase($1, 'refunded', null, 'test') r`, [ref]))[0].r;

// ── existing rows ────────────────────────────────────────────────────────────
ok((await q(`select count(*)::int n from creator_memberships where cancelled_at is not null or cancel_period is not null`))[0].n === 0, "every membership that existed before 0250 is not cancelled");

// ── the check ────────────────────────────────────────────────────────────────
ok(await throws(`update creator_memberships set cancelled_at = now() where member_id = '${S}'`), "a cancellation without its period is refused");
ok(await throws(`update creator_memberships set cancel_period = 1 where member_id = '${S}'`), "a period without a cancellation time is refused");

// ── cancel keeps access, and a renewal makes the intent stale ───────────────
const before = await member(S);
await db.exec(`update creator_memberships set cancelled_at = now(), cancel_period = period_index where member_id = '${S}' and creator_id = '${C}'`);
const cancelled = await member(S);
ok(cancelled.status === "active" && +cancelled.period_end === +before.period_end, "cancelling changes neither status nor period_end");
ok(cancelled.cancel_period === cancelled.period_index, "the intent belongs to the current period");
const renew = await purchase(S);
const rs = await settle(renew);
ok(rs.ok === true, "a verified renewal of a cancelled subscription settles");
const renewed = await member(S);
ok(renewed.period_index === cancelled.period_index + 1, "settlement moves period_index on (0247, unchanged)");
ok(renewed.cancel_period !== renewed.period_index, "so the old cancellation is stale: the renewed period is not cancelled");
ok(Math.abs(+renewed.period_end - (+before.period_end + 30 * 86400000)) < 5000, "a renewal before expiry extends from the old end, not from now (no lost days, no stacking beyond one period)");
ok((await settle(renew)).duplicate === true && (await member(S)).period_index === renewed.period_index, "the same charge settled twice extends once");

// ── a refund still revokes a cancelled subscription ──────────────────────────
await db.exec(`update creator_memberships set cancelled_at = now(), cancel_period = period_index where member_id = '${S}' and creator_id = '${C}'`);
await reverse(renew);
const afterRefund = await member(S);
ok(Math.abs(+afterRefund.period_end - +before.period_end) < 5000, "refunding the renewal takes its 30 days back, cancellation or not");
// refund the first (pre-existing) period too: simulate it with a paid purchase whose days are the remaining ones
const only = await purchase(S);
await settle(only);
await reverse(only);
const ref2 = await purchase(S);
await settle(ref2);
await db.exec(`update creator_memberships set cancelled_at = now(), cancel_period = period_index, period_end = now() + interval '10 days', period_start = now() - interval '20 days' where member_id = '${S}' and creator_id = '${C}'`);
await reverse(ref2);
const revoked = await member(S);
ok(revoked.status === "ended" && +revoked.period_end <= Date.now() + 1000, "a refund mid-period of a cancelled subscription ends access now");
await db.exec(`update creator_memberships set cancelled_at = null, cancel_period = null where member_id = '${S}' and creator_id = '${C}'`);
ok((await member(S)).status === "ended", "clearing the cancellation does not bring access back");

// ── a removed member stays out, cancellation or not ──────────────────────────
await db.exec(`update creator_memberships set cancelled_at = now(), cancel_period = period_index where member_id = '${R}'`);
const late = await purchase(R);
const lr = await settle(late);
ok(lr.ok === false && lr.reason === "removed", "a stale or late charge for a removed member is refused (0247, unchanged)");
ok((await member(R)).status === "removed", "and the removal stands");

// ── the reminder dedupe ──────────────────────────────────────────────────────
const mid = (await member(S)).id;
await db.exec(`insert into sub_membership_reminders (membership_id, period_index, kind, member_id) values ('${mid}', 3, 'renew_3d', '${S}')`);
ok(await throws(`insert into sub_membership_reminders (membership_id, period_index, kind, member_id) values ('${mid}', 3, 'renew_3d', '${S}')`), "the same reminder for the same period can't be recorded twice");
const claim = await q(`insert into sub_membership_reminders (membership_id, period_index, kind, member_id) values ('${mid}', 3, 'renew_3d', '${S}') on conflict do nothing returning kind`);
ok(claim.length === 0, "a second claim (the app's upsert ignoreDuplicates) returns nothing, so nothing is sent");
ok(!(await throws(`insert into sub_membership_reminders (membership_id, period_index, kind, member_id) values ('${mid}', 4, 'renew_3d', '${S}')`)), "the next period's reminder is a new row");
ok(!(await throws(`insert into sub_membership_reminders (membership_id, period_index, kind, member_id) values ('${mid}', 3, 'renew_1d', '${S}')`)), "another kind in the same period is a new row");
ok(await throws(`insert into sub_membership_reminders (membership_id, period_index, kind, member_id) values ('${mid}', 3, 'promo', '${S}')`), "an unknown reminder kind is refused");

// ── indexes ──────────────────────────────────────────────────────────────────
const idx = (name) => q(`select indexdef from pg_indexes where indexname = $1`, [name]).then((r) => r[0]?.indexdef ?? "");
ok((await idx("creator_memberships_expiry_idx")).includes("(period_end)") && (await idx("creator_memberships_expiry_idx")).includes("billing = 'sub'"), "the reminder sweep index exists");
ok((await idx("creator_memberships_creator_sub_idx")).includes("(creator_id, joined_at DESC, id DESC)"), "the subscriber list index exists with its tie-breaker");

// ── policies and grants unchanged ────────────────────────────────────────────
const pol = await q(`select tablename, policyname from pg_policies where schemaname='public' and tablename in ('creator_memberships','sub_purchases','sub_membership_reminders')`);
ok(pol.filter((p) => p.tablename === "creator_memberships").map((p) => p.policyname).join() === "creator memberships parties read", "creator_memberships keeps only its parties-read policy");
ok(pol.filter((p) => p.tablename === "sub_purchases").map((p) => p.policyname).join() === "sub purchases parties read", "sub_purchases keeps only its parties-read policy");
ok(!pol.some((p) => p.tablename === "sub_membership_reminders"), "the reminder table has no client policy");
ok((await q(`select relrowsecurity r from pg_class where relname = 'sub_membership_reminders'`))[0].r === true, "and row level security is on");
const grants = await q(`select grantee, privilege_type from information_schema.role_table_grants where table_name = 'sub_membership_reminders' and grantee in ('anon','authenticated')`);
ok(grants.length === 0, "anon and authenticated hold no privilege on the reminder table");
const fx = await q(`select p.proname, has_function_privilege('authenticated', p.oid, 'execute') a from pg_proc p where proname in ('settle_sub_purchase','reverse_sub_purchase')`);
ok(fx.length === 2 && fx.every((f) => !f.a), "the money functions are still not executable by signed-in users");

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
