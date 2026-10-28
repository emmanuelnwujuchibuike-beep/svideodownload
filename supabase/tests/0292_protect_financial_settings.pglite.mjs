// 0292 (Frenz Gift Coin Part 3 follow-up) — financial configuration can only change through its audited writers, against
// the REAL migrations in PGlite. Run like the other coin suites (from a folder where @electric-sql/pglite is installed,
// next to credit_wallet.shared.mjs):
//   node 0292_protect_financial_settings.pglite.mjs <repo>/supabase/migrations [--mutant=<name>]
//
// Production's shape: 0001's settings table and its "settings admin all" policy, 0144's is_admin(), Supabase's default
// grants, 0093's config_audit_log, then the wallet and 0278–0284, 0290, 0291 (twice each). Then:
//   BEFORE 0292  the bypass is real: an administrator's own session rewrites landing.frenzGift.conversion directly.
//   0292 twice, then:
//     an administrator (or a member, or anon) can no longer insert, update, delete or truncate settings, and still reads
//     service-role code can write every other key and row, but cannot change, remove, rename away or delete frenzGift,
//       not even after setting the writer flag itself
//     save_frenz_gift_conversion still validates, refuses a stale version, bumps only on change, audits atomically
//     save_landing_settings (setLandingSettings) still saves unrelated sections and keeps frenzGift
//     a stale read-merge-write carrying an old frenzGift is refused, not applied
//
// --mutant=<name> breaks one protection and the run must FAIL:
//   admin-write        the admin write policy and grants come back             -> an admin session rewrites frenzGift
//   no-guard           the settings_gift_guard trigger is dropped               -> service-role code rewrites frenzGift
//   trust-service      the guard accepts the service role with the flag         -> service-role code sets the flag and writes
//   no-truncate-guard  the truncate guard is dropped                            -> settings can be truncated
import { readFileSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";

import { closeoutMigration, coinMigration, depositMigration, depositPrerequisites, giftMigration, migration, pinMigration, scopeMigration, split, STUB, U, walletStatements } from "./credit_wallet.shared.mjs";

const dir = process.argv[2];
const MUTANT = (process.argv.find((a) => a.startsWith("--mutant=")) ?? "").split("=")[1] ?? "";
const db = new PGlite();
const run = async (stmts) => { for (const s of stmts) { try { await db.exec(s); } catch (e) { console.log("SQL ERROR:", e.message, "\n", s.slice(0, 300)); process.exit(2); } } };
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; console.log("FAIL:", m); } else console.log("ok:", m); };
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const one = async (sql, params = []) => (await q(sql, params))[0];
const rpc = async (sql, params = []) => { try { return Object.values((await one(sql, params)) ?? {})[0]; } catch (e) { return { ok: false, reason: "exception", error: e.message }; } };
const throws = async (sql, params = []) => { try { await db.query(sql, params); return null; } catch (e) { return e.message; } };
const read = (f) => readFileSync(`${dir}/${f}`, "utf8");
const stmt = (file, startsWith) => { const s = split(read(file)).find((x) => x.trim().startsWith(startsWith)); if (!s) throw new Error(`${file}: no statement ${startsWith}`); return s; };
const file = (f) => (d) => split(readFileSync(`${d}/${f}`, "utf8"));

await run(split(STUB));
await run([
  "grant usage on schema auth to anon, authenticated, service_role",
  // as on Supabase: the service role bypasses RLS (so only the trigger can stop it)
  "alter role service_role bypassrls",
  "alter default privileges in schema public grant all on tables to anon, authenticated, service_role",
  "alter default privileges in schema public grant all on functions to anon, authenticated, service_role",
  "alter table public.profiles add column is_admin boolean not null default false, add column role text",
  // 0144's is_admin(), verbatim
  stmt("0144_admin_flag.sql", "create or replace function public.is_admin()"),
  // 0001's settings table and its policy, as production has them
  "create table public.settings (id uuid primary key default gen_random_uuid(), key text not null unique, value jsonb not null default '{}'::jsonb)",
  "alter table public.settings enable row level security",
  stmt("0001_init.sql", 'create policy "settings admin all" on public.settings'),
  stmt("0093_config_governance.sql", "create table if not exists public.config_audit_log"),
]);
await run(walletStatements(dir));
await run(depositPrerequisites(dir));
for (const m of [migration, coinMigration, depositMigration, scopeMigration, pinMigration, closeoutMigration, file("0284_frenz_coin_deposit_hold.sql"), giftMigration, file("0291_frenz_gift_settings_stickers.sql")]) { await run(m(dir)); await run(m(dir)); }
await db.exec(`insert into auth.users (id, email, email_confirmed_at) select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'u' || g || '@t.test', now() from generate_series(1, 30) g`);
await db.exec(`insert into public.profiles (id) select id from auth.users`);
const ADMIN = U(1), MEMBER = U(2), ADMIN2 = U(3);
await db.query("update profiles set is_admin = true where id in ($1, $2)", [ADMIN, ADMIN2]);

const LEG_A = { rateNum: 1, rateDen: 1, feeBp: 200, feeFlat: 0, minIn: 100, maxIn: 1_000_000, dailyMaxIn: 3_000_000 };
const LEG_B = { rateNum: 1, rateDen: 1, feeBp: 500, feeFlat: 1, minIn: 100, maxIn: 1_000_000, dailyMaxIn: 3_000_000 };
const J = JSON.stringify;
const landing = async () => (await one("select value from settings where key = 'landing'"))?.value ?? null;
const saveGift = (legs, expected, admin = ADMIN) => rpc("select save_frenz_gift_conversion($1, $2::jsonb, $3, '{}'::jsonb)", [admin, J(legs), expected]);
const as = async (role, uid, fn) => { await db.exec(`set role ${role}`); await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]); try { return await fn(); } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); } };
const FORGED = J({ version: 99, fcToFgc: { ...LEG_A, feeBp: 0 }, fgcToFc: { ...LEG_B, feeBp: 0, feeFlat: 0 } });
const forge = `update settings set value = jsonb_set(value, '{frenzGift,conversion}', '${FORGED}'::jsonb) where key = 'landing'`;

// a configured state to attack
await rpc("select save_landing_settings($1::jsonb)", [J({ reelsPosterUrl: "", frenzCoin: { enabled: false, version: 1 } })]);
let g = await saveGift({ fcToFgc: LEG_A, fgcToFc: LEG_B }, 0);
ok(g?.ok === true && g.version === 1, "setup: the gift rules are saved through the audited writer (version 1)");

// ═══ BEFORE 0292: the bypass ═══
const pre = await as("authenticated", ADMIN, () => throws(forge));
const after0291 = (await landing()).frenzGift.conversion;
ok(pre === null && after0291.version === 99 && after0291.fcToFgc.feeBp === 0, "BEFORE 0292 — the bypass is real: an administrator's own session rewrites frenzGift.conversion directly (an arbitrage-prone version 99, no audit)");
ok((await one("select count(*)::int n from financial_audit_log where action = 'gift_conversion_config_updated'")).n === 1, "BEFORE 0292 — and no audit row records it");
// put the legitimate rules back (as the database owner) before the fix
await db.query("update settings set value = jsonb_set(value, '{frenzGift,conversion}', $1::jsonb) where key = 'landing'", [J({ version: 1, fcToFgc: LEG_A, fgcToFc: LEG_B })]);

// ═══ 0292 (twice) ═══
const m292 = file("0292_protect_financial_settings.sql");
await run(m292(dir));
await run(m292(dir));
const fnBody = async (name) => (await one("select pg_get_functiondef(p.oid) d from pg_proc p where p.proname = $1", [name])).d;
const mutate = async (name, from, to) => { const b = await fnBody(name); const m = b.split(from).join(to); if (m === b) throw new Error(`mutant on ${name} did not apply`); await db.exec(m); };
if (MUTANT === "admin-write") await db.exec(`create policy "settings admin all" on public.settings for all using (public.is_admin()) with check (public.is_admin()); grant insert, update, delete on public.settings to authenticated`);
if (MUTANT === "no-guard") await db.exec("drop trigger settings_gift_guard on public.settings");
if (MUTANT === "trust-service") await mutate("settings_gift_guard", "current_user not in ('anon', 'authenticated', 'service_role')", "current_user not in ('anon', 'authenticated')");
if (MUTANT === "no-truncate-guard") await db.exec("drop trigger settings_truncate_guard on public.settings");

const stored = () => landing().then((v) => J(v.frenzGift));
const base = await stored();

// ═══ 1 · no API role writes settings ═══
for (const [who, role, uid] of [["an administrator", "authenticated", ADMIN], ["a member", "authenticated", MEMBER], ["anon", "anon", null]]) {
  ok((await as(role, uid, () => throws(forge))) !== null, `${who}: a direct update of frenzGift.conversion is refused`);
  ok((await as(role, uid, () => throws("update settings set value = value || '{\"frenzCoin\": {\"enabled\": true}}'::jsonb where key = 'landing'"))) !== null, `${who}: a direct update of any landing section (frenzCoin) is refused`);
  ok((await as(role, uid, () => throws("insert into settings (key, value) values ('x-' || md5(random()::text), '{}'::jsonb)"))) !== null, `${who}: inserting a settings row is refused`);
  ok((await as(role, uid, () => throws("delete from settings where key = 'landing'"))) !== null || (await landing()) !== null, `${who}: deleting the landing row is refused`);
  ok((await as(role, uid, () => throws("truncate settings"))) !== null, `${who}: truncating settings is refused`);
}
ok((await stored()) === base, "after every attempt the stored frenzGift is unchanged");
const adminRead = await as("authenticated", ADMIN, () => q("select key from settings where key = 'landing'"));
const memberRead = await as("authenticated", MEMBER, () => q("select key from settings"));
ok(adminRead.length === 1 && memberRead.length === 0, "administrators still read settings, members still can't (RLS unchanged for reads)");
for (const role of ["anon", "authenticated"]) {
  ok(/permission denied/.test((await as(role, ADMIN, () => throws(`select save_frenz_gift_conversion('${ADMIN}', '{}'::jsonb, 1)`))) ?? ""), `${role} cannot call save_frenz_gift_conversion`);
  ok(/permission denied/.test((await as(role, ADMIN, () => throws("select save_landing_settings('{}'::jsonb)"))) ?? ""), `${role} cannot call save_landing_settings`);
}

// ═══ 2 · service-role code: every other key yes, frenzGift no ═══
ok((await as("service_role", null, () => throws("update settings set value = value || '{\"frenzCoin\": {\"enabled\": true, \"version\": 2}}'::jsonb where key = 'landing'"))) === null, "service role: updating another landing section still works");
ok((await as("service_role", null, () => throws("insert into settings (key, value) values ('monetization', '{\"x\": 1}'::jsonb) on conflict (key) do update set value = excluded.value"))) === null, "service role: other settings rows still work");
ok((await as("service_role", null, () => throws(forge))) !== null, "service role: a direct rewrite of frenzGift.conversion is refused");
ok((await as("service_role", null, () => throws("update settings set value = value - 'frenzGift' where key = 'landing'"))) !== null, "service role: removing frenzGift is refused");
ok((await as("service_role", null, () => throws("update settings set value = '[]'::jsonb where key = 'landing'"))) !== null, "service role: replacing the landing value with a non-object is refused");
ok((await as("service_role", null, () => throws("update settings set key = 'landing-old' where key = 'landing'"))) !== null, "service role: renaming the landing row away is refused");
ok((await as("service_role", null, () => throws("delete from settings where key = 'landing'"))) !== null, "service role: deleting the landing row is refused");
ok((await as("service_role", null, () => throws(`select set_config('frenz.gift_settings_writer', 'on', false)`).then(() => throws(forge)))) !== null, "service role: setting the writer flag itself does not open the guard");
await db.query("select set_config('frenz.gift_settings_writer', '', false)");
ok((await as("service_role", null, () => throws("insert into settings (key, value) values ('landing', '{\"frenzGift\": {\"conversion\": null}}'::jsonb) on conflict (key) do update set value = excluded.value"))) !== null, "service role: an upsert that replaces frenzGift is refused");
ok((await stored()) === base && (await landing()).frenzCoin.version === 2, "frenzGift unchanged, the legitimate frenzCoin change applied");

// ═══ 3 · the legitimate writers still work ═══
ok((await rpc("select save_landing_settings($1::jsonb)", [J({ reelsPosterUrl: "https://example.test/p.webp", frenzRewards: { version: 3 } })])) !== undefined && (await landing()).reelsPosterUrl === "https://example.test/p.webp" && (await stored()) === base, "save_landing_settings (setLandingSettings) saves unrelated sections and keeps frenzGift");
ok((await rpc("select save_landing_settings($1::jsonb)", [J({ reelsPosterUrl: "", frenzGift: { conversion: null } })])) !== undefined && (await stored()) === base, "a landing save carrying its own frenzGift still can't change it (and isn't refused: it is ignored)");
g = await saveGift({ fcToFgc: { ...LEG_A, feeBp: 300 }, fgcToFc: LEG_B }, 1);
ok(g?.ok === true && g.version === 2 && (await landing()).frenzGift.conversion.fcToFgc.feeBp === 300, "save_frenz_gift_conversion still saves (version 2)");
ok((await one("select count(*)::int n from financial_audit_log where action = 'gift_conversion_config_updated' and details->>'version' = '2' and actor_id = $1", [ADMIN])).n === 1
   && (await one("select count(*)::int n from config_audit_log where surface = 'frenz_gift' and after->'conversion'->>'version' = '2'")).n === 1, "and audits it in both logs, atomically with the save");
ok((await saveGift({ fcToFgc: { ...LEG_A, feeBp: 400 }, fgcToFc: LEG_B }, 1, ADMIN2))?.reason === "stale", "a stale version is still refused");
ok((await saveGift({ fcToFgc: { ...LEG_A, feeBp: 300 }, fgcToFc: LEG_B }, 2))?.unchanged === true, "an identical save is still unchanged (no bump)");
ok((await saveGift({ fcToFgc: { ...LEG_A, feeBp: 0 }, fgcToFc: { ...LEG_B, feeBp: 0, feeFlat: 0 } }, 2))?.detail === "config_arbitrage", "invalid rules are still refused");
ok((await one("select current_setting('frenz.gift_settings_writer', true) f")).f !== "on", "the writer flag is off again after the writer ran");

// ═══ 4 · a stale read-merge-write is refused, not applied ═══
const staleValue = await landing(); // read while version 2 is stored
await saveGift({ fcToFgc: { ...LEG_A, feeBp: 350 }, fgcToFc: LEG_B }, 2); // another admin saves version 3
const staleWrite = await as("service_role", null, () => throws("update settings set value = $1::jsonb where key = 'landing'", [J({ ...staleValue, reelsPosterUrl: "https://example.test/stale.webp" })]));
ok(staleWrite !== null && (await landing()).frenzGift.conversion.version === 3, "a write built from an older read (carrying version 2 of frenzGift) is refused — version 3 stays");

// ═══ 5 · last, because it would wipe the table: even the service role (which keeps TRUNCATE) cannot truncate settings ═══
ok((await as("service_role", null, () => throws("truncate settings"))) !== null && (await landing())?.frenzGift?.conversion?.version === 3, "service role: truncating settings is refused, and frenzGift survives");

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
