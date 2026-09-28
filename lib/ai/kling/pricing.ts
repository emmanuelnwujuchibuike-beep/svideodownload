/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  KLING PRICING — the matrix, the provider's units, and the member's price
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, Part 4 §12: "Replace the old provider-specific pricing assumptions with
 * a centralized Kling pricing model… Do NOT hardcode one universal price for
 * every Kling generation. Create a centralized pricing matrix." §13: "The
 * customer quote must be deterministic… Do not allow the frontend to decide the
 * authoritative price." §14: "Keep provider consumption data separate from
 * customer pricing."
 *
 * PURE, like `lib/ai/providers/config.ts` and `lib/ai/credits/config.ts`: no
 * imports from the client, no `process.env` at module scope, no clock. It is
 * stored under one key of the landing settings row, merged on the way in and
 * clamped on the way out. The admin form imports it for its bounds and labels;
 * the server reads it to quote.
 *
 * ── 🔴 KLING CHARGES IN UNITS, NOT IN SECONDS OF MONEY ──────────────────────
 *
 * The brief assumed a per-second rate. The live API reports something better: it
 * puts the actual cost on the task.
 *
 *     "billing": [ { "charge_type": "unit", "amount": "3", "package_type": "video" } ]
 *
 * So there are TWO different numbers here and they must never be confused:
 *
 *   providerUnits…   what KLING charges US. Measured, and re-readable from every
 *                    finished task (`extractKlingBilledUnits`). This is cost.
 *   priceUsdCents…   what the MEMBER pays. An operator decision, set in the
 *                    admin, in the currency the wallet already speaks. This is
 *                    revenue.
 *
 * Keeping them in one row per tier is what makes margin visible; keeping them in
 * separate FIELDS is what stops a provider price change silently re-pricing a
 * member, which §14 requires.
 *
 * ── 🔴 WHAT IS MEASURED AND WHAT IS NOT ─────────────────────────────────────
 *
 * Measured on 2026-09-28 against the live API:
 *
 *     Omni 720p   1.8 units for 3 s, and 3 units for 5 s  → 0.6 units/second
 *     Lip Sync    0.5 units for a ~3 s clip
 *     failed task 0 units — a task that fails before generating is not billed
 *
 * 1080p and 4K were NOT measured. Their `providerUnitsPerSecond` is therefore
 * **0, meaning unknown** — not a guessed multiple of the 720p rate. This project
 * has a standing rule against showing a fabricated statistic, and a made-up cost
 * would be exactly that: it would appear in the admin's margin column as though
 * somebody had checked. `klingTierCostKnown()` is how a caller asks, and the
 * admin panel shows "not measured" rather than a number.
 *
 * A tier with an unknown COST can still be sold at a known PRICE — that is the
 * separation §14 asks for — but the operator sees that the margin is unknown.
 */

/* ───────────────────────────── the dimensions ────────────────────────────── */

/** The operations that can be priced. Only what the live API actually serves. */
export type KlingPricedFeature = "text_to_video" | "image_to_video" | "lip_sync";
export const KLING_PRICED_FEATURES: readonly KlingPricedFeature[] = ["text_to_video", "image_to_video", "lip_sync"];

export const KLING_PRICED_FEATURE_LABEL: Record<KlingPricedFeature, string> = {
  text_to_video: "Text to Video",
  image_to_video: "Image to Video",
  lip_sync: "Lip Sync",
};

/**
 * The resolutions a tier can be priced at.
 *
 * 🔴 `480p` is deliberately absent. The vendor's `settings.resolution` enum lists
 * it and then refuses it at generation ("video resolution value '480p' is
 * invalid"), so a 480p tier would be a price for something that cannot be made.
 */
export const KLING_PRICED_RESOLUTIONS = ["720p", "1080p", "4k"] as const;
export type KlingPricedResolution = (typeof KLING_PRICED_RESOLUTIONS)[number];

/**
 * Lip Sync has no resolution choice of its own — it returns the source video's
 * own resolution — so it is priced on one row. Naming that row `720p` would
 * imply a choice the member does not have.
 */
export const KLING_LIP_SYNC_TIER = "source" as const;

/**
 * A feature that genuinely offers a resolution choice. Lip Sync is excluded on
 * purpose: it returns the SOURCE video's resolution, so `lip_sync:1080p` would be
 * a row nobody can ever select — and a `Record` over it would be three tiers an
 * operator could price and no member could buy.
 */
type KlingResolutionChoosingFeature = Exclude<KlingPricedFeature, "lip_sync">;

export type KlingTierKey = `${KlingResolutionChoosingFeature}:${KlingPricedResolution}` | `lip_sync:${typeof KLING_LIP_SYNC_TIER}`;

/** Every tier the matrix holds. Lip Sync contributes exactly one. */
export const KLING_TIER_KEYS: readonly KlingTierKey[] = [
  "text_to_video:720p",
  "text_to_video:1080p",
  "text_to_video:4k",
  "image_to_video:720p",
  "image_to_video:1080p",
  "image_to_video:4k",
  "lip_sync:source",
];

/* ─────────────────────────────── the tier ────────────────────────────────── */

export interface KlingTierPricing {
  /** §14: an operator can take a tier off sale without a deploy. */
  enabled: boolean;

  /* ── what Kling charges US (cost) ── */
  /** Measured units per second of output. 0 = NOT MEASURED, never "free". */
  providerUnitsPerSecond: number;
  /** Units charged per run regardless of length, where the vendor does that. */
  providerUnitsPerRun: number;
  /** What one Kling unit costs us, in US cents. Set by the operator from their Kling plan. */
  unitCostUsdCents: number;

  /* ── what the MEMBER pays (revenue) ── */
  priceUsdCentsPerSecond: number;
  priceUsdCentsPerRun: number;
  /** Native audio is a separate generation cost at the vendor; billed per second when on. */
  audioSurchargeUsdCentsPerSecond: number;

  /* ── the shape of what may be asked for ── */
  /** A floor, so a 3-second job is not priced at almost nothing. */
  minBillableSeconds: number;
  minSeconds: number;
  maxSeconds: number;
  notes: string;
}

export const KLING_PRICING_BOUNDS = {
  providerUnits: { min: 0, max: 1_000 },
  usdCents: { min: 0, max: 100_000 },
  seconds: { min: 1, max: 60 },
} as const;

const tier = (over: Partial<KlingTierPricing> = {}): KlingTierPricing => ({
  enabled: true,
  providerUnitsPerSecond: 0,
  providerUnitsPerRun: 0,
  unitCostUsdCents: 0,
  priceUsdCentsPerSecond: 0,
  priceUsdCentsPerRun: 0,
  audioSurchargeUsdCentsPerSecond: 0,
  minBillableSeconds: 3,
  minSeconds: 3,
  maxSeconds: 15,
  notes: "",
  ...over,
});

export interface KlingPricingConfig {
  matrix: Record<KlingTierKey, KlingTierPricing>;
  /** §26 emergency control: nothing new is accepted; jobs in flight finish. */
  paused: boolean;
  version: number;
  updatedAt: string | null;
}

export const KLING_PRICING_DEFAULTS: KlingPricingConfig = {
  matrix: {
    // ✅ 0.6 units/second, measured twice (1.8 units at 3 s, 3 units at 5 s).
    "text_to_video:720p": tier({ providerUnitsPerSecond: 0.6, notes: "Measured 2026-09-28: 1.8 units at 3s and 3 units at 5s." }),
    // ⚠️ NOT measured. 0 means unknown — see the header note; it is not a guess.
    "text_to_video:1080p": tier({ notes: "Provider cost NOT measured. Run one generation at 1080p before trusting any margin." }),
    "text_to_video:4k": tier({ notes: "Provider cost NOT measured. Run one generation at 4k before trusting any margin." }),

    "image_to_video:720p": tier({ providerUnitsPerSecond: 0.6, notes: "Measured 2026-09-28: 1.8 units at 3s, 720p." }),
    "image_to_video:1080p": tier({ notes: "Provider cost NOT measured." }),
    "image_to_video:4k": tier({ notes: "Provider cost NOT measured." }),

    /*
      ✅ 0.5 units for a ~3 s clip. Recorded as a PER-RUN cost rather than a
      per-second one: only one length has been observed, so a per-second rate
      derived from it would be an extrapolation from a single point.
    */
    "lip_sync:source": tier({
      providerUnitsPerRun: 0.5,
      minSeconds: 1,
      maxSeconds: 60,
      notes: "Measured 2026-09-28: 0.5 units for a ~3s clip. Recorded per run — only one length observed. Source must be 512–2160px tall and contain a person.",
    }),
  },
  paused: false,
  version: 1,
  updatedAt: null,
};

/* ───────────────────────────── the normaliser ────────────────────────────── */

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const num = (v: unknown, d: number, min: number, max: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return d;
  return Math.min(max, Math.max(min, Math.round(n * 1000) / 1000));
};
const int = (v: unknown, d: number, min: number, max: number) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return d;
  return Math.min(max, Math.max(min, Math.round(n)));
};
const text = (v: unknown, d: string, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : d);

function normalizeTier(raw: unknown, d: KlingTierPricing): KlingTierPricing {
  const r = isRecord(raw) ? raw : {};
  const minSeconds = int(r.minSeconds, d.minSeconds, KLING_PRICING_BOUNDS.seconds.min, KLING_PRICING_BOUNDS.seconds.max);
  const maxSeconds = int(r.maxSeconds, d.maxSeconds, minSeconds, KLING_PRICING_BOUNDS.seconds.max);
  return {
    enabled: bool(r.enabled, d.enabled),
    providerUnitsPerSecond: num(r.providerUnitsPerSecond, d.providerUnitsPerSecond, KLING_PRICING_BOUNDS.providerUnits.min, KLING_PRICING_BOUNDS.providerUnits.max),
    providerUnitsPerRun: num(r.providerUnitsPerRun, d.providerUnitsPerRun, KLING_PRICING_BOUNDS.providerUnits.min, KLING_PRICING_BOUNDS.providerUnits.max),
    unitCostUsdCents: num(r.unitCostUsdCents, d.unitCostUsdCents, KLING_PRICING_BOUNDS.usdCents.min, KLING_PRICING_BOUNDS.usdCents.max),
    priceUsdCentsPerSecond: num(r.priceUsdCentsPerSecond, d.priceUsdCentsPerSecond, KLING_PRICING_BOUNDS.usdCents.min, KLING_PRICING_BOUNDS.usdCents.max),
    priceUsdCentsPerRun: num(r.priceUsdCentsPerRun, d.priceUsdCentsPerRun, KLING_PRICING_BOUNDS.usdCents.min, KLING_PRICING_BOUNDS.usdCents.max),
    audioSurchargeUsdCentsPerSecond: num(r.audioSurchargeUsdCentsPerSecond, d.audioSurchargeUsdCentsPerSecond, KLING_PRICING_BOUNDS.usdCents.min, KLING_PRICING_BOUNDS.usdCents.max),
    // Clamped INTO the tier's own window, so a floor can never exceed the ceiling.
    minBillableSeconds: int(r.minBillableSeconds, d.minBillableSeconds, minSeconds, maxSeconds),
    minSeconds,
    maxSeconds,
    notes: text(r.notes, d.notes, 400),
  };
}

export function normalizeKlingPricing(raw: unknown): KlingPricingConfig {
  const d = KLING_PRICING_DEFAULTS;
  if (!isRecord(raw)) return d;
  const matrix = isRecord(raw.matrix) ? raw.matrix : {};
  return {
    matrix: Object.fromEntries(KLING_TIER_KEYS.map((k) => [k, normalizeTier(matrix[k], d.matrix[k])])) as Record<KlingTierKey, KlingTierPricing>,
    paused: bool(raw.paused, d.paused),
    version: int(raw.version, d.version, 1, 1_000_000_000),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
  };
}

/** The fields whose change alters what a NEW job costs — a change bumps `version`. */
export function klingPricingFingerprint(c: KlingPricingConfig): string {
  const matrix = Object.fromEntries(KLING_TIER_KEYS.map((k) => [k, { ...c.matrix[k], notes: undefined }]));
  return JSON.stringify({ matrix, paused: c.paused });
}

export function versionKlingPricing(previous: KlingPricingConfig, next: KlingPricingConfig, now: Date = new Date()): KlingPricingConfig {
  if (klingPricingFingerprint(previous) === klingPricingFingerprint(next)) return { ...next, version: previous.version, updatedAt: previous.updatedAt };
  return { ...next, version: previous.version + 1, updatedAt: now.toISOString() };
}

/* ────────────────────────────── the quote ────────────────────────────────── */

/** Which row of the matrix an operation falls on. Lip Sync always its single row. */
export function klingTierKey(feature: KlingPricedFeature, resolution: KlingPricedResolution): KlingTierKey {
  return feature === "lip_sync" ? "lip_sync:source" : (`${feature}:${resolution}` as KlingTierKey);
}

export function klingTier(c: KlingPricingConfig, feature: KlingPricedFeature, resolution: KlingPricedResolution): KlingTierPricing {
  return c.matrix[klingTierKey(feature, resolution)];
}

/** Whether OUR cost for this tier is actually known, or merely unset. */
export function klingTierCostKnown(t: KlingTierPricing): boolean {
  return t.providerUnitsPerSecond > 0 || t.providerUnitsPerRun > 0;
}

export interface KlingQuoteRequest {
  feature: KlingPricedFeature;
  resolution: KlingPricedResolution;
  /** The length asked for, in seconds. */
  seconds: number;
  /** Omni's native audio. Never applies to Lip Sync, which carries its own speech. */
  audio?: boolean;
}

export type KlingQuote =
  | {
      ok: true;
      feature: KlingPricedFeature;
      resolution: KlingPricedResolution;
      tier: KlingTierKey;
      seconds: number;
      /** What was charged for — `seconds` raised to the tier's floor. */
      billableSeconds: number;
      /** The member's price, in US cents. The authoritative number. */
      totalUsdCents: number;
      /** Our estimated provider consumption. null when the tier was never measured. */
      providerUnits: number | null;
      /** Our estimated cost in US cents, when both the units and the unit cost are known. */
      providerCostUsdCents: number | null;
      /** The pricing row's version, so a stored quote can be recognised as stale. */
      pricingVersion: number;
    }
  | { ok: false; reason: string };

/**
 * 🔴 THE ONE AUTHORITATIVE CALCULATOR (§13, §16).
 *
 * PURE and deterministic: the same inputs always produce the same total, so the
 * quote can be signed with the existing HMAC and recomputed at `/start` to the
 * identical number. Nothing here reads a request value that a browser could
 * choose — the caller passes facts it measured, and the config comes from the
 * settings row the admin writes.
 *
 * 🔴 SUBSCRIPTION AND PREPAID BOTH COME HERE. §16: "Both funding methods must use
 * the same authoritative usage calculator." There is deliberately no funding
 * argument — this function does not know, and must not know, whether the member
 * is paying from a wallet or from included credits. Funding decides WHERE the
 * money comes from; this decides HOW MUCH. Two formulas would be two prices for
 * one job, and the cheaper one would be a bug nobody noticed for months.
 */
export function quoteKling(c: KlingPricingConfig, req: KlingQuoteRequest): KlingQuote {
  if (c.paused) return { ok: false, reason: "Kling generation is paused." };

  const key = klingTierKey(req.feature, req.resolution);
  const t = c.matrix[key];
  if (!t) return { ok: false, reason: "That combination is not priced." };
  if (!t.enabled) return { ok: false, reason: "That option is not available right now." };

  if (!Number.isFinite(req.seconds) || req.seconds <= 0) return { ok: false, reason: "The length could not be measured." };
  const seconds = Math.round(req.seconds * 1000) / 1000;
  if (seconds < t.minSeconds) return { ok: false, reason: `This option needs at least ${t.minSeconds} seconds.` };
  if (seconds > t.maxSeconds) return { ok: false, reason: `This option goes up to ${t.maxSeconds} seconds.` };

  const billableSeconds = Math.max(seconds, t.minBillableSeconds);

  // Native audio is an Omni setting; Lip Sync carries its own speech and never surcharges.
  const audioOn = req.feature !== "lip_sync" && req.audio === true;
  const perSecond = t.priceUsdCentsPerSecond + (audioOn ? t.audioSurchargeUsdCentsPerSecond : 0);
  // Rounded to a whole cent at the END, once — a wallet cannot hold a third of a cent.
  const totalUsdCents = Math.ceil(billableSeconds * perSecond + t.priceUsdCentsPerRun);

  const units = klingTierCostKnown(t) ? Math.round((billableSeconds * t.providerUnitsPerSecond + t.providerUnitsPerRun) * 1000) / 1000 : null;
  const providerCostUsdCents = units !== null && t.unitCostUsdCents > 0 ? Math.round(units * t.unitCostUsdCents * 100) / 100 : null;

  return {
    ok: true,
    feature: req.feature,
    resolution: req.resolution,
    tier: key,
    seconds,
    billableSeconds,
    totalUsdCents,
    providerUnits: units,
    providerCostUsdCents,
    pricingVersion: c.version,
  };
}

/**
 * The operator's margin on a quote, in US cents. Null when the tier's cost was
 * never measured — which is the honest answer, and the reason the admin shows
 * "not measured" rather than a reassuring number.
 */
export function klingQuoteMarginUsdCents(q: KlingQuote): number | null {
  if (!q.ok || q.providerCostUsdCents === null) return null;
  return Math.round((q.totalUsdCents - q.providerCostUsdCents) * 100) / 100;
}
