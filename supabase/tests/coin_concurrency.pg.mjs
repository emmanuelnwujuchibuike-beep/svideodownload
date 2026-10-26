// 0279 (Frenz Coin Part 3) — REAL concurrency for the coin wallet, on a real PostgreSQL server with SEPARATE connections.
//
//   PGTEST_URL=postgres://postgres:...@127.0.0.1:55433/postgres node coin_concurrency.pg.mjs <repo>/supabase/migrations [--mutant=<name>]
//
// Local servers only (refuses any other host), its own throwaway database, dropped at the end. Never point it at Supabase.
// Needs `pg` and credit_wallet.shared.mjs beside it. Overlap is FORCED: connection A opens a transaction and calls a coin
// function (taking its row locks); connection B calls a competing one and must BLOCK (confirmed in pg_stat_activity); then
// A commits. Bursts of simultaneous calls run too, including transfers in opposite directions.
//
// --mutant=no-lock removes the coin wallet row locks from transfer_coins and request_coin_withdrawal (and the last walls
// behind them: the non-negative / state constraints); double spending and the limit race must then FAIL.
import pg from "pg";

import { applyDeposits, coinMigration, migration, split, STUB, U, walletStatements } from "./credit_wallet.shared.mjs";

const dir = process.argv[2];
const MUTANT = (process.argv.find((a) => a.startsWith("--mutant=")) ?? "").split("=")[1] ?? "";
const url = new URL(process.env.PGTEST_URL ?? "");
if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
  console.error("Refusing: PGTEST_URL must be a LOCAL server (127.0.0.1 / localhost).");
  process.exit(2);
}
const DB = `frenz_coin_${process.pid}`;
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

const TRANSFER = { enabled: true, version: 1, percentBp: 1000, lowThresholdCents: 10000, highThresholdCents: 50000, flatBelowCents: 100, flatMidCents: 0, flatAboveCents: 500, minCents: 1, maxCents: 500000, dailyMaxCents: 10000000 };
const WITHDRAW = { enabled: true, version: 1, percentBp: 600, flatCents: 0, minCents: 1, maxCents: 500000, maxPerDay: 50, maxMonthCents: 100000000, requireQualification: false, requireEmailConfirmed: false, payoutCurrency: "NGN", payoutMinorPerUsd: null };
const ADMIN = U(79);

let failures = 0;
const ok = (c, m) => { if (!c) { failures++; console.log("FAIL:", m); } else console.log("ok:", m); };
const db = await connect("setup");
try {
  await db.query(`do $r$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $r$`);
  const stub = STUB.replace("create role anon; create role authenticated; create role service_role;", "");
  for (const s of [...split(stub), ...walletStatements(dir), ...migration(dir), ...migration(dir), ...coinMigration(dir), ...coinMigration(dir), ...applyDeposits(dir)]) await db.query(s);
  await db.query(`insert into auth.users (id, email_confirmed_at) select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, now() from generate_series(1, 80) g`);
  await db.query("insert into public.profiles (id) select id from auth.users");

  const fnDef = async (name) => (await db.query("select pg_get_functiondef(p.oid) d from pg_proc p where proname = $1", [name])).rows[0].d;
  if (MUTANT === "no-lock") {
    const t = await fnDef("transfer_coins");
    const tm = t.replace("perform 1 from public.ai_product_balances where product = 'frenz_coin' and user_id in (p_sender, v_recipient) order by user_id for update;", "");
    const w = await fnDef("request_coin_withdrawal");
    const wm = w.replace("from public.ai_product_balances where user_id = p_user and product = 'frenz_coin' for update;", "from public.ai_product_balances where user_id = p_user and product = 'frenz_coin';");
    if (tm === t || wm === w) throw new Error("mutant no-lock did not apply");
    await db.query(tm);
    await db.query(wm);
    // the last walls: without them a race shows as money
    await db.query("alter table public.ai_product_balances drop constraint if exists ai_product_balances_non_negative");
    await db.query("alter table public.ai_product_balances drop constraint if exists ai_product_balances_coin_state_chk");
    await db.query("alter table public.ai_product_balances drop constraint if exists ai_product_balances_withdrawable_chk");
    await db.query("drop index if exists public.withdrawal_requests_one_open_uidx");
  }

  const one = async (c, s, p) => (await c.query(s, p)).rows[0];
  const call = async (c, s, p) => (await one(c, s, p)).r;
  const fund = (u, n, ref) => db.query("select adjust_coin_balance($1, $2, $3, 'test', $4, false)", [u, n, ref, ADMIN]);
  const walletNo = async (u) => (await one(db, "select ensure_wallet_number($1) w", [u])).w;
  const coin = (u) => one(db, "select balance_cents::int b, pending_cents::int p, held_cents::int h from ai_product_balances where user_id = $1 and product = 'frenz_coin'", [u]);
  const sendSql = "select transfer_coins($1, $2, $3, $4, null, $5::jsonb) r";
  const wdSql = "select request_coin_withdrawal($1, $2, 'paystack', '{}'::jsonb, $3, $4::jsonb) r";
  const resolveSql = "select resolve_withdrawal($1::uuid, $2, null, 'test', null) r";
  const T = (over = {}) => JSON.stringify({ ...TRANSFER, ...over });
  const Wr = (over = {}) => JSON.stringify({ ...WITHDRAW, ...over });
  const invariants = async (label) => {
    const bad = (await db.query(`select b.user_id from ai_product_balances b
      left join (select user_id, sum(delta_cents) s, coalesce(sum(delta_cents) filter (where status = 'reserved' and delta_cents > 0), 0) pend,
                        coalesce(-sum(delta_cents) filter (where status = 'reserved' and delta_cents < 0), 0) held from ai_product_ledger where product = 'frenz_coin' group by user_id) l on l.user_id = b.user_id
      where b.product = 'frenz_coin' and (b.balance_cents <> coalesce(l.s, 0) or b.pending_cents <> coalesce(l.pend, 0) or b.held_cents <> coalesce(l.held, 0) or b.balance_cents < b.pending_cents or b.held_cents < 0)`)).rows;
    const c = await one(db, `select
        (select coalesce(sum(delta_cents), 0) from ai_product_ledger where product = 'frenz_coin' and kind = 'adjustment')::bigint funded,
        (select coalesce(sum(balance_cents + held_cents), 0) from ai_product_balances where product = 'frenz_coin')::bigint wallets,
        (select coalesce(sum(net_cents), 0) from withdrawal_requests where source = 'coin' and status = 'completed')::bigint paid_out,
        (select coalesce(sum(case when source = 'coin_withdrawal_fee_reversal' then -amount else amount end), 0) from platform_fee_ledger where source like 'coin_%')::bigint fees,
        (select coalesce(sum(-delta_cents), 0) from ai_product_ledger where product = 'frenz_coin' and kind = 'transfer_fee')::bigint charged,
        (select coalesce(sum(amount), 0) from platform_fee_ledger where source = 'coin_transfer_fee')::bigint posted`);
    const n = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Number(v)]));
    ok(!bad.length && n.funded === n.wallets + n.paid_out + n.fees && n.charged === n.posted,
      `invariants hold after: ${label}${bad.length ? ` — ${bad.length} wallet(s) off their ledger` : ""} (funded ${n.funded} = wallets ${n.wallets} + paid ${n.paid_out} + fees ${n.fees}; fees ${n.charged}/${n.posted})`);
  };
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
      const a = await call(A, aSql, aArgs);
      const bPromise = call(B, bSql, bArgs).then((r) => ({ r }), (e) => ({ e: String(e.message ?? e) }));
      const overlapped = await waitBlocked(`B-${label}`);
      await A.query("commit");
      const b = await bPromise;
      return { a, b: b.r ?? null, bError: b.e ?? null, overlapped };
    } finally {
      await A.end();
      await B.end();
    }
  };
  const burst = async (n, sql, argsFor) => {
    const conns = await Promise.all(Array.from({ length: n }, (_, i) => connect(`burst-${i}`)));
    try {
      return await Promise.all(conns.map((c, i) => call(c, sql, argsFor(i)).then((r) => ({ r }), (e) => ({ e: String(e.message ?? e) }))));
    } finally {
      await Promise.all(conns.map((c) => c.end()));
    }
  };

  // 1 · two transfers against one balance (amount + fee)
  {
    const S = U(1), R1 = U(2), R2 = U(3);
    await fund(S, 10000, "s1");
    const [w1, w2] = [await walletNo(R1), await walletNo(R2)];
    const x = await race("spend", sendSql, [S, w1, 6000, "s1-a", T()], sendSql, [S, w2, 6000, "s1-b", T()]);
    ok(x.overlapped, "1 · the second transfer really waited on the first");
    ok(x.a?.ok === true && x.b?.ok === false && x.b?.reason === "insufficient", `1 · $60 + $7 fee twice from $100: one wins, the other is refused (${JSON.stringify(x.b ?? x.bError)})`);
    ok((await coin(S)).b === 3300, "1 · exactly 100 − 67 = $33 left");
    await invariants("1");
  }

  // 2 · two transfers at the daily limit, then a burst
  {
    const S = U(4), R = U(5);
    await fund(S, 1000000, "s2");
    const w = await walletNo(R);
    const x = await race("daily", sendSql, [S, w, 6000, "d-a", T({ dailyMaxCents: 10000 })], sendSql, [S, w, 6000, "d-b", T({ dailyMaxCents: 10000 })]);
    ok(x.overlapped && x.a?.ok === true && x.b?.reason === "daily_limit", `2 · 60 + 60 over a 100 daily limit: the second is refused (${JSON.stringify(x.b ?? x.bError)})`);
    const many = await burst(12, sendSql, (i) => [S, w, 1000, `d-burst-${i}`, T({ dailyMaxCents: 10000 })]);
    const sent = Number((await one(db, "select coalesce(sum(amount_cents), 0) s from coin_transfers where sender_id = $1", [S])).s);
    ok(sent === 10000 && many.filter((m) => m.r?.ok).length === 4 && many.every((m) => !m.e), `2 · a burst of 12 × $10 fills the limit exactly (sent ${sent})`);
    await invariants("2");
  }

  // 3 · two withdrawals reserving the same funds
  {
    const W = U(6);
    await fund(W, 10000, "s3");
    const x = await race("withdraw", wdSql, [W, 8000, "w-a", Wr()], wdSql, [W, 8000, "w-b", Wr()]);
    ok(x.overlapped, "3 · the second withdrawal really waited on the first");
    ok(x.a?.ok === true && x.b?.ok === false && ["open_exists", "insufficient"].includes(x.b?.reason), `3 · the same $80 can be held only once (${JSON.stringify(x.b ?? x.bError)})`);
    const c = await coin(W);
    ok(c.b === 2000 && c.h === 8000, "3 · one hold of $80");
    await invariants("3");
  }

  // 4 · the same idempotency key from two connections
  {
    const S = U(7), R = U(8);
    await fund(S, 10000, "s4");
    const w = await walletNo(R);
    const x = await race("idem", sendSql, [S, w, 2000, "same-key", T()], sendSql, [S, w, 2000, "same-key", T()]);
    ok(x.a?.ok === true && x.b?.duplicate === true && x.b?.transfer_id === x.a?.transfer_id, `4 · one key twice at once is one transfer (${JSON.stringify(x.b ?? x.bError)})`);
    ok((await coin(S)).b === 10000 - 2300, "4 · charged once ($20 + $3 fee)");
    await invariants("4");
  }

  // 5 · a resolution and a request on the same wallet at once; the same completion twice
  {
    const W = U(9);
    await fund(W, 50000, "s5");
    const first = await call(db, wdSql, [W, 10000, "r-1", Wr()]);
    await call(db, resolveSql, [first.id, "approved"]);
    const x = await race("resolve", resolveSql, [first.id, "completed"], wdSql, [W, 5000, "r-2", Wr()]);
    ok(x.overlapped && x.a?.ok === true && !x.bError, `5 · completing one withdrawal while the member asks for another: no deadlock, both answered (${JSON.stringify(x.b ?? x.bError)})`);
    const y = await call(db, resolveSql, [x.b?.id ?? first.id, "approved"]);
    const z = await race("complete-twice", resolveSql, [x.b?.id, "completed"], resolveSql, [x.b?.id, "completed"]);
    ok(y?.ok !== false && z.a?.ok === true && z.b?.ok === false && z.b?.reason === "final", `5 · completing twice at once completes once (${JSON.stringify(z.b ?? z.bError)})`);
    const fees = Number((await one(db, "select count(*) n from platform_fee_ledger where source = 'coin_withdrawal_fee' and payer_id = $1", [W])).n);
    ok(fees === 2, `5 · one fee row per completed withdrawal (${fees})`);
    await invariants("5");
  }

  // 6 · transfers in opposite directions at once never deadlock
  {
    const P = U(10), Q = U(11);
    await fund(P, 100000, "s6p");
    await fund(Q, 100000, "s6q");
    const [wP, wQ] = [await walletNo(P), await walletNo(Q)];
    const many = await burst(16, sendSql, (i) => (i % 2 ? [P, wQ, 1000, `pq-${i}`, T()] : [Q, wP, 1000, `qp-${i}`, T()]));
    ok(many.every((m) => m.r?.ok === true), `6 · 16 crossed transfers: all succeed, none deadlocks (${many.filter((m) => m.e).map((m) => m.e).join(" | ")})`);
    await invariants("6");
  }

  // 7 · a burst draining one wallet
  {
    const S = U(12), R = U(13);
    await fund(S, 12000, "s7");
    const w = await walletNo(R);
    const many = await burst(20, sendSql, (i) => [S, w, 1000, `b-${i}`, T()]);
    const won = many.filter((m) => m.r?.ok).length;
    ok(won === 10 && many.every((m) => !m.e) && (await coin(S)).b === 0, `7 · 20 × ($10 + $2 fee) from $120: exactly 10 succeed, nothing overdrawn (${won})`);
    await invariants("7");
  }
} catch (e) {
  failures++;
  console.log("FAIL: harness error", e.message);
} finally {
  await db.end();
  await admin.query(`drop database if exists ${DB} with (force)`);
  await admin.end();
}
console.log(failures === 0 ? `\nALL PASSED${MUTANT ? ` (mutant ${MUTANT} SURVIVED — no teeth)` : ""}` : `\n${failures} FAILED${MUTANT ? ` (mutant ${MUTANT} caught)` : ""}`);
process.exit(failures === 0 ? (MUTANT ? 3 : 0) : 1);
