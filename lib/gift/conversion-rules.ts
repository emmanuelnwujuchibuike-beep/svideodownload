/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ GIFT COIN — CONVERSION RULES, QUOTES AND THE ARBITRAGE CHECK (Frenz Gift Coin Part 2, migration 0290)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Pure. The DATABASE is the authority: convert_fgc re-validates the rules it is handed (fgc_conversion_rules_check),
 * re-prices the conversion (fgc_conversion_quote) and stores the rules on the record. This module is the same
 * arithmetic for a preview and for the admin's validation (Part 3), kept equal to the SQL by
 * lib/gift/conversion-sql.server.test.ts. 0291 adds one rule: the smallest allowed conversion of each leg must leave at
 * least 1 unit after its fee (`<leg>.minNet`).
 *
 * ── Units ────────────────────────────────────────────────────────────────────
 *   FC   integer US cents (Frenz Coin, 0279: 1 FC = $1 = 100 cents — unchanged)
 *   FGC  integer FGC minor units (1 FGC = 100 minor units)
 *
 * ── One leg (a direction) on an input amount ─────────────────────────────────
 *   gross     = floor(input × rateNum / rateDen)          output units, rounded DOWN
 *   remainder = input × rateNum − gross × rateDen          what the floor dropped (0 ≤ r < rateDen)
 *   fee       = ceil(gross × feeBp / 10 000) + feeFlat      output units, the percent part rounded UP
 *   net       = gross − fee                                 credited. Must be ≥ 1 (else "below_fee").
 * Every rounding favours the platform. All arithmetic is BigInt — never floating point.
 *
 * ── Arbitrage (why a rule set is refused) ────────────────────────────────────
 * Leg A = fcToFgc (a/b, p1 = bp1/10 000, flat f1), leg B = fgcToFc (c/d, p2, f2). Since floor ≤ exact and the ceil fee
 * ≥ the exact percentage, one leg returns at most `in × rate × (1 − p) − flat`. So a round trip — and any split or
 * merge of conversions, because the bound is linear per leg — returns at most
 *
 *     X × K − L,   K = a·c·(10 000 − bp1)·(10 000 − bp2) / (b·d·10⁸),   L > 0 whenever a flat fee is > 0.
 *
 * Valid only when K < 1, or K = 1 and a flat fee is > 0. Otherwise a round trip can return at least what went in:
 * K = 1 with no flat fee breaks even on exact multiples (x = b·d·10⁸·t), and K > 1 gains on amounts large enough that
 * the bounded rounding loss (< 2 units per leg plus the flats) is smaller than x·(K − 1). The check ignores the min/max
 * limits on purpose: limits change, and conversions can be split and merged. Both round-trip directions are covered
 * (K and the condition on L are symmetric). A refused rule set is never adjusted — the admin gets the reason.
 */

export type ConversionDirection = "fc_to_fgc" | "fgc_to_fc";
export const CONVERSION_DIRECTIONS: readonly ConversionDirection[] = ["fc_to_fgc", "fgc_to_fc"];

export interface ConversionLeg {
  /** output units per input unit = rateNum / rateDen */
  rateNum: number;
  rateDen: number;
  /** the percentage fee in basis points of the GROSS output (≤ 5000), rounded up */
  feeBp: number;
  /** a flat fee in output units */
  feeFlat: number;
  /** per conversion, in input units */
  minIn: number;
  maxIn: number;
  /** the rolling 24-hour total of input per member, this direction */
  dailyMaxIn: number;
}

export interface FgcConversionRules {
  /** bumps whenever anything that prices or limits a conversion changes (stamped on every conversion) */
  version: number;
  fcToFgc: ConversionLeg;
  fgcToFc: ConversionLeg;
}

/** The same bounds as 0290 fgc_conversion_rules_check (digit counts there). */
export const FGC_RULE_BOUNDS = {
  version: { min: 1, max: 999_999_999_999_999 },
  rateNum: { min: 1, max: 999_999_999 },
  rateDen: { min: 1, max: 999_999_999 },
  feeBp: { min: 0, max: 5_000 },
  feeFlat: { min: 0, max: 999_999_999 },
  minIn: { min: 1, max: 99_999_999_999 },
  maxIn: { min: 1, max: 99_999_999_999 },
  dailyMaxIn: { min: 1, max: 999_999_999_999 },
} as const;

/** The largest output any allowed input may produce: it must stay an exact JavaScript integer. */
const MAX_OUTPUT = BigInt(Number.MAX_SAFE_INTEGER);
const LEG_KEYS = ["rateNum", "rateDen", "feeBp", "feeFlat", "minIn", "maxIn", "dailyMaxIn"] as const;
const LEGS = ["fcToFgc", "fgcToFc"] as const;

export type RulesCheck =
  | { ok: true; rules: FgcConversionRules }
  | { ok: false; code: "config_missing" | "config_invalid" | "config_arbitrage"; detail: string; message: string };

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const inBounds = (v: unknown, b: { min: number; max: number }): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= b.min && v <= b.max;
const invalid = (detail: string, message: string): RulesCheck => ({ ok: false, code: "config_invalid", detail: `config_invalid:${detail}`, message });

/**
 * Validate a rule set EXACTLY as the database will. Never clamps, rounds or fills in a default: a value out of bounds
 * is an error naming it. `null`/`undefined` = no configuration yet.
 */
export function checkConversionRules(raw: unknown): RulesCheck {
  if (raw === null || raw === undefined) return { ok: false, code: "config_missing", detail: "config_missing", message: "Gift Coin conversion isn't configured yet." };
  if (!isRecord(raw)) return invalid("shape", "The conversion rules must be an object.");
  if (!inBounds(raw.version, FGC_RULE_BOUNDS.version)) return invalid("version", "The rules need a positive whole version number.");
  const legs: Partial<Record<(typeof LEGS)[number], ConversionLeg>> = {};
  for (const name of LEGS) {
    const l = raw[name];
    if (!isRecord(l)) return invalid(name, `${legLabel(name)}: the rules are missing.`);
    for (const k of LEG_KEYS) {
      if (!inBounds(l[k], FGC_RULE_BOUNDS[k])) return invalid(`${name}.${k}`, `${legLabel(name)}: ${k} must be a whole number from ${FGC_RULE_BOUNDS[k].min} to ${FGC_RULE_BOUNDS[k].max}.`);
    }
    const leg = Object.fromEntries(LEG_KEYS.map((k) => [k, l[k] as number])) as unknown as ConversionLeg;
    if (leg.maxIn < leg.minIn) return invalid(`${name}.maxIn`, `${legLabel(name)}: the maximum is below the minimum.`);
    if (leg.dailyMaxIn < leg.minIn) return invalid(`${name}.dailyMaxIn`, `${legLabel(name)}: the daily limit is below the minimum conversion.`);
    if ((BigInt(leg.maxIn) * BigInt(leg.rateNum)) / BigInt(leg.rateDen) > MAX_OUTPUT) return invalid(`${name}.range`, `${legLabel(name)}: the maximum conversion would produce an output too large to handle exactly.`);
    // 0291: net never falls as the amount grows, so if the smallest conversion leaves something, every allowed one does
    if (quoteLeg(leg.minIn, leg).net < 1) return invalid(`${name}.minNet`, `${legLabel(name)}: the smallest conversion (${leg.minIn} units) gives nothing after the fee. Raise the minimum or lower the fee.`);
    legs[name] = leg;
  }
  const rules: FgcConversionRules = { version: raw.version, fcToFgc: legs.fcToFgc!, fgcToFc: legs.fgcToFc! };
  const why = arbitrageReason(rules);
  if (why) return { ok: false, code: "config_arbitrage", detail: "config_arbitrage", message: why };
  return { ok: true, rules };
}

const legLabel = (name: (typeof LEGS)[number]) => (name === "fcToFgc" ? "FC → FGC" : "FGC → FC");

/** The round-trip bound factor K as an exact fraction (see the header). */
export function roundTripFactor(r: Pick<FgcConversionRules, "fcToFgc" | "fgcToFc">): { num: bigint; den: bigint } {
  const A = r.fcToFgc;
  const B = r.fgcToFc;
  return {
    num: BigInt(A.rateNum) * BigInt(B.rateNum) * BigInt(10_000 - A.feeBp) * BigInt(10_000 - B.feeBp),
    den: BigInt(A.rateDen) * BigInt(B.rateDen) * 100_000_000n,
  };
}

/** null = a round trip always loses value. Otherwise the reason, worded for the admin. */
export function arbitrageReason(r: Pick<FgcConversionRules, "fcToFgc" | "fgcToFc">): string | null {
  const { num, den } = roundTripFactor(r);
  const pct = percentString(num, den);
  if (num > den) return `A round trip (FC → FGC → FC, or back) could return more than it started with: after rates and fees it keeps ${pct}% of the amount. It must keep less than 100%. Lower a rate or raise a fee.`;
  if (num === den && r.fcToFgc.feeFlat === 0 && r.fgcToFc.feeFlat === 0)
    return "A round trip (FC → FGC → FC, or back) could return exactly what it started with: after rates and fees it keeps 100.0000% of the amount, and there is no flat fee. It must lose value. Lower a rate, raise a percentage fee or add a flat fee.";
  return null;
}

/** The most of an amount a round trip can keep (the bound K, from roundTripFactor), e.g. "93.1000" — display only. */
export function roundTripPercent(r: Pick<FgcConversionRules, "fcToFgc" | "fgcToFc">): string {
  const { num, den } = roundTripFactor(r);
  return percentString(num, den);
}

export interface RoundTripExample {
  /** FC cents in */
  fcIn: number;
  /** FGC minor units after FC → FGC */
  fgc: number;
  /** FC cents back, with the real integer rounding — null when the second leg isn't allowed for that amount */
  fcBack: number | null;
  /** fcBack / fcIn as a percentage with 4 decimals, truncated */
  percent: string | null;
}

/**
 * One concrete round trip with the real rounding and fees: $100 (or the FC → FGC limits nearest it) → FGC → FC.
 * Always at most roundTripPercent; shown next to it so the admin sees what rounding takes on a typical amount.
 */
export function roundTripExample(r: Pick<FgcConversionRules, "fcToFgc" | "fgcToFc">, fcIn = 10_000): RoundTripExample | null {
  const x = Math.min(Math.max(fcIn, r.fcToFgc.minIn), r.fcToFgc.maxIn);
  const y = quoteLeg(x, r.fcToFgc).net;
  if (y < 1) return null;
  if (y < r.fgcToFc.minIn || y > r.fgcToFc.maxIn) return { fcIn: x, fgc: y, fcBack: null, percent: null };
  const z = Math.max(0, quoteLeg(y, r.fgcToFc).net);
  return { fcIn: x, fgc: y, fcBack: z, percent: percentString(BigInt(z), BigInt(x)) };
}

/** num/den as a percentage with 4 decimals, truncated (display only). */
function percentString(num: bigint, den: bigint): string {
  const scaled = (num * 1_000_000n) / den; // percent × 10 000
  const whole = scaled / 10_000n;
  const frac = (scaled % 10_000n).toString().padStart(4, "0");
  return `${whole}.${frac}`;
}

export interface LegQuote {
  gross: number;
  remainder: number;
  percent: number;
  flat: number;
  fee: number;
  /** may be ≤ 0: the database then answers "below_fee" */
  net: number;
}

/** One leg on one amount, exactly as 0290 fgc_conversion_quote. The leg must already have passed the check. */
export function quoteLeg(amount: number, leg: ConversionLeg): LegQuote {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new RangeError("amount must be a positive safe integer");
  const x = BigInt(amount);
  const num = BigInt(leg.rateNum);
  const den = BigInt(leg.rateDen);
  const gross = (x * num) / den;
  const remainder = x * num - gross * den;
  const percent = (gross * BigInt(leg.feeBp) + 9_999n) / 10_000n;
  const flat = BigInt(leg.feeFlat);
  return { gross: Number(gross), remainder: Number(remainder), percent: Number(percent), flat: Number(flat), fee: Number(percent + flat), net: Number(gross - percent - flat) };
}

export const legFor = (rules: FgcConversionRules, direction: ConversionDirection): ConversionLeg => (direction === "fc_to_fgc" ? rules.fcToFgc : rules.fgcToFc);

export type ConversionPreview =
  | { ok: true; direction: ConversionDirection; input: number; gross: number; fee: number; net: number; remainder: number; version: number }
  | { ok: false; reason: "amount_out_of_range" | "below_fee"; min: number; max: number };

/** What a conversion of `amount` would give under `rules` (a preview — the database prices it again). */
export function previewConversion(rules: FgcConversionRules, direction: ConversionDirection, amount: number): ConversionPreview {
  const leg = legFor(rules, direction);
  if (!Number.isSafeInteger(amount) || amount < leg.minIn || amount > leg.maxIn) return { ok: false, reason: "amount_out_of_range", min: leg.minIn, max: leg.maxIn };
  const q = quoteLeg(amount, leg);
  if (q.gross <= 0 || q.net <= 0) return { ok: false, reason: "below_fee", min: leg.minIn, max: leg.maxIn };
  return { ok: true, direction, input: amount, gross: q.gross, fee: q.fee, net: q.net, remainder: q.remainder, version: rules.version };
}
