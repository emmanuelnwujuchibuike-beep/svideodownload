// 0290 (Frenz Gift Coin Part 2) — REAL concurrency for conversions, on a real PostgreSQL server with SEPARATE connections.
//
//   PGTEST_URL=postgres://postgres:...@127.0.0.1:55433/postgres node fgc_conversion_concurrency.pg.mjs <repo>/supabase/migrations [--mutant=no-lock]
//
// Local servers only (refuses any other host), its own throwaway database, dropped at the end. Never point it at Supabase.
// Needs `pg` and credit_wallet.shared.mjs beside it. Applies 0278–0284 and 0290 (the full coin stack). Overlap is FORCED:
// connection A opens a transaction and converts (taking both wallet locks); connection B's competing call must BLOCK
// (confirmed in pg_stat_activity); then A commits. Bursts of simultaneous calls run too, mixing conversions in both
// directions with FC transfers between the same members (a deadlock would surface as an error).
//
// --mutant=no-lock removes convert_fgc's wallet locks (and the last walls behind them: the non-negative / state
// constraints and the per-member key index); overspending, the limit race and a doubled replay must then FAIL.
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
const DB = `frenz_fgc_${process.pid}`;
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

const RULES = { version: 1, fcToFgc: { rateNum: 1, rateDen: 1, feeBp: 200, feeFlat: 0, minIn: 1, maxIn: 10_000_000, dailyMaxIn: 100_000_000 }, fgcToFc: { rateNum: 1, rateDen: 1, feeBp: 500, feeFlat: 1, minIn: 1, maxIn: 10_000_000, dailyMaxIn: 100_000_000 } };
const TRANSFER = { enabled: true, version: 1, percentBp: 1000, lowThresholdCents: 10000, highThresholdCents: 50000, flatBelowCents: 100, flatMidCents: 0, flatAboveCents: 500, minCents: 1, maxCents: 500000, dailyMaxCents: 100000000 };
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
  const hold284 = (d) => split(readFileSync(`${d}/0284_frenz_coin_deposit_hold.sql`, "utf8"));
  for (const s of [...split(stub), ...walletStatements(dir), ...depositPrerequisites(dir)]) await db.query(s);
  for (const m of [migration, coinMigration, depositMigration, scopeMigration, pinMigration, closeoutMigration, hold284, giftMigration]) { for (const s of m(dir)) await db.query(s); for (const s of m(dir)) await db.query(s); }
  await db.query(`insert into auth.users (id, email_confirmed_at) select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, now() from generate_series(1, 80) g`);
  await db.query("insert into public.profiles (id) select id from auth.users");

  const fnDef = async (name) => (await db.query("select pg_get_functiondef(p.oid) d from pg_proc p where proname = $1", [name])).rows[0].d;
  if (MUTANT === "no-lock") {
    const f = await fnDef("convert_fgc");
    const fm = f.replace("perform 1 from public.ai_product_balances where user_id = p_user and product in ('frenz_coin', 'frenz_gift') order by product, user_id for update;", "");
    if (fm === f) throw new Error("mutant no-lock did not apply");
    await db.query(fm);
    await db.query("alter table public.ai_product_balances drop constraint if exists ai_product_balances_non_negative");
    await db.query("alter table public.ai_product_balances drop constraint if exists ai_product_balances_coin_state_chk");
    await db.query("alter table public.ai_product_balances drop constraint if exists ai_product_balances_withdrawable_chk");
    await db.query("drop index if exists public.fgc_conversions_idem_uidx");
  }

  const one = async (c, s, p) => (await c.query(s, p)).rows[0];
  const call = async (c, s, p) => (await one(c, s, p)).r;
  const fund = (u, n, ref) => db.query("select adjust_coin_balance($1, $2, $3, 'test', $4, false)", [u, n, ref, ADMIN]);
  const walletNo = async (u) => (await one(db, "select ensure_wallet_number($1) w", [u])).w;
  const bal = async (u, product) => Number((await one(db, "select balance_cents b from ai_product_balances where user_id = $1 and product = $2", [u, product]))?.b ?? 0);
  const convSql = "select convert_fgc($1, $2, $3, $4, $5::jsonb) r";
  const sendSql = "select transfer_coins($1, $2, $3, $4, null, $5::jsonb) r";
  const R = (over = {}) => JSON.stringify({ ...RULES, ...over });
  const T = JSON.stringify(TRANSFER);
  const invariants = async (label) => {
    const bad = (await db.query(`select b.user_id from ai_product_balances b
      left join (select user_id, product, sum(delta_cents) s, coalesce(sum(delta_cents) filter (where status = 'reserved' and delta_cents > 0), 0) pend,
                        coalesce(-sum(delta_cents) filter (where status = 'reserved' and delta_cents < 0), 0) held from ai_product_ledger group by user_id, product) l on l.user_id = b.user_id and l.product = b.product
      where b.product in ('frenz_coin', 'frenz_gift') and (b.balance_cents <> coalesce(l.s, 0) or b.pending_cents <> coalesce(l.pend, 0) or b.held_cents <> coalesce(l.held, 0) or b.balance_cents < b.pending_cents or b.balance_cents < 0)`)).rows;
    const c = await one(db, `select
        (select count(*) from fgc_conversions)::int convs,
        (select count(*) from ai_product_ledger where kind = 'conversion_out')::int outs,
        (select count(*) from ai_product_ledger where kind = 'conversion_in')::int ins,
        (select coalesce(sum(fee_amount), 0) from fgc_conversions)::bigint fees,
        (select coalesce(sum(amount), 0) from platform_fee_ledger where source like '%conversion_fee')::bigint posted,
        (select coalesce(-sum(delta_cents), 0) from ai_product_ledger where kind = 'conversion_fee')::bigint charged,
        (select count(*) from (select user_id, idempotency_key from fgc_conversions group by 1, 2 having count(*) > 1) d)::int dupes`);
    const n = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Number(v)]));
    ok(!bad.length && n.convs === n.outs && n.convs === n.ins && n.fees === n.posted && n.fees === n.charged && n.dupes === 0,
      `invariants hold after: ${label}${bad.length ? ` — ${bad.length} wallet(s) off their ledger or negative` : ""} (${n.convs} conversions = ${n.outs} debits = ${n.ins} credits, fees ${n.fees}/${n.posted}/${n.charged}, duplicate keys ${n.dupes})`);
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
  const burst = async (n, jobs) => {
    const conns = await Promise.all(Array.from({ length: n }, (_, i) => connect(`burst-${i}`)));
    try {
      return await Promise.all(conns.map((c, i) => { const [sql, args] = jobs(i); return call(c, sql, args).then((r) => ({ r }), (e) => ({ e: String(e.message ?? e) })); }));
    } finally {
      await Promise.all(conns.map((c) => c.end()));
    }
  };

  // 1 · two conversions against one FC balance
  {
    const S = U(1);
    await fund(S, 10_000, "s1");
    const x = await race("spend", convSql, [S, "fc_to_fgc", 6_000, "s1-key-a", R()], convSql, [S, "fc_to_fgc", 6_000, "s1-key-b", R()]);
    ok(x.overlapped, "1 · the second conversion really waited on the first");
    ok(x.a?.ok === true && x.b?.ok === false && x.b?.reason === "insufficient", `1 · 6000 twice from 10000: one converts, the other is refused (${JSON.stringify(x.b ?? x.bError)})`);
    ok((await bal(S, "frenz_coin")) === 4_000 && (await bal(S, "frenz_gift")) === 5_880, "1 · FC 4000 left, FGC 5880 (one conversion's net)");
    await invariants("1");
  }

  // 2 · the same idempotency key twice at once (a double-clicked retry)
  {
    const S = U(2);
    await fund(S, 10_000, "s2");
    const x = await race("replay", convSql, [S, "fc_to_fgc", 3_000, "s2-same-key", R()], convSql, [S, "fc_to_fgc", 3_000, "s2-same-key", R()]);
    ok(x.overlapped, "2 · the retry really waited on the first call");
    ok(x.a?.ok === true && x.b?.ok === true && x.b.duplicate === true && x.b.conversion_id === x.a.conversion_id, `2 · the retry answers the first conversion (${JSON.stringify(x.b ?? x.bError)})`);
    ok((await bal(S, "frenz_coin")) === 7_000 && Number((await one(db, "select count(*) n from fgc_conversions where user_id = $1", [S])).n) === 1, "2 · converted once: one record, FC 7000");
    await invariants("2");
  }

  // 3 · a conversion and an FC transfer racing for the same FC
  {
    const S = U(3), Rc = U(4);
    await fund(S, 10_000, "s3");
    const w = await walletNo(Rc);
    const x = await race("conv-vs-transfer", convSql, [S, "fc_to_fgc", 6_000, "s3-key-a", R()], sendSql, [S, w, 5_000, "s3-tr-0001", T]);
    ok(x.overlapped, "3 · the transfer really waited on the conversion");
    ok(x.a?.ok === true && x.b?.ok === false && x.b?.reason === "insufficient", `3 · 6000 converted, then 5000 + 600 fee is refused (${JSON.stringify(x.b ?? x.bError)})`);
    const y = await race("transfer-vs-conv", sendSql, [S, w, 3_000, "s3-tr-0002", T], convSql, [S, "fc_to_fgc", 1_000, "s3-key-b", R()]);
    ok(y.overlapped && y.a?.ok === true && y.b?.ok === false && y.b?.reason === "insufficient", `3 · the other order: 3000 + 400 fee sent, then 1000 more cannot convert from 600 (${JSON.stringify(y.b ?? y.bError)})`);
    ok((await bal(S, "frenz_coin")) === 600, "3 · exactly 10000 − 6000 − 3400 = 600 FC left");
    await invariants("3");
  }

  // 4 · both directions at once for one member (same lock order: no deadlock)
  {
    const S = U(5);
    await fund(S, 10_000, "s5");
    await call(db, convSql, [S, "fc_to_fgc", 5_000, "s5-seed-01", R()]);
    const x = await race("both-ways", convSql, [S, "fc_to_fgc", 2_000, "s5-key-a", R()], convSql, [S, "fgc_to_fc", 2_000, "s5-key-b", R()]);
    ok(x.overlapped && x.a?.ok === true && x.b?.ok === true && !x.bError, `4 · FC -> FGC and FGC -> FC at once both complete, no deadlock (${x.bError ?? "ok"})`);
    await invariants("4");
  }

  // 5 · 20 conversions of 1000 from 10000 at once
  {
    const S = U(6);
    await fund(S, 10_000, "s6");
    const out = await burst(20, (i) => [convSql, [S, "fc_to_fgc", 1_000, `s6-key-${String(i).padStart(3, "0")}`, R()]]);
    const won = out.filter((o) => o.r?.ok).length;
    ok(won === 10 && out.every((o) => !o.e), `5 · 20 × 1000 from 10000: exactly 10 convert, nothing overdrawn (${won}${out.find((o) => o.e)?.e ? `, error: ${out.find((o) => o.e).e}` : ""})`);
    ok((await bal(S, "frenz_coin")) === 0, "5 · FC is exactly 0, never below");
    await invariants("5");
  }

  // 6 · the daily limit under a burst
  {
    const S = U(7);
    await fund(S, 10_000_000, "s7");
    const out = await burst(12, (i) => [convSql, [S, "fc_to_fgc", 100_000, `s7-key-${String(i).padStart(3, "0")}`, R({ fcToFgc: { ...RULES.fcToFgc, dailyMaxIn: 300_000 } })]]);
    const won = out.filter((o) => o.r?.ok).length;
    ok(won === 3, `6 · daily limit 300000, 12 × 100000 at once: exactly 3 convert (${won})`);
    await invariants("6");
  }

  // 7 · a mixed burst: two members converting both ways and sending FC to each other at once (deadlock check)
  {
    const P = U(8), Q = U(9);
    await fund(P, 1_000_000, "s8p");
    await fund(Q, 1_000_000, "s8q");
    await call(db, convSql, [P, "fc_to_fgc", 200_000, "s8-seed-p", R()]);
    await call(db, convSql, [Q, "fc_to_fgc", 200_000, "s8-seed-q", R()]);
    const [wp, wq] = [await walletNo(P), await walletNo(Q)];
    const out = await burst(16, (i) => {
      const who = i % 2 ? P : Q;
      const k = `s8-${String(i).padStart(3, "0")}`;
      if (i % 4 === 0) return [sendSql, [P, wq, 10_000, `${k}-tr`, T]];
      if (i % 4 === 1) return [sendSql, [Q, wp, 10_000, `${k}-tr`, T]];
      return [convSql, [who, i % 3 ? "fc_to_fgc" : "fgc_to_fc", 20_000, k, R()]];
    });
    const errs = out.filter((o) => o.e).map((o) => o.e);
    ok(errs.length === 0, `7 · 16 simultaneous transfers and conversions between two members: no deadlock, no error (${errs[0] ?? "none"})`);
    ok(out.every((o) => o.e || o.r?.ok), "7 · every call completed");
    await invariants("7");
  }
} finally {
  await db.end();
  await admin.query(`drop database if exists ${DB} with (force)`);
  await admin.end();
}
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
