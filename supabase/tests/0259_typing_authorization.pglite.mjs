// PGlite harness for 0259 + 0260 (typing indicator authorization, 2026-10-18).
// Run from %TEMP%\pgt (where @electric-sql/pglite is installed) — copy this file there, then:
//   node 0259_typing_authorization.pglite.mjs <repo>/supabase/migrations [--mutant=<name>]
//
// Uses the REAL pieces: the old typing policies cut from 0066 and 0120, is_conversation_member (0052),
// and the WHOLE 0259 and 0260 files (each applied twice — they must be re-runnable). Access is
// checked the way Realtime authorizes a private channel: as role `authenticated` with the caller's
// uid and `realtime.topic` set, a SELECT (join / receive) and an INSERT (track) on realtime.messages.
//
// Ownership: a NON-superuser, NOBYPASSRLS role (`migrator`) owns the tables, the policies and the
// helper, and blocks / user_restrictions keep their real "self only" RLS — so "they blocked me" is
// only visible because the helper's owner owns those tables. PGlite cannot establish who owns these
// objects in production — check that live (proowner vs tableowner) after the migration applies.
// realtime.topic() is stubbed as an inlinable SQL function reading the `realtime.topic` setting.
//
// Mutants (each must FAIL):
//   noblock        the blocks check is removed from the helper
//   norestrict     the messaging-restriction check is removed
//   noleft         removed members (left_at) are not excluded
//   noguard        segments are cast without the uuid check
//   keep-old       0260 leaves the four old policies in place
//   foreign-owner  the tables belong to a different role than the helper (RLS then hides blocks)
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const dir = process.argv[2];
const MUTANT = (process.argv.find((a) => a.startsWith("--mutant=")) ?? "").split("=")[1] ?? "";
const read = (f) => readFileSync(`${dir}/${f}`, "utf8");
const realFn = (f, name) => {
  const s = read(f);
  const a = s.indexOf(`create or replace function public.${name}(`);
  if (a < 0) throw new Error(`no ${name} in ${f}`);
  const tail = s.slice(a);
  const tag = /as (\$[a-z]*\$)/i.exec(tail)[1];
  const open = tail.indexOf(tag);
  const close = tail.indexOf(tag, open + tag.length);
  return tail.slice(0, close + tag.length) + ";";
};
const realPolicy = (f, name) => {
  const s = read(f);
  const a = s.indexOf(`create policy "${name}" on realtime.messages`);
  if (a < 0) throw new Error(`no policy ${name} in ${f}`);
  return s.slice(a, s.indexOf(");", a) + 2);
};
const mutate = (sql, from, to, name) => {
  if (!sql.includes(from)) throw new Error(`mutant ${name} did not apply`);
  return sql.replace(from, to);
};

const OLD = [
  realPolicy("0066_fix_typing_presence_broadcast_extension.sql", "typing presence conversation members"),
  realPolicy("0066_fix_typing_presence_broadcast_extension.sql", "typing presence conversation members write"),
  realPolicy("0120_comment_realtime.sql", "typing presence comment post visible"),
  realPolicy("0120_comment_realtime.sql", "typing presence comment post visible write"),
].join("\n");

let m0259 = read("0259_typing_topic_allowed.sql");
let m0260 = read("0260_typing_presence_policies.sql");
if (MUTANT === "noblock") m0259 = mutate(m0259, "if exists (\n    select 1 from public.blocks b", "if false and exists (\n    select 1 from public.blocks b", MUTANT);
if (MUTANT === "norestrict") m0259 = mutate(m0259, "if exists (\n    select 1 from public.user_restrictions r", "if false and exists (\n    select 1 from public.user_restrictions r", MUTANT);
if (MUTANT === "noleft") m0259 = mutate(m0259, "    and cm.left_at is null\n", "\n", MUTANT);
if (MUTANT === "noguard") {
  m0259 = mutate(m0259, "v_parts[3] is null or v_parts[3] !~ uuid_re", "false", MUTANT);
  m0259 = mutate(m0259, "v_parts[2] is null or v_parts[2] !~ uuid_re", "false", MUTANT);
}
if (MUTANT === "keep-old") m0260 = m0260.split("\n").filter((l) => !/^drop policy if exists "typing presence (conversation|comment)/.test(l)).join("\n");

const db = new PGlite();
const TABLE_OWNER = MUTANT === "foreign-owner" ? "other_owner" : "migrator";
await db.exec(`
create role anon; create role authenticated; create role service_role;
create role migrator nosuperuser nobypassrls; create role other_owner nosuperuser nobypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create schema realtime authorization migrator;
grant usage on schema auth to anon, authenticated, service_role, migrator, other_owner;
grant create, usage on schema public to migrator, other_owner;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema realtime to anon, authenticated;
grant migrator to postgres; grant other_owner to postgres;`);

// realtime.messages + the realtime.topic() stub belong to the migration role (it creates policies on them).
await db.exec(`set role migrator;
create function realtime.topic() returns text language sql stable as $$ select nullif(current_setting('realtime.topic', true), '')::text $$;
create table realtime.messages (id bigserial primary key, topic text not null, extension text not null);
alter table realtime.messages enable row level security;
grant select, insert on realtime.messages to anon, authenticated;
grant usage, select on sequence realtime.messages_id_seq to anon, authenticated;
-- an unrelated Realtime policy that 0260 must NOT remove
create policy "unrelated broadcast policy" on realtime.messages for select to authenticated using (realtime.messages.extension = 'broadcast' and realtime.topic() = 'announcements');
reset role;`);

// The application tables, owned by TABLE_OWNER, with their real "self only" RLS on blocks/restrictions.
await db.exec(`set role ${TABLE_OWNER};
create table public.conversations (id uuid primary key, type text not null check (type in ('direct', 'group', 'secret')), user_low uuid, user_high uuid);
create table public.conversation_members (conversation_id uuid not null, user_id uuid not null, left_at timestamptz, primary key (conversation_id, user_id));
create table public.posts (id uuid primary key, status text not null);
create table public.blocks (blocker_id uuid not null, blocked_id uuid not null, expires_at timestamptz, primary key (blocker_id, blocked_id));
create table public.user_restrictions (restrictor_id uuid not null, restricted_id uuid not null, scope text not null, primary key (restrictor_id, restricted_id, scope));
alter table public.blocks enable row level security;
create policy "blocks self all" on public.blocks for all using (auth.uid() = blocker_id) with check (auth.uid() = blocker_id);
alter table public.user_restrictions enable row level security;
create policy "user_restrictions self all" on public.user_restrictions for all using (auth.uid() = restrictor_id) with check (auth.uid() = restrictor_id);
alter table public.conversation_members enable row level security;
alter table public.conversations enable row level security;
alter table public.posts enable row level security;
create policy "posts public read" on public.posts for select using (true);
grant select on public.conversations, public.conversation_members, public.posts, public.blocks, public.user_restrictions to authenticated, migrator;
reset role;`);

// The OLD typing policies, as they are today (0066 + 0120), plus is_conversation_member (0052).
await db.exec(`set role migrator; ${realFn("0052_fix_membership_rls_recursion.sql", "is_conversation_member")} ${OLD} reset role;`);

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A = U(1), B = U(2), C = U(3), D = U(4), E = U(5), F = U(6), G = U(7), H = U(8), X = U(9);
const CV = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const pair = (p, q) => (p < q ? [p, q] : [q, p]);
const direct = (id, p, q, type = "direct") => `('${id}', '${type}', '${pair(p, q)[0]}', '${pair(p, q)[1]}')`;
const dAB = CV(1), dAC = CV(2), dAD = CV(3), dAE = CV(4), dAF = CV(5), dAG = CV(6), dAX = CV(7), grp = CV(8), sAB = CV(9), sAC = CV(10), dAH = CV(11);
const POST_PUB = U(101), POST_DRAFT = U(102), POST_NONE = U(103);
await db.exec(`
insert into public.posts values ('${POST_PUB}', 'published'), ('${POST_DRAFT}', 'draft');
insert into public.conversations values ${direct(dAB, A, B)}, ${direct(dAC, A, C)}, ${direct(dAD, A, D)}, ${direct(dAE, A, E)}, ${direct(dAF, A, F)},
  ${direct(dAG, A, G)}, ${direct(dAX, A, X)}, ('${grp}', 'group', null, null), ${direct(sAB, A, B, "secret")}, ${direct(sAC, A, C, "secret")}, ${direct(dAH, A, H)};
insert into public.conversation_members (conversation_id, user_id, left_at) values
  ('${dAB}', '${A}', null), ('${dAB}', '${B}', null),
  ('${dAC}', '${A}', null), ('${dAC}', '${C}', null),
  ('${dAD}', '${A}', null), ('${dAD}', '${D}', null),
  ('${dAE}', '${A}', null), ('${dAE}', '${E}', null),
  ('${dAF}', '${A}', null), ('${dAF}', '${F}', null),
  ('${dAG}', '${A}', null), ('${dAG}', '${G}', null),
  ('${dAX}', '${A}', null), ('${dAX}', '${X}', null),
  ('${dAH}', '${A}', null), ('${dAH}', '${H}', now()),
  ('${grp}', '${A}', null), ('${grp}', '${C}', null), ('${grp}', '${E}', now()),
  ('${sAB}', '${A}', null), ('${sAB}', '${B}', null),
  ('${sAC}', '${A}', null), ('${sAC}', '${C}', null);
-- C blocked A · A blocked D (permanent) · G blocked A temporarily, ALREADY EXPIRED but not yet swept
insert into public.blocks values ('${C}', '${A}', null), ('${A}', '${D}', null), ('${G}', '${A}', now() - interval '1 hour');
-- A restricted X for messaging · F restricted A for messaging · B restricted A for status and calls only
insert into public.user_restrictions values ('${A}', '${X}', 'messaging'), ('${F}', '${A}', 'messaging'), ('${B}', '${A}', 'status'), ('${B}', '${A}', 'calls');`);

const lit = (s) => (s === null ? "null" : `'${s.replaceAll("'", "''")}'`);
/** Realtime's two checks for a private channel: may this caller receive (SELECT) and track (INSERT)? */
async function access(uid, topic, role = "authenticated") {
  const out = [];
  for (const kind of ["read", "write"]) {
    await db.exec(`reset role; delete from realtime.messages; insert into realtime.messages (topic, extension) values (${lit(topic ?? "")}, 'presence');`);
    try {
      await db.exec(`set role ${role}; select set_config('test.uid', ${lit(uid)}, false), set_config('realtime.topic', ${lit(topic ?? "")}, false);`);
      if (kind === "read") {
        const r = await db.query("select count(*)::int n from realtime.messages where topic = realtime.topic()");
        out.push(r.rows[0].n > 0 ? "allow" : "deny");
      } else {
        await db.query(`insert into realtime.messages (topic, extension) values (${lit(topic ?? "")}, 'presence')`);
        out.push("allow");
      }
    } catch (e) {
      out.push(/row-level security|permission denied/.test(e.message) ? "deny" : `ERROR(${e.message.slice(0, 50)})`);
    } finally {
      await db.exec("reset role; select set_config('test.uid', '', false), set_config('realtime.topic', '', false)");
    }
  }
  return out[0] === out[1] ? out[0] : `${out[0]}/${out[1]}`;
}

let failures = 0;
const ok = (c, m) => { if (!c) { failures++; console.log("FAIL:", m); } else console.log("ok:", m); };

// 0 · today's policies (before 0259/0260): the defect this fixes
const before = await access(A, `typing:${dAB}`);
ok(before.startsWith("ERROR"), `0. before the fix, a member's chat topic errors instead of authorizing (${before})`);

// apply 0259 then 0260 as the migration role — twice each (re-runnable)
await db.exec(`set role migrator; ${m0259} reset role;`);
await db.exec(`set role migrator; ${m0259} reset role;`);
await db.exec(`set role migrator; ${m0260} reset role;`);
await db.exec(`set role migrator; ${m0260} reset role;`);

const cases = [
  ["1. direct, unblocked member A", A, `typing:${dAB}`, "allow"],
  ["1. direct, unblocked member B", B, `typing:${dAB}`, "allow"],
  ["1. uppercase conversation id (valid uuid)", A, `typing:${dAB.toUpperCase()}`, "allow"],
  ["2. direct, the OTHER person blocked me (C blocked A), as A", A, `typing:${dAC}`, "deny"],
  ["2. direct, I blocked them (C blocked A), as C", C, `typing:${dAC}`, "deny"],
  ["2. direct, A blocked D, as A", A, `typing:${dAD}`, "deny"],
  ["2. direct, A blocked D, as D", D, `typing:${dAD}`, "deny"],
  ["2. direct, EXPIRED block row not yet swept (as messaging treats it)", A, `typing:${dAG}`, "deny"],
  ["3. direct, A restricted X for messaging, as A", A, `typing:${dAX}`, "deny"],
  ["3. direct, A restricted X for messaging, as X", X, `typing:${dAX}`, "deny"],
  ["3. direct, F restricted A for messaging, as A", A, `typing:${dAF}`, "deny"],
  ["3. direct, status/calls-only restriction does not deny", A, `typing:${dAB}`, "allow"],
  ["4. secret, unblocked members", B, `typing:${sAB}`, "allow"],
  ["4. secret, blocked pair (C blocked A), as A", A, `typing:${sAC}`, "deny"],
  ["4. secret, blocked pair (C blocked A), as C", C, `typing:${sAC}`, "deny"],
  ["5. group, active member A", A, `typing:${grp}`, "allow"],
  ["5. group, active member C, though C blocked A (group semantics kept)", C, `typing:${grp}`, "allow"],
  ["5. group, removed member E", E, `typing:${grp}`, "deny"],
  ["5. group, non-member B", B, `typing:${grp}`, "deny"],
  ["6. direct, removed member H", H, `typing:${dAH}`, "deny"],
  ["6. direct, non-member D in A-B", D, `typing:${dAB}`, "deny"],
  ["6. unknown conversation id", A, `typing:${CV(99)}`, "deny"],
  ["7. malformed: typing:not-a-uuid", A, "typing:not-a-uuid", "deny"],
  ["7. malformed: typing:", A, "typing:", "deny"],
  ["7. malformed: typing::", A, "typing::", "deny"],
  ["7. malformed: typing", A, "typing", "deny"],
  ["7. malformed: empty topic", A, "", "deny"],
  ["7. malformed: extra segment", A, `typing:${dAB}:x`, "deny"],
  ["7. malformed: braced uuid", A, `typing:{${dAB}}`, "deny"],
  ["7. malformed: trailing newline", A, `typing:${dAB}\n`, "deny"],
  ["7. malformed: quote and semicolon junk", A, "typing:'; select 1; --", "deny"],
  ["7. other prefix", A, `presence:${dAB}`, "deny"],
  ["8. comment, published post", B, `typing:comments:${POST_PUB}`, "allow"],
  ["8. comment, draft post", B, `typing:comments:${POST_DRAFT}`, "deny"],
  ["8. comment, unknown post", B, `typing:comments:${POST_NONE}`, "deny"],
  ["8. comment, malformed id", B, "typing:comments:nope", "deny"],
  ["8. comment, empty id", B, "typing:comments:", "deny"],
];
for (const [label, uid, topic, want] of cases) {
  const got = await access(uid, topic);
  ok(got === want, `${label} -> ${got}${got === want ? "" : ` (want ${want})`}`);
}

// 9 · roles and grants
ok((await access(A, `typing:${dAB}`, "anon")) === "deny", "9. anon is denied");
ok((await access("", `typing:${dAB}`)) === "deny", "9. no auth.uid() is denied");
const acl = (await db.query(`select
  has_function_privilege('anon', 'public.typing_topic_allowed(text)', 'execute') as anon,
  has_function_privilege('authenticated', 'public.typing_topic_allowed(text)', 'execute') as auth,
  has_function_privilege('service_role', 'public.typing_topic_allowed(text)', 'execute') as svc`)).rows[0];
ok(acl.anon === false && acl.auth === true && acl.svc === true, `9. EXECUTE: anon ${acl.anon}, authenticated ${acl.auth}, service_role ${acl.svc}`);
const def = (await db.query(`select prosecdef, proconfig, proowner::regrole::text as owner from pg_proc where proname = 'typing_topic_allowed'`)).rows[0];
ok(def.prosecdef === true && (def.proconfig ?? []).some((c) => c.startsWith("search_path=")), `9. SECURITY DEFINER with a pinned search_path (owner ${def.owner})`);

// 10 · the policy set: exactly the two new typing policies, the unrelated one untouched
const pols = (await db.query(`select polname from pg_policy where polrelid = 'realtime.messages'::regclass order by polname`)).rows.map((r) => r.polname);
ok(
  JSON.stringify(pols) === JSON.stringify(["typing presence topic allowed", "typing presence topic allowed write", "unrelated broadcast policy"]),
  `10. realtime.messages policies after 0260: ${pols.join(" | ")}`,
);

console.log(failures ? `\n${failures} FAILED${MUTANT ? ` (mutant ${MUTANT})` : ""}` : `\nALL OK${MUTANT ? ` (mutant ${MUTANT} survived — the harness has no teeth for it)` : ""}`);
process.exit(failures ? 1 : 0);
