// 0282 (Frenz Coin Part 4.2) — the transaction PIN, against the REAL functions in PGlite.
//   node 0282_coin_pin.pglite.mjs <repo>/supabase/migrations [--mutant=<name>]
//
// Builds the wallet (credit_wallet.shared.mjs), applies 0278–0282 twice each, then drives: who may touch the PIN tables
// and the transfer function; setup (once, confirmed email, not suspended); the counted single-use attempt; a transfer
// confirmed with the right key, refused with a wrong one (nothing moves), replayed, borrowed by another member, expired,
// or used for another purpose; idempotent retries; restrictions still applied after a correct PIN; counting, locking,
// progressive locks, attempts that never finish; change; the emailed reset (supersede, expiry, single use, tries, hourly
// limit, clearing the locks); and that no PIN, key, hash or code appears in the audit trail.
//
// The "key" here is 32 random bytes standing in for scrypt(HMAC(pepper, PIN), salt): the database only compares bytes,
// and lib/coin/pin.server.test.ts pins the derivation itself.
//
// --mutant=<name> breaks one protection and the run must FAIL:
//   no-count          begin_coin_pin_attempt stops counting attempts       -> unlimited guesses
//   reusable-attempt  coin_pin_check accepts a consumed attempt again      -> one PIN entry authorizes twice
//   bypass            transfer_coins is granted back to the service role   -> a transfer without any PIN
//   reset-reuse       complete_coin_pin_reset accepts a consumed code      -> one emailed code works twice
//   no-supersede      a new reset code leaves the old one live             -> an older code still works
import { randomBytes } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";

import { applyCloseout, coinMigration, depositMigration, depositPrerequisites, migration, scopeMigration, split, STUB, U, walletStatements } from "./credit_wallet.shared.mjs";
import { readFileSync } from "node:fs";

const dir = process.argv[2];
const MUTANT = (process.argv.find((a) => a.startsWith("--mutant=")) ?? "").split("=")[1] ?? "";
const db = new PGlite();
const run = async (stmts) => { for (const s of stmts) { try { await db.exec(s); } catch (e) { console.log("SQL ERROR:", e.message, "\n", s.slice(0, 300)); process.exit(2); } } };
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; console.log("FAIL:", m); } else console.log("ok:", m); };
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const one = async (sql, params = []) => (await q(sql, params))[0];
const rpc = async (sql, params = []) => Object.values((await one(sql, params)) ?? {})[0];
const pinMigration = () => split(readFileSync(`${dir}/0282_frenz_coin_transaction_pin.sql`, "utf8"));

await run(split(STUB));
await run(walletStatements(dir));
await run(depositPrerequisites(dir));
for (const m of [migration, coinMigration, depositMigration, scopeMigration, pinMigration]) { await run(m(dir)); await run(m(dir)); }
// closeout regression: APPLY_0283=1 runs this WHOLE PIN suite with 0283's restated PIN functions on top
await run(applyCloseout(dir));
await db.exec(`insert into auth.users (id, email, email_confirmed_at) select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'u' || g || '@t.test', now() from generate_series(1, 60) g`);
await db.exec(`insert into public.profiles (id) select id from auth.users`);

// ── mutants ──
const fnBody = async (name) => (await one("select pg_get_functiondef(p.oid) d from pg_proc p where p.proname = $1", [name])).d;
const mutate = async (name, from, to) => { const b = await fnBody(name); const m = b.split(from).join(to); if (m === b) throw new Error(`mutant on ${name} did not apply`); await db.exec(m); };
if (MUTANT === "no-count") await mutate("begin_coin_pin_attempt", "update public.coin_pins set failed_attempts = failed_attempts + 1, updated_at = now() where user_id = p_user;", "");
if (MUTANT === "reusable-attempt") await mutate("coin_pin_check", "and purpose = p_purpose and consumed_at is null and expires_at > now()", "and purpose = p_purpose and expires_at > now()");
if (MUTANT === "bypass") await db.exec("grant execute on function public.transfer_coins(uuid, text, bigint, text, text, jsonb) to service_role");
if (MUTANT === "reset-reuse") await mutate("complete_coin_pin_reset", "where user_id = p_user and consumed_at is null and superseded_at is null and failed_at is null\n   for update;", "where user_id = p_user and superseded_at is null and failed_at is null order by created_at desc limit 1\n   for update;");
if (MUTANT === "no-supersede") {
  await db.exec("drop index public.coin_pin_resets_live_uidx");
  await mutate("request_coin_pin_reset", "update public.coin_pin_resets set superseded_at = now() where user_id = p_user and consumed_at is null and superseded_at is null and failed_at is null;", "");
  await mutate("complete_coin_pin_reset", "where user_id = p_user and consumed_at is null and superseded_at is null and failed_at is null\n   for update;", "where user_id = p_user and consumed_at is null and superseded_at is null and failed_at is null and code_hash = p_code_hash\n   for update;");
}

const POLICY = JSON.stringify({ maxAttempts: 5, lockMinutes: 15, resetTtlMinutes: 10, resetMaxPerHour: 3, resetCodeMaxAttempts: 5 });
const TRANSFER = JSON.stringify({ enabled: true, version: 1, percentBp: 1000, lowThresholdCents: 10000, highThresholdCents: 50000, flatBelowCents: 100, flatMidCents: 0, flatAboveCents: 500, minCents: 1, maxCents: 500000, dailyMaxCents: 10000000 });
const PARAMS = JSON.stringify({ algorithm: "scrypt", N: 32768, r: 8, p: 1, keylen: 32, pepper: "v1" });
const ADMIN = U(59);
const key = () => randomBytes(32).toString("hex");
const keys = {};
const setPin = async (u, k = key()) => { keys[u] = k; return rpc("select set_coin_pin($1, decode($2, 'hex'), decode($3, 'hex'), $4::jsonb)", [u, k, randomBytes(16).toString("hex"), PARAMS]); };
const begin = (u, purpose = "transfer") => rpc("select begin_coin_pin_attempt($1, $2, $3::jsonb)", [u, purpose, POLICY]);
const send = (u, attempt, k, to, cents, idem) => rpc("select transfer_coins_with_pin($1, $2, decode($3, 'hex'), $4, $5, $6, null, $7::jsonb, $8::jsonb)", [u, attempt, k, to, cents, idem, TRANSFER, POLICY]);
/** A whole PIN-confirmed transfer: begin + check-and-send. */
const pinSend = async (u, k, to, cents, idem) => { const a = await begin(u); if (!a?.ok) return { ok: false, reason: `begin:${a?.reason}` }; return send(u, a.attempt_id, k, to, cents, idem); };
const wallet = (u) => rpc("select ensure_wallet_number($1)", [u]);
const fund = (u, cents, ref) => rpc("select adjust_coin_balance($1, $2, $3, 'test funding', $4, false)", [u, cents, ref, ADMIN]);
const coin = async (u) => (await one("select balance_cents::int b, pending_cents::int p from ai_product_balances where user_id = $1 and product = 'frenz_coin'", [u])) ?? { b: 0, p: 0 };
const pinRow = (u) => one("select failed_attempts, lock_count, locked_until, encode(pin_hash, 'hex') h from coin_pins where user_id = $1", [u]);
const unlock = (u) => db.query("update coin_pins set locked_until = now() - interval '1 second' where user_id = $1", [u]);
const transfers = async () => Number((await one("select count(*) n from coin_transfers")).n);
const codeHash = () => randomBytes(32).toString("hex");
const requestReset = (u, h) => rpc("select request_coin_pin_reset($1, decode($2, 'hex'), $3::jsonb)", [u, h, POLICY]);
const completeReset = (u, h, k = key()) => rpc("select complete_coin_pin_reset($1, decode($2, 'hex'), decode($3, 'hex'), decode($4, 'hex'), $5::jsonb, $6::jsonb)", [u, h, k, randomBytes(16).toString("hex"), PARAMS, POLICY]);

const A = U(1), B = U(2), C = U(3), D = U(4), E = U(5), F = U(6), G = U(7), H = U(8);
const [wA, wB] = [await wallet(A), await wallet(B)];
for (const u of [C, D, E, F, G, H]) await wallet(u);

// ── who may touch what ──
for (const t of ["coin_pins", "coin_pin_attempts", "coin_pin_resets"]) {
  const r = await one(`select has_table_privilege('anon', 'public.${t}', 'select') a, has_table_privilege('authenticated', 'public.${t}', 'select') b, has_table_privilege('service_role', 'public.${t}', 'select') s, has_table_privilege('service_role', 'public.${t}', 'update') su, (select relrowsecurity from pg_class where relname = '${t}') rls`);
  ok(!r.a && !r.b && !r.s && !r.su && r.rls, `${t}: unreadable and unwritable by every API role (service role included), RLS on`);
}
const priv = async (role, fn) => (await one(`select has_function_privilege('${role}', 'public.${fn}', 'execute') x`)).x;
ok(!(await priv("service_role", "transfer_coins(uuid, text, bigint, text, text, jsonb)")) && !(await priv("authenticated", "transfer_coins(uuid, text, bigint, text, text, jsonb)")), "🔴 transfer_coins: no API role may call it — the PIN path is the only door");
ok(await priv("service_role", "transfer_coins_with_pin(uuid, uuid, bytea, text, bigint, text, text, jsonb, jsonb)") && !(await priv("authenticated", "transfer_coins_with_pin(uuid, uuid, bytea, text, bigint, text, text, jsonb, jsonb)")), "transfer_coins_with_pin: service role only");
ok(!(await priv("service_role", "coin_pin_check(uuid, uuid, bytea, text, jsonb)")) && !(await priv("service_role", "coin_pin_lock(uuid, jsonb, text)")), "the check and the lock are internal: nobody may call them directly");
for (const f of ["set_coin_pin(uuid, bytea, bytea, jsonb)", "begin_coin_pin_attempt(uuid, text, jsonb)", "change_coin_pin(uuid, uuid, bytea, bytea, bytea, jsonb, jsonb)", "request_coin_pin_reset(uuid, bytea, jsonb)", "complete_coin_pin_reset(uuid, bytea, bytea, bytea, jsonb, jsonb)", "coin_pin_status(uuid)"]) {
  ok((await priv("service_role", f)) && !(await priv("authenticated", f)) && !(await priv("anon", f)), `${f.split("(")[0]}: service role only`);
}

// ── setup ──
await db.query("update auth.users set email_confirmed_at = null where id = $1", [H]);
ok((await setPin(H))?.reason === "email_unconfirmed", "setup needs a confirmed email");
await db.query("update profiles set is_suspended = true where id = $1", [G]);
ok((await setPin(G))?.reason === "suspended", "a suspended account cannot set a PIN");
await db.query("update profiles set is_suspended = false where id = $1", [G]);
ok((await rpc("select set_coin_pin($1, decode('00', 'hex'), decode('00', 'hex'), $2::jsonb)", [A, PARAMS]))?.reason === "invalid", "a malformed hash or salt is refused");
ok((await rpc("select set_coin_pin($1, decode($2, 'hex'), decode($3, 'hex'), '{\"algorithm\": \"sha256\"}'::jsonb)", [A, key(), randomBytes(16).toString("hex")]))?.reason === "invalid", "only the scrypt parameters are accepted (never a fast hash)");
ok((await setPin(A))?.ok === true, "A sets a PIN");
const aHash = (await pinRow(A)).h;
ok((await rpc("select set_coin_pin($1, decode($2, 'hex'), decode($3, 'hex'), $4::jsonb)", [A, key(), randomBytes(16).toString("hex"), PARAMS]))?.reason === "exists" && (await pinRow(A)).h === aHash, "a second setup never replaces the PIN");
ok((await rpc("select coin_pin_status($1)", [A])).set === true && (await rpc("select coin_pin_status($1)", [B])).set === false, "status says whether a PIN is set — never the hash");

// ── the attempt ──
ok((await begin(B))?.reason === "no_pin", "no PIN: no attempt");
let a = await begin(A);
ok(a?.ok === true && /^[0-9a-f]{32}$/.test(a.salt) && a.params.algorithm === "scrypt" && !JSON.stringify(a).includes(aHash), "an attempt returns the salt and parameters, NEVER the hash");
ok((await pinRow(A)).failed_attempts === 1, "the attempt is counted as it begins");

// ── transfers ──
await fund(A, 100000, "fund-a");
const before = await coin(A);
let r = await send(A, a.attempt_id, key(), wB, 5000, "a-1");
ok(r?.ok === false && r.reason === "authorization_failed", "a wrong PIN: authorization_failed");
ok(JSON.stringify(await coin(A)) === JSON.stringify(before) && (await transfers()) === 0 && Number((await one("select count(*) n from ai_product_ledger where product = 'frenz_coin' and kind like 'transfer%'")).n) === 0, "…and nothing moved: no transfer, debit, credit or fee row");
a = await begin(A);
r = await send(A, a.attempt_id, keys[A], wB, 5000, "a-1");
ok(r?.ok === true && r.amount === 5000 && r.fee === 600 && r.total === 5600, "the right PIN sends: $50 + $6 fee (the server's fee rules, recomputed in SQL)");
ok((await coin(A)).b === 100000 - 5600 && (await coin(B)).b === 5000, "the sender pays amount + fee; the recipient gets exactly the amount");
ok((await pinRow(A)).failed_attempts === 0, "a success resets the count");
r = await send(A, a.attempt_id, keys[A], wB, 5000, "a-2");
ok(r?.reason === "authorization_failed" && (await transfers()) === 1, "the same attempt again (a replay): refused, nothing sent");
a = await begin(A);
r = await send(B, a.attempt_id, keys[A], wA, 100, "b-borrow");
ok(r?.reason === "authorization_failed", "another member cannot use A's attempt (even with A's key)");
await db.exec("select 1");
a = await begin(A, "change");
r = await send(A, a.attempt_id, keys[A], wB, 100, "a-purpose");
ok(r?.reason === "authorization_failed", "a 'change' attempt cannot authorize a transfer");
a = await begin(A);
await db.query("update coin_pin_attempts set expires_at = now() - interval '1 second' where id = $1", [a.attempt_id]);
r = await send(A, a.attempt_id, keys[A], wB, 100, "a-expired");
ok(r?.reason === "authorization_failed" && (await transfers()) === 1, "an expired attempt: refused");
r = await rpc("select transfer_coins_with_pin($1, $2, decode($3, 'hex'), $4, 100, 'a-forged', null, $5::jsonb, $6::jsonb)", [A, "00000000-0000-4000-8000-0000000000ff", keys[A], wB, TRANSFER, POLICY]);
ok(r?.reason === "authorization_failed", "a made-up attempt id: refused");
await db.query("update coin_pins set failed_attempts = 0 where user_id = $1", [A]);
// idempotent retries
r = await pinSend(A, keys[A], wB, 5000, "a-1");
ok(r?.ok === true && r.duplicate === true && (await transfers()) === 1 && (await coin(A)).b === 100000 - 5600, "a retry of a completed transfer (new PIN entry) answers the first one — no second debit");
r = await pinSend(A, keys[A], wB, 7000, "a-1");
ok(r?.reason === "idempotency_conflict" && (await transfers()) === 1, "the same key for another amount: refused, never a second transfer");
r = await pinSend(A, keys[A], await wallet(C), 5000, "a-1");
ok(r?.reason === "idempotency_conflict", "…or for another recipient");

// ── the restrictions still apply after a correct PIN ──
await db.query("update profiles set is_suspended = true where id = $1", [A]);
ok((await pinSend(A, keys[A], wB, 100, "a-susp"))?.reason === "suspended", "a suspended sender is refused even with the right PIN");
await db.query("update profiles set is_suspended = false where id = $1", [A]);
await db.query("insert into reward_profiles (user_id, restricted, restricted_reason) values ($1, true, 'admin review') on conflict (user_id) do update set restricted = true, restricted_reason = 'admin review'", [A]);
ok((await pinSend(A, keys[A], wB, 100, "a-restr"))?.reason === "restricted", "an admin's account restriction applies even with the right PIN");
await db.query("update reward_profiles set restricted = false, restricted_reason = null where user_id = $1", [A]);
await db.query("update profiles set is_suspended = true where id = $1", [B]);
ok((await pinSend(A, keys[A], wB, 100, "a-to-susp"))?.reason === "recipient_unavailable", "a suspended recipient is refused");
await db.query("update profiles set is_suspended = false where id = $1", [B]);
ok((await pinSend(A, keys[A], wB, 10_000_000, "a-big"))?.reason === "amount_out_of_range", "the transfer limits still apply");
ok((await pinSend(A, keys[A], wB, 95000, "a-poor"))?.reason === "insufficient", "the balance still applies (amount + fee)");

// ── counting and locking ──
await setPin(C);
await fund(C, 50000, "fund-c");
for (let i = 1; i <= 5; i++) {
  const out = await pinSend(C, key(), wA, 100, `c-guess-${i}`);
  ok(out?.reason === "authorization_failed", `wrong guess ${i} refused`);
}
let pc = await pinRow(C);
ok(pc.locked_until && Date.parse(pc.locked_until) > Date.now() + 14 * 60_000 && pc.lock_count === 1 && pc.failed_attempts === 0, "the 5th wrong guess locks the PIN for 15 minutes");
ok((await begin(C))?.reason === "locked" && (await pinSend(C, keys[C], wA, 100, "c-right-locked"))?.ok !== true, "while locked, even the right PIN cannot begin an attempt");
ok((await transfers()) === 1 && (await coin(C)).b === 50000, "nothing was sent during the guessing");
await unlock(C);
for (let i = 1; i <= 5; i++) await pinSend(C, key(), wA, 100, `c-guess2-${i}`);
pc = await pinRow(C);
ok(pc.lock_count === 2 && Date.parse(pc.locked_until) > Date.now() + 29 * 60_000, "the second lock is longer (30 minutes): progressive");
await unlock(C);
r = await pinSend(C, keys[C], wA, 100, "c-ok");
pc = await pinRow(C);
ok(r?.ok === true && pc.failed_attempts === 0 && pc.lock_count === 0 && !pc.locked_until, "after the lock, the right PIN works and every counter resets — never a permanent lockout");
// attempts that begin but never finish still count
await setPin(D);
for (let i = 0; i < 5; i++) await begin(D);
const d6 = await begin(D);
ok(d6?.reason === "locked" && (await pinRow(D)).locked_until, "five attempts that never finish use up the limit: the sixth is refused and the PIN locks (an attacker cannot avoid counting)");
await unlock(D);
ok((await begin(D))?.ok === true, "…and the lock ends on time");
const audit = await q("select action, details::text d from financial_audit_log where action like 'coin_pin%' or action like 'coin_transfer_%'");
ok(audit.some((x) => x.action === "coin_pin_failed") && audit.some((x) => x.action === "coin_pin_locked") && audit.some((x) => x.action === "coin_transfer_authorized"), "failures, locks and authorized transfers are audited");

// ── change ──
await setPin(E);
const eOld = keys[E];
a = await begin(E, "change");
const newKey = key();
r = await rpc("select change_coin_pin($1, $2, decode($3, 'hex'), decode($4, 'hex'), decode($5, 'hex'), $6::jsonb, $7::jsonb)", [E, a.attempt_id, key(), newKey, randomBytes(16).toString("hex"), PARAMS, POLICY]);
ok(r?.reason === "authorization_failed" && (await pinRow(E)).h === eOld, "a wrong current PIN: no change");
a = await begin(E, "change");
r = await rpc("select change_coin_pin($1, $2, decode($3, 'hex'), decode($4, 'hex'), decode($5, 'hex'), $6::jsonb, $7::jsonb)", [E, a.attempt_id, eOld, newKey, randomBytes(16).toString("hex"), PARAMS, POLICY]);
ok(r?.ok === true && (await pinRow(E)).h === newKey, "the current PIN changes it");
await fund(E, 10000, "fund-e");
ok((await pinSend(E, eOld, wA, 100, "e-old"))?.reason === "authorization_failed" && (await pinSend(E, newKey, wA, 100, "e-new"))?.ok === true, "the old PIN stops working, the new one works");

// ── the emailed reset ──
ok((await requestReset(B, codeHash()))?.issued === false, "no PIN: nothing issued (the caller is told the same either way)");
await setPin(F);
await db.query("update coin_pins set locked_until = now() + interval '1 hour', lock_count = 3 where user_id = $1", [F]);
const h1 = codeHash(), h2 = codeHash();
ok((await requestReset(F, h1))?.issued === true, "a reset code is issued");
ok((await requestReset(F, h2))?.issued === true, "a second request issues a new code…");
ok((await completeReset(F, h1))?.reason === "invalid", "…and the first one no longer works (superseded)");
const fOpen = await begin(E);
const fKey = key();
r = await completeReset(F, h2, fKey);
const pf = await pinRow(F);
ok(r?.ok === true && pf.h === fKey && pf.failed_attempts === 0 && pf.lock_count === 0 && !pf.locked_until, "the live code sets the new PIN and clears the locks");
ok((await completeReset(F, h2))?.reason === "invalid", "the same code again: refused (single use)");
ok(fOpen?.ok, "(another member's open attempt is untouched)");
// attempts begun before a reset are void
await setPin(G);
const gOpen = await begin(G);
const hg = codeHash();
await requestReset(G, hg);
await completeReset(G, hg, key());
ok((await send(G, gOpen.attempt_id, keys[G], wA, 100, "g-stale"))?.reason === "authorization_failed", "an attempt begun before the reset is void");
// expiry and tries
await db.query("update coin_pin_resets set superseded_at = now() where user_id = $1 and consumed_at is null and superseded_at is null and failed_at is null", [G]);
await db.query("delete from coin_pin_resets where user_id = $1", [G]);
const hx = codeHash();
await requestReset(G, hx);
await db.query("update coin_pin_resets set expires_at = now() - interval '1 second' where user_id = $1 and consumed_at is null", [G]);
ok((await completeReset(G, hx))?.reason === "invalid", "an expired code: refused");
await db.query("delete from coin_pin_resets where user_id = $1", [G]);
const hy = codeHash();
await requestReset(G, hy);
for (let i = 0; i < 5; i++) await completeReset(G, codeHash());
ok((await completeReset(G, hy))?.reason === "invalid", "five wrong codes kill the live code — even the right one then fails");
// the hourly limit
await db.query("delete from coin_pin_resets where user_id = $1", [G]);
for (let i = 0; i < 3; i++) await requestReset(G, codeHash());
ok((await requestReset(G, codeHash()))?.issued === false, "a fourth request in an hour issues nothing");
await db.query("update auth.users set email_confirmed_at = now() where id = $1", [H]);
ok((await setPin(H))?.ok === true, "H (now confirmed) sets a PIN");
await db.query("update profiles set is_suspended = true where id = $1", [H]);
ok((await requestReset(H, codeHash()))?.issued === false && Number((await one("select count(*) n from coin_pin_resets where user_id = $1", [H])).n) === 0, "a suspended account with a PIN is issued nothing");
await db.query("update profiles set is_suspended = false where id = $1", [H]);

// ── nothing secret in the trail ──
const trail = (await q("select details::text d from financial_audit_log")).map((x) => x.d).join("\n");
const secrets = [...Object.values(keys), h1, h2, hx, hy, aHash];
ok(!secrets.some((s) => trail.includes(s)), "no key, hash or reset code appears anywhere in the audit trail");
ok(Number((await one("select count(*) n from coin_pin_resets where code_hash is null")).n) === 0 && (await q("select column_name from information_schema.columns where table_name in ('coin_pins', 'coin_pin_attempts', 'coin_pin_resets')")).every((c) => !/plain|^pin$|^code$/.test(c.column_name)), "no table has a column for a plaintext PIN or code");

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
