// Exclusive Part 2 — REAL concurrency for 0277's promotion redemption limit (begin_sub_purchase, 15 arguments) on a
// real PostgreSQL server with SEPARATE connections (PGlite is one connection and can't interleave two transactions).
//
//   PGTEST_URL=postgres://postgres:...@127.0.0.1:55432/postgres node sub_promotion_limit.pg.mjs <repo>/supabase/migrations [--mutant=no-promo-lock]
//
// Same method as open_checkout_guard.pg.mjs: local servers only, a throwaway database (dropped at the end), READ
// COMMITTED like Supabase. Different SUBSCRIBERS buying the same promotion do NOT share 0276's pair lock — only the
// per-promotion lock serialises them. The race is FORCED: A opens a transaction and takes the last slot; B (another
// member) calls for the same promotion and a third connection confirms B is really WAITING on a lock; A commits; B must
// answer promotion_exhausted. Then bursts of simultaneous buyers, and the window / pause / duration / stale-checkout rules.
//
// --mutant=no-promo-lock removes the promotion lock: simultaneous buyers then each count the same rows and insert past
// the limit — the run must FAIL.
import { readFileSync } from "node:fs";
import pg from "pg";

const dir = process.argv[2];
const MUTANT = (process.argv.find((a) => a.startsWith("--mutant=")) ?? "").slice("--mutant=".length);
const base = process.env.PGTEST_URL;
if (!base) throw new Error("PGTEST_URL is required (a LOCAL PostgreSQL)");
const u = new URL(base);
if (!["127.0.0.1", "localhost"].includes(u.hostname)) throw new Error("refusing a non-local database");

const dbName = `promo_limit_${Date.now()}`;
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
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create table public.creator_membership_settings (creator_id uuid primary key references auth.users (id), sub_price_cents integer);
    create table public.sub_purchases (
      id uuid primary key default gen_random_uuid(), creator_id uuid not null references auth.users (id), subscriber_id uuid not null references auth.users (id),
      price_cents integer not null, fee_cents integer not null, total_cents integer not null, fee_bp integer not null,
      charged_currency text not null, charged_minor bigint not null, fx_minor_per_usd bigint, provider text not null default 'paystack',
      reference text not null unique, checkout_url text, status text not null default 'initiated', period_days integer not null default 30,
      hold_days integer not null default 0, failure_source text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
  `);
  let sql = readFileSync(`${dir}/0277_sub_bundles_promotions.sql`, "utf8");
  if (MUTANT === "no-promo-lock") {
    const before = sql;
    sql = sql.replace(/    perform pg_advisory_xact_lock\(hashtextextended\('frenz:sub_promotion:'[^;]*;\n/, "");
    if (sql === before) throw new Error("mutant no-promo-lock did not apply");
  } else if (MUTANT) throw new Error(`unknown mutant ${MUTANT}`);
  await setup.query(sql);

  const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  for (let n = 1; n <= 60; n++) await setup.query("insert into auth.users (id) values ($1)", [U(n)]);
  const CREATOR = U(1);
  const OTHER_CREATOR = U(59);
  const promo = async (limit, over = "") => (await setup.query(`insert into public.sub_promotions (creator_id, name, kind, percent_off, durations, starts_at, ends_at, max_redemptions${over ? ", paused" : ""}) values ($1, 'Launch', 'percent', 50, '{3}', now() - interval '1 hour', now() + interval '1 day', $2${over ? `, ${over}` : ""}) returning id`, [CREATOR, limit])).rows[0].id;
  let refN = 0;
  const BUY = (c, subscriber, promotion, months = 3, creator = CREATOR) => c.query(`select public.begin_sub_purchase($1, $2, $3, 'paystack', 1350, 135, 1485, 1000, 'NGN', 2227500, 150000, 90, 0, $4::smallint, $5) as r`, [subscriber, creator, `frenz_sub_p_${++refN}`, months, promotion]);
  const count = async (promotion) => Number((await setup.query("select count(*)::int n from public.sub_purchases where promotion_id = $1", [promotion])).rows[0].n);
  const waiting = async (pid) => {
    for (let i = 0; i < 100; i++) {
      const { rows } = await setup.query("select wait_event_type from pg_stat_activity where pid = $1", [pid]);
      if (rows[0]?.wait_event_type === "Lock") return true;
      await new Promise((r) => setTimeout(r, 20));
    }
    return false;
  };

  // ── forced race: two DIFFERENT members, the last slot ──
  {
    const p = await promo(1);
    const A = await connect();
    const B = await connect();
    const bPid = (await B.query("select pg_backend_pid() p")).rows[0].p;
    await A.query("begin");
    const a = (await BUY(A, U(2), p)).rows[0].r;
    const bPromise = BUY(B, U(3), p);
    const bWaited = await waiting(bPid);
    await A.query("commit");
    const b = (await bPromise).rows[0].r;
    ok(a.ok === true, "race: A (inside its transaction) takes the last slot");
    ok(bWaited, "race: B — another member, so NOT the pair lock — really WAITED on the promotion lock (pg_stat_activity)");
    ok(b.ok === false && b.reason === "promotion_exhausted", `race: after A commits, B is refused as exhausted (got ${JSON.stringify(b)})`);
    ok((await count(p)) === 1, "race: exactly ONE purchase used the promotion");
    await A.end();
    await B.end();
  }

  // ── bursts: 15 different members at once against limits 1 and 3 ──
  for (const limit of [1, 3]) {
    const p = await promo(limit);
    const conns = await Promise.all(Array.from({ length: 15 }, () => connect()));
    const out = await Promise.all(conns.map((c, i) => BUY(c, U(10 + i), p)));
    const inserted = out.filter((x) => x.rows[0].r.ok).length;
    ok(inserted === limit && (await count(p)) === limit, `burst: 15 simultaneous members, limit ${limit} → exactly ${limit} purchases (inserted ${inserted}, rows ${await count(p)})`);
    ok(out.filter((x) => x.rows[0].r.reason === "promotion_exhausted").length === 15 - limit, `burst: the other ${15 - limit} are told it is exhausted`);
    await Promise.all(conns.map((c) => c.end()));
  }

  // ── an abandoned checkout frees its slot after 30 minutes; paid ones never do ──
  {
    const p = await promo(1);
    ok((await BUY(setup, U(30), p)).rows[0].r.ok === true, "stale: the first member takes the slot");
    ok((await BUY(setup, U(31), p)).rows[0].r.reason === "promotion_exhausted", "stale: held while the checkout is under 30 minutes old");
    await setup.query("update public.sub_purchases set created_at = now() - interval '31 minutes' where promotion_id = $1", [p]);
    ok((await BUY(setup, U(31), p)).rows[0].r.ok === true, "stale: an initiated checkout older than 30 minutes no longer counts");
    await setup.query("update public.sub_purchases set status = 'paid', created_at = now() - interval '2 days' where promotion_id = $1 and subscriber_id = $2", [p, U(31)]);
    ok((await BUY(setup, U(32), p)).rows[0].r.reason === "promotion_exhausted", "stale: a PAID purchase counts forever");
  }

  // ── window, pause, duration, owner ──
  {
    const p = await promo(null);
    ok((await BUY(setup, U(40), p, 1)).rows[0].r.reason === "promotion_unavailable", "rules: a duration the promotion doesn't cover is refused");
    ok((await BUY(setup, U(41), p, 3, OTHER_CREATOR)).rows[0].r.reason === "promotion_unavailable", "rules: another creator's promotion is refused");
    await setup.query("update public.sub_promotions set paused = true where id = $1", [p]);
    ok((await BUY(setup, U(42), p)).rows[0].r.reason === "promotion_unavailable", "rules: a paused promotion is refused");
    await setup.query("update public.sub_promotions set paused = false, starts_at = now() + interval '1 hour', ends_at = now() + interval '2 hours' where id = $1", [p]);
    ok((await BUY(setup, U(43), p)).rows[0].r.reason === "promotion_unavailable", "rules: a scheduled promotion is refused before it starts");
    await setup.query("update public.sub_promotions set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 second' where id = $1", [p]);
    ok((await BUY(setup, U(44), p)).rows[0].r.reason === "promotion_unavailable", "rules: an expired promotion is refused");
    ok((await BUY(setup, U(45), null, 2)).rows[0].r.reason === "invalid_duration", "rules: a duration outside 1/3/6/12 is refused");
    const plain = (await BUY(setup, U(46), null, 12)).rows[0].r;
    ok(plain.ok === true, "rules: a bundle without a promotion inserts");
    const [r] = (await setup.query("select months, promotion_id from public.sub_purchases where subscriber_id = $1", [U(46)])).rows;
    ok(r.months === 12 && r.promotion_id === null, "rules: the row records months 12 and no promotion");
  }

  // ── constraints ──
  {
    const bad = async (q, params) => setup.query(q, params).then(() => false, () => true);
    ok(await bad("insert into public.sub_promotions (creator_id, name, kind, percent_off, durations, starts_at, ends_at) values ($1, 'x', 'percent', 95, '{3}', now(), now() + interval '1 day')", [CREATOR]), "constraint: 95% off is refused");
    ok(await bad("insert into public.sub_promotions (creator_id, name, kind, fixed_price_cents, durations, starts_at, ends_at) values ($1, 'x', 'fixed', 0, '{3}', now(), now() + interval '1 day')", [CREATOR]), "constraint: a fixed price of 0 is refused");
    ok(await bad("insert into public.sub_promotions (creator_id, name, kind, percent_off, durations, starts_at, ends_at) values ($1, 'x', 'percent', 10, '{2}', now(), now() + interval '1 day')", [CREATOR]), "constraint: an unsupported duration is refused");
    ok(await bad("insert into public.sub_promotions (creator_id, name, kind, percent_off, durations, starts_at, ends_at) values ($1, 'x', 'percent', 10, '{3}', now(), now() - interval '1 day')", [CREATOR]), "constraint: ending before it starts is refused");
    ok(await bad("insert into public.creator_membership_settings (creator_id, sub_price_cents, bundle_prices) values ($1, 1000, '{\"3\": 2.5}')", [U(50)]), "constraint: a fractional bundle price is refused");
    ok(!(await bad("insert into public.creator_membership_settings (creator_id, sub_price_cents, bundle_prices) values ($1, 1000, '{\"3\": 2700, \"6\": null}')", [U(51)])), "constraint: a valid bundle table is accepted");
    ok(await bad("update public.sub_purchases set months = 2 where subscriber_id = $1", [U(46)]), "constraint: months outside 1/3/6/12 is refused");
  }
} finally {
  await setup.end();
  await admin.query(`drop database if exists ${dbName} with (force)`);
  await admin.end();
}
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
