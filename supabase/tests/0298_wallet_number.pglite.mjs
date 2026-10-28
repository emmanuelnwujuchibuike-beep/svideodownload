// 0298 — every member has a wallet number: existing accounts backfilled, new ones numbered at sign-up. Against the REAL
// wallet_accounts table and ensure_wallet_number from 0193, in PGlite. Run next to credit_wallet.shared.mjs:
//   node 0298_wallet_number.pglite.mjs <repo>/supabase/migrations [--mutant=no-trigger]
import { readFileSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";

import { split, STUB } from "./credit_wallet.shared.mjs";

const dir = process.argv[2];
const MUTANT = (process.argv.find((a) => a.startsWith("--mutant=")) ?? "").split("=")[1] ?? "";
const db = new PGlite();
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; console.log("FAIL:", m); } else console.log("ok:", m); };
const run = async (stmts) => { for (const s of stmts) { try { await db.exec(s); } catch (e) { console.log("SQL ERROR:", e.message, "\n", s.slice(0, 200)); process.exit(2); } } };
const read = (f) => readFileSync(`${dir}/${f}`, "utf8");
const stmt = (file, startsWith) => { const s = split(read(file)).find((x) => x.trim().startsWith(startsWith)); if (!s) throw new Error(`${file}: no statement ${startsWith}`); return s; };
const val = async (sql, p = []) => Object.values((await db.query(sql, p)).rows[0] ?? {})[0];

await run(split(STUB));
await run([
  stmt("0193_credit_transfers.sql", "create table if not exists public.wallet_accounts"),
  stmt("0193_credit_transfers.sql", "create or replace function public.ensure_wallet_number"),
]);
// three accounts BEFORE 0298: one already numbered (by the old lazy path), two not
await db.exec(`insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000000001', 'a@t.test'), ('00000000-0000-4000-8000-000000000002', 'b@t.test'), ('00000000-0000-4000-8000-000000000003', 'c@t.test')`);
const kept = await val("select public.ensure_wallet_number('00000000-0000-4000-8000-000000000001')");

const m = split(read("0298_wallet_number_for_everyone.sql"));
await run(m);
if (MUTANT === "no-trigger") await db.exec("drop trigger on_auth_user_wallet_number on auth.users");
await run(m.filter((s) => !(MUTANT === "no-trigger" && s.includes("create trigger")))); // twice: idempotent

ok(Number(await val("select count(*) from auth.users u where not exists (select 1 from wallet_accounts w where w.user_id = u.id)")) === 0, "every existing account has a wallet number after 0298");
ok((await val("select account_number from wallet_accounts where user_id = '00000000-0000-4000-8000-000000000001'")) === kept, "an account that already had a number keeps it (running it twice changes nothing)");
ok(Number(await val("select count(*) from wallet_accounts")) === 3, "exactly one number per account");

await db.exec(`insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000000009', 'new@t.test')`);
const fresh = await val("select account_number from wallet_accounts where user_id = '00000000-0000-4000-8000-000000000009'");
ok(typeof fresh === "string" && /^[1-9][0-9]{9}$/.test(fresh), `a NEW account is numbered the moment it is created (${fresh})`);
ok(Number(await val("select count(distinct account_number) from wallet_accounts")) === 4, "all numbers unique");

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
