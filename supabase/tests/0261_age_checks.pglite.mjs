// PGlite harness for 0261 (age checks + Mature exclusive posts, 2026-10-18).
// Run from a folder where @electric-sql/pglite is installed — copy this file there, then:
//   node 0261_age_checks.pglite.mjs <repo>/supabase/migrations [--mutant=<name>]
//
// Applies the WHOLE 0261 file twice (it must be re-runnable) on top of a minimal sub_posts, then
// proves, as role `authenticated` with a caller uid:
//   · a member reads their OWN age_checks row and nobody else's, and can never insert, update or
//     delete one (the server writes with the service role);
//   · the table can't hold a date of birth (no such column), a result other than adult/minor, a
//     minor without the day they turn 18, or an adult WITH a date;
//   · sub_posts.mature exists, defaults to false, and existing posts are not Mature.
//
// Mutants (each must FAIL):
//   open-read     the select policy lets anyone read every row
//   write-policy  an insert policy lets a member write their own row
//   no-eligible   the minor-needs-a-date constraint is removed
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const dir = process.argv[2];
const MUTANT = (process.argv.find((a) => a.startsWith("--mutant=")) ?? "").split("=")[1] ?? "";
let sql = readFileSync(`${dir}/0261_age_checks.sql`, "utf8");
const mutate = (from, to) => {
  if (!sql.includes(from)) throw new Error(`mutant ${MUTANT} did not apply`);
  sql = sql.replace(from, to);
};
if (MUTANT === "open-read") mutate("for select using ((select auth.uid()) = user_id)", "for select using (true)");
if (MUTANT === "write-policy") mutate("alter table public.sub_posts add column", `drop policy if exists "age checks own insert" on public.age_checks;\ncreate policy "age checks own insert" on public.age_checks for insert with check ((select auth.uid()) = user_id);\nalter table public.sub_posts add column`);
if (MUTANT === "no-eligible") mutate("alter table public.age_checks add constraint age_checks_eligible_chk", "-- removed\n    perform 1; --");

const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
create table public.sub_posts (id uuid primary key default gen_random_uuid(), creator_id uuid not null, status text not null default 'published');
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;`);

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const A = U(1), B = U(2), C = U(3);
await db.exec(`insert into auth.users values ('${A}'), ('${B}'), ('${C}'); insert into public.sub_posts (creator_id) values ('${A}');`);

await db.exec(sql);
await db.exec(sql); // re-runnable
await db.exec(`grant all on public.age_checks to anon, authenticated, service_role;`);

let failed = 0;
const check = (name, ok) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failed++;
};
const as = async (uid, q) => {
  await db.exec(`set role authenticated; select set_config('test.uid', '${uid}', false);`);
  try {
    return await db.query(q);
  } finally {
    await db.exec("reset role;");
  }
};
const throws = async (fn) => {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
};

// the server (superuser here, the service role in production) records answers
await db.exec(`insert into public.age_checks (user_id, result, eligible_on) values ('${A}', 'adult', null), ('${B}', 'minor', '2030-01-01');`);

check("a member reads their own row", (await as(A, `select result from public.age_checks`)).rows.length === 1);
check("…and only their own", (await as(A, `select user_id from public.age_checks where user_id = '${B}'`)).rows.length === 0);
const ins = await throws(() => as(B, `insert into public.age_checks (user_id, result) values ('${B}', 'adult') on conflict (user_id) do update set result = 'adult', eligible_on = null`));
const after = (await db.query(`select result from public.age_checks where user_id = '${B}'`)).rows[0].result;
check("a member can't write their own answer (a minor can't make themselves adult)", ins && after === "minor");
// a member who has never answered can't write a first answer either (the server is the only writer)
const fresh = await throws(() => as(C, `insert into public.age_checks (user_id, result) values ('${C}', 'adult')`));
check("a member with no answer can't insert one", fresh && (await db.query(`select 1 from public.age_checks where user_id = '${C}'`)).rows.length === 0);
await as(B, `update public.age_checks set result = 'adult', eligible_on = null where user_id = '${B}'`).catch(() => {});
check("…nor update it", (await db.query(`select result from public.age_checks where user_id = '${B}'`)).rows[0].result === "minor");
await as(B, `delete from public.age_checks where user_id = '${B}'`).catch(() => {});
check("…nor delete it", (await db.query(`select 1 from public.age_checks where user_id = '${B}'`)).rows.length === 1);

const cols = (await db.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'age_checks'`)).rows.map((r) => r.column_name);
check("no column can hold a date of birth", !cols.some((c) => /birth|dob/.test(c)) && cols.length === 5);
check("only adult or minor", await throws(() => db.exec(`update public.age_checks set result = 'teen' where user_id = '${A}'`)));
check("a minor must carry the day they turn 18", await throws(() => db.exec(`update public.age_checks set eligible_on = null where user_id = '${B}'`)));
check("an adult carries no date", await throws(() => db.exec(`update public.age_checks set eligible_on = '2020-01-01' where user_id = '${A}'`)));
check("only the self-declared method exists", await throws(() => db.exec(`update public.age_checks set method = 'id_document' where user_id = '${A}'`)));

const mature = (await db.query(`select mature from public.sub_posts`)).rows;
check("existing posts are not Mature", mature.length === 1 && mature[0].mature === false);

console.log(failed ? `\n${failed} check(s) FAILED${MUTANT ? ` (mutant ${MUTANT})` : ""}` : `\nall checks passed${MUTANT ? ` — mutant ${MUTANT} SURVIVED` : ""}`);
process.exit(failed ? 1 : MUTANT ? 2 : 0);
