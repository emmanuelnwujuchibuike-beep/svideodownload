// 0293 (Frenz Gift Coin Part 4) — sticker gifts in chat, against the REAL functions in PGlite. Run like the other coin
// suites (from a folder where @electric-sql/pglite is installed, next to credit_wallet.shared.mjs):
//   node 0293_gift_sends.pglite.mjs <repo>/supabase/migrations [--mutant=<name>]
//
// Builds the wallet with Supabase's default grants (and a BYPASSRLS service role), the chat tables a gift reads (the
// columns of 0011/0041/0043/0050/0062/0070 it uses: conversations, conversation_members, blocks, messages), then
// 0278–0284, 0290, 0291, 0292 and 0293 (twice each). Test-only rules and prices throughout (never production values).
//
// --mutant=<name> breaks one protection and the run must FAIL:
//   no-pin           send_gift_with_pin skips the PIN check                 -> a gift without the PIN
//   spend-pending    send_gift spends balance instead of available          -> pending earnings re-gifted
//   no-revision      the sticker revision / price check is removed          -> a re-priced sticker sold at the old price
//   no-block         the block check is removed                             -> a gift across a block
//   early-release    release ignores the hold                               -> earnings spendable before the hold ends
//   double-release   release forgets the status condition                   -> the same earnings released twice
//   forge-message    the gift-message guard is dropped                      -> a forged gift bubble
//   frozen-release   release ignores a sender under review                  -> earnings released despite a chargeback
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

// ═══ 1 · rules: missing, invalid, stale, valid ═══
ok((await send(A, AB, ROSE, { rules: null }))?.reason === "gifting_not_configured", "no gifting rules saved: gifting_not_configured");
for (const [why, rules, detail] of [
  ["a split that isn't 100%", { ...RULES, commissionBp: 1100 }, "gifting_invalid:split"],
  ["a zero recipient share", { ...RULES, recipientShareBp: 0, commissionBp: 10000 }, "gifting_invalid:recipientShareBp"],
  ["a zero hold (immediately spendable)", { ...RULES, holdHours: 0 }, "gifting_invalid:holdHours"],
  ["a hold over 90 days", { ...RULES, holdHours: 2161 }, "gifting_invalid:holdHours"],
  ["a fractional share", { ...RULES, recipientShareBp: 9000.5 }, "gifting_invalid:recipientShareBp"],
  ["no daily limit", { recipientShareBp: 9000, commissionBp: 1000, holdHours: 72, senderCooldownHours: 0 }, "gifting_invalid:dailyMaxFgc"],
]) {
  const r = await saveRules(rules, 0);
  ok(r?.ok === false && r.reason === "invalid" && r.detail === detail, `rules refused: ${why} (${r?.detail})`);
}
ok((await stored()) === null, "nothing stored after refusals: gifting stays off");
let s = await saveRules({ ...RULES, injected: 1, version: 99 }, 0);
ok(s?.ok === true && s.version === 1 && !("injected" in (await stored())) && (await stored()).version === 1, "the first valid save is version 1, extra fields dropped, the version not chosen by the caller");
ok((await saveRules(RULES, 0))?.reason === "stale", "a save over an older version is stale");
ok((await saveRules(RULES, 1))?.unchanged === true, "an identical save is unchanged (no bump)");
ok((await one("select count(*)::int n from financial_audit_log where action = 'gift_gifting_config_updated' and actor_id = $1", [ADMIN])).n === 1, "the save is audited with the admin");
ok((await throws(`update settings set value = jsonb_set(value, '{frenzGift,gifting,recipientShareBp}', '10000') where key = 'landing'`)) !== null || (await stored()).recipientShareBp === 9000, "a direct write of the gifting rules is refused (0292's guard covers frenzGift)");
const conv = await one("select value -> 'frenzGift' -> 'conversion' c from settings where key = 'landing'");
ok(conv.c === null || conv.c === undefined, "the conversion settings were not touched by the gifting writer");
currentRules = await stored();

// ═══ 2 · a gift, exactly ═══
await fgcAdjust(A, 20_000, "fund-a");
let g = await send(A, AB, ROSE);
ok(g?.ok === true && g.duplicate === false && g.recipient_id === B && g.price === 5000 && g.recipient_share === 4500 && g.commission === 500 && g.status === "pending", "A gifts B a 50.00 FGC rose: B earns 45.00 (90%), the commission is 5.00 (10%)");
ok((await wallet(A)).b === 15_000 && (await wallet(B)).b === 4500 && (await wallet(B)).p === 4500, "A paid 50.00, B has 45.00 — all pending");
const rec = await one("select * from gift_sends where id = $1", [g.gift_id]);
ok(rec.sticker_id === ROSE.id && rec.sticker_revision === ROSE.revision && Number(rec.price_fgc) === 5000 && rec.share_bp === 9000 && rec.commission_bp === 1000 && rec.hold_hours === 72
   && Number(rec.rules_version) === 1 && rec.rules_snapshot.recipientShareBp === 9000 && rec.sticker_snapshot.name === "red-rose" && rec.conversation_id === AB && rec.message_client_id === `gift-${g.gift_id}`,
   "the record keeps sticker + revision, price, split, hold, rules version and snapshot, sticker snapshot, conversation, message client id");
const holdSecs = (await one("select extract(epoch from hold_until - created_at)::int s from gift_sends where id = $1", [g.gift_id])).s;
ok(holdSecs === 72 * 3600, "hold_until is exactly 72 hours after the gift (database clock)");
const rows = await q("select user_id, kind, status, delta_cents::int d from ai_product_ledger where reference in ($1, $2) order by kind", [`gift:${g.gift_id}`, `gift-fee:${g.gift_id}`]);
ok(J(rows) === J([
  { user_id: B, kind: "gift_earning", status: "reserved", d: 4500 },
  { user_id: A, kind: "gift_fee", status: "settled", d: -500 },
  { user_id: A, kind: "gift_sent", status: "settled", d: -4500 },
]), "ledger: A gift_sent −45.00 and gift_fee −5.00, B gift_earning +45.00 reserved");
const fee = await one("select amount::int a, unit from platform_fee_ledger where source = 'gift_commission' and source_ledger_id = $1", [rec.fee_ledger_id]);
ok(fee?.a === 500 && fee.unit === "FGC", "the commission is FGC fee income (gift_commission), once");
ok((await one("select count(*)::int n from financial_audit_log where action = 'gift_sent' and target_id = $1", [g.gift_id])).n === 1, "the gift is in the financial audit log");

// exact rounding
const ODD = await sticker("odd-price", 1001);
g = await send(A, AB, ODD);
ok(g?.ok === true && g.recipient_share === 900 && g.commission === 101, "10.01 FGC: B earns floor(1001 × 90%) = 9.00, the platform keeps the remainder 1.01");
const TINY = await sticker("tiny", 1);
ok((await send(A, AB, TINY))?.reason === "below_minimum", "a price whose share rounds to 0 is refused (below_minimum), nothing moves");
await invariants("after the first gifts");

// ═══ 3 · stale, unpublished, archived stickers ═══
const before3 = (await wallet(A)).b;
let r = await rpc("select admin_save_gift_sticker($1, $2, $3, $4::jsonb)", [ADMIN, ROSE.id, ROSE.revision, J({ priceFgc: 6000 })]);
const ROSE2 = r.sticker;
g = await send(A, AB, ROSE);
ok(g?.ok === false && g.reason === "sticker_changed" && g.revision === ROSE2.revision && g.price === 6000, "after a re-price, a gift at the old revision/price is refused with the current ones (sticker_changed)");
ok((await send(A, AB, ROSE, { price: 1 }))?.reason === "sticker_changed", "an altered client price is refused");
ok((await send(A, AB, { ...ROSE2, price_fgc: 1 }))?.reason === "sticker_changed", "a current revision with an altered price is refused");
const first = await one("select sticker_revision, price_fgc::int p, sticker_snapshot from gift_sends where sticker_id = $1 order by created_at limit 1", [ROSE.id]);
ok(first.sticker_revision === ROSE.revision && first.p === 5000, "the earlier gift still names revision 1 at 50.00 — re-pricing rewrote nothing");
await rpc("select admin_save_gift_sticker($1, $2, $3, $4::jsonb)", [ADMIN, ROSE.id, ROSE2.revision, J({ published: false })]);
ok((await send(A, AB, { ...ROSE2, revision: ROSE2.revision + 1 }))?.reason === "sticker_unavailable", "an unpublished sticker can't be gifted");
const ARCH = await sticker("old-one", 500);
await rpc("select admin_save_gift_sticker($1, $2, $3, $4::jsonb)", [ADMIN, ARCH.id, ARCH.revision, J({ archived: true })]);
ok((await send(A, AB, { ...ARCH, revision: ARCH.revision + 1 }))?.reason === "sticker_unavailable", "an archived sticker can't be gifted");
ok((await wallet(A)).b === before3, "no refused gift moved anything");
const gal = await rpc("select gift_sticker_gallery()");
ok(Array.isArray(gal) && gal.every((x) => x.id !== ROSE.id && x.id !== ARCH.id) && gal.some((x) => x.id === ODD.id), "the members' gallery lists only published, not archived stickers");

// ═══ 4 · who may receive ═══
const LILY = await sticker("lily", 2000);
await fgcAdjust(C, 50_000, "fund-c");
const CD = await direct(C, D);
ok((await send(C, AB, LILY))?.reason === "conversation_unavailable", "a conversation the sender isn't in: refused");
ok((await send(C, CD, LILY, { to: E }))?.reason === "recipient_invalid", "naming someone else as the recipient of a direct chat: refused");
ok((await send(C, CD, LILY, { to: C }))?.reason === "recipient_invalid" || (await send(C, CD, LILY, { to: C }))?.reason === "self", "naming yourself: refused");
await db.query("insert into blocks (blocker_id, blocked_id) values ($1, $2)", [D, C]);
ok((await send(C, CD, LILY))?.reason === "blocked", "the recipient blocked the sender: refused");
await db.query("delete from blocks");
await db.query("insert into blocks (blocker_id, blocked_id) values ($1, $2)", [C, D]);
ok((await send(C, CD, LILY))?.reason === "blocked", "the sender blocked the recipient: refused");
await db.query("delete from blocks");
await db.query("update profiles set is_suspended = true where id = $1", [D]);
ok((await send(C, CD, LILY))?.reason === "recipient_unavailable", "a suspended recipient: refused");
await db.query("update profiles set is_suspended = false where id = $1", [D]);
await db.query("update conversation_members set left_at = now() where conversation_id = $1 and user_id = $2", [CD, D]);
ok((await send(C, CD, LILY))?.reason === "recipient_invalid", "a recipient who left the chat: refused");
await db.query("update conversation_members set left_at = null where conversation_id = $1 and user_id = $2", [CD, D]);
const sec = (await one("insert into conversations (type, user_low, user_high) values ('secret', $1, $2) returning id", [[C, D].sort()[0], [C, D].sort()[1]])).id;
await db.query("insert into conversation_members (conversation_id, user_id) values ($1, $2), ($1, $3)", [sec, C, D]);
ok((await send(C, sec, LILY))?.reason === "secret_chat", "a secret (end-to-end encrypted) chat: refused");
const GRP = await group([C, D, E]);
ok((await send(C, GRP, LILY))?.reason === "recipient_required", "a group chat without a chosen recipient: refused");
ok((await send(C, GRP, LILY, { to: F }))?.reason === "recipient_invalid", "a group recipient who isn't a member: refused");
g = await send(C, GRP, LILY, { to: E });
ok(g?.ok === true && g.recipient_id === E && g.recipient_share === 1800, "a group gift to the chosen member E succeeds");
const ADM = await group([F, C, D], true);
ok((await send(C, ADM, LILY, { to: F }))?.reason === "admins_only", "a member of an admins-only group can't gift there (the chat's own send rule)");
ok((await wallet(C)).b === 50_000 - 2000, "of all those attempts only the one gift moved money");

// ═══ 5 · PIN, balance, idempotency, rollback ═══
ok((await send(C, CD, LILY, { pin: randomBytes(32).toString("hex") }))?.reason === "authorization_failed", "a wrong PIN: authorization_failed, nothing moves");
const att = await rpc("select begin_coin_pin_attempt($1, 'transfer', $2::jsonb)", [C, POLICY]);
const crossPurpose = await rpc("select send_gift_with_pin($1, $2, decode($3, 'hex'), $4, null, $5, $6, $7, $8, $9::jsonb, $10::jsonb)", [C, att.attempt_id, keys[C], CD, LILY.id, LILY.revision, LILY.price_fgc, key(), J(currentRules), POLICY]);
ok(crossPurpose?.reason === "authorization_failed", "a PIN attempt begun for a transfer can't authorize a gift");
await fgcAdjust(G, 1999, "fund-g");
const GH = await direct(G, H);
r = await send(G, GH, LILY);
ok(r?.reason === "insufficient" && r.available === 1999 && (await wallet(G)).b === 1999, "1999 for a 2000 sticker: insufficient, nothing moves");
const k1 = key();
const a1 = await send(C, CD, LILY, { key: k1 });
const a2 = await send(C, CD, LILY, { key: k1 });
ok(a1?.ok && a2?.ok && a2.duplicate === true && a2.gift_id === a1.gift_id, "the same key again answers the first gift");
ok((await one("select count(*)::int n from gift_sends where idempotency_key = $1", [k1])).n === 1 && (await wallet(C)).b === 50_000 - 4000, "charged once");
ok((await send(C, CD, ODD, { key: k1 }))?.reason === "idempotency_conflict", "the same key for another sticker: idempotency_conflict");
ok((await send(C, GRP, LILY, { key: k1, to: E }))?.reason === "idempotency_conflict", "the same key in another chat: idempotency_conflict");
await db.exec(`create function public.boom() returns trigger language plpgsql as $$ begin if new.idempotency_key = 'boom-key-0001' then raise exception 'boom at the last step'; end if; return new; end $$;
  create trigger gift_boom before insert on public.gift_sends for each row execute function public.boom()`);
const cBefore = await wallet(C), dBefore = await wallet(D);
const feesBefore = (await one("select count(*)::int n from platform_fee_ledger")).n;
const boom = await send(C, CD, LILY, { key: "boom-key-0001" });
ok(boom?.reason === "exception" && /boom/.test(boom.error), "a failure at the last step aborts the gift");
ok(J(await wallet(C)) === J(cBefore) && J(await wallet(D)) === J(dBefore) && (await one("select count(*)::int n from platform_fee_ledger")).n === feesBefore, "and leaves nothing: no debit, no earning, no fee");
await db.exec("drop trigger gift_boom on public.gift_sends; drop function public.boom()");
await invariants("after refusals, replays and a rolled-back failure");

// ═══ 6 · pending earnings: not spendable, not convertible, released after the hold, once ═══
const B_W = await wallet(B);
ok(B_W.p === B_W.b && B_W.b > 0, "B's gift earnings are all pending");
const BA = AB;
ok((await send(B, BA, LILY))?.reason === "insufficient", "B can't re-gift pending earnings");
const CONV = { version: 1, fcToFgc: { rateNum: 1, rateDen: 1, feeBp: 200, feeFlat: 0, minIn: 100, maxIn: 1_000_000, dailyMaxIn: 3_000_000 }, fgcToFc: { rateNum: 1, rateDen: 1, feeBp: 500, feeFlat: 1, minIn: 100, maxIn: 1_000_000, dailyMaxIn: 3_000_000 } };
ok((await rpc("select convert_fgc($1, 'fgc_to_fc', 1000, 'conv-b-000001', $2::jsonb)", [B, J(CONV)]))?.reason === "insufficient", "nor convert them to FC");
let rel = await rpc("select release_gift_earnings($1)", [B]);
ok(rel?.released === 0 && (await wallet(B)).p === B_W.p, "a release before the hold releases nothing");
const bGifts = await q("select id from gift_sends where recipient_id = $1", [B]);
for (const x of bGifts) await age(x.id, 71);
rel = await rpc("select release_gift_earnings($1)", [B]);
ok(rel?.released === 0, "one hour before the hold ends: still nothing");
for (const x of bGifts) await age(x.id, 2);
const summary = await rpc("select gift_wallet_summary($1)", [B]);
ok(summary?.ok === true && summary.pending === 0 && summary.available === B_W.b && summary.released_now === B_W.b, "after 72 hours the wallet read releases them: all available");
rel = await rpc("select release_gift_earnings($1)", [B]);
ok(rel?.released === 0 && (await wallet(B)).p === 0, "releasing again releases nothing (once only)");
ok((await one("select count(*)::int n from gift_sends where recipient_id = $1 and status = 'released'", [B])).n === bGifts.length, "every one of B's gifts is released, each once");
// released earnings → FC → the existing withdrawal path
const conv1 = await rpc("select convert_fgc($1, 'fgc_to_fc', 4000, 'conv-b-000002', $2::jsonb)", [B, J(CONV)]);
ok(conv1?.ok === true && conv1.net === 3799, "B converts 40.00 released FGC to FC with the configured reverse rate and fee (37.99)");
const fcB = Number((await one("select balance_cents from ai_product_balances where user_id = $1 and product = 'frenz_coin'", [B])).balance_cents);
const WITHDRAW = J({ enabled: true, version: 1, percentBp: 600, flatCents: 0, minCents: 500, maxCents: 500000, maxPerDay: 5, maxMonthCents: 100000000, requireQualification: false, requireEmailConfirmed: true, payoutCurrency: "NGN", payoutMinorPerUsd: null });
const wd = await rpc("select request_coin_withdrawal($1, $2, 'paystack', '{}'::jsonb, 'wd-b-0001', $3::jsonb)", [B, fcB, WITHDRAW]);
ok(fcB === 3799 && wd?.ok === true && wd.gross === 3799, "and the resulting FC goes through the existing FC withdrawal (held, 6% fee) — there is no FGC payout");
await invariants("after release and conversion");

// ═══ 7 · chargeback safety ═══
// a sender with an open deposit shortfall can't gift
await db.exec("alter table public.coin_deposit_reversals disable trigger all");
await db.query(`insert into coin_deposit_reversals (provider, event_key, kind, reference, user_id, phase, deposit_cents, due_cents, recovered_cents, shortfall_cents, state, ledger_reference)
                values ('flutterwave', 'ev-c-1', 'refund', 'frenz_coin_dep_x', $1, 'released', 1000, 1000, 0, 1000, 'lost', 'coin-deposit-reversal:ev-c-1')`, [C]).catch(async (e) => console.log("  (reversal insert)", e.message));
await db.exec("alter table public.coin_deposit_reversals enable trigger all");
const cShort = await one("select count(*)::int n from coin_deposit_reversals where user_id = $1 and shortfall_cents > 0", [C]);
ok(cShort.n === 1 && (await send(C, CD, LILY))?.reason === "recovery_due", "a sender who owes a deposit recovery can't gift (recovery_due)");
// the cooldown after a deposit
const CD2 = await direct(E, F);
await fgcAdjust(E, 50_000, "fund-e");
const DEP = J({ enabled: true, version: 1, holdHours: 0, minCents: 100, maxCents: 500000 });
const refE = "frenz_coin_dep_fw_00000000-0000-4000-8000-000000000555";
await rpc("select begin_coin_deposit($1, $2, 2000, 'flutterwave', 2000, 'USD', 'dep-e-0001', $3::jsonb)", [E, refE, DEP]);
await rpc("select settle_coin_deposit($1, 'ch-555', 2000, 'USD')", [refE]);
await rpc("select release_due_coin_deposits($1, 10)", [E]);
const coolRules = { ...RULES, senderCooldownHours: 48 };
r = await saveRules(coolRules, 1);
currentRules = await stored();
ok(r?.ok === true && (await send(E, CD2, LILY))?.reason === "deposit_cooldown", "with a 48-hour cooldown, a member who deposited an hour ago can't gift yet (deposit_cooldown)");
await db.exec("alter table public.coin_deposits disable trigger coin_deposits_guard");
await db.query("update coin_deposits set settled_at = settled_at - interval '49 hours', release_at = release_at - interval '49 hours' where reference = $1", [refE]);
await db.exec("alter table public.coin_deposits enable trigger coin_deposits_guard");
ok((await send(E, CD2, LILY))?.ok === true, "49 hours after the deposit settled, the gift goes through");
// a sender under review: the recipient's pending earnings are frozen, not released, not reversed automatically
const frozenGift = (await one("select id from gift_sends where sender_id = $1 and recipient_id = $2 order by created_at desc limit 1", [E, F])).id;
await age(frozenGift, 80);
await db.query("insert into reward_profiles (user_id, restricted) values ($1, true) on conflict (user_id) do update set restricted = true", [E]);
rel = await rpc("select release_gift_earnings($1)", [F]);
ok(rel?.released === 0 && (await one("select status from gift_sends where id = $1", [frozenGift])).status === "pending", "the hold has passed, but the sender is under review: F's earnings stay pending (frozen)");
// the administrator's decision: reverse the pending gift
const eBefore = (await wallet(E)).b, fBefore = await wallet(F);
r = await rpc("select reverse_gift($1, $2, $3)", [frozenGift, ADMIN, "chargeback on the sender's deposit"]);
ok(r?.ok === true && r.refunded === 2000, "the administrator reverses the pending gift");
ok((await wallet(E)).b === eBefore + 2000 && (await wallet(F)).b === fBefore.b - 1800 && (await wallet(F)).p === fBefore.p - 1800, "the sender is refunded 20.00 FGC, the recipient's pending 18.00 is taken back");
ok((await one("select amount::int a from platform_fee_ledger where source = 'gift_commission_reversal' and reference = $1", [`gift:${frozenGift}`])).a === 200, "the commission income is reversed (gift_commission_reversal)");
ok((await rpc("select reverse_gift($1, $2, $3)", [frozenGift, ADMIN, "again"]))?.duplicate === true, "reversing again changes nothing");
const releasedGift = (await one("select id from gift_sends where status = 'released' limit 1")).id;
ok((await rpc("select reverse_gift($1, $2, $3)", [releasedGift, ADMIN, "late chargeback"]))?.reason === "already_released", "a released gift is never clawed back automatically");
ok((await one("select count(*)::int n from financial_audit_log where action = 'gift_reversed' and actor_id = $1", [ADMIN])).n === 1, "the reversal is audited with the admin");
await db.query("update reward_profiles set restricted = false where user_id = $1", [E]);
await invariants("after the chargeback paths");

// ═══ 8 · daily limit ═══
r = await saveRules({ ...RULES, dailyMaxFgc: 3000 }, 2);
currentRules = await stored();
await fgcAdjust(H, 50_000, "fund-h");
ok((await send(H, GH, LILY))?.ok === true && (await send(H, GH, LILY))?.reason === "daily_limit", "a 30.00 FGC daily limit: one 20.00 gift, then daily_limit");
currentRules = { ...currentRules };
await saveRules(RULES, 3);
currentRules = await stored();

// ═══ 9 · the records can't be forged or rewritten ═══
ok((await throws("update gift_sends set price_fgc = 1 where id = $1", [frozenGift])) !== null, "a gift can't be rewritten");
ok((await throws("delete from gift_sends where id = $1", [frozenGift])) !== null, "or deleted");
ok((await throws("insert into gift_sends (id) values (gen_random_uuid())")) !== null, "or forged");
const forged = await throws("insert into messages (conversation_id, sender_id, body, client_id, metadata) values ($1, $2, 'x', 'gift-fake', $3::jsonb)", [CD, C, J({ kind: "gift", giftId: frozenGift })]);
ok(forged !== null, "a chat message claiming someone else's gift is refused (no forged gift bubble)");
const realGift = await one("select id, sender_id, conversation_id, message_client_id from gift_sends where sender_id = $1 and conversation_id = $2 limit 1", [C, CD]);
ok((await throws("insert into messages (conversation_id, sender_id, body, client_id, metadata) values ($1, $2, 'Sent a gift', $3, $4::jsonb)", [realGift.conversation_id, realGift.sender_id, realGift.message_client_id, J({ kind: "gift", giftId: realGift.id })])) === null, "the real gift's message is accepted");
ok((await throws("update messages set metadata = $2::jsonb where client_id = $1", [realGift.message_client_id, J({ kind: "gift", giftId: realGift.id, priceFgc: 999999 })])) !== null, "and its metadata can't be edited");
ok((await throws("insert into messages (conversation_id, sender_id, body, client_id) values ($1, $2, 'hello', 'c-plain-0001')", [CD, C])) === null, "an ordinary message still sends");

// ═══ 10 · grants and RLS ═══
const as = async (role, uid, fn) => { await db.exec(`set role ${role}`); await db.query("select set_config('test.uid', $1, false)", [uid ?? ""]); try { return await fn(); } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); } };
for (const role of ["anon", "authenticated"]) {
  for (const [what, sql] of [
    ["send_gift_with_pin", `select send_gift_with_pin('${C}', gen_random_uuid(), '\\x00'::bytea, '${CD}', null, '${LILY.id}', 1, 2000, 'k-rls-000001', '{}'::jsonb, '{}'::jsonb)`],
    ["send_gift", `select send_gift('${C}', '${CD}', null, '${LILY.id}', 1, 2000, 'k-rls-000002', '{}'::jsonb)`],
    ["release_gift_earnings", `select release_gift_earnings('${B}')`],
    ["reverse_gift", `select reverse_gift('${frozenGift}', '${ADMIN}', 'x')`],
    ["save_frenz_gift_gifting", `select save_frenz_gift_gifting('${ADMIN}', '{}'::jsonb, 0)`],
    ["gift_wallet_summary", `select gift_wallet_summary('${B}')`],
  ]) ok(/permission denied/.test((await as(role, C, () => throws(sql))) ?? ""), `${role} cannot call ${what}`);
}
ok(/permission denied/.test((await as("service_role", null, () => throws(`select send_gift('${C}', '${CD}', null, '${LILY.id}', 1, 2000, 'k-rls-000003', '{}'::jsonb)`))) ?? ""), "even the service role can't skip the PIN (send_gift is reachable only through send_gift_with_pin)");
const seenByC = await as("authenticated", C, () => q("select distinct sender_id, recipient_id from gift_sends"));
ok(seenByC.length > 0 && seenByC.every((x) => x.sender_id === C || x.recipient_id === C), "a member reads only gifts they sent or received (RLS)");
ok((await as("authenticated", C, () => throws("update gift_sends set status = 'released' where sender_id = $1", [C]))) !== null, "and can't change them");

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
