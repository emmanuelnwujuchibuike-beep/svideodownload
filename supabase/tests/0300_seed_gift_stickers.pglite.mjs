// 0300 — the first sticker gallery, against the REAL 0291 sticker tables, guard trigger and admin save in PGlite. Run
// next to credit_wallet.shared.mjs:   node 0300_seed_gift_stickers.pglite.mjs <repo>/supabase/migrations [--mutant=no-skip]
// Pinned: the twelve stickers land published at the gallery prices (hundredths) with revision 1 in the history; a
// re-run adds nothing; an admin's price change survives a re-run and the admin save can still change it; the guard
// still refuses a direct write outside the seed.
import { readFileSync } from "node:fs";

import { PGlite } from "@electric-sql/pglite";

import { split, STUB } from "./credit_wallet.shared.mjs";

const dir = process.argv[2];
const MUTANT = (process.argv.find((a) => a.startsWith("--mutant=")) ?? "").split("=")[1] ?? "";
const db = new PGlite();
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; console.log("FAIL:", m); } else console.log("ok:", m); };
const run = async (stmts) => { for (const s of stmts) { try { await db.exec(s); } catch (e) { console.log("SQL ERROR:", e.message, "\n", s.slice(0, 200)); process.exit(2); } } };
const read = (f) => readFileSync(`${dir}/${f}`, "utf8");
const stmt = (file, startsWith) => { const s = split(read(file)).find((x) => x.trim().startsWith(startsWith)); if (!s) throw new Error(`${file}: no statement ${startsWith}`); return s; };
const val = async (sql, p = []) => Object.values((await db.query(sql, p)).rows[0] ?? {})[0];
const F = "0291_frenz_gift_settings_stickers.sql";

await run(split(STUB));
await run([
  "create table if not exists public.financial_audit_log (id bigint generated always as identity primary key, actor_id uuid, action text, target_type text, target_id text, reference text, details jsonb)",
  "create table if not exists public.config_audit_log (id bigint generated always as identity primary key, actor_id uuid, surface text, target_id text, action text, before jsonb, after jsonb)",
  "create or replace function public.financial_append_only_guard() returns trigger language plpgsql as $$ begin raise exception 'append only'; end $$",
  stmt(F, "create table if not exists public.gift_stickers"),
  stmt(F, "create unique index if not exists gift_stickers_slug_uidx"),
  stmt(F, "create table if not exists public.gift_sticker_revisions"),
  stmt(F, "create or replace function public.gift_sticker_guard"),
  stmt(F, "create or replace function public.gift_sticker_field_problem"),
  stmt(F, "create or replace function public.admin_save_gift_sticker"),
  "create trigger gift_stickers_guard before insert or update or delete on public.gift_stickers for each row execute function public.gift_sticker_guard()",
  "create trigger gift_sticker_revisions_writer before insert on public.gift_sticker_revisions for each row execute function public.gift_sticker_guard()",
]);

let seed = read("0300_seed_gift_stickers.sql");
if (MUTANT === "no-skip") seed = seed.replace("if exists (select 1 from public.gift_stickers where slug = r.slug) then continue; end if;", "");
await run(split(seed));

ok(Number(await val("select count(*) from gift_stickers where published and archived_at is null")) === 12, "twelve stickers, published");
ok(Number(await val("select price_fgc from gift_stickers where slug = 'heart'")) === 2000 && Number(await val("select price_fgc from gift_stickers where slug = 'crown'")) === 50000, "the gallery prices, in hundredths (20 and 500 coins)");
ok((await val("select image_url from gift_stickers where slug = 'rocket'")) === "https://frenzsave.com/stickers/rocket.svg", "artwork from /stickers");
ok(Number(await val("select count(*) from gift_sticker_revisions where revision = 1 and changed = array['created']")) === 12, "each has revision 1 in the history");

// the admin changes a price — then the seed runs again
const heart = await val("select id from gift_stickers where slug = 'heart'");
const saved = await val("select admin_save_gift_sticker('00000000-0000-4000-8000-0000000000aa', $1, 1, '{\"priceFgc\": 2500}'::jsonb)", [heart]);
ok(saved?.ok === true && Number(await val("select price_fgc from gift_stickers where slug = 'heart'")) === 2500, "the admin can change a seeded sticker's price");
let again = null;
try {
  await run(split(seed));
  again = "ran";
} catch {
  again = "error";
}
ok(again === "ran" && Number(await val("select count(*) from gift_stickers")) === 12, "a second run adds nothing");
ok(Number(await val("select price_fgc from gift_stickers where slug = 'heart'")) === 2500, "and keeps the admin's price");

let blocked = false;
try {
  await db.exec("insert into gift_stickers (slug, name, price_fgc) values ('sneaky', 'Sneaky', 1)");
} catch {
  blocked = true;
}
ok(blocked, "a direct write outside the seed is still refused by the guard");

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
