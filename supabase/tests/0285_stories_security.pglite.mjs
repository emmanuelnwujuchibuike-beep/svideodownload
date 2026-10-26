// PGlite harness for 0285 (Stories Part 1 — security, privacy, expiry), 2026-10-26.
// Run from a folder where @electric-sql/pglite is installed (e.g. %TEMP%) — copy this file there, then:
//   node 0285_stories_security.pglite.mjs <repo>/supabase/migrations [--mutant=<name>]
//
// Uses the REAL pieces: 0015 (the table and its old policies), the stories lines of 0081 and 0083,
// the story_views part of 0181, and the WHOLE 0285 file (applied twice — it must be re-runnable).
// Supabase's default table grants (ALL to anon, authenticated, service_role) are reproduced, so a
// policy or a revoke is what decides access, as it does in production. service_role has BYPASSRLS.
//
// What PGlite cannot prove: who OWNS the functions in production (they must be owned by the
// migration role, which owns the tables) — probe proowner after the migration applies.
//
// Mutants (each must FAIL):
//   keep-public-read   0285 leaves "stories public read" in place
//   keep-insert        0285 leaves "stories owner insert" and the insert grant in place
//   no-trigger         the expiry trigger is never created
//   no-block           story_view_access ignores blocks
//   no-exclude         story_media_references counts the rows being swept
//   any-owner          expire_own_story ignores auth.uid()
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const dir = process.argv[2];
const MUTANT = (process.argv.find((a) => a.startsWith("--mutant=")) ?? "").split("=")[1] ?? "";
const read = (f) => readFileSync(`${dir}/${f}`, "utf8");
const mutate = (sql, from, to) => {
  if (!sql.includes(from)) throw new Error(`mutant ${MUTANT} did not apply`);
  return sql.replace(from, to);
};

// 0081 also alters messages and posts — only its stories statements are taken.
const storiesOnly = (sql) =>
  sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => /^(alter table public\.stories|create index if not exists stories_)/m.test(s.replace(/^--.*$/gm, "").trim()))
    .map((s) => s.replace(/^(--.*\n)+/g, "") + ";")
    .join("\n");

let m0285 = read("0285_stories_security.sql");
if (MUTANT === "keep-public-read") m0285 = mutate(m0285, 'drop policy if exists "stories public read" on public.stories;', "");
if (MUTANT === "keep-insert") {
  m0285 = mutate(m0285, 'drop policy if exists "stories owner insert" on public.stories;', "");
  m0285 = mutate(m0285, "revoke insert, update, delete, truncate, references, trigger on table public.stories from authenticated;", "revoke update, delete on table public.stories from authenticated;");
}
if (MUTANT === "no-trigger") m0285 = mutate(m0285, "  create trigger stories_enforce_expiry\n    before insert or update on public.stories\n    for each row execute function public.stories_enforce_expiry();\n", "");
if (MUTANT === "no-block") m0285 = mutate(m0285, "  if exists (\n    select 1 from public.blocks b", "  if false and exists (\n    select 1 from public.blocks b");
if (MUTANT === "no-exclude") m0285 = mutate(m0285, "where %I = any($1) and not (id = any($2))", "where %I = any($1) and $2 is not null");
if (MUTANT === "any-owner") m0285 = mutate(m0285, "where id = p_story and user_id = v_uid;", "where id = p_story;");

const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create function public.uuid_generate_v4() returns uuid language sql as $$ select gen_random_uuid() $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

create table public.profiles (id uuid primary key, handle text, visibility text not null default 'public', is_suspended boolean default false, is_hidden boolean default false);
create table public.blocks (blocker_id uuid not null, blocked_id uuid not null, expires_at timestamptz, primary key (blocker_id, blocked_id));
create table public.user_restrictions (restrictor_id uuid not null, restricted_id uuid not null, scope text not null, primary key (restrictor_id, restricted_id, scope));
create table public.friendships (user_low uuid not null, user_high uuid not null, primary key (user_low, user_high));
create table public.conversations (id uuid primary key default gen_random_uuid(), type text not null, user_low uuid, user_high uuid, avatar_url text);
create table public.privacy_settings (user_id uuid primary key);
create table public.posts (id uuid primary key default gen_random_uuid(), media_url text, thumbnail_url text, source_url text, reshared_from_story_id uuid);
create table public.post_media (post_id uuid, idx int, media_url text, thumbnail_url text);
create table public.message_attachments (id uuid primary key default gen_random_uuid(), media_url text, thumbnail_url text);
create table public.galleries (id int primary key, image_urls text[]);
create table public.notes (id int primary key, body jsonb);
`);

await db.exec(read("0015_stories.sql"));
await db.exec(storiesOnly(read("0081_reshare_permissions.sql")));
await db.exec(read("0083_story_thumbnails.sql"));
await db.exec(read("0181_story_views_and_screenshots.sql"));
// Supabase grants every public table to these roles by default — policies and revokes decide.
await db.exec("grant all on all tables in schema public to anon, authenticated, service_role;");

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A = U(1), B = U(2), C = U(3), D = U(4), E = U(5), F = U(6), G = U(7), H = U(8), P = U(9), Q = U(10), X = U(11);
await db.exec(`insert into auth.users values ${[A, B, C, D, E, F, G, H, P, Q, X].map((u) => `('${u}')`).join(",")};`);

// Before 0285: the defect. Anyone reads, and a member inserts a story that never ends.
await db.exec(`insert into public.stories (id, user_id, media_url) values ('${U(900)}', '${A}', 'https://media.test/${A}/images/1-a.jpg');`);
const before = await db.query(`set role anon; select count(*)::int n from public.stories;`).catch(() => null);
await db.exec("reset role;");

let failures = 0;
const ok = (c, m) => {
  if (!c) {
    failures++;
    console.log("FAIL:", m);
  } else console.log("ok:", m);
};
ok((await db.query("set role anon")) && (await db.query("select count(*)::int n from public.stories")).rows[0].n === 1, "0. before 0285, anon reads a member's story");
await db.exec("reset role; delete from public.stories;");
void before;

// Apply 0285 twice — it must be re-runnable.
await db.exec(m0285);
await db.exec(m0285);

async function as(role, uid, sql) {
  await db.exec(`reset role; select set_config('test.uid', '${uid ?? ""}', false); set role ${role};`);
  try {
    return { ok: true, rows: (await db.query(sql)).rows };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    await db.exec("reset role; select set_config('test.uid', '', false);");
  }
}
const denied = (r) => !r.ok && /permission denied|row-level security/.test(r.error);

// Profiles and relations.
await db.exec(`
insert into public.profiles (id, handle, visibility, is_suspended, is_hidden) values
  ('${A}', 'ann', 'public', false, false), ('${B}', 'ben', 'public', false, false), ('${C}', 'cy', 'private', false, false),
  ('${D}', 'dee', 'public', true, false), ('${E}', 'eve', 'public', false, true), ('${F}', 'fay', 'followers', false, false),
  ('${G}', 'gus', 'public', false, false), ('${H}', 'hal', 'public', false, false), ('${P}', null, 'public', false, false);
insert into public.blocks values ('${G}', '${B}', null), ('${B}', '${H}', now() - interval '1 hour');
insert into public.user_restrictions values ('${A}', '${Q}', 'status'), ('${A}', '${X}', 'messaging');
insert into public.friendships values ('${A < E ? A : E}', '${A < E ? E : A}');
insert into public.conversations (type, user_low, user_high) values ('direct', '${B < F ? B : F}', '${B < F ? F : B}'), ('group', '${B < C ? B : C}', '${B < C ? C : B}');
`);

// Stories, inserted by the server (service_role) — with forged times that the trigger must replace.
const S = (n) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const svc = await as(
  "service_role",
  null,
  `insert into public.stories (id, user_id, media_url, created_at, expires_at) values
    ('${S(1)}', '${A}', 'https://media.test/${A}/images/1-a.jpg', now() - interval '3 days', '2099-01-01'),
    ('${S(2)}', '${C}', 'https://media.test/${C}/images/2-c.jpg', now(), now()),
    ('${S(3)}', '${D}', 'https://media.test/${D}/images/3-d.jpg', now(), now()),
    ('${S(4)}', '${E}', 'https://media.test/${E}/images/4-e.jpg', now(), now()),
    ('${S(5)}', '${F}', 'https://media.test/${F}/images/5-f.jpg', now(), now()),
    ('${S(6)}', '${G}', 'https://media.test/${G}/images/6-g.jpg', now(), now()),
    ('${S(7)}', '${H}', 'https://media.test/${H}/images/7-h.jpg', now(), now()),
    ('${S(8)}', '${P}', 'https://media.test/${P}/images/8-p.jpg', now(), now())
   returning id, (expires_at - created_at) as life, created_at > now() - interval '1 minute' as fresh`,
);
ok(svc.ok, `1. the server inserts stories (${svc.error ?? "ok"})`);
const s1 = svc.rows?.find((r) => r.id === S(1));
ok(s1 && String(s1.life).startsWith("1 day") || (s1 && /24:00:00/.test(JSON.stringify(s1.life))), `1. a forged 2099 expiry becomes a 24 hour life (${JSON.stringify(s1?.life)})`);
ok(s1?.fresh === true, "1. a forged created_at three days back becomes now");

// ── reads ──
ok(denied(await as("anon", null, "select id from public.stories")), "2. anon cannot read stories at all");
const other = await as("authenticated", B, "select id from public.stories");
ok(other.ok && other.rows.length === 0, `2. a member cannot read another member's stories directly (${other.rows?.length})`);
const own = await as("authenticated", A, "select id from public.stories");
ok(own.ok && own.rows.length === 1 && own.rows[0].id === S(1), "2. a member reads their own story");
ok(denied(await as("anon", null, "select * from public.story_views")), "2. anon cannot read story_views");

// ── writes ──
ok(denied(await as("authenticated", B, `insert into public.stories (user_id, media_url) values ('${B}', 'https://evil.test/x.jpg')`)), "3. a member cannot insert a story directly");
ok(denied(await as("authenticated", B, `insert into public.stories (user_id, media_url, expires_at) values ('${B}', 'https://media.test/${B}/images/9-b.jpg', '2099-01-01')`)), "3. a member cannot insert a forever story");
ok(denied(await as("anon", null, `insert into public.stories (user_id, media_url) values ('${B}', 'https://evil.test/x.jpg')`)), "3. anon cannot insert a story");
ok(denied(await as("authenticated", A, `update public.stories set expires_at = '2099-01-01' where id = '${S(1)}'`)), "3. a member cannot update their story directly");
ok(denied(await as("authenticated", A, `delete from public.stories where id = '${S(1)}'`)), "3. a member cannot delete a row directly (the file would be lost)");
ok(denied(await as("authenticated", B, `insert into public.story_views (story_id, viewer_id) values ('${S(1)}', '${B}')`)), "3. a member cannot forge a view");
const ext = await as("service_role", null, `update public.stories set expires_at = now() + interval '30 days' where id = '${S(6)}' returning (expires_at <= created_at + interval '24 hours') as clamped`);
ok(ext.ok && ext.rows[0]?.clamped === true, "3. even the server cannot extend a story past 24 hours");

// ── story_views author-only read ──
await as("service_role", null, `insert into public.story_views (story_id, viewer_id) values ('${S(1)}', '${B}'), ('${S(1)}', '${G}')`);
const authorViews = await as("authenticated", A, `select viewer_id from public.story_views where story_id = '${S(1)}'`);
ok(authorViews.ok && authorViews.rows.length === 2, "4. the author reads their viewer list");
const viewerViews = await as("authenticated", B, `select viewer_id from public.story_views where story_id = '${S(1)}'`);
ok(viewerViews.ok && viewerViews.rows.length === 0, "4. a viewer cannot read the author's viewer list");

// ── story_view_access ──
const access = async (story, viewer) => (await db.query(`select public.story_view_access('${story}', '${viewer}') as v`)).rows[0].v;
const cases = [
  ["5. own story", S(1), A, "self"],
  ["5. public author, stranger", S(1), B, "ok"],
  ["5. private author, stranger", S(2), B, "forbidden"],
  ["5. suspended author", S(3), B, "forbidden"],
  ["5. hidden author, stranger", S(4), B, "forbidden"],
  ["5. hidden author, friend", S(4), A, "ok"],
  ["5. followers-only author, shares a direct chat", S(5), B, "ok"],
  ["5. followers-only author, a group chat is not enough", S(2), B, "forbidden"],
  ["5. the author blocked the viewer", S(6), B, "forbidden"],
  ["5. the viewer blocked the author (expired block row still counts)", S(7), B, "forbidden"],
  ["5. status restriction (author restricted viewer)", S(1), Q, "forbidden"],
  ["5. a messaging-only restriction does not hide a story", S(1), X, "ok"],
  ["5. author with no handle", S(8), B, "forbidden"],
  ["5. unknown story", S(99), B, "missing"],
];
for (const [label, story, viewer, want] of cases) {
  const got = await access(story, viewer);
  ok(got === want, `${label} -> ${got}${got === want ? "" : ` (want ${want})`}`);
}

// ── expire_own_story ──
const notMine = await as("authenticated", B, `select public.expire_own_story('${S(1)}') as v`);
ok(notMine.ok && notMine.rows[0].v === false, "6. a member cannot end someone else's story");
ok(await access(S(1), B) === "ok", "6. ...and it is still live");
const mine = await as("authenticated", A, `select public.expire_own_story('${S(1)}') as v`);
ok(mine.ok && mine.rows[0].v === true, "6. the author ends their own story");
ok(await access(S(1), B) === "expired", "6. an ended story is expired for every viewer at once");
const revive = await as("service_role", null, `update public.stories set expires_at = now() + interval '1 hour' where id = '${S(1)}' returning expires_at <= now() as still_ended`);
ok(revive.ok && revive.rows[0]?.still_ended === true, "6. an ended story cannot be revived");
ok(denied(await as("anon", null, `select public.expire_own_story('${S(1)}')`)), "6. anon cannot call expire_own_story");

// ── story_media_references ──
const url = (o, n) => `https://media.test/${o}/images/${n}.jpg`;
await db.exec(`
insert into public.posts (media_url, thumbnail_url) values ('${url(A, "post")}', '${url(A, "thumb")}');
insert into public.post_media values (gen_random_uuid(), 1, '${url(A, "album")}', null);
insert into public.message_attachments (media_url) values ('${url(A, "chat")}');
insert into public.galleries values (1, array['${url(A, "gallery")}']);
insert into public.notes values (1, '{"u": "${url(A, "json")}"}');
`);
await as("service_role", null, `insert into public.stories (id, user_id, media_url, thumbnail_url) values ('${S(20)}', '${B}', '${url(A, "shared")}', null), ('${S(21)}', '${A}', '${url(A, "shared")}', null)`);
const refs = async (urls, exclude) =>
  (await db.query(`select * from public.story_media_references($1::text[], $2::uuid[]) as u order by 1`, [urls, exclude])).rows.map((r) => r.u);
const all = [url(A, "post"), url(A, "thumb"), url(A, "album"), url(A, "chat"), url(A, "gallery"), url(A, "json"), url(A, "free"), url(A, "shared")];
const found = await refs(all, [S(21)]);
ok(found.includes(url(A, "post")) && found.includes(url(A, "thumb")), "7. a feed post's media and cover are in use");
ok(found.includes(url(A, "album")), "7. an album item is in use");
ok(found.includes(url(A, "chat")), "7. a chat attachment is in use");
ok(found.includes(url(A, "gallery")), "7. a text[] *_urls column is read");
ok(found.includes(url(A, "shared")), "7. another story using the same file keeps it");
ok(!found.includes(url(A, "free")), "7. an unused file is free to delete");
ok(!found.includes(url(A, "json")), "7. jsonb is NOT read (documented limitation)");
const both = await refs([url(A, "shared")], [S(20), S(21)]);
ok(both.length === 0, "7. the rows being swept do not keep their own file alive");
ok(denied(await as("authenticated", A, `select * from public.story_media_references(array['x'], '{}'::uuid[])`)), "7. a member cannot call story_media_references");
ok(denied(await as("authenticated", A, `select public.story_view_access('${S(1)}', '${B}')`)), "7. a member cannot call story_view_access");

// ── the policy set ──
const pols = (await db.query(`select polname from pg_policy where polrelid = 'public.stories'::regclass order by polname`)).rows.map((r) => r.polname);
ok(JSON.stringify(pols) === JSON.stringify(["stories owner read"]), `8. stories policies after 0285: ${pols.join(" | ")}`);
const defs = (await db.query(`select proname, prosecdef, proconfig from pg_proc where proname in ('story_view_access', 'story_media_references', 'expire_own_story') order by proname`)).rows;
ok(defs.length === 3 && defs.every((d) => d.prosecdef && (d.proconfig ?? []).some((c) => c.startsWith("search_path="))), "8. the three functions are SECURITY DEFINER with a pinned search_path");

console.log(failures ? `\n${failures} FAILED${MUTANT ? ` (mutant ${MUTANT})` : ""}` : `\nALL OK${MUTANT ? ` (mutant ${MUTANT} survived — the harness has no teeth for it)` : ""}`);
process.exit(failures ? 1 : 0);
