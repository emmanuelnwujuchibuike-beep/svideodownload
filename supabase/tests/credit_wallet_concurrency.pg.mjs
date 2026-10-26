// 0278 (Frenz Coin Part 2) — REAL concurrency for the AI-credit wallet, on a real PostgreSQL server with SEPARATE
// connections (PGlite is one connection and cannot interleave two transactions).
//
//   PGTEST_URL=postgres://postgres:...@127.0.0.1:55433/postgres node credit_wallet_concurrency.pg.mjs <repo>/supabase/migrations [--mutant=<name>]
//
// Local servers only: refuses any host that isn't 127.0.0.1 / localhost, creates its own throwaway database and drops
// it at the end. Never point it at Supabase. Needs `pg` and credit_wallet.shared.mjs beside it.
//
// How overlap is FORCED (not hoped for): connection A opens a transaction and calls a money function, which takes its
// row lock; connection B calls a competing function and BLOCKS; a third connection confirms from pg_stat_activity that
// B is really waiting on a lock; then A commits and B finishes. Bursts of simultaneous calls run as well.
//
// --mutant=no-lock removes the wallet row locks from transfer_credits_checked AND transfer_credits (0202): the daily
// limit race and the double spend must then FAIL.
import pg from "pg";

import { applyDeposits, coinMigration, migration, split, STUB, U, walletStatements } from "./credit_wallet.shared.mjs";

const dir = process.argv[2];
const MUTANT = (process.argv.find((a) => a.startsWith("--mutant=")) ?? "").split("=")[1] ?? "";
const url = new URL(process.env.PGTEST_URL ?? "");
if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
  console.error("Refusing: PGTEST_URL must be a LOCAL server (127.0.0.1 / localhost).");
  process.exit(2);
}
const DB = `frenz_wallet_${process.pid}`;
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

let failures = 0;
const ok = (c, m) => { if (!c) { failures++; console.log("FAIL:", m); } else console.log("ok:", m); };
const db = await connect("setup");
try {
  // roles are cluster-wide on a real server: create them once (one statement — the splitter knows only $$)
  await db.query(`do $r$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $r$`);
  const stub = STUB.replace("create role anon; create role authenticated; create role service_role;", "");
  for (const s of [...split(stub), ...walletStatements(dir), ...migration(dir), ...migration(dir)]) await db.query(s);
  // Frenz Coin Part 3 regression: APPLY_0279=1 runs every credit scenario with 0279 on top (it must not change them)
  if (process.env.APPLY_0279 === "1") for (const s of [...coinMigration(dir), ...coinMigration(dir), ...applyDeposits(dir)]) await db.query(s);
  await db.query(`insert into auth.users (id) select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid from generate_series(1, 80) g`);
  await db.query("insert into public.profiles (id) select id from auth.users");

  const fnDef = async (name) => (await db.query("select pg_get_functiondef(p.oid) d from pg_proc p where proname = $1", [name])).rows[0].d;
  if (MUTANT === "no-lock") {
    for (const name of ["transfer_credits_checked", "transfer_credits"]) {
      const b = await fnDef(name);
      const m = b.replace("perform 1 from public.ai_product_balances where product = 'character_replace' and user_id in (p_sender, v_recipient) order by user_id for update;", "");
      if (m === b) throw new Error(`mutant no-lock did not apply to ${name}`);
      await db.query(m);
    }
    // the non-negative balance check is the last wall against a double spend: without it the race shows as money
    await db.query("alter table public.ai_product_balances drop constraint if exists ai_product_balances_non_negative");
    await db.query("alter table public.ai_product_balances drop constraint if exists ai_product_balances_withdrawable_chk");
  }

  const one = async (c, s, p) => (await c.query(s, p)).rows[0];
  const call = async (c, s, p) => (await one(c, s, p)).r;
  const grant = (u, n, ref) => db.query("select credit_product_balance($1, 'character_replace', $2, 'grant', $3, 'CREDIT')", [u, n, ref]);
  const deposit = (u, n, ref) => db.query("select credit_product_balance($1, 'character_replace', $2, 'recharge', $3, 'CREDIT')", [u, n, ref]);
  const walletNo = async (u) => (await one(db, "select ensure_wallet_number($1) w", [u])).w;
  const bal = (u) => one(db, "select balance_cents::int b, withdrawable_cents::int w, deposited_cents::int d from ai_product_balances where user_id = $1", [u]);
  const transferSql = "select transfer_credits_checked($1, $2, $3, $4, $5, null, $6, $7) r";
  const withdrawSql = "select request_credit_withdrawal($1, $2, $2, $3, 'paystack', '{}'::jsonb, '{}'::jsonb, 'pending', $4, $5, $6) r";
  const invariants = async (label) => {
    const bad = (await db.query(`select b.user_id from ai_product_balances b left join (select user_id, sum(delta_cents) s from ai_product_ledger group by user_id) l on l.user_id = b.user_id
      where b.balance_cents <> coalesce(l.s, 0) or b.balance_cents < 0 or b.withdrawable_cents > b.balance_cents or b.withdrawable_cents < 0`)).rows;
    const fees = await one(db, "select (select coalesce(sum(-delta_cents), 0) from ai_product_ledger where kind = 'transfer_fee')::int l, (select coalesce(sum(amount), 0) from platform_fee_ledger)::int p");
    ok(!bad.length && fees.l === fees.p, `invariants hold after: ${label}${bad.length ? " — balance != ledger or out of range for " + bad.length : ""}${fees.l !== fees.p ? ` — fees ${fees.l} vs counter-entries ${fees.p}` : ""}`);
  };
  const waitBlocked = async (name) => {
    for (let i = 0; i < 200; i++) {
      const r = await one(db, "select wait_event_type from pg_stat_activity where datname = $1 and application_name = $2 and state = 'active'", [DB, name]);
      if (r?.wait_event_type === "Lock") return true;
      await new Promise((res) => setTimeout(res, 25));
    }
    return false;
  };
  /** A runs `aSql` inside an open transaction (holding its locks); B runs `bSql` and must block until A commits. */
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

  // 1 · two transfers spending the same balance
  {
    const S = U(1), R1 = U(2), R2 = U(3);
    await grant(S, 100, "s1-grant");
    const [w1, w2] = [await walletNo(R1), await walletNo(R2)];
    const x = await race("spend", transferSql, [S, w1, 80, 0, "s1-a", "usable", 100000], transferSql, [S, w2, 80, 0, "s1-b", "usable", 100000]);
    ok(x.overlapped, "1 · the second transfer really waited on the first (forced overlap)");
    ok(x.a?.ok === true && x.b?.ok === false && x.b?.reason === "insufficient", `1 · one transfer wins, the other is refused cleanly as insufficient (${JSON.stringify(x.b ?? x.bError)})`);
    ok((await bal(S)).b === 20, "1 · the sender has exactly 20 left — never spent twice");
    await invariants("1 · same balance");
  }

  // 2 · two withdrawals competing for the same withdrawable balance
  {
    const W = U(4);
    await deposit(W, 100, "frenz_cr_topup_w1");
    await db.query("insert into reward_profiles (user_id, qualification_status, qualified_at) values ($1, 'approved', now())", [W]);
    const x = await race("withdraw", withdrawSql, [W, 80, 800, "w-a", 5, 100000], withdrawSql, [W, 80, 800, "w-b", 5, 100000]);
    ok(x.overlapped, "2 · the second withdrawal really waited on the first");
    ok(x.a?.ok === true && x.b?.ok === false && ["open_exists", "insufficient_withdrawable"].includes(x.b?.reason), `2 · exactly one withdrawal holds the money (${JSON.stringify(x.b ?? x.bError)})`);
    ok((await bal(W)).w === 20 && Number((await one(db, "select count(*) n from withdrawal_requests where user_id = $1", [W])).n) === 1, "2 · one hold, one request row");
    await invariants("2 · same withdrawable balance");
  }

  // 3 · two transfers approaching the daily limit
  {
    const S = U(5), R = U(6);
    await grant(S, 1000, "s3-grant");
    const w = await walletNo(R);
    const x = await race("daily", transferSql, [S, w, 60, 0, "d-a", "usable", 100], transferSql, [S, w, 60, 0, "d-b", "usable", 100]);
    ok(x.overlapped, "3 · the second transfer really waited on the first");
    ok(x.a?.ok === true && x.b?.ok === false && x.b?.reason === "daily_limit", `3 · 60 + 60 over a 100 daily limit: the second is refused (${JSON.stringify(x.b ?? x.bError)})`);
    const sent = Number((await one(db, "select coalesce(sum(amount), 0) s from credit_transfers where sender_id = $1", [S])).s);
    ok(sent === 60, `3 · only 60 was sent (${sent})`);
    const many = await burst(12, transferSql, (i) => [S, w, 10, 0, `d-burst-${i}`, "usable", 100]);
    const sentAfter = Number((await one(db, "select coalesce(sum(amount), 0) s from credit_transfers where sender_id = $1", [S])).s);
    ok(sentAfter === 100 && many.filter((m) => m.r?.ok).length === 4, `3 · a burst of 12 x 10 fills the limit exactly (sent ${sentAfter}, ${many.filter((m) => m.r?.ok).length} accepted)`);
    await invariants("3 · daily limit");
  }

  // 4 · withdrawals approaching the day / 30-day limits
  {
    const W = U(7);
    await deposit(W, 1000, "frenz_cr_topup_w7");
    await db.query("insert into reward_profiles (user_id, qualification_status, qualified_at) values ($1, 'approved', now())", [W]);
    const first = await call(db, withdrawSql, [W, 100, 1000, "m-0", 5, 250]);
    await call(db, "select resolve_withdrawal($1::uuid, 'approved', null, null, null) r", [first.id]);
    await call(db, "select resolve_withdrawal($1::uuid, 'completed', null, null, 'paid-0') r", [first.id]);
    const x = await race("month", withdrawSql, [W, 100, 1000, "m-a", 5, 250], withdrawSql, [W, 100, 1000, "m-b", 5, 250]);
    ok(x.overlapped, "4 · the second withdrawal really waited on the first");
    ok(x.a?.ok === true && x.b?.ok === false && ["month_limit", "open_exists"].includes(x.b?.reason), `4 · 100 done + 100 + 100 over a 250 limit: the second is refused (${JSON.stringify(x.b ?? x.bError)})`);
    const held = Number((await one(db, "select coalesce(sum(credits), 0) s from withdrawal_requests where user_id = $1 and status not in ('rejected', 'cancelled')", [W])).s);
    ok(held === 200, `4 · the 30-day total stays within the limit (${held})`);
    await invariants("4 · withdrawal limits");
  }

  // 5 · one idempotency key from two connections at once
  {
    const S = U(8), R = U(9);
    await grant(S, 100, "s5-grant");
    const w = await walletNo(R);
    const x = await race("idem", transferSql, [S, w, 30, 2, "same-key", "usable", 100000], transferSql, [S, w, 30, 2, "same-key", "usable", 100000]);
    ok(x.a?.ok === true && x.b?.ok === true && x.b?.duplicate === true && x.b?.transfer_id === x.a?.transfer_id, `5 · the same key twice at once is one transfer (${JSON.stringify(x.b ?? x.bError)})`);
    ok((await bal(S)).b === 68 && Number((await one(db, "select count(*) n from credit_transfers where sender_id = $1", [S])).n) === 1, "5 · charged once (30 + 2 fee)");
    const wr = await burst(8, withdrawSql, () => [S, 10, 100, "wd-same-key", 5, 100000]);
    ok(wr.every((r) => !r.e), "5 · eight identical withdrawal replays raise nothing");
    await invariants("5 · idempotency");
  }

  // 6 · the same reversal / settlement requested twice at once
  {
    const M = U(10);
    await deposit(M, 100, "frenz_cr_topup_m10");
    const rev = "select reverse_wallet_topup('paystack', $1, $2, $3, null, 1000, 'NGN', null, null) r";
    const x = await race("reverse", rev, ["refund:m10", "refund", "frenz_cr_topup_m10"], rev, ["refund:m10", "refund", "frenz_cr_topup_m10"]);
    ok(x.overlapped, "6 · the second reversal really waited on the first");
    ok(x.a?.ok === true && x.b?.duplicate === true && (await bal(M)).b === 0, `6 · one refund event delivered twice at once reverses once (${JSON.stringify(x.b ?? x.bError)})`);
    const many = await burst(6, rev, (i) => [`refund:m10-other-${i}`, "refund", "frenz_cr_topup_m10"]);
    ok(many.every((m) => !m.e) && Number((await one(db, "select coalesce(sum(credits_due), 0) s from wallet_topup_reversals where reference = 'frenz_cr_topup_m10'")).s) === 100, "6 · six more refund events at once never take more than the top-up credited");

    const D = U(11);
    await deposit(D, 50, "frenz_cr_topup_d11");
    await call(db, rev, ["dispute:d11", "dispute", "frenz_cr_topup_d11"]);
    const id = (await one(db, "select id from wallet_topup_reversals where event_key = 'dispute:d11'")).id;
    const res = "select resolve_wallet_topup_dispute($1::uuid, 'won', $2, 'won') r";
    const y = await race("restore", res, [id, U(79)], res, [id, U(79)]);
    ok(y.overlapped && y.a?.ok === true && y.b?.duplicate === true && (await bal(D)).b === 50, `6 · a dispute outcome recorded twice at once restores once (${JSON.stringify(y.b ?? y.bError)})`);
    await invariants("6 · reversals");
  }

  // 7 · a burst of transfers from one wallet
  {
    const S = U(12), R = U(13);
    await grant(S, 100, "s7-grant");
    const w = await walletNo(R);
    const many = await burst(20, transferSql, (i) => [S, w, 10, 0, `b-${i}`, "usable", 100000]);
    const won = many.filter((m) => m.r?.ok).length;
    ok(won === 10 && many.every((m) => !m.e) && (await bal(S)).b === 0, `7 · 20 simultaneous transfers of 10 from 100: exactly 10 succeed, nothing errors, nothing overdrawn (${won})`);
    await invariants("7 · burst");
  }

  // 8 · a failed operation leaves nothing behind
  {
    const S = U(14), R = U(15);
    await grant(S, 10, "s8-grant");
    const w = await walletNo(R);
    const r = await call(db, transferSql, [S, w, 50, 1, "fail-1", "usable", 100000]);
    ok(r.ok === false && (await bal(S)).b === 10 && Number((await one(db, "select count(*) n from credit_transfers where sender_id = $1", [S])).n) === 0, "8 · a refused transfer changes no balance and writes no row");
    await db.query("update profiles set is_suspended = true where id = $1", [S]);
    ok((await call(db, transferSql, [S, w, 5, 0, "fail-2", "usable", 100000])).reason === "suspended", "8 · a suspended sender is refused under the lock");
    ok((await call(db, withdrawSql, [S, 5, 50, "fail-3", 5, 100000])).reason === "suspended", "8 · a suspended member cannot withdraw");
    await invariants("8 · failures");
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
