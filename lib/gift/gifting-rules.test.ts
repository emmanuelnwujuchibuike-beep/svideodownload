import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadPGlite } from "@/lib/testing/pglite-bridge";

import { checkGiftingRules, giftSplit } from "./gifting-rules";

/**
 * Frenz Gift Coin Part 4: the gifting rules and the split, and that this module says exactly what the database says
 * (0293 gift_rules_check, and send_gift's floor arithmetic). Test-only values. The SQL half runs the real function body
 * from the migration in PGlite and SKIPS when PGlite isn't installed (lib/testing/pglite-bridge) — never passes unrun.
 */
const RULES = { version: 1, recipientShareBp: 9000, commissionBp: 1000, holdHours: 72, senderCooldownHours: 0, dailyMaxFgc: 10_000_000 };

describe("checkGiftingRules", () => {
  it("no rules = gifting_missing: gifting stays off, nothing filled in", () => {
    expect(checkGiftingRules(null)).toMatchObject({ ok: false, code: "gifting_missing" });
    expect(checkGiftingRules(undefined)).toMatchObject({ ok: false, code: "gifting_missing" });
  });
  it("valid rules pass unchanged (extra fields are not kept)", () => {
    const r = checkGiftingRules({ ...RULES, extra: 1 });
    expect(r).toEqual({ ok: true, rules: RULES });
  });
  it.each([
    ["the split is not exactly 100%", { ...RULES, commissionBp: 1100 }, "gifting_invalid:split"],
    ["the recipient gets nothing", { ...RULES, recipientShareBp: 0, commissionBp: 10_000 }, "gifting_invalid:recipientShareBp"],
    ["a fractional share", { ...RULES, recipientShareBp: 9000.5 }, "gifting_invalid:recipientShareBp"],
    ["a zero hold (earnings spendable at once)", { ...RULES, holdHours: 0 }, "gifting_invalid:holdHours"],
    ["a hold over 90 days", { ...RULES, holdHours: 2161 }, "gifting_invalid:holdHours"],
    ["a negative cooldown", { ...RULES, senderCooldownHours: -1 }, "gifting_invalid:senderCooldownHours"],
    ["no daily limit", { ...RULES, dailyMaxFgc: 0 }, "gifting_invalid:dailyMaxFgc"],
    ["a version of 0", { ...RULES, version: 0 }, "gifting_invalid:version"],
  ])("refuses: %s", (_, raw, detail) => {
    expect(checkGiftingRules(raw)).toMatchObject({ ok: false, code: "gifting_invalid", detail });
  });
});

describe("giftSplit: the recipient's share rounds DOWN, the platform keeps the remainder, integers only", () => {
  it.each([
    [5000, 9000, 4500, 500],
    [1001, 9000, 900, 101],
    [1, 9000, 0, 1],
    [999_999_999_999, 9000, 899_999_999_999, 100_000_000_000],
    [7, 10_000, 7, 0],
    [12_345, 3333, 4114, 8231],
  ])("price %i at %i bp → share %i, commission %i", (price, bp, share, commission) => {
    expect(giftSplit(price, bp)).toEqual({ share, commission });
  });
  it("share + commission is always the whole price", () => {
    for (let p = 1; p < 3000; p += 7) for (const bp of [1, 4999, 9000, 9999, 10_000]) {
      const s = giftSplit(p, bp);
      expect(s.share + s.commission).toBe(p);
      expect(s.share).toBe(Math.floor((p * bp) / 10_000));
    }
  });
});

const PGlite = await loadPGlite();
type Pg = { exec(sql: string): Promise<unknown>; query<T>(sql: string, p?: unknown[]): Promise<{ rows: T[] }>; close(): Promise<void> };
let pg: Pg;
beforeAll(async () => {
  if (!PGlite) return;
  pg = new PGlite() as unknown as Pg;
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/0293_frenz_gift_sends.sql"), "utf8");
  const start = sql.indexOf("create or replace function public.gift_rules_check(");
  const end = sql.indexOf("$$;", sql.indexOf("as $$", start) + 5) + 3;
  await pg.exec(sql.slice(start, end));
}, 60_000);
afterAll(async () => {
  await pg?.close();
});

describe.skipIf(!PGlite)("lib/gift/gifting-rules.ts = 0293 in SQL", () => {
  it("gift_rules_check and checkGiftingRules give the same verdict on 300 rule sets", async () => {
    let seed = 7;
    const rnd = (n: number) => ((seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648), seed % n);
    const cases: unknown[] = [null, "x", RULES];
    for (let i = 0; i < 300; i++) {
      const share = [9000, 0, 10_000, 1, 5000, 10_001][rnd(6)]!;
      cases.push({ version: [1, 0, 3][rnd(3)], recipientShareBp: share, commissionBp: [10_000 - share, 1000, 0][rnd(3)], holdHours: [72, 0, 1, 2160, 2161][rnd(5)], senderCooldownHours: [0, 48, 2161][rnd(3)], dailyMaxFgc: [1, 0, 10_000][rnd(3)] });
    }
    for (const c of cases) {
      const ts = checkGiftingRules(c);
      const { rows } = await pg.query<{ r: string | null }>("select gift_rules_check($1::jsonb) r", [c === null ? null : JSON.stringify(c)]);
      expect(rows[0]!.r, JSON.stringify(c)).toBe(ts.ok ? null : ts.detail);
    }
  }, 60_000);
  it("the database's split (div(price × bp, 10000)) equals giftSplit", async () => {
    for (const [price, bp] of [[5000, 9000], [1001, 9000], [12_345, 3333], [999_999_999_999, 9000], [1, 10_000]] as const) {
      const { rows } = await pg.query<{ s: string }>("select div($1::numeric * $2, 10000)::bigint::text s", [price, bp]);
      expect(Number(rows[0]!.s)).toBe(giftSplit(price, bp).share);
    }
  }, 60_000);
});
