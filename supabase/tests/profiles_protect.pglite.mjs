// PGlite harness for 0257 (Part 13): an end user can't change the server-controlled fields of their own
// profile. Run from %TEMP%\pgt (where @electric-sql/pglite is installed):
//   node profiles_protect.pglite.mjs <repo>/supabase/migrations [--mutant=<name>]
// Uses the REAL pieces: the "profiles self update" policy text (0001), profiles_protect_role (0144) and
// bump_follow_counts + its trigger (0006), cut from their migrations. The attack is the one the REST API
// allows: `set role authenticated` with that user's id, then UPDATE their own row. 0257 is applied TWICE.
// Mutants (each must FAIL):
//   no-trigger   0257's trigger is dropped
//   no-depth     the counts are reverted at every depth (following stops counting)
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const dir = process.argv[2];
const MUTANT = (process.argv.find((a) => a.startsWith("--mutant=")) ?? "").split("=")[1] ?? "";
const realFn = (f, name) => {
  const s = readFileSync(`${dir}/${f}`, "utf8");
  const a = s.indexOf(`create or replace function public.${name}(`);
  if (a < 0) throw new Error(`no ${name} in ${f}`);
  const tail = s.slice(a);
  const tag = /as (\$[a-z]*\$)/i.exec(tail)[1];
  const open = tail.indexOf(tag);
  const close = tail.indexOf(tag, open + tag.length);
  return tail.slice(0, close + tag.length) + ";";
};

const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create table public.profiles (id uuid primary key references auth.users (id), handle text, display_name text, bio text,
  role text not null default 'free', is_admin boolean not null default false,
  is_suspended boolean not null default false, is_hidden boolean not null default false, hidden_at timestamptz, hidden_by uuid,
  is_verified boolean not null default false, trust_score integer not null default 50, reputation_bonus integer not null default 0,
  followers_count int not null default 0, following_count int not null default 0);
create table public.follows (follower_id uuid not null references auth.users (id), following_id uuid not null references auth.users (id),
  created_at timestamptz not null default now(), primary key (follower_id, following_id), constraint follows_no_self check (follower_id <> following_id));
alter table public.profiles enable row level security;
alter table public.follows enable row level security;
create policy "profiles public read" on public.profiles for select using (true);
create policy "profiles self update" on public.profiles for update using (auth.uid() = id);
create policy "follows self write" on public.follows for insert with check (auth.uid() = follower_id);
create policy "follows self delete" on public.follows for delete using (auth.uid() = follower_id);
create policy "follows read" on public.follows for select using (true);
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;`);
await db.exec(realFn("0144_admin_flag.sql", "profiles_protect_role"));
await db.exec("create trigger profiles_protect_role before update on public.profiles for each row execute function public.profiles_protect_role()");
await db.exec(realFn("0006_social_identity.sql", "bump_follow_counts"));
await db.exec("create trigger follows_count_trg after insert or delete on public.follows for each row execute function public.bump_follow_counts()");

let sql = readFileSync(`${dir}/0257_profiles_protect_server_fields.sql`, "utf8");
if (MUTANT === "no-depth") {
  const m = sql.replace("if pg_trigger_depth() <= 1 then", "if true then");
  if (m === sql) throw new Error("mutant no-depth did not apply");
  sql = m;
}
await db.exec(sql);
await db.exec(sql);
if (MUTANT === "no-trigger") await db.exec("drop trigger profiles_protect_server_fields on public.profiles");

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A = U(1), B = U(2), ADMIN = U(9);
await db.exec(`insert into auth.users values ('${A}'), ('${B}'), ('${ADMIN}')`);
await db.exec(`insert into profiles (id, handle, display_name, is_suspended, is_hidden, hidden_at, hidden_by) values
  ('${A}', 'a', 'Amaka', true, true, now(), '${ADMIN}'), ('${B}', 'b', 'Bola', false, false, null, null), ('${ADMIN}', 'admin', 'Admin', false, false, null, null)`);

const q = async (s, p) => (await db.query(s, p)).rows;
const one = async (s, p) => (await q(s, p))[0];
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; console.log("FAIL:", m); } else console.log("ok:", m); };
const as = async (uid, fn) => { await db.exec(`set role authenticated; select set_config('test.uid', '${uid}', false)`); try { return await fn(); } finally { await db.exec("reset role; select set_config('test.uid', '', false)"); } };
const row = (id) => one("select * from profiles where id = $1", [id]);

// 1 · the attack: a suspended, hidden user PATCHes their own row
await as(A, () => db.exec(`update profiles set is_suspended = false, is_hidden = false, hidden_at = null, hidden_by = null, is_verified = true, trust_score = 100, reputation_bonus = 999, followers_count = 1000000, following_count = 5, display_name = 'Amaka B', bio = 'hi' where id = '${A}'`));
const a1 = await row(A);
ok(a1.is_suspended === true && a1.is_hidden === true && a1.hidden_at !== null && a1.hidden_by === ADMIN, "1. a suspended, hidden user can't lift their own suspension or hide");
ok(a1.is_verified === false && a1.trust_score === 50 && a1.reputation_bonus === 0, "1. ...nor give themselves the verified badge, trust or reputation");
ok(a1.followers_count === 0 && a1.following_count === 0, "1. ...nor fake their follower counts");
ok(a1.display_name === "Amaka B" && a1.bio === "hi", "1. the fields a user really owns still save in the same request");

// 2 · role / admin stay protected (0144, unchanged)
await as(B, () => db.exec(`update profiles set role = 'admin', is_admin = true where id = '${B}'`));
ok((await row(B)).is_admin === false && (await row(B)).role === "free", "2. self-promotion to admin is still refused (profiles_protect_role untouched)");

// 3 · another user's row: RLS, as before
await as(B, () => db.exec(`update profiles set is_suspended = true, display_name = 'hacked' where id = '${A}'`));
ok((await row(A)).display_name === "Amaka B", "3. a user still can't touch someone else's row at all");

// 4 · following still counts (the trigger's nested updates are allowed)
await as(B, () => db.exec(`insert into follows (follower_id, following_id) values ('${B}', '${A}')`));
ok((await row(A)).followers_count === 1 && (await row(B)).following_count === 1, "4. following still counts (the follow trigger's nested update goes through)");
await as(B, () => db.exec(`delete from follows where follower_id = '${B}' and following_id = '${A}'`));
ok((await row(A)).followers_count === 0 && (await row(B)).following_count === 0, "4. ...and unfollowing still un-counts");

// 5 · the server (service role / admin client: no auth.uid()) still moderates
await db.exec(`update profiles set is_suspended = false, is_hidden = false, hidden_at = null, hidden_by = null, is_verified = true, trust_score = 80 where id = '${A}'`);
const a5 = await row(A);
ok(a5.is_suspended === false && a5.is_hidden === false && a5.is_verified === true && a5.trust_score === 80, "5. a server-side update (no end-user session) still suspends, unhides, verifies and scores");
await db.exec(`update profiles set followers_count = 42 where id = '${A}'`);
ok((await row(A)).followers_count === 42, "5. the admin stats correction still sets a count");

// 6 · the trigger function itself is not callable by clients
const fnAcl = await one("select has_function_privilege('authenticated', 'public.profiles_protect_server_fields()', 'execute') as can");
ok(fnAcl.can === false, "6. clients can't execute the trigger function");

console.log(failures ? `\n${failures} FAILED` : "\nALL OK");
process.exit(failures ? 1 : 0);
