// Frenz Coin closeout — 0278–0283 on a REAL PostgreSQL server, set up the way Supabase is, and called the way PostgREST
// calls them. NOT a running Supabase or PostgREST (neither is available in this environment): an honest emulation of
// the two things that decide whether the migrations work there.
//
//   PGTEST_URL=postgres://postgres:...@127.0.0.1:55433/postgres node coin_supabase_integration.pg.mjs <repo>/supabase/migrations
//
// 1. Supabase's roles and DEFAULT PRIVILEGES: anon / authenticated / service_role exist (NOLOGIN), and every table,
//    sequence and function created in `public` is granted to all three by default — exactly what makes a forgotten
//    REVOKE dangerous there. The migrations run as the owner (as the Supabase migration runner does), twice.
// 2. PostgREST's RPC shape: `SET LOCAL ROLE <role>` and the arguments decoded from the request's JSON body with
//    json_to_record (the parameter types read from pg_proc), so a bytea travels as the "\\x…" text supabase-js sends,
//    and the result comes back as JSON.
//
// Then: every coin function and table is checked for what anon / authenticated / service_role may do; the PIN, a
// transfer, a withdrawal, a payout quote, a correction and the reset are driven through the emulated RPC as the service
// role, with keys derived by the SAME formula as lib/coin/pin.ts (pinned there against Node's scrypt); and ownership,
// SECURITY DEFINER and search_path are checked on every coin function.
import { createHmac, randomBytes, scryptSync } from "node:crypto";
import { readFileSync } from "node:fs";

import pg from "pg";

import { coinMigration, depositMigration, depositPrerequisites, migration, pinMigration, scopeMigration, split, STUB, U, walletStatements } from "./credit_wallet.shared.mjs";

const dir = process.argv[2];
const url = new URL(process.env.PGTEST_URL ?? "");
if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
  console.error("Refusing: PGTEST_URL must be a LOCAL server (127.0.0.1 / localhost).");
  process.exit(2);
}
const DB = `frenz_coin_supa_${process.pid}`;
const admin = new pg.Client({ connectionString: url.toString() });
await admin.connect();
await admin.query(`create database ${DB} encoding 'UTF8' template template0 lc_collate 'C' lc_ctype 'C'`);
const dbUrl = new URL(url.toString());
dbUrl.pathname = `/${DB}`;
const db = new pg.Client({ connectionString: dbUrl.toString(), application_name: "supa" });
await db.connect();

let failures = 0;
const ok = (c, m) => { if (!c) { failures++; console.log("FAIL:", m); } else console.log("ok:", m); };
const one = async (s, p) => (await db.query(s, p)).rows[0];

// the formula of lib/coin/pin.ts (derivePinKey / resetCodeHash), and the hex form supabase-js sends for a bytea
const PEPPER = "integration-pepper-0123456789abcdef0123456789";
const PARAMS = { algorithm: "scrypt", N: 32768, r: 8, p: 1, keylen: 32, pepper: "v1" };
const derive = (pin, saltHex, user) => scryptSync(createHmac("sha256", PEPPER).update(`frenz-coin-pin:${user}:${pin}`).digest(), Buffer.from(saltHex, "hex"), 32, { N: 32768, r: 8, p: 1, maxmem: 128 * 32768 * 8 * 2 });
const codeHash = (code, user) => createHmac("sha256", PEPPER).update(`frenz-coin-pin-reset:${user}:${code}`).digest();
const hex = (b) => `\\x${b.toString("hex")}`;

/** PostgREST's RPC: SET LOCAL ROLE, the JSON body decoded by json_to_record with the function's own parameter types. */
const sigCache = new Map();
async function rpc(role, fn, args) {
  if (!sigCache.has(fn)) {
    const r = await one(`select p.proargnames n, array(select format_type(t, null) from unnest(p.proargtypes) t) ty from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and p.proname = $1 limit 1`, [fn]);
    sigCache.set(fn, r);
  }
  const { n: names, ty: types } = sigCache.get(fn);
  const cols = names.map((name, i) => `"${name}" ${types[i]}`).join(", ");
  const call = names.map((name) => `"${name}" := pgrst_args."${name}"`).join(", ");
  await db.query("begin");
  try {
    await db.query(`set local role ${role}`);
    const res = await db.query(`select to_jsonb(public."${fn}"(${call})) as r from json_to_record($1::json) as pgrst_args(${cols})`, [JSON.stringify(args)]);
    await db.query("commit");
    return { data: res.rows[0]?.r ?? null, error: null };
  } catch (e) {
    await db.query("rollback");
    return { data: null, error: String(e.message ?? e) };
  }
}
const asService = (fn, args) => rpc("service_role", fn, args);

try {
  // ── Supabase's roles and default privileges ──
  await db.query(`do $r$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if; end $r$`);
  await db.query("grant usage on schema public to anon, authenticated, service_role");
  await db.query("alter default privileges in schema public grant all on tables to anon, authenticated, service_role");
  await db.query("alter default privileges in schema public grant all on sequences to anon, authenticated, service_role");
  await db.query("alter default privileges in schema public grant all on functions to anon, authenticated, service_role");
  const stub = STUB.replace("create role anon; create role authenticated; create role service_role;", "");
  const closeout = split(readFileSync(`${dir}/0283_frenz_coin_closeout.sql`, "utf8"));
  // Part 7: 0284 (the admin-set deposit hold) replaces settle_coin_deposit and coin_deposit_rules_ok - their grants must survive
  const hold284 = split(readFileSync(`${dir}/0284_frenz_coin_deposit_hold.sql`, "utf8"));
  for (const s of [...split(stub), ...walletStatements(dir), ...depositPrerequisites(dir)]) await db.query(s);
  // 0278 → 0284, in order, each twice (the documented re-run rule)
  for (const m of [migration(dir), coinMigration(dir), depositMigration(dir), scopeMigration(dir), pinMigration(dir), closeout, hold284]) {
    for (const s of m) await db.query(s);
    for (const s of m) await db.query(s);
  }
  ok(true, "0278 → 0284 ran in order on real PostgreSQL, each twice, with Supabase's default privileges in force");
  await db.query("grant usage on schema auth to service_role");
  await db.query(`insert into auth.users (id, email, email_confirmed_at) select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'u' || g || '@t.test', now() from generate_series(1, 20) g`);
  await db.query("insert into public.profiles (id) select id from auth.users");

  // ── ownership, SECURITY DEFINER, search_path ──
  const fns = (await db.query(`select p.proname, p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) owner from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and (p.proname like '%coin%' or p.proname in ('credit_wallet_block_reason', 'account_financial_blockers', 'reverse_wallet_topup', 'resolve_withdrawal', 'reverse_paid_withdrawal', 'post_transfer_fee'))`)).rows;
  const definers = fns.filter((f) => f.prosecdef);
  ok(definers.length >= 30 && definers.every((f) => (f.proconfig ?? []).some((c) => c === "search_path=public")), `every SECURITY DEFINER coin function pins search_path = public (${definers.length})`);
  ok(fns.every((f) => f.owner === "postgres"), "every coin function is owned by the migration owner (postgres)");

  // ── what each API role may execute ──
  const may = async (role, oid) => (await one("select has_function_privilege($1, $2::oid, 'execute') x", [role, oid])).x;
  const allFns = (await db.query(`select p.oid, p.proname from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public' and (p.proname like '%coin%' or p.proname like '%pin%' and p.proname not like '%spin%')`)).rows;
  const clientCallable = [];
  for (const f of allFns) if ((await may("anon", f.oid)) || (await may("authenticated", f.oid))) clientCallable.push(f.proname);
  // the immutable fee / rules helpers carry no data and are harmless; nothing else may be reachable from the browser
  const harmless = new Set(["coin_rules_ok", "coin_transfer_fee", "coin_withdrawal_fee", "coin_deposit_rules_ok", "coin_pin_setting"]);
  ok(clientCallable.every((n) => harmless.has(n)), `nothing that touches coins or PINs is executable by anon / authenticated, despite the default grants (${clientCallable.join(", ") || "none"})`);
  for (const [fn, sig] of [["transfer_coins", "uuid, text, bigint, text, text, jsonb"], ["request_coin_withdrawal", "uuid, bigint, text, jsonb, text, jsonb"], ["coin_pin_check", "uuid, uuid, bytea, text, jsonb"], ["coin_pin_lock", "uuid, jsonb, text"], ["coin_take_back_held_deposit", "text, text, text"], ["coin_pin_bytes_equal", "bytea, bytea"], ["lift_coin_shortfall_restriction", "uuid"], ["lift_topup_shortfall_restriction", "uuid"], ["coin_wallet_guard", ""], ["coin_deposit_guard", ""], ["coin_deposit_reversal_guard", ""], ["post_transfer_fee", ""]]) {
    ok(!(await one(`select has_function_privilege('service_role', 'public.${fn}(${sig})', 'execute') x`)).x, `${fn}: not executable even by the service role`);
  }
  // ── tables ──
  for (const t of ["coin_pins", "coin_pin_attempts", "coin_pin_resets"]) {
    const r = await one(`select has_table_privilege('service_role', 'public.${t}', 'select') s, has_table_privilege('authenticated', 'public.${t}', 'select') a, has_table_privilege('anon', 'public.${t}', 'select') n`);
    ok(!r.s && !r.a && !r.n, `${t}: unreadable by every API role, the default grants notwithstanding`);
  }
  for (const t of ["coin_transfers", "coin_deposits", "coin_deposit_reversals", "coin_transfer_corrections", "coin_notification_claims", "wallet_topup_reversals", "platform_fee_ledger"]) {
    const r = await one(`select has_table_privilege('authenticated', 'public.${t}', 'select') a, has_table_privilege('anon', 'public.${t}', 'insert') n, (select relrowsecurity from pg_class where oid = 'public.${t}'::regclass) rls`);
    ok(!r.a && !r.n && r.rls, `${t}: no client access, RLS on`);
  }

  // ── the emulated PostgREST: the browser roles are refused, the service role is let through only where intended ──
  const A = U(1), B = U(2);
  let r = await rpc("authenticated", "transfer_coins_with_pin", { p_sender: A, p_attempt: U(19), p_derived: "\\x00", p_account_number: "1", p_amount: 1, p_idempotency: "k", p_note: null, p_rules: {}, p_policy: {} });
  ok(r.error && /permission denied/i.test(r.error), "as authenticated: transfer_coins_with_pin → permission denied");
  r = await rpc("anon", "set_coin_pin", { p_user: A, p_hash: "\\x00", p_salt: "\\x00", p_params: {} });
  ok(r.error && /permission denied/i.test(r.error), "as anon: set_coin_pin → permission denied");
  r = await rpc("service_role", "transfer_coins", { p_sender: A, p_account_number: "1", p_amount: 1, p_idempotency: "k", p_note: null, p_rules: {} });
  ok(r.error && /permission denied/i.test(r.error), "as the service role: transfer_coins → permission denied (no way around the PIN)");
  r = await rpc("service_role", "request_coin_withdrawal", { p_user: A, p_gross: 1000, p_method: "paystack", p_details: {}, p_idempotency: "k", p_rules: {} });
  ok(r.error && /permission denied/i.test(r.error), "as the service role: request_coin_withdrawal → permission denied");
  const read = await db.query("begin").then(() => db.query("set local role service_role")).then(() => db.query("select * from coin_pins").then(() => null, (e) => e.message)).finally(() => db.query("rollback"));
  ok(/permission denied/i.test(read ?? ""), "as the service role: select from coin_pins → permission denied (the hash is unreadable through the API)");

  // ── the PIN and a transfer, through the emulated RPC, as the service role ──
  const POLICY = { maxAttempts: 5, lockMinutes: 15, resetTtlMinutes: 10, resetMaxPerHour: 3, resetCodeMaxAttempts: 5 };
  const TRANSFER = { enabled: true, version: 1, percentBp: 1000, lowThresholdCents: 10000, highThresholdCents: 50000, flatBelowCents: 100, flatMidCents: 0, flatAboveCents: 500, minCents: 1, maxCents: 500000, dailyMaxCents: 10000000 };
  const WITHDRAW = { enabled: true, version: 1, percentBp: 600, flatCents: 0, minCents: 500, maxCents: 500000, maxPerDay: 5, maxMonthCents: 100000000, requireQualification: false, requireEmailConfirmed: true, payoutCurrency: "NGN", payoutMinorPerUsd: null };
  const saltA = randomBytes(16).toString("hex");
  r = await asService("set_coin_pin", { p_user: A, p_hash: hex(derive("482915", saltA, A)), p_salt: `\\x${saltA}`, p_params: PARAMS });
  ok(r.data?.ok === true, "set_coin_pin through the JSON body: the \\x… hex strings arrive as bytea");
  const stored = await one("select encode(pin_hash, 'hex') h, encode(pin_salt, 'hex') s from coin_pins where user_id = $1", [A]);
  ok(stored.s === saltA && stored.h === derive("482915", saltA, A).toString("hex"), "the stored salt and hash are exactly the bytes the server derived");
  await db.query("select adjust_coin_balance($1, 100000, 'fund-a', 'test', $2, false)", [A, U(20)]);
  const wB = (await one("select ensure_wallet_number($1) w", [B])).w;
  let a = await asService("begin_coin_pin_attempt", { p_user: A, p_purpose: "transfer", p_policy: POLICY });
  ok(a.data?.ok === true && a.data.salt === saltA && !JSON.stringify(a.data).includes(stored.h), "begin_coin_pin_attempt returns the salt as hex JSON — never the hash");
  r = await asService("transfer_coins_with_pin", { p_sender: A, p_attempt: a.data.attempt_id, p_derived: hex(derive("000111", a.data.salt, A)), p_account_number: wB, p_amount: 5000, p_idempotency: "it-1", p_note: null, p_rules: TRANSFER, p_policy: POLICY });
  ok(r.data?.reason === "authorization_failed" && Number((await one("select count(*) n from coin_transfers")).n) === 0, "a wrong PIN through the RPC: refused, nothing moved");
  a = await asService("begin_coin_pin_attempt", { p_user: A, p_purpose: "transfer", p_policy: POLICY });
  r = await asService("transfer_coins_with_pin", { p_sender: A, p_attempt: a.data.attempt_id, p_derived: hex(derive("482915", a.data.salt, A)), p_account_number: wB, p_amount: 5000, p_idempotency: "it-1", p_note: null, p_rules: TRANSFER, p_policy: POLICY });
  ok(r.data?.ok === true && r.data.fee === 600 && r.data.total === 5600, "the right PIN through the RPC: $50 sent, $6 fee (server-priced)");
  r = await asService("transfer_coins_with_pin", { p_sender: A, p_attempt: a.data.attempt_id, p_derived: hex(derive("482915", a.data.salt, A)), p_account_number: wB, p_amount: 5000, p_idempotency: "it-2", p_note: null, p_rules: TRANSFER, p_policy: POLICY });
  ok(r.data?.reason === "authorization_failed" && Number((await one("select count(*) n from coin_transfers")).n) === 1, "the same attempt replayed through the RPC: refused");

  // ── a withdrawal, its quote, a correction, through the RPC ──
  a = await asService("begin_coin_pin_attempt", { p_user: A, p_purpose: "withdrawal", p_policy: POLICY });
  r = await asService("request_coin_withdrawal_with_pin", { p_user: A, p_attempt: a.data.attempt_id, p_derived: hex(derive("482915", a.data.salt, A)), p_gross: 10000, p_method: "paystack", p_details: { bankCode: "058", bankName: "GTBank", accountNumber: "0123456789", accountName: "ADA OBI" }, p_idempotency: "it-w1", p_rules: WITHDRAW, p_policy: POLICY });
  ok(r.data?.ok === true && r.data.fee === 600 && r.data.net === 9400, "a $100 withdrawal through the RPC: $6 fee, $94 net, held");
  const wid = r.data.id;
  r = await asService("record_coin_payout_quote", { p_id: wid, p_minor: 14100000, p_currency: "NGN", p_fx: { source: "market", perUsd: 1500 } });
  ok(r.data?.ok === true && Number((await one("select payout_minor from withdrawal_requests where id = $1", [wid])).payout_minor) === 14100000, "the payout quote is recorded through the RPC");
  const tid = (await one("select id from coin_transfers limit 1")).id;
  r = await asService("correct_coin_transfer", { p_transfer: tid, p_kind: "fee_refund", p_amount: null, p_reason: "integration check", p_admin: U(20), p_idempotency: "it-corr-01" });
  ok(r.data?.ok === true && r.data.amount === 600, "a fee refund through the RPC");

  // ── the reset, through the RPC ──
  const code = "73914028";
  r = await asService("request_coin_pin_reset", { p_user: A, p_code_hash: hex(codeHash(code, A)), p_policy: POLICY });
  ok(r.data?.issued === true, "a reset code is issued through the RPC (its HMAC as \\x… hex)");
  const newSalt = randomBytes(16).toString("hex");
  r = await asService("complete_coin_pin_reset", { p_user: A, p_code_hash: hex(codeHash("73914029", A)), p_hash: hex(derive("193746", newSalt, A)), p_salt: `\\x${newSalt}`, p_params: PARAMS, p_policy: POLICY });
  ok(r.data?.reason === "invalid", "a wrong code through the RPC: refused");
  r = await asService("complete_coin_pin_reset", { p_user: A, p_code_hash: hex(codeHash(code, A)), p_hash: hex(derive("193746", newSalt, A)), p_salt: `\\x${newSalt}`, p_params: PARAMS, p_policy: POLICY });
  ok(r.data?.ok === true, "the right code through the RPC: the PIN is reset");
  a = await asService("begin_coin_pin_attempt", { p_user: A, p_purpose: "transfer", p_policy: POLICY });
  r = await asService("transfer_coins_with_pin", { p_sender: A, p_attempt: a.data.attempt_id, p_derived: hex(derive("193746", a.data.salt, A)), p_account_number: wB, p_amount: 1000, p_idempotency: "it-3", p_note: null, p_rules: TRANSFER, p_policy: POLICY });
  ok(r.data?.ok === true, "the new PIN works through the RPC");

  // ── nothing secret in the audit trail ──
  const trail = (await db.query("select details::text d from financial_audit_log")).rows.map((x) => x.d).join("\n");
  ok(![stored.h, codeHash(code, A).toString("hex"), "482915", "193746", code, PEPPER].some((s) => trail.includes(s)), "no PIN, hash, code or pepper anywhere in the audit trail");
} catch (e) {
  failures++;
  console.log("FAIL: harness error", e.message);
} finally {
  await db.end();
  await admin.query(`drop database if exists ${DB} with (force)`);
  await admin.end();
}
console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
