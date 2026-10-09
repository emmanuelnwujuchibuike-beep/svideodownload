/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  CREDIT PACKS — what a member can buy, and what a payment is worth (pure)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-10-07: credits, "billed in USD / currencies supported by the
 * provider". A pack is N credits (+ optional bonus credits) priced at
 * N × centsPerCredit US cents; the payment provider charges that in its own
 * checkout currency (Paystack: NGN at the pinned live rate, as since 0159).
 *
 * Stored inside `frenzAiPlans` (beside `credits.centsPerCredit`, the one rate
 * that defines a credit) so the credit economy is ONE admin card.
 *
 * ── 🔴 WHAT A PAYMENT IS WORTH IS NEVER READ FROM THE PAYMENT'S METADATA ────
 * Transaction metadata is writable by anybody holding the provider's PUBLIC
 * key. So `creditsForPayment` derives the credits from the VERIFIED amount
 * settled (in USD cents, after the checkout-currency check in topup-fx.ts):
 * ⌊paid ÷ centsPerCredit⌋, and the bonus only from a pack that exists in the
 * operator's configuration now and whose size matches what was paid for.
 */

export type TopupProviderId = "paystack" | "bachs";
export const TOPUP_PROVIDER_IDS: readonly TopupProviderId[] = ["paystack", "bachs"];

export interface CreditPack {
  /** Stable id the browser sends back ("pack_100"). */
  id: string;
  credits: number;
  /** Extra credits on top, recorded as a separate `bonus` ledger row. 0 = none. */
  bonusCredits: number;
  enabled: boolean;
  /** Marks the one pack the sheet highlights. */
  highlight: boolean;
}

/** What is being paid for — each has its own routing row. */
export type PaymentPurpose = "wallet_topup" | "ai_subscription" | "ad_campaign";
/** 0197: ad_campaign — an advertiser paying for a campaign (lib/ads-platform/payment-server.ts). Same rails, its own route. */
export const PAYMENT_PURPOSES: readonly PaymentPurpose[] = ["wallet_topup", "ai_subscription", "ad_campaign"];
/** Where the member is, decided SERVER-SIDE from the edge's country header (lib/payments/router.ts). */
export type PaymentMarket = "NG" | "other";
export const PAYMENT_MARKETS: readonly PaymentMarket[] = ["NG", "other"];
export interface PaymentRoute {
  primary: TopupProviderId;
  /** Tried only when the primary is unavailable or its checkout could not be CREATED — never after a checkout exists. */
  fallback: TopupProviderId | null;
}
export type PaymentRouting = Record<PaymentMarket, Record<PaymentPurpose, PaymentRoute>>;

export interface AiWalletConfig {
  packs: CreditPack[];
  /** A member-typed amount of credits, within bounds. Off = packs only. */
  custom: { enabled: boolean; minCredits: number; maxCredits: number };
  /**
   * Which provider takes a payment, per market and purpose (owner, 2026-10-07:
   * "Nigeria: Bachs primary, Paystack fallback; other countries: Paystack").
   * Payments already started with a provider still credit through that
   * provider's webhook whatever this says now.
   */
  routing: PaymentRouting;
  /**
   * Owner, 2026-10-07: "checkout doesn't show to choose Paystack or Bachs" —
   * on: when a market's route has BOTH providers usable, the member picks
   * one in the sheet (the route's primary pre-selected). Off: the route
   * decides silently. Either way the server offers only what the route allows.
   */
  memberChoice: boolean;
  /**
   * 0193 (owner 2026-10-07): member-to-member credit transfers by wallet number.
   * The SENDER pays `feePercent` on top (rounded up); the recipient receives the
   * amount, as usable credits. Bounds per transfer and per rolling 24 hours.
   */
  transfers: CreditTransferConfig;
  /** @deprecated 0184's single switch — read only when a saved config predates `routing`. */
  provider: TopupProviderId;
}

export const WALLET_BOUNDS = {
  packs: 8,
  credits: { min: 1, max: 1_000_000 },
  bonus: { min: 0, max: 1_000_000 },
} as const;

/** $5 · $10 · $25 · $50 · $100 at 10¢ — the dollar shortcuts that were live before 0184, as credits. No bonus is invented. */
export const AI_WALLET_DEFAULTS: AiWalletConfig = {
  packs: [50, 100, 250, 500, 1000].map((credits) => ({ id: `pack_${credits}`, credits, bonusCredits: 0, enabled: true, highlight: credits === 100 })),
  custom: { enabled: true, minCredits: 10, maxCredits: 5000 },
  routing: {
    NG: { wallet_topup: { primary: "bachs", fallback: "paystack" }, ai_subscription: { primary: "bachs", fallback: "paystack" }, ad_campaign: { primary: "bachs", fallback: "paystack" } },
    other: { wallet_topup: { primary: "paystack", fallback: null }, ai_subscription: { primary: "paystack", fallback: null }, ad_campaign: { primary: "paystack", fallback: null } },
  },
  memberChoice: true,
  transfers: { enabled: true, feePercent: 5, depositedFeePercent: 10, minCredits: 10, maxCredits: 5000, dailyMaxCredits: 20000 },
  provider: "paystack",
};

export interface CreditTransferConfig {
  enabled: boolean;
  /** 5 = 5 %, charged to the sender on top of the amount, rounded up to a whole credit. */
  feePercent: number;
  /**
   * 0202 (owner, 2026-10-09: "deposited credits can be sent to others and withdrawn
   * but with a certain charge and rate different from others"): the fee on the part
   * of a Credits transfer that came from a DEPOSIT. The rest pays `feePercent`.
   */
  depositedFeePercent: number;
  minCredits: number;
  maxCredits: number;
  /** Most a member can send in a rolling 24 hours (amounts, not counting fees). */
  dailyMaxCredits: number;
}

/** The fee on a transfer: `feePercent` of the amount, rounded UP — never a fraction of a credit, never less than the rate. */
export function transferFee(amount: number, feePercent: number): number {
  if (!Number.isFinite(amount) || amount <= 0 || feePercent <= 0) return 0;
  return Math.ceil((Math.floor(amount) * feePercent) / 100);
}

/**
 * 0202: the fee on a transfer. Tokens pay `feePercent`. For Credits, the AMOUNT is
 * taken earned-first: the part of it beyond the earned credits came from a
 * deposit and pays `depositedFeePercent`, and the rest pays `feePercent`. The fee
 * itself is then taken from what is left. migration 0202's transfer moves
 * exactly that deposited share to the recipient.
 */
export function transferFeeFor(amount: number, kind: "usable" | "withdrawable", wallet: { withdrawable: number; deposited: number } | null, c: Pick<CreditTransferConfig, "feePercent" | "depositedFeePercent">): number {
  const a = Math.max(0, Math.floor(amount));
  if (kind !== "withdrawable" || !wallet || wallet.deposited <= 0) return transferFee(a, c.feePercent);
  const earned = Math.max(0, Math.floor(wallet.withdrawable) - Math.floor(wallet.deposited));
  const depositedShare = Math.max(0, a - earned);
  return transferFee(a - depositedShare, c.feePercent) + transferFee(depositedShare, c.depositedFeePercent);
}

function normalizeTransfers(raw: unknown): CreditTransferConfig {
  const d = AI_WALLET_DEFAULTS.transfers;
  const r = isRecord(raw) ? raw : {};
  const minCredits = int(r.minCredits, d.minCredits, 1, 1_000_000);
  const maxCredits = Math.max(minCredits, int(r.maxCredits, d.maxCredits, 1, 10_000_000));
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : d.enabled,
    feePercent: Math.min(50, Math.max(0, typeof r.feePercent === "number" && Number.isFinite(r.feePercent) ? Math.round(r.feePercent * 100) / 100 : d.feePercent)),
    depositedFeePercent: Math.min(50, Math.max(0, typeof r.depositedFeePercent === "number" && Number.isFinite(r.depositedFeePercent) ? Math.round(r.depositedFeePercent * 100) / 100 : d.depositedFeePercent)),
    minCredits,
    maxCredits,
    dailyMaxCredits: Math.max(maxCredits, int(r.dailyMaxCredits, d.dailyMaxCredits, 1, 100_000_000)),
  };
}

function normalizeRoute(raw: unknown, d: PaymentRoute): PaymentRoute {
  const r = isRecord(raw) ? raw : {};
  const primary: TopupProviderId = r.primary === "bachs" || r.primary === "paystack" ? r.primary : d.primary;
  const fb = r.fallback === null ? null : r.fallback === "bachs" || r.fallback === "paystack" ? r.fallback : d.fallback;
  // a fallback to the primary itself is no fallback
  return { primary, fallback: fb === primary ? null : fb };
}

export function normalizePaymentRouting(raw: unknown): PaymentRouting {
  const r = isRecord(raw) ? raw : {};
  const d = AI_WALLET_DEFAULTS.routing;
  return Object.fromEntries(
    PAYMENT_MARKETS.map((m) => {
      const mr = isRecord(r[m]) ? (r[m] as Record<string, unknown>) : {};
      return [m, Object.fromEntries(PAYMENT_PURPOSES.map((p) => [p, normalizeRoute(mr[p], d[m][p])]))];
    }),
  ) as PaymentRouting;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function int(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function normalizeAiWalletConfig(raw: unknown): AiWalletConfig {
  const d = AI_WALLET_DEFAULTS;
  if (!isRecord(raw)) return { ...d, packs: d.packs.map((p) => ({ ...p })), custom: { ...d.custom }, routing: normalizePaymentRouting(null), transfers: { ...d.transfers } };
  const seen = new Set<string>();
  const packs: CreditPack[] = [];
  if (Array.isArray(raw.packs)) {
    for (const p of raw.packs) {
      if (!isRecord(p)) continue;
      const credits = int(p.credits, 0, 0, WALLET_BOUNDS.credits.max);
      if (credits < WALLET_BOUNDS.credits.min) continue;
      const id = `pack_${credits}`;
      // one pack per size: the size IS the identity a payment is matched back to
      if (seen.has(id)) continue;
      seen.add(id);
      packs.push({ id, credits, bonusCredits: int(p.bonusCredits, 0, WALLET_BOUNDS.bonus.min, WALLET_BOUNDS.bonus.max), enabled: p.enabled !== false, highlight: p.highlight === true });
      if (packs.length >= WALLET_BOUNDS.packs) break;
    }
  }
  const c = isRecord(raw.custom) ? raw.custom : {};
  const minCredits = int(c.minCredits, d.custom.minCredits, WALLET_BOUNDS.credits.min, WALLET_BOUNDS.credits.max);
  return {
    packs: (Array.isArray(raw.packs) ? packs : d.packs.map((p) => ({ ...p }))).sort((a, b) => a.credits - b.credits),
    custom: { enabled: typeof c.enabled === "boolean" ? c.enabled : d.custom.enabled, minCredits, maxCredits: Math.max(minCredits, int(c.maxCredits, d.custom.maxCredits, WALLET_BOUNDS.credits.min, WALLET_BOUNDS.credits.max)) },
    routing: normalizePaymentRouting(raw.routing),
    memberChoice: typeof raw.memberChoice === "boolean" ? raw.memberChoice : d.memberChoice,
    transfers: normalizeTransfers(raw.transfers),
    provider: raw.provider === "bachs" ? "bachs" : "paystack",
  };
}

/* ───────────────────────────── buying ────────────────────────────────────── */

export interface Purchase {
  credits: number;
  bonusCredits: number;
  /** What is charged, in US cents, before any checkout-currency conversion. */
  priceUsdCents: number;
  packId: string | null;
}

/**
 * What a member asked to buy, checked against the operator's offer. A pack
 * id must name an enabled pack; a typed amount must be within the custom
 * bounds (and the custom amount must be switched on). Anything else is refused.
 */
export function resolvePurchase(input: { packId?: unknown; credits?: unknown }, cfg: AiWalletConfig, centsPerCredit: number): Purchase | { error: string } {
  const cpc = Math.max(1, Math.round(centsPerCredit));
  if (typeof input.packId === "string" && input.packId) {
    const pack = cfg.packs.find((p) => p.id === input.packId && p.enabled);
    if (!pack) return { error: "That pack isn't available. Choose another." };
    return { credits: pack.credits, bonusCredits: pack.bonusCredits, priceUsdCents: pack.credits * cpc, packId: pack.id };
  }
  const n = typeof input.credits === "number" ? input.credits : NaN;
  if (!Number.isInteger(n)) return { error: "Choose how many credits to add." };
  // a typed amount that happens to equal a pack IS that pack (the same bonus, the same row)
  const pack = cfg.packs.find((p) => p.credits === n && p.enabled);
  if (pack) return { credits: pack.credits, bonusCredits: pack.bonusCredits, priceUsdCents: pack.credits * cpc, packId: pack.id };
  if (!cfg.custom.enabled) return { error: "Choose one of the packs." };
  if (n < cfg.custom.minCredits || n > cfg.custom.maxCredits) return { error: `Choose between ${cfg.custom.minCredits.toLocaleString("en-US")} and ${cfg.custom.maxCredits.toLocaleString("en-US")} credits.` };
  return { credits: n, bonusCredits: 0, priceUsdCents: n * cpc, packId: null };
}

/**
 * 🔴 What a VERIFIED payment buys. `paidUsdCents` is the amount the provider
 * settled, already checked against the checkout-currency pin. The credits
 * come from it alone; the bonus only from a configured, enabled pack of
 * exactly that size — a pack id in the metadata that does not match what was
 * paid earns nothing extra.
 */
export function creditsForPayment(input: { paidUsdCents: number; packId?: unknown }, cfg: AiWalletConfig, centsPerCredit: number): { credits: number; bonusCredits: number; packId: string | null } {
  const cpc = Math.max(1, Math.round(centsPerCredit));
  const credits = Math.max(0, Math.floor(Math.round(input.paidUsdCents) / cpc));
  const pack = typeof input.packId === "string" ? cfg.packs.find((p) => p.id === input.packId && p.enabled && p.credits === credits) : undefined;
  return { credits, bonusCredits: pack?.bonusCredits ?? 0, packId: pack?.id ?? null };
}

/** The offer as a browser may see it: sizes, bonuses and prices — never a provider key. */
export function publicWalletOffer(cfg: AiWalletConfig, centsPerCredit: number) {
  const cpc = Math.max(1, Math.round(centsPerCredit));
  return {
    packs: cfg.packs.filter((p) => p.enabled).map((p) => ({ id: p.id, credits: p.credits, bonusCredits: p.bonusCredits, priceUsdCents: p.credits * cpc, highlight: p.highlight })),
    custom: cfg.custom.enabled ? { minCredits: cfg.custom.minCredits, maxCredits: cfg.custom.maxCredits } : null,
    centsPerCredit: cpc,
    // 0193: what the send sheet shows before the server re-decides
    transfers: cfg.transfers.enabled ? { feePercent: cfg.transfers.feePercent, depositedFeePercent: cfg.transfers.depositedFeePercent, minCredits: cfg.transfers.minCredits, maxCredits: cfg.transfers.maxCredits, dailyMaxCredits: cfg.transfers.dailyMaxCredits } : null,
  };
}
export type PublicWalletOffer = ReturnType<typeof publicWalletOffer>;
