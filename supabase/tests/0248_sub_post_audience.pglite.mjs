// PGlite harness for 0248 (Frenz Exclusive Part 3). Run from %TEMP%\pgt:
//   node t0248.mjs <repo>/supabase/migrations [path-to-0248.sql] [--mutant]
// Applies 0227, 0237, 0239, 0247, inserts posts that exist BEFORE 0248, applies 0248 TWICE, checks.
// --mutant applies a broken 0248 (no check constraint): the "invalid value refused" check must FAIL.
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const dir = process.argv[2];
const file = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : `${dir}/0248_sub_post_audience_feed.sql`;
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
await db.exec(`insert into auth.users (id) values ('${U(1)}'), ('${U(2)}')`);
for (const f of ["0227_sub_monetization.sql", "0237_sub_post_thumbs.sql", "0239_private_post_interactions.sql", "0247_sub_settlement_hardening.sql"]) await run(db, readFileSync(`${dir}/${f}`, "utf8"));
await db.exec(`insert into sub_posts (id, creator_id, caption) values ('${U(101)}', '${U(1)}', 'older post'), ('${U(102)}', '${U(1)}', null)`);

let sql = readFileSync(file, "utf8");
if (MUTANT) sql = sql.slice(0, sql.indexOf("do $$"));
await run(db, sql);
await run(db, sql);

const q = async (s, p) => (await db.query(s, p)).rows;
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; console.log("FAIL:", m); } else console.log("ok:", m); };
const throws = async (s) => { try { await db.exec(s); return false; } catch { return true; } };

ok((await q(`select count(*)::int n from sub_posts where audience = 'locked'`))[0].n === 2, "every post that existed before 0248 is 'locked' (its old behaviour)");
await db.exec(`insert into sub_posts (creator_id) values ('${U(1)}')`);
ok((await q(`select audience from sub_posts order by created_at desc limit 1`))[0].audience === "locked", "a new post defaults to 'locked'");
ok(!(await throws(`insert into sub_posts (creator_id, audience) values ('${U(1)}', 'hidden')`)), "'hidden' is accepted");
ok(!(await throws(`update sub_posts set audience = 'locked' where id = '${U(102)}'`)), "'locked' is accepted");
ok(await throws(`insert into sub_posts (creator_id, audience) values ('${U(1)}', 'public')`), "an unknown audience is refused");
ok(await throws(`update sub_posts set audience = null where id = '${U(101)}'`), "audience can't be null");
ok((await q(`select indexdef from pg_indexes where indexname = 'sub_posts_feed_idx'`))[0]?.indexdef?.includes("(creator_id, created_at DESC, id DESC)"), "the feed index exists with the tie-breaker");
const pol = await q(`select tablename, policyname, cmd from pg_policies where schemaname='public' and tablename in ('sub_posts','sub_post_media','creator_memberships','creator_membership_settings')`);
ok(pol.filter((p) => p.tablename === "sub_posts").map((p) => `${p.policyname}/${p.cmd}`).join() === "sub posts owner/SELECT", "sub_posts still has only the owner's SELECT policy");
ok(!pol.some((p) => p.tablename === "sub_post_media"), "sub_post_media still has no client policy");
ok(pol.filter((p) => p.tablename === "creator_memberships").map((p) => p.policyname).join() === "creator memberships parties read", "creator_memberships policy unchanged");
// the feed's query shape uses the index (plan check on a populated table)
await db.exec(`insert into sub_posts (creator_id, created_at) select '${U(2)}', now() - (g || ' minutes')::interval from generate_series(1, 3000) g`);
await db.exec(`analyze sub_posts`);
const plan = (await q(`explain select id, created_at from sub_posts where creator_id = '${U(2)}' and status = 'published' and (created_at < now() - interval '1 day' or (created_at = now() - interval '1 day' and id < '${U(9)}')) order by created_at desc, id desc limit 25`)).map((r) => Object.values(r)[0]).join("\n");
ok(/sub_posts_feed_idx/.test(plan) && !/Sort/.test(plan), "a creator's gallery page (keyset with the id tie-breaker) is served by sub_posts_feed_idx, no sort");
console.log(failures ? `\n${failures} FAILED${MUTANT ? " (expected under --mutant)" : ""}` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
