import { checkConversionRules, type FgcConversionRules } from "@/lib/gift/conversion-rules";
import { checkGiftingRules, type GiftingRules } from "@/lib/gift/gifting-rules";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ GIFT COIN — THE `frenzGift` SETTINGS SECTION (Parts 3 and 4, migrations 0291 / 0293)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Lives in the `landing` settings row beside `frenzCoin`, as `frenzGift`. Pure (client-safe): the shape and how a stored
 * value is read. It is NEVER written by setLandingSettings: its only writers are the database functions
 * save_frenz_gift_conversion (0291) and save_frenz_gift_gifting (0293) — each version-checked, validated and audited in
 * the same transaction — and settings_gift_guard (0292) refuses every other change to it.
 *
 *   conversion   the rules convert_fgc runs on ({ version, fcToFgc, fgcToFc }, lib/gift/conversion-rules.ts), or null
 *   gifting      the rules send_gift runs on ({ version, recipientShareBp, commissionBp, holdHours, senderCooldownHours,
 *                dailyMaxFgc }, lib/gift/gifting-rules.ts), or null
 *   null = NOT CONFIGURED: never filled in with a guess. A stored value that fails its check is reported in
 *   `problem` / `giftingProblem` and treated as not configured, so nothing runs on it.
 */
export interface FrenzGiftSettings {
  conversion: FgcConversionRules | null;
  /** why a stored conversion value can't be used — null when it can, or when none is stored */
  problem: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  gifting: GiftingRules | null;
  giftingProblem: string | null;
  giftingUpdatedAt: string | null;
  giftingUpdatedBy: string | null;
}

export const GIFT_SETTINGS_UNCONFIGURED: FrenzGiftSettings = { conversion: null, problem: null, updatedAt: null, updatedBy: null, gifting: null, giftingProblem: null, giftingUpdatedAt: null, giftingUpdatedBy: null };

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : null);

/** Read a stored `frenzGift` value. Strict: an unusable section is reported, never repaired. */
export function normalizeGiftSettings(raw: unknown): FrenzGiftSettings {
  if (!isRecord(raw)) return GIFT_SETTINGS_UNCONFIGURED;
  const c = raw.conversion === undefined || raw.conversion === null ? null : checkConversionRules(raw.conversion);
  const g = raw.gifting === undefined || raw.gifting === null ? null : checkGiftingRules(raw.gifting);
  return {
    conversion: c?.ok ? c.rules : null,
    problem: c && !c.ok ? c.message : null,
    updatedAt: str(raw.updatedAt),
    updatedBy: str(raw.updatedBy),
    gifting: g?.ok ? g.rules : null,
    giftingProblem: g && !g.ok ? g.message : null,
    giftingUpdatedAt: str(raw.giftingUpdatedAt),
    giftingUpdatedBy: str(raw.giftingUpdatedBy),
  };
}
