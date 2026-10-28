// 0296 (Frenz Gift Coin Part 6) — several copies of a sticker in ONE send, an optional note, no PIN, against the REAL
// migrations 0278–0296 in PGlite (the Part 5 integration build, shared verbatim). Run like the other coin suites:
//   node 0296_gift_batches.pglite.mjs <repo>/supabase/migrations [--mutant=batch-no-rollback|batch-forge-note]
//
// Pinned: quantity 1 and N, each copy its own gift with its own ledger, fee and notification rows; the note trimmed,
// bounded, stored once; replay and conflicts; invalid input charges nothing; a batch failing part-way leaves nothing;
// a changed or withdrawn sticker; who may send; concurrent batches never overspend; the bubble must be the batch own;
// one announcement per batch, no note in it; rows never rewritten; members can not call the function.
import { randomBytes } from "node:crypto";
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
const rpc = async (sql, params = []) => { try { return Object.values((await one(sql, params)) ?? {})[0]; } catch (e) { return { ok: false, reason: "exception", error: e.message }; } };
const throws = async (sql, params = []) => { try { await db.query(sql, params); return null; } catch (e) { return e.message; } };
const read = (f) => readFileSync(`${dir}/${f}`, "utf8");
const stmt = (file, startsWith) => { const s = split(read(file)).find((x) => x.trim().startsWith(startsWith)); if (!s) throw new Error(`${file}: no statement ${startsWith}`); return s; };
const file = (f) => (d) => split(readFileSync(`${d}/${f}`, "utf8"));

await run(split(STUB));
await run([
  "grant usage on schema auth to anon, authenticated, service_role",
  "alter role service_role bypassrls",
  "alter default privileges in schema public grant all on tables to anon, authenticated, service_role",
  "alter default privileges in schema public grant all on functions to anon, authenticated, service_role",
  "alter table public.profiles add column is_admin boolean not null default false, add column role text",
  stmt("0144_admin_flag.sql", "create or replace function public.is_admin()"),
  "create table public.settings (id uuid primary key default gen_random_uuid(), key text not null unique, value jsonb not null default '{}'::jsonb)",
  "alter table public.settings enable row level security",
  stmt("0001_init.sql", 'create policy "settings admin all" on public.settings'),
  stmt("0093_config_governance.sql", "create table if not exists public.config_audit_log"),
  // the chat columns a gift reads, as 0011 / 0041 / 0043 / 0050 / 0062 / 0070 define them
  `create table public.conversations (id uuid primary key default gen_random_uuid(), type text not null default 'direct' check (type in ('direct', 'group', 'secret')),
     user_low uuid, user_high uuid, only_admins_can_send boolean not null default false)`,
  `create table public.conversation_members (conversation_id uuid not null references public.conversations (id) on delete cascade, user_id uuid not null references auth.users (id),
     role text not null default 'member' check (role in ('owner', 'admin', 'member')), left_at timestamptz, primary key (conversation_id, user_id))`,
  "create table public.blocks (blocker_id uuid not null references auth.users (id), blocked_id uuid not null references auth.users (id), primary key (blocker_id, blocked_id))",
  `create table public.messages (id uuid primary key default gen_random_uuid(), conversation_id uuid not null references public.conversations (id), sender_id uuid not null references auth.users (id),
     body text not null, client_id text, metadata jsonb, created_at timestamptz not null default now())`,
  "create unique index messages_client_id_uidx on public.messages (conversation_id, sender_id, client_id) where client_id is not null",
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
for (const m of [migration, coinMigration, depositMigration, scopeMigration, pinMigration, closeoutMigration, file("0284_frenz_coin_deposit_hold.sql"), giftMigration, file("0291_frenz_gift_settings_stickers.sql"), file("0292_protect_financial_settings.sql"), file("0293_frenz_gift_sends.sql")]) { await run(m(dir)); await run(m(dir)); }
await run(["create table if not exists public.notification_settings (user_id uuid primary key references auth.users (id) on delete cascade, master_enabled boolean not null default true, push_enabled boolean not null default true, in_app_enabled boolean not null default true, category_prefs jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now())", "alter table public.notification_settings enable row level security", stmt("0046_notification_settings.sql", 'create policy "notification settings self all"')]);
await db.exec(`insert into auth.users (id, email, email_confirmed_at) select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'u' || g || '@t.test', now() from generate_series(1, 40) g`);
await db.exec(`insert into public.profiles (id) select id from auth.users`);

// ── mutants ──
const fnBody = async (name) => (await one("select pg_get_functiondef(p.oid) d from pg_proc p where p.proname = $1", [name])).d;
const mutate = async (name, from, to) => { const b = await fnBody(name); const m = b.split(from).join(to); if (m === b) throw new Error(`mutant on ${name} did not apply`); await db.exec(m); };
if (MUTANT === "no-pin") await mutate("send_gift_with_pin", "if v_check <> 'ok' then", "if false then");
if (MUTANT === "spend-pending") await mutate("send_gift", "if v_bal - v_pend < v_st.price_fgc then", "if v_bal < v_st.price_fgc then");
if (MUTANT === "no-revision") await mutate("send_gift", "if v_st.revision <> p_expected_revision or v_st.price_fgc <> p_expected_price then", "if false then");
if (MUTANT === "no-block") await mutate("send_gift", "if exists (select 1 from public.blocks where", "if false and exists (select 1 from public.blocks where");
if (MUTANT === "early-release") await mutate("release_gift_earnings_locked", "and s.hold_until <= now()", "");
if (MUTANT === "double-release") { await mutate("release_gift_earnings_locked", "where s.recipient_id = p_user and s.status = 'pending' and", "where s.recipient_id = p_user and"); await mutate("release_gift_earnings_locked", "where id = g.earning_ledger_id and status = 'reserved'", "where id = g.earning_ledger_id"); await mutate("release_gift_earnings_locked", "where id = g.id and status = 'pending'", "where id = g.id and false"); }
if (MUTANT === "forge-message") await db.exec("drop trigger messages_gift_guard on public.messages");
if (MUTANT === "frozen-release") await mutate("release_gift_earnings_locked", "if public.gift_sender_frozen(g.sender_id) then continue; end if;", "");

// ── people, chats, rules, stickers (test-only values) ──
const ADMIN = U(39);
const A = U(1), B = U(2), C = U(3), D = U(4), E = U(5), F = U(6), G = U(7), H = U(8);
await db.query("update profiles set is_admin = true where id = $1", [ADMIN]);
const J = JSON.stringify;
const POLICY = J({ maxAttempts: 5, lockMinutes: 15, resetTtlMinutes: 10, resetMaxPerHour: 3, resetCodeMaxAttempts: 5 });
const PARAMS = J({ algorithm: "scrypt", N: 32768, r: 8, p: 1, keylen: 32, pepper: "v1" });
const keys = {};
const setPin = async (u) => { keys[u] = randomBytes(32).toString("hex"); return rpc("select set_coin_pin($1, decode($2, 'hex'), decode($3, 'hex'), $4::jsonb)", [u, keys[u], randomBytes(16).toString("hex"), PARAMS]); };
for (const u of [A, B, C, D, E, F, G, H]) await setPin(u);
const direct = async (x, y) => { const [lo, hi] = [x, y].sort(); const c = (await one("insert into conversations (type, user_low, user_high) values ('direct', $1, $2) returning id", [lo, hi])).id; await db.query("insert into conversation_members (conversation_id, user_id) values ($1, $2), ($1, $3)", [c, x, y]); return c; };
const group = async (members, adminsOnly = false) => { const c = (await one("insert into conversations (type, only_admins_can_send) values ('group', $1) returning id", [adminsOnly])).id; for (const [i, m] of members.entries()) await db.query("insert into conversation_members (conversation_id, user_id, role) values ($1, $2, $3)", [c, m, i === 0 ? "owner" : "member"]); return c; };
const AB = await direct(A, B);
const RULES = { recipientShareBp: 9000, commissionBp: 1000, holdHours: 72, senderCooldownHours: 0, dailyMaxFgc: 10_000_000 };
const saveRules = (rules, expected) => rpc("select save_frenz_gift_gifting($1, $2::jsonb, $3, '{}'::jsonb)", [ADMIN, J(rules), expected]);
const stored = async () => (await one("select value -> 'frenzGift' -> 'gifting' g from settings where key = 'landing'"))?.g ?? null;
const IMG = "https://cdn.example.test/gift-stickers/rose.webp";
const sticker = async (slug, price, extra = {}) => (await rpc("select admin_save_gift_sticker($1, null, null, $2::jsonb)", [ADMIN, J({ slug, name: slug, priceFgc: price, imageUrl: IMG, published: true, ...extra })])).sticker;
const ROSE = await sticker("red-rose", 5000, { rarity: "rare" });
const fgcAdjust = (u, cents, ref) => rpc("select adjust_gift_balance($1, $2, $3, 'test funding', $4)", [u, cents, ref, ADMIN]);
const wallet = async (u) => { const w = await one("select balance_cents::int b, pending_cents::int p from ai_product_balances where user_id = $1 and product = 'frenz_gift'", [u]); return w ?? { b: 0, p: 0 }; };
let seq = 0;
const key = () => `gift-key-${String(++seq).padStart(6, "0")}`;
const send = async (u, conv, st, opts = {}) => {
  const a = await rpc("select begin_coin_pin_attempt($1, 'gift', $2::jsonb)", [u, POLICY]);
  if (!a?.ok) return { ok: false, reason: `begin:${a?.reason}` };
  return rpc("select send_gift_with_pin($1, $2, decode($3, 'hex'), $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb)",
    [u, a.attempt_id, opts.pin ?? keys[u], conv, opts.to ?? null, st.id, opts.revision ?? st.revision, opts.price ?? st.price_fgc, opts.key ?? key(), opts.rules === undefined ? J(currentRules) : opts.rules, POLICY]);
};
let currentRules = null;
const age = async (giftId, hours) => {
  await db.exec("alter table public.gift_sends disable trigger gift_sends_guard");
  await db.query("update gift_sends set created_at = created_at - make_interval(hours => $2::int), hold_until = hold_until - make_interval(hours => $2::int) where id = $1", [giftId, hours]);
  await db.exec("alter table public.gift_sends enable trigger gift_sends_guard");
};

/** Every FGC wallet = Σ its ledger, pending = Σ reserved credits; every gift's rows and fee income match its record. */
const invariants = async (label) => {
  const bad = await q(`select b.user_id from ai_product_balances b
    left join (select user_id, sum(delta_cents) s, coalesce(sum(delta_cents) filter (where status = 'reserved' and delta_cents > 0), 0) pend from ai_product_ledger where product = 'frenz_gift' group by user_id) l on l.user_id = b.user_id
    where b.product = 'frenz_gift' and (b.balance_cents <> coalesce(l.s, 0) or b.pending_cents <> coalesce(l.pend, 0) or b.balance_cents < 0 or b.pending_cents > b.balance_cents)`);
  ok(bad.length === 0, `${label}: every FGC wallet = Σ its ledger, pending reconciles, nothing negative`);
  const mism = await q(`select g.id from gift_sends g
    join ai_product_ledger s on s.id = g.sent_ledger_id join ai_product_ledger e on e.id = g.earning_ledger_id
    left join ai_product_ledger f on f.id = g.fee_ledger_id left join platform_fee_ledger p on p.source = 'gift_commission' and p.source_ledger_id = g.fee_ledger_id
    where s.delta_cents <> -g.recipient_share or s.user_id <> g.sender_id or e.delta_cents <> g.recipient_share or e.user_id <> g.recipient_id
       or e.status <> case g.status when 'pending' then 'reserved' when 'released' then 'settled' else 'reversed' end
       or (g.commission > 0 and (f.delta_cents <> -g.commission or p.amount <> g.commission or p.unit <> 'FGC'))`);
  ok(mism.length === 0, `${label}: every gift's debit, fee, earning, status and fee income match its record`);
};




// ══════════════════════ Part 6 — several copies in one send, the note, no PIN (0296) ══════════════════════
const m294 = (d) => split(readFileSync(`${d}/0294_gift_notifications.sql`, "utf8"));
const m296 = (d) => split(readFileSync(`${d}/0296_frenz_gift_batches.sql`, "utf8"));
await run(m294(dir)); await run(m294(dir));
await run(m296(dir)); await run(m296(dir));
if (MUTANT === "batch-no-rollback") await mutate("send_gift_batch", "raise exception 'gift batch refused' using errcode = 'GB001', detail = v_out::text;", "return v_out;");
if (MUTANT === "batch-forge-note") await mutate("messages_gift_guard", "if (new.metadata ->> 'note') is distinct from v_g.note then", "if false then");
await saveRules(RULES, 0);
currentRules = await stored();
const R = J(currentRules);
let bseq = 0;
const bkey = () => `batch-key-${String(++bseq).padStart(5, "0")}`;
const batch = (u, conv, st, qty, note = null, opts = {}) =>
  rpc("select send_gift_batch($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)", [u, conv, opts.to ?? null, st.id, opts.revision ?? st.revision, opts.price ?? st.price_fgc, qty, note, opts.key ?? bkey(), opts.rules === undefined ? R : opts.rules]);
const counts = async (u) => one(`select (select count(*)::int from gift_sends where sender_id = $1) g, (select count(*)::int from ai_product_ledger where user_id = $1 and product = 'frenz_gift') l,
  (select count(*)::int from gift_notifications n join gift_sends s on s.id = n.gift_id where s.sender_id = $1) n, (select count(*)::int from platform_fee_ledger where payer_id = $1) f`, [u]);

await fgcAdjust(A, 30_000, "fund-a-296");   // 300.00 FGC, test value
const AC = await direct(A, C);

// ═══ 1 · quantity one and several, each its own gift ═══
let r = await batch(A, AB, ROSE, 1);
ok(r?.ok === true && r.quantity === 1 && r.total === 5000 && (await wallet(A)).b === 25_000, "quantity 1: one gift, 50.00 charged");
const before3 = await counts(A);
r = await batch(A, AB, ROSE, 3, "  For always hyping my stories  ");
ok(r?.ok === true && r.quantity === 3 && r.total === 15_000 && r.balance_after === 10_000, "quantity 3: 150.00 charged in one action, the database's total and balance");
const rows = await q("select id, batch_index, batch_size, note, price_fgc::int p, recipient_share::int s, commission::int c, idempotency_key k, message_client_id m from gift_sends where batch_id = $1 order by batch_index", [r.batch_id]);
ok(rows.length === 3 && rows.every((x, i) => x.batch_index === i + 1 && x.batch_size === 3 && x.p === 5000 && x.s === 4500 && x.c === 500), "three individual gift rows, each with its own price, share and commission");
ok(new Set(rows.map((x) => x.id)).size === 3 && rows.every((x) => x.m === `gift-${x.id}`), "each gift has its own stable id and message client id");
ok(rows[0].note === "For always hyping my stories" && rows[1].note === null && rows[2].note === null, "the note is trimmed and stored ONCE, on the first gift of the batch");
const after3 = await counts(A);
ok(after3.g - before3.g === 3 && after3.l - before3.l === 6 && after3.n - before3.n === 6 && after3.f - before3.f === 3, "3 gifts → 6 sender ledger rows, 6 notification rows, 3 fee rows — exactly per gift");
ok((await q("select 1 from financial_audit_log where action = 'gift_batch_sent' and target_id = $1", [r.batch_id])).length === 1 && (await q("select 1 from financial_audit_log where action = 'gift_sent' and target_id = any($1::text[])", [rows.map((x) => x.id)])).length === 3, "audited: the batch once, and every gift individually");
ok(!JSON.stringify(await q("select details from financial_audit_log where target_id = $1", [r.batch_id])).includes("hyping"), "the note is never written to the audit log");
await invariants("after the batch");

// ═══ 2 · replay and conflicts ═══
const k = bkey();
const first = await batch(A, AC, ROSE, 2, "hi", { key: k });
const w = (await wallet(A)).b;
const again = await batch(A, AC, ROSE, 2, "hi", { key: k });
ok(first?.ok && again?.duplicate === true && again.batch_id === first.batch_id && (await wallet(A)).b === w && (await q("select 1 from gift_sends where batch_id = $1", [first.batch_id])).length === 2, "a replayed key answers the same batch — no new gift, no new charge");
ok((await batch(A, AC, ROSE, 3, "hi", { key: k }))?.reason === "idempotency_conflict", "same key, another quantity: idempotency_conflict");
ok((await batch(A, AC, ROSE, 2, "other", { key: k }))?.reason === "idempotency_conflict", "same key, another note: idempotency_conflict");

// ═══ 3 · invalid input charges nothing ═══
const snap = async () => J({ w: await wallet(A), c: await counts(A) });
let s0 = await snap();
for (const bad of [0, -1, 11, null]) ok((await batch(A, AB, ROSE, bad))?.reason === "invalid", `quantity ${bad}: refused`);
const frac = await rpc("select send_gift_batch($1, $2, null, $3, $4, $5, 1.5, null, $6, $7::jsonb)", [A, AB, ROSE.id, ROSE.revision, ROSE.price_fgc, bkey(), R]);
ok(frac?.ok !== true, "a fractional quantity is not a send");
ok((await batch(A, AB, ROSE, 1, "x".repeat(201)))?.reason === "note_invalid", "a 201-character note: refused");
ok((await batch(A, AB, ROSE, 1, "line\nbreak"))?.reason === "note_invalid", "a note with a control character: refused");
ok((await snap()) === s0, "none of those refusals changed a balance, a gift, a ledger row or a notification");
await fgcAdjust(A, 20_000, "top-a-296");
r = await batch(A, AB, ROSE, 1, "é".repeat(200));
ok(r?.ok === true && r.note === "é".repeat(200), "exactly 200 characters (multi-byte) is accepted");
r = await batch(A, AB, ROSE, 1, "   ");
ok(r?.ok === true && r.note === null, "a whitespace-only note is stored as no note");
r = await batch(A, AB, ROSE, 1, "<script>alert(1)</script> & \"quotes\"");
ok(r?.ok === true && r.note === "<script>alert(1)</script> & \"quotes\"", "markup is stored as the plain text it is (rendered as text, never HTML)");

// ═══ 4 · a batch failing part-way leaves NOTHING ═══
await fgcAdjust(A, -(await wallet(A)).b + 12_000, "set-a-120");  // available 120.00 = two roses and change
s0 = await snap();
r = await batch(A, AB, ROSE, 3);
ok(r?.ok === false && r.reason === "insufficient" && r.failed_at === 3 && r.quantity === 3, "120.00 available, 3 × 50.00: refused at the third copy (insufficient)");
ok((await snap()) === s0, "…and the first two copies were rolled back: no balance change, no gift, no ledger, fee or notification row");
await invariants("after the rolled-back batch");
const tight = { ...currentRules, version: currentRules.version, dailyMaxFgc: 1 };
s0 = await snap();
ok((await batch(A, AB, ROSE, 2, null, { rules: J(tight) }))?.reason === "daily_limit", "the daily limit is checked against the whole batch");
ok((await snap()) === s0, "…nothing remains of it");

// ═══ 5 · the sticker changed or went away before confirming ═══
const cur = (await one("select revision from gift_stickers where id = $1", [ROSE.id])).revision;
await rpc("select admin_save_gift_sticker($1, $2, $3, $4::jsonb)", [ADMIN, ROSE.id, cur, J({ priceFgc: 5500 })]);
s0 = await snap();
r = await batch(A, AB, ROSE, 2, null, { revision: cur, price: 5000 });
ok(r?.reason === "sticker_changed" && Number(r.price) === 5500 && (await snap()) === s0, "re-priced before confirming: sticker_changed with the new price, nothing charged");
await rpc("select admin_save_gift_sticker($1, $2, $3, $4::jsonb)", [ADMIN, ROSE.id, cur + 1, J({ published: false })]);
ok((await batch(A, AB, ROSE, 1, null, { revision: cur + 1, price: 5500 }))?.reason === "sticker_unavailable", "unpublished before confirming: sticker_unavailable");
await rpc("select admin_save_gift_sticker($1, $2, $3, $4::jsonb)", [ADMIN, ROSE.id, cur + 2, J({ published: true, priceFgc: 5000 })]);
const ROSE2 = { id: ROSE.id, revision: cur + 3, price_fgc: 5000 };

// ═══ 6 · who may send ═══
ok((await batch(E, AB, ROSE2, 1))?.reason === "conversation_unavailable", "a member outside the chat can't send in it");
await db.query("insert into blocks (blocker_id, blocked_id) values ($1, $2)", [C, A]);
ok((await batch(A, AC, ROSE2, 1))?.reason === "blocked", "a blocked pair can't");
await db.query("delete from blocks where blocker_id = $1 and blocked_id = $2", [C, A]);
const GRP = await group([A, C, D]);
ok((await batch(A, GRP, ROSE2, 1))?.reason === "recipient_required", "in a group the recipient must be chosen");

// ═══ 7 · concurrency: two batches can't overspend ═══
await fgcAdjust(A, -(await wallet(A)).b + 10_000, "set-a-100");  // exactly two roses
const [p1, p2] = await Promise.all([batch(A, AB, ROSE2, 2), batch(A, AB, ROSE2, 2)]);
ok([p1, p2].filter((x) => x?.ok).length === 1 && (await wallet(A)).b === 0, "two 2-rose batches against 100.00: exactly one succeeds, the balance never goes negative");
await fgcAdjust(A, 10_000, "top-a-100b");
const ck = bkey();
const [c1, c2] = await Promise.all([batch(A, AB, ROSE2, 2, null, { key: ck }), batch(A, AB, ROSE2, 2, null, { key: ck })]);
ok(c1?.ok && c2?.ok && c1.batch_id === c2.batch_id && (await q("select 1 from gift_sends where batch_id = $1", [c1.batch_id])).length === 2 && (await wallet(A)).b === 0, "the same batch sent twice at once: one batch, charged once");
await invariants("after the concurrent batches");

// ═══ 8 · the chat bubble must be the batch's own ═══
const one3 = await one("select g.id, g.message_client_id m from gift_sends g where g.batch_id = $1 and g.batch_index = 1", [rows[0] ? (await one("select batch_id from gift_sends where id = $1", [rows[0].id])).batch_id : null]);
const ins = (meta) => throws("insert into messages (conversation_id, sender_id, body, client_id, metadata) values ($1, $2, 'gift', $3, $4::jsonb)", [AB, A, one3.m, J(meta)]);
ok((await ins({ kind: "gift", giftId: one3.id, quantity: 3, note: "forged words" })) !== null, "a bubble claiming another note is refused");
ok((await ins({ kind: "gift", giftId: one3.id, quantity: 9, note: "For always hyping my stories" })) !== null, "a bubble claiming another quantity is refused");
ok((await ins({ kind: "gift", giftId: one3.id, quantity: 3, note: "For always hyping my stories" })) === null, "the batch's own quantity and note are accepted");

// ═══ 9 · notifications: one announcement per batch, never the note ═══
const claim = (g, ch) => rpc("select claim_gift_notification($1, $2)", [g, ch]);
const ids3 = (await q("select id from gift_sends where batch_id = (select batch_id from gift_sends where id = $1) order by batch_index", [one3.id])).map((x) => x.id);
const c0 = await claim(ids3[0], "push");
const cN = await claim(ids3[2], "push");
ok(c0?.ok && c0.batch_index === 1 && c0.batch_size === 3 && cN?.ok && cN.batch_index === 3, "the claim reports each gift's place in its batch (the dispatcher announces the first, closes the rest)");
ok(!JSON.stringify(c0).includes("hyping"), "the notification claim carries no note");

// ═══ 10 · the rows can't be rewritten ═══
ok((await throws("update gift_sends set note = 'edited' where id = $1", [one3.id])) !== null, "a note can't be edited afterwards (gift_sends_guard)");
await db.exec("select set_config('frenz.gift_writer', 'on', false)");
await db.exec("select set_config('frenz.gift_batch_writer', 'on', false)");
ok((await throws("update gift_sends set note = 'edited' where id = $1", [one3.id])) !== null, "not even with both writer flags: a labelled batch row is never relabelled");
await db.exec("select set_config('frenz.gift_writer', '', false)");
await db.exec("select set_config('frenz.gift_batch_writer', '', false)");
await db.exec("set role authenticated");
ok((await throws("select send_gift_batch($1, $2, null, $3, $4, $5, 1, null, $6, $7::jsonb)", [A, AB, ROSE2.id, ROSE2.revision, 5000, bkey(), R])) !== null, "a member can't call send_gift_batch directly (service role only)");
await db.exec("reset role");

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
