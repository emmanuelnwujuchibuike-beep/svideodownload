// 0291 (Frenz Gift Coin Part 3) — persistent conversion settings and the sticker catalogue, against the REAL functions
// in PGlite. Run like the other coin suites (from a folder where @electric-sql/pglite is installed, next to
// credit_wallet.shared.mjs):
//   node 0291_gift_settings_stickers.pglite.mjs <repo>/supabase/migrations [--mutant=<name>]
//
// Builds the wallet with Supabase's default grants, applies 0278–0284 and 0290 twice each, then 0291 twice. Pinned:
//   the landing row: a save of any other section keeps frenzGift and every unknown key (and a forged frenzGift in the
//     payload is ignored), in both orders of interleaving
//   the gift settings: unconfigured until saved, version 1 on the first save, no bump for an identical save, a bump for
//     any leg change, a stale version refused, invalid / arbitrage / minimum-net rules refused with the stored value
//     untouched, extra fields never stored, every save and refusal audited with the admin and the before/after
//   the engine: convert_fgc on the stored rules, a stale quote (expected version 1 after version 2) refused, the
//     earlier conversion keeping its own snapshot
//   stickers: every field validated (the price above all), publishing needs artwork, archive is unpublish + kept,
//     restore, stale revisions refused, each change a new revision while old revisions keep their price, nothing
//     deleted, no write outside the function, gift_sticker_offer only for a published, not archived sticker
//   grants: anon / authenticated can call none of it and read none of it
//
// --mutant=<name> breaks one protection and the run must FAIL:
//   overwrite-landing   save_landing_settings replaces the whole row               -> a landing save erases frenzGift
//   no-stale            save_frenz_gift_conversion ignores the expected version   -> a stale save overwrites
//   always-bump         an identical save bumps the version                        -> needless version bumps
//   no-min-net          the smallest-conversion rule is removed                    -> rules that convert nothing are saved
//   sticker-delete      the sticker guard is dropped                               -> a sticker can be deleted
//   price-unchecked     the sticker price check is removed from the function      -> a zero price reaches the table check
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
const hold284 = (d) => split(readFileSync(`${d}/0284_frenz_coin_deposit_hold.sql`, "utf8"));
const part3 = (d) => split(readFileSync(`${d}/0291_frenz_gift_settings_stickers.sql`, "utf8"));

await run(split(STUB));
await run([
  "grant usage on schema auth to anon, authenticated, service_role",
  "alter default privileges in schema public grant all on tables to anon, authenticated, service_role",
  "alter default privileges in schema public grant all on functions to anon, authenticated, service_role",
  // 0001's settings table and 0093's config_audit_log, as production has them
  "create table public.settings (id uuid primary key default gen_random_uuid(), key text not null unique, value jsonb not null default '{}'::jsonb)",
  "alter table public.settings enable row level security",
  stmt("0093_config_governance.sql", "create table if not exists public.config_audit_log"),
]);
await run(walletStatements(dir));
await run(depositPrerequisites(dir));
for (const m of [migration, coinMigration, depositMigration, scopeMigration, pinMigration, closeoutMigration, hold284, giftMigration]) { await run(m(dir)); await run(m(dir)); }
await run(part3(dir));
await run(part3(dir));
await db.exec(`insert into auth.users (id, email, email_confirmed_at) select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'u' || g || '@t.test', now() from generate_series(1, 30) g`);
await db.exec(`insert into public.profiles (id) select id from auth.users`);

// ── mutants ──
const fnBody = async (name) => (await one("select pg_get_functiondef(p.oid) d from pg_proc p where p.proname = $1", [name])).d;
const mutate = async (name, from, to) => { const b = await fnBody(name); const m = b.split(from).join(to); if (m === b) throw new Error(`mutant on ${name} did not apply`); await db.exec(m); };
if (MUTANT === "overwrite-landing") await mutate("save_landing_settings", "(case when jsonb_typeof(public.settings.value) = 'object' then public.settings.value else '{}'::jsonb end) || (excluded.value - 'frenzGift')", "excluded.value");
if (MUTANT === "no-stale") await mutate("save_frenz_gift_conversion", "if p_expected_version <> v_ver then", "if false then");
if (MUTANT === "always-bump") await mutate("save_frenz_gift_conversion", "if v_cur is not null and (v_cur - 'version') = v_legs then", "if false then");
if (MUTANT === "no-min-net") await mutate("fgc_conversion_rules_check", "if (public.fgc_conversion_quote((l ->> 'minIn')::bigint, l) ->> 'net')::bigint < 1 then", "if false then");
if (MUTANT === "sticker-delete") await db.exec("drop trigger gift_stickers_guard on public.gift_stickers");
if (MUTANT === "price-unchecked") await mutate("gift_sticker_field_problem", "when 'priceFgc' then if jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}') !~ '^[1-9][0-9]{0,10}$' then return 'priceFgc'; end if;", "when 'priceFgc' then null;");

const ADMIN = U(29), ADMIN2 = U(28);
const LEG_A = { rateNum: 1, rateDen: 1, feeBp: 200, feeFlat: 0, minIn: 100, maxIn: 1_000_000, dailyMaxIn: 3_000_000 };
const LEG_B = { rateNum: 1, rateDen: 1, feeBp: 500, feeFlat: 1, minIn: 100, maxIn: 1_000_000, dailyMaxIn: 3_000_000 };
const J = JSON.stringify;
const landing = async () => (await one("select value from settings where key = 'landing'"))?.value ?? null;
const saveLanding = (v) => throws("select save_landing_settings($1::jsonb)", [J(v)]);
const saveGift = (legs, expected, admin = ADMIN) => rpc("select save_frenz_gift_conversion($1, $2::jsonb, $3, $4::jsonb)", [admin, J(legs), expected, J({ app_check: "valid" })]);
const count = async (sql, params = []) => Number((await one(sql, params)).n);

// ═══ 1 · the landing row keeps what it doesn't send ═══
ok((await landing()) === null, "no landing row yet");
let g = await saveGift({ fcToFgc: LEG_A, fgcToFc: LEG_B }, 0);
ok(g?.ok === true && g.version === 1 && g.conversion.version === 1, "the first gift save over 'not configured' (version 0) stores version 1, creating the row");
await saveLanding({ reelsPosterUrl: "", frenzCoin: { enabled: false, version: 3 }, frenzAiFreeDailyCredits: 2 });
let v = await landing();
ok(v.frenzGift?.conversion?.version === 1 && v.frenzGift.conversion.fcToFgc.feeBp === 200, "a landing save (reels poster, Frenz Coin, AI credits) keeps frenzGift exactly");
ok(v.frenzCoin.version === 3 && v.reelsPosterUrl === "", "and stores what it sent");
await db.exec(`update settings set value = value || '{"futureSection": {"x": 1}}'::jsonb where key = 'landing'`);
await saveLanding({ reelsPosterUrl: "https://example.test/p.webp", frenzGift: { conversion: null }, frenzCoin: { enabled: true, version: 4 } });
v = await landing();
ok(v.frenzGift?.conversion?.version === 1, "a payload carrying its own (stale or forged) frenzGift cannot replace the stored one");
ok(v.futureSection?.x === 1, "a key this build doesn't know is kept");
ok(v.reelsPosterUrl === "https://example.test/p.webp" && v.frenzCoin.version === 4, "the keys it sent replace their stored values");
g = await saveGift({ fcToFgc: { ...LEG_A, feeBp: 300 }, fgcToFc: LEG_B }, 1);
v = await landing();
ok(g?.ok === true && g.version === 2 && v.reelsPosterUrl === "https://example.test/p.webp" && v.frenzCoin.version === 4 && v.futureSection?.x === 1, "a gift save keeps every other section (the other order)");
ok((await throws("select save_landing_settings('[1]'::jsonb)")) !== null, "the landing writer refuses a non-object");

// ═══ 2 · versioning, stale saves, no needless bumps ═══
const audits = async (action) => count("select count(*) n from financial_audit_log where action = $1", [action]);
const updates0 = await audits("gift_conversion_config_updated");
g = await saveGift({ fcToFgc: { ...LEG_A, feeBp: 300 }, fgcToFc: LEG_B }, 2);
ok(g?.ok === true && g.unchanged === true && g.version === 2, "saving the same legs again: unchanged, still version 2");
ok((await audits("gift_conversion_config_updated")) === updates0, "and nothing is written or audited");
for (const [why, change] of [["the FC → FGC rate", { fcToFgc: { ...LEG_A, feeBp: 300, rateNum: 99, rateDen: 100 } }], ["the FGC → FC flat fee", { fgcToFc: { ...LEG_B, feeFlat: 2 } }], ["a daily limit", { fgcToFc: { ...LEG_B, feeFlat: 2, dailyMaxIn: 2_000_000 } }], ["a minimum", { fcToFgc: { ...LEG_A, feeBp: 300, rateNum: 99, rateDen: 100, minIn: 200 } }]]) {
  const cur = (await landing()).frenzGift.conversion;
  const legs = { fcToFgc: change.fcToFgc ?? cur.fcToFgc, fgcToFc: change.fgcToFc ?? cur.fgcToFc };
  const r = await saveGift(legs, cur.version);
  ok(r?.ok === true && r.version === cur.version + 1, `changing ${why} bumps the version (${cur.version} → ${r?.version})`);
}
const ver = (await landing()).frenzGift.conversion.version;
const before = J((await landing()).frenzGift);
g = await saveGift({ fcToFgc: LEG_A, fgcToFc: LEG_B }, ver - 1, ADMIN2);
ok(g?.ok === false && g.reason === "stale" && g.version === ver, "a save over an older version (another admin saved meanwhile) is refused: stale");
ok(J((await landing()).frenzGift) === before, "and changes nothing");
ok((await count("select count(*) n from financial_audit_log where action = 'gift_conversion_config_rejected' and actor_id = $1 and details->>'reason' = 'stale'", [ADMIN2])) === 1, "the stale attempt is audited with that admin");

// ═══ 3 · invalid rules are refused, the stored value untouched ═══
for (const [why, legs, detail] of [
  ["arbitrage (1:1, no fees)", { fcToFgc: { ...LEG_A, feeBp: 0 }, fgcToFc: { ...LEG_B, feeBp: 0, feeFlat: 0 } }, "config_arbitrage"],
  ["a fee over 50%", { fcToFgc: { ...LEG_A, feeBp: 5001 }, fgcToFc: LEG_B }, "config_invalid:fcToFgc.feeBp"],
  ["a zero denominator", { fcToFgc: { ...LEG_A, rateDen: 0 }, fgcToFc: LEG_B }, "config_invalid:fcToFgc.rateDen"],
  ["max below min", { fcToFgc: LEG_A, fgcToFc: { ...LEG_B, minIn: 500, maxIn: 400 } }, "config_invalid:fgcToFc.maxIn"],
  ["a smallest conversion that gives nothing after the fee", { fcToFgc: { ...LEG_A, minIn: 1, feeFlat: 1 }, fgcToFc: LEG_B }, "config_invalid:fcToFgc.minNet"],
  ["an overflowing range", { fcToFgc: { ...LEG_A, rateNum: 999_999_999, maxIn: 99_999_999_999 }, fgcToFc: LEG_B }, "config_invalid:fcToFgc.range"],
  ["a fractional fee", { fcToFgc: { ...LEG_A, feeBp: 2.5 }, fgcToFc: LEG_B }, "config_invalid:fcToFgc.feeBp"],
  ["a missing leg", { fcToFgc: LEG_A }, "config_invalid:fgcToFc"],
]) {
  const r = await saveGift(legs, ver);
  ok(r?.ok === false && r.reason === "invalid" && r.detail === detail, `refused: ${why} (${r?.detail})`);
}
ok(J((await landing()).frenzGift) === before, "no refused save changed the stored rules");
ok((await count("select count(*) n from financial_audit_log where action = 'gift_conversion_config_rejected' and details->>'reason' like 'config_%'")) === 8, "every refusal is audited with its reason");
g = await saveGift({ fcToFgc: { ...LEG_A, injected: 999, version: 77 }, fgcToFc: { ...LEG_B, extra: "x" }, version: 1000 }, ver);
const stored = (await landing()).frenzGift.conversion;
ok(g?.ok === true && stored.version === ver + 1 && !("injected" in stored.fcToFgc) && !("extra" in stored.fgcToFc) && Object.keys(stored.fcToFgc).length === 7, "extra fields are never stored, and the caller can't choose the version");
const upd = await one("select actor_id, details from financial_audit_log where action = 'gift_conversion_config_updated' order by id desc limit 1");
ok(upd.actor_id === ADMIN && upd.details.version === ver + 1 && upd.details.before.version === ver && upd.details.after.version === ver + 1 && upd.details.validation.database_check === "valid" && upd.details.validation.app_check === "valid", "the save is audited: admin, before, after, version, validation outcome");
const cfg = await one("select actor_id, surface, action, after from config_audit_log where surface = 'frenz_gift' order by created_at desc limit 1");
ok(cfg?.actor_id === ADMIN && cfg.action === "settings.update" && cfg.after.conversion.version === ver + 1, "and in config_audit_log (the settings history) in the same transaction");
ok((await landing()).frenzGift.updatedBy === ADMIN && typeof (await landing()).frenzGift.updatedAt === "string", "the section records who saved it and when");

// ═══ 4 · the engine runs on the stored rules, and a stale quote is refused ═══
const M = U(5);
await rpc("select adjust_coin_balance($1, 100000, 'fund-m', 'test', $2, false)", [M, ADMIN]);
const rulesNow = (await landing()).frenzGift.conversion;
const c1 = await rpc("select convert_fgc($1, 'fc_to_fgc', 10000, 'k-m-000001', $2::jsonb, $3)", [M, J(rulesNow), rulesNow.version]);
ok(c1?.ok === true && c1.version === rulesNow.version, "a conversion with the stored rules and the version the member was shown succeeds");
await saveGift({ fcToFgc: { ...rulesNow.fcToFgc, feeBp: 400 }, fgcToFc: rulesNow.fgcToFc }, rulesNow.version);
const rulesNext = (await landing()).frenzGift.conversion;
const c2 = await rpc("select convert_fgc($1, 'fc_to_fgc', 10000, 'k-m-000002', $2::jsonb, $3)", [M, J(rulesNext), rulesNow.version]);
ok(c2?.ok === false && c2.reason === "rules_changed" && c2.version === rulesNext.version, "after the admin changes the fee, a quote shown under the old version is refused (rules_changed)");
const old = await one("select config_version::int v, fee_bp, rules_snapshot from fgc_conversions where id = $1", [c1.conversion_id]);
ok(old.v === rulesNow.version && old.fee_bp === rulesNow.fcToFgc.feeBp && old.rules_snapshot.version === rulesNow.version, "the earlier conversion keeps its own version, fee and snapshot");
ok((await rpc("select convert_fgc($1, 'fc_to_fgc', 10000, 'k-m-000003', null::jsonb, null)", [M]))?.reason === "config_missing", "no rules → config_missing (still the safeguard)");

// ═══ 5 · stickers ═══
const save = (id, rev, fields, admin = ADMIN) => rpc("select admin_save_gift_sticker($1, $2, $3, $4::jsonb)", [admin, id, rev, J(fields)]);
const IMG = "https://cdn.example.test/gift-stickers/rose.webp";
for (const [why, fields, field] of [
  ["a zero price", { slug: "a-zero", name: "Zero", priceFgc: 0 }, "priceFgc"],
  ["a fractional price", { slug: "a-frac", name: "Frac", priceFgc: 1.5 }, "priceFgc"],
  ["a price as text", { slug: "a-text", name: "Text", priceFgc: "100" }, "priceFgc"],
  ["a negative price", { slug: "a-neg", name: "Neg", priceFgc: -100 }, "priceFgc"],
  ["a price over the ceiling", { slug: "a-big", name: "Big", priceFgc: 100_000_000_000 }, "priceFgc"],
  ["a bad slug", { slug: "Bad Slug", name: "x", priceFgc: 100 }, "slug"],
  ["an empty name", { slug: "a-name", name: "   ", priceFgc: 100 }, "name"],
  ["an http image", { slug: "a-img", name: "x", priceFgc: 100, imageUrl: "http://x.test/a.webp" }, "imageUrl"],
  ["a bad category", { slug: "a-cat", name: "x", priceFgc: 100, category: "Love Hearts" }, "category"],
  ["an unknown rarity", { slug: "a-rar", name: "x", priceFgc: 100, rarity: "mythic" }, "rarity"],
  ["an unknown field", { slug: "a-unk", name: "x", priceFgc: 100, owner: "me" }, "unknown:owner"],
  ["no price", { slug: "a-none", name: "x" }, "priceFgc"],
]) {
  const r = await save(null, null, fields);
  ok(r?.ok === false && r.reason === "invalid" && r.field === field, `sticker refused: ${why} (${r?.field ?? r?.reason})`);
}
ok((await count("select count(*) n from gift_stickers")) === 0, "no refused sticker was stored");
ok((await save(null, null, { slug: "no-art", name: "No art", priceFgc: 500, published: true }))?.reason === "needs_artwork", "a sticker can't be published without artwork");
const s1 = await save(null, null, { slug: "red-rose", name: "Red Rose", description: "For someone special", rarity: "rare", priceFgc: 5000, category: "love", sortOrder: 2, imageUrl: IMG });
ok(s1?.ok === true && s1.sticker.revision === 1 && s1.sticker.published === false && s1.sticker.price_fgc === 5000, "a new sticker is created as a draft, revision 1, priced in FGC minor units");
const id = s1.sticker.id;
ok((await save(null, null, { slug: "red-rose", name: "Other", priceFgc: 100 }))?.reason === "slug_taken", "a slug is unique");
ok((await rpc("select gift_sticker_offer($1)", [id]))?.reason === "not_available", "a draft can't be bought");
let s = await save(id, 1, { published: true });
ok(s?.ok === true && s.sticker.revision === 2 && s.changed.includes("published"), "published: revision 2");
let offer = await rpc("select gift_sticker_offer($1)", [id]);
ok(offer?.ok === true && offer.revision === 2 && offer.price_fgc === 5000, "now it is on sale at revision 2, 50.00 FGC");
s = await save(id, 2, { priceFgc: 7500, name: "Red Rose Deluxe" });
ok(s?.ok === true && s.sticker.revision === 3 && s.changed.includes("price") && s.changed.includes("name"), "a re-price and rename: revision 3");
const r2 = await one("select price_fgc::int p, name from gift_sticker_revisions where sticker_id = $1 and revision = 2", [id]);
ok(r2.p === 5000 && r2.name === "Red Rose", "revision 2 still says 50.00 FGC and 'Red Rose' — a gift bought at revision 2 keeps what it was");
ok((await save(id, 2, { priceFgc: 1 }))?.reason === "stale", "an edit over an older revision is refused: stale");
ok((await save(id, 3, { priceFgc: 7500 }))?.unchanged === true && (await count("select count(*) n from gift_sticker_revisions where sticker_id = $1", [id])) === 3, "an edit that changes nothing writes no revision");
ok((await save(id, 3, { slug: "renamed" }))?.field === "slug_fixed", "the slug can't change");
ok((await save(id, 3, { priceFgc: 0 }))?.field === "priceFgc", "an edit to a zero price is refused");
s = await save(id, 3, { archived: true });
ok(s?.ok === true && s.sticker.published === false && s.sticker.archived_at !== null && s.changed.includes("archived") && s.changed.includes("unpublished"), "archive = removed from the gallery: unpublished, archived, kept");
ok((await rpc("select gift_sticker_offer($1)", [id]))?.reason === "not_available", "an archived sticker can't be bought");
ok((await save(id, 4, { published: true }))?.reason === "archived", "an archived sticker can't be published");
s = await save(id, 4, { archived: false });
ok(s?.ok === true && s.sticker.archived_at === null && s.sticker.published === false, "restored (still unpublished until published again)");
s = await save(id, 5, { published: true, imageUrl: null });
ok(s?.reason === "needs_artwork", "removing the artwork of a sticker being published is refused");
ok((await throws("delete from gift_stickers where id = $1", [id])) !== null, "a sticker can never be deleted");
ok((await throws("update gift_stickers set price_fgc = 1 where id = $1", [id])) !== null, "a direct write (outside the function) is refused");
ok((await throws("insert into gift_sticker_revisions (sticker_id, revision, slug, name, rarity, price_fgc, published, sort_order, featured, changed) values ($1, 99, 'x', 'x', 'common', 1, false, 0, false, '{}')", [id])) !== null, "a forged revision is refused");
ok((await throws("update gift_sticker_revisions set price_fgc = 1 where sticker_id = $1", [id])) !== null, "a revision can't be rewritten");
ok((await throws("delete from gift_sticker_revisions where sticker_id = $1", [id])) !== null, "or deleted");
const created = await one("select count(*)::int n from financial_audit_log where action = 'gift_sticker_created' and target_id = $1 and actor_id = $2", [id, ADMIN]);
const updated = await one("select count(*)::int n from financial_audit_log where action = 'gift_sticker_updated' and target_id = $1", [id]);
ok(created.n === 1 && updated.n === 4, `every sticker change is audited with the admin (1 created, ${updated.n} updated)`);
const priced = await one("select details from financial_audit_log where action = 'gift_sticker_updated' and target_id = $1 and details->'changed' ? 'price'", [id]);
ok(priced.details.before.price_fgc === 5000 && priced.details.after.price_fgc === 7500, "a re-price is audited with the old and new price");
const s2 = await save(null, null, { slug: "diamond", name: "Diamond", rarity: "legendary", priceFgc: 30000, featured: true, imageUrl: IMG, animationUrl: "https://cdn.example.test/gift-stickers/d-anim.webp", published: true });
ok(s2?.ok === true && s2.sticker.featured === true && s2.sticker.published === true && s2.sticker.animation_url, "a featured, animated sticker can be created and published at once (it has artwork)");

// ═══ 6 · grants ═══
const asRole = async (role, fn) => { await db.exec(`set role ${role}`); try { return await fn(); } finally { await db.exec("reset role"); } };
for (const role of ["anon", "authenticated"]) {
  for (const [what, sql] of [
    ["save_frenz_gift_conversion", `select save_frenz_gift_conversion('${ADMIN}', '{}'::jsonb, 0)`],
    ["save_landing_settings", "select save_landing_settings('{}'::jsonb)"],
    ["admin_save_gift_sticker", `select admin_save_gift_sticker('${ADMIN}', null, null, '{}'::jsonb)`],
    ["gift_sticker_offer", `select gift_sticker_offer('${id}')`],
    ["read gift_stickers", "select * from gift_stickers"],
    ["read gift_sticker_revisions", "select * from gift_sticker_revisions"],
  ]) ok(/permission denied/.test((await asRole(role, () => throws(sql))) ?? ""), `${role} cannot ${what}`);
}

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
