// 0301 — the admin dashboard lock and guarded manual Frenz Coin funding, against the REAL functions in PGlite.
//   node 0301_admin_lock.pglite.mjs <repo>/supabase/migrations [--mutant=<name>]
//
// Builds the wallet (credit_wallet.shared.mjs), applies 0278, 0279 and 0301 twice each, then drives: who may touch the
// lock tables and the funding door, first setup through the emailed link (once, single use), the password step, the PIN
// step bound to the session the password opened, single-use attempts, locking (and that a lock ends every session),
// the PIN reset by passwords (current twice when there is no previous, current + previous after a change) and its
// emailed link (single use, superseded, bound to the admin), and manual funding: refused while locked or with a wrong
// PIN, credited once per reference, capped, never to oneself, and append-only.
//
// Keys are 32 random bytes standing in for scrypt(HMAC(pepper, secret), salt): the database only compares bytes.
//
// --mutant=<name> breaks one protection and the run must FAIL:
//   no-count          admin_lock_begin stops counting attempts                  -> unlimited guesses
//   reusable-attempt  admin_lock_check accepts a consumed attempt again          -> one entry authorizes twice
//   bypass            adjust_coin_balance is granted back to the service role    -> funding without session or PIN
//   no-session        admin_fund_coin_wallet skips the unlocked-session check    -> a PIN alone funds a wallet
//   link-reuse        admin_lock_spend_link accepts a consumed link              -> one emailed link works twice
//   no-previous       the PIN reset accepts the current password twice even after a change
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";

import { coinMigration, migration, split, STUB, U, walletStatements } from "./credit_wallet.shared.mjs";

const dir = process.argv[2];
const MUTANT = (process.argv.find((a) => a.startsWith("--mutant=")) ?? "").split("=")[1] ?? "";
const db = new PGlite();
const run = async (stmts) => { for (const s of stmts) { try { await db.exec(s); } catch (e) { console.log("SQL ERROR:", e.message, "\n", s.slice(0, 300)); process.exit(2); } } };
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; console.log("FAIL:", m); } else console.log("ok:", m); };
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const one = async (sql, params = []) => (await q(sql, params))[0];
const rpc = async (sql, params = []) => Object.values((await one(sql, params)) ?? {})[0];
const throws = async (sql, params = []) => { try { await db.query(sql, params); return null; } catch (e) { return e.message; } };
const lockMigration = () => split(readFileSync(`${dir}/0301_admin_dashboard_lock.sql`, "utf8"));

await run(split(STUB));
await run(walletStatements(dir));
for (const m of [migration, coinMigration, lockMigration]) { await run(m(dir)); await run(m(dir)); }
await db.exec(`insert into auth.users (id, email, email_confirmed_at) select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'u' || g || '@t.test', now() from generate_series(1, 20) g`);
await db.exec(`insert into public.profiles (id) select id from auth.users`);

// ── mutants ──
const fnBody = async (name) => (await one("select pg_get_functiondef(p.oid) d from pg_proc p where p.proname = $1", [name])).d;
const mutate = async (name, from, to) => { const b = await fnBody(name); const m = b.split(from).join(to); if (m === b) throw new Error(`mutant on ${name} did not apply`); await db.exec(m); };
if (MUTANT === "no-count") await mutate("admin_lock_begin", "update public.admin_lock_credentials set failed_attempts = failed_attempts + 1, updated_at = now() where user_id = p_user;", "");
if (MUTANT === "reusable-attempt") await mutate("admin_lock_check", "and purpose = p_purpose and consumed_at is null and expires_at > now()", "and purpose = p_purpose and expires_at > now()");
if (MUTANT === "bypass") await db.exec("grant execute on function public.adjust_coin_balance(uuid, bigint, text, text, uuid, boolean) to service_role");
if (MUTANT === "no-session") await mutate("admin_fund_coin_wallet", "if coalesce(public.admin_lock_session_stage(p_admin, p_session, p_token_hash), '') <> 'unlocked' then", "if false then");
if (MUTANT === "link-reuse") await mutate("admin_lock_spend_link", "and token_hash = p_token_hash and consumed_at is null and superseded_at is null", "and token_hash = p_token_hash and superseded_at is null");
if (MUTANT === "no-previous") await mutate("admin_lock_check", "p_key2 = coalesce(v.prev_password_hash, v.password_hash)", "p_key2 in (v.password_hash, coalesce(v.prev_password_hash, v.password_hash))");

const PARAMS = JSON.stringify({ algorithm: "scrypt", N: 32768, r: 8, p: 1, keylen: 32, pepper: "v1" });
const A = U(1); // the admin
const B = U(2); // another admin
const M = U(3); // a member
const hx = () => randomBytes(32).toString("hex");
const salt = () => randomBytes(16).toString("hex");
const keys = { pw: hx(), pin: hx() };

const issue = (u, purpose, t) => rpc("select admin_lock_issue_link($1, $2, decode($3, 'hex'))", [u, purpose, t]);
const setup = (u, link, pw, pin) => rpc("select admin_lock_setup($1, decode($2, 'hex'), decode($3, 'hex'), decode($4, 'hex'), decode($5, 'hex'), decode($6, 'hex'), $7::jsonb)", [u, link, pw, salt(), pin, salt(), PARAMS]);
const begin = (u, purpose) => rpc("select admin_lock_begin($1, $2)", [u, purpose]);
const pwCheck = (u, att, k, tok) => rpc("select admin_lock_check_password($1, $2, decode($3, 'hex'), decode($4, 'hex'))", [u, att, k, tok]);
const pinCheck = (u, att, k, s, tok) => rpc("select admin_lock_check_pin($1, $2, decode($3, 'hex'), $4, decode($5, 'hex'))", [u, att, k, s, tok]);
const stage = (u, s, tok) => rpc("select admin_lock_session_stage($1, $2, decode($3, 'hex'))", [u, s, tok]);
const creds = (u) => one("select failed_attempts, lock_count, locked_until from admin_lock_credentials where user_id = $1", [u]);
const unlockRow = (u) => db.query("update admin_lock_credentials set locked_until = null, failed_attempts = 0 where user_id = $1", [u]);
/** password then PIN: an unlocked session. */
const openSession = async (u, pw = keys.pw, pin = keys.pin) => {
  const tok = hx();
  const a = await begin(u, "password");
  const r = await pwCheck(u, a.attempt_id, pw, tok);
  if (!r?.ok) return { ok: false, r };
  const b = await begin(u, "pin");
  const p = await pinCheck(u, b.attempt_id, pin, r.session_id, tok);
  return { ok: !!p?.ok, session: r.session_id, tok };
};
const fund = async (s, pin, account, cents, reason, ref, admin = A) => {
  const a = await begin(admin, "fund");
  if (!a?.ok) return { ok: false, reason: `begin:${a?.reason}` };
  return rpc("select admin_fund_coin_wallet($1, $2, decode($3, 'hex'), $4, decode($5, 'hex'), $6, $7, $8, $9)", [admin, s.session, s.tok, a.attempt_id, pin, account, cents, reason, ref]);
};
const coin = async (u) => (await one("select balance_cents::int b from ai_product_balances where user_id = $1 and product = 'frenz_coin'", [u]))?.b ?? 0;
const ref = () => `ref_${randomBytes(12).toString("hex")}`;

// ── 1. access ──
for (const role of ["anon", "authenticated", "service_role"]) {
  for (const t of ["admin_lock_credentials", "admin_lock_attempts", "admin_lock_sessions", "admin_lock_links"]) {
    ok(!(await one(`select has_table_privilege('${role}', 'public.${t}', 'select') v`)).v, `${role} cannot read ${t}`);
  }
  ok(!(await one(`select has_table_privilege('${role}', 'public.admin_coin_fundings', 'insert') v`)).v, `${role} cannot write admin_coin_fundings`);
}
ok(!(await one("select has_function_privilege('service_role', 'public.adjust_coin_balance(uuid, bigint, text, text, uuid, boolean)', 'execute') v")).v, "the service role can no longer credit a coin wallet directly");
ok(!(await one("select has_function_privilege('authenticated', 'public.admin_fund_coin_wallet(uuid, uuid, bytea, uuid, bytea, text, bigint, text, text)', 'execute') v")).v, "a member cannot call the funding door");
ok(!(await one("select has_function_privilege('service_role', 'public.admin_lock_check(uuid, uuid, text, text, bytea, bytea)', 'execute') v")).v, "the internal check is not callable from outside");

// ── 2. first setup, through the emailed link only ──
ok((await rpc("select admin_lock_status($1)", [A])).set === false, "nothing is set at first");
const L1 = hx();
ok((await issue(A, "setup", L1)).issued === true, "a setup link is issued while nothing is set");
ok((await setup(A, hx(), keys.pw, keys.pin)).ok === false, "setup refuses a wrong link");
ok((await setup(A, L1, keys.pw, keys.pin)).ok === true, "setup with the live link sets the password and PIN");
ok((await setup(A, L1, hx(), hx())).ok === false, "the setup link (and setup) works once");
ok((await issue(A, "setup", hx())).issued === false, "no setup link once the lock is set");
ok((await rpc("select admin_lock_status($1)", [A])).set === true, "status says set");

// ── 3. the password step, then the PIN step ──
let tok = hx();
let a = await begin(A, "password");
ok(a.ok && !("password_hash" in a) && !("pin_hash" in a), "begin returns salts and an attempt, never a hash");
ok((await pwCheck(A, a.attempt_id, hx(), tok)).ok === false, "a wrong password is refused");
a = await begin(A, "password");
let r = await pwCheck(A, a.attempt_id, keys.pw, tok);
ok(r.ok === true && !!r.session_id, "the right password opens a session");
ok((await pwCheck(A, a.attempt_id, keys.pw, hx())).ok === false, "an attempt is single use");
ok((await stage(A, r.session_id, tok)) === "password", "the session waits for the PIN");
ok((await stage(A, r.session_id, hx())) === null, "another browser's token does not match the session");
let b = await begin(A, "pin");
ok((await pinCheck(A, b.attempt_id, keys.pin, r.session_id, hx())).ok === false, "the PIN only completes the session from the browser that passed the password");
b = await begin(A, "pin");
ok((await pinCheck(A, b.attempt_id, keys.pin, r.session_id, tok)).ok === true, "the right PIN unlocks it");
ok((await stage(A, r.session_id, tok)) === "unlocked", "the session is unlocked");
ok((await stage(B, r.session_id, tok)) === null, "another admin cannot use this session");
b = await begin(A, "pin");
ok((await pinCheck(A, b.attempt_id, keys.pin, r.session_id, tok)).ok === false, "an unlocked session is not unlocked twice");
await rpc("select admin_lock_end_session($1, $2)", [A, r.session_id]);
ok((await stage(A, r.session_id, tok)) === null, "ending the session locks this browser again");
await unlockRow(A);

// ── 4. counting and locking ──
const s0 = await openSession(A);
ok(s0.ok, "a fresh unlocked session");
for (let i = 0; i < 5; i++) {
  const x = await begin(A, "password");
  if (x.ok) await pwCheck(A, x.attempt_id, hx(), hx());
}
const c = await creds(A);
ok(c.locked_until !== null || c.lock_count >= 1, "five wrong entries lock the dashboard");
ok((await begin(A, "password")).reason === "locked", "while locked no attempt begins");
ok((await stage(A, s0.session, s0.tok)) === null, "a lock ends every open session of that admin");
// attempts that are begun and never finished still count
await unlockRow(A);
for (let i = 0; i < 5; i++) await begin(A, "pin");
ok((await begin(A, "pin")).reason === "locked", "abandoned attempts count toward the lock");
const lc = (await creds(A)).lock_count;
await db.query("update admin_lock_credentials set locked_until = null where user_id = $1", [A]);
for (let i = 0; i < 6; i++) await begin(A, "pin");
const until = (await creds(A)).locked_until;
ok((await creds(A)).lock_count > lc && new Date(until) - Date.now() > 20 * 60_000, "each lock lasts longer than the one before");
await unlockRow(A);

// ── 5. PIN reset by passwords, then the emailed link ──
const reset = async (u, k1, k2, link) => { const x = await begin(u, "pin_reset"); return rpc("select admin_lock_request_pin_reset($1, $2, decode($3, 'hex'), decode($4, 'hex'), decode($5, 'hex'))", [u, x.attempt_id, k1, k2, link]); };
const complete = (u, link, pin) => rpc("select admin_lock_complete_pin_reset($1, decode($2, 'hex'), decode($3, 'hex'), decode($4, 'hex'))", [u, link, pin, salt()]);
ok((await reset(A, keys.pw, hx(), hx())).ok === false, "no previous password: a different second password is refused");
const R1 = hx();
r = await reset(A, keys.pw, keys.pw, R1);
ok(r.ok === true && r.issued === true, "no previous password: the current one typed twice issues the link");
const sBefore = await openSession(A);
const R2 = hx();
r = await reset(A, keys.pw, keys.pw, R2);
ok((await complete(A, R1, hx())).ok === false, "a newer link supersedes the older one");
ok((await complete(B, R2, hx())).ok === false, "a link works only for the admin it was sent to");
ok((await rpc("select admin_lock_link_valid($1, 'pin_reset', decode($2, 'hex'))", [A, R2])) === true, "opening the link checks it without spending it");
const newPin = hx();
ok((await complete(A, R2, newPin)).ok === true, "the live link sets the new PIN");
ok((await complete(A, R2, hx())).ok === false, "the link works once");
ok((await stage(A, sBefore.session, sBefore.tok)) === null, "a PIN reset ends every open session");
ok((await openSession(A, keys.pw, keys.pin)).ok === false, "the old PIN no longer unlocks");
await unlockRow(A);
keys.pin = newPin;
ok((await openSession(A)).ok === true, "the new PIN unlocks");
// change the password: from now on the previous one is required
const newPw = hx();
let x = await begin(A, "change_password");
ok((await rpc("select admin_lock_change_password($1, $2, decode($3, 'hex'), decode($4, 'hex'), decode($5, 'hex'))", [A, x.attempt_id, keys.pw, newPw, salt()])).ok === true, "the password changes with the current one");
const oldPw = keys.pw;
keys.pw = newPw;
ok((await reset(A, keys.pw, keys.pw, hx())).ok === false, "after a change the current password twice is no longer enough");
ok((await reset(A, keys.pw, oldPw, hx())).ok === true, "the current and the previous password issue the link");
await unlockRow(A);

// ── 6. manual funding ──
const acct = await rpc("select ensure_wallet_number($1)", [M]);
const adminAcct = await rpc("select ensure_wallet_number($1)", [A]);
const S = await openSession(A);
ok(S.ok, "unlocked for funding");
const before = await coin(M);
const REF = ref();
r = await fund({ session: S.session, tok: hx() }, keys.pin, acct, 5000, "Promised launch bonus", ref());
ok(r.ok === false && r.reason === "locked", "funding is refused without this browser's unlocked session");
r = await fund(S, hx(), acct, 5000, "Promised launch bonus", ref());
ok(r.ok === false && r.reason === "authorization_failed", "funding is refused with a wrong PIN");
ok((await coin(M)) === before, "nothing was credited by a refused funding");
await unlockRow(A);
r = await fund(S, keys.pin, acct, 5000, "Promised launch bonus", REF);
ok(r.ok === true, "an unlocked session and the right PIN fund the wallet");
ok((await coin(M)) === before + 5000, "the member's coin balance went up by exactly the amount");
r = await fund(S, keys.pin, acct, 5000, "Promised launch bonus", REF);
ok(r.ok === true && r.duplicate === true && (await coin(M)) === before + 5000, "a replay answers the same funding and credits nothing twice");
ok((await fund(S, keys.pin, acct, 6000, "Promised launch bonus", REF)).reason === "idempotency_conflict", "the same reference with another amount is refused");
ok((await fund(S, keys.pin, acct, 100001, "Too much at once", ref())).reason === "invalid", "a funding is capped at $1,000");
ok((await fund(S, keys.pin, acct, 5000, "abc", ref())).reason === "invalid", "a funding needs a real reason");
ok((await fund(S, keys.pin, adminAcct, 5000, "Funding myself", ref())).reason === "self", "an admin cannot fund their own wallet");
ok((await fund(S, keys.pin, "0000000000", 5000, "Nobody has this", ref())).reason === "no_recipient", "an unknown wallet number is refused");
for (let i = 0; i < 4; i++) await fund(S, keys.pin, acct, 100000, "Daily cap fill", ref());
ok((await fund(S, keys.pin, acct, 100000, "Over the cap", ref())).reason === "daily_cap", "an admin funds at most $5,000 in 24 hours");
const row = await one("select id, ledger_id from admin_coin_fundings where reference = $1", [REF]);
ok(!!row && !!(await one("select 1 from ai_product_ledger where id = $1 and kind = 'adjustment' and actor_admin_id = $2", [row.ledger_id, A])), "the funding points at its ledger row, signed by the admin");
ok(!!(await throws("update admin_coin_fundings set amount_cents = 99999 where reference = $1", [REF])), "a funding record cannot be rewritten");
ok(!!(await throws("delete from admin_coin_fundings where reference = $1", [REF])), "a funding record cannot be deleted");
ok(!!(await throws("update ai_product_ledger set delta_cents = 99999 where id = $1", [row.ledger_id])), "its ledger row cannot be rewritten");
ok(!!(await one("select 1 from financial_audit_log where action = 'admin_coin_funding' and reference = $1", [`admin-fund:${REF}`])), "the funding is in the audit log");
const leak = JSON.stringify(await q("select details from financial_audit_log"));
ok(![keys.pin, keys.pw, oldPw].some((k) => leak.includes(k)), "no password or PIN key appears in the audit trail");

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
