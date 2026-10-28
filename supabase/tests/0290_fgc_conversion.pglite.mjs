// 0290 (Frenz Gift Coin Part 2) — the FGC wallet and the FC <-> FGC conversion engine, against the REAL functions in
// PGlite. Run like the other coin suites (from a folder where @electric-sql/pglite is installed, next to
// credit_wallet.shared.mjs):
//   node 0290_fgc_conversion.pglite.mjs <repo>/supabase/migrations [--mutant=<name>]
//
// Builds the wallet (credit_wallet.shared.mjs) with Supabase's default grants (every new table and function granted to
// anon / authenticated, as the platform does, so the migrations' own revokes are what is tested), applies 0278–0284
// twice each, then 0290 twice. Pinned, with test-only rules (never production values):
//   FC -> FGC and FGC -> FC: amounts, the fee in output units, the three ledger rows, the record, the fee income
//   exact integer rounding (floor gross, ceil percent fee) against a BigInt reference, the provable row constraints
//   insufficient / pending-not-spendable / below_fee / out of range / daily limit / suspended — nothing written
//   missing and invalid rules (every field), rules_changed, replays (same answer, never twice, conflict on a new body)
//   atomicity (a failure after the debit leaves nothing), historical rates kept, append-only records
//   the arbitrage check at its boundaries, and the SQL verdict equal to an exhaustive round-trip search
//   RLS and grants as anon / authenticated, the FGC guard (and that the FC writer flag cannot write FGC, or back)
//   FC regression after 0290: deposit (hold + release), transfer + fee, withdrawal + fee, and every wallet reconciling
//
// --mutant=<name> breaks one protection and the run must FAIL:
//   no-gift-guard   the FGC balance / ledger guard triggers are dropped             -> a direct FGC write succeeds
//   shared-writer   the FGC guard accepts the FC writer flag                       -> an FC writer can mint FGC
//   no-arbitrage    rules with a round-trip factor above 1 are accepted             -> a profitable round trip
//   breakeven       K = 1 with no flat fee is accepted                             -> a round trip returns all of it
//   spend-pending   a conversion spends balance instead of available               -> pending FC converts
//   no-replay       both replay checks are removed                                 -> a retry is not answered
//   no-daily        the rolling 24-hour limit is not checked                       -> the limit is passed
import { readFileSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";

import { closeoutMigration, coinMigration, depositMigration, depositPrerequisites, giftMigration, migration, pinMigration, scopeMigration, split, STUB, U, walletStatements } from "./credit_wallet.shared.mjs";

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
const read = (f) => readFileSync(`${dir}/${f}`, "utf8");
const stmt = (file, startsWith) => { const s = split(read(file)).find((x) => x.trim().startsWith(startsWith)); if (!s) throw new Error(`${file}: no statement ${startsWith}`); return s; };
const hold284 = (d) => split(readFileSync(`${d}/0284_frenz_coin_deposit_hold.sql`, "utf8"));

await run(split(STUB));
// Supabase's defaults: new tables and functions are granted to the API roles, so only a migration's revoke protects them
await run([
  "grant usage on schema auth to anon, authenticated, service_role",
  "alter default privileges in schema public grant all on tables to anon, authenticated, service_role",
  "alter default privileges in schema public grant all on functions to anon, authenticated, service_role",
]);
await run(walletStatements(dir));
await run(depositPrerequisites(dir));
// the reward and affiliate triggers fire on a settled deposit: present, as in the 0280 / 0284 suites
await run([
  "create table public.share_links (token text primary key)",
  stmt("0187_rewards_referrals.sql", "create table if not exists public.referral_attributions"),
  stmt("0255_rewards_v2.sql", "create table if not exists public.affiliate_accounts"),
  stmt("0255_rewards_v2.sql", "create table if not exists public.affiliate_commissions"),
  stmt("0255_rewards_v2.sql", "create or replace function public.queue_affiliate_commission("),
  "create or replace function public.process_reward_event(p_event text, p_actor uuid, p_source_type text, p_source_id text, p_metadata jsonb default '{}'::jsonb) returns jsonb language plpgsql as $$ begin return '[]'::jsonb; end $$",
]);
for (const m of [migration, coinMigration, depositMigration, scopeMigration, pinMigration, closeoutMigration, hold284]) { await run(m(dir)); await run(m(dir)); }
await run(giftMigration(dir));
await run(giftMigration(dir));
await db.exec(`insert into auth.users (id, email, email_confirmed_at) select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'u' || g || '@t.test', now() from generate_series(1, 60) g`);
await db.exec(`insert into public.profiles (id) select id from auth.users`);

// ── mutants ──
const fnBody = async (name) => (await one("select pg_get_functiondef(p.oid) d from pg_proc p where p.proname = $1", [name])).d;
const mutate = async (name, from, to) => { const b = await fnBody(name); const m = b.split(from).join(to); if (m === b) throw new Error(`mutant on ${name} did not apply`); await db.exec(m); };
if (MUTANT === "no-gift-guard") await db.exec("drop trigger ai_product_balances_gift_guard on public.ai_product_balances; drop trigger ai_product_ledger_gift_guard on public.ai_product_ledger");
if (MUTANT === "shared-writer") await mutate("gift_wallet_guard", "current_setting('frenz.gift_writer', true)", "current_setting('frenz.coin_writer', true)");
if (MUTANT === "no-arbitrage") await mutate("fgc_conversion_rules_check", "if kn > kd then return 'config_arbitrage'", "if false then return 'config_arbitrage'");
if (MUTANT === "breakeven") await mutate("fgc_conversion_rules_check", "if kn = kd and", "if false and");
if (MUTANT === "spend-pending") await mutate("convert_fgc", "if v_bal - v_pend < p_amount then", "if v_bal < p_amount then");
if (MUTANT === "no-replay") await mutate("convert_fgc", "if v_ex.id is not null then", "if false then");
if (MUTANT === "no-daily") await mutate("convert_fgc", "if v_sum + p_amount > (v_leg ->> 'dailyMaxIn')::bigint then", "if false then");

// ── test-only rules (never production values) ──
const LEG_A = { rateNum: 1, rateDen: 1, feeBp: 200, feeFlat: 0, minIn: 100, maxIn: 1_000_000, dailyMaxIn: 3_000_000 };
const LEG_B = { rateNum: 1, rateDen: 1, feeBp: 500, feeFlat: 1, minIn: 100, maxIn: 1_000_000, dailyMaxIn: 3_000_000 };
const R1 = { version: 1, fcToFgc: LEG_A, fgcToFc: LEG_B };
const ADMIN = U(59);
const J = (o) => (o === null ? null : JSON.stringify(o));
// an exception (a constraint or guard behind the function) is an answer too: never a crash, and never "ok"
const convert = (u, dirn, amount, key, rules = R1, expected = null) => rpc("select convert_fgc($1, $2, $3, $4, $5::jsonb, $6)", [u, dirn, amount, key, J(rules), expected]).catch((e) => ({ ok: false, reason: "exception", error: e.message }));
const fund = (u, cents, ref, pending = false) => rpc("select adjust_coin_balance($1, $2, $3, 'test funding', $4, $5)", [u, cents, ref, ADMIN, pending]);
const wallet = async (u, product) => (await one("select balance_cents::text b, pending_cents::text p, held_cents::text h, currency from ai_product_balances where user_id = $1 and product = $2", [u, product])) ?? null;
const bal = async (u, product) => { const w = await wallet(u, product); return w ? Number(w.b) : 0; };
const count = async (sql, params = []) => Number((await one(sql, params)).n);
const check = (rules) => rpc("select fgc_conversion_rules_check($1::jsonb)", [J(rules)]);

/** The BigInt reference of one leg (the header of 0290, written again independently). */
const refQuote = (x, leg) => {
  const X = BigInt(x), n = BigInt(leg.rateNum), d = BigInt(leg.rateDen);
  const gross = (X * n) / d;
  const pct = (gross * BigInt(leg.feeBp) + 9999n) / 10000n;
  const fee = pct + BigInt(leg.feeFlat);
  return { gross, remainder: X * n - gross * d, percent: pct, fee, net: gross - fee };
};

/** Every wallet equals its ledger, nothing is negative, every conversion's rows and fee income agree with its record. */
const invariants = async (label) => {
  const bad = await q(`select b.user_id, b.product from ai_product_balances b
    left join (select user_id, product, sum(delta_cents) s, coalesce(sum(delta_cents) filter (where status = 'reserved' and delta_cents > 0), 0) pend,
                      coalesce(-sum(delta_cents) filter (where status = 'reserved' and delta_cents < 0), 0) held from ai_product_ledger group by user_id, product) l
      on l.user_id = b.user_id and l.product = b.product
    where b.product in ('frenz_coin', 'frenz_gift') and (b.balance_cents <> coalesce(l.s, 0) or b.pending_cents <> coalesce(l.pend, 0) or b.held_cents <> coalesce(l.held, 0) or b.balance_cents < 0 or b.pending_cents > b.balance_cents)`);
  ok(bad.length === 0, `${label}: every FC and FGC wallet = Σ its ledger, pending / held reconcile, nothing negative`);
  const mism = await q(`select c.id from fgc_conversions c
    left join ai_product_ledger o on o.id = c.debit_ledger_id
    left join ai_product_ledger i on i.id = c.credit_ledger_id
    left join ai_product_ledger f on f.id = c.fee_ledger_id
    left join platform_fee_ledger p on p.source_ledger_id = c.fee_ledger_id
    where o.delta_cents <> -c.input_amount or o.kind <> 'conversion_out' or o.product <> case when c.direction = 'fc_to_fgc' then 'frenz_coin' else 'frenz_gift' end
       or i.delta_cents <> c.gross_output or i.kind <> 'conversion_in' or i.product <> case when c.direction = 'fc_to_fgc' then 'frenz_gift' else 'frenz_coin' end
       or (c.fee_amount > 0 and (f.delta_cents <> -c.fee_amount or f.kind <> 'conversion_fee' or f.product <> i.product or p.amount <> c.fee_amount or p.unit <> c.fee_currency
             or p.source <> case when c.direction = 'fc_to_fgc' then 'fc_to_fgc_conversion_fee' else 'fgc_to_fc_conversion_fee' end))
       or (c.fee_amount = 0 and c.fee_ledger_id is not null)`);
  ok(mism.length === 0, `${label}: every conversion's debit, credit, fee row and fee income match its record`);
  const fees = await one(`select (select coalesce(sum(fee_amount), 0) from fgc_conversions)::text c, (select coalesce(sum(amount), 0) from platform_fee_ledger where source like '%conversion_fee')::text p,
                                 (select coalesce(-sum(delta_cents), 0) from ai_product_ledger where kind = 'conversion_fee')::text l,
                                 (select count(*) from platform_fee_ledger where source like '%conversion_fee')::int pc, (select count(*) from fgc_conversions where fee_amount > 0)::int cc`);
  ok(fees.c === fees.p && fees.p === fees.l && fees.pc === fees.cc, `${label}: conversion fee income ${fees.p} = Σ record fees ${fees.c} = Σ fee rows ${fees.l}, one income row per fee (${fees.pc}/${fees.cc})`);
};

const A = U(1), B = U(2), C = U(3), D = U(4), E = U(5), F = U(6), G = U(7), H = U(8);

// ═══ 1 · FC -> FGC ═══
await fund(A, 10_000, "fund-a-1");
let r = await convert(A, "fc_to_fgc", 1_000, "key-a-0001");
ok(r?.ok === true && r.duplicate === false && r.input === 1000 && r.gross === 1000 && r.fee === 20 && r.net === 980 && r.fee_currency === "FGC" && r.version === 1, "FC -> FGC: 1000 cents at 1:1 with 2% gives gross 1000, fee 20 FGC, net 980");
ok((await bal(A, "frenz_coin")) === 9000 && (await bal(A, "frenz_gift")) === 980, "FC debited 1000, FGC credited 980");
const fgcRow = await wallet(A, "frenz_gift");
ok(fgcRow.currency === "FGC" && fgcRow.p === "0", "the FGC wallet is in FGC, nothing pending");
let rows = await q("select product, kind, delta_cents::int d, balance_after_cents::int a, currency from ai_product_ledger where reference in ($1, $2) order by kind", [`fgc-conversion:${r.conversion_id}`, `fgc-conversion-fee:${r.conversion_id}`]);
ok(JSON.stringify(rows) === JSON.stringify([
  { product: "frenz_gift", kind: "conversion_fee", d: -20, a: 980, currency: "FGC" },
  { product: "frenz_gift", kind: "conversion_in", d: 1000, a: 1000, currency: "FGC" },
  { product: "frenz_coin", kind: "conversion_out", d: -1000, a: 9000, currency: "USD" },
]), "three ledger rows: FC conversion_out -1000, FGC conversion_in +1000, FGC conversion_fee -20, each with its balance after");
let rec = await one("select * from fgc_conversions where id = $1", [r.conversion_id]);
ok(rec.user_id === A && rec.direction === "fc_to_fgc" && rec.input_currency === "USD" && rec.output_currency === "FGC" && Number(rec.rate_num) === 1 && Number(rec.rate_den) === 1
   && Number(rec.rounding_remainder) === 0 && rec.fee_bp === 200 && Number(rec.fee_percent_part) === 20 && Number(rec.fee_flat_part) === 0 && rec.fee_currency === "FGC"
   && Number(rec.config_version) === 1 && rec.status === "completed" && rec.idempotency_key === "key-a-0001" && rec.rules_snapshot.fcToFgc.feeBp === 200 && rec.rules_snapshot.quote.net === 980
   && rec.debit_ledger_id && rec.credit_ledger_id && rec.fee_ledger_id && rec.created_at, "the record keeps id, member, direction, currencies, rate, remainder, fee parts, version, snapshot, key, status, time and ledger ids");
const fee1 = await one("select source, amount::int a, unit, payer_id from platform_fee_ledger where source_ledger_id = $1", [rec.fee_ledger_id]);
ok(fee1?.source === "fc_to_fgc_conversion_fee" && fee1.a === 20 && fee1.unit === "FGC" && fee1.payer_id === A, "the fee is FGC fee income (fc_to_fgc_conversion_fee, 20 FGC), once");
ok((await count("select count(*) n from financial_audit_log where action = 'fgc_conversion' and target_id = $1", [r.conversion_id])) === 1, "the conversion is in the financial audit log");

// ═══ 2 · FGC -> FC (FGC the member bought with their own FC converts back) ═══
r = await convert(A, "fgc_to_fc", 500, "key-a-0002");
ok(r?.ok === true && r.gross === 500 && r.fee === 26 && r.net === 474 && r.fee_currency === "USD", "FGC -> FC: 500 FGC at 1:1 with 5% + 1 gives gross 500, fee 26 cents (25 + 1 flat), net 474 cents");
ok((await bal(A, "frenz_gift")) === 480 && (await bal(A, "frenz_coin")) === 9474, "FGC debited 500, FC credited 474");
const fee2 = await one("select source, amount::int a, unit from platform_fee_ledger p join fgc_conversions c on c.fee_ledger_id = p.source_ledger_id where c.id = $1", [r.conversion_id]);
ok(fee2?.source === "fgc_to_fc_conversion_fee" && fee2.a === 26 && fee2.unit === "USD", "its fee is FC fee income (fgc_to_fc_conversion_fee, 26 cents, USD)");
await invariants("after both directions");

// ═══ 3/4 · fees, integer precision, rounding ═══
const R7 = { version: 7, fcToFgc: { rateNum: 7, rateDen: 3, feeBp: 333, feeFlat: 2, minIn: 1, maxIn: 50_000_000_000, dailyMaxIn: 900_000_000_000 }, fgcToFc: { rateNum: 3, rateDen: 7, feeBp: 100, feeFlat: 0, minIn: 1, maxIn: 50_000_000_000, dailyMaxIn: 900_000_000_000 } };
ok((await check(R7)) === null, "odd rates 7/3 and 3/7 with fees are valid rules");
let mismatch = 0;
const samples = [1, 2, 3, 4, 5, 6, 7, 99, 100, 101, 299, 300, 301, 1001, 2999, 3001, 9999, 10_000, 123_457, 999_999, 1_000_001, 49_999_999_999, 50_000_000_000];
for (let i = 0; i < 200; i++) samples.push(1 + ((i * 7_919_993) % 49_999_999_999));
for (const leg of [R7.fcToFgc, R7.fgcToFc, LEG_A, LEG_B]) {
  for (const x of samples) {
    const sql = await rpc("select fgc_conversion_quote($1, $2::jsonb)", [x, J(leg)]);
    const ref = refQuote(x, leg);
    if (BigInt(sql.gross) !== ref.gross || BigInt(sql.remainder) !== ref.remainder || BigInt(sql.percent) !== ref.percent || BigInt(sql.fee) !== ref.fee || BigInt(sql.net) !== ref.net) { mismatch++; if (mismatch < 4) console.log("  quote mismatch", x, leg, sql, ref); }
  }
}
ok(mismatch === 0, `fgc_conversion_quote equals the BigInt reference on ${samples.length * 4} amounts (floor gross, exact remainder, ceil percent fee)`);
await fund(B, 1_000_000_000, "fund-b-1");
r = await convert(B, "fc_to_fgc", 1001, "key-b-0001", R7);
ok(r?.ok === true && r.gross === 2335 && r.remainder === 2 && r.fee === 80 && r.net === 2255, "1001 cents at 7/3: gross floor(7007/3) = 2335 (remainder 2), fee ceil(2335 × 3.33%) = 78 + 2 = 80, net 2255");
r = await convert(B, "fgc_to_fc", 2255, "key-b-0002", R7);
ok(r?.ok === true && r.gross === 966 && r.remainder === 3 && r.fee === 10 && r.net === 956, "2255 FGC at 3/7: gross 966 (remainder 3), fee ceil(9.66) = 10, net 956 — the round trip lost 45 cents");
r = await convert(B, "fc_to_fgc", 300_000_000, "key-b-0003", R7);
const big = refQuote(300_000_000, R7.fcToFgc);
ok(r?.ok === true && BigInt(r.gross) === big.gross && BigInt(r.net) === big.net, `a large amount is exact (gross ${big.gross}, net ${big.net})`);
ok((await throws("insert into fgc_conversions (id, user_id, direction, input_currency, input_amount, output_currency, rate_num, rate_den, gross_output, rounding_remainder, fee_bp, fee_percent_part, fee_flat_part, fee_amount, fee_currency, net_output, config_version, rules_snapshot, idempotency_key, debit_ledger_id, credit_ledger_id, fee_ledger_id) values (gen_random_uuid(), $1, 'fc_to_fgc', 'USD', 1001, 'FGC', 7, 3, 2336, 0, 333, 78, 2, 80, 'FGC', 2256, 7, '{}', 'forged-1', gen_random_uuid(), gen_random_uuid(), gen_random_uuid())", [B])) !== null,
   "a record whose gross is not the exact floor is refused by the table itself");
ok((await throws("insert into fgc_conversions (id, user_id, direction, input_currency, input_amount, output_currency, rate_num, rate_den, gross_output, rounding_remainder, fee_bp, fee_percent_part, fee_flat_part, fee_amount, fee_currency, net_output, config_version, rules_snapshot, idempotency_key, debit_ledger_id, credit_ledger_id, fee_ledger_id) values (gen_random_uuid(), $1, 'fc_to_fgc', 'USD', 1001, 'FGC', 7, 3, 2335, 2, 333, 77, 2, 79, 'FGC', 2256, 7, '{}', 'forged-2', gen_random_uuid(), gen_random_uuid(), gen_random_uuid())", [B])) !== null,
   "a record whose percent fee is rounded down is refused by the table itself");
const tooBig = { ...R7, fcToFgc: { ...R7.fcToFgc, rateNum: 999_999_999, rateDen: 1, maxIn: 99_999_999_999 } };
ok(String(await check(tooBig)).startsWith("config_invalid:fcToFgc.range"), "rules whose largest conversion would pass 2^53 - 1 are refused (config_invalid ... range)");

// ═══ 5/9 · insufficient balance, pending, negative-balance prevention ═══
await fund(C, 1_000, "fund-c-1");
await fund(C, 5_000, "fund-c-pending", true);
const before = await count("select count(*) n from ai_product_ledger");
r = await convert(C, "fc_to_fgc", 1_001, "key-c-0001");
ok(r?.ok === false && r.reason === "insufficient" && r.available === 1000, "1001 from 1000 available (5000 more pending) is refused: insufficient");
ok((await count("select count(*) n from ai_product_ledger")) === before && (await bal(C, "frenz_gift")) === 0, "nothing written on a refusal");
r = await convert(C, "fc_to_fgc", 1_000, "key-c-0002");
ok(r?.ok === true && (await bal(C, "frenz_coin")) === 5000 && Number((await wallet(C, "frenz_coin")).p) === 5000, "exactly the available 1000 converts, the pending 5000 is untouched");
r = await convert(C, "fc_to_fgc", 100, "key-c-0003");
ok(r?.ok === false && r.reason === "insufficient", "with only pending coins left, nothing more converts");
r = await convert(C, "fgc_to_fc", 981, "key-c-0004");
ok(r?.ok === false && r.reason === "insufficient" && r.available === 980, "FGC -> FC: more FGC than the wallet holds is refused");
ok((await throws("select set_config('frenz.coin_writer', 'on', false), set_config('frenz.gift_writer', 'on', false)")) === null
   && (await throws("update ai_product_balances set balance_cents = -1 where user_id = $1 and product = 'frenz_gift'", [C])) !== null, "even a writer cannot take an FGC balance below zero (constraint)");
ok((await throws("update ai_product_balances set pending_cents = balance_cents + 1 where user_id = $1 and product = 'frenz_gift'", [C])) !== null, "pending can never exceed the FGC balance (constraint)");
ok((await throws("update ai_product_balances set currency = 'USD' where user_id = $1 and product = 'frenz_gift'", [C])) !== null, "an FGC wallet cannot be relabelled USD (constraint)");
ok((await throws("update ai_product_balances set withdrawable_cents = 1 where user_id = $1 and product = 'frenz_gift'", [C])) !== null, "an FGC wallet has no withdrawable part (constraint)");
await db.exec("select set_config('frenz.coin_writer', 'off', false), set_config('frenz.gift_writer', 'off', false)");
await fund(D, 150, "fund-d-1");
r = await convert(D, "fc_to_fgc", 99, "key-d-0001");
ok(r?.ok === false && r.reason === "amount_out_of_range" && r.min === 100, "below the minimum: amount_out_of_range");
r = await convert(D, "fc_to_fgc", 1_000_001, "key-d-0002");
ok(r?.ok === false && r.reason === "amount_out_of_range", "above the maximum: amount_out_of_range");
const FLATTY = { ...R1, version: 2, fcToFgc: { ...LEG_A, feeFlat: 150 } };
r = await convert(D, "fc_to_fgc", 150, "key-d-0003", FLATTY);
ok(r?.ok === false && r.reason === "below_fee", "a conversion whose fee eats the whole output: below_fee, nothing written");
ok((await bal(D, "frenz_coin")) === 150 && (await bal(D, "frenz_gift")) === 0, "D's wallets are untouched");
for (const [why, args] of [["no member", [null, "fc_to_fgc", 100, "key-x-0001"]], ["a bad direction", [D, "sideways", 100, "key-x-0002"]], ["zero", [D, "fc_to_fgc", 0, "key-x-0003"]], ["negative", [D, "fc_to_fgc", -5, "key-x-0004"]], ["no key", [D, "fc_to_fgc", 100, ""]], ["an 81-character key", [D, "fc_to_fgc", 100, "k".repeat(81)]]]) {
  ok((await convert(...args))?.reason === "invalid", `invalid request refused: ${why}`);
}

// ═══ 6 · missing and invalid configuration ═══
await fund(E, 50_000, "fund-e-1");
const ledgerBefore = await count("select count(*) n from ai_product_ledger");
r = await convert(E, "fc_to_fgc", 1_000, "key-e-0001", null);
ok(r?.ok === false && r.reason === "config_missing", "no rules: config_missing");
const breaks = [
  ["a string", "nope"], ["no version", { fcToFgc: LEG_A, fgcToFc: LEG_B }], ["version 0", { ...R1, version: 0 }], ["fractional version", { ...R1, version: 1.5 }],
  ["no fgcToFc leg", { version: 1, fcToFgc: LEG_A }], ["rateDen 0", { ...R1, fcToFgc: { ...LEG_A, rateDen: 0 } }], ["negative rateNum", { ...R1, fcToFgc: { ...LEG_A, rateNum: -1 } }],
  ["fractional rate", { ...R1, fcToFgc: { ...LEG_A, rateNum: 1.5 } }], ["rate as a string", { ...R1, fcToFgc: { ...LEG_A, rateNum: "1" } }], ["feeBp 5001", { ...R1, fgcToFc: { ...LEG_B, feeBp: 5001 } }],
  ["negative flat fee", { ...R1, fgcToFc: { ...LEG_B, feeFlat: -1 } }], ["minIn 0", { ...R1, fcToFgc: { ...LEG_A, minIn: 0 } }], ["max below min", { ...R1, fcToFgc: { ...LEG_A, minIn: 500, maxIn: 499 } }],
  ["daily below min", { ...R1, fgcToFc: { ...LEG_B, dailyMaxIn: 99 } }], ["missing dailyMaxIn", { ...R1, fgcToFc: { rateNum: 1, rateDen: 1, feeBp: 500, feeFlat: 1, minIn: 100, maxIn: 1000 } }],
  ["rateNum over 9 digits", { ...R1, fcToFgc: { ...LEG_A, rateNum: 1_000_000_000 } }],
];
for (const [why, rules] of breaks) {
  const out = await rpc("select convert_fgc($1, 'fc_to_fgc', 1000, $2, $3::jsonb)", [E, `key-e-${why.replace(/\W/g, "").slice(0, 20)}`, JSON.stringify(rules)]);
  ok(out?.ok === false && out.reason === "config_invalid" && String(out.detail).startsWith("config_invalid"), `invalid rules (${why}) refused: ${out?.detail}`);
}
ok((await count("select count(*) n from ai_product_ledger")) === ledgerBefore && (await bal(E, "frenz_coin")) === 50_000, "no refused configuration moved anything");
r = await convert(E, "fc_to_fgc", 1_000, "key-e-0002", R1, 9);
ok(r?.ok === false && r.reason === "rules_changed" && r.version === 1, "the member was shown version 9, the rules are version 1: rules_changed, nothing moves");
r = await convert(E, "fc_to_fgc", 1_000, "key-e-0003", R1, 1);
ok(r?.ok === true, "the version they were shown matches: it converts");

// ═══ 7 · duplicate requests ═══
const n0 = await count("select count(*) n from fgc_conversions where user_id = $1", [E]);
const fc0 = await bal(E, "frenz_coin");
const again = await convert(E, "fc_to_fgc", 1_000, "key-e-0003", R1, 1);
ok(again?.ok === true && again.duplicate === true && again.conversion_id === r.conversion_id && again.net === r.net, "the same key answers the first conversion (same id, same net), marked duplicate");
ok((await count("select count(*) n from fgc_conversions where user_id = $1", [E])) === n0 && (await bal(E, "frenz_coin")) === fc0, "and converts nothing again");
const R1b = { ...R1, version: 5, fcToFgc: { ...LEG_A, rateNum: 2 } };
const later = await convert(E, "fc_to_fgc", 1_000, "key-e-0003", R1b);
ok(later?.ok === true && later.duplicate === true && later.net === r.net && later.version === 1, "a replay after the rules changed still answers the original (version 1, original net)");
const gone = await convert(E, "fc_to_fgc", 1_000, "key-e-0003", null);
ok(gone?.ok === true && gone.duplicate === true && gone.conversion_id === r.conversion_id, "a replay after the rules were removed still answers the original");
ok((await convert(E, "fc_to_fgc", 2_000, "key-e-0003"))?.reason === "idempotency_conflict", "the same key with another amount: idempotency_conflict");
ok((await convert(E, "fgc_to_fc", 1_000, "key-e-0003"))?.reason === "idempotency_conflict", "the same key in the other direction: idempotency_conflict");
ok((await convert(F, "fc_to_fgc", 1_000, "key-e-0003"))?.reason !== "idempotency_conflict", "keys are per member: another member's same key is not a replay");
ok((await count("select count(*) n from platform_fee_ledger p join fgc_conversions c on c.fee_ledger_id = p.source_ledger_id where c.id = $1", [r.conversion_id])) === 1, "one fee income row for the conversion, however often it was replayed");

// ═══ 8 · limits under repetition (real concurrency: fgc_conversion_concurrency.pg.mjs) ═══
await fund(G, 5_000_000, "fund-g-1");
let okCount = 0;
for (let i = 0; i < 5; i++) if ((await convert(G, "fc_to_fgc", 1_000_000, `key-g-${String(i).padStart(4, "0")}`))?.ok) okCount++;
ok(okCount === 3, `daily limit 3,000,000 with 1,000,000 conversions: exactly 3 of 5 succeed (${okCount})`);
r = await convert(G, "fc_to_fgc", 100, "key-g-0099");
ok(r?.ok === false && r.reason === "daily_limit" && r.used === 3_000_000, "the next is refused with what was used");
ok((await convert(G, "fgc_to_fc", 100_000, "key-g-0100"))?.ok === true, "the limit is per direction: FGC -> FC still converts");

// ═══ suspended / restricted ═══
await db.query("update profiles set is_suspended = true where id = $1", [H]);
await fund(H, 10_000, "fund-h-1");
ok((await convert(H, "fc_to_fgc", 1_000, "key-h-0001"))?.reason === "suspended", "a suspended member cannot convert");
await db.query("update profiles set is_suspended = false where id = $1", [H]);
await db.query("insert into reward_profiles (user_id, restricted) values ($1, true) on conflict (user_id) do update set restricted = true", [H]);
ok((await convert(H, "fc_to_fgc", 1_000, "key-h-0002"))?.reason === "restricted", "a restricted member cannot convert");

// ═══ 10 · atomic debit and credit ═══
const I = U(9);
await fund(I, 10_000, "fund-i-1");
await db.exec(`create function public.boom() returns trigger language plpgsql as $$ begin if new.idempotency_key = 'boom-key-0001' then raise exception 'boom after the debit'; end if; return new; end $$;
  create trigger fgc_boom before insert on public.fgc_conversions for each row execute function public.boom()`);
const ledgerI = await count("select count(*) n from ai_product_ledger where user_id = $1", [I]);
const feeRows = await count("select count(*) n from platform_fee_ledger");
const err = await throws("select convert_fgc($1, 'fc_to_fgc', 1000, 'boom-key-0001', $2::jsonb)", [I, J(R1)]);
ok(err !== null && /boom/.test(err), "a failure at the last step (after the debit, the credit and the fee) aborts the call");
ok((await bal(I, "frenz_coin")) === 10_000 && (await bal(I, "frenz_gift")) === 0 && (await count("select count(*) n from ai_product_ledger where user_id = $1", [I])) === ledgerI
   && (await count("select count(*) n from platform_fee_ledger")) === feeRows, "nothing of it remains: FC not debited, FGC not credited, no ledger row, no fee income");
await db.exec("drop trigger fgc_boom on public.fgc_conversions; drop function public.boom()");
ok((await convert(I, "fc_to_fgc", 1_000, "boom-key-0001"))?.ok === true, "the same key then converts once, normally");

// ═══ 11 · historical rates, append-only ═══
const J1 = U(10);
await fund(J1, 100_000, "fund-j-1");
const v1 = await convert(J1, "fc_to_fgc", 10_000, "key-j-0001");
const R3 = { version: 3, fcToFgc: { ...LEG_A, rateNum: 3, rateDen: 2, feeBp: 400 }, fgcToFc: { ...LEG_B, rateNum: 1, rateDen: 2 } };
ok((await check(R3)) === null, "a later rule set (3/2 and 1/2) is valid");
const v3 = await convert(J1, "fc_to_fgc", 10_000, "key-j-0002", R3);
ok(v3?.ok === true && v3.gross === 15_000 && v3.net === 14_400 && v3.version === 3, "a conversion under version 3 is priced at 3/2 with 4%");
const old = await one("select rate_num::int n, rate_den::int d, fee_bp, config_version::int v, net_output::int net, rules_snapshot from fgc_conversions where id = $1", [v1.conversion_id]);
ok(old.n === 1 && old.d === 1 && old.fee_bp === 200 && old.v === 1 && old.net === 9800 && old.rules_snapshot.version === 1, "the earlier conversion still shows 1:1, 2%, version 1, net 9800 and its own snapshot");
ok((await throws("update fgc_conversions set rate_num = 3 where id = $1", [v1.conversion_id])) !== null, "a conversion record cannot be rewritten");
ok((await throws("delete from fgc_conversions where id = $1", [v1.conversion_id])) !== null, "or deleted");
ok((await throws("update ai_product_ledger set delta_cents = -1 where id = (select debit_ledger_id from fgc_conversions where id = $1)", [v1.conversion_id])) !== null, "its ledger row cannot be rewritten");
ok((await throws("delete from ai_product_ledger where id = (select credit_ledger_id from fgc_conversions where id = $1)", [v1.conversion_id])) !== null, "or deleted");
ok((await throws("update platform_fee_ledger set amount = 1 where source = 'fc_to_fgc_conversion_fee'")) !== null, "its fee income cannot be rewritten");

// ═══ 12 · fee ledger consistency (and zero fees) ═══
const ZERO = { version: 4, fcToFgc: { ...LEG_A, feeBp: 0, feeFlat: 0, rateNum: 99, rateDen: 100 }, fgcToFc: { ...LEG_B, feeBp: 0, feeFlat: 0 } };
ok((await check(ZERO)) === null, "no fees at all is valid when the rates alone lose value (99/100 then 1/1)");
const z = await convert(J1, "fc_to_fgc", 1_000, "key-j-0003", ZERO);
ok(z?.ok === true && z.fee === 0 && z.net === 990, "a zero-fee conversion credits gross = net");
const zrec = await one("select fee_ledger_id from fgc_conversions where id = $1", [z.conversion_id]);
ok(zrec.fee_ledger_id === null && (await count("select count(*) n from ai_product_ledger where reference = $1", [`fgc-conversion-fee:${z.conversion_id}`])) === 0, "and writes no fee row and no fee income");
await invariants("after fees, zero fees, replays and a rolled-back failure");

// ═══ 13 · arbitrage ═══
const legs = (a, b, c, d, bp1 = 0, bp2 = 0, f1 = 0, f2 = 0) => ({ version: 1, fcToFgc: { ...LEG_A, rateNum: a, rateDen: b, feeBp: bp1, feeFlat: f1 }, fgcToFc: { ...LEG_B, rateNum: c, rateDen: d, feeBp: bp2, feeFlat: f2 } });
for (const [why, rules, expect] of [
  ["1:1 both ways, no fees (K = 1, breaks even)", legs(1, 1, 1, 1), "config_arbitrage"],
  ["100:1 then 1:100, no fees (K = 1)", legs(100, 1, 1, 100), "config_arbitrage"],
  ["101/100 then 100/101, no fees (K = 1)", legs(101, 100, 100, 101), "config_arbitrage"],
  ["10000/9000 with 10% then 1:1 (K = 1 exactly, no flat)", legs(10000, 9000, 1, 1, 1000, 0), "config_arbitrage"],
  ["10001/10000 then 1:1, no fees (K > 1)", legs(10001, 10000, 1, 1), "config_arbitrage"],
  ["2:1 then 1:1 with 49.99% (K > 1)", legs(2, 1, 1, 1, 0, 4999), "config_arbitrage"],
  ["1:1 both ways, a 1 bp fee (K < 1)", legs(1, 1, 1, 1, 1, 0), null],
  ["1:1 both ways, a 1-unit flat fee only (K = 1, L > 0)", legs(1, 1, 1, 1, 0, 0, 0, 1), null],
  ["10000/9000 with 10% then 1:1, a flat fee on the first leg (K = 1, L > 0)", legs(10000, 9000, 1, 1, 1000, 0, 1, 0), null],
  ["10001/10000 then 1:1 with 1 bp (K = 0.99999999)", legs(10001, 10000, 1, 1, 0, 1), null],
  ["2:1 then 1:1 with 50% (K = 1, no flat)", legs(2, 1, 1, 1, 0, 5000), "config_arbitrage"],
]) {
  ok((await check(rules)) === expect, `arbitrage check: ${why} -> ${expect ?? "valid"}`);
}
r = await convert(J1, "fc_to_fgc", 1_000, "key-j-arb1", legs(1, 1, 1, 1));
ok(r?.ok === false && r.reason === "config_invalid" && r.detail === "config_arbitrage", "a conversion under arbitrage-prone rules is refused with config_arbitrage, nothing moves");

// the SQL verdict against an exhaustive round-trip search (every x up to 3000, both directions, integer rounding)
const roundTrip = (x, l1, l2) => { const y = refQuote(x, l1).net; if (y <= 0n) return -1n; const zz = refQuote(Number(y), l2).net; return zz; };
let disagree = 0;
let seed = 12345;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
for (let t = 0; t < 120; t++) {
  const l1 = { ...LEG_A, rateNum: 1 + rnd(12), rateDen: 1 + rnd(12), feeBp: [0, 0, 1, 50, 100][rnd(5)], feeFlat: [0, 0, 0, 1][rnd(4)] };
  const l2 = { ...LEG_B, rateNum: 1 + rnd(12), rateDen: 1 + rnd(12), feeBp: [0, 0, 1, 50, 100][rnd(5)], feeFlat: [0, 0, 0, 1][rnd(4)] };
  const verdict = await check({ version: 1, fcToFgc: l1, fgcToFc: l2 });
  let found = false;
  for (let x = 1; x <= 3000 && !found; x++) { if (roundTrip(x, l1, l2) >= BigInt(x) || roundTrip(x, l2, l1) >= BigInt(x)) found = true; }
  // valid => no amount breaks even. (Refused with nothing found up to 3000 is allowed only when the bound says a large amount would.)
  if (verdict === null && found) { disagree++; console.log("  valid rules with a non-losing round trip", l1, l2); }
  if (verdict === "config_arbitrage" && !found) {
    const k = BigInt(l1.rateNum * l2.rateNum) * BigInt(10000 - l1.feeBp) * BigInt(10000 - l2.feeBp);
    const kd = BigInt(l1.rateDen * l2.rateDen) * 100000000n;
    if (k < kd) { disagree++; console.log("  refused rules with K < 1", l1, l2); }
  }
}
ok(disagree === 0, "on 120 random rule sets, no valid one has any round trip (x ≤ 3000, both directions) returning at least x, and every refused one has K ≥ 1");

// ═══ 14 · RLS and authorization ═══
const asRole = async (role, uid, fn) => { await db.exec(`set role ${role}`); await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]); try { return await fn(); } finally { await db.exec("reset role"); } };
for (const role of ["anon", "authenticated"]) {
  ok(/permission denied/.test(await asRole(role, A, () => throws("select convert_fgc($1, 'fc_to_fgc', 100, 'key-rls-0001', $2::jsonb)", [A, J(R1)])) ?? ""), `${role} cannot call convert_fgc`);
  ok(/permission denied/.test(await asRole(role, A, () => throws("select adjust_gift_balance($1, 1000, 'rls-1', 'x', $1)", [A])) ?? ""), `${role} cannot call adjust_gift_balance`);
  ok(/permission denied/.test(await asRole(role, A, () => throws("select ensure_gift_wallet($1)", [A])) ?? ""), `${role} cannot call ensure_gift_wallet`);
  ok(/permission denied/.test(await asRole(role, A, () => throws("select * from fgc_conversions")) ?? ""), `${role} cannot read fgc_conversions`);
  ok(/permission denied/.test(await asRole(role, A, () => throws("insert into fgc_conversions (id, user_id) values (gen_random_uuid(), $1)", [A])) ?? ""), `${role} cannot write fgc_conversions`);
}
const mine = await asRole("authenticated", A, () => q("select distinct user_id from ai_product_ledger where product = 'frenz_gift'"));
ok(mine.length === 1 && mine[0].user_id === A, "a member reads only their own FGC ledger rows (RLS)");
const theirs = await asRole("authenticated", D, () => q("select user_id from ai_product_balances where user_id = $1", [A]));
ok(theirs.length === 0, "and never another member's balances");
ok((await asRole("authenticated", A, () => throws("insert into ai_product_ledger (user_id, product, kind, delta_cents, balance_after_cents, currency) values ($1, 'frenz_gift', 'adjustment', 100000, 100000, 'FGC')", [A]))) !== null, "a member cannot insert an FGC ledger row");
await asRole("authenticated", A, () => q("update ai_product_balances set balance_cents = 999999 where user_id = $1 and product = 'frenz_gift'", [A]).catch(() => null));
ok((await bal(A, "frenz_gift")) === 480, "a member's update of their own FGC balance changes nothing");
// the guard: the service role (or any writer) without the FGC writer flag
ok((await throws("update ai_product_balances set balance_cents = balance_cents + 100 where user_id = $1 and product = 'frenz_gift'", [A])) !== null, "a direct FGC balance write without the gift writer flag is refused (guard)");
ok((await throws("insert into ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference) values ($1, 'frenz_gift', 'adjustment', 'settled', 100, 580, 'FGC', 'forged')", [A])) !== null, "a direct FGC ledger insert without the flag is refused (guard)");
await db.exec("select set_config('frenz.coin_writer', 'on', false)");
ok((await throws("update ai_product_balances set balance_cents = balance_cents + 100 where user_id = $1 and product = 'frenz_gift'", [A])) !== null, "the FC writer flag alone cannot write FGC");
await db.exec("select set_config('frenz.coin_writer', 'off', false), set_config('frenz.gift_writer', 'on', false)");
ok((await throws("update ai_product_balances set balance_cents = balance_cents + 100 where user_id = $1 and product = 'frenz_coin'", [A])) !== null, "and the FGC writer flag alone cannot write FC (0279 guard unchanged)");
await db.exec("select set_config('frenz.gift_writer', 'off', false)");
ok((await throws("select credit_product_balance($1, 'frenz_gift', 100, 'recharge', 'forged-recharge', 'FGC')", [A])) !== null, "an AI-credit writer naming frenz_gift is refused");
ok((await throws("insert into ai_product_ledger (user_id, product, kind, status, delta_cents, balance_after_cents, currency, reference) values ($1, 'character_replace', 'conversion_in', 'settled', 100, 100, 'CREDIT', 'forged-cr')", [A])) !== null, "AI Credits can never carry a conversion row (constraint)");
ok((await bal(A, "frenz_gift")) === 480 && (await bal(A, "frenz_coin")) === 9474, "A's wallets are exactly as the conversions left them");
// administrative corrections: audited, once
const adj = await rpc("select adjust_gift_balance($1, 250, 'corr-a-1', 'goodwill', $2)", [A, ADMIN]);
const adj2 = await rpc("select adjust_gift_balance($1, 250, 'corr-a-1', 'goodwill', $2)", [A, ADMIN]);
ok(adj?.ok === true && adj2?.duplicate === true && (await bal(A, "frenz_gift")) === 730, "an FGC correction applies once per reference");
ok((await count("select count(*) n from financial_audit_log where action = 'gift_adjustment' and reference = 'corr-a-1' and actor_id = $1", [ADMIN])) === 1, "and is in the audit log with the admin");
ok((await rpc("select adjust_gift_balance($1, -100000, 'corr-a-2', 'too much', $2)", [A, ADMIN]))?.reason === "insufficient", "a correction never takes FGC below zero");
const blk = await rpc("select account_financial_blockers($1)", [A]);
ok(blk?.ok === false && blk.reasons.includes("gift_balance"), "FGC in the wallet blocks an account purge (gift_balance)");

// ═══ 15 · FC regression after 0290: deposit, transfer, withdrawal ═══
const P = U(20), Q = U(21);
const DEP = JSON.stringify({ enabled: true, version: 1, holdHours: 0, minCents: 100, maxCents: 500000 });
const refD = "frenz_coin_dep_fw_00000000-0000-4000-8000-000000000777";
ok((await rpc("select begin_coin_deposit($1, $2, 20000, 'flutterwave', 20000, 'USD', 'dep-key-0001', $3::jsonb)", [P, refD, DEP]))?.ok === true, "FC deposit still opens");
ok((await rpc("select settle_coin_deposit($1, 'ch-777', 20000, 'USD')", [refD]))?.ok === true && Number((await wallet(P, "frenz_coin")).p) === 20000, "and settles as pending");
ok((await convert(P, "fc_to_fgc", 1_000, "key-p-0001"))?.reason === "insufficient", "a pending deposit cannot be converted");
await rpc("select release_due_coin_deposits($1, 10)", [P]);
ok(Number((await wallet(P, "frenz_coin")).p) === 0 && (await bal(P, "frenz_coin")) === 20000, "and is released as before");
const TRANSFER = JSON.stringify({ enabled: true, version: 1, percentBp: 1000, lowThresholdCents: 10000, highThresholdCents: 50000, flatBelowCents: 100, flatMidCents: 0, flatAboveCents: 500, minCents: 1, maxCents: 500000, dailyMaxCents: 10000000 });
const acct = await rpc("select ensure_wallet_number($1)", [Q]);
const tr = await rpc("select transfer_coins($1, $2, 5000, 'tr-key-0001', null, $3::jsonb)", [P, typeof acct === "string" ? acct : acct?.account_number ?? acct, TRANSFER]);
ok(tr?.ok === true && tr.fee === 600 && (await bal(P, "frenz_coin")) === 14_400 && (await bal(Q, "frenz_coin")) === 5000, "an FC transfer still charges amount + fee (5000 + 600) and credits the recipient 5000");
ok((await count("select count(*) n from platform_fee_ledger where source = 'coin_transfer_fee' and reference like $1", [`coin-transfer-fee:${tr.transfer_id}`])) === 1, "and still posts its fee income once");
const WITHDRAW = JSON.stringify({ enabled: true, version: 1, percentBp: 600, flatCents: 0, minCents: 500, maxCents: 500000, maxPerDay: 5, maxMonthCents: 100000000, requireQualification: false, requireEmailConfirmed: true, payoutCurrency: "NGN", payoutMinorPerUsd: null });
const wd = await rpc("select request_coin_withdrawal($1, 10000, 'paystack', '{}'::jsonb, 'wd-key-0001', $2::jsonb)", [P, WITHDRAW]);
ok(wd?.ok === true && wd.fee === 600 && wd.net === 9400 && (await bal(P, "frenz_coin")) === 4400 && Number((await wallet(P, "frenz_coin")).h) === 10000, "an FC withdrawal still holds the gross (6% fee from it)");
ok((await convert(P, "fc_to_fgc", 4_401, "key-p-0002"))?.reason === "insufficient", "held coins cannot be converted");
ok((await rpc("select resolve_withdrawal($1, 'approved', $2, 'ok', null)", [wd.id, ADMIN]))?.ok === true && (await rpc("select resolve_withdrawal($1, 'completed', $2, 'paid', 'ref-1')", [wd.id, ADMIN]))?.ok === true && Number((await wallet(P, "frenz_coin")).h) === 0, "and completes, settling the hold");
ok((await count("select count(*) n from platform_fee_ledger where source = 'coin_withdrawal_fee' and reference = $1", [`coin-withdrawal:${wd.id}`])) === 1, "with its fee income once");
const back = await convert(Q, "fc_to_fgc", 5_000, "key-q-0001");
const fwd = await convert(Q, "fgc_to_fc", back.net, "key-q-0002");
ok(back?.ok && fwd?.ok && (await bal(Q, "frenz_coin")) === fwd.net && fwd.net < 5000, `received FC converts to FGC and back, losing value on the round trip (${5000} -> ${back.net} FGC -> ${fwd.net} cents)`);
await invariants("after the FC regression");

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
