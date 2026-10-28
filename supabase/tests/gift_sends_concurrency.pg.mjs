// 0293 (Frenz Gift Coin Part 4) — REAL concurrency for sticker gifts and earnings release, on a real PostgreSQL server
// with SEPARATE connections.
//
//   PGTEST_URL=postgres://postgres:...@127.0.0.1:55433/postgres node gift_sends_concurrency.pg.mjs <repo>/supabase/migrations [--mutant=no-lock]
//
// Local servers only (refuses any other host), its own throwaway database, dropped at the end. Never point it at Supabase.
// Needs `pg` and credit_wallet.shared.mjs beside it. Applies the wallet, 0278–0284, 0290–0293 and the chat columns a gift
// reads. The gift itself is called as send_gift (the PIN wrapper is pinned in 0293_gift_sends.pglite.mjs: one PIN attempt
// per call would hit the attempt limit in a burst, which is the PIN working, not the wallet). Overlap is FORCED: A opens a
// transaction and gifts (taking both wallet locks); B's competing call must BLOCK (confirmed in pg_stat_activity); then A
// commits. Bursts run too, including gifts in opposite directions and simultaneous releases.
//
// --mutant=no-lock removes send_gift's wallet locks (and the last walls behind them: the non-negative / state constraints
// and the per-sender key index); overspending and doubled replays must then FAIL.
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
const DB = `frenz_gifts_${process.pid}`;
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
const J = JSON.stringify;
const RULES = { version: 1, recipientShareBp: 9000, commissionBp: 1000, holdHours: 72, senderCooldownHours: 0, dailyMaxFgc: 100_000_000 };
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
    `create table public.conversations (id uuid primary key default gen_random_uuid(), type text not null default 'direct', user_low uuid, user_high uuid, only_admins_can_send boolean not null default false)`,
    `create table public.conversation_members (conversation_id uuid not null references public.conversations (id), user_id uuid not null references auth.users (id), role text not null default 'member', left_at timestamptz, primary key (conversation_id, user_id))`,
    "create table public.blocks (blocker_id uuid not null, blocked_id uuid not null, primary key (blocker_id, blocked_id))",
    `create table public.messages (id uuid primary key default gen_random_uuid(), conversation_id uuid not null, sender_id uuid not null, body text not null, client_id text, metadata jsonb)`,
    ...walletStatements(dir),
    ...depositPrerequisites(dir),
  ]) await db.query(s);
  for (const m of [migration, coinMigration, depositMigration, scopeMigration, pinMigration, closeoutMigration, file("0284_frenz_coin_deposit_hold.sql"), giftMigration, file("0291_frenz_gift_settings_stickers.sql"), file("0292_protect_financial_settings.sql"), file("0293_frenz_gift_sends.sql")]) {
    for (const s of m(dir)) await db.query(s);
    for (const s of m(dir)) await db.query(s);
  }
  await db.query(`insert into auth.users (id, email_confirmed_at) select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, now() from generate_series(1, 80) g`);
  await db.query("insert into public.profiles (id) select id from auth.users");

  if (MUTANT === "no-lock") {
    const f = (await db.query("select pg_get_functiondef(p.oid) d from pg_proc p where proname = 'send_gift'")).rows[0].d;
    const fm = f.replace("perform 1 from public.ai_product_balances where product = 'frenz_gift' and user_id in (p_sender, v_to) order by user_id for update;", "")
      .replace("select * into v_ex from public.gift_sends where sender_id = p_sender and idempotency_key = p_idempotency;\n  if v_ex.id is not null then\n    if v_ex.conversation_id <> p_conversation or v_ex.sticker_id <> p_sticker or v_ex.recipient_id <> v_to", "if false then\n    if v_ex.conversation_id <> p_conversation or v_ex.sticker_id <> p_sticker or v_ex.recipient_id <> v_to");
    if (fm === f) throw new Error("mutant no-lock did not apply");
    await db.query(fm);
    await db.query("alter table public.ai_product_balances drop constraint if exists ai_product_balances_non_negative");
    await db.query("alter table public.ai_product_balances drop constraint if exists ai_product_balances_coin_state_chk");
    await db.query("drop index if exists public.gift_sends_idem_uidx");
  }

  const one = async (c, s, p) => (await c.query(s, p)).rows[0];
  const call = async (c, s, p) => (await one(c, s, p)).r;
  const fund = (u, n, ref) => db.query("select adjust_gift_balance($1, $2, $3, 'test', $4)", [u, n, ref, ADMIN]);
  const wallet = async (u) => { const r = await one(db, "select balance_cents::int b, pending_cents::int p from ai_product_balances where user_id = $1 and product = 'frenz_gift'", [u]); return r ?? { b: 0, p: 0 }; };
  const sticker = async (slug, price) => (await call(db, "select admin_save_gift_sticker($1, null, null, $2::jsonb) r", [ADMIN, J({ slug, name: slug, priceFgc: price, imageUrl: "https://cdn.example.test/s.webp", published: true })])).sticker;
  const direct = async (x, y) => { const [lo, hi] = [x, y].sort(); const c = (await one(db, "insert into conversations (type, user_low, user_high) values ('direct', $1, $2) returning id", [lo, hi])).id; await db.query("insert into conversation_members (conversation_id, user_id) values ($1, $2), ($1, $3)", [c, x, y]); return c; };
  const giftSql = "select send_gift($1, $2, null, $3, $4, $5, $6, $7::jsonb) r";
  const gift = (u, conv, st, k) => [u, conv, st.id, st.revision, st.price_fgc, k, J(RULES)];
  const age = async (ids, hours) => {
    await db.query("alter table public.gift_sends disable trigger gift_sends_guard");
    await db.query("update gift_sends set created_at = created_at - make_interval(hours => $2::int), hold_until = hold_until - make_interval(hours => $2::int) where id = any($1::uuid[])", [ids, hours]);
    await db.query("alter table public.gift_sends enable trigger gift_sends_guard");
  };
  const invariants = async (label) => {
    const bad = (await db.query(`select b.user_id from ai_product_balances b
      left join (select user_id, sum(delta_cents) s, coalesce(sum(delta_cents) filter (where status = 'reserved' and delta_cents > 0), 0) pend from ai_product_ledger where product = 'frenz_gift' group by user_id) l on l.user_id = b.user_id
      where b.product = 'frenz_gift' and (b.balance_cents <> coalesce(l.s, 0) or b.pending_cents <> coalesce(l.pend, 0) or b.balance_cents < b.pending_cents or b.balance_cents < 0)`)).rows;
    const c = await one(db, `select
        (select count(*) from gift_sends)::int gifts,
        (select count(*) from ai_product_ledger where kind = 'gift_sent')::int sent,
        (select count(*) from ai_product_ledger where kind = 'gift_earning')::int earned,
        (select coalesce(sum(commission), 0) from gift_sends)::bigint commission,
        (select coalesce(sum(amount), 0) from platform_fee_ledger where source = 'gift_commission')::bigint posted,
        (select count(*) from (select sender_id, idempotency_key from gift_sends group by 1, 2 having count(*) > 1) d)::int dupes,
        (select count(*) from gift_sends g join ai_product_ledger e on e.id = g.earning_ledger_id where e.status <> case g.status when 'pending' then 'reserved' when 'released' then 'settled' else 'reversed' end)::int drift`);
    const n = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Number(v)]));
    ok(!bad.length && n.gifts === n.sent && n.gifts === n.earned && n.commission === n.posted && n.dupes === 0 && n.drift === 0,
      `invariants hold after: ${label}${bad.length ? ` — ${bad.length} wallet(s) off their ledger or negative` : ""} (${n.gifts} gifts = ${n.sent} debits = ${n.earned} earnings, commission ${n.commission}/${n.posted}, duplicate keys ${n.dupes}, status drift ${n.drift})`);
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

  const ROSE = await sticker("rose", 6000);
  const DOT = await sticker("dot", 1000);

  // 1 · two gifts against one balance
  {
    const A = U(1), B = U(2), C = U(3);
    await fund(A, 10_000, "a1");
    const [ab, ac] = [await direct(A, B), await direct(A, C)];
    const x = await race("spend", giftSql, gift(A, ab, ROSE, "k-spend-0001"), giftSql, gift(A, ac, ROSE, "k-spend-0002"));
    ok(x.overlapped, "1 · the second gift really waited on the first");
    ok(x.a?.ok === true && x.b?.ok === false && x.b?.reason === "insufficient", `1 · 60.00 twice from 100.00: one gift, the other refused (${J(x.b ?? x.bError)})`);
    ok((await wallet(A)).b === 4000, "1 · exactly 40.00 left");
    await invariants("1");
  }

  // 2 · the same key twice at once (a double tap)
  {
    const A = U(4), B = U(5);
    await fund(A, 10_000, "a2");
    const ab = await direct(A, B);
    const x = await race("replay", giftSql, gift(A, ab, DOT, "k-replay-001"), giftSql, gift(A, ab, DOT, "k-replay-001"));
    ok(x.overlapped && x.a?.ok === true && x.b?.ok === true && x.b.duplicate === true && x.b.gift_id === x.a.gift_id, `2 · the double tap answers the first gift (${J(x.b ?? x.bError)})`);
    ok((await wallet(A)).b === 9000 && (await wallet(B)).p === 900, "2 · charged once, earned once");
    await invariants("2");
  }

  // 3 · A gifts B while B gifts A (opposite lock order would deadlock without the fixed order)
  {
    const A = U(6), B = U(7);
    await fund(A, 10_000, "a3");
    await fund(B, 10_000, "b3");
    const ab = await direct(A, B);
    const x = await race("opposite", giftSql, gift(A, ab, DOT, "k-opp-a-0001"), giftSql, gift(B, ab, DOT, "k-opp-b-0001"));
    ok(x.overlapped && x.a?.ok === true && x.b?.ok === true && !x.bError, `3 · opposite gifts both complete, no deadlock (${x.bError ?? "ok"})`);
    const out = await burst(16, (i) => [giftSql, gift(i % 2 ? A : B, ab, DOT, `k-opp-burst-${String(i).padStart(3, "0")}`)]);
    ok(out.every((o) => !o.e) && out.every((o) => o.r?.ok), `3 · 16 simultaneous gifts both ways: no deadlock, all complete (${out.find((o) => o.e)?.e ?? "ok"})`);
    await invariants("3");
  }

  // 4 · 20 gifts of 10.00 from 100.00 at once
  {
    const A = U(8), B = U(9);
    await fund(A, 10_000, "a4");
    const ab = await direct(A, B);
    const out = await burst(20, (i) => [giftSql, gift(A, ab, DOT, `k-burst-${String(i).padStart(4, "0")}`)]);
    const won = out.filter((o) => o.r?.ok).length;
    ok(won === 10 && out.every((o) => !o.e), `4 · 20 × 10.00 from 100.00: exactly 10 gifts, nothing overdrawn (${won}${out.find((o) => o.e) ? `, error: ${out.find((o) => o.e).e}` : ""})`);
    ok((await wallet(A)).b === 0, "4 · the sender is at exactly 0");
    await invariants("4");
  }

  // 5 · simultaneous releases (reads, explicit releases, a spend) release each gift once
  {
    const B = U(9);
    const ids = (await db.query("select id from gift_sends where recipient_id = $1", [B])).rows.map((r) => r.id);
    await age(ids, 73);
    const pend = (await wallet(B)).p;
    const out = await burst(12, (i) => (i % 3 === 0 ? ["select gift_wallet_summary($1) r", [B]] : ["select release_gift_earnings($1) r", [B]]));
    const amounts = out.map((o) => Number(o.r?.amount ?? o.r?.released_now ?? 0));
    ok(out.every((o) => !o.e) && amounts.reduce((a, b) => a + b, 0) === pend && (await wallet(B)).p === 0, `5 · 12 simultaneous releases: the ${pend} pending units released exactly once in total (${amounts.join(",")})`);
    ok(Number((await one(db, "select count(*) n from gift_sends where recipient_id = $1 and status = 'released'", [B])).n) === ids.length, "5 · every gift released, once");
    await invariants("5");
  }

  // 6 · a release and an administrator's reversal racing for one due gift: exactly one outcome
  {
    const A = U(10), B = U(11);
    await fund(A, 10_000, "a6");
    const ab = await direct(A, B);
    const g = await call(db, giftSql, gift(A, ab, DOT, "k-rr-000001"));
    await age([g.gift_id], 73);
    const x = await race("release-vs-reverse", "select release_gift_earnings($1) r", [B], "select reverse_gift($1, $2, 'test') r", [g.gift_id, ADMIN]);
    const st = (await one(db, "select status from gift_sends where id = $1", [g.gift_id])).status;
    ok(x.overlapped && st === "released" && x.b?.ok === false && x.b.reason === "already_released", `6 · the release won the lock: released, and the reversal is refused (${st}, ${J(x.b ?? x.bError)})`);
    const g2 = await call(db, giftSql, gift(A, ab, DOT, "k-rr-000002"));
    await age([g2.gift_id], 73);
    const y = await race("reverse-vs-release", "select reverse_gift($1, $2, 'test') r", [g2.gift_id, ADMIN], "select release_gift_earnings($1) r", [B]);
    const st2 = (await one(db, "select status from gift_sends where id = $1", [g2.gift_id])).status;
    ok(y.overlapped && st2 === "reversed" && Number(y.b?.released ?? -1) === 0, `6 · the reversal won the lock: reversed, and the release skips it (${st2}, ${J(y.b ?? y.bError)})`);
    await invariants("6");
  }
} finally {
  await db.end();
  await admin.query(`drop database if exists ${DB} with (force)`);
  await admin.end();
}
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
