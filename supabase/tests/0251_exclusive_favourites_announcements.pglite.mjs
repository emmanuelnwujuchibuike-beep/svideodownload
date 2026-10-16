// PGlite harness for 0251 (Frenz Exclusive Part 6). Run from %TEMP%\pgt:
//   node t0251.mjs <repo>/supabase/migrations [path-to-0251.sql] [--mutant]
// Applies 0129, 0238, 0227, 0237, 0239, 0247, 0248, 0250 for real; social_circles / circle_members are
// stubbed with 0112 + 0217's exact columns, kind check and (owner_id, kind) unique index. Rows that
// exist BEFORE 0251 are inserted, 0251 is applied TWICE, then checked.
// --mutant applies a broken 0251 (no checks, no dedupe keys): those cases must FAIL.
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const dir = process.argv[2];
const file = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : `${dir}/0251_exclusive_favourites_announcements.sql`;
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
create table public.reports (id uuid primary key default gen_random_uuid(), reporter_id uuid, target_type text not null, target_id uuid not null, reason text not null, note text, status text not null default 'open', created_at timestamptz not null default now(), constraint reports_target_chk check (target_type in ('post','comment','user')));
create table public.social_circles (id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users (id) on delete cascade, name text not null check (char_length(name) between 1 and 32), color text not null default 'blue', position integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), kind text not null default 'custom', icon text not null default 'circle');
create unique index social_circles_owner_name_uidx on public.social_circles (owner_id, lower(name));
create unique index social_circles_kind_uidx on public.social_circles (owner_id, kind) where kind <> 'custom';
alter table public.social_circles add constraint social_circles_kind_chk check (kind in ('custom', 'close_friends', 'inner_circle', 'vip'));
alter table public.social_circles enable row level security;
create policy "social circles owner all" on public.social_circles for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create table public.circle_members (circle_id uuid not null references public.social_circles (id) on delete cascade, member_id uuid not null references auth.users (id) on delete cascade, owner_id uuid not null references auth.users (id) on delete cascade, added_at timestamptz not null default now(), primary key (circle_id, member_id));`;
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
const A = U(1), B = U(2), C = U(3);
await db.exec(`insert into auth.users (id) values ('${A}'), ('${B}'), ('${C}')`);
for (const f of ["0129_creator_notification_prefs.sql", "0238_private_post_notifications.sql", "0227_sub_monetization.sql", "0237_sub_post_thumbs.sql", "0239_private_post_interactions.sql", "0247_sub_settlement_hardening.sql", "0248_sub_post_audience_feed.sql", "0250_sub_membership_lifecycle.sql"]) await run(db, readFileSync(`${dir}/${f}`, "utf8"));
// rows that exist before 0251
await db.exec(`insert into social_circles (owner_id, name, kind) values ('${A}', 'Close friends', 'close_friends'), ('${A}', 'Gym', 'custom')`);
await db.exec(`insert into creator_notification_prefs (viewer_id, target_id, posts, shares, private_posts) values ('${A}', '${B}', true, false, 'email')`);
await db.exec(`insert into creator_membership_settings (creator_id, sub_price_cents, sub_active) values ('${B}', 1000, true)`);
await db.exec(`insert into creator_notes (creator_id, body, min_role) values ('${B}', 'older note', 'member')`);

let sql = readFileSync(file, "utf8");
if (MUTANT) sql = sql.slice(0, sql.indexOf("do $$")).replace(/,\s*primary key \(job_id, recipient_id\)/, "").replace(/create unique index if not exists creator_notes_idem_uidx[^;]*;/, "").replace(/create unique index if not exists sub_fanout_jobs_ref_uidx[^;]*;/, "");
await run(db, sql);
await run(db, sql);

const q = async (s, p) => (await db.query(s, p)).rows;
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; console.log("FAIL:", m); } else console.log("ok:", m); };
const throws = async (s) => { try { await db.exec(s); return false; } catch { return true; } };

// ── favourites are a circle kind ─────────────────────────────────────────────
ok((await q(`select count(*)::int n from social_circles where owner_id = '${A}'`))[0].n === 2, "existing circles are untouched");
ok(!(await throws(`insert into social_circles (owner_id, name, kind, icon, color) values ('${A}', 'Favourite creators', 'favourite_creators', 'star', 'amber')`)), "a 'favourite_creators' circle is accepted");
ok(await throws(`insert into social_circles (owner_id, name, kind) values ('${A}', 'Faves 2', 'favourite_creators')`), "only one favourites circle per member (0217's index)");
ok(await throws(`insert into social_circles (owner_id, name, kind) values ('${A}', 'Weird', 'weird_kind')`), "an unknown kind is still refused");
ok(!(await throws(`insert into social_circles (owner_id, name, kind) values ('${B}', 'Close friends', 'close_friends')`)), "the older kinds still work");

// ── preferences ──────────────────────────────────────────────────────────────
const pref = (await q(`select * from creator_notification_prefs where viewer_id = '${A}' and target_id = '${B}'`))[0];
ok(pref.posts === true && pref.shares === false && pref.private_posts === "email", "an existing preference row keeps every value it had");
ok(pref.announcements === "push", "announcements default to push for an existing row");
ok(!(await throws(`update creator_notification_prefs set announcements = 'both' where viewer_id = '${A}'`)), "a valid announcement mode is accepted");
ok(await throws(`update creator_notification_prefs set announcements = 'sms' where viewer_id = '${A}'`), "an invented channel (sms) is refused");
ok((await q(`select notify_subscribed from creator_membership_settings where creator_id = '${B}'`))[0].notify_subscribed === "both", "the creator's new-subscriber alert keeps today's behaviour (both)");
ok(await throws(`update creator_membership_settings set notify_subscribed = 'loud' where creator_id = '${B}'`), "an invalid new-subscriber mode is refused");

// ── announcements on creator_notes ───────────────────────────────────────────
ok((await q(`select audience from creator_notes where body = 'older note'`))[0].audience === "members", "every existing note stays a members note");
ok(!(await throws(`insert into creator_notes (creator_id, body, title, audience, idempotency_key) values ('${B}', 'for subs', 'Hello', 'subscribers', 'key-000000001')`)), "a subscriber announcement with a title is accepted");
ok(await throws(`insert into creator_notes (creator_id, body, audience, idempotency_key) values ('${B}', 'again', 'subscribers', 'key-000000001')`), "the same idempotency key can't make a second announcement");
ok(!(await throws(`insert into creator_notes (creator_id, body, audience, idempotency_key) values ('${C}', 'other creator', 'subscribers', 'key-000000001')`)), "keys are per creator");
ok(await throws(`insert into creator_notes (creator_id, body, audience) values ('${B}', 'x', 'everyone')`), "an unknown audience is refused");
ok(await throws(`insert into creator_notes (creator_id, body, title) values ('${B}', 'x', '${"t".repeat(81)}')`), "a title over 80 characters is refused");
ok(await throws(`insert into creator_notes (creator_id, body, idempotency_key) values ('${B}', 'x', 'bad key!')`), "a malformed idempotency key is refused");

// ── fan-out dedupe ───────────────────────────────────────────────────────────
const ref = U(900);
await db.exec(`insert into sub_fanout_jobs (creator_id, kind, ref_id) values ('${B}', 'announcement', '${ref}')`);
ok(await throws(`insert into sub_fanout_jobs (creator_id, kind, ref_id) values ('${B}', 'announcement', '${ref}')`), "one fan-out job per announcement");
const job = (await q(`select id from sub_fanout_jobs where ref_id = '${ref}'`))[0].id;
await db.exec(`insert into sub_fanout_deliveries (job_id, recipient_id) values ('${job}', '${A}')`);
ok(await throws(`insert into sub_fanout_deliveries (job_id, recipient_id) values ('${job}', '${A}')`), "a recipient can be claimed once per job");
ok((await q(`insert into sub_fanout_deliveries (job_id, recipient_id) values ('${job}', '${A}') on conflict do nothing returning recipient_id`)).length === 0, "a second claim returns nothing, so nothing is sent twice");
ok(await throws(`update sub_fanout_deliveries set status = 'delivered' where job_id = '${job}'`), "'delivered' is not a status the app can claim");
ok(await throws(`insert into sub_fanout_jobs (creator_id, kind, ref_id) values ('${B}', 'newsletter', '${U(901)}')`), "an unknown job kind is refused");

// ── policies and grants ──────────────────────────────────────────────────────
const pol = await q(`select tablename, policyname from pg_policies where schemaname = 'public' and tablename in ('creator_notes','creator_notification_prefs','social_circles','sub_fanout_jobs','sub_fanout_deliveries','creator_membership_settings')`);
const names = (t) => pol.filter((p) => p.tablename === t).map((p) => p.policyname).sort().join();
ok(names("creator_notes") === "creator notes owner", "creator_notes keeps only the creator's own read policy");
ok(names("creator_notification_prefs") === "creator_notif_select_own,creator_notif_write_own", "creator_notification_prefs keeps its own-row policies");
ok(names("social_circles") === "social circles owner all", "social_circles keeps its owner policy");
ok(!pol.some((p) => p.tablename.startsWith("sub_fanout")), "the fan-out tables have no client policy");
const rls = await q(`select relname, relrowsecurity from pg_class where relname in ('sub_fanout_jobs','sub_fanout_deliveries')`);
ok(rls.length === 2 && rls.every((r) => r.relrowsecurity), "and row level security is on");
const grants = await q(`select table_name from information_schema.role_table_grants where table_name in ('sub_fanout_jobs','sub_fanout_deliveries') and grantee in ('anon','authenticated')`);
ok(grants.length === 0, "anon and authenticated hold no privilege on the fan-out tables");

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
