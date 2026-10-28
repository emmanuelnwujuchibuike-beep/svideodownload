// 0291 / 0292 (Frenz Gift Coin Part 3) — REAL concurrency between landing-settings saves and gift-settings saves, on a
// real PostgreSQL server with SEPARATE connections.
//
//   PGTEST_URL=postgres://postgres:...@127.0.0.1:55433/postgres node gift_settings_concurrency.pg.mjs <repo>/supabase/migrations [--mutant=no-lock]
//
// Local servers only (refuses any other host), its own throwaway database, dropped at the end. Never point it at Supabase.
// Needs `pg` and credit_wallet.shared.mjs beside it. Applies the wallet, 0278–0284, 0290, 0291, 0292. Overlap is FORCED:
// connection A opens a transaction and saves (taking the settings row lock); connection B's competing save must BLOCK
// (confirmed in pg_stat_activity); then A commits. Then bursts of simultaneous saves of both kinds.
//
// --mutant=no-lock removes save_frenz_gift_conversion's row lock: two saves over the same version must then both
// "succeed" and the burst must FAIL.
import { readFileSync } from "node:fs";

import pg from "pg";

import { closeoutMigration, coinMigration, depositMigration, depositPrerequisites, giftMigration, migration, pinMigration, scopeMigration, split, STUB, U, walletStatements } from "./credit_wallet.shared.mjs";

const dir = process.argv[2];
const MUTANT = (process.argv.find((a) => a.startsWith("--mutant=")) ?? "").split("=")[1] ?? "";
const url = new URL(process.env.PGTEST_URL ?? "");
if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
  console.error("Refusing: PGTEST_URL must be a LOCAL server (127.0.0.1 / localhost).");
  process.exit(2);
}
const DB = `frenz_giftcfg_${process.pid}`;
const admin = new pg.Client({ connectionString: url.toString() });
await admin.connect();
await admin.query(`create database ${DB} encoding 'UTF8' template template0 lc_collate 'C' lc_ctype 'C'`);
const dbUrl = new URL(url.toString());
dbUrl.pathname = `/${DB}`;
const connect = async (name) => {
  const c = new pg.Client({ connectionString: dbUrl.toString(), application_name: name });
  await c.connect();
  return c;
};

const LEG_A = { rateNum: 1, rateDen: 1, feeBp: 200, feeFlat: 0, minIn: 100, maxIn: 1_000_000, dailyMaxIn: 3_000_000 };
const LEG_B = { rateNum: 1, rateDen: 1, feeBp: 500, feeFlat: 1, minIn: 100, maxIn: 1_000_000, dailyMaxIn: 3_000_000 };
const ADMIN = U(1);
const J = JSON.stringify;

let failures = 0;
const ok = (c, m) => { if (!c) { failures++; console.log("FAIL:", m); } else console.log("ok:", m); };
const db = await connect("setup");
try {
  await db.query(`do $r$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $r$`);
  await db.query("alter role service_role bypassrls");
  const stub = STUB.replace("create role anon; create role authenticated; create role service_role;", "");
  const file = (f) => (d) => split(readFileSync(`${d}/${f}`, "utf8"));
  const read = (f) => readFileSync(`${dir}/${f}`, "utf8");
  const stmt = (f, startsWith) => split(read(f)).find((x) => x.trim().startsWith(startsWith));
  for (const s of [
    ...split(stub),
    "alter table public.profiles add column is_admin boolean not null default false, add column role text",
    stmt("0144_admin_flag.sql", "create or replace function public.is_admin()"),
    "create table public.settings (id uuid primary key default gen_random_uuid(), key text not null unique, value jsonb not null default '{}'::jsonb)",
    "alter table public.settings enable row level security",
    stmt("0001_init.sql", 'create policy "settings admin all" on public.settings'),
    stmt("0093_config_governance.sql", "create table if not exists public.config_audit_log"),
    ...walletStatements(dir),
    ...depositPrerequisites(dir),
  ]) await db.query(s);
  for (const m of [migration, coinMigration, depositMigration, scopeMigration, pinMigration, closeoutMigration, file("0284_frenz_coin_deposit_hold.sql"), giftMigration, file("0291_frenz_gift_settings_stickers.sql"), file("0292_protect_financial_settings.sql")]) {
    for (const s of m(dir)) await db.query(s);
    for (const s of m(dir)) await db.query(s);
  }
  await db.query(`insert into auth.users (id, email_confirmed_at) select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, now() from generate_series(1, 10) g`);
  await db.query("insert into public.profiles (id) select id from auth.users");

  if (MUTANT === "no-lock") {
    const f = (await db.query("select pg_get_functiondef(p.oid) d from pg_proc p where proname = 'save_frenz_gift_conversion'")).rows[0].d;
    const fm = f.replace("select value into v_value from public.settings where key = 'landing' for update;", "select value into v_value from public.settings where key = 'landing';");
    if (fm === f) throw new Error("mutant no-lock did not apply");
    await db.query(fm);
  }

  const one = async (c, s, p) => (await c.query(s, p)).rows[0];
  const landing = async () => (await one(db, "select value from settings where key = 'landing'"))?.value ?? null;
  const giftSql = "select save_frenz_gift_conversion($1, $2::jsonb, $3, '{}'::jsonb) r";
  const landSql = "select save_landing_settings($1::jsonb) r";
  const legs = (bp) => J({ fcToFgc: { ...LEG_A, feeBp: bp }, fgcToFc: LEG_B });
  const updates = async () => Number((await one(db, "select count(*) n from financial_audit_log where action = 'gift_conversion_config_updated'")).n);
  const waitBlocked = async (name) => {
    for (let i = 0; i < 200; i++) {
      const r = await one(db, "select wait_event_type from pg_stat_activity where datname = $1 and application_name = $2 and state = 'active'", [DB, name]);
      if (r?.wait_event_type === "Lock") return true;
      await new Promise((res) => setTimeout(res, 25));
    }
    return false;
  };
  const race = async (label, aSql, aArgs, bSql, bArgs) => {
    const A = await connect(`A-${label}`);
    const B = await connect(`B-${label}`);
    try {
      await A.query("begin");
      const a = (await one(A, aSql, aArgs))?.r;
      const bPromise = B.query(bSql, bArgs).then((res) => ({ r: res.rows[0]?.r ?? null }), (e) => ({ e: String(e.message ?? e) }));
      const overlapped = await waitBlocked(`B-${label}`);
      await A.query("commit");
      const b = await bPromise;
      return { a, b: b.r ?? null, bError: b.e ?? null, overlapped };
    } finally {
      await A.end();
      await B.end();
    }
  };
  // the service role, as the server connects (BYPASSRLS, so only the guard and the functions decide)
  const asService = async (c) => c.query("set role service_role");

  // setup: version 1
  await db.query(landSql, [J({ reelsPosterUrl: "", frenzCoin: { version: 1 } })]);
  await db.query(giftSql, [ADMIN, legs(200), 0]);
  ok((await landing()).frenzGift.conversion.version === 1, "setup: version 1 stored");

  // 1 · a gift save holds the row; a landing save waits, then keeps the gift save
  {
    const x = await race("gift-then-landing", giftSql, [ADMIN, legs(300), 1], landSql, [J({ reelsPosterUrl: "https://example.test/1.webp" })]);
    const v = await landing();
    ok(x.overlapped, "1 · the landing save really waited on the gift save");
    ok(x.a?.ok === true && !x.bError && v.frenzGift.conversion.version === 2 && v.frenzGift.conversion.fcToFgc.feeBp === 300 && v.reelsPosterUrl === "https://example.test/1.webp", `1 · both survive: frenzGift version 2 and the landing change (${x.bError ?? "ok"})`);
  }

  // 2 · a landing save holds the row; a gift save waits, then keeps the landing save
  {
    const x = await race("landing-then-gift", landSql, [J({ reelsPosterUrl: "https://example.test/2.webp", frenzCoin: { version: 2 } })], giftSql, [ADMIN, legs(350), 2]);
    const v = await landing();
    ok(x.overlapped, "2 · the gift save really waited on the landing save");
    ok(x.b?.ok === true && x.b.version === 3 && v.reelsPosterUrl === "https://example.test/2.webp" && v.frenzCoin.version === 2 && v.frenzGift.conversion.version === 3, `2 · both survive: the landing change and frenzGift version 3 (${x.bError ?? J(x.b)})`);
  }

  // 3 · two administrators save over the same version: one wins, the other is told it is stale
  {
    const x = await race("gift-vs-gift", giftSql, [ADMIN, legs(400), 3], giftSql, [U(2), legs(450), 3]);
    ok(x.overlapped, "3 · the second gift save really waited");
    ok(x.a?.ok === true && x.b?.ok === false && x.b.reason === "stale" && (await landing()).frenzGift.conversion.fcToFgc.feeBp === 400, `3 · one wins, the other is refused as stale (${J(x.b ?? x.bError)})`);
  }

  // 4 · a stale read-merge-write (the pre-0291 fallback shape) racing a gift save is refused, never a silent rollback
  {
    const stale = await landing(); // version 4 read
    const B = await connect("B-stale");
    await asService(B);
    await db.query(giftSql, [ADMIN, legs(500), 4]); // another administrator saves version 5 meanwhile
    const err = await B.query("update settings set value = $1::jsonb where key = 'landing'", [J({ ...stale, reelsPosterUrl: "https://example.test/stale.webp" })]).then(() => null, (e) => String(e.message));
    await B.end();
    const v = await landing();
    ok(err !== null && v.frenzGift.conversion.version === 5 && v.reelsPosterUrl !== "https://example.test/stale.webp", `4 · a write built from the version-4 read is refused after version 5 committed (${err ?? "applied!"})`);
    // and the forced overlap of the same thing: the stale write waits on the gift save's lock, then is refused
    const stale2 = await landing();
    const A = await connect("A-stale2");
    const C = await connect("B-stale2");
    await asService(C);
    await A.query("begin");
    await A.query(giftSql, [ADMIN, legs(550), 5]);
    const pending = C.query("update settings set value = $1::jsonb where key = 'landing'", [J({ ...stale2, reelsPosterUrl: "https://example.test/stale2.webp" })]).then(() => null, (e) => String(e.message));
    const blocked = await waitBlocked("B-stale2");
    await A.query("commit");
    const err2 = await pending;
    await A.end();
    await C.end();
    ok(blocked && err2 !== null && (await landing()).frenzGift.conversion.version === 6, `4 · forced overlap: the stale write waited, then was refused; version 6 stays (${err2 ?? "applied!"})`);
  }

  // 5 · a burst: 12 landing saves (each its own key) and 12 gift saves over the same version, all at once
  {
    const v0 = (await landing()).frenzGift.conversion.version;
    const u0 = await updates();
    const conns = await Promise.all(Array.from({ length: 24 }, (_, i) => connect(`burst-${i}`)));
    const out = await Promise.all(conns.map((c, i) => (i % 2 === 0 ? c.query(landSql, [J({ [`burstKey${i}`]: i })]) : c.query(giftSql, [U(1 + (i % 5)), legs(600 + i), v0])).then((r) => ({ r: r.rows[0]?.r ?? null }), (e) => ({ e: String(e.message) }))));
    await Promise.all(conns.map((c) => c.end()));
    const v = await landing();
    const gifts = out.filter((_, i) => i % 2 === 1);
    const won = gifts.filter((o) => o.r?.ok).length;
    const stale = gifts.filter((o) => o.r?.reason === "stale").length;
    const keys = Array.from({ length: 12 }, (_, k) => `burstKey${k * 2}`).filter((k) => v[k] === Number(k.slice(8))).length;
    ok(out.every((o) => !o.e), `5 · no save errored (${out.find((o) => o.e)?.e ?? "none"})`);
    ok(won === 1 && stale === 11, `5 · 12 gift saves over version ${v0}: exactly 1 wins, 11 are stale (${won} won, ${stale} stale)`);
    ok(v.frenzGift.conversion.version === v0 + 1 && (await updates()) === u0 + 1, `5 · the stored version is ${v0 + 1} and there is exactly one audit row for it`);
    ok(keys === 12 && v.reelsPosterUrl && v.frenzCoin?.version === 2, `5 · all 12 landing keys survived, and the earlier sections too (${keys}/12)`);
  }

  // 6 · the API roles still can't write, even mid-burst
  {
    const c = await connect("api");
    await c.query("set role authenticated");
    const e = await c.query(`update settings set value = jsonb_set(value, '{frenzGift,conversion,version}', '999') where key = 'landing'`).then((r) => (r.rowCount ? "applied" : null), (err) => String(err.message));
    await c.end();
    ok(e !== "applied" && (await landing()).frenzGift.conversion.version !== 999, `6 · an authenticated session writes nothing (${e ?? "0 rows"})`);
  }
} finally {
  await db.end();
  await admin.query(`drop database if exists ${DB} with (force)`);
  await admin.end();
}
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
