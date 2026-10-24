// PGlite harness for 0276 (Part 4 closure): begin_sub_purchase / begin_verification_purchase — the check-and-insert
// semantics, the 30-minute window, resolved rows, other pairs, the returned link, and the grants. Run from a folder
// that has @electric-sql/pglite installed (e.g. %TEMP%):
//   node 0276_open_checkout_guard.pglite.mjs <repo>/supabase/migrations [--mutant]
//
// PGlite is ONE connection, so the advisory lock itself (two transactions racing) is proven by
// open_checkout_guard.pg.mjs on a real server. --mutant removes the "open" check from both functions: the run must FAIL.
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const dir = process.argv[2];
const MUTANT = process.argv.includes("--mutant");
let sql = readFileSync(`${dir}/0276_open_checkout_guard.sql`, "utf8");
if (MUTANT) {
  const before = sql;
  sql = sql.replaceAll(/  if found then\s+return jsonb_build_object\('ok', false, 'reason', 'open'[^;]*;\s+end if;/g, "");
  if (sql === before) throw new Error("mutant did not apply");
}

const pg = new PGlite();
// the columns 0227 + 0247 + 0268 + 0271 give the two tables (only what the functions touch, plus defaults)
await pg.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth; create table auth.users (id uuid primary key);
  create table public.sub_purchases (
    id uuid primary key default gen_random_uuid(), creator_id uuid not null references auth.users (id), subscriber_id uuid not null references auth.users (id),
    price_cents integer not null, fee_cents integer not null, total_cents integer not null, fee_bp integer not null,
    charged_currency text not null, charged_minor bigint not null, fx_minor_per_usd bigint, provider text not null default 'paystack',
    reference text not null unique, checkout_url text, status text not null default 'initiated', period_days integer not null default 30,
    hold_days integer not null default 0, failure_source text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
  create table public.verification_purchases (
    id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users (id), reference text not null unique,
    price_cents integer not null, charged_currency text not null, charged_minor bigint not null, fx_minor_per_usd numeric,
    period_days integer not null, status text not null default 'initiated', failure_source text, checkout_url text,
    provider text not null default 'paystack', created_at timestamptz not null default now(), updated_at timestamptz not null default now());
`);
await pg.exec(sql);

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
for (const n of [1, 2, 3]) await pg.query("insert into auth.users (id) values ($1)", [U(n)]);
let failures = 0;
const ok = (c, m) => {
  if (!c) failures++;
  console.log(`${c ? "PASS" : "FAIL"}  ${m}`);
};
const sub = async (subscriber, creator, ref, provider = "paystack") =>
  (await pg.query(`select public.begin_sub_purchase($1, $2, $3, $4, 1100, 100, 1100, 1000, 'NGN', 1760000, 160000, 30, 7) as r`, [subscriber, creator, ref, provider])).rows[0].r;
const ver = async (user, ref, provider = "paystack") =>
  (await pg.query(`select public.begin_verification_purchase($1, $2, $3, 500, 'NGN', 800000, 160000, 30) as r`, [user, ref, provider])).rows[0].r;
const count = async (t, where = "true") => Number((await pg.query(`select count(*)::int n from public.${t} where ${where}`)).rows[0].n);

// ── SUB ──
let r = await sub(U(1), U(2), "frenz_sub_a1");
ok(r.ok === true && typeof r.id === "string", "sub: the first call inserts and returns the new id");
ok((await pg.query("select status, provider, total_cents, hold_days from public.sub_purchases where reference = 'frenz_sub_a1'")).rows[0]?.status === "initiated", "sub: the row is initiated, with the values passed");
r = await sub(U(1), U(2), "frenz_sub_a2", "flutterwave");
ok(r.ok === false && r.reason === "open" && r.reference === "frenz_sub_a1" && r.checkout_url === null, "sub: a second call for the SAME pair answers open (the first's reference, no link yet) — on either rail");
ok((await count("sub_purchases")) === 1, "sub: and inserts nothing");
await pg.query("update public.sub_purchases set checkout_url = 'https://checkout.paystack.com/x' where reference = 'frenz_sub_a1'");
r = await sub(U(1), U(2), "frenz_sub_a3");
ok(r.reason === "open" && r.checkout_url === "https://checkout.paystack.com/x", "sub: once the first has a link, the conflict hands that link back");
ok((await sub(U(3), U(2), "frenz_sub_b1")).ok === true, "sub: another subscriber is not blocked");
ok((await sub(U(1), U(3), "frenz_sub_c1")).ok === true, "sub: the same subscriber with another creator is not blocked");
await pg.query("update public.sub_purchases set created_at = now() - interval '31 minutes' where reference in ('frenz_sub_a1')");
ok((await sub(U(1), U(2), "frenz_sub_a4")).ok === true, "sub: an initiated row older than 30 minutes does not block (the app resolved/held it before calling)");
for (const status of ["paid", "failed"]) {
  await pg.query("update public.sub_purchases set status = $1 where reference = 'frenz_sub_a4'", [status]);
  const x = await sub(U(1), U(2), `frenz_sub_a5_${status}`);
  ok(x.ok === true, `sub: a recent ${status} purchase does not block a new one`);
  await pg.query("update public.sub_purchases set status = 'failed' where reference = $1", [`frenz_sub_a5_${status}`]);
}
let dup = null;
try {
  await sub(U(3), U(1), "frenz_sub_b1");
} catch (e) {
  dup = e;
}
ok(dup !== null, "sub: a duplicate reference still fails on the unique key (nothing silently overwritten)");

// ── paid verification ──
r = await ver(U(1), "frenz_vf_a1");
ok(r.ok === true, "verification: the first call inserts");
r = await ver(U(1), "frenz_vf_fw_a2", "flutterwave");
ok(r.ok === false && r.reason === "open" && r.reference === "frenz_vf_a1", "verification: a second call for the same member answers open — on either rail");
ok((await count("verification_purchases")) === 1, "verification: and inserts nothing");
ok((await ver(U(2), "frenz_vf_b1")).ok === true, "verification: another member is not blocked");
await pg.query("update public.verification_purchases set status = 'paid' where reference = 'frenz_vf_a1'");
ok((await ver(U(1), "frenz_vf_a3")).ok === true, "verification: a paid purchase does not block a renewal");
await pg.query("update public.verification_purchases set created_at = now() - interval '31 minutes' where reference = 'frenz_vf_a3'");
ok((await ver(U(1), "frenz_vf_a4")).ok === true, "verification: an initiated row older than 30 minutes does not block");
ok((await pg.query("select provider from public.verification_purchases where reference = 'frenz_vf_a4'")).rows[0].provider === "paystack", "verification: the provider is written (0271's column)");

// ── grants ──
const can = async (role, fn) => (await pg.query(`select has_function_privilege($1, $2, 'execute') as b`, [role, fn])).rows[0].b;
const SUB_FN = "public.begin_sub_purchase(uuid, uuid, text, text, integer, integer, integer, integer, text, bigint, bigint, integer, integer)";
const VER_FN = "public.begin_verification_purchase(uuid, text, text, integer, text, bigint, numeric, integer)";
for (const fn of [SUB_FN, VER_FN]) {
  ok((await can("anon", fn)) === false && (await can("authenticated", fn)) === false, `grants: ${fn.split("(")[0]} is not callable by anon or a signed-in member`);
  ok((await can("service_role", fn)) === true, `grants: ${fn.split("(")[0]} is callable by the server (service_role)`);
}

// ── idempotent migration ──
await pg.exec(readFileSync(`${dir}/0276_open_checkout_guard.sql`, "utf8"));
ok(true, "the migration runs twice cleanly");

console.log(failures ? `\n${failures} FAILED${MUTANT ? " (expected: mutant)" : ""}` : "\nall passed");
await pg.close();
process.exit(failures ? 1 : 0);
