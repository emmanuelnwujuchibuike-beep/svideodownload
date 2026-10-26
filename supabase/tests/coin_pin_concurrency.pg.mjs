// 0282 (Frenz Coin Part 4.2) — REAL concurrency for the transaction PIN, on a real PostgreSQL server with SEPARATE
// connections (each one is what a separate app instance would be: nothing is shared but the database).
//
//   PGTEST_URL=postgres://postgres:...@127.0.0.1:55433/postgres node coin_pin_concurrency.pg.mjs <repo>/supabase/migrations [--mutant=no-lock]
//
// Local servers only, its own throwaway database, dropped at the end. Overlap is FORCED where it matters: connection A
// opens a transaction and calls a PIN function (holding the PIN row lock); B calls a competing one and must BLOCK
// (confirmed in pg_stat_activity); then A commits. Bursts run too.
//
// --mutant=no-lock reads the PIN row WITHOUT its lock in begin_coin_pin_attempt (the limit check is then raced): a burst
// of guesses must then get past the limit, and this run must FAIL.
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

import pg from "pg";

import { applyCloseout, coinMigration, depositMigration, depositPrerequisites, migration, scopeMigration, split, STUB, U, walletStatements } from "./credit_wallet.shared.mjs";

const dir = process.argv[2];
const MUTANT = (process.argv.find((a) => a.startsWith("--mutant=")) ?? "").split("=")[1] ?? "";
const url = new URL(process.env.PGTEST_URL ?? "");
if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
  console.error("Refusing: PGTEST_URL must be a LOCAL server (127.0.0.1 / localhost).");
  process.exit(2);
}
const DB = `frenz_coin_pin_${process.pid}`;
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

const POLICY = JSON.stringify({ maxAttempts: 5, lockMinutes: 15, resetTtlMinutes: 10, resetMaxPerHour: 3, resetCodeMaxAttempts: 5 });
const TRANSFER = JSON.stringify({ enabled: true, version: 1, percentBp: 1000, lowThresholdCents: 10000, highThresholdCents: 50000, flatBelowCents: 100, flatMidCents: 0, flatAboveCents: 500, minCents: 1, maxCents: 500000, dailyMaxCents: 10000000 });
const PARAMS = JSON.stringify({ algorithm: "scrypt", N: 32768, r: 8, p: 1, keylen: 32, pepper: "v1" });
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
  const pin = split(readFileSync(`${dir}/0282_frenz_coin_transaction_pin.sql`, "utf8"));
  for (const s of [...split(stub), ...walletStatements(dir), ...depositPrerequisites(dir), ...migration(dir), ...migration(dir), ...coinMigration(dir), ...coinMigration(dir), ...depositMigration(dir), ...depositMigration(dir), ...scopeMigration(dir), ...scopeMigration(dir), ...pin, ...pin, ...applyCloseout(dir)]) await db.query(s);
  await db.query(`insert into auth.users (id, email_confirmed_at) select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, now() from generate_series(1, 80) g`);
  await db.query("insert into public.profiles (id) select id from auth.users");

  if (MUTANT === "no-lock") {
    const b = (await db.query("select pg_get_functiondef(p.oid) d from pg_proc p where proname = 'begin_coin_pin_attempt'")).rows[0].d;
    const m = b.split("from public.coin_pins where user_id = p_user for update;").join("from public.coin_pins where user_id = p_user;");
    if (m === b) throw new Error("mutant no-lock did not apply");
    await db.query(m);
  }

  const one = async (c, s, p) => (await c.query(s, p)).rows[0];
  const call = async (c, s, p) => (await one(c, s, p)).r;
  const key = () => randomBytes(32).toString("hex");
  const keys = {};
  const setPin = async (u) => { keys[u] = key(); await db.query("select set_coin_pin($1, decode($2, 'hex'), decode($3, 'hex'), $4::jsonb)", [u, keys[u], randomBytes(16).toString("hex"), PARAMS]); };
  const beginSql = "select begin_coin_pin_attempt($1, 'transfer', $2::jsonb) r";
  const sendSql = "select transfer_coins_with_pin($1, $2, decode($3, 'hex'), $4, $5, $6, null, $7::jsonb, $8::jsonb) r";
  const begin = async (c, u) => call(c, beginSql, [u, POLICY]);
  const walletNo = async (u) => (await one(db, "select ensure_wallet_number($1) w", [u])).w;
  const fund = (u, n, ref) => db.query("select adjust_coin_balance($1, $2, $3, 'test', $4, false)", [u, n, ref, ADMIN]);
  const coin = async (u) => (await one(db, "select balance_cents::int b from ai_product_balances where user_id = $1 and product = 'frenz_coin'", [u]))?.b ?? 0;
  const transfersBy = async (u) => Number((await one(db, "select count(*) n from coin_transfers where sender_id = $1", [u])).n);
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
  const burst = async (n, fn) => {
    const conns = await Promise.all(Array.from({ length: n }, (_, i) => connect(`burst-${i}`)));
    try {
      return await Promise.all(conns.map((c, i) => fn(c, i).then((r) => ({ r }), (e) => ({ e: String(e.message ?? e) }))));
    } finally {
      await Promise.all(conns.map((c) => c.end()));
    }
  };

  // 1 · one PIN entry used twice at the same moment (a replayed request)
  {
    const S = U(1), R = U(2);
    await setPin(S);
    await fund(S, 100000, "f1");
    const w = await walletNo(R);
    const a = await begin(db, S);
    const x = await race("same-attempt", sendSql, [S, a.attempt_id, keys[S], w, 5000, "s1-a", TRANSFER, POLICY], sendSql, [S, a.attempt_id, keys[S], w, 5000, "s1-b", TRANSFER, POLICY]);
    ok(x.overlapped, "1 · the second use really waited on the first");
    ok(x.a?.ok === true && x.b?.reason === "authorization_failed", `1 · one PIN entry authorizes ONE transfer (${JSON.stringify(x.b ?? x.bError)})`);
    ok((await transfersBy(S)) === 1 && (await coin(S)) === 100000 - 5600, "1 · exactly one debit");
    const many = await burst(10, (c, i) => call(c, sendSql, [S, a.attempt_id, keys[S], w, 100, `s1-burst-${i}`, TRANSFER, POLICY]));
    ok(many.every((m) => m.r?.reason === "authorization_failed") && (await transfersBy(S)) === 1, "1 · ten more uses of the spent attempt at once: all refused");
  }

  // 2 · a burst of guesses from many instances: no more than the limit get an attempt, and nothing is sent
  {
    const S = U(3), R = U(4);
    await setPin(S);
    await fund(S, 100000, "f2");
    const w = await walletNo(R);
    const many = await burst(20, async (c, i) => {
      const a = await begin(c, S);
      if (!a?.ok) return { began: false, reason: a?.reason };
      return { began: true, out: await call(c, sendSql, [S, a.attempt_id, key(), w, 100, `s2-${i}`, TRANSFER, POLICY]) };
    });
    const began = many.filter((m) => m.r?.began).length;
    ok(began <= 5, `2 · 20 simultaneous guesses: at most 5 got an attempt (${began})`);
    ok(many.every((m) => !m.r?.began || m.r.out?.reason === "authorization_failed") && (await transfersBy(S)) === 0, "2 · every guess refused, nothing sent");
    const row = await one(db, "select locked_until from coin_pins where user_id = $1", [S]);
    ok(!!row.locked_until && Date.parse(row.locked_until) > Date.now(), "2 · and the PIN is locked");
    ok((await begin(db, S))?.reason === "locked", "2 · the right PIN cannot even begin until the lock ends");
  }

  // 3 · the right PIN, the same idempotency key, from ten instances at once: one transfer
  {
    const S = U(5), R = U(6);
    await setPin(S);
    await fund(S, 100000, "f3");
    const w = await walletNo(R);
    // five rounds of two: each PIN entry is its own counted attempt (the limit is per attempt, not per request)
    const results = [];
    for (let round = 0; round < 5; round++) {
      const many = await burst(2, async (c) => {
        const a = await begin(c, S);
        return a?.ok ? call(c, sendSql, [S, a.attempt_id, keys[S], w, 5000, "s3-same", TRANSFER, POLICY]) : { ok: false, reason: `begin:${a?.reason}` };
      });
      results.push(...many);
    }
    const okd = results.filter((m) => m.r?.ok);
    ok(okd.length === 10 && okd.filter((m) => !m.r.duplicate).length === 1 && (await transfersBy(S)) === 1 && (await coin(S)) === 100000 - 5600, `3 · ten PIN-confirmed retries of one transfer: one debit, the rest answer "duplicate" (${okd.filter((m) => !m.r.duplicate).length} new)`);
  }

  // 4 · the right reset code submitted from six instances at once: it works once
  {
    const S = U(7);
    await setPin(S);
    const code = randomBytes(32).toString("hex");
    await db.query("select request_coin_pin_reset($1, decode($2, 'hex'), $3::jsonb)", [S, code, POLICY]);
    const many = await burst(6, (c) => call(c, "select complete_coin_pin_reset($1, decode($2, 'hex'), decode($3, 'hex'), decode($4, 'hex'), $5::jsonb, $6::jsonb) r", [S, code, key(), randomBytes(16).toString("hex"), PARAMS, POLICY]));
    ok(many.filter((m) => m.r?.ok).length === 1 && many.every((m) => m.r?.ok || m.r?.reason === "invalid"), `4 · one code, six simultaneous uses: exactly one reset (${many.filter((m) => m.r?.ok).length})`);
  }

  // 5 · reset requests from six instances at once: within the hourly limit, and exactly one live code
  {
    const S = U(8);
    await setPin(S);
    const many = await burst(6, (c) => call(c, "select request_coin_pin_reset($1, decode($2, 'hex'), $3::jsonb) r", [S, randomBytes(32).toString("hex"), POLICY]));
    const issued = many.filter((m) => m.r?.issued).length;
    const live = Number((await one(db, "select count(*) n from coin_pin_resets where user_id = $1 and consumed_at is null and superseded_at is null and failed_at is null", [S])).n);
    ok(issued === 3 && live === 1 && many.every((m) => !m.e), `5 · six simultaneous requests: 3 issued (the hourly limit), one live code (${issued} issued, ${live} live)`);
  }
  // ── closeout (APPLY_0283=1): withdrawals, quotes and corrections under real concurrency ──
  if (process.env.APPLY_0283 === "1") {
    const WITHDRAW = JSON.stringify({ enabled: true, version: 1, percentBp: 600, flatCents: 0, minCents: 500, maxCents: 500000, maxPerDay: 5, maxMonthCents: 100000000, requireQualification: false, requireEmailConfirmed: true, payoutCurrency: "NGN", payoutMinorPerUsd: null });
    const DETAILS = JSON.stringify({ bankCode: "058", bankName: "GTBank", accountNumber: "0123456789", accountName: "ADA OBI" });
    const wdSql = "select request_coin_withdrawal_with_pin($1, $2, decode($3, 'hex'), $4, 'paystack', $5::jsonb, $6, $7::jsonb, $8::jsonb) r";
    // 6 · two PIN-confirmed withdrawals on the same funds at once: one hold
    const S = U(9);
    await setPin(S);
    await fund(S, 15000, "f6");
    const many = await burst(2, async (c, i) => {
      const a = await call(c, "select begin_coin_pin_attempt($1, 'withdrawal', $2::jsonb) r", [S, POLICY]);
      return call(c, wdSql, [S, a.attempt_id, keys[S], 10000, DETAILS, `w6-${i}`, WITHDRAW, POLICY]);
    });
    const held = Number((await one(db, "select held_cents h from ai_product_balances where user_id = $1 and product = 'frenz_coin'", [S])).h);
    ok(many.filter((m) => m.r?.ok).length === 1 && held === 10000, `6 · two PIN-confirmed withdrawals of $100 from $150 at once: one held (${held})`);
    const wid = many.find((m) => m.r?.ok).r.id;
    // 7 · two payout quotes at once (a double-clicked Pay): one amount recorded, both answers agree
    const q = await burst(2, (c, i) => call(c, "select record_coin_payout_quote($1, $2, 'NGN', $3::jsonb) r", [wid, 14100000 + i, JSON.stringify({ source: "market", perUsd: 1500 + i })]));
    const stored = Number((await one(db, "select payout_minor m from withdrawal_requests where id = $1", [wid])).m);
    ok(q.every((m) => Number(m.r?.payout_minor) === stored) && q.filter((m) => m.r?.existing === false).length === 1, `7 · two quotes at once: one recorded (${stored}), the other answers it`);
    // 8 · two fee refunds of one transfer at once, with different keys: refunded once
    const R = U(10);
    const w = await walletNo(R);
    const a8 = await begin(db, S);
    const t8 = await call(db, sendSql, [S, a8.attempt_id, keys[S], w, 1000, "s8", TRANSFER, POLICY]);
    const corr = await burst(4, (c, i) => call(c, "select correct_coin_transfer($1, 'fee_refund', null, 'charged in error', $2, $3) r", [t8.transfer_id, U(20), `corr-${i}-xxxxxx`]));
    const refunded = Number((await one(db, "select count(*) n from coin_transfer_corrections where transfer_id = $1", [t8.transfer_id])).n);
    ok(refunded === 1 && corr.filter((m) => m.r?.ok).length === 1, `8 · four simultaneous fee refunds of one transfer: exactly one (${refunded})`);
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
