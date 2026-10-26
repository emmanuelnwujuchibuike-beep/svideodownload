// 0280 (Frenz Coin Part 4) — REAL concurrency for coin deposits, on a real PostgreSQL server with SEPARATE connections.
//
//   PGTEST_URL=postgres://postgres:...@127.0.0.1:55433/postgres node coin_deposits_concurrency.pg.mjs <repo>/supabase/migrations [--mutant=no-lock]
//
// Local servers only (refuses any other host), its own throwaway database, dropped at the end. Never point it at Supabase.
// Needs `pg` and credit_wallet.shared.mjs beside it. Overlap is FORCED: connection A opens a transaction and calls a
// deposit function (taking its locks); connection B calls a competing one and must BLOCK (confirmed in pg_stat_activity);
// then A commits. Bursts of simultaneous calls run too: the webhook, the return page and the sweep settling one deposit
// at once, two releases, a release against a refund, two refund events, two checkouts opened at once.
//
// --mutant=no-lock removes the locks from settle_coin_deposit (the attempt row) and reverse_coin_deposit (the wallet and
// the deposit), and the walls behind them (coin_deposits' primary key, the ledger's unique reference): a deposit must
// then be credited twice, or taken back twice — and this run must FAIL.
import pg from "pg";

import { coinMigration, depositMigration, depositPrerequisites, migration, scopeMigration, SCOPED, split, STUB, U, walletStatements } from "./credit_wallet.shared.mjs";

const dir = process.argv[2];
const MUTANT = (process.argv.find((a) => a.startsWith("--mutant=")) ?? "").split("=")[1] ?? "";
const url = new URL(process.env.PGTEST_URL ?? "");
if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
  console.error("Refusing: PGTEST_URL must be a LOCAL server (127.0.0.1 / localhost).");
  process.exit(2);
}
const DB = `frenz_coin_dep_${process.pid}`;
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

const DEP = JSON.stringify({ enabled: true, version: 1, holdHours: 72, minCents: 100, maxCents: 500000 });
const TRANSFER = JSON.stringify({ enabled: true, version: 1, percentBp: 1000, lowThresholdCents: 10000, highThresholdCents: 50000, flatBelowCents: 100, flatMidCents: 0, flatAboveCents: 500, minCents: 1, maxCents: 500000, dailyMaxCents: 10000000 });

let failures = 0;
const ok = (c, m) => { if (!c) { failures++; console.log("FAIL:", m); } else console.log("ok:", m); };
const db = await connect("setup");
try {
  await db.query(`do $r$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $r$`);
  const stub = STUB.replace("create role anon; create role authenticated; create role service_role;", "");
  for (const s of [...split(stub), ...walletStatements(dir), ...depositPrerequisites(dir), ...migration(dir), ...migration(dir), ...coinMigration(dir), ...coinMigration(dir), ...depositMigration(dir), ...depositMigration(dir), ...(SCOPED ? [...scopeMigration(dir), ...scopeMigration(dir)] : [])]) await db.query(s);
  await db.query(`insert into auth.users (id, email_confirmed_at) select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, now() from generate_series(1, 80) g`);
  await db.query("insert into public.profiles (id) select id from auth.users");

  const fnDef = async (name) => (await db.query("select pg_get_functiondef(p.oid) d from pg_proc p where proname = $1", [name])).rows[0].d;
  const mutate = async (name, from, to) => { const b = await fnDef(name); const m = b.split(from).join(to); if (m === b) throw new Error(`mutant on ${name} did not apply`); await db.query(m); };
  if (MUTANT === "no-lock") {
    await mutate("settle_coin_deposit", "where reference = p_reference for update;", "where reference = p_reference;");
    await mutate("reverse_coin_deposit", "where user_id = v_user and product = 'frenz_coin' for update;", "where user_id = v_user and product = 'frenz_coin';");
    await mutate("reverse_coin_deposit", "from public.coin_deposits where reference = p_reference for update;", "from public.coin_deposits where reference = p_reference;");
    // the walls behind the locks: without them a race shows as money
    await db.query("alter table public.coin_deposits drop constraint coin_deposits_pkey");
    for (const r of (await db.query("select indexname from pg_indexes where tablename = 'ai_product_ledger' and indexdef ilike '%unique%' and indexdef ilike '%reference%'")).rows) await db.query(`drop index public.${r.indexname}`);
  }

  const one = async (c, s, p) => (await c.query(s, p)).rows[0];
  const call = async (c, s, p) => (await one(c, s, p)).r;
  const coin = async (u) => (await one(db, "select balance_cents::int b, pending_cents::int p, held_cents::int h from ai_product_balances where user_id = $1 and product = 'frenz_coin'", [u])) ?? { b: 0, p: 0, h: 0 };
  let seq = 0;
  const ref = () => `frenz_coin_dep_fw_00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
  const begin = (c, u, r, cents, key) => call(c, "select begin_coin_deposit($1, $2, $3, 'flutterwave', $3, 'USD', $4, $5::jsonb) r", [u, r, cents, key, DEP]);
  const opened = async (u, cents) => { const r = ref(); await begin(db, u, r, cents, "k-" + r.slice(-12)); return r; };
  const settleSql = "select settle_coin_deposit($1, 'ch-1', $2, 'USD') r";
  const releaseSql = "select release_coin_deposit($1) r";
  const reverseSql = "select reverse_coin_deposit('flutterwave', $1, 'refund', $2, null, null, 'USD', null, 'test') r";
  const age = async (r) => {
    await db.query("alter table public.coin_deposits disable trigger coin_deposits_guard");
    await db.query("update public.coin_deposits set settled_at = settled_at - interval '72 hours 1 second', release_at = release_at - interval '72 hours 1 second' where reference = $1", [r]);
    await db.query("alter table public.coin_deposits enable trigger coin_deposits_guard");
  };
  const invariants = async (label) => {
    const bad = (await db.query(`select b.user_id from ai_product_balances b
      left join (select user_id, sum(delta_cents) s, coalesce(sum(delta_cents) filter (where status = 'reserved' and delta_cents > 0), 0) pend,
                        coalesce(-sum(delta_cents) filter (where status = 'reserved' and delta_cents < 0), 0) held from ai_product_ledger where product = 'frenz_coin' group by user_id) l on l.user_id = b.user_id
      where b.product = 'frenz_coin' and (b.balance_cents <> coalesce(l.s, 0) or b.pending_cents <> coalesce(l.pend, 0) or b.held_cents <> coalesce(l.held, 0) or b.balance_cents < b.pending_cents or b.held_cents < 0)`)).rows;
    const c = await one(db, `select
        (select coalesce(sum(delta_cents), 0) from ai_product_ledger where product = 'frenz_coin' and (kind in ('adjustment', 'deposit', 'refund') or (kind = 'reversal' and status <> 'reserved')))::bigint funded,
        (select coalesce(sum(balance_cents + held_cents), 0) from ai_product_balances where product = 'frenz_coin')::bigint wallets,
        (select coalesce(sum(amount), 0) from platform_fee_ledger where source like 'coin_%')::bigint fees,
        (select coalesce(sum(amount_cents), 0) from coin_deposits)::bigint deposited,
        (select coalesce(sum(amount_cents), 0) from ai_topup_attempts where purpose = 'coin_deposit' and status = 'success')::bigint attempts`);
    const n = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Number(v)]));
    ok(!bad.length && n.funded === n.wallets + n.fees && n.deposited === n.attempts,
      `invariants hold after: ${label}${bad.length ? ` — ${bad.length} wallet(s) off their ledger` : ""} (funded ${n.funded} = wallets ${n.wallets} + fees ${n.fees}; deposits ${n.deposited} = settled attempts ${n.attempts})`);
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

  // 1 · the webhook and the return page settle one deposit at the same moment
  {
    const u = U(1);
    const r = await opened(u, 5000);
    const x = await race("settle", settleSql, [r, 5000], settleSql, [r, 5000]);
    ok(MUTANT === "no-lock" || x.overlapped, "1 · the second settlement really waited on the first");
    ok(x.a?.ok === true && x.b?.ok === true && x.b?.duplicate === true, `1 · one credits, the other answers "already settled" (${JSON.stringify(x.b ?? x.bError)})`);
    const w = await coin(u);
    ok(w.b === 5000 && w.p === 5000, `1 · credited ONCE, pending (${JSON.stringify(w)})`);
    await invariants("1");
  }

  // 2 · ten deliveries at once (webhook retries + return page + sweep)
  {
    const u = U(2);
    const r = await opened(u, 7000);
    const many = await burst(10, settleSql, () => [r, 7000]);
    const credited = many.filter((m) => m.r?.ok && !m.r?.duplicate).length;
    ok(credited === 1 && (await coin(u)).b === 7000, `2 · 10 simultaneous settlements credit exactly once (${credited} credited, errors: ${many.filter((m) => m.e).length})`);
    await invariants("2");
  }

  // 3 · two releases of one due deposit
  {
    const u = U(3);
    const r = await opened(u, 4000);
    await db.query(settleSql, [r, 4000]);
    await age(r);
    const x = await race("release", releaseSql, [r], releaseSql, [r]);
    ok(x.overlapped, "3 · the second release really waited on the first");
    ok(x.a?.released === 4000 && x.b?.duplicate === true, `3 · released once (${JSON.stringify(x.b ?? x.bError)})`);
    const w = await coin(u);
    ok(w.b === 4000 && w.p === 0, "3 · available 4000, pending 0 — never negative");
    await invariants("3");
  }

  // 4 · a release racing a refund, both orders
  {
    const u = U(4);
    const r = await opened(u, 6000);
    await db.query(settleSql, [r, 6000]);
    await age(r);
    const x = await race("release-refund", releaseSql, [r], reverseSql, ["evt-4a", r]);
    ok(x.overlapped && x.a?.released === 6000 && x.b?.phase === "released" && x.b?.recovered === 6000, `4a · release first, then the refund takes the released coins back (${JSON.stringify(x.b ?? x.bError)})`);
    ok((await coin(u)).b === 0, "4a · nothing left, nothing negative");
    const u2 = U(5);
    const r2 = await opened(u2, 3000);
    await db.query(settleSql, [r2, 3000]);
    await age(r2);
    const y = await race("refund-release", reverseSql, ["evt-4b", r2], releaseSql, [r2]);
    ok(y.overlapped && y.a?.phase === "held" && y.a?.recovered === 3000 && y.b?.duplicate === true, `4b · refund first (still on hold), then the release finds it reversed (${JSON.stringify(y.b ?? y.bError)})`);
    const w = await coin(u2);
    ok(w.b === 0 && w.p === 0, "4b · nothing released, nothing negative");
    await invariants("4");
  }

  // 5 · two refund events for one deposit (admin + provider), and a burst of them
  {
    const u = U(6);
    const r = await opened(u, 8000);
    await db.query(settleSql, [r, 8000]);
    await age(r);
    await db.query(releaseSql, [r]);
    const x = await race("two-refunds", reverseSql, ["evt-5a", r], reverseSql, ["evt-5b", r]);
    ok(MUTANT === "no-lock" || x.overlapped, "5 · the second refund really waited on the first");
    const total = Number(x.a?.recovered ?? 0) + Number(x.b?.recovered ?? 0);
    ok(total === 8000 && Number(x.b?.due) === 0, `5 · the deposit is taken back once in total (${total})`);
    ok((await coin(u)).b === 0, "5 · the wallet ends at 0");
    const u2 = U(7);
    const r2 = await opened(u2, 9000);
    await db.query(settleSql, [r2, 9000]);
    await age(r2);
    await db.query(releaseSql, [r2]);
    const many = await burst(8, reverseSql, (i) => [`evt-5-burst-${i}`, r2]);
    const taken = many.reduce((s, m) => s + Number(m.r?.recovered ?? 0), 0);
    ok(taken === 9000 && (await coin(u2)).b === 0, `5 · 8 simultaneous refund events take back exactly 9000 (${taken})`);
    await invariants("5");
  }

  // 6 · pending coins under a burst of transfers: none can leave
  {
    const u = U(8), to = U(9);
    const w = (await one(db, "select ensure_wallet_number($1) w", [to])).w;
    const r = await opened(u, 20000);
    await db.query(settleSql, [r, 20000]);
    const many = await burst(10, "select transfer_coins($1, $2, $3, $4, null, $5::jsonb) r", (i) => [u, w, 1000, `t6-${i}`, TRANSFER]);
    ok(many.every((m) => m.r?.reason === "insufficient"), `6 · 10 simultaneous transfers of pending coins: all refused (${JSON.stringify(many.map((m) => m.r?.reason ?? m.e))})`);
    ok((await coin(u)).p === 20000 && (await coin(to)).b === 0, "6 · the hold is intact, nothing arrived");
    await invariants("6");
  }

  // 7 · two checkouts opened at the same moment
  {
    const u = U(10);
    const many = await burst(6, "select begin_coin_deposit($1, $2, 5000, 'flutterwave', 5000, 'USD', $3, $4::jsonb) r", (i) => [u, `frenz_coin_dep_fw_00000000-0000-4000-8000-00000000070${i}`, `k7-${i}-xxxx`, DEP]);
    const opens = many.filter((m) => m.r?.ok).length;
    ok(opens === 1 && many.every((m) => m.r?.ok || m.r?.reason === "open"), `7 · 6 simultaneous checkouts by one member: exactly one attempt, the rest are handed it (${opens})`);
    const same = await burst(4, "select begin_coin_deposit($1, $2, 5000, 'flutterwave', 5000, 'USD', 'k7-same-key', $3::jsonb) r", (i) => [U(11), `frenz_coin_dep_fw_00000000-0000-4000-8000-00000000071${i}`, DEP]);
    ok(same.filter((m) => m.r?.ok).length === 1 && same.every((m) => m.r?.ok || m.r?.reason === "existing"), "7 · 4 simultaneous replays of one key: one attempt");
    ok(Number((await one(db, "select count(*) n from ai_topup_attempts where purpose = 'coin_deposit' and user_id in ($1, $2)", [U(10), U(11)])).n) === 2, "7 · two attempts in total");
  }
  // 8 · a refund that leaves a shortfall, racing a transfer of what is left (Part 4.1)
  {
    const u = U(12), to = U(13);
    const w = (await one(db, "select ensure_wallet_number($1) w", [to])).w;
    const r = await opened(u, 20000);
    await db.query(settleSql, [r, 20000]);
    await age(r);
    await db.query(releaseSql, [r]);
    await db.query("select transfer_coins($1, $2, 15000, 't8-first', null, $3::jsonb)", [u, w, TRANSFER]);
    const x = await race("refund-vs-send", reverseSql, ["evt-8", r], "select transfer_coins($1, $2, 1000, 't8-race', null, $3::jsonb) r", [u, w, TRANSFER]);
    ok(x.overlapped, "8 · the transfer really waited on the refund");
    ok(x.a?.shortfall > 0 && x.b?.ok === false && ["recovery_due", "restricted", "insufficient"].includes(x.b?.reason), `8 · the refund takes what is left and records the shortfall; the transfer then finds nothing to send or a pause (${JSON.stringify(x.b ?? x.bError)})`);
    ok((await coin(u)).b === 0, "8 · never below zero");
    if (SCOPED) ok((await one(db, "select coin_wallet_block_reason($1) r", [u])).r === "recovery_due" && (await one(db, "select credit_wallet_block_reason($1) r", [u])).r === null && !(await one(db, "select restricted from reward_profiles where user_id = $1", [u]))?.restricted, "8 · 0281: coins paused by the shortfall, AI credits not, nothing on the account");
    await invariants("8");
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
