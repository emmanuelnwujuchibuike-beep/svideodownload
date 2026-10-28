import "server-only";

import { checkConversionRules, type ConversionDirection, type FgcConversionRules, type RulesCheck } from "@/lib/gift/conversion-rules";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ GIFT COIN — THE SERVER'S DOOR TO A CONVERSION (Frenz Gift Coin Part 2, 0290)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Thin by design, like lib/coin/server.ts: every rule that protects money is decided in the database under both wallet
 * locks (convert_fgc). This module reads the server's rules, refuses a rule set that cannot be used (the same check the
 * database makes), hands the rules to the database and words its answer. The member supplies only a direction, an
 * amount, an idempotency key and, optionally, the rules version they were shown — never a rate, a fee or an output.
 *
 * ── Where the rules come from ───────────────────────────────────────────────
 * The `frenzGift.conversion` object of the landing settings row (the row every audited money setting lives in). Part 3
 * gives the admin the editor for it (validated with checkConversionRules, versioned and audited like frenzCoin). Until
 * a valid rule set is there, every conversion answers `config_missing` / `config_invalid` and nothing moves — a missing
 * configuration, not a switch: the moment valid rules are saved, conversions work.
 *
 * 🔴 No fallback. If 0290 has not run, a conversion answers "not available" — never a different wallet function.
 */

export type ConversionResult =
  | { ok: true; conversionId: string; direction: ConversionDirection; input: number; gross: number; fee: number; net: number; inputCurrency: "USD" | "FGC"; outputCurrency: "USD" | "FGC"; version: number; duplicate: boolean }
  | { ok: false; status: number; reason: string; error: string };

const MISSING = (m: string) => /convert_fgc|fgc_conversions|frenz_gift|schema cache|does not exist/i.test(m);
const KEY = /^[A-Za-z0-9_-]{8,80}$/;

const REFUSED: Record<string, [number, string]> = {
  invalid: [400, "That request isn't valid."],
  config_missing: [503, "Gift Coin conversion isn't configured yet. Nothing was converted."],
  config_invalid: [503, "Gift Coin conversion isn't configured correctly. Nothing was converted."],
  rules_changed: [409, "The conversion rate just changed. Check the new amount and try again."],
  amount_out_of_range: [400, "That amount is outside the allowed range."],
  below_fee: [400, "That amount is too small to cover the conversion fee."],
  suspended: [403, "Conversions are paused on this account."],
  restricted: [403, "Conversions are paused on this account."],
  recovery_due: [403, "Paused while a refunded payment is settled. Contact support."],
  daily_limit: [429, "That would pass your daily conversion limit."],
  insufficient: [402, "Not enough available balance for that conversion."],
  idempotency_conflict: [409, "That request key was already used. Try again."],
  disabled: [503, "Frenz Coin isn't available right now."],
};

const refuse = (reason: string): { ok: false; status: number; reason: string; error: string } => {
  const [status, error] = REFUSED[reason] ?? [409, "That couldn't be done."];
  return { ok: false, status, reason, error };
};

/** The server's current conversion rules, checked. A read failure is answered as missing configuration (fail closed). */
export async function loadConversionRules(): Promise<RulesCheck> {
  try {
    const { data, error } = await createAdminClient().from("settings").select("value").eq("key", "landing").maybeSingle();
    if (error) return checkConversionRules(null);
    const value = (data?.value ?? null) as { frenzGift?: { conversion?: unknown } } | null;
    return checkConversionRules(value?.frenzGift?.conversion ?? null);
  } catch {
    return checkConversionRules(null);
  }
}

/**
 * Convert. `rules` is the server's checked rule set (loadConversionRules), or the refusal it produced. The database
 * validates the rules again, prices the conversion, and moves both wallets in one transaction. A retry with the same
 * key answers the first conversion.
 */
export async function convertFgc(input: { userId: string; direction: ConversionDirection; amount: number; idempotencyKey: string; expectedVersion: number | null; rules: RulesCheck }): Promise<ConversionResult> {
  if (input.direction !== "fc_to_fgc" && input.direction !== "fgc_to_fc") return refuse("invalid");
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0 || !KEY.test(input.idempotencyKey)) return refuse("invalid");
  if (input.expectedVersion !== null && (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion <= 0)) return refuse("invalid");
  // a replay must still be answered when the rules are now missing or invalid: the database checks replays FIRST, so
  // the call is made even then (with no rules), and a NEW conversion is refused there
  const rules: FgcConversionRules | null = input.rules.ok ? input.rules.rules : null;
  const db = createAdminClient();
  // Part 4 (0293): gift earnings whose hold has passed become available first, so they can be converted (idempotent,
  // and harmless before 0293 exists — the earnings simply stay pending until the next read)
  if (input.direction === "fgc_to_fc") await Promise.resolve(db.rpc("release_gift_earnings", { p_user: input.userId })).catch(() => null);
  const { data, error } = await db.rpc("convert_fgc", {
    p_user: input.userId,
    p_direction: input.direction,
    p_amount: input.amount,
    p_idempotency: input.idempotencyKey,
    p_rules: rules,
    p_expected_version: input.expectedVersion,
  });
  if (error) {
    if (MISSING(error.message)) return { ok: false, status: 503, reason: "not_available", error: "Gift Coin conversion arrives with the next update." };
    console.error("[gift/convert] failed", { user: input.userId, code: error.code });
    return { ok: false, status: 503, reason: "error", error: "Couldn't convert that right now. Nothing was moved." };
  }
  const r = (data ?? {}) as { ok?: boolean; reason?: string; conversion_id?: string; direction?: ConversionDirection; input?: number; gross?: number; fee?: number; net?: number; input_currency?: "USD" | "FGC"; output_currency?: "USD" | "FGC"; version?: number; duplicate?: boolean };
  if (!r.ok || !r.conversion_id) {
    // rules the server refused were sent as none: name the real problem (the detail goes to the logs only)
    if (r.reason === "config_missing" && !input.rules.ok && input.rules.code !== "config_missing") {
      console.warn("[gift/convert] rules refused", { detail: input.rules.detail });
      return refuse("config_invalid");
    }
    return refuse(r.reason ?? "error");
  }
  return {
    ok: true,
    conversionId: r.conversion_id,
    direction: r.direction ?? input.direction,
    input: Number(r.input),
    gross: Number(r.gross),
    fee: Number(r.fee),
    net: Number(r.net),
    inputCurrency: r.input_currency ?? (input.direction === "fc_to_fgc" ? "USD" : "FGC"),
    outputCurrency: r.output_currency ?? (input.direction === "fc_to_fgc" ? "FGC" : "USD"),
    version: Number(r.version),
    duplicate: !!r.duplicate,
  };
}
