// 0284 (owner, 2026-10-25: "deposit hold should be like 1hr or configurable by admin") — the admin-set deposit hold,
// against the REAL functions in PGlite. Run like 0280_coin_deposits.pglite.mjs (from a folder where
// @electric-sql/pglite is installed, next to credit_wallet.shared.mjs):
//   node 0284_coin_deposit_hold.pglite.mjs <repo>/supabase/migrations [--mutant=<name>]
//
// Builds the wallet, applies 0278–0280, then 0284 TWICE (idempotent). Pinned: a checkout may carry a hold of 0 to 2160
// hours (was 72 to 2160); out of bounds is still refused before anything is written; the settled deposit's release time
// is exactly settled_at + the hold it was opened with, by the database clock; a checkout with no hold settles with 1
// hour; a 1-hour deposit stays pending (not spendable) until its hour has passed, and is released after it; a 0-hour
// deposit is released by the next release run; the table constraint follows the new bounds.
//
// --mutant=<name> breaks one thing and the run must FAIL:
//   floor-72      settle_coin_deposit still clamps to at least 72 hours  -> a 1-hour deposit is held 72 hours
//   no-ceiling    coin_deposit_rules_ok forgets the 2160-hour ceiling      -> a 2161-hour hold is accepted
import { readFileSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";

import { coinMigration, depositMigration, depositPrerequisites, migration, split, STUB, U, walletStatements } from "./credit_wallet.shared.mjs";

const dir = process.argv[2];
const MUTANT = (process.argv.find((a) => a.startsWith("--mutant=")) ?? "").split("=")[1] ?? "";
const db = new PGlite();
const run = async (stmts) => { for (const s of stmts) { try { await db.exec(s); } catch (e) { console.log("SQL ERROR:", e.message, "\n", s.slice(0, 300)); process.exit(2); } } };
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; console.log("FAIL:", m); } else console.log("ok:", m); };
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const one = async (sql, params = []) => (await q(sql, params))[0];
const rpc = async (sql, params = []) => Object.values((await one(sql, params)) ?? {})[0];
const throws = async (sql, params = []) => { try { await db.query(sql, params); return null; } catch (e) { return e.message; } };
const read = (f) => readFileSync(`${dir}/${f}`, "utf8");
const stmt = (file, startsWith) => { const s = split(read(file)).find((x) => x.trim().startsWith(startsWith)); if (!s) throw new Error(`${file}: no statement ${startsWith}`); return s; };

await run(split(STUB));
await run(walletStatements(dir));
await run(depositPrerequisites(dir));
// the reward and affiliate triggers fire on a settled deposit: present, as in the 0280 suite
await run([
  "create table public.share_links (token text primary key)",
  stmt("0187_rewards_referrals.sql", "create table if not exists public.referral_attributions"),
  stmt("0255_rewards_v2.sql", "create table if not exists public.affiliate_accounts"),
  stmt("0255_rewards_v2.sql", "create table if not exists public.affiliate_commissions"),
  stmt("0255_rewards_v2.sql", "create or replace function public.queue_affiliate_commission("),
  "create or replace function public.process_reward_event(p_event text, p_actor uuid, p_source_type text, p_source_id text, p_metadata jsonb default '{}'::jsonb) returns jsonb language plpgsql as $$ begin return '[]'::jsonb; end $$",
]);
await run(migration(dir));
await run(coinMigration(dir));
await run(depositMigration(dir));
const hold284 = split(read("0284_frenz_coin_deposit_hold.sql"));
await run(hold284);
await run(hold284);
await db.exec(`insert into auth.users (id, email, email_confirmed_at) select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'u' || g || '@t.test', now() from generate_series(1, 20) g`);
await db.exec(`insert into public.profiles (id) select id from auth.users`);

const fnBody = async (name) => (await one("select pg_get_functiondef(p.oid) d from pg_proc p where p.proname = $1", [name])).d;
const mutate = async (name, from, to) => { const b = await fnBody(name); const m = b.split(from).join(to); if (m === b) throw new Error(`mutant on ${name} did not apply`); await db.exec(m); };
if (MUTANT === "floor-72") await mutate("settle_coin_deposit", "greatest(0, least(2160", "greatest(72, least(2160");
if (MUTANT === "no-ceiling") await mutate("coin_deposit_rules_ok", "or (p_rules ->> 'holdHours')::bigint > 2160", "");

const DEP = { enabled: true, version: 4, holdHours: 1, minCents: 100, maxCents: 500000 };
let seq = 0;
const ref = () => `frenz_coin_dep_fw_00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
const begin = (u, reference, cents, key, rules = DEP) => rpc("select begin_coin_deposit($1, $2, $3, 'flutterwave', $4, 'USD', $5, $6::jsonb)", [u, reference, cents, cents, key, JSON.stringify(rules)]);
const settle = (reference, minor) => rpc("select settle_coin_deposit($1, $2, $3, 'USD')", [reference, "ch-" + reference.slice(-6), minor]);
const coin = async (u) => (await one("select balance_cents::int b, pending_cents::int p from ai_product_balances where user_id = $1 and product = 'frenz_coin'", [u])) ?? { b: 0, p: 0 };
const age = async (reference, minutes) => {
  await db.exec("alter table public.coin_deposits disable trigger coin_deposits_guard");
  await db.query(`update public.coin_deposits set settled_at = settled_at - make_interval(mins => $2::int), release_at = release_at - make_interval(mins => $2::int) where reference = $1`, [reference, minutes]);
  await db.exec("alter table public.coin_deposits enable trigger coin_deposits_guard");
};

// ── the bounds a checkout may carry ──
const A = U(1), B = U(2), C = U(3), D = U(4);
for (const [why, hours] of [["0 hours", 0], ["1 hour", 1], ["24 hours", 24], ["72 hours", 72], ["2160 hours", 2160]]) {
  ok((await rpc("select coin_deposit_rules_ok($1::jsonb)", [JSON.stringify({ ...DEP, holdHours: hours })])) === true, `a hold of ${why} is accepted`);
}
for (const [why, rules] of [["2161 hours", { ...DEP, holdHours: 2161 }], ["negative", { ...DEP, holdHours: -1 }], ["fractional", { ...DEP, holdHours: 1.5 }], ["missing", { enabled: true, minCents: 100, maxCents: 500000 }]]) {
  ok((await rpc("select coin_deposit_rules_ok($1::jsonb)", [JSON.stringify(rules)])) === false, `still refused: ${why}`);
}
const rx = ref();
ok((await begin(A, rx, 5000, "key-x-0001", { ...DEP, holdHours: 2161 }))?.reason === "rules_invalid", "an out-of-bounds hold is refused before anything is written");

// ── a 1-hour deposit ──
const r1 = ref();
ok((await begin(A, r1, 5000, "key-a-0001"))?.ok === true, "a 1-hour deposit opens");
let s = await settle(r1, 5000);
ok(s?.ok === true && s.hold_hours === 1, "it settles with the 1-hour hold it was opened with");
const d1 = await one("select hold_hours, extract(epoch from release_at - settled_at)::int secs from coin_deposits where reference = $1", [r1]);
ok(d1.hold_hours === 1 && d1.secs === 3600, "release_at is exactly one hour after settled_at (database clock)");
ok((await coin(A)).p === 5000, "inside the hour the coins are pending (not spendable)");
ok((await rpc("select release_coin_deposit($1)", [r1]))?.ok !== true && (await coin(A)).p === 5000, "nothing releases it early");
await age(r1, 61);
ok((await rpc("select release_coin_deposit($1)", [r1]))?.ok === true && (await coin(A)).p === 0, "after the hour it is released and spendable");

// ── a 0-hour deposit (an admin may choose none) ──
const r0 = ref();
await begin(B, r0, 2000, "key-b-0001", { ...DEP, holdHours: 0 });
s = await settle(r0, 2000);
ok(s?.ok === true && s.hold_hours === 0, "a 0-hour deposit settles with no hold");
ok((await rpc("select release_due_coin_deposits($1, 10)", [B])) !== null && (await coin(B)).p === 0 && (await coin(B)).b === 2000, "the next release run makes it spendable");

// ── a checkout that carried no hold: 1 hour ──
const rn = ref();
await begin(C, rn, 3000, "key-c-0001");
await db.query("update ai_topup_attempts set metadata = metadata #- '{coin,holdHours}' where reference = $1", [rn]);
s = await settle(rn, 3000);
ok(s?.ok === true && s.hold_hours === 1, "no hold recorded on the attempt: the 1-hour default");

// ── 72 and 2160 hours end to end, and each deposit keeps the hold it was OPENED with (Part 8) ──
const E = U(5), F = U(6);
for (const [u, hours, key] of [[E, 72, "key-e-0001"], [F, 2160, "key-f-0001"]]) {
  const r = ref();
  await begin(u, r, 1500, key, { ...DEP, holdHours: hours });
  const st = await settle(r, 1500);
  const row = await one("select hold_hours, extract(epoch from release_at - settled_at)::bigint secs from coin_deposits where reference = $1", [r]);
  ok(st?.ok === true && row.hold_hours === hours && Number(row.secs) === hours * 3600, `a ${hours}-hour deposit: release_at is exactly ${hours} hours after settled_at`);
  ok((await rpc("select release_coin_deposit($1)", [r]))?.ok !== true && (await coin(u)).p === 1500, `${hours} hours: not released early`);
  await age(r, hours * 60 - 1);
  ok((await rpc("select release_coin_deposit($1)", [r]))?.ok !== true && (await coin(u)).p === 1500, `${hours} hours: still held one minute before its release time`);
  await age(r, 2);
  ok((await rpc("select release_coin_deposit($1)", [r]))?.ok === true && (await coin(u)).p === 0, `${hours} hours: released once its own time has passed`);
}
// two deposits opened under different settings settle with their OWN holds (a later setting never rewrites an open one)
const G = U(7), H = U(8);
const rg = ref(), rh = ref();
await begin(G, rg, 1000, "key-g-0001", { ...DEP, holdHours: 72 });
await begin(H, rh, 1000, "key-h-0001", { ...DEP, holdHours: 1 });
const sg = await settle(rg, 1000), sh = await settle(rh, 1000);
ok(sg.hold_hours === 72 && sh.hold_hours === 1, "each deposit is held for the hold recorded when it was opened (72 and 1), not the latest setting");
ok((await rpc("select release_due_coin_deposits(null, 100)")) !== null && (await coin(G)).p === 1000 && (await coin(H)).p === 1000, "the release run frees neither before its own time");

// ── the table constraint follows ──
const r24 = ref();
await begin(D, r24, 1000, "key-d-0001", { ...DEP, holdHours: 24 });
await settle(r24, 1000);
await db.exec("alter table public.coin_deposits disable trigger coin_deposits_guard");
ok((await throws("update coin_deposits set hold_hours = 2161 where reference = $1", [r24])) !== null, "the constraint still refuses a hold over 2160 hours");
ok((await throws("update coin_deposits set hold_hours = 0, release_at = settled_at where reference = $1", [r24])) === null, "the constraint accepts a 0-hour hold");
ok((await throws("update coin_deposits set hold_hours = 5, release_at = settled_at where reference = $1", [r24])) !== null, "release_at earlier than settled_at + hold is still refused");
await db.exec("alter table public.coin_deposits enable trigger coin_deposits_guard");

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
