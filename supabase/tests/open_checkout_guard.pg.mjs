// Part 4 closure — REAL concurrency for 0276 (begin_sub_purchase, begin_verification_purchase) on a real PostgreSQL
// server with SEPARATE connections (the PGlite harness is one connection and can't interleave two transactions).
//
//   PGTEST_URL=postgres://postgres:...@127.0.0.1:55432/postgres node open_checkout_guard.pg.mjs <repo>/supabase/migrations [--mutant=no-lock]
//
// Same method as sub_concurrency.pg.mjs: local servers only (refuses any host but 127.0.0.1 / localhost), its own throwaway
// database (dropped at the end), READ COMMITTED like Supabase. The race is FORCED: connection A opens a transaction and
// calls the function (taking the advisory lock and inserting); B calls it for the same pair and a third connection
// confirms in pg_stat_activity that B is really WAITING on the lock; then A commits and B must answer `open` — one row.
// Plus bursts of simultaneous calls from many connections.
//
// --mutant=no-lock removes the advisory lock from both functions: B then does not wait, both see no row and BOTH insert —
// the run must FAIL. (The check alone, without the lock, is exactly the race the app had.)
import { readFileSync } from "node:fs";
import pg from "pg";

const dir = process.argv[2];
const MUTANT = (process.argv.find((a) => a.startsWith("--mutant=")) ?? "").slice("--mutant=".length);
const base = process.env.PGTEST_URL;
if (!base) throw new Error("PGTEST_URL is required (a LOCAL PostgreSQL)");
const u = new URL(base);
if (!["127.0.0.1", "localhost"].includes(u.hostname)) throw new Error("refusing a non-local database");

const dbName = `open_checkout_${Date.now()}`;
const admin = new pg.Client({ connectionString: base });
await admin.connect();
await admin.query(`create database ${dbName} encoding 'UTF8' template template0 lc_collate 'C' lc_ctype 'C'`);
const url = new URL(base);
url.pathname = `/${dbName}`;
const connect = async () => {
  const c = new pg.Client({ connectionString: url.toString() });
  await c.connect();
  return c;
};

let failures = 0;
const ok = (c, m) => {
  if (!c) failures++;
  console.log(`${c ? "PASS" : "FAIL"}  ${m}`);
};

const setup = await connect();
try {
  await setup.query(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
    end $$;
    create schema auth; create table auth.users (id uuid primary key);
    create table public.sub_purchases (
      id uuid primary key default gen_random_uuid(), creator_id uuid not null references auth.users (id), subscriber_id uuid not null references auth.users (id),
      price_cents integer not null, fee_cents integer not null, total_cents integer not null, fee_bp integer not null,
      charged_currency text not null, charged_minor bigint not null, fx_minor_per_usd bigint, provider text not null default 'paystack',
      reference text not null unique, checkout_url text, status text not null default 'initiated', period_days integer not null default 30,
      hold_days integer not null default 0, failure_source text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    create table public.verification_purchases (
      id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users (id), reference text not null unique,
      price_cents integer not null, charged_currency text not null, charged_minor bigint not null, fx_minor_per_usd numeric,
      period_days integer not null, status text not null default 'initiated', failure_source text, checkout_url text,
      provider text not null default 'paystack', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
  `);
  let sql = readFileSync(`${dir}/0276_open_checkout_guard.sql`, "utf8");
  if (MUTANT === "no-lock") {
    const before = sql;
    sql = sql.replaceAll(/  perform pg_advisory_xact_lock\([^;]*;\n/g, "");
    if (sql === before) throw new Error("mutant no-lock did not apply");
  } else if (MUTANT) throw new Error(`unknown mutant ${MUTANT}`);
  await setup.query(sql);
  const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  for (let n = 1; n <= 20; n++) await setup.query("insert into auth.users (id) values ($1)", [U(n)]);

  const SUB = (c, s, cr, ref) => c.query(`select public.begin_sub_purchase($1, $2, $3, 'paystack', 1100, 100, 1100, 1000, 'NGN', 1760000, 160000, 30, 7) as r`, [s, cr, ref]);
  const VER = (c, user, ref) => c.query(`select public.begin_verification_purchase($1, $2, 'paystack', 500, 'NGN', 800000, 160000, 30) as r`, [user, ref]);
  const waiting = async (pid) => {
    for (let i = 0; i < 100; i++) {
      const { rows } = await setup.query("select wait_event_type from pg_stat_activity where pid = $1", [pid]);
      if (rows[0]?.wait_event_type === "Lock") return true;
      await new Promise((r) => setTimeout(r, 20));
    }
    return false;
  };

  // ── forced race: SUB ──
  for (const [label, call, t, args] of [
    ["sub", SUB, "sub_purchases", (n) => [U(1), U(2), `frenz_sub_race_${n}`]],
    ["verification", VER, "verification_purchases", (n) => [U(3), `frenz_vf_race_${n}`]],
  ]) {
    const A = await connect();
    const B = await connect();
    const bPid = (await B.query("select pg_backend_pid() p")).rows[0].p;
    await A.query("begin");
    const a = (await call(A, ...args(1))).rows[0].r;
    const bPromise = call(B, ...args(2));
    const bWaited = await waiting(bPid);
    await A.query("commit");
    const b = (await bPromise).rows[0].r;
    const rows = Number((await setup.query(`select count(*)::int n from public.${t}`)).rows[0].n);
    ok(a.ok === true, `${label}: A (inside its transaction) inserts`);
    ok(bWaited, `${label}: B really WAITED on the lock while A's transaction was open (pg_stat_activity)`);
    ok(b.ok === false && b.reason === "open", `${label}: after A commits, B answers open — it does not insert`);
    ok(rows === 1, `${label}: exactly ONE purchase row (got ${rows})`);
    await A.end();
    await B.end();
  }

  // ── bursts: 12 connections at once, per table, for fresh keys ──
  const burst = async (label, t, mk, filter) => {
    const conns = await Promise.all(Array.from({ length: 12 }, () => connect()));
    const out = await Promise.all(conns.map((c, i) => mk(c, i)));
    const inserted = out.filter((x) => x.rows[0].r.ok).length;
    const rows = Number((await setup.query(`select count(*)::int n from public.${t} where ${filter}`)).rows[0].n);
    ok(inserted === 1 && rows === 1, `${label}: a burst of 12 simultaneous calls inserts ONE row (inserted ${inserted}, rows ${rows})`);
    await Promise.all(conns.map((c) => c.end()));
  };
  await burst("sub", "sub_purchases", (c, i) => SUB(c, U(5), U(6), `frenz_sub_burst_${i}`), `subscriber_id = '${U(5)}' and creator_id = '${U(6)}'`);
  await burst("verification", "verification_purchases", (c, i) => VER(c, U(7), `frenz_vf_burst_${i}`), `user_id = '${U(7)}'`);

  // ── different keys never wait on each other ──
  const A = await connect();
  const B = await connect();
  await A.query("begin");
  await SUB(A, U(8), U(9), "frenz_sub_k1");
  const other = await Promise.race([SUB(B, U(10), U(9), "frenz_sub_k2").then(() => "done"), new Promise((r) => setTimeout(() => r("blocked"), 2000))]);
  ok(other === "done", "sub: another subscriber's call does not wait on this pair's lock");
  await A.query("commit");
  await A.end();
  await B.end();
} finally {
  await setup.end();
  await admin.query(`drop database if exists ${dbName} with (force)`);
  await admin.end();
}
console.log(failures ? `\n${failures} FAILED${MUTANT ? " (expected: mutant)" : ""}` : "\nall passed");
process.exit(failures ? 1 : 0);
