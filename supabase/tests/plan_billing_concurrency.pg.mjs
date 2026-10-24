// Part 3.3 — REAL concurrency for 0274 (apply_plan_renewal, expire_flutterwave_site_plan) on a real PostgreSQL server with
// SEPARATE connections (the PGlite harness is one connection and can't interleave two transactions).
//
//   PGTEST_URL=postgres://postgres:...@127.0.0.1:55432/postgres node plan_billing_concurrency.pg.mjs <repo>/supabase/migrations [--mutant=no-lock]
//
// Same method as sub_concurrency.pg.mjs: local servers only (refuses any host but 127.0.0.1 / localhost), its own
// throwaway database (dropped at the end), READ COMMITTED like Supabase. Each race is FORCED: connection A opens a
// transaction and calls the function (taking the row lock); B calls a competing one and a third connection confirms in
// pg_stat_activity that B is really WAITING on a lock; then A commits and B finishes. Plus bursts of simultaneous calls.
//
// --mutant=no-lock removes `for update` from both functions: two different renewals then lose a period, and an expiry
// overwrites a renewal — the run must FAIL. (The same transaction twice stays stopped by the ledger's unique key.)
import pg from "pg";

import { STUB, migration, split } from "./0274_plan_billing.shared.mjs";

const dir = process.argv[2];
const MUTANT = (process.argv.find((a) => a.startsWith("--mutant=")) ?? "").slice("--mutant=".length);
const base = process.env.PGTEST_URL;
if (!base) throw new Error("PGTEST_URL is required (a LOCAL PostgreSQL)");
const u = new URL(base);
if (!["127.0.0.1", "localhost"].includes(u.hostname)) throw new Error("refusing a non-local database");

const dbName = `plan_billing_${Date.now()}`;
const admin = new pg.Client({ connectionString: base });
await admin.connect();
// UTF8 like Supabase (a Windows server's default would be WIN1252, and the migration's comments are UTF-8)
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
  if (!c) {
    failures++;
    console.log("FAIL:", m);
  } else console.log("ok:", m);
};

try {
  const setup = await connect();
  // roles are cluster-wide (they may exist from an earlier run); a replacer function, because "$$" in a replacement STRING means "$"
  const stub = STUB.replace(/create role (\w+);/g, (_m, role) => `do $$ begin create role ${role}; exception when duplicate_object then null; end $$;`);
  for (const s of split(stub)) await setup.query(s);
  const sql = migration(dir, MUTANT);
  for (const s of split(sql)) await setup.query(s);
  for (const s of split(sql)) await setup.query(s); // idempotent
  const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  await setup.query(`insert into auth.users (id) select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid from generate_series(1, 40) g`);
  await setup.query(`insert into profiles (id, role) select id, 'pro' from auth.users`);
  const seed = (n, endSql) =>
    setup.query(`insert into subscriptions (user_id, plan, status, provider, subscription_ref, plan_code, contract_amount_minor, contract_currency, contract_interval, current_period_end) values ($1, 'pro', 'active', 'flutterwave', $2, '501', 900, 'USD', 'monthly', ${endSql})`, [U(n), `70${n}`]);
  const applySql = `select apply_plan_renewal('flutterwave', $1, 'site_subscription', $2, $3, '501', 900, 'USD', 'webhook', null) r`;
  const endOf = async (n) => new Date((await setup.query(`select current_period_end e from subscriptions where user_id = $1`, [U(n)])).rows[0].e).getTime();
  const months = (a, b) => Math.round((b - a) / (30.4 * 86_400_000));
  /** B is really blocked on a lock (not just slow) */
  const waitingOnLock = async (pid) => {
    for (let i = 0; i < 50; i++) {
      const r = await setup.query(`select wait_event_type from pg_stat_activity where pid = $1`, [pid]);
      if (r.rows[0]?.wait_event_type === "Lock") return true;
      await new Promise((res) => setTimeout(res, 40));
    }
    return false;
  };
  /** A holds its transaction open after `aSql`; B runs `bSql` (must block); A commits; B's result returned */
  const race = async (aSql, aArgs, bSql, bArgs) => {
    const A = await connect();
    const B = await connect();
    const bPid = (await B.query("select pg_backend_pid() p")).rows[0].p;
    await A.query("begin");
    const aRes = (await A.query(aSql, aArgs)).rows[0].r;
    const bPromise = B.query(bSql, bArgs);
    const blocked = await waitingOnLock(bPid);
    await A.query("commit");
    const bRes = (await bPromise).rows[0].r;
    await A.end();
    await B.end();
    return { aRes, bRes, blocked };
  };

  // 1 · the SAME transaction from two deliveries at once
  await seed(1, "now() + interval '1 day'");
  let before = await endOf(1);
  let out = await race(applySql, ["800001", U(1), "701"], applySql, ["800001", U(1), "701"]);
  ok(out.aRes.result === "applied" && out.bRes.result === "duplicate", `same transaction, two connections: one applied, one duplicate (got ${out.aRes.result} / ${out.bRes.result})`);
  ok(out.blocked || MUTANT === "no-lock", "…the second really waited on the row lock");
  ok(months(before, await endOf(1)) === 1, "…exactly ONE period added");

  // 2 · two DIFFERENT renewals of one subscription at once — neither may be lost
  await seed(2, "now() + interval '1 day'");
  before = await endOf(2);
  out = await race(applySql, ["800002", U(2), "702"], applySql, ["800003", U(2), "702"]);
  ok(out.aRes.result === "applied" && out.bRes.result === "applied", "two different transactions at once: both applied");
  ok(months(before, await endOf(2)) === 2, `…TWO periods added, none lost (got ${months(before, await endOf(2))})`);

  // 3 · expiry racing a renewal: the renewal holds the lock, the expiry waits and must then see the new period
  await seed(3, "now() - interval '5 days'");
  out = await race(applySql, ["800004", U(3), "703"], `select expire_flutterwave_site_plan($1) r`, [U(3)]);
  ok(out.bRes === "not_expired", `expiry that waited for a renewal does NOT expire it (got ${out.bRes})`);
  const s3 = (await setup.query(`select status::text s from subscriptions where user_id = $1`, [U(3)])).rows[0].s;
  const r3 = (await setup.query(`select role::text r from profiles where id = $1`, [U(3)])).rows[0].r;
  ok(s3 === "active" && r3 === "pro", `…the renewed member stays active and Pro (got ${s3} / ${r3})`);

  // 4 · a burst: 12 connections deliver the same transaction simultaneously
  await seed(4, "now() + interval '1 day'");
  before = await endOf(4);
  const burst = await Promise.all(
    Array.from({ length: 12 }, async () => {
      const c = await connect();
      try {
        return (await c.query(applySql, ["800005", U(4), "704"])).rows[0].r.result;
      } finally {
        await c.end();
      }
    }),
  );
  ok(burst.filter((r) => r === "applied").length === 1 && burst.filter((r) => r === "duplicate").length === 11, `12 simultaneous deliveries: 1 applied, 11 duplicate (got ${JSON.stringify(burst.reduce((m, r) => ({ ...m, [r]: (m[r] ?? 0) + 1 }), {}))})`);
  ok(months(before, await endOf(4)) === 1, "…one period");

  // 5 · a burst of 8 different transactions for one subscription: all counted
  await seed(5, "now() + interval '1 day'");
  before = await endOf(5);
  const burst2 = await Promise.all(
    Array.from({ length: 8 }, async (_, i) => {
      const c = await connect();
      try {
        return (await c.query(applySql, [`81000${i}`, U(5), "705"])).rows[0].r.result;
      } finally {
        await c.end();
      }
    }),
  );
  ok(burst2.every((r) => r === "applied"), "8 different simultaneous transactions: all applied");
  ok(months(before, await endOf(5)) === 8, `…EIGHT periods added (got ${months(before, await endOf(5))})`);
  // 6 · 0275: two ADMINS apply the same reviewed transaction at once — one applied, one duplicate, the review closed once
  await seed(6, "now() + interval '1 day'");
  before = await endOf(6);
  await setup.query(`insert into plan_billing_reviews (dedupe_key, kind, reason, transaction_id) values ('renewal:flutterwave:800006', 'renewal', 'held', '800006')`);
  const adminApply = `select apply_plan_renewal('flutterwave', $1, 'site_subscription', $2, $3, '501', 900, 'USD', 'admin', $4) r`;
  out = await race(adminApply, ["800006", U(6), "706", U(30)], adminApply, ["800006", U(6), "706", U(31)]);
  ok(out.aRes.result === "applied" && out.bRes.result === "duplicate", `two admins at once: one applied, one duplicate (got ${out.aRes.result} / ${out.bRes.result})`);
  const rv6 = (await setup.query(`select status, resolved_by from plan_billing_reviews where dedupe_key = 'renewal:flutterwave:800006'`)).rows[0];
  ok(rv6.status === "applied" && rv6.resolved_by === U(30), `…the review is closed once, by the admin who applied it (got ${rv6.status} / ${rv6.resolved_by === U(30) ? "first" : "other"})`);
  ok(months(before, await endOf(6)) === 1, "…one period");

  const ledger = (await setup.query(`select count(*)::int n from plan_renewals`)).rows[0].n;
  ok(ledger === 1 + 2 + 1 + 1 + 8 + 1, `the ledger holds exactly one row per applied transaction (got ${ledger})`);
  await setup.end();
} catch (e) {
  failures++;
  console.log("HARNESS ERROR:", e instanceof Error ? e.message : String(e));
} finally {
  await admin.query(`drop database if exists ${dbName} with (force)`).catch(() => {});
  await admin.end();
}
console.log(failures ? `\n${failures} FAILED${MUTANT ? ` (mutant ${MUTANT}: expected)` : ""}` : `\nALL OK${MUTANT ? ` — but mutant ${MUTANT} should have failed!` : ""}`);
process.exit(failures ? 1 : 0);
