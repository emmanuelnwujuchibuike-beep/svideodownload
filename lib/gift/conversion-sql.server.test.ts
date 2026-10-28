import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { checkConversionRules, type ConversionLeg, type FgcConversionRules, quoteLeg } from "@/lib/gift/conversion-rules";
import { loadPGlite } from "@/lib/testing/pglite-bridge";

/**
 * Frenz Gift Coin Part 2: the app's preview and the admin's validation (lib/gift/conversion-rules.ts) must say exactly
 * what the DATABASE says (0290 fgc_conversion_quote, 0291 fgc_conversion_rules_check). This runs the real function bodies,
 * taken from the migration, in PGlite. PGlite is not a repo dependency: when it can't be found this suite SKIPS (see
 * loadPGlite) — it never passes without running.
 */
const PGlite = await loadPGlite();
type Pg = { exec(sql: string): Promise<unknown>; query<T>(sql: string, p?: unknown[]): Promise<{ rows: T[] }>; close(): Promise<void> };
let pg: Pg;

/** The LAST `create or replace function public.<name>(` statement in `sql` (the newest definition wins, as in production). */
const fnFrom = (sql: string, name: string) => {
  const start = sql.lastIndexOf(`create or replace function public.${name}(`);
  const body = sql.indexOf("$$", sql.indexOf("as $$", start) + 5);
  if (start < 0 || body < 0) throw new Error(`no function ${name}`);
  return sql.slice(start, body + 3);
};

beforeAll(async () => {
  if (!PGlite) return;
  pg = new PGlite() as unknown as Pg;
  // 0290 then 0291 (which restates the rules check with the smallest-conversion rule)
  const sql = ["0290_frenz_gift_coin_conversion.sql", "0291_frenz_gift_settings_stickers.sql"].map((f) => readFileSync(join(process.cwd(), "supabase/migrations", f), "utf8")).join(String.fromCharCode(10));
  await pg.exec(fnFrom(sql, "fgc_conversion_quote"));
  await pg.exec(fnFrom(sql, "fgc_conversion_rules_check"));
}, 60_000);
afterAll(async () => {
  await pg?.close();
});

const LEG: ConversionLeg = { rateNum: 1, rateDen: 1, feeBp: 200, feeFlat: 0, minIn: 1, maxIn: 50_000_000_000, dailyMaxIn: 900_000_000_000 };
let seed = 2026;
const rnd = (n: number) => ((seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648), seed % n);

describe.skipIf(!PGlite)("lib/gift/conversion-rules.ts = 0290 in SQL", () => {
  it("quotes are identical on 600 random legs and amounts (incl. large ones)", async () => {
    for (let i = 0; i < 600; i++) {
      // outputs stay under 2^53, as checkConversionRules guarantees for every allowed amount
      const large = i % 3 === 0;
      const leg: ConversionLeg = { ...LEG, rateNum: 1 + rnd(large ? 1_000_000 : 999_999_999), rateDen: 1 + rnd(999_999_999), feeBp: rnd(5_001), feeFlat: rnd(3) ? 0 : rnd(10_000) };
      const amount = 1 + (large ? rnd(2_000_000_000) : rnd(50_000));
      const ts = quoteLeg(amount, leg);
      const { rows } = await pg.query<{ q: Record<string, string | number> }>("select fgc_conversion_quote($1, $2::jsonb) q", [amount, JSON.stringify(leg)]);
      const q = rows[0]!.q;
      expect({ gross: Number(q.gross), remainder: Number(q.remainder), percent: Number(q.percent), fee: Number(q.fee), net: Number(q.net) }, JSON.stringify({ amount, leg })).toEqual({
        gross: ts.gross,
        remainder: ts.remainder,
        percent: ts.percent,
        fee: ts.fee,
        net: ts.net,
      });
    }
  }, 60_000);

  it("the rules verdicts are identical (valid, every invalid field, arbitrage) on 400 rule sets", async () => {
    const base: FgcConversionRules = { version: 1, fcToFgc: LEG, fgcToFc: { ...LEG, feeBp: 500, feeFlat: 1 } };
    const cases: unknown[] = [null, "x", base, { ...base, version: 0 }, { version: 1, fcToFgc: LEG }];
    for (let i = 0; i < 400; i++) {
      const pick = (): ConversionLeg => ({ ...LEG, rateNum: 1 + rnd(20), rateDen: 1 + rnd(20), feeBp: [0, 0, 1, 100, 5_000, 5_001][rnd(6)]!, feeFlat: [0, 0, 1, -1][rnd(4)]!, minIn: [1, 100, 0][rnd(3)]!, maxIn: [1_000, 99, 99_999_999_999][rnd(3)]! });
      cases.push({ version: [1, 7, 0][rnd(3)], fcToFgc: pick(), fgcToFc: pick() });
    }
    for (const c of cases) {
      const ts = checkConversionRules(c);
      const { rows } = await pg.query<{ r: string | null }>("select fgc_conversion_rules_check($1::jsonb) r", [c === null ? null : JSON.stringify(c)]);
      expect(rows[0]!.r, JSON.stringify(c)).toBe(ts.ok ? null : ts.detail);
    }
  }, 60_000);
});
