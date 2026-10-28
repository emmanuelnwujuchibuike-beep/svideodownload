// 0297 — creator analytics: the new signals and the aggregates, against the REAL migration in PGlite. The tables it
// reads are built with the columns their own migrations define (0006/0007/0008/0011/0015/0025/0105/0121/0133/0141/
// 0181/0227/0293). Run like the other suites (next to credit_wallet.shared.mjs, where @electric-sql/pglite is installed):
//   node 0297_creator_analytics.pglite.mjs <repo>/supabase/migrations [--mutant=<name>]
//
// --mutant=<name> breaks one thing and the run must FAIL:
//   other-creator   the daily metrics stop scoping views to the creator's own posts
//   no-unfollow     the unfollow trigger is dropped
//   tz-ignored      the heatmap ignores the creator's time zone
import { readFileSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";

import { split, STUB, U } from "./credit_wallet.shared.mjs";

const dir = process.argv[2];
const MUTANT = (process.argv.find((a) => a.startsWith("--mutant=")) ?? "").split("=")[1] ?? "";
const db = new PGlite();
const run = async (stmts) => { for (const s of stmts) { try { await db.exec(s); } catch (e) { console.log("SQL ERROR:", e.message, "\n", s.slice(0, 300)); process.exit(2); } } };
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; console.log("FAIL:", m); } else console.log("ok:", m); };
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const one = async (sql, params = []) => (await q(sql, params))[0];
const val = async (sql, params = []) => Object.values((await one(sql, params)) ?? {})[0];

await run(split(STUB));
await run([
  "grant usage on schema auth to anon, authenticated, service_role",
  "alter role service_role bypassrls",
  `create table public.posts (id uuid primary key default gen_random_uuid(), publisher_id uuid not null references auth.users (id), title text not null default 'p', thumbnail_url text,
     status text not null default 'published', views_count int not null default 0, downloads_count int not null default 0, saves_count int not null default 0, created_at timestamptz not null default now())`,
  `create table public.post_views (id uuid primary key default gen_random_uuid(), post_id uuid not null references public.posts (id) on delete cascade, viewer_id uuid references auth.users (id),
     ip_hash text not null default '', day date not null default current_date, created_at timestamptz not null default now(), source text)`,
  "create table if not exists public.post_reactions (user_id uuid not null, post_id uuid not null, type text not null, created_at timestamptz not null default now())",
  "create table if not exists public.post_comments (id uuid primary key default gen_random_uuid(), post_id uuid not null, author_id uuid not null, created_at timestamptz not null default now())",
  "create table if not exists public.share_events (id uuid primary key default gen_random_uuid(), sharer_id uuid, post_id uuid, creator_id uuid, created_at timestamptz not null default now())",
  "create table if not exists public.reposts (id uuid primary key default gen_random_uuid(), user_id uuid not null, post_id uuid not null, created_at timestamptz not null default now())",
  "create table if not exists public.follows (follower_id uuid not null references auth.users (id), following_id uuid not null references auth.users (id), created_at timestamptz not null default now(), primary key (follower_id, following_id))",
  "create table if not exists public.gift_sends (id uuid primary key default gen_random_uuid(), sender_id uuid not null, recipient_id uuid not null, recipient_share bigint not null, status text not null default 'pending', created_at timestamptz not null default now())",
  "create table if not exists public.post_watch_events (id uuid primary key default gen_random_uuid(), post_id uuid not null, watch_ms int, created_at timestamptz not null default now())",
  "create table if not exists public.sub_posts (id uuid primary key default gen_random_uuid(), creator_id uuid not null)",
  "create table if not exists public.sub_purchases (id uuid primary key default gen_random_uuid(), subscriber_id uuid not null, creator_id uuid, status text not null, created_at timestamptz not null default now())",
  "create table if not exists public.ai_jobs (id uuid primary key default gen_random_uuid())", "alter table public.ai_jobs add column if not exists user_id uuid", "alter table public.ai_jobs add column if not exists created_at timestamptz not null default now()",
  "create table if not exists public.story_views (story_id uuid not null, viewer_id uuid not null, viewed_at timestamptz not null default now())",
  "create table if not exists public.wallpaper_saves (wallpaper_id uuid not null, user_id uuid not null, created_at timestamptz not null default now())",
  "create table if not exists public.downloads (id uuid primary key default gen_random_uuid(), user_id uuid, created_at timestamptz not null default now())",
  "create table if not exists public.messages (id uuid primary key default gen_random_uuid(), sender_id uuid not null, created_at timestamptz not null default now())",
]);
const m = split(readFileSync(`${dir}/0297_creator_analytics.sql`, "utf8"));
await run(m);
await run(m);
await db.exec(`insert into auth.users (id, email) select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'u' || g || '@t.test' from generate_series(1, 20) g`);

const fnBody = async (name) => (await one("select pg_get_functiondef(p.oid) d from pg_proc p where p.proname = $1", [name])).d;
const mutate = async (name, from, to) => { const b = await fnBody(name); const x = b.split(from).join(to); if (x === b) throw new Error(`mutant on ${name} did not apply`); await db.exec(x); };
if (MUTANT === "other-creator") await mutate("creator_daily_metrics", "from public.post_views where post_id in (select id from posts_of) and", "from public.post_views where");
if (MUTANT === "no-unfollow") await db.exec("drop trigger follows_unfollow_log on public.follows");
if (MUTANT === "tz-ignored") await mutate("creator_heatmap", "created_at at time zone v_tz", "created_at at time zone 'UTC'");

const ME = U(1), OTHER = U(2), A = U(3), B = U(4), C = U(5);
const J = JSON.stringify;
const p1 = await val("insert into posts (publisher_id, title, views_count) values ($1, 'Sunset', 300) returning id", [ME]);
const p2 = await val("insert into posts (publisher_id, title, views_count) values ($1, 'Rain', 100) returning id", [ME]);
const px = await val("insert into posts (publisher_id, title) values ($1, 'Theirs') returning id", [OTHER]);
const at = (iso) => iso;
// views: today 3 on p1 (2 unique viewers + 1 anon), yesterday 1 on p2, one on someone else's post
await db.query(`insert into post_views (post_id, viewer_id, ip_hash, created_at, source, country, city) values
  ($1, $3, '', now(), 'for_you', 'NG', 'Lagos'), ($1, $4, '', now(), 'post_page', 'NG', 'Abuja'), ($1, null, 'h1', now(), 'search', 'GH', null),
  ($2, $3, '', now() - interval '1 day', 'for_you', null, null), ($5, $3, '', now(), 'for_you', 'US', null)`, [p1, p2, A, B, px]);
await db.query("insert into post_reactions (user_id, post_id, type) values ($1, $2, 'like'), ($3, $2, 'like'), ($1, $2, 'save')", [A, p1, B]);
await db.query("insert into post_comments (post_id, author_id) values ($1, $2)", [p1, A]);
await db.query("insert into share_events (sharer_id, post_id, creator_id) values ($1, $2, $3)", [B, p1, ME]);
await db.query("insert into reposts (user_id, post_id) values ($1, $2)", [C, p2]);
await db.query("insert into follows (follower_id, following_id) values ($1, $3), ($2, $3)", [A, B, ME]);
await db.query("insert into gift_sends (sender_id, recipient_id, recipient_share) values ($1, $2, 4500), ($1, $2, 900)", [A, ME]);
await db.query("insert into gift_sends (sender_id, recipient_id, recipient_share, status) values ($1, $2, 99999, 'reversed')", [B, ME]);
await db.query("insert into post_download_events (post_id, creator_id) values ($1, $2)", [p1, ME]);
await db.query("insert into post_watch_events (post_id, watch_ms) values ($1, 4000), ($1, 6000)", [p1]);

// ═══ 1 · the signals ═══
ok((await db.query("insert into post_views (post_id, country) values ($1, 'nigeria')", [p1]).then(() => "accepted", () => "refused")) === "refused", "a country must be a two-letter code");
await db.query("delete from follows where follower_id = $1 and following_id = $2", [B, ME]);
ok(Number(await val("select count(*) from follow_events where follower_id = $1 and following_id = $2 and kind = 'unfollow'", [B, ME])) === 1, "deleting a follow writes one unfollow event");
await db.query("insert into sub_posts (id, creator_id) values ($1, $2)", ["00000000-0000-4000-8000-0000000000a1", ME]);
await db.query("insert into sub_preview_events (post_id, creator_id, viewer_id, kind) values ($1, $2, $3, 'preview_seen')", ["00000000-0000-4000-8000-0000000000a1", ME, A]);
ok((await db.query("insert into sub_preview_events (post_id, creator_id, viewer_id, kind) values ($1, $2, $3, 'preview_seen')", ["00000000-0000-4000-8000-0000000000a1", ME, A]).then(() => "dup", () => "refused")) === "refused", "a preview is counted once per viewer, post and day");

// ═══ 2 · daily metrics ═══
const daily = await val("select creator_daily_metrics($1, date_trunc('day', now()) - interval '1 day', 'UTC')", [ME]);
const today = daily[daily.length - 1];
const sum = (k) => daily.reduce((s, d) => s + Number(d[k]), 0);
ok(sum("views") === 4 && today.views === 3 && today.unique === 3, "views count only the creator's own posts (4, not 5), today 3 from 3 identities");
ok(sum("likes") === 2 && sum("saves") === 1 && sum("comments") === 1 && sum("shares") === 1 && sum("reposts") === 1, "likes, saves, comments, shares and reposts, each from its own table");
ok(sum("follows") === 1 && sum("unfollows") === 1, "new followers (the deleted follow is gone) and its unfollow event");
ok(sum("gifts") === 2 && sum("gift_fgc") === 5400, "gifts received and the creator's FGC share — a reversed gift is not counted");
ok(sum("downloads") === 1, "dated downloads");
ok(daily.length === 2, "one entry per local day, gaps filled");

// ═══ 3 · sources, heatmap, locations ═══
const src = await val("select creator_view_sources($1, now() - interval '2 days')", [ME]);
ok(J(src.map((s) => [s.source, s.count])) === J([["for_you", 2], ["post_page", 1], ["search", 1]]), "views by source");
await db.exec("delete from post_views");
await db.query("insert into post_views (post_id, viewer_id, created_at) values ($1, $2, '2026-10-26T23:30:00Z')", [p1, A]);
const hmUtc = await val("select creator_heatmap($1, '2026-10-01', 'UTC')", [ME]);
const hmLagos = await val("select creator_heatmap($1, '2026-10-01', 'Africa/Lagos')", [ME]);
ok(hmUtc[0].dow === 0 && hmUtc[0].block === 5, "23:30 UTC on Monday 26 Oct: Monday, the 20-24 block (UTC)");
ok(hmLagos[0].dow === 1 && hmLagos[0].block === 0, "the same view is Tuesday 00:30 in Lagos — the heatmap uses the creator's time zone");
ok((await val("select analytics_tz('Not/AZone')")) === "UTC", "an unknown time zone falls back to UTC");
await db.query("insert into post_views (post_id, viewer_id, country, city) values ($1, $2, 'NG', 'Lagos'), ($1, $3, 'NG', null), ($1, $4, 'GH', 'Accra')", [p1, A, B, C]);
const ctry = await val("select creator_locations($1, now() - interval '1 day', 'country')", [ME]);
const city = await val("select creator_locations($1, now() - interval '1 day', 'city')", [ME]);
ok(J(ctry) === J([{ name: "NG", count: 2 }, { name: "GH", count: 1 }]) && city.length === 2, "locations by country and by city; views without one aren't counted");

// ═══ 4 · top engaging, post curve ═══
await db.query("insert into post_views (post_id, viewer_id) values ($1, $2)", [p2, A]);
const top = await val("select creator_top_engaging($1, now() - interval '1 day', 5)", [ME]);
ok(top.length >= 1 && top[0].id === p1 && top[0].interactions === 5, "most engaging posts by interactions in the window");
const curve = await val("select creator_post_curve($1, $2)", [ME, p1]);
ok(curve && curve.downloads_dated === 1 && Number(curve.avg_watch_ms) === 5000 && curve.rank === 1, "post curve: dated downloads, average watch time, rank among the creator's posts");
ok((await val("select creator_post_curve($1, $2)", [OTHER, p1])) === null, "another creator can't read this post's curve");

const uv = await val("select creator_unique_viewers($1, now() - interval '1 day')", [ME]);
ok(uv.unique === 3 && uv.signed_in === 3 && uv.following === 1, "distinct viewers over the window (not a daily sum), signed in, and the ones who follow");

// ═══ 5 · feature usage ═══
await db.query("insert into ai_jobs (user_id) values ($1)", [A]);
await db.query("insert into messages (sender_id) values ($1), ($2)", [A, U(9)]);
const fu = await val("select creator_feature_usage($1, now() - interval '30 days', now() + interval '1 minute')", [ME]);
ok(fu.audience === 3, "audience = followers (A) + signed-in viewers of the creator's posts (A, B, C), counted once");
ok(fu.features.sticker_gifts === 2 && fu.features.ai_creation === 1 && fu.features.chat === 1 && fu.features.sharing === 1, "a feature counts audience members who did its action — someone outside the audience is not counted");

// ═══ 6 · access ═══
await db.exec("set role authenticated");
ok((await db.query("select creator_daily_metrics($1, now())", [ME]).then(() => "ran", () => "refused")) === "refused", "a member can't call the aggregates directly");
ok((await db.query("select * from post_download_events").then(() => "read", () => "refused")) === "refused", "nor read the download events");
await db.exec("reset role");

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
