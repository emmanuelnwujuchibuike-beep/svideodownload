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

/**
 * The providers a NEW payment may use. Bachs was removed on 2026-10-17 (owner): a row written
 * before then may still say `provider = 'bachs'` in the database (kept for history, typed as a
 * plain string where it is read) — but no setting, route or checkout can name it any more.
 *
 * Flutterwave added 2026-10-23 (owner: the primary rail, charging USD; Paystack the backup in
 * NGN). Being listed here only lets a route NAME it — a checkout uses it only when the account
 * capability gate in lib/flutterwave/config.ts says the purpose and currency are confirmed.
 */
export type TopupProviderId = "flutterwave" | "paystack";
export const TOPUP_PROVIDER_IDS: readonly TopupProviderId[] = ["flutterwave", "paystack"];

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
export type PaymentPurpose = "wallet_topup" | "ai_subscription" | "ad_campaign" | "sub_purchase" | "verification" | "site_subscription";
/**
 * 0197: ad_campaign — an advertiser paying for a campaign (lib/ads-platform/payment-server.ts). Same rails, its own route.
 * Part 2 (Flutterwave): sub_purchase (a creator subscription, lib/sub/server.ts) and verification (the paid blue
 * tick, lib/social/paid-verification.ts) ask the router too — before, both called Paystack directly.
 */
// site_subscription (2026-10-23): the Pro / Business site plans — Flutterwave first too (owner: "Pro and business should be Flutterwave too")
export const PAYMENT_PURPOSES: readonly PaymentPurpose[] = ["wallet_topup", "ai_subscription", "ad_campaign", "sub_purchase", "verification", "site_subscription"];
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
   * Which provider takes a payment, per market and purpose. Default (owner 2026-10-23):
   * Flutterwave first, Paystack the fallback, in every market. Flutterwave is skipped while
   * its account capability is unconfirmed, so the effective route stays Paystack.
   */
  routing: PaymentRouting;
  /** Part 2.1: which routing rules the saved table was written under (absent = 1, before Flutterwave). See `normalizeRoute`. */
  routingVersion: number;
  /**
   * On: when a market's route has TWO usable providers, the member picks one in the
   * sheet (the primary pre-selected). With Paystack alone there is never a choice.
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

const FW_THEN_PAYSTACK: PaymentRoute = { primary: "flutterwave", fallback: "paystack" };
const PAYSTACK_THEN_FW: PaymentRoute = { primary: "paystack", fallback: "flutterwave" };
const every = (r: PaymentRoute): Record<PaymentPurpose, PaymentRoute> => ({ wallet_topup: r, ai_subscription: r, ad_campaign: r, sub_purchase: r, verification: r, site_subscription: r });
/*
  Owner, 2026-10-27: "make Nigeria users use Paystack as first choice of payment, deposit, plan and withdraw provider,
  but they can decide to switch. Outside Nigeria … Flutterwave as first choice." Nigeria: Paystack first, Flutterwave
  the fallback (the member may pick it: memberChoice). Everywhere else: Flutterwave first, Paystack the backup.
*/
const ROUTE_DEFAULTS_NG = every(PAYSTACK_THEN_FW);
const ROUTE_DEFAULTS = every(FW_THEN_PAYSTACK);

/** $5 · $10 · $25 · $50 · $100 at 10¢ — the dollar shortcuts that were live before 0184, as credits. No bonus is invented. */
export const AI_WALLET_DEFAULTS: AiWalletConfig = {
  packs: [50, 100, 250, 500, 1000].map((credits) => ({ id: `pack_${credits}`, credits, bonusCredits: 0, enabled: true, highlight: credits === 100 })),
  custom: { enabled: true, minCredits: 10, maxCredits: 5000 },
  routing: { NG: ROUTE_DEFAULTS_NG, other: ROUTE_DEFAULTS },
  routingVersion: 3,
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

/** Only a provider that still exists is kept: a saved "bachs" (removed 2026-10-17) reads as the route's default. */
const knownProvider = (v: unknown): v is TopupProviderId => (TOPUP_PROVIDER_IDS as readonly unknown[]).includes(v);

/**
 * ── Saved routes and Flutterwave (Part 2.1, 2026-10-23) ─────────────────────────
 * The routing table is saved inside `frenzAiPlans.wallet`. Every table saved BEFORE Flutterwave
 * existed (no `routingVersion`, i.e. version 1) could only say "Paystack" — between 2026-10-07 and
 * 10-17 the choice was Paystack vs Bachs, and since 10-17 the card re-saved the normalized
 * Paystack-only table untouched (it had no editor). Such a route is not a decision against
 * Flutterwave, so on READ a version-1 route that names only Paystack takes the new default
 * (Flutterwave → Paystack). From version 2 on (written by every save from now, and by the Part 5
 * editor), the saved table is authoritative.
 *
 * Whatever the table says, two rules hold:
 *   · Flutterwave is used only through its capability gate (lib/payments/rails.ts) — a route can
 *     NAME it, never enable it;
 *   · Paystack is always the backup behind Flutterwave (owner policy): a route "Flutterwave, no
 *     fallback" reads as "Flutterwave → Paystack", so a closed gate can never close payments.
 * Open attempts are never re-routed: routing only picks the rail of a NEW checkout, and every open
 * attempt answers through the provider written on its own row.
 */
// 3 (2026-10-27): Nigeria's rows default to Paystack first — a table saved before (Flutterwave first everywhere) is read
// with Nigeria's Flutterwave-first rows turned to Paystack-first; anything an admin saves from now on is kept as saved
export const ROUTING_VERSION = 3;

function normalizeRoute(raw: unknown, d: PaymentRoute, version: number): PaymentRoute {
  const r = isRecord(raw) ? raw : {};
  // a saved route whose primary is not a live provider (a removed "bachs", nothing saved) is the WHOLE default
  // route — never "Flutterwave with no fallback", which would close payments while Flutterwave is unconfirmed
  if (!knownProvider(r.primary)) return { ...d };
  const primary: TopupProviderId = r.primary;
  const fb = r.fallback === null ? null : knownProvider(r.fallback) ? r.fallback : d.fallback;
  // a version-1 Paystack-only route predates Flutterwave: the new default
  if (version < 2 && primary === "paystack" && (fb === null || fb === "paystack")) return { ...d };
  // version 3: where the default is now Paystack first (Nigeria), a saved Flutterwave-first row from before becomes it
  if (version < 3 && d.primary === "paystack" && primary === "flutterwave") return { ...d };
  // Paystack always backs Flutterwave
  if (primary === "flutterwave" && (fb === null || fb === "flutterwave")) return { primary, fallback: "paystack" };
  // a fallback to the primary itself is no fallback
  return { primary, fallback: fb === primary ? null : fb };
}

/**
 * Part 5 — what an ADMIN may save, checked server-side before anything is written (the normaliser above repairs a
 * stored row silently; a save is refused out loud instead). Every market × purpose must be a known pair, and:
 *   · a fallback is never the primary itself;
 *   · Flutterwave is always backed by Paystack (Paystack stays the backup — a Flutterwave-only route would close
 *     payments whenever Flutterwave's gate is shut).
 * Naming Flutterwave here never makes it usable: the capability gate (lib/flutterwave/config.ts) still decides, and it
 * is OFF until its currency, purposes and amount unit are confirmed. Returns the first problem, or null.
 */
export function paymentRoutingProblem(raw: unknown): string | null {
  if (raw === undefined) return null;
  if (!isRecord(raw)) return "Routing must be a table of markets.";
  for (const [market, row] of Object.entries(raw)) {
    if (!(PAYMENT_MARKETS as readonly string[]).includes(market)) return `Unknown market "${market}".`;
    if (!isRecord(row)) return `Routing for ${market} must be a table of purposes.`;
    for (const [purpose, route] of Object.entries(row)) {
      if (!(PAYMENT_PURPOSES as readonly string[]).includes(purpose)) return `Unknown payment purpose "${purpose}".`;
      if (!isRecord(route) || !knownProvider(route.primary)) return `${market} · ${purpose}: choose Flutterwave or Paystack.`;
      if (route.fallback !== null && !knownProvider(route.fallback)) return `${market} · ${purpose}: unknown backup provider.`;
      if (route.fallback === route.primary) return `${market} · ${purpose}: the backup can't be the same provider.`;
      if (route.primary === "flutterwave" && route.fallback !== "paystack") return `${market} · ${purpose}: Flutterwave must have Paystack as its backup.`;
    }
  }
  return null;
}

/** `version`: the saved table's `routingVersion` (absent = 1, from before Flutterwave). */
export function normalizePaymentRouting(raw: unknown, version?: unknown): PaymentRouting {
  const r = isRecord(raw) ? raw : {};
  const d = AI_WALLET_DEFAULTS.routing;
  const v = typeof version === "number" && Number.isInteger(version) ? version : 1;
  return Object.fromEntries(
    PAYMENT_MARKETS.map((m) => {
      const mr = isRecord(r[m]) ? (r[m] as Record<string, unknown>) : {};
      return [m, Object.fromEntries(PAYMENT_PURPOSES.map((p) => [p, normalizeRoute(mr[p], d[m][p], v)]))];
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
  if (!isRecord(raw)) return { ...d, packs: d.packs.map((p) => ({ ...p })), custom: { ...d.custom }, routing: normalizePaymentRouting(null, ROUTING_VERSION), transfers: { ...d.transfers } };
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
    routing: normalizePaymentRouting(raw.routing, raw.routingVersion),
    // what is read is now a version-2 table: a save from the admin card writes it back as authoritative
    routingVersion: ROUTING_VERSION,
    memberChoice: typeof raw.memberChoice === "boolean" ? raw.memberChoice : d.memberChoice,
    transfers: normalizeTransfers(raw.transfers),
    provider: "paystack",
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
