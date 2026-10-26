// PGlite harness for 0287 (Stories Part 2 — story_view_access learns the followers rule), 2026-10-26.
// Run from a folder where @electric-sql/pglite is installed (e.g. %TEMP%) — copy this file AND
// story-audience-cases.json there, then:
//   node 0287_story_followers.pglite.mjs <repo>/supabase/migrations [--mutant=<name>]
//
// Applies the REAL 0015, the stories lines of 0081, 0083, 0181, the WHOLE 0285, then the WHOLE 0287
// twice (re-runnable). Every case in story-audience-cases.json — the SAME table the TypeScript rule
// (lib/social/story-audience.ts) is tested against — is built as real rows and asked of story_view_access:
// the two must agree, or a ring would show a story whose view or reshare is refused (or the reverse).
//
// Mutants (each must FAIL):
//   no-followers   0287's followers rule is removed (0285's body)
//   any-follow     the followers rule also lets a private profile through
//   open-grant     0287 grants EXECUTE to authenticated
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const dir = process.argv[2];
const MUTANT = (process.argv.find((a) => a.startsWith("--mutant=")) ?? "").split("=")[1] ?? "";
const read = (f) => readFileSync(`${dir}/${f}`, "utf8");
const here = dirname(fileURLToPath(import.meta.url));
const { cases } = JSON.parse(readFileSync(join(here, "story-audience-cases.json"), "utf8"));
const mutate = (sql, from, to) => {
  if (!sql.includes(from)) throw new Error(`mutant ${MUTANT} did not apply`);
  return sql.replace(from, to);
};
const storiesOnly = (sql) =>
  sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => /^(alter table public\.stories|create index if not exists stories_)/m.test(s.replace(/^--.*$/gm, "").trim()))
    .map((s) => s.replace(/^(--.*\n)+/g, "") + ";")
    .join("\n");

let m0287 = read("0287_story_view_access_followers.sql");
if (MUTANT === "no-followers") m0287 = mutate(m0287, "if v_visibility = 'followers' and exists (", "if false and exists (");
if (MUTANT === "any-follow") m0287 = mutate(m0287, "if v_visibility = 'followers' and exists (", "if v_visibility in ('followers', 'private') and exists (");
if (MUTANT === "open-grant") m0287 = mutate(m0287, "grant execute on function public.story_view_access(uuid, uuid) to service_role;", "grant execute on function public.story_view_access(uuid, uuid) to service_role, authenticated;");

const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create function public.uuid_generate_v4() returns uuid language sql as $$ select gen_random_uuid() $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
create table public.profiles (id uuid primary key, handle text, visibility text not null default 'public', is_suspended boolean default false, is_hidden boolean default false);
create table public.blocks (blocker_id uuid not null, blocked_id uuid not null, expires_at timestamptz, primary key (blocker_id, blocked_id));
create table public.user_restrictions (restrictor_id uuid not null, restricted_id uuid not null, scope text not null, primary key (restrictor_id, restricted_id, scope));
create table public.friendships (user_low uuid not null, user_high uuid not null, primary key (user_low, user_high));
create table public.follows (follower_id uuid not null, following_id uuid not null, primary key (follower_id, following_id));
create table public.conversations (id uuid primary key default gen_random_uuid(), type text not null, user_low uuid, user_high uuid);
create table public.privacy_settings (user_id uuid primary key);
`);
await db.exec(read("0015_stories.sql"));
await db.exec(storiesOnly(read("0081_reshare_permissions.sql")));
await db.exec(read("0083_story_thumbnails.sql"));
await db.exec(read("0181_story_views_and_screenshots.sql"));
await db.exec("grant all on all tables in schema public to anon, authenticated, service_role;");
await db.exec(read("0285_stories_security.sql"));
await db.exec(m0287);
await db.exec(m0287);

let failures = 0;
const ok = (c, m) => {
  if (!c) {
    failures++;
    console.log("FAIL:", m);
  } else console.log("ok:", m);
};
const pair = (a, b) => (a < b ? [a, b] : [b, a]);

let n = 0;
for (const c of cases) {
  n++;
  const A = `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`; // author
  const V = `b0000000-0000-4000-8000-${String(n).padStart(12, "0")}`; // viewer
  const S = `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`; // story
  const a = c.author;
  const t = c.ties;
  const handle = a.handle === null ? null : `author${n}`;
  await db.query("insert into auth.users values ($1), ($2)", [A, V]);
  await db.query("insert into public.profiles (id, handle, visibility, is_suspended, is_hidden) values ($1, $2, $3, $4, $5), ($6, $7, 'public', false, false)", [A, handle, a.visibility, !!a.suspended, !!a.hidden, V, `viewer${n}`]);
  const [lo, hi] = pair(A, V);
  if (t.friend) await db.query("insert into public.friendships values ($1, $2)", [lo, hi]);
  if (t.follows) await db.query("insert into public.follows values ($1, $2)", [V, A]);
  if (t.chat) await db.query("insert into public.conversations (type, user_low, user_high) values ('direct', $1, $2)", [lo, hi]);
  if (t.blockedBy) await db.query("insert into public.blocks values ($1, $2, null)", [A, V]);
  if (t.blocks) await db.query("insert into public.blocks values ($1, $2, null)", [V, A]);
  if (t.restricted) await db.query("insert into public.user_restrictions values ($1, $2, 'status')", [A, V]);
  if (t.msgRestricted) await db.query("insert into public.user_restrictions values ($1, $2, 'messaging')", [A, V]);
  await db.query("insert into public.stories (id, user_id, media_url) values ($1, $2, 'https://media.test/x.jpg')", [S, A]);
  const got = (await db.query("select public.story_view_access($1, $2) as v", [S, V])).rows[0].v;
  ok((got === "ok") === c.visible, `${c.label} -> ${got} (want ${c.visible ? "ok" : "not ok"})`);
}

// the function's own self / ended / missing answers are unchanged from 0285
const A0 = "a0000000-0000-4000-8000-000000000999";
await db.query("insert into auth.users values ($1)", [A0]);
await db.query("insert into public.profiles (id, handle, visibility) values ($1, 'self', 'private')", [A0]);
await db.query("insert into public.stories (id, user_id, media_url) values ('c0000000-0000-4000-8000-000000000999', $1, 'x')", [A0]);
ok((await db.query("select public.story_view_access('c0000000-0000-4000-8000-000000000999', $1) as v", [A0])).rows[0].v === "self", "own story -> self");
ok((await db.query("select public.story_view_access('c0000000-0000-4000-8000-0000000009ff', $1) as v", [A0])).rows[0].v === "missing", "unknown story -> missing");

// grants: still service_role only
const acl = (await db.query(`select has_function_privilege('anon', 'public.story_view_access(uuid,uuid)', 'execute') as anon,
  has_function_privilege('authenticated', 'public.story_view_access(uuid,uuid)', 'execute') as auth,
  has_function_privilege('service_role', 'public.story_view_access(uuid,uuid)', 'execute') as svc`)).rows[0];
ok(acl.anon === false && acl.auth === false && acl.svc === true, `EXECUTE: anon ${acl.anon}, authenticated ${acl.auth}, service_role ${acl.svc}`);
// 0285's policies untouched by 0287
const pols = (await db.query("select polname from pg_policy where polrelid = 'public.stories'::regclass order by polname")).rows.map((r) => r.polname);
ok(JSON.stringify(pols) === JSON.stringify(["stories owner read"]), `stories policies still 0285's: ${pols.join(" | ")}`);

console.log(failures ? `\n${failures} FAILED${MUTANT ? ` (mutant ${MUTANT})` : ""}` : `\nALL OK${MUTANT ? ` (mutant ${MUTANT} survived — the harness has no teeth for it)` : ""}`);
process.exit(failures ? 1 : 0);
