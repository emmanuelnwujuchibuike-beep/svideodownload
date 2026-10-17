// PGlite harness for 0255 (Rewards v2). Run from %TEMP%\pgt:
//   node t0255.mjs <repo>/supabase/migrations <path-to-0255.sql> [--mutant=<name>]
// The surrounding tables are stubbed with their real columns and constraints; grant_reward (0191)
// and the settings -> reward_config sync (0189) are the REAL functions, cut from their migrations.
// 0255 is applied TWICE. Mutants (each must FAIL):
//   spent-last    the recompute treats reward credits as spent LAST (bought credits get taken)
//   usable-aff    the affiliate share is paid as usable, not withdrawable
//   no-email      real_follower_count stops requiring a confirmed email
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const dir = process.argv[2];
const file = process.argv[3];
const MUTANT = (process.argv.find((a) => a.startsWith("--mutant=")) ?? "").split("=")[1] ?? "";

const stub = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, created_at timestamptz not null default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table public.profiles (id uuid primary key references auth.users (id), followers_count int not null default 0, is_suspended boolean default false, is_hidden boolean default false);
create table public.follows (follower_id uuid not null references auth.users (id), following_id uuid not null references auth.users (id), created_at timestamptz not null default now(), primary key (follower_id, following_id), constraint follows_no_self check (follower_id <> following_id));
create function public.follows_count_trg() returns trigger language plpgsql as $$ begin update public.profiles set followers_count = followers_count + 1 where id = new.following_id; return new; end $$;
create trigger a_follows_count after insert on public.follows for each row execute function public.follows_count_trg();
create table public.settings (key text primary key, value jsonb, updated_at timestamptz default now());
create table public.notifications (id bigint generated always as identity primary key, user_id uuid, actor_id uuid, type text, data jsonb, created_at timestamptz default now());
create table public.referral_attributions (referred_user_id uuid primary key references auth.users (id), referrer_id uuid not null references auth.users (id), status text not null default 'active', attributed_at timestamptz not null default now(), constraint referral_attributions_not_self_chk check (referred_user_id <> referrer_id));
create table public.reward_profiles (user_id uuid primary key references auth.users (id), qualified_at timestamptz, qualifying_engagements integer not null default 0, restricted boolean not null default false, earned_usable bigint not null default 0, earned_withdrawable bigint not null default 0, updated_at timestamptz not null default now());
create table public.reward_events (id uuid primary key default gen_random_uuid(), beneficiary_id uuid not null references auth.users (id), role text not null, event_type text not null, source_type text not null, source_id text not null, actor_user_id uuid, referred_user_id uuid, amount integer not null, credit_class text not null, qualified_at_event boolean not null, rule_version integer not null default 1, dedupe_key text not null, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
  constraint reward_events_role_chk check (role in ('actor', 'referrer')), constraint reward_events_class_chk check (credit_class in ('usable', 'withdrawable')), constraint reward_events_amount_chk check (amount > 0));
create unique index reward_events_once_uidx on public.reward_events (beneficiary_id, role, event_type, dedupe_key);
create table public.reward_config (id boolean primary key default true, rules jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now());
create table public.ai_product_balances (user_id uuid not null references auth.users (id), product text not null, balance_cents bigint not null default 0, withdrawable_cents bigint not null default 0, currency text not null default 'CREDIT', updated_at timestamptz not null default now(), primary key (user_id, product),
  constraint ai_product_balances_non_negative check (balance_cents >= 0), constraint ai_product_balances_withdrawable_chk check (withdrawable_cents >= 0 and withdrawable_cents <= balance_cents));
create table public.ai_product_ledger (id uuid primary key default gen_random_uuid(), user_id uuid not null, product text not null, kind text not null, status text not null default 'settled', delta_cents bigint not null, balance_after_cents bigint not null, currency text not null default 'CREDIT', reference text, note text, actor_admin_id uuid, metadata jsonb, credit_class text, withdrawable_part bigint not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint ai_product_ledger_kind_chk check (kind in ('recharge', 'processing_charge', 'refund', 'adjustment', 'reversal', 'bonus', 'grant', 'withdrawal', 'withdrawal_reversal', 'transfer_out', 'transfer_in', 'transfer_fee')),
  constraint ai_product_ledger_sign_chk check ((kind in ('recharge', 'refund', 'bonus', 'grant', 'withdrawal_reversal', 'transfer_in') and delta_cents > 0) or (kind in ('processing_charge', 'reversal', 'withdrawal', 'transfer_out', 'transfer_fee') and delta_cents < 0) or (kind = 'adjustment' and delta_cents <> 0)));
create table public.ai_topup_attempts (reference text primary key, user_id uuid not null references auth.users (id), amount_cents bigint not null, currency text not null, status text not null default 'pending', purpose text not null default 'wallet_topup', fx_minor_per_usd bigint, created_at timestamptz not null default now());`;
const split = (sql) => { const out = []; let cur = ""; let inD = false; let inQ = false;
  for (let i = 0; i < sql.length; i++) {
    if (!inQ && sql.startsWith("$$", i)) { inD = !inD; cur += "$$"; i++; continue; }
    if (!inD && sql[i] === "'") inQ = !inQ;
    if (!inD && !inQ && sql.startsWith("--", i)) { const nl = sql.indexOf("\n", i); i = nl < 0 ? sql.length : nl; cur += "\n"; continue; }
    if (sql[i] === ";" && !inD && !inQ) { if (cur.trim()) out.push(cur); cur = ""; } else cur += sql[i]; }
  if (cur.trim()) out.push(cur); return out; };
const run = async (db, sql) => { for (const s of split(sql)) { try { await db.exec(s); } catch (e) { console.log("SQL ERROR:", e.message, "\n", s.slice(0, 300)); process.exit(2); } } };
/** One real function, cut whole from a migration file. */
const realFn = (f, name) => { const s = readFileSync(`${dir}/${f}`, "utf8"); const a = s.indexOf(`create or replace function public.${name}(`); const b = s.indexOf("\n$$;", a); if (a < 0 || b < 0) throw new Error(`no ${name} in ${f}`); return s.slice(a, b + 4); };

const db = new PGlite();
await run(db, stub);
await db.exec(realFn("0191_reward_qualification_review.sql", "grant_reward"));
await db.exec(realFn("0189_reward_engine_performance.sql", "reward_config_sync"));
await db.exec("create trigger reward_config_sync_trg after insert or update on public.settings for each row execute function public.reward_config_sync()");

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
// 1..9 members, 100..399 followers of various quality
await db.exec(`insert into auth.users (id, email_confirmed_at, created_at) select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, now() - interval '30 days', now() - interval '30 days' from generate_series(1, 9) g`);
await db.exec(`insert into auth.users (id, email_confirmed_at, created_at) select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, now() - interval '30 days', now() - interval '30 days' from generate_series(100, 199) g`);
await db.exec(`insert into auth.users (id, email_confirmed_at, created_at) select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, null, now() - interval '30 days' from generate_series(200, 249) g`); // no confirmed email
await db.exec(`insert into auth.users (id, email_confirmed_at, created_at) select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, now(), now() from generate_series(250, 299) g`); // brand new
await db.exec(`insert into auth.users (id, email_confirmed_at, created_at) select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, now() - interval '30 days', now() - interval '30 days' from generate_series(300, 320) g`);
await db.exec(`insert into public.profiles (id) select id from auth.users`);
await db.exec(`update public.profiles set is_suspended = true where id in (select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid from generate_series(300, 320) g)`); // suspended
// the operator's OLD rules (before 0255): an AI reward, quests on
await db.exec(`insert into public.settings (key, value) values ('landing', '{"hero": "kept", "frenzRewards": {"enabled": true, "events": {"ai_video_completed": {"enabled": true, "actorCredits": 5}}, "quests": {"enabled": true, "items": []}, "withdrawals": {"creditsPerUsd": 10}}}')`);

let sql = readFileSync(file, "utf8");
if (MUTANT === "spent-last") sql = sql.replace("v_unspent := greatest(0, v_balance - v_other_in);", "v_unspent := least(v_removable, v_balance);");
if (MUTANT === "usable-aff") sql = sql.replace("v_credits, 'withdrawable', true, 2, 'affiliate:'", "v_credits, 'usable', true, 2, 'affiliate:'").replace("set balance_cents = balance_cents + v_credits, withdrawable_cents = withdrawable_cents + v_credits", "set balance_cents = balance_cents + v_credits");
if (MUTANT === "no-email") sql = sql.replace("and u.email_confirmed_at is not null", "");
await run(db, sql);
await run(db, sql);

const q = async (s, p) => (await db.query(s, p)).rows;
const one = async (s, p) => (await q(s, p))[0];
const call = async (s, p) => (await one(s, p)).r;
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; console.log("FAIL:", m); } else console.log("ok:", m); };
const throws = async (s) => { try { await db.exec(s); return false; } catch { return true; } };
const wallet = (u) => one("select balance_cents::int b, withdrawable_cents::int w from ai_product_balances where user_id = $1", [u]);
const ledgerSum = async (u) => (await one("select coalesce(sum(delta_cents), 0)::int s from ai_product_ledger where user_id = $1", [u])).s;

// ── 1 · the rules, applied once ──
const fr = (await one("select value -> 'frenzRewards' v from settings where key = 'landing'")).v;
ok(fr.events.account_created.enabled && fr.events.account_created.actorCredits === 5 && fr.events.account_created.referrerCredits === 5, "1. sign-up: 5 to the new member, 5 to the inviter");
ok(fr.events.wallet_topup.referrerCredits === 10 && fr.events.wallet_topup.referrerRepeatable && fr.events.subscription_started.referrerCredits === 10, "1. invitee top-up / AI plan: 10 to the inviter, every time");
ok(fr.events.ai_video_completed.enabled === false && fr.events.download_completed.enabled === false && fr.events.follow.enabled === false, "1. every other reward is OFF (including one the operator had on)");
ok(fr.quests.enabled === false && fr.weeklyPrizes.enabled === false, "1. quests and weekly prizes OFF");
ok(fr.followers.milestones.length === 2 && fr.affiliate.rateBp === 1000 && fr.affiliate.minFollowers === 5000, "1. follower milestones and the affiliate block are in place");
ok(fr.withdrawals.creditsPerUsd === 10 && (await one("select value ->> 'hero' h from settings where key = 'landing'")).h === "kept", "1. nothing else in the settings is touched");
ok((await one("select rules -> 'events' -> 'account_created' ->> 'actorCredits' a from reward_config")).a === "5", "1. the engine's mirror (reward_config) has the new rules");
await db.exec(`update settings set value = jsonb_set(value, '{frenzRewards,events,account_created,actorCredits}', '7') where key = 'landing'`);
await run(db, sql);
ok((await one("select value #>> '{frenzRewards,events,account_created,actorCredits}' a from settings where key = 'landing'")).a === "7", "1. re-running 0255 never undoes the admin's later adjustment");
await db.exec(`update settings set value = jsonb_set(value, '{frenzRewards,events,account_created,actorCredits}', '5') where key = 'landing'`);

ok((await one("select reward_default_rule('ai_video_completed') ->> 'enabled' e")).e === "false" && (await one("select reward_default_rule('account_created') ->> 'actorCredits' a")).a === "5", "1. the engine's built-in defaults are v2 too (an event with no stored rule pays nothing old)");

// ── 2 · real followers and milestones ──
const C = U(1);
for (let g = 100; g < 190; g++) await db.exec(`insert into follows (follower_id, following_id) values ('${U(g)}', '${C}')`);      // 90 real
for (let g = 200; g < 250; g++) await db.exec(`insert into follows (follower_id, following_id) values ('${U(g)}', '${C}')`);      // 50 unconfirmed
for (let g = 300; g < 321; g++) await db.exec(`insert into follows (follower_id, following_id) values ('${U(g)}', '${C}')`);      // 21 suspended
ok((await one("select followers_count n from profiles where id = $1", [C])).n === 161 && (await call("select real_follower_count($1, 7) as r", [C])) === 90, "2. 161 followers, only 90 are real (no confirmed email / suspended don't count)");
ok(!(await one("select 1 x from reward_events where beneficiary_id = $1 and event_type = 'followers_milestone'", [C])), "2. 161 raw followers but 90 real: no 100-follower reward");
for (let g = 250; g < 260; g++) await db.exec(`insert into follows (follower_id, following_id) values ('${U(g)}', '${C}')`);      // 10 brand-new accounts
ok(!(await one("select 1 x from reward_events where beneficiary_id = $1 and event_type = 'followers_milestone'", [C])), "2. brand-new accounts (under 7 days) don't count either");
for (let g = 190; g < 200; g++) await db.exec(`insert into follows (follower_id, following_id) values ('${U(g)}', '${C}')`);      // the 100th real one
const m100 = await q("select amount, credit_class from reward_events where beneficiary_id = $1 and event_type = 'followers_milestone'", [C]);
ok(m100.length === 1 && m100[0].amount === 5, "2. the 100th REAL follower pays 5 credits, once (from the follow trigger)");
await call("select award_follower_milestones($1) as r", [C]);
await call("select sweep_follower_milestones(50) as r");
ok((await q("select 1 from reward_events where beneficiary_id = $1 and event_type = 'followers_milestone'", [C])).length === 1, "2. asking again (the function, the sweep) pays nothing more");
ok((await q("select 1 from ai_product_ledger where user_id = $1 and note like 'Reward · followers milestone'", [C])).length === 1 && (await q("select 1 from notifications where user_id = $1 and type = 'reward_earned'", [C])).length === 1, "2. it shows in the AI history (ledger) and as a notification");

// ── 3 · affiliates ──
const A = U(2), R = U(3), R2 = U(4);
await db.exec(`insert into referral_attributions (referred_user_id, referrer_id) values ('${R}', '${A}'), ('${R2}', '${A}')`);
await db.exec(`insert into ai_topup_attempts (reference, user_id, amount_cents, currency, status, purpose) values ('pay_before', '${R}', 5000, 'USD', 'success', 'wallet_topup')`);
ok(!(await one("select 1 x from affiliate_commissions where reference = 'pay_before'")), "3. before approval nothing is queued");
await db.exec(`insert into affiliate_accounts (user_id, status, rate_bp) values ('${A}', 'approved', 1000)`);
await db.exec(`insert into ai_topup_attempts (reference, user_id, amount_cents, currency, status, purpose) values ('pay_1', '${R}', 2000, 'USD', 'pending', 'wallet_topup')`);
ok(!(await one("select 1 x from affiliate_commissions where reference = 'pay_1'")), "3. a pending payment queues nothing");
await db.exec(`update ai_topup_attempts set status = 'success' where reference = 'pay_1'`);
await db.exec(`update ai_topup_attempts set status = 'success' where reference = 'pay_1'`);
ok((await q("select * from affiliate_commissions where reference = 'pay_1'")).length === 1, "3. the settled payment is queued once (a repeated success changes nothing)");
const g1 = await call("select grant_affiliate_commission('pay_1', 2000, 10) as r");
ok(g1.ok && g1.credits === 20, "3. 10% of $20.00 at 10 credits per dollar = 20 credits");
const wa = await wallet(A);
ok(wa.b === 20 && wa.w === 20, "3. the share is WITHDRAWABLE");
ok((await call("select grant_affiliate_commission('pay_1', 2000, 10) as r")).duplicate === true && (await wallet(A)).b === 20, "3. paying it again does nothing");
ok((await one("select note from ai_product_ledger where user_id = $1 and reference like 'reward:%'", [A])).note.startsWith("Affiliate · 10% of an invited member"), "3. AI history says how it was earned");
await db.exec(`insert into ai_topup_attempts (reference, user_id, amount_cents, currency, status, purpose) values ('pay_ad', '${R2}', 5000, 'NGN', 'success', 'ad_campaign')`);
ok((await one("select purpose from affiliate_commissions where reference = 'pay_ad'")).purpose === "ad_campaign", "3. ad payments by an invitee count too");
await db.exec(`update affiliate_accounts set status = 'revoked' where user_id = '${A}'`);
ok((await call("select grant_affiliate_commission('pay_ad', 300, 10) as r")).skipped === "affiliate_not_active" && (await wallet(A)).b === 20, "3. revoked before it was paid: skipped, nothing paid");
await db.exec(`update affiliate_accounts set status = 'approved' where user_id = '${A}'`);
await db.exec(`insert into ai_topup_attempts (reference, user_id, amount_cents, currency, status, purpose) values ('pay_tiny', '${R}', 5, 'USD', 'success', 'wallet_topup')`);
ok((await call("select grant_affiliate_commission('pay_tiny', 5, 10) as r")).skipped === "below_one_credit", "3. under one credit: skipped, never rounded up");
ok(await throws(`insert into affiliate_commissions (reference, affiliate_id, referred_user_id, purpose, amount_minor, currency, rate_bp) values ('x', '${A}', '${A}', 'wallet_topup', 1, 'USD', 1000)`), "3. a member can't be their own affiliate");
ok(await throws(`insert into affiliate_commissions (reference, affiliate_id, referred_user_id, purpose, amount_minor, currency, rate_bp) values ('y', '${A}', '${R}', 'sub_purchase', 1, 'USD', 1000)`), "3. private-post purchases can never be a commission");

// ── 4 · the recompute ──
const grant = (u, ev, amt, cls = "usable", role = "actor", dedupe = null) => db.exec(`
  with e as (insert into reward_events (beneficiary_id, role, event_type, source_type, source_id, amount, credit_class, qualified_at_event, dedupe_key) values ('${u}', '${role}', '${ev}', 's', gen_random_uuid()::text, ${amt}, '${cls}', ${cls === "withdrawable"}, ${dedupe ? `'${dedupe}'` : "gen_random_uuid()::text"}) returning id)
  insert into ai_product_ledger (user_id, product, kind, delta_cents, balance_after_cents, reference, withdrawable_part) select '${u}', 'character_replace', 'grant', ${amt}, 0, 'reward:' || id, ${cls === "withdrawable" ? amt : 0} from e`);
const ledger = (u, kind, delta) => db.exec(`insert into ai_product_ledger (user_id, product, kind, delta_cents, balance_after_cents, reference) values ('${u}', 'character_replace', '${kind}', ${delta}, 0, '${kind}:' || gen_random_uuid())`);
const setWallet = (u, b, w = 0) => db.exec(`insert into ai_product_balances (user_id, product, balance_cents, withdrawable_cents) values ('${u}', 'character_replace', ${b}, ${w}) on conflict (user_id, product) do update set balance_cents = ${b}, withdrawable_cents = ${w}`);
// P: 20 from downloads (old), 2 sign-up (kept), BOUGHT 100, spent 50 -> balance 72. Rewards spent first: nothing of the old 20 is left.
const P = U(5), V = U(6), W = U(7);
await grant(P, "download_completed", 20); await grant(P, "account_created", 2, "usable", "actor", "member"); await ledger(P, "recharge", 100); await ledger(P, "processing_charge", -50); await setWallet(P, 72);
// V: 30 from old rewards only, spent 5 -> 25 left of them
await grant(V, "quest_completed", 30); await ledger(V, "processing_charge", -5); await setWallet(V, 25);
// W: 10 old withdrawable reward, nothing spent
await grant(W, "ai_video_shared", 10, "withdrawable"); await setWallet(W, 10, 10);
const pv = await call("select recompute_rewards_v2($1, false, null) as r", [V]);
ok(pv.preview && pv.remove === 25 && (await wallet(V)).b === 25 && !(await one("select 1 x from reward_recompute_log where user_id = $1", [V])), "4. preview: says 25 would go, writes nothing");
const rp = await call("select recompute_rewards_v2($1, true, null) as r", [P]);
ok(rp.removed === 0 && (await wallet(P)).b >= 72, "4. a member who BOUGHT credits keeps them all: the old rewards count as spent first");
const rv = await call("select recompute_rewards_v2($1, true, null) as r", [V]);
ok(rv.removed === 25, "4. the unspent 25 old-reward credits are taken back");
ok((await wallet(V)).b === 5, "4. ...and the new sign-up 5 is paid (V never had one): balance 5, never below zero");
const rw = await call("select recompute_rewards_v2($1, true, null) as r", [W]);
const ww = await wallet(W);
ok(rw.removed === 10 && ww.w <= ww.b && ww.w === 0, "4. withdrawable reward credits are taken back from the withdrawable part too (never more than the balance)");
ok((await call("select recompute_rewards_v2($1, true, null) as r", [V])).done === true && (await wallet(V)).b === 5, "4. running it again does nothing (once per member)");
ok((await one("select note from ai_product_ledger where user_id = $1 and kind = 'adjustment'", [V])).note.startsWith("Rewards update"), "4. the removal is in the AI history");
ok((await q("select 1 from notifications where user_id = $1 and data ->> 'event' = 'rewards_v2'", [V])).length === 1, "4. ...and a notification says what changed");
// catch-up for an inviter: 2 invitees (1 signed up before), their 2 top-ups
const I = U(8), J1 = U(9), J2 = U(100);
await db.exec(`insert into referral_attributions (referred_user_id, referrer_id) values ('${J1}', '${I}'), ('${J2}', '${I}')`);
await grant(I, "account_created", 1, "usable", "referrer", J1); await db.exec(`update reward_events set referred_user_id = '${J1}' where beneficiary_id = '${I}'`);
await db.exec(`insert into ai_topup_attempts (reference, user_id, amount_cents, currency, status, purpose) values ('ti1', '${J1}', 1000, 'USD', 'success', 'wallet_topup'), ('ti2', '${J2}', 1000, 'USD', 'success', 'ai_subscription'), ('ti3', '${J2}', 1000, 'USD', 'failed', 'wallet_topup')`);
await setWallet(I, 1);
const ri = await call("select recompute_rewards_v2($1, true, null) as r", [I]);
ok(ri.added === 5 + 5 + 10 + 10, "4. an inviter is owed: their own sign-up 5, J2's sign-up 5, two settled payments 10 + 10 (not the failed one)");
ok((await call("select recompute_rewards_v2($1, true, null) as r", [I])).done && (await q("select 1 from reward_events where beneficiary_id = $1 and event_type = 'rewards_v2_catchup'", [I])).length === 2, "4. ...paid once");

// ── invariants on every wallet the run touched ──
for (const u of [C, A, V, W, I]) {
  const w = await wallet(u);
  ok(w.b >= 0 && w.w >= 0 && w.w <= w.b, `invariant: ${u.slice(-3)} balance >= 0 and withdrawable <= balance`);
}
for (const u of [C, A, I]) ok((await ledgerSum(u)) === (await wallet(u)).b, `invariant: ${u.slice(-3)} AI-history lines add up to the balance`);

// ── clients can't call any of it ──
await db.exec("grant usage on schema public to authenticated; grant select, insert, update, delete on all tables in schema public to authenticated");
await db.exec(`set role authenticated; select set_config('test.uid', '${A}', false)`);
ok(await throws(`select recompute_rewards_v2('${A}', true, null)`) && await throws(`select grant_affiliate_commission('pay_1', 1, 1)`) && await throws(`select award_follower_milestones('${A}')`), "clients can't run the recompute, pay commissions or award milestones");
ok(await throws(`insert into affiliate_accounts (user_id, status) values ('${R}', 'approved')`), "clients can't make themselves an affiliate");
ok((await q("select * from affiliate_commissions")).every((r) => r.affiliate_id === A), "an affiliate reads only their own commissions");
await db.exec("reset role");

console.log(failures ? `\n${failures} FAILED` : "\nALL OK");
process.exit(failures ? 1 : 0);
