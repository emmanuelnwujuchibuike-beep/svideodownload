/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ GIFT COIN — THE GIFTING RULES AND THEIR ARITHMETIC (Frenz Gift Coin Part 4, migration 0293)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Pure (client-safe). The database is the authority: send_gift re-validates the rules it is handed (gift_rules_check),
 * computes the split, and stores the rules on the gift. This module is the same check for the admin editor and the
 * server (lib/gift/gifting-sql.server.test.ts keeps them equal).
 *
 *   recipientShareBp + commissionBp = 10 000 exactly (integer basis points), recipientShareBp ≥ 1
 *   holdHours            1 to 2160 — gift earnings are PENDING for this long, never immediately spendable
 *   senderCooldownHours  0 to 2160 — no gifting within this long of a deposit settling (FC is fungible, so a gift can't
 *                        be traced to the deposit that paid for it: this is the conservative chargeback guard)
 *   dailyMaxFgc          the rolling 24-hour total a member may gift, in FGC minor units
 *
 *   recipient share = floor(price × recipientShareBp / 10 000), commission = price − share (the rounding remainder is
 *   the platform's). A share under 1 unit is refused (below_minimum). No flat commission.
 *
 * Nothing here is a default: gifting stays off until an administrator saves rules.
 */

export interface GiftingRules {
  version: number;
  recipientShareBp: number;
  commissionBp: number;
  holdHours: number;
  senderCooldownHours: number;
  dailyMaxFgc: number;
}

export type GiftingFields = Omit<GiftingRules, "version">;

export const GIFTING_BOUNDS = {
  version: { min: 1, max: 999_999_999_999_999 },
  recipientShareBp: { min: 1, max: 10_000 },
  commissionBp: { min: 0, max: 9_999 },
  holdHours: { min: 1, max: 2_160 },
  senderCooldownHours: { min: 0, max: 2_160 },
  dailyMaxFgc: { min: 1, max: 999_999_999_999 },
} as const;

const FIELDS = ["version", "recipientShareBp", "commissionBp", "holdHours", "senderCooldownHours", "dailyMaxFgc"] as const;
const LABEL: Record<(typeof FIELDS)[number], string> = {
  version: "The version",
  recipientShareBp: "The recipient's share",
  commissionBp: "The commission",
  holdHours: "The earnings hold",
  senderCooldownHours: "The deposit cooldown",
  dailyMaxFgc: "The daily gifting limit",
};

export type GiftingCheck = { ok: true; rules: GiftingRules } | { ok: false; code: "gifting_missing" | "gifting_invalid"; detail: string; message: string };

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const inBounds = (v: unknown, b: { min: number; max: number }): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= b.min && v <= b.max;

/** Validate gifting rules EXACTLY as gift_rules_check does. Never fills in or adjusts a value. */
export function checkGiftingRules(raw: unknown): GiftingCheck {
  if (raw === null || raw === undefined) return { ok: false, code: "gifting_missing", detail: "gifting_missing", message: "Sticker gifting isn't configured yet." };
  if (!isRecord(raw)) return { ok: false, code: "gifting_invalid", detail: "gifting_invalid:shape", message: "The gifting rules must be an object." };
  for (const k of FIELDS) {
    // the database reads at most 5 digits for the basis points and hours, then checks the range
    if (!inBounds(raw[k], { min: 0, max: k === "version" ? GIFTING_BOUNDS.version.max : k === "dailyMaxFgc" ? GIFTING_BOUNDS.dailyMaxFgc.max : 99_999 }) || ((k === "version" || k === "dailyMaxFgc") && (raw[k] as number) < 1)) {
      return { ok: false, code: "gifting_invalid", detail: `gifting_invalid:${k}`, message: `${LABEL[k]} must be a whole number.` };
    }
  }
  const r = raw as unknown as GiftingRules;
  const bad = (k: string, message: string): GiftingCheck => ({ ok: false, code: "gifting_invalid", detail: `gifting_invalid:${k}`, message });
  if (!inBounds(r.recipientShareBp, GIFTING_BOUNDS.recipientShareBp)) return bad("recipientShareBp", "The recipient's share must be from 0.01% to 100%.");
  if (!inBounds(r.commissionBp, GIFTING_BOUNDS.commissionBp)) return bad("commissionBp", "The commission must be from 0% to 99.99%.");
  if (r.recipientShareBp + r.commissionBp !== 10_000) return bad("split", "The recipient's share and the commission must add up to exactly 100%.");
  if (!inBounds(r.holdHours, GIFTING_BOUNDS.holdHours)) return bad("holdHours", "The earnings hold must be from 1 to 2160 hours — earnings are never spendable at once.");
  if (!inBounds(r.senderCooldownHours, GIFTING_BOUNDS.senderCooldownHours)) return bad("senderCooldownHours", "The deposit cooldown must be from 0 to 2160 hours.");
  return { ok: true, rules: { version: r.version, recipientShareBp: r.recipientShareBp, commissionBp: r.commissionBp, holdHours: r.holdHours, senderCooldownHours: r.senderCooldownHours, dailyMaxFgc: r.dailyMaxFgc } };
}

/** The split of one price, exactly as send_gift computes it. */
export function giftSplit(priceFgc: number, recipientShareBp: number): { share: number; commission: number } {
  if (!Number.isSafeInteger(priceFgc) || priceFgc < 1 || !Number.isSafeInteger(recipientShareBp) || recipientShareBp < 1 || recipientShareBp > 10_000) throw new RangeError("invalid price or share");
  const share = Number((BigInt(priceFgc) * BigInt(recipientShareBp)) / 10_000n);
  return { share, commission: priceFgc - share };
}
