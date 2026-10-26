// 0283 (Frenz Coin closeout) — PIN-confirmed withdrawals and their whole lifecycle, the payout quote, transfer
// corrections, partial deposit refunds, the byte-by-byte comparison and the notification types, against the REAL
// functions in PGlite.
//   node 0283_coin_closeout.pglite.mjs <repo>/supabase/migrations [--mutant=<name>]
//
// Builds the wallet (credit_wallet.shared.mjs), applies 0278–0283 twice each, then drives a $100 withdrawal from the PIN
// to the bank and back: hold, quote, approve, processing, completed (fee income posted once), a failed payout and a
// rejection (the gross returned, no fee), an out-of-order success after a release (refused), a bank return (the full
// gross restored and the fee income reversed, once). Then corrections (fee refund once, sender credits capped, the
// recipient never touched), partial refunds (its share, never the whole, once), and conservation of money throughout.
//
// --mutant=<name> breaks one protection and the run must FAIL:
//   withdraw-no-pin    request_coin_withdrawal is granted back to the service role     -> a withdrawal without the PIN
//   quote-rewrite      record_coin_payout_quote overwrites an existing quote            -> a retried payout pays a new amount
//   fee-refund-twice   the once-per-transfer fee refund rule is removed                 -> a fee refunded twice
//   partial-as-full    a partial refund takes the whole deposit                         -> more taken back than was refunded
//   compare-length     coin_pin_bytes_equal ignores bytes past the shorter input        -> a truncated key matches
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";

import { coinMigration, depositMigration, depositPrerequisites, migration, pinMigration, scopeMigration, split, STUB, U, walletStatements } from "./credit_wallet.shared.mjs";

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
const closeout = () => split(readFileSync(`${dir}/0283_frenz_coin_closeout.sql`, "utf8"));

await run(split(STUB));
await run(walletStatements(dir));
await run(depositPrerequisites(dir));
for (const m of [migration, coinMigration, depositMigration, scopeMigration, pinMigration, closeout]) { await run(m(dir)); await run(m(dir)); }
await db.exec(`insert into auth.users (id, email, email_confirmed_at) select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'u' || g || '@t.test', now() from generate_series(1, 60) g`);
await db.exec(`insert into public.profiles (id) select id from auth.users`);

// ── mutants ──
const fnBody = async (name) => (await one("select pg_get_functiondef(p.oid) d from pg_proc p where p.proname = $1", [name])).d;
const mutate = async (name, from, to) => { const b = await fnBody(name); const m = b.split(from).join(to); if (m === b) throw new Error(`mutant on ${name} did not apply`); await db.exec(m); };
if (MUTANT === "withdraw-no-pin") await db.exec("grant execute on function public.request_coin_withdrawal(uuid, bigint, text, jsonb, text, jsonb) to service_role");
if (MUTANT === "quote-rewrite") await mutate("record_coin_payout_quote", "  if v_w.payout_minor is not null then\n", "  if false then\n");
if (MUTANT === "fee-refund-twice") {
  await db.exec("drop index public.coin_transfer_corrections_fee_once_uidx");
  await mutate("correct_coin_transfer", "if exists (select 1 from public.coin_transfer_corrections where transfer_id = p_transfer and kind = 'fee_refund') then", "if false then");
}
if (MUTANT === "partial-as-full") await mutate("apply_coin_deposit_partial_refund", "ceil(v_d.amount_cents::numeric * v_r.refunded_minor / v_r.paid_minor)::bigint", "v_d.amount_cents");
if (MUTANT === "compare-length") await mutate("coin_pin_bytes_equal", "v_diff := case when v_glen = v_len then 0 else 1 end;", "v_diff := 0; v_len := least(v_len, v_glen);");

const POLICY = JSON.stringify({ maxAttempts: 5, lockMinutes: 15, resetTtlMinutes: 10, resetMaxPerHour: 3, resetCodeMaxAttempts: 5 });
const TRANSFER = JSON.stringify({ enabled: true, version: 1, percentBp: 1000, lowThresholdCents: 10000, highThresholdCents: 50000, flatBelowCents: 100, flatMidCents: 0, flatAboveCents: 500, minCents: 1, maxCents: 500000, dailyMaxCents: 10000000 });
const WITHDRAW = JSON.stringify({ enabled: true, version: 1, percentBp: 600, flatCents: 0, minCents: 500, maxCents: 500000, maxPerDay: 5, maxMonthCents: 100000000, requireQualification: false, requireEmailConfirmed: true, payoutCurrency: "NGN", payoutMinorPerUsd: null });
const DEP = JSON.stringify({ enabled: true, version: 1, holdHours: 72, minCents: 100, maxCents: 500000 });
const PARAMS = JSON.stringify({ algorithm: "scrypt", N: 32768, r: 8, p: 1, keylen: 32, pepper: "v1" });
const ADMIN = U(59);
const DETAILS = JSON.stringify({ bankCode: "058", bankName: "GTBank", accountNumber: "0123456789", accountName: "ADA OBI" });
const keys = {};
const setPin = async (u) => { keys[u] = randomBytes(32).toString("hex"); return rpc("select set_coin_pin($1, decode($2, 'hex'), decode($3, 'hex'), $4::jsonb)", [u, keys[u], randomBytes(16).toString("hex"), PARAMS]); };
const begin = (u, purpose) => rpc("select begin_coin_pin_attempt($1, $2, $3::jsonb)", [u, purpose, POLICY]);
const withdraw = async (u, gross, idem, k = keys[u]) => { const a = await begin(u, "withdrawal"); if (!a?.ok) return { ok: false, reason: `begin:${a?.reason}` }; return rpc("select request_coin_withdrawal_with_pin($1, $2, decode($3, 'hex'), $4, 'paystack', $5::jsonb, $6, $7::jsonb, $8::jsonb)", [u, a.attempt_id, k, gross, DETAILS, idem, WITHDRAW, POLICY]); };
const pinSend = async (u, to, cents, idem) => { const a = await begin(u, "transfer"); return rpc("select transfer_coins_with_pin($1, $2, decode($3, 'hex'), $4, $5, $6, null, $7::jsonb, $8::jsonb)", [u, a.attempt_id, keys[u], to, cents, idem, TRANSFER, POLICY]); };
const resolve = (id, status, ref = null) => rpc("select resolve_withdrawal($1, $2, $3, 'test', $4)", [id, status, ADMIN, ref]);
const wallet = (u) => rpc("select ensure_wallet_number($1)", [u]);
const fund = (u, cents, ref) => rpc("select adjust_coin_balance($1, $2, $3, 'test funding', $4, false)", [u, cents, ref, ADMIN]);
const coin = async (u) => (await one("select balance_cents::int b, pending_cents::int p, held_cents::int h from ai_product_balances where user_id = $1 and product = 'frenz_coin'", [u])) ?? { b: 0, p: 0, h: 0 };
const feeIncome = async () => Number((await one("select coalesce(sum(case when source like '%reversal' then -amount else amount end), 0) n from platform_fee_ledger where source like 'coin_%'")).n);

/** Wallets reconcile to their ledgers; money is conserved: funded = in wallets/held + paid out + fee income. */
const invariants = async (label) => {
  const bad = await q(`select b.user_id from ai_product_balances b
    left join (select user_id, sum(delta_cents) s, coalesce(sum(delta_cents) filter (where status = 'reserved' and delta_cents > 0), 0) pend,
                      coalesce(-sum(delta_cents) filter (where status = 'reserved' and delta_cents < 0), 0) held from ai_product_ledger where product = 'frenz_coin' group by user_id) l on l.user_id = b.user_id
    where b.product = 'frenz_coin' and (b.balance_cents <> coalesce(l.s, 0) or b.pending_cents <> coalesce(l.pend, 0) or b.held_cents <> coalesce(l.held, 0) or b.pending_cents > b.balance_cents or b.balance_cents < 0 or b.held_cents < 0)`);
  ok(bad.length === 0, `${label}: balance = Σ ledger, pending and held reconcile, nothing negative`);
  // a fee refund is fee income handed back, not new money: it is counted on the fee side (as its reversal)
  const c = await one(`select
      (select coalesce(sum(delta_cents), 0) from ai_product_ledger where product = 'frenz_coin'
         and (kind in ('adjustment', 'deposit') or (kind = 'refund' and coalesce(metadata ->> 'kind', '') <> 'fee_refund') or (kind = 'reversal' and status <> 'reserved')))::bigint funded,
      (select coalesce(sum(balance_cents + held_cents), 0) from ai_product_balances where product = 'frenz_coin')::bigint wallets,
      (select coalesce(sum(net_cents), 0) from withdrawal_requests where source = 'coin' and status = 'completed')::bigint paid_out`);
  const n = Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Number(v)]));
  const fees = await feeIncome();
  ok(n.funded === n.wallets + n.paid_out + fees, `${label}: conservation — funded ${n.funded} = wallets ${n.wallets} + paid out ${n.paid_out} + fee income ${fees}`);
};

const A = U(1), B = U(2), C = U(3), D = U(4), E = U(5);
const [wA, wB] = [await wallet(A), await wallet(B)];
await wallet(C); await wallet(D); await wallet(E);

// ── permissions ──
const priv = async (role, fn) => (await one(`select has_function_privilege('${role}', 'public.${fn}', 'execute') x`)).x;
ok(!(await priv("service_role", "request_coin_withdrawal(uuid, bigint, text, jsonb, text, jsonb)")) && !(await priv("authenticated", "request_coin_withdrawal(uuid, bigint, text, jsonb, text, jsonb)")), "🔴 request_coin_withdrawal: no API role may call it — the PIN path is the only door");
ok(!(await priv("service_role", "transfer_coins(uuid, text, bigint, text, text, jsonb)")), "transfer_coins is still closed to every API role");
for (const f of ["request_coin_withdrawal_with_pin(uuid, uuid, bytea, bigint, text, jsonb, text, jsonb, jsonb)", "record_coin_payout_quote(uuid, bigint, text, jsonb)", "correct_coin_transfer(uuid, text, bigint, text, uuid, text)", "apply_coin_deposit_partial_refund(uuid, uuid, text)"]) {
  ok((await priv("service_role", f)) && !(await priv("authenticated", f)) && !(await priv("anon", f)), `${f.split("(")[0]}: service role only`);
}
ok(!(await priv("service_role", "coin_pin_bytes_equal(bytea, bytea)")) && !(await priv("service_role", "coin_pin_check(uuid, uuid, bytea, text, jsonb)")), "the comparison and the check stay internal");
const t = await one("select has_table_privilege('authenticated', 'public.coin_transfer_corrections', 'select') a, has_table_privilege('authenticated', 'public.coin_notification_claims', 'insert') b, has_table_privilege('service_role', 'public.coin_notification_claims', 'insert') s");
ok(!t.a && !t.b && t.s, "corrections and notification claims: no client access");

// ── the comparison ──
const eq = (a, b) => rpc("select coin_pin_bytes_equal(decode($1, 'hex'), decode($2, 'hex'))", [a, b]);
const k = randomBytes(32).toString("hex");
const flip = (h, i) => h.slice(0, i * 2) + ((parseInt(h.slice(i * 2, i * 2 + 2), 16) ^ 1).toString(16).padStart(2, "0")) + h.slice(i * 2 + 2);
ok((await eq(k, k)) === true && (await eq(flip(k, 0), k)) === false && (await eq(flip(k, 31), k)) === false && (await eq(flip(k, 15), k)) === false, "equal keys match; a difference in the first, middle or last byte does not");
ok((await eq(k.slice(0, 62), k)) === false && (await eq(k + "00", k)) === false && (await eq("", k)) === false && (await rpc("select coin_pin_bytes_equal(null, decode($1, 'hex'))", [k])) === false, "a shorter, longer, empty or missing key never matches");

// ── a $100 withdrawal, PIN first ──
await setPin(A);
await fund(A, 50000, "fund-a");
await invariants("start");
let r = await withdraw(A, 10000, "wd-a-1", randomBytes(32).toString("hex"));
ok(r?.reason === "authorization_failed" && (await coin(A)).h === 0 && Number((await one("select count(*) n from withdrawal_requests where source = 'coin'")).n) === 0, "a wrong PIN: nothing held, no withdrawal row");
r = await withdraw(A, 10000, "wd-a-1");
ok(r?.ok === true && r.gross === 10000 && r.fee === 600 && r.net === 9400, "the right PIN: $100 gross, $6 fee (6%), $94 net");
const wd1 = r.id;
let w = await coin(A);
ok(w.b === 40000 && w.h === 10000, "the full gross moves from available to held");
const a2 = await begin(A, "transfer");
ok((await rpc("select request_coin_withdrawal_with_pin($1, $2, decode($3, 'hex'), 1000, 'paystack', $4::jsonb, 'wd-a-x', $5::jsonb, $6::jsonb)", [A, a2.attempt_id, keys[A], DETAILS, WITHDRAW, POLICY]))?.reason === "authorization_failed", "a transfer attempt cannot authorize a withdrawal");
r = await withdraw(A, 10000, "wd-a-1");
ok(r?.duplicate === true && r.id === wd1 && (await coin(A)).h === 10000, "the same request again (new PIN entry, same key): the same withdrawal, nothing more held");
ok((await withdraw(A, 5000, "wd-a-2"))?.reason === "open_exists", "one open coin withdrawal at a time");
await invariants("after the request");

// ── the payout quote ──
ok((await rpc("select record_coin_payout_quote($1, 0, 'NGN', '{}'::jsonb)", [wd1]))?.reason === "invalid", "a zero or malformed quote is refused");
r = await rpc("select record_coin_payout_quote($1, 14100000, 'NGN', $2::jsonb)", [wd1, JSON.stringify({ source: "market", perUsd: 1500, at: "2026-10-25T10:00:00Z", netCents: 9400 })]);
ok(r?.ok === true && r.existing === false && r.payout_minor === 14100000, "the quote is recorded: $94 → ₦141,000.00 at 1500, with its source and time");
r = await rpc("select record_coin_payout_quote($1, 99999999, 'NGN', $2::jsonb)", [wd1, JSON.stringify({ source: "market", perUsd: 9999 })]);
const row1 = await one("select payout_minor::bigint m, payout_currency c, payout_fx fx from withdrawal_requests where id = $1", [wd1]);
ok(r?.existing === true && Number(row1.m) === 14100000 && row1.fx.perUsd === 1500, "a second quote (a retried payout) answers the first and changes nothing");

// ── approve → processing → completed (fee income once) ──
ok((await resolve(wd1, "approved"))?.ok === true, "approved");
ok((await resolve(wd1, "processing", "frenz_fwd_" + wd1))?.ok === true, "processing with the payout reference");
const feesBefore = await feeIncome();
ok((await resolve(wd1, "completed", "frenz_fwd_" + wd1))?.ok === true, "completed (the provider's verified word)");
w = await coin(A);
ok(w.b === 40000 && w.h === 0 && (await feeIncome()) === feesBefore + 600, "the hold is settled and $6 fee income is posted");
ok((await resolve(wd1, "completed", "frenz_fwd_" + wd1))?.ok !== true && (await feeIncome()) === feesBefore + 600, "a duplicate success changes nothing (fee income once)");
ok(Number((await one("select count(*) n from notifications where user_id = $1 and type = 'coin_withdrawal_update'", [A])).n) >= 1, "the member's in-app notice is the coin type (written in the same transaction)");
await invariants("after a completed withdrawal");

// ── a bank return: the full gross back, the fee income reversed, once ──
r = await rpc("select reverse_paid_withdrawal($1, $2, 'bank returned it')", [wd1, ADMIN]);
w = await coin(A);
ok(r?.ok === true && w.b === 50000 && (await feeIncome()) === feesBefore, "a bank return restores the full $100 gross and reverses the $6 fee income");
r = await rpc("select reverse_paid_withdrawal($1, $2, 'again')", [wd1, ADMIN]);
ok(r?.duplicate === true && (await coin(A)).b === 50000 && (await feeIncome()) === feesBefore, "a second return event changes nothing");
await invariants("after a bank return");

// ── a failed payout and a rejection: the gross returns, no fee ──
r = await withdraw(A, 20000, "wd-a-3");
const wd3 = r.id;
await resolve(wd3, "approved");
await resolve(wd3, "processing", "frenz_fwd_" + wd3);
ok((await resolve(wd3, "rejected"))?.ok === true && (await coin(A)).b === 50000 && (await coin(A)).h === 0 && (await feeIncome()) === feesBefore, "a failed payout returns the whole gross; no fee is kept");
ok((await resolve(wd3, "completed", "frenz_fwd_" + wd3))?.ok !== true && (await coin(A)).b === 50000, "a late success after the release is refused by the ledger (the paid-after-release review is the payout code's)");
r = await withdraw(A, 700, "wd-a-4");
ok((await resolve(r.id, "rejected"))?.ok === true && (await coin(A)).b === 50000, "a rejection before payout returns the gross");
await invariants("after failures and rejections");

// ── restrictions still apply after the right PIN ──
await setPin(B);
await fund(B, 30000, "fund-b");
await db.query("insert into wallet_topup_reversals (provider, event_key, kind, reference, user_id, credits_credited, credits_due, credits_recovered, shortfall_credits, state, ledger_reference) values ('paystack', 'sf-b', 'refund', 'frenz_cr_topup_b', $1, 100, 100, 40, 60, 'recovered', 'x')", [B]);
r = await withdraw(B, 5000, "wd-b-1");
ok(r?.ok === true, "an AI-credit shortfall does not pause coin withdrawals (0281)");
await resolve(r.id, "rejected");
await db.query("insert into coin_deposit_reversals (provider, event_key, kind, reference, user_id, phase, deposit_cents, due_cents, recovered_cents, shortfall_cents, state, ledger_reference) values ('flutterwave', 'sf-b-coin', 'refund', 'frenz_coin_dep_fw_x', $1, 'released', 1000, 1000, 0, 1000, 'recovered', 'y')", [B]);
ok((await withdraw(B, 5000, "wd-b-2"))?.reason === "recovery_due", "a coin shortfall pauses coin withdrawals even with the right PIN");
await setPin(C);
await fund(C, 30000, "fund-c");
await db.query("update profiles set is_suspended = true where id = $1", [C]);
ok((await withdraw(C, 5000, "wd-c-1"))?.reason === "suspended", "a suspended member is refused even with the right PIN");
await db.query("update profiles set is_suspended = false where id = $1", [C]);
await db.query("update auth.users set email_confirmed_at = null where id = $1", [C]);
ok((await withdraw(C, 5000, "wd-c-2"))?.reason === "email_unconfirmed", "an unconfirmed email is refused");
await db.query("update auth.users set email_confirmed_at = now() where id = $1", [C]);
ok((await withdraw(C, 400, "wd-c-3"))?.reason === "amount_out_of_range", "below the minimum: refused");

// ── transfer corrections ──
r = await pinSend(A, wB, 5000, "t-a-1");
const tr = r.transfer_id;
const bBefore = await coin(B);
const feesPre = await feeIncome();
ok((await rpc("select correct_coin_transfer($1, 'fee_refund', null, 'x', $2, 'corr-key-01')", [tr, ADMIN]))?.reason === "invalid", "a correction needs a reason");
ok((await rpc("select correct_coin_transfer($1, 'fee_refund', null, 'charged in error', null, 'corr-key-01')", [tr]))?.reason === "invalid", "…and an administrator");
r = await rpc("select correct_coin_transfer($1, 'fee_refund', null, 'charged in error', $2, 'corr-key-01')", [tr, ADMIN]);
ok(r?.ok === true && r.amount === 600 && (await coin(A)).b === 50000 - 5600 + 600 && (await feeIncome()) === feesPre - 600, "a fee refund: the $6 fee back to the sender, the fee income reversed");
ok((await rpc("select correct_coin_transfer($1, 'fee_refund', null, 'charged in error', $2, 'corr-key-01')", [tr, ADMIN]))?.duplicate === true, "the same request again: the same correction");
ok((await rpc("select correct_coin_transfer($1, 'fee_refund', null, 'again', $2, 'corr-key-02')", [tr, ADMIN]))?.reason === "already_refunded" && (await feeIncome()) === feesPre - 600, "a fee is refunded once, whatever the key");
ok((await rpc("select correct_coin_transfer($1, 'sender_credit', 3000, 'sent to the wrong wallet', $2, 'corr-key-01')", [tr, ADMIN]))?.reason === "idempotency_conflict", "a key reused for something else is refused");
r = await rpc("select correct_coin_transfer($1, 'sender_credit', 3000, 'sent to the wrong wallet', $2, 'corr-key-03')", [tr, ADMIN]);
ok(r?.ok === true && r.amount === 3000, "a platform-funded credit to the sender");
ok((await rpc("select correct_coin_transfer($1, 'sender_credit', 2001, 'more', $2, 'corr-key-04')", [tr, ADMIN]))?.reason === "amount_out_of_range", "sender credits never exceed the transfer amount in total");
ok(JSON.stringify(await coin(B)) === JSON.stringify(bBefore), "the recipient was never debited");
ok(!!(await throws("update coin_transfer_corrections set amount_cents = 1 where transfer_id = $1", [tr])) && !!(await throws("delete from coin_transfer_corrections where transfer_id = $1", [tr])), "a correction is permanent");
ok(Number((await one("select count(*) n from financial_audit_log where action = 'coin_transfer_corrected'")).n) === 2, "every correction is audited (2)");
await invariants("after corrections");

// ── partial deposit refunds ──
const depRef = "frenz_coin_dep_fw_00000000-0000-4000-8000-0000000000d1";
await rpc("select begin_coin_deposit($1, $2, 10000, 'flutterwave', 10000, 'USD', 'key-d-000001', $3::jsonb)", [D, depRef, DEP]);
await rpc("select settle_coin_deposit($1, 'ch', 10000, 'USD')", [depRef]);
r = await rpc("select reverse_coin_deposit('flutterwave', 'partial-1', 'refund', $1, 2500, 10000, 'USD', $2, 'partial')", [depRef, ADMIN]);
ok(r?.state === "review" && r.due === 0, "a partial refund (₦/$25 of $100) is held for review, nothing taken");
const review = r.id;
ok((await rpc("select apply_coin_deposit_partial_refund($1, $2, 'apply it')", [review, ADMIN]))?.reason === "deposit_on_hold", "not while the deposit is on hold");
await db.exec("alter table public.coin_deposits disable trigger coin_deposits_guard");
await db.query("update coin_deposits set settled_at = settled_at - interval '72 hours 1 second', release_at = release_at - interval '72 hours 1 second' where reference = $1", [depRef]);
await db.exec("alter table public.coin_deposits enable trigger coin_deposits_guard");
await rpc("select release_coin_deposit($1)", [depRef]);
r = await rpc("select apply_coin_deposit_partial_refund($1, $2, 'apply it')", [review, ADMIN]);
ok(r?.ok === true && r.due === 2500 && r.recovered === 2500 && r.shortfall === 0 && (await coin(D)).b === 7500, "applied: its share ($25 of $100) — never the whole deposit");
ok((await rpc("select apply_coin_deposit_partial_refund($1, $2, 'again')", [review, ADMIN]))?.duplicate === true && (await coin(D)).b === 7500, "applied once");
ok((await one("select state from coin_deposit_reversals where id = $1", [review])).state === "applied", "the review row is marked applied");
r = await rpc("select reverse_coin_deposit('flutterwave', 'full-1', 'refund', $1, null, null, 'USD', $2, 'the rest')", [depRef, ADMIN]);
ok(r?.due === 7500 && (await coin(D)).b === 0, "a later full refund takes only what is left ($75)");
await invariants("after partial refunds");

// ── notifications: the coin types exist, a claim is once ──
for (const type of ["coin_deposit_update", "coin_transfer_received", "coin_transfer_sent", "coin_withdrawal_update", "coin_pin_security"]) {
  ok(!(await throws("insert into notifications (user_id, type, data) values ($1, $2, '{}'::jsonb)", [E, type])), `notification type ${type} is accepted`);
}
ok(!!(await throws("insert into notifications (user_id, type, data) values ($1, 'coin_made_up', '{}'::jsonb)", [E])), "an unknown type is still refused");
await db.query("insert into coin_notification_claims (key, user_id) values ('coin-transfer-in:x', $1) on conflict (key) do nothing", [E]);
await db.query("insert into coin_notification_claims (key, user_id) values ('coin-transfer-in:x', $1) on conflict (key) do nothing", [E]);
ok(Number((await one("select count(*) n from coin_notification_claims where key = 'coin-transfer-in:x'")).n) === 1, "a notification claim is once");

// ── the PIN paths still work after the restatements ──
r = await pinSend(A, wB, 1000, "t-a-2");
ok(r?.ok === true, "a transfer with the right PIN still goes through (coin_pin_check restated)");
const h = randomBytes(32).toString("hex");
await rpc("select request_coin_pin_reset($1, decode($2, 'hex'), $3::jsonb)", [A, h, POLICY]);
ok((await rpc("select complete_coin_pin_reset($1, decode($2, 'hex'), decode($3, 'hex'), decode($4, 'hex'), $5::jsonb, $6::jsonb)", [A, flip(h, 31), randomBytes(32).toString("hex"), randomBytes(16).toString("hex"), PARAMS, POLICY]))?.reason === "invalid", "a reset code one bit off is refused");
ok((await rpc("select complete_coin_pin_reset($1, decode($2, 'hex'), decode($3, 'hex'), decode($4, 'hex'), $5::jsonb, $6::jsonb)", [A, h, randomBytes(32).toString("hex"), randomBytes(16).toString("hex"), PARAMS, POLICY]))?.ok === true, "the right code still resets (complete_coin_pin_reset restated)");
const a3 = await begin(A, "transfer");
ok((await rpc("select transfer_coins_with_pin($1, $2, decode($3, 'hex'), $4, 100, 't-a-trunc', null, $5::jsonb, $6::jsonb)", [A, a3.attempt_id, keys[A].slice(0, 62), wB, TRANSFER, POLICY]))?.reason === "authorization_failed", "a truncated key is refused");
await invariants("end");

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
