import { checkConversionRules, type ConversionLeg, type FgcConversionRules } from "@/lib/gift/conversion-rules";
import { checkGiftingRules, type GiftingFields, type GiftingRules } from "@/lib/gift/gifting-rules";

/*
  Frenz Gift Coin Part 3 — the conversion editor's form, pure and testable.

  The admin types money the way they think about it (dollars for FC, Gift Coins for FGC, a percentage for the fee);
  the engine stores integers (US cents, FGC minor units, basis points). Converting is EXACT: text is parsed digit by
  digit, never through floating point, and a value with more decimals than the unit has is refused, not rounded.
  Then the whole rule set goes through checkConversionRules — the same check the server and the database run — so
  the form never says "valid" about rules the server would refuse. No value is ever filled in or adjusted.

  Units per leg:
    FC → FGC   min / max / daily in FC ($), flat fee in FGC (taken from the Gift Coins produced)
    FGC → FC   min / max / daily in FGC,    flat fee in FC ($) (taken from the Frenz Coins produced)
  The fee — percentage and flat — is always deducted from what the conversion PRODUCES, in that currency.
*/

export interface LegForm {
  rateNum: string;
  rateDen: string;
  feePercent: string;
  feeFlat: string;
  min: string;
  max: string;
  daily: string;
}
export interface GiftConversionForm {
  fcToFgc: LegForm;
  fgcToFc: LegForm;
}
export type LegName = keyof GiftConversionForm;

export const EMPTY_LEG: LegForm = { rateNum: "", rateDen: "", feePercent: "", feeFlat: "", min: "", max: "", daily: "" };

/** "12.5" → 1250 (2 decimals). null when it isn't a non-negative amount with at most 2 decimals. */
export function parseHundredths(text: string): number | null {
  const m = /^\s*(\d{1,12})(?:\.(\d{1,2}))?\s*$/.exec(text);
  if (!m) return null;
  const v = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(v) ? v : null;
}

/** "2.5" % → 250 basis points. null when not a percentage with at most 2 decimals. */
export const parsePercentBp = (text: string): number | null => parseHundredths(text);

/** A whole number, no sign, no decimals. */
export function parseWhole(text: string): number | null {
  const m = /^\s*(\d{1,12})\s*$/.exec(text);
  return m ? Number(m[1]) : null;
}

const hundredths = (v: number) => `${Math.floor(v / 100)}${v % 100 ? `.${String(v % 100).padStart(2, "0").replace(/0$/, "")}` : ""}`;

export function legToForm(l: ConversionLeg): LegForm {
  return { rateNum: String(l.rateNum), rateDen: String(l.rateDen), feePercent: hundredths(l.feeBp), feeFlat: hundredths(l.feeFlat), min: hundredths(l.minIn), max: hundredths(l.maxIn), daily: hundredths(l.dailyMaxIn) };
}

/** The form for stored rules, or an EMPTY form when nothing is configured (never a guessed value). */
export const formFromRules = (r: FgcConversionRules | null): GiftConversionForm => (r ? { fcToFgc: legToForm(r.fcToFgc), fgcToFc: legToForm(r.fgcToFc) } : { fcToFgc: { ...EMPTY_LEG }, fgcToFc: { ...EMPTY_LEG } });

export type FieldErrors = Partial<Record<`${LegName}.${keyof LegForm}`, string>>;
export type FormResult =
  | { ok: true; legs: { fcToFgc: ConversionLeg; fgcToFc: ConversionLeg }; rules: FgcConversionRules }
  | { ok: false; fields: FieldErrors; rules: string | null };

/**
 * Parse the form and check the whole rule set as the server will (version = the one being edited + 1). `fields` names
 * each box that isn't a number in its unit; `rules` is checkConversionRules' message (bounds, limits, minimum net,
 * overflow, arbitrage) — which also names the leg and field.
 */
export function readForm(form: GiftConversionForm, editingVersion: number): FormResult {
  const fields: FieldErrors = {};
  const legs: Partial<Record<LegName, ConversionLeg>> = {};
  for (const name of ["fcToFgc", "fgcToFc"] as const) {
    const f = form[name];
    const out: Partial<ConversionLeg> = {};
    const need = <K extends keyof LegForm>(k: K, v: number | null, msg: string, set: (n: number) => void) => {
      if (v === null) fields[`${name}.${k}`] = msg;
      else set(v);
    };
    need("rateNum", parseWhole(f.rateNum), "A whole number, at least 1.", (n) => (out.rateNum = n));
    need("rateDen", parseWhole(f.rateDen), "A whole number, at least 1.", (n) => (out.rateDen = n));
    need("feePercent", parsePercentBp(f.feePercent), "A percentage with at most 2 decimals (0 for none).", (n) => (out.feeBp = n));
    need("feeFlat", parseHundredths(f.feeFlat), "An amount with at most 2 decimals (0 for none).", (n) => (out.feeFlat = n));
    need("min", parseHundredths(f.min), "An amount with at most 2 decimals.", (n) => (out.minIn = n));
    need("max", parseHundredths(f.max), "An amount with at most 2 decimals.", (n) => (out.maxIn = n));
    need("daily", parseHundredths(f.daily), "An amount with at most 2 decimals.", (n) => (out.dailyMaxIn = n));
    legs[name] = out as ConversionLeg;
  }
  if (Object.keys(fields).length) return { ok: false, fields, rules: null };
  const check = checkConversionRules({ version: editingVersion + 1, fcToFgc: legs.fcToFgc, fgcToFc: legs.fgcToFc });
  if (!check.ok) return { ok: false, fields: fieldOf(check.detail, check.message), rules: check.message };
  return { ok: true, legs: { fcToFgc: check.rules.fcToFgc, fgcToFc: check.rules.fgcToFc }, rules: check.rules };
}

/** checkConversionRules' detail (config_invalid:fcToFgc.feeBp) → the form box it is about. */
function fieldOf(detail: string, message: string): FieldErrors {
  const m = /^config_invalid:(fcToFgc|fgcToFc)\.(\w+)$/.exec(detail);
  if (!m) return {};
  const box: Record<string, keyof LegForm> = { rateNum: "rateNum", rateDen: "rateDen", feeBp: "feePercent", feeFlat: "feeFlat", minIn: "min", maxIn: "max", dailyMaxIn: "daily", minNet: "min", range: "max" };
  const k = box[m[2]!];
  return k ? { [`${m[1]}.${k}`]: message } : {};
}

/** Whether the form differs from what is stored (an unconfigured form differs once anything is typed). */
export function isDirty(form: GiftConversionForm, stored: FgcConversionRules | null): boolean {
  return JSON.stringify(form) !== JSON.stringify(formFromRules(stored));
}

/** "1 FC → 0.95 FGC" — the rate as a decimal, exact to 6 places (display only). */
export function rateText(num: number, den: number): string {
  if (!(num >= 1 && den >= 1)) return "—";
  const scaled = (BigInt(num) * 1_000_000n) / BigInt(den);
  const whole = scaled / 1_000_000n;
  const frac = (scaled % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

// ── Part 4: the gifting rules form ───────────────────────────────────────────
// The admin types the recipient's share as a percentage (2 decimals) and the commission is the rest — both are sent
// and the server checks they add up to exactly 100% (checkGiftingRules / gift_rules_check). Hours are whole numbers,
// the daily limit is in FGC with 2 decimals. Empty until an administrator saves rules: nothing is a default.

export interface GiftingForm {
  sharePercent: string;
  holdHours: string;
  cooldownHours: string;
  dailyMax: string;
}

export const formFromGifting = (g: GiftingRules | null): GiftingForm =>
  g ? { sharePercent: hundredths(g.recipientShareBp), holdHours: String(g.holdHours), cooldownHours: String(g.senderCooldownHours), dailyMax: hundredths(g.dailyMaxFgc) } : { sharePercent: "", holdHours: "", cooldownHours: "", dailyMax: "" };

export type GiftingFormResult = { ok: true; fields: GiftingFields; rules: GiftingRules } | { ok: false; fields: Partial<Record<keyof GiftingForm, string>>; message: string | null };

export function readGiftingForm(form: GiftingForm, editingVersion: number): GiftingFormResult {
  const errs: Partial<Record<keyof GiftingForm, string>> = {};
  const share = parsePercentBp(form.sharePercent);
  const hold = parseWhole(form.holdHours);
  const cool = parseWhole(form.cooldownHours);
  const daily = parseHundredths(form.dailyMax);
  if (share === null) errs.sharePercent = "A percentage with at most 2 decimals.";
  if (hold === null) errs.holdHours = "Whole hours.";
  if (cool === null) errs.cooldownHours = "Whole hours (0 for none).";
  if (daily === null) errs.dailyMax = "An amount with at most 2 decimals.";
  if (Object.keys(errs).length) return { ok: false, fields: errs, message: null };
  const fields: GiftingFields = { recipientShareBp: share!, commissionBp: 10_000 - share!, holdHours: hold!, senderCooldownHours: cool!, dailyMaxFgc: daily! };
  const check = checkGiftingRules({ version: editingVersion + 1, ...fields });
  if (!check.ok) {
    const k = check.detail.split(":")[1];
    const box: Record<string, keyof GiftingForm> = { recipientShareBp: "sharePercent", commissionBp: "sharePercent", split: "sharePercent", holdHours: "holdHours", senderCooldownHours: "cooldownHours", dailyMaxFgc: "dailyMax" };
    return { ok: false, fields: k && box[k] ? { [box[k]!]: check.message } : {}, message: check.message };
  }
  return { ok: true, fields, rules: check.rules };
}
