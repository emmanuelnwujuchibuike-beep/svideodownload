// PGlite harness for 0253 (Part 11). Run from %TEMP%\pgt:
//   node t0253.mjs <repo>/supabase/migrations <path-to-0253.sql> [--mutant]
// Applies 0046 for real, inserts rows that exist BEFORE 0253, applies 0253 TWICE, then checks.
// --mutant applies a broken 0253 (no default, no hash check, no per-user unique, no revoke): must FAIL.
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const dir = process.argv[2];
const file = process.argv[3];
const MUTANT = process.argv.includes("--mutant");
const stub = `
create role anon; create role authenticated; create role service_role;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
grant usage on schema public to anon, authenticated;`;
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
await run(db, readFileSync(`${dir}/0046_notification_settings.sql`, "utf8"));
await db.exec(`grant select, insert, update, delete on public.notification_settings to authenticated`);
// rows that exist before 0253: A has settings (digest off), B has none
await db.exec(`insert into notification_settings (user_id, push_enabled) values ('${A}', false)`);

let sql = readFileSync(file, "utf8");
if (MUTANT) sql = sql.replace("boolean not null default true", "boolean").replace(/create unique index if not exists email_unsubscribe_tokens_user_uidx[^;]*;/, "").replace(/revoke all on table public.email_unsubscribe_tokens[^;]*;/, "grant all on table public.email_unsubscribe_tokens to anon, authenticated;");
if (MUTANT) sql = sql.slice(0, sql.indexOf("do $$"));
await run(db, sql);
await run(db, sql);

const q = async (s) => (await db.query(s)).rows;
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; console.log("FAIL:", m); } else console.log("ok:", m); };
const throws = async (s) => { try { await db.exec(s); return false; } catch { return true; } };
const H = (c) => c.repeat(64);

// existing row: untouched, and optional email reads as allowed (nobody had a global switch to turn off)
const a = (await q(`select push_enabled, optional_email from notification_settings where user_id = '${A}'`))[0];
ok(a && a.push_enabled === false && a.optional_email === true, "existing row keeps its values; optional_email defaults to true");
// the unsubscribe path upserts a row with only this column
await db.exec(`insert into notification_settings (user_id, optional_email) values ('${B}', false) on conflict (user_id) do update set optional_email = excluded.optional_email`);
const b = (await q(`select master_enabled, push_enabled, optional_email from notification_settings where user_id = '${B}'`))[0];
ok(b && b.master_enabled === true && b.push_enabled === true && b.optional_email === false, "a minimal upsert creates a row with every other default intact");
ok(await throws(`update notification_settings set optional_email = null where user_id = '${A}'`), "optional_email can't be null");

// tokens
await db.exec(`insert into email_unsubscribe_tokens (token_hash, user_id) values ('${H("a")}', '${A}')`);
ok(await throws(`insert into email_unsubscribe_tokens (token_hash, user_id) values ('not-a-hash', '${C}')`), "only a sha-256 hex digest is stored");
ok(await throws(`insert into email_unsubscribe_tokens (token_hash, user_id) values ('${H("b")}', '${A}')`), "one token row per member");
ok(await throws(`insert into email_unsubscribe_tokens (token_hash, user_id) values ('${H("a")}', '${C}')`), "a token maps to one member");

// RLS / grants: clients can't read or write tokens, and a member can't change someone else's settings
await db.exec(`set role authenticated; select set_config('test.uid', '${C}', false)`);
ok(await throws(`select * from email_unsubscribe_tokens`), "authenticated can't read the token table");
await db.exec(`update notification_settings set optional_email = false where user_id = '${A}'`);
await db.exec(`reset role`);
ok((await q(`select optional_email from notification_settings where user_id = '${A}'`))[0].optional_email === true, "member C can't change member A's switch (RLS self only)");
await db.exec(`set role anon`);
ok(await throws(`select * from email_unsubscribe_tokens`), "anon can't read the token table");
await db.exec(`reset role`);

console.log(failures ? `\n${failures} FAILED` : "\nALL OK");
process.exit(failures ? 1 : 0);
