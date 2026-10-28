// Frenz Gift Coin Part 5 — wallet and gift-history integration, end to end against the REAL migrations 0278–0294 in
// PGlite (the 0293 / 0294 suites' build, shared verbatim). Run like the other coin suites:
//   node gift_wallet_integration.pglite.mjs <repo>/supabase/migrations
//
// Pinned: FC → FGC → gift → pending → release exactly at the deadline (one second before: still pending; at it and after:
// released, once) → only AVAILABLE FGC converts → FGC → FC once (a replay makes no more FC, a stale rules version is
// refused) → the ordinary FC withdrawal; no Gift Coin withdrawal exists; a gift keeps its snapshot through a re-price,
// rename, re-draw and archive; a group gift credits only the chosen member; every wallet, fee and notification row
// reconciles; a member can change none of it directly.
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



// ══════════════════════ Part 5 — wallet and gift history integration ══════════════════════
const m294 = (d) => split(readFileSync(`${d}/0294_gift_notifications.sql`, "utf8"));
await run(m294(dir));
await run(m294(dir));
await saveRules(RULES, 0);
currentRules = await stored();
const CONV = { version: 1, fcToFgc: { rateNum: 1, rateDen: 1, feeBp: 200, feeFlat: 0, minIn: 100, maxIn: 10_000_000, dailyMaxIn: 30_000_000 }, fgcToFc: { rateNum: 1, rateDen: 1, feeBp: 500, feeFlat: 1, minIn: 100, maxIn: 10_000_000, dailyMaxIn: 30_000_000 } };
const fcBal = async (u) => Number((await one("select coalesce((select balance_cents from ai_product_balances where user_id = $1 and product = 'frenz_coin'), 0) b", [u])).b);

// the sender buys Gift Coins the real way: FC deposit-free funding then the Part 2 conversion
await rpc("select adjust_coin_balance($1, 100000, 'fund-a-fc', 'test', $2, false)", [A, ADMIN]);
const bought = await rpc("select convert_fgc($1, 'fc_to_fgc', 50000, 'conv-a-buy-0001', $2::jsonb)", [A, J(CONV)]);
ok(bought?.ok === true && bought.net === 49_000 && (await wallet(A)).b === 49_000, "the sender converts 500.00 FC to 490.00 FGC with the Part 2 engine (2% fee)");

// ═══ 1 · the release deadline: just before, exactly at, just after (one transaction = one database clock) ═══
const gB = await send(A, AB, ROSE);
const gC = await send(A, AB, ROSE);
const gD = await send(A, AB, ROSE);
const atClock = async (giftId, offset) => {
  // created_at / hold_until moved so that hold_until = now() + offset, then released IN THE SAME transaction (same now())
  await db.exec(`begin;
    alter table public.gift_sends disable trigger gift_sends_guard;
    update public.gift_sends set created_at = now() - interval '72 hours' + interval '${offset}', hold_until = now() + interval '${offset}' where id = '${giftId}';
    alter table public.gift_sends enable trigger gift_sends_guard;
    select public.release_gift_earnings('${B}');
    commit;`);
  return (await one("select status from gift_sends where id = $1", [giftId])).status;
};
ok((await atClock(gB.gift_id, "1 second")) === "pending", "one second BEFORE the deadline: still pending");
ok((await atClock(gC.gift_id, "0 seconds")) === "released", "EXACTLY at the deadline: released (hold_until <= now())");
ok((await atClock(gD.gift_id, "-1 second")) === "released", "one second AFTER the deadline: released");
const w1 = await wallet(B);
ok(w1.p === 4500 && w1.b === 13_500, "B: 45.00 still pending, 90.00 available — pending is never counted as spendable");
const relAgain = await rpc("select release_gift_earnings($1)", [B]);
ok(relAgain?.released === 0 && (await wallet(B)).b === 13_500, "releasing again credits nothing more");

// ═══ 2 · released earnings → FC (Part 2 engine), once ═══
let r = await rpc("select convert_fgc($1, 'fgc_to_fc', 9001, 'conv-b-0001', $2::jsonb)", [B, J(CONV)]);
ok(r?.ok === false && r.reason === "insufficient" && r.available === 9000, "converting more than the AVAILABLE 90.00 (the 45.00 on hold excluded) is refused");
r = await rpc("select convert_fgc($1, 'fgc_to_fc', 9000, 'conv-b-0002', $2::jsonb)", [B, J(CONV)]);
ok(r?.ok === true && r.net === 8549 && (await fcBal(B)) === 8549, "90.00 released FGC → 85.49 FC (5% + 0.01 fee, rounded as configured)");
const replay = await rpc("select convert_fgc($1, 'fgc_to_fc', 9000, 'conv-b-0002', $2::jsonb)", [B, J(CONV)]);
ok(replay?.duplicate === true && (await fcBal(B)) === 8549 && (await one("select count(*)::int n from ai_product_ledger where user_id = $1 and product = 'frenz_coin' and kind = 'conversion_in'", [B])).n === 1, "replaying the conversion creates no more FC (one conversion_in row)");
const stale = await rpc("select convert_fgc($1, 'fgc_to_fc', 100, 'conv-b-0003', $2::jsonb, 0)", [B, J(CONV)]);
ok(stale?.reason === "rules_changed", "a conversion quoted under another rules version is refused (expectedVersion)");

// ═══ 3 · FC → the existing FC withdrawal; no Gift Coin bank withdrawal exists ═══
const WITHDRAW = J({ enabled: true, version: 1, percentBp: 600, flatCents: 0, minCents: 500, maxCents: 500000, maxPerDay: 5, maxMonthCents: 100000000, requireQualification: false, requireEmailConfirmed: true, payoutCurrency: "NGN", payoutMinorPerUsd: null });
const wd = await rpc("select request_coin_withdrawal($1, 8549, 'paystack', '{}'::jsonb, 'wd-b-0001', $2::jsonb)", [B, WITHDRAW]);
ok(wd?.ok === true && wd.gross === 8549 && wd.fee === 513 && wd.net === 8036, "the FC from gift earnings goes through the existing FC withdrawal (held, its own 6% fee) — no extra gate");
const fgcPayout = await q("select proname from pg_proc where proname ~ '(gift|fgc).*(withdraw|payout)|(withdraw|payout).*(gift|fgc)'");
ok(fgcPayout.length === 0, "there is no Gift Coin withdrawal or payout function at all");
ok((await one("select count(*)::int n from withdrawal_requests where user_id = $1 and source = 'coin'", [B])).n === 1, "the withdrawal is an ordinary coin (FC) withdrawal");

// ═══ 4 · history keeps the gift's own snapshot ═══
const before = await one("select sticker_revision, price_fgc::int p, sticker_snapshot from gift_sends where id = $1", [gC.gift_id]);
const cur = (await one("select revision from gift_stickers where id = $1", [ROSE.id])).revision;
await rpc("select admin_save_gift_sticker($1, $2, $3, $4::jsonb)", [ADMIN, ROSE.id, cur, J({ priceFgc: 9900, name: "Renamed Rose", imageUrl: "https://cdn.example.test/new.webp" })]);
await rpc("select admin_save_gift_sticker($1, $2, $3, $4::jsonb)", [ADMIN, ROSE.id, cur + 1, J({ archived: true })]);
const afterEdit = await one("select sticker_revision, price_fgc::int p, sticker_snapshot from gift_sends where id = $1", [gC.gift_id]);
ok(J(afterEdit) === J(before) && afterEdit.sticker_snapshot.name === "red-rose" && afterEdit.p === 5000, "after the sticker is re-priced, renamed, re-drawn and archived, the gift still shows its own name, artwork, price and revision");
ok((await one("select price_fgc::int p from gift_sticker_revisions where sticker_id = $1 and revision = $2", [ROSE.id, before.sticker_revision])).p === 5000, "and the revision it names still holds the price it was bought at");

// ═══ 5 · a group gift credits only the chosen member ═══
const GRP = await group([A, C, D]);
const cBefore = await wallet(C), dBefore = await wallet(D);
const LILY = await sticker("lily-5", 2000);
const gg = await send(A, GRP, LILY, { to: D });
ok(gg?.ok === true && J(await wallet(C)) === J(cBefore) && (await wallet(D)).p === dBefore.p + 1800, "a group gift to D credits D only — C, also in the group, gets nothing");

// ═══ 6 · everything reconciles ═══
const bad = await q(`select b.user_id, b.product from ai_product_balances b
  left join (select user_id, product, sum(delta_cents) s, coalesce(sum(delta_cents) filter (where status = 'reserved' and delta_cents > 0), 0) pend,
                    coalesce(-sum(delta_cents) filter (where status = 'reserved' and delta_cents < 0), 0) held from ai_product_ledger group by user_id, product) l on l.user_id = b.user_id and l.product = b.product
  where b.product in ('frenz_coin', 'frenz_gift') and (b.balance_cents <> coalesce(l.s, 0) or b.pending_cents <> coalesce(l.pend, 0) or b.held_cents <> coalesce(l.held, 0) or b.balance_cents < 0)`);
ok(bad.length === 0, "every FC and FGC wallet equals its ledger (balance, pending, held), nothing negative");
const fees = await one(`select
  (select coalesce(sum(commission), 0) from gift_sends)::bigint gift_comm,
  (select coalesce(sum(amount), 0) from platform_fee_ledger where source = 'gift_commission')::bigint gift_posted,
  (select coalesce(sum(fee_amount), 0) from fgc_conversions)::bigint conv_fees,
  (select coalesce(sum(amount), 0) from platform_fee_ledger where source like '%conversion_fee')::bigint conv_posted,
  (select count(*) from gift_sends g where (select count(*) from ai_product_ledger l where l.reference in ('gift:' || g.id::text, 'gift-fee:' || g.id::text)) <> case when g.commission > 0 then 3 else 2 end)::int wrong_rows`);
ok(Number(fees.gift_comm) === Number(fees.gift_posted) && Number(fees.conv_fees) === Number(fees.conv_posted) && fees.wrong_rows === 0, `commission ${fees.gift_comm} = fee income ${fees.gift_posted}, conversion fees ${fees.conv_fees} = ${fees.conv_posted}, every gift has exactly its ledger rows`);
ok((await one("select count(*)::int n from gift_notifications")).n === (await one("select count(*)::int n from gift_sends")).n * 2, "every gift has exactly two notification rows (push, email)");

// ═══ 7 · a member can change none of it directly ═══
await db.exec("set role authenticated");
await db.query("select set_config('test.uid', $1, false)", [B]);
const attempts = [
  ["their FGC balance", "update ai_product_balances set balance_cents = 999999 where user_id = $1", [B]],
  ["a gift's status", "update gift_sends set status = 'released' where recipient_id = $1", [B]],
  ["a notification's delivery status", "update gift_notifications set status = 'sent' where recipient_id = $1", [B]],
  ["a ledger row", "update ai_product_ledger set delta_cents = 1 where user_id = $1", [B]],
  ["the fee ledger", "update platform_fee_ledger set amount = 1 where payer_id = $1", [B]],
  ["the audit log", "delete from financial_audit_log where actor_id = $1", [B]],
  ["the conversion settings", "update settings set value = '{}'::jsonb where key = 'landing'", []],
];
const results = [];
for (const [what, sql, params] of attempts) results.push([what, await db.query(sql, params).then((x) => x.affectedRows ?? 0, () => "refused")]);
await db.exec("reset role");
await db.query("select set_config('test.uid', '', false)");
for (const [what, res] of results) ok(res === "refused" || res === 0, `a member can't change ${what} (${res === "refused" ? "refused" : "0 rows"})`);
ok((await wallet(B)).b === 4500, "B's FGC balance is exactly what the ledger says");

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
