// Frenz Exclusive Part 12 closure — REAL concurrency, on a real PostgreSQL server with SEPARATE
// connections (the PGlite harness is one connection and can't interleave two transactions).
//
//   PGTEST_URL=postgres://postgres:...@127.0.0.1:55432/postgres node sub_concurrency.pg.mjs <repo>/supabase/migrations [--mutant=<name>]
//
// Local servers only: the script refuses any host that isn't 127.0.0.1 / localhost, creates its own
// throwaway database, and drops it at the end. Never point it at Supabase.
//
// How overlap is FORCED (not hoped for): connection A opens a transaction and calls a money function,
// which takes its row lock; connection B calls a competing function and BLOCKS; a third connection
// confirms from pg_stat_activity that B is really waiting on a lock; then A commits and B finishes.
// Each case also runs a burst of simultaneous calls from many connections.
//
// The stub schema is read from sub_financial_invariants.pglite.mjs, so both harnesses test the same
// tables. Migrations: 0227, 0231, 0237, 0239, 0247, 0250, 0254, 0256 (the real functions).
//
// --mutant=<name> removes one protection; the run must FAIL:
//   no-wd-lock   resolve_withdrawal reads the withdrawal WITHOUT `for update`
//   no-bal-lock  request_sub_withdrawal AND release_sub_earnings read the balance WITHOUT `for update`
//                (and the one-open-withdrawal index and the non-negative balance check are dropped: each of
//                the three alone already stops a double hold)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const dir = process.argv[2];
const MUTANT = (process.argv.find((a) => a.startsWith("--mutant=")) ?? "").split("=")[1] ?? "";
const url = new URL(process.env.PGTEST_URL ?? "");
if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
  console.error("Refusing: PGTEST_URL must be a LOCAL server (127.0.0.1 / localhost).");
  process.exit(2);
}
const DB = `frenz_conc_${process.pid}`;
const admin = new pg.Client({ connectionString: url.toString() });
await admin.connect();
await admin.query(`create database ${DB} encoding 'UTF8' template template0 lc_collate 'C' lc_ctype 'C'`); // Supabase is UTF-8
const dbUrl = new URL(url.toString());
dbUrl.pathname = `/${DB}`;
const connect = async (name) => {
  const c = new pg.Client({ connectionString: dbUrl.toString(), application_name: name });
  await c.connect();
  return c;
};

const here = dirname(fileURLToPath(import.meta.url));
const harness = readFileSync(join(process.env.PGTEST_HARNESS_DIR ?? here, "sub_financial_invariants.pglite.mjs"), "utf8");
const stub = harness.slice(harness.indexOf("const stub = `") + "const stub = `".length, harness.indexOf("`;", harness.indexOf("const stub = `")));

let failures = 0;
const ok = (c, m) => { if (!c) { failures++; console.log("FAIL:", m); } else console.log("ok:", m); };
const db = await connect("setup");
try {
  // roles are cluster-wide on a real server: create them once
  await db.query(stub.replace("create role anon; create role authenticated; create role service_role;", `do $r$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $r$;`));
  await db.query(`insert into auth.users (id) select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid from generate_series(1, 60) g`);
  for (const f of ["0227_sub_monetization.sql", "0231_sub_promo_dismiss.sql", "0237_sub_post_thumbs.sql", "0239_private_post_interactions.sql", "0247_sub_settlement_hardening.sql", "0250_sub_membership_lifecycle.sql", "0254_payout_reversal_dispute_restore.sql", "0256_withdrawal_rejection_settles_debt.sql"]) {
    await db.query(readFileSync(`${dir}/${f}`, "utf8"));
  }
  const fnDef = async (name) => (await db.query("select pg_get_functiondef(p.oid) d from pg_proc p where proname = $1", [name])).rows[0].d;
  if (MUTANT === "no-wd-lock") {
    const b = await fnDef("resolve_withdrawal");
    const m = b.replace("from public.withdrawal_requests where id = p_id for update;", "from public.withdrawal_requests where id = p_id;");
    if (m === b) throw new Error("mutant no-wd-lock did not apply");
    await db.query(m);
  }
  if (MUTANT === "no-bal-lock") {
    const b = await fnDef("request_sub_withdrawal");
    const m = b.replace("select * into v_b from public.sub_balances where creator_id = p_user for update;", "select * into v_b from public.sub_balances where creator_id = p_user;");
    if (m === b) throw new Error("mutant no-bal-lock did not apply");
    await db.query(m);
    // request_sub_withdrawal calls release_sub_earnings FIRST, which locks the same balance row — so that
    // lock must go too, or the mutant changes nothing (observed: with only the first removed, all passed)
    const rb = await fnDef("release_sub_earnings");
    const rm = rb.replace("select * into v_b from public.sub_balances where creator_id = p_creator for update;", "select * into v_b from public.sub_balances where creator_id = p_creator;");
    if (rm === rb) throw new Error("mutant no-bal-lock (release) did not apply");
    await db.query(rm);
    await db.query("drop index if exists public.withdrawal_requests_one_open_uidx");
    // and the third layer: with no lock, B's UPDATE re-reads A's committed row and would go negative,
    // which sub_balances_nonneg_chk refuses (observed: locks + index alone removed, all still passed)
    await db.query("alter table public.sub_balances drop constraint if exists sub_balances_nonneg_chk");
  }

  const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const one = async (c, s, p) => (await c.query(s, p)).rows[0];
  const call = async (c, s, p) => (await one(c, s, p)).r;
  let refN = 0;
  const purchase = async (creator, sub, price = 1000, hold = 0) => {
    const ref = `frenz_sub_c${++refN}`;
    const fee = Math.floor((price * 1000) / 10000);
    await db.query(`insert into sub_purchases (creator_id, subscriber_id, price_cents, fee_cents, total_cents, fee_bp, charged_currency, charged_minor, reference, hold_days) values ($1, $2, $3, $4, $5, 1000, 'NGN', 165000, $6, $7)`, [creator, sub, price, fee, price + fee, ref, hold]);
    return ref;
  };
  const settleSql = "select settle_sub_purchase($1, 165000, 'NGN', 'trx') as r";
  const settle = (c, ref) => call(c, settleSql, [ref]);
  let key = 0;
  const withdrawSql = "select request_sub_withdrawal($1, $2, 1000, 500, 'paystack', '{}'::jsonb, '{}'::jsonb, $3, false) as r";
  const resolveSql = "select resolve_withdrawal($1::uuid, $2, null, 'test', null) as r";
  const bal = (c) => one(db, "select pending_cents::int p, available_cents::int a, held_cents::int h, debt_cents::int d, lifetime_cents::int l, withdrawn_cents::int w from sub_balances where creator_id = $1", [c]);
  const invariants = async (c, label) => {
    const b = await bal(c);
    const paid = (await one(db, "select coalesce(sum(price_cents), 0)::int s from sub_purchases where creator_id = $1 and status = 'paid'", [c])).s;
    const ledger = (await one(db, "select coalesce(sum(amount_cents) filter (where kind in ('earning', 'clawback', 'dispute_restore')), 0)::int s from sub_ledger where creator_id = $1", [c])).s;
    const open = (await one(db, "select coalesce(sum(gross_cents), 0)::int s from withdrawal_requests where user_id = $1 and source = 'sub' and status in ('pending', 'reviewing', 'approved', 'processing')", [c])).s;
    const done = (await one(db, "select coalesce(sum(gross_cents), 0)::int s from withdrawal_requests where user_id = $1 and source = 'sub' and status = 'completed'", [c])).s;
    const bad = [];
    if (b.p < 0 || b.a < 0 || b.h < 0 || b.d < 0) bad.push("a negative balance field");
    if (b.p + b.a + b.h + b.w - b.d !== b.l) bad.push(`pending+available+held+withdrawn-debt (${b.p + b.a + b.h + b.w - b.d}) != lifetime (${b.l})`);
    if (b.l !== paid) bad.push(`lifetime ${b.l} != paid purchases ${paid}`);
    if (ledger !== b.l) bad.push(`ledger ${ledger} != lifetime ${b.l}`);
    if (b.h !== open) bad.push(`held ${b.h} != open withdrawals ${open}`);
    if (b.w !== done) bad.push(`withdrawn ${b.w} != completed ${done}`);
    ok(!bad.length, `invariants hold after: ${label}${bad.length ? " — " + bad.join("; ") : ""}`);
  };
  /** Wait until the connection named `name` is blocked on a lock (proof the two calls overlapped). */
  const waitBlocked = async (name) => {
    for (let i = 0; i < 200; i++) {
      const r = await one(db, "select wait_event_type from pg_stat_activity where datname = $1 and application_name = $2 and state = 'active'", [DB, name]);
      if (r?.wait_event_type === "Lock") return true;
      await new Promise((res) => setTimeout(res, 25));
    }
    return false;
  };
  /**
   * A holds the lock in an open transaction running `aSql`; B runs `bSql` and must block; then A commits.
   * Returns both results. Without a lock B does NOT block, and `overlapped` is false.
   */
  const race = async (label, aSql, aArgs, bSql, bArgs) => {
    const A = await connect(`A-${label}`);
    const B = await connect(`B-${label}`);
    try {
      await A.query("begin");
      const a = await call(A, aSql, aArgs);
      const bPromise = call(B, bSql, bArgs).then((r) => ({ r }), (e) => ({ e: String(e.message ?? e) }));
      const overlapped = await waitBlocked(`B-${label}`);
      await A.query("commit");
      const b = await bPromise;
      return { a, b, overlapped };
    } finally {
      await A.end();
      await B.end();
    }
  };
  /** Many connections fire the same call at once. */
  const burst = async (n, sql, argsFor) => {
    const clients = await Promise.all(Array.from({ length: n }, (_, i) => connect(`burst-${i}`)));
    try {
      return await Promise.all(clients.map((c, i) => call(c, sql, argsFor(i)).then((r) => ({ r }), (e) => ({ e: String(e.message ?? e) }))));
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  };

  // ── 1 · two withdrawals competing for the same available balance ──
  const C1 = U(1);
  await settle(db, await purchase(C1, U(21)));
  const r1 = await race("wd", withdrawSql, [C1, 1000, "k-a"], withdrawSql, [C1, 1000, "k-b"]);
  ok(r1.overlapped, "1. B's withdrawal really waited on A's lock (separate connections, forced overlap)");
  ok(r1.a.ok && (r1.b.e || (r1.b.r && !r1.b.r.ok)), `1. one withdrawal holds the 1000; the other is refused (${r1.b.e ? "unique index" : r1.b.r?.reason})`);
  ok((await bal(C1)).h === 1000 && (await bal(C1)).a === 0, "1. 1000 held once, nothing negative");
  await invariants(C1, "two competing withdrawals");
  const C1b = U(2);
  await settle(db, await purchase(C1b, U(22)));
  const b1 = await burst(12, withdrawSql, (i) => [C1b, 1000, `kb-${i}`]);
  ok(b1.filter((x) => x.r?.ok && !x.r.duplicate).length === 1, `1. a burst of 12 simultaneous withdrawals: exactly one holds the money (${b1.filter((x) => x.e).length} unique-index refusals, ${b1.filter((x) => x.r && !x.r.ok).length} insufficient)`);
  await invariants(C1b, "burst of withdrawals");

  // ── 2 · duplicate settlement of one payment ──
  const C2 = U(3);
  const ref2 = await purchase(C2, U(23));
  const r2 = await race("settle", settleSql, [ref2], settleSql, [ref2]);
  ok(r2.overlapped, "2. the second settlement really waited on the first");
  ok(r2.a.ok && !r2.a.duplicate && r2.b.r?.ok && r2.b.r.duplicate, "2. one settles, the other answers 'duplicate'");
  const ref2b = await purchase(C2, U(24));
  const b2 = await burst(12, settleSql, () => [ref2b]);
  ok(b2.filter((x) => x.r?.ok && !x.r.duplicate).length === 1 && b2.every((x) => x.r?.ok), "2. a burst of 12 settlements of one reference: exactly one earning");
  ok((await bal(C2)).l === 2000, "2. lifetime 2000 for two payments, not more");
  await invariants(C2, "duplicate settlement");

  // ── 3 · rejection racing payout confirmation ──
  const C3 = U(4);
  await settle(db, await purchase(C3, U(25)));
  const w3 = await call(db, withdrawSql, [C3, 1000, "k3"]);
  await call(db, resolveSql, [w3.id, "approved"]);
  await call(db, resolveSql, [w3.id, "processing"]);
  const r3 = await race("pay-vs-reject", resolveSql, [w3.id, "completed"], resolveSql, [w3.id, "rejected"]);
  ok(r3.overlapped, "3. the rejection really waited on the payout confirmation");
  ok(r3.a.ok && r3.b.r && !r3.b.r.ok && r3.b.r.reason === "final", "3. paid first: the rejection is refused as final");
  ok((await bal(C3)).w === 1000 && (await bal(C3)).a === 0 && (await bal(C3)).h === 0, "3. withdrawn once, never also released");
  await invariants(C3, "payout vs rejection");
  // the other order: rejected first (with debt), then the late confirmation
  const C3b = U(5);
  const p3b = await purchase(C3b, U(26));
  await settle(db, p3b);
  const w3b = await call(db, withdrawSql, [C3b, 1000, "k3b"]);
  await call(db, resolveSql, [w3b.id, "approved"]);
  await call(db, resolveSql, [w3b.id, "processing"]);
  await call(db, "select reverse_sub_purchase($1, 'disputed', null, 'test') as r", [p3b]);
  const r3b = await race("reject-vs-pay", resolveSql, [w3b.id, "rejected"], resolveSql, [w3b.id, "completed"]);
  ok(r3b.overlapped && r3b.a.ok && r3b.b.r?.reason === "final", "3. rejected first: the late confirmation is refused, after really waiting");
  ok((await bal(C3b)).d === 0 && (await bal(C3b)).a === 0 && (await bal(C3b)).w === 0, "3. the rejection settled the 1000 debt once; nothing withdrawn");
  await invariants(C3b, "rejection with debt vs payout");
  const C3c = U(6);
  await settle(db, await purchase(C3c, U(27)));
  const w3c = await call(db, withdrawSql, [C3c, 1000, "k3c"]);
  await call(db, resolveSql, [w3c.id, "approved"]);
  await call(db, resolveSql, [w3c.id, "processing"]);
  const b3 = await burst(16, resolveSql, (i) => [w3c.id, i % 2 ? "rejected" : "completed"]);
  ok(b3.filter((x) => x.r?.ok).length === 1, `3. a burst of 16 mixed confirm/reject calls: exactly one wins (${b3.find((x) => x.r?.ok)?.r.status})`);
  ok((await one(db, "select count(*)::int n from sub_ledger where withdrawal_id = $1 and kind in ('withdrawal_paid', 'withdrawal_return')", [w3c.id])).n === 1, "3. one settling ledger row");
  await invariants(C3c, "burst of confirm/reject");

  // ── 4 · duplicate payout reversal ──
  const C4 = U(7);
  await settle(db, await purchase(C4, U(28)));
  const w4 = await call(db, withdrawSql, [C4, 1000, "k4"]);
  for (const s of ["approved", "processing", "completed"]) await call(db, resolveSql, [w4.id, s]);
  const revSql = "select reverse_paid_withdrawal($1::uuid, null, 'bank returned it') as r";
  const r4 = await race("reversal", revSql, [w4.id], revSql, [w4.id]);
  ok(r4.overlapped && r4.a.ok && r4.b.r?.ok && r4.b.r.duplicate, "4. the second reversal waited, then answered 'duplicate'");
  ok((await bal(C4)).a === 1000 && (await bal(C4)).w === 0 && (await bal(C4)).l === 1000, "4. 1000 returned once; lifetime unchanged");
  await invariants(C4, "duplicate reversal");

  // ── 5 · duplicate dispute restoration ──
  const C5 = U(8);
  const p5 = await purchase(C5, U(29));
  await settle(db, p5);
  await call(db, "select reverse_sub_purchase($1, 'disputed', null, 'test') as r", [p5]);
  const restSql = "select restore_disputed_sub_purchase($1, $2, 'won') as r";
  const r5 = await race("restore", restSql, [p5, U(50)], restSql, [p5, U(50)]);
  ok(r5.overlapped && r5.a.ok && r5.b.r?.ok && r5.b.r.duplicate, "5. the second restore waited, then answered 'duplicate'");
  const p5b = await purchase(C5, U(30));
  await settle(db, p5b);
  await call(db, "select reverse_sub_purchase($1, 'disputed', null, 'test') as r", [p5b]);
  const b5 = await burst(12, restSql, () => [p5b, U(50)]);
  ok(b5.filter((x) => x.r?.ok && !x.r.duplicate).length === 1, "5. a burst of 12 restores: exactly one credits");
  ok((await one(db, "select count(*)::int n from sub_ledger where creator_id = $1 and kind = 'dispute_restore'", [C5])).n === 2 && (await bal(C5)).l === 2000, "5. one restore row per purchase, lifetime 2000");
  await invariants(C5, "duplicate restore");

  // ── 6 · debt repayment racing a withdrawal reservation ──
  const C6 = U(9);
  const p6 = await purchase(C6, U(31));
  await settle(db, p6);
  const w6 = await call(db, withdrawSql, [C6, 1000, "k6"]);
  for (const s of ["approved", "processing", "completed"]) await call(db, resolveSql, [w6.id, s]);
  await call(db, "select reverse_sub_purchase($1, 'disputed', null, 'test') as r", [p6]); // debt 1000
  // a new 1500 earning on a 7-day hold, whose hold then ends (time passing, simulated on the purchase only)
  const p6c = await purchase(C6, U(33), 1500, 7);
  await settle(db, p6c);
  await db.query("update sub_purchases set available_at = now() - interval '1 second' where reference = $1", [p6c]);
  ok((await bal(C6)).d === 1000 && (await bal(C6)).p === 1500 && (await bal(C6)).a === 0, "6. setup: debt 1000, 1500 pending and now due");
  await invariants(C6, "setup: 1500 pending, debt 1000");
  const r6 = await race("debt-vs-withdraw", "select release_sub_earnings($1) as r", [C6], withdrawSql, [C6, 1000, "k6b"]);
  ok(r6.overlapped, "6. the withdrawal really waited on the release that repays the debt");
  const b6 = await bal(C6);
  ok(r6.b.r && !r6.b.r.ok && r6.b.r.reason === "insufficient" && b6.d === 0 && b6.a === 500, "6. the debt was repaid first; a 1000 withdrawal can't take money that went to the debt (500 left)");
  await invariants(C6, "debt repayment vs withdrawal");
} finally {
  await db.end();
  await admin.query(`drop database if exists ${DB} with (force)`);
  await admin.end();
}
console.log(failures ? `\n${failures} FAILED` : "\nALL OK");
process.exit(failures ? 1 : 0);
