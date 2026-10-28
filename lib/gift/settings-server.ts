import "server-only";

import { checkConversionRules, type ConversionLeg, roundTripExample, roundTripPercent, type FgcConversionRules } from "@/lib/gift/conversion-rules";
import { checkGiftingRules, type GiftingFields, type GiftingRules } from "@/lib/gift/gifting-rules";
import { normalizeGiftSettings, type FrenzGiftSettings } from "@/lib/gift/settings";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ GIFT COIN — READING AND SAVING THE CONVERSION SETTINGS (Part 3, 0291)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Read: straight from the settings row (not the 10-second landing cache), so the admin always edits what is stored.
 * Save: the administrator sends the two legs and the version they were editing. Here the rule set is checked with
 * checkConversionRules — the same check the database runs (lib/gift/conversion-sql.server.test.ts) — so a refusal names
 * the field before anything is sent; then save_frenz_gift_conversion, which locks the row, refuses a stale version,
 * checks again, bumps the version only for a real change, and writes the audit rows in the same transaction.
 * Nothing is ever adjusted to make a rule set pass.
 */

export type GiftSettingsRead = { ok: true; settings: FrenzGiftSettings; summary: ConversionSummary | null } | { ok: false; status: number; error: string };

export interface ConversionSummary {
  /** the most a round trip can keep, from roundTripFactor (rates and percentage fees, before rounding) */
  roundTripPercent: string;
  /** one real round trip (≈ $100) with the integer rounding and the flat fees */
  example: ReturnType<typeof roundTripExample>;
}

export const summarize = (rules: Pick<FgcConversionRules, "fcToFgc" | "fgcToFc">): ConversionSummary => ({ roundTripPercent: roundTripPercent(rules), example: roundTripExample(rules) });

export async function readGiftSettings(): Promise<GiftSettingsRead> {
  const { data, error } = await createAdminClient().from("settings").select("value").eq("key", "landing").maybeSingle();
  if (error) return { ok: false, status: 503, error: "Couldn't load the Gift Coin settings." };
  const settings = normalizeGiftSettings(((data?.value ?? {}) as { frenzGift?: unknown }).frenzGift);
  return { ok: true, settings, summary: settings.conversion ? summarize(settings.conversion) : null };
}

export type GiftSaveResult =
  | { ok: true; unchanged: boolean; version: number; conversion: FgcConversionRules; summary: ConversionSummary }
  | { ok: false; status: number; reason: "invalid" | "stale" | "not_available" | "error"; error: string; detail?: string; version?: number };

const MISSING = /save_frenz_gift_conversion|could not find the function|does not exist|schema cache/i;

/** Save the two legs over `expectedVersion` (0 = nothing configured yet). */
export async function saveGiftConversion(input: { adminId: string; legs: { fcToFgc: ConversionLeg; fgcToFc: ConversionLeg }; expectedVersion: number }): Promise<GiftSaveResult> {
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) return { ok: false, status: 400, reason: "invalid", error: "The version you were editing is missing. Reload and try again." };
  // the version the database will stamp: checked with it, so a refusal here is exactly the database's
  const candidate = { version: input.expectedVersion + 1, fcToFgc: input.legs.fcToFgc, fgcToFc: input.legs.fgcToFc };
  const check = checkConversionRules(candidate);
  if (!check.ok) return { ok: false, status: 400, reason: "invalid", error: check.message, detail: check.detail };
  const summary = summarize(check.rules);
  const { data, error } = await createAdminClient().rpc("save_frenz_gift_conversion", {
    p_admin: input.adminId,
    p_legs: { fcToFgc: check.rules.fcToFgc, fgcToFc: check.rules.fgcToFc },
    p_expected_version: input.expectedVersion,
    p_validation: { app_check: "valid", round_trip_percent: summary.roundTripPercent, example: summary.example },
  });
  if (error) {
    if (MISSING.test(error.message)) return { ok: false, status: 503, reason: "not_available", error: "Saving Gift Coin settings needs migration 0291. Nothing was saved." };
    console.error("[gift/settings] save failed", { code: error.code });
    return { ok: false, status: 503, reason: "error", error: "Couldn't save the Gift Coin settings. Nothing was changed." };
  }
  const r = (data ?? {}) as { ok?: boolean; reason?: string; detail?: string; version?: number; unchanged?: boolean; conversion?: unknown };
  if (!r.ok) {
    if (r.reason === "stale") return { ok: false, status: 409, reason: "stale", error: "Someone saved these settings while you were editing. Reload to see their version, then make your change again.", version: Number(r.version) };
    if (r.reason === "invalid") return { ok: false, status: 400, reason: "invalid", error: "The database refused these rules.", detail: r.detail };
    return { ok: false, status: 400, reason: "invalid", error: "That request isn't valid." };
  }
  const saved = checkConversionRules(r.conversion);
  if (!saved.ok) return { ok: false, status: 500, reason: "error", error: "Saved, but the stored rules couldn't be read back. Reload to check." };
  return { ok: true, unchanged: !!r.unchanged, version: saved.rules.version, conversion: saved.rules, summary: summarize(saved.rules) };
}

// ── Part 4 (0293): the gifting rules ─────────────────────────────────────────

export type GiftingSaveResult =
  | { ok: true; unchanged: boolean; version: number; gifting: GiftingRules }
  | { ok: false; status: number; reason: "invalid" | "stale" | "not_available" | "error"; error: string; detail?: string; version?: number };

const GIFTING_MISSING = /save_frenz_gift_gifting|could not find the function|does not exist|schema cache/i;

/**
 * Save the gifting rules over `expectedVersion` (0 = never configured). Checked here with checkGiftingRules — the same
 * check as the database's gift_rules_check — then save_frenz_gift_gifting locks the row, refuses a stale version, checks
 * again, bumps the version only for a change, and audits it in the same transaction. Never adjusted to pass.
 */
export async function saveGiftGifting(input: { adminId: string; fields: GiftingFields; expectedVersion: number }): Promise<GiftingSaveResult> {
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) return { ok: false, status: 400, reason: "invalid", error: "The version you were editing is missing. Reload and try again." };
  const check = checkGiftingRules({ version: input.expectedVersion + 1, ...input.fields });
  if (!check.ok) return { ok: false, status: 400, reason: "invalid", error: check.message, detail: check.detail };
  const { version: _v, ...fields } = check.rules;
  const { data, error } = await createAdminClient().rpc("save_frenz_gift_gifting", {
    p_admin: input.adminId,
    p_rules: fields,
    p_expected_version: input.expectedVersion,
    p_validation: { app_check: "valid" },
  });
  if (error) {
    if (GIFTING_MISSING.test(error.message)) return { ok: false, status: 503, reason: "not_available", error: "Saving gifting rules needs migration 0293. Nothing was saved." };
    console.error("[gift/gifting] save failed", { code: error.code });
    return { ok: false, status: 503, reason: "error", error: "Couldn't save the gifting rules. Nothing was changed." };
  }
  const r = (data ?? {}) as { ok?: boolean; reason?: string; detail?: string; version?: number; unchanged?: boolean; gifting?: unknown };
  if (!r.ok) {
    if (r.reason === "stale") return { ok: false, status: 409, reason: "stale", error: "Someone saved the gifting rules while you were editing. Reload to see their version, then make your change again.", version: Number(r.version) };
    if (r.reason === "invalid") return { ok: false, status: 400, reason: "invalid", error: "The database refused these rules.", detail: r.detail };
    return { ok: false, status: 400, reason: "invalid", error: "That request isn't valid." };
  }
  const saved = checkGiftingRules(r.gifting);
  if (!saved.ok) return { ok: false, status: 500, reason: "error", error: "Saved, but the stored rules couldn't be read back. Reload to check." };
  return { ok: true, unchanged: !!r.unchanged, version: saved.rules.version, gifting: saved.rules };
}
