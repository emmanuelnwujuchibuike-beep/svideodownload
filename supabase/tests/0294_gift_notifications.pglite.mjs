// 0294 (Frenz Gift Coin Part 4.1) — the gift-notification outbox and the two gift switches, against the REAL functions
// in PGlite. Run like the other coin suites (next to credit_wallet.shared.mjs, with @electric-sql/pglite installed):
//   node 0294_gift_notifications.pglite.mjs <repo>/supabase/migrations [--mutant=<name>]
//
// The same build as 0293_gift_sends.pglite.mjs (its setup is shared verbatim), then 0294 twice. Pinned: a committed gift
// has exactly two pending notifications (push, email) written in its own transaction, a refused or rolled-back gift has
// none, a replay adds none; one claim wins, a sent row is never claimed again and its outcome never rewritten, nothing is
// marked sent without a claim; failures retry at most three times then stay visible; stale claims are recovered; a
// reversed gift is never announced; the two switches default on, change independently, only on the member's own row;
// the outbox is the server's alone.
//
// --mutant=<name> breaks one protection and the run must FAIL:
//   no-claim-guard      a claim ignores the status     -> the same notification claimed (sent) twice
//   announce-reversed   a reversed gift is claimable   -> a reversed gift announced as received
//   no-enqueue          the gift trigger is dropped    -> a gift with no notification
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


// ══════════════════════════ 0294 — gift notifications ══════════════════════════
const m294 = (d) => split(readFileSync(`${d}/0294_gift_notifications.sql`, "utf8"));
await run(m294(dir));
await run(m294(dir));
if (MUTANT === "no-claim-guard") await mutate("claim_gift_notification", "and (status = 'pending' or (status = 'failed' and attempts < 3) or (status = 'sending' and claimed_at < now() - interval '15 minutes'))", "");
if (MUTANT === "announce-reversed") await mutate("claim_gift_notification", "if v_g.status = 'reversed' then", "if false then");
if (MUTANT === "no-enqueue") await db.exec("drop trigger gift_sends_notify on public.gift_sends");

await saveRules(RULES, 0);
currentRules = await stored();
await fgcAdjust(A, 100_000, "fund-a-294");
const outbox = (giftId) => q("select channel, status, reason, attempts from gift_notifications where gift_id = $1 order by channel", [giftId]);
const claim = (g, ch) => rpc("select claim_gift_notification($1, $2)", [g, ch]);
const finish = (g, ch, st, why = null) => rpc("select finish_gift_notification($1, $2, $3, $4)", [g, ch, st, why]);

// ═══ 1 · the outbox is written with the gift, atomically ═══
let g = await send(A, AB, ROSE);
ok(g?.ok === true, "a gift commits");
let rows = await outbox(g.gift_id);
ok(J(rows) === J([{ channel: "email", status: "pending", reason: null, attempts: 0 }, { channel: "push", status: "pending", reason: null, attempts: 0 }]), "it has exactly two pending notifications, push and email");
ok((await one("select recipient_id from gift_notifications where gift_id = $1 limit 1", [g.gift_id])).recipient_id === B, "addressed to the recipient, never the sender");
const before = (await one("select count(*)::int n from gift_notifications")).n;
const refused = await send(A, AB, ROSE, { price: 1 });
ok(refused?.ok === false && (await one("select count(*)::int n from gift_notifications")).n === before, "a refused gift has no notification");
await db.exec(`create function public.boom() returns trigger language plpgsql as $$ begin if new.idempotency_key = 'boom-key-0294' then raise exception 'boom'; end if; return new; end $$;
  create trigger gift_boom before insert on public.gift_sends for each row execute function public.boom()`);
await send(A, AB, ROSE, { key: "boom-key-0294" });
await db.exec("drop trigger gift_boom on public.gift_sends; drop function public.boom()");
ok((await one("select count(*)::int n from gift_notifications")).n === before, "a gift rolled back at its last step leaves no notification");
const replay = await send(A, AB, ROSE, { key: (await one("select idempotency_key k from gift_sends where id = $1", [g.gift_id])).k });
ok(replay?.duplicate === true && (await one("select count(*)::int n from gift_notifications where gift_id = $1", [g.gift_id])).n === 2, "a replayed gift request adds no notification");

// ═══ 2 · claim once, finish once ═══
let c1 = await claim(g.gift_id, "push");
let c2 = await claim(g.gift_id, "push");
ok(c1?.ok === true && c1.recipient_id === B && c1.sender_id === A && c1.conversation_id === AB && c1.sticker_name === "red-rose", "the first claim wins and says who, from whom, which chat, which sticker");
ok(c2?.ok === false && c2.reason === "not_due", "a second, simultaneous claim gets nothing (no double send)");
ok((await finish(g.gift_id, "push", "sent")) === true, "the claimed send is recorded as sent");
ok((await claim(g.gift_id, "push"))?.reason === "not_due", "a sent notification is never claimed again (a replay or a retry sends nothing)");
ok((await finish(g.gift_id, "push", "failed")) === false, "and its outcome can't be rewritten");
ok((await finish(g.gift_id, "email", "sent")) === false, "an outcome without a claim is refused (nothing marked delivered that wasn't sent)");

// ═══ 3 · failures retry, at most three tries; stale claims are recovered ═══
c1 = await claim(g.gift_id, "email");
await finish(g.gift_id, "email", "failed", "email_refused");
ok((await outbox(g.gift_id)).find((r) => r.channel === "email").status === "failed", "a refused email is recorded as failed");
const due1 = await rpc("select due_gift_notifications(50)");
ok(due1.some((d) => d.gift_id === g.gift_id && d.channel === "email"), "the sweep lists it for a retry");
await claim(g.gift_id, "email");
await finish(g.gift_id, "email", "failed", "email_refused");
await claim(g.gift_id, "email");
await finish(g.gift_id, "email", "failed", "email_refused");
const after3 = (await outbox(g.gift_id)).find((r) => r.channel === "email");
ok(after3.attempts === 3 && (await claim(g.gift_id, "email"))?.reason === "not_due", "after three failed tries it stays failed, visible, and is not tried again");
ok(!(await rpc("select due_gift_notifications(50)")).some((d) => d.gift_id === g.gift_id && d.channel === "email"), "and the sweep no longer lists it");
const g2 = await send(A, AB, ROSE);
await claim(g2.gift_id, "push");
ok((await claim(g2.gift_id, "push"))?.reason === "not_due", "a claim in progress is not taken twice");
await db.query("update gift_notifications set claimed_at = now() - interval '16 minutes' where gift_id = $1 and channel = 'push'", [g2.gift_id]);
ok((await claim(g2.gift_id, "push"))?.ok === true, "a claim abandoned for over 15 minutes (a crashed dispatch) is taken again");
await db.query("update gift_notifications set created_at = now() - interval '3 minutes' where gift_id = $1 and channel = 'email'", [g2.gift_id]);
ok((await rpc("select due_gift_notifications(50)")).some((d) => d.gift_id === g2.gift_id && d.channel === "email"), "a notification the after-response dispatch never reached is picked up by the sweep");

// ═══ 4 · a reversed gift is never announced as received ═══
const g3 = await send(A, AB, ROSE);
await rpc("select reverse_gift($1, $2, $3)", [g3.gift_id, ADMIN, "chargeback"]);
const cr = await claim(g3.gift_id, "push");
ok(cr?.ok === false && cr.reason === "reversed", "claiming a reversed gift answers 'reversed'");
ok((await outbox(g3.gift_id)).find((r) => r.channel === "push").status === "skipped" && (await outbox(g3.gift_id)).find((r) => r.channel === "push").reason === "reversed", "and records it skipped (reversed), final");

// ═══ 5 · the two switches: on by default, independent, the member's own ═══
await db.query("insert into notification_settings (user_id) values ($1) on conflict do nothing", [B]);
let ns = await one("select gift_push, gift_email from notification_settings where user_id = $1", [B]);
ok(ns.gift_push === true && ns.gift_email === true, "both gift switches default to on");
await db.query("update notification_settings set gift_push = false where user_id = $1", [B]);
ns = await one("select gift_push, gift_email from notification_settings where user_id = $1", [B]);
ok(ns.gift_push === false && ns.gift_email === true, "turning push off leaves email on");
await db.query("update notification_settings set gift_email = false, gift_push = true where user_id = $1", [B]);
ns = await one("select gift_push, gift_email from notification_settings where user_id = $1", [B]);
ok(ns.gift_push === true && ns.gift_email === false, "turning email off leaves push on");
await db.query("insert into notification_settings (user_id) values ($1) on conflict do nothing", [C]);
const asUser = async (uid, sql, params = []) => { await db.exec("set role authenticated"); await db.query("select set_config('test.uid', $1, false)", [uid]); try { return await db.query(sql, params); } finally { await db.exec("reset role"); await db.query("select set_config('test.uid', '', false)"); } };
const other = await asUser(B, "update notification_settings set gift_push = false where user_id = $1", [C]);
ok(other.affectedRows === 0 && (await one("select gift_push from notification_settings where user_id = $1", [C])).gift_push === true, "a member can't change another member's switches (RLS: own row only)");
const own = await asUser(C, "update notification_settings set gift_email = false where user_id = $1", [C]);
ok(own.affectedRows === 1, "a member can change their own");

// ═══ 6 · nobody but the server touches the outbox ═══
for (const role of ["anon", "authenticated"]) {
  for (const [what, sql] of [
    ["read gift_notifications", "select * from gift_notifications"],
    ["claim", `select claim_gift_notification('${g.gift_id}', 'push')`],
    ["finish", `select finish_gift_notification('${g.gift_id}', 'push', 'sent')`],
    ["list due", "select due_gift_notifications(10)"],
  ]) {
    await db.exec(`set role ${role}`);
    const e = await throws(sql);
    await db.exec("reset role");
    ok(/permission denied/.test(e ?? ""), `${role} cannot ${what}`);
  }
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
