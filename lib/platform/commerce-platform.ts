/**
 * The Enterprise Commerce Platform, described by itself.
 *
 * The brief asks for a Commerce Gateway, Subscription/Payment/Billing/Marketplace/
 * Payout/Promotion/Invoice/Settlement services, Commerce Intelligence™, a Creator
 * Economy Platform™ and a Commerce Registry™. As with the seven platform maps
 * before it, the substrate that EXISTS is honestly smaller than the brief — this
 * product's real revenue today is subscriptions + advertising + affiliates + API
 * billing — so this file maps what's live and marks the rest `planned`, never
 * implied as done:
 *
 *   - Paystack subscriptions (Pro/Business), HMAC-verified webhook, checkout +
 *     billing-portal routes (`lib/paystack/*`, `app/api/{checkout,paystack,billing}`),
 *   - plan/entitlement + editable display pricing (`lib/monetization/{plan,pricing}.ts`),
 *   - the revenue decision engine, ads and affiliate offers
 *     (`lib/monetization/{decision-engine,ads,affiliates}.ts`),
 *   - developer/API billing + real revenue/subscriber analytics
 *     (`lib/api/keys.ts`, `lib/monetization/stats.ts`).
 *
 * The marketplace, creator payouts, formal invoices/receipts, refund workflows,
 * promotions/coupons and the fraud/AI layer are `planned` — several sit over
 * concept-stage products (marketplace, creator economy) the Reality Ledger will
 * not let us pretend ship.
 *
 * Same truth rule as the rest of the kernel (docs/CONSTITUTION.md, Article I.3),
 * enforced by `commerce-platform.test.ts`: a `live`/`partial` row must point at a
 * file that exists; a `planned` row must not pretend to.
 */

export type CommerceStatus =
  /** A declared, load-bearing implementation in code. */
  | "live"
  /** Real and load-bearing, but a subset of the full brief. */
  | "partial"
  /** Named by the brief, not built. Honest placeholder, never implied as done. */
  | "planned";

/** The shared shape every source-backed catalogue row satisfies. */
interface CatalogueEntry {
  id: string;
  /** Repo-relative source of truth. Empty ONLY when `planned`. */
  source: string;
  status: CommerceStatus;
}

/* ─────────────────────────────── services ───────────────────────────────────
 * The brief's Backend Architecture list, mapped to the real provider of each
 * capability.
 */

export interface CommerceService extends CatalogueEntry {
  name: string;
  capability: string;
  note?: string;
}

export const COMMERCE_SERVICES: CommerceService[] = [
  { id: "payments", name: "Payment Service", source: "lib/paystack/paystack.ts", status: "live", capability: "Paystack REST client — initialise transactions, resolve plan codes, verify webhook HMAC-SHA512.", note: "Dormant unless PAYSTACK_SECRET_KEY is set, so builds/dev never break." },
  { id: "checkout", name: "Commerce Gateway / Checkout", source: "app/api/checkout/route.ts", status: "live", capability: "Starts a hosted Paystack checkout for a chosen plan." },
  { id: "webhook", name: "Payment Webhook", source: "app/api/paystack/webhook/route.ts", status: "live", capability: "Signature-verified provider callback that settles subscription state on charge/renewal/cancel." },
  { id: "subscription", name: "Subscription Service", source: "lib/paystack/sync.ts", status: "live", capability: "Syncs Paystack subscription status to the local `subscriptions` row + plan entitlement." },
  { id: "billing-portal", name: "Billing Portal", source: "app/api/billing/portal/route.ts", status: "live", capability: "Sends a subscriber to Paystack's management page to update card / cancel." },
  { id: "plans", name: "Plan / Entitlement Service", source: "lib/monetization/plan.ts", status: "live", capability: "Resolves a user's plan + per-plan limits; one subscription unlocks the tier everywhere." },
  { id: "pricing", name: "Pricing Service", source: "lib/monetization/pricing.ts", status: "live", capability: "Editable display pricing per tier, admin-set without a redeploy." },
  { id: "decision", name: "Revenue Decision Engine", source: "lib/monetization/decision-engine.ts", status: "live", capability: "Per-request routing between ad / affiliate / premium-prompt / API-upsell by context + value." },
  { id: "ads", name: "Advertising Billing", source: "lib/monetization/ads.ts", status: "live", capability: "Ad placements, impressions and clicks — the primary revenue for free traffic." },
  { id: "affiliates", name: "Affiliate Offers", source: "lib/monetization/affiliates.ts", status: "live", capability: "Curated affiliate offers with tracked redirects." },
  { id: "api-billing", name: "Developer / API Billing", source: "lib/api/keys.ts", status: "live", capability: "API keys + per-key daily usage metering against the plan's API limit." },
  { id: "analytics", name: "Commerce Analytics", source: "lib/monetization/stats.ts", status: "live", capability: "Revenue/MRR (derived from the admin price, not a guessed env), subscribers, ad engagement." },
  { id: "admin", name: "Commerce Administration", source: "features/admin/revenue-overview.tsx", status: "live", capability: "Revenue overview + plan/pricing/limits/affiliate management, no code change." },
  { id: "refunds", name: "Refund workflow", source: "", status: "planned", capability: "In-app refund / partial-refund request + approval flow.", note: "Refunds are possible today from the Paystack dashboard; an in-app workflow with an audit trail is deferred." },
  { id: "marketplace-tx", name: "Marketplace Transaction Service", source: "", status: "planned", capability: "Orders, inventory, checkout, shipping, returns, buyer protection, disputes.", note: "The Marketplace product is concept-stage in the Product Genome." },
  { id: "payouts", name: "Creator Payout Service", source: "", status: "planned", capability: "Creator earnings, revenue sharing, tips, settlements.", note: "The Creator Economy is concept-stage; no payout rails are wired." },
  { id: "settlement", name: "Settlement Service", source: "", status: "planned", capability: "Seller/creator settlement runs + reconciliation." },
  { id: "invoice", name: "Invoice / Receipt Service", source: "", status: "planned", capability: "Formal invoices, receipts and tax calculation hooks.", note: "Paystack emails a payment receipt today; a branded invoice/receipt store with tax hooks is deferred." },
  { id: "promotions", name: "Promotion Service", source: "", status: "planned", capability: "Coupons, discounts, credits, referrals, loyalty, bundles." },
  { id: "fraud", name: "Fraud Integration", source: "", status: "planned", capability: "Transaction risk scoring + promo-abuse detection.", note: "Paystack runs provider-side fraud checks; an in-app risk layer is deferred." },
];

/* ─────────────────────────── supported commerce types ───────────────────────
 * The brief's Supported Commerce Types. Each live/partial type is powered by a
 * service (an id in COMMERCE_SERVICES); the concept-stage types are `planned`.
 */

export interface CommerceType {
  id: string;
  label: string;
  /** The COMMERCE_SERVICES id that powers it. Empty ONLY when `planned`. */
  poweredBy: string;
  status: CommerceStatus;
  note?: string;
}

export const COMMERCE_TYPES: CommerceType[] = [
  { id: "subscriptions", label: "Subscriptions", poweredBy: "subscription", status: "live", note: "Pro + Business, monthly, via Paystack." },
  { id: "advertising", label: "Advertising billing", poweredBy: "ads", status: "live" },
  { id: "affiliate", label: "Affiliate revenue", poweredBy: "affiliates", status: "live" },
  { id: "api", label: "Developer / API billing", poweredBy: "api-billing", status: "live" },
  { id: "marketplace", label: "Marketplace purchases", poweredBy: "", status: "planned" },
  { id: "digital-products", label: "Digital products", poweredBy: "", status: "planned" },
  { id: "physical-products", label: "Physical products", poweredBy: "", status: "planned" },
  { id: "business-services", label: "Business services", poweredBy: "", status: "planned" },
  { id: "creator", label: "Creator monetization", poweredBy: "", status: "planned" },
  { id: "premium-ai", label: "Premium AI usage", poweredBy: "", status: "planned", note: "No metered AI product exists (the `smart` module is concept-stage)." },
  { id: "cloud-upgrade", label: "Cloud storage upgrades", poweredBy: "", status: "planned", note: "Storage tiers are a plan entitlement today, not a standalone purchase." },
  { id: "enterprise", label: "Enterprise billing", poweredBy: "", status: "planned" },
];

/* ─────────────────────────── payment capabilities ───────────────────────────
 * The brief's Payment Platform — methods and payment features. Card/wallet/bank/
 * regional are all provided BY Paystack; which are enabled is an account-level
 * dashboard config, so those are `partial` (integrated, config-gated) unless
 * they're the default path.
 */

export interface PaymentCapability extends CatalogueEntry {
  name: string;
  description: string;
  note?: string;
}

export const PAYMENT_CAPABILITIES: PaymentCapability[] = [
  { id: "provider-paystack", name: "Paystack provider", source: "lib/paystack/paystack.ts", status: "live", description: "The integrated PSP — Africa-primary, matching the app's cdg1/Paris infra." },
  { id: "cards", name: "Credit / debit cards", source: "lib/paystack/paystack.ts", status: "live", description: "The default Paystack checkout method." },
  { id: "recurring", name: "Recurring payments", source: "lib/paystack/sync.ts", status: "live", description: "Subscription renewals tracked from the webhook." },
  { id: "one-time", name: "One-time payments", source: "app/api/checkout/route.ts", status: "live", description: "A single hosted-checkout charge." },
  { id: "regional", name: "Regional methods (bank, USSD, mobile money)", source: "lib/paystack/paystack.ts", status: "partial", description: "Offered by Paystack at checkout.", note: "Availability is an account-level Paystack config, not code — hence partial." },
  { id: "wallets", name: "Digital wallets", source: "lib/paystack/paystack.ts", status: "partial", description: "Apple/Google Pay where the Paystack account enables them.", note: "Dashboard-gated, not code-gated." },
  { id: "multi-provider", name: "Multiple payment providers", source: "", status: "planned", description: "A provider-abstraction over more than Paystack (Stripe, etc.).", note: "The plan/webhook seams are provider-shaped, but only Paystack is wired." },
  { id: "refunds", name: "Refunds / partial refunds", source: "", status: "planned", description: "In-app initiated (provider dashboard handles them today)." },
  { id: "split", name: "Split payments", source: "", status: "planned", description: "Marketplace split between platform + seller." },
];

/* ───────────────────────────── subscription tiers ───────────────────────────
 * The brief's Subscription Platform — the plans that exist, and the ones planned.
 */

export interface SubscriptionTier {
  id: string;
  label: string;
  source: string;
  status: CommerceStatus;
  note?: string;
}

export const SUBSCRIPTION_TIERS: SubscriptionTier[] = [
  { id: "free", label: "Free", source: "lib/monetization/plan.ts", status: "live", note: "Ads on, daily limits; the default." },
  { id: "pro", label: "Pro", source: "lib/monetization/plan.ts", status: "live", note: "Ad-free, higher limits, 50 GB private cloud." },
  { id: "business", label: "Business", source: "lib/monetization/plan.ts", status: "live", note: "Unlimited storage, highest limits." },
  { id: "trials", label: "Trials", source: "", status: "planned" },
  { id: "creator-plan", label: "Creator plan", source: "", status: "planned" },
  { id: "professional-plan", label: "Professional plan", source: "", status: "planned" },
  { id: "enterprise-plan", label: "Enterprise plan", source: "", status: "planned" },
  { id: "family", label: "Family plans", source: "", status: "planned" },
  { id: "org-billing", label: "Organization billing", source: "", status: "planned" },
  { id: "usage-based", label: "Usage-based plans", source: "", status: "planned", note: "API usage is metered against a daily limit; true metered billing is deferred." },
];

/* ────────────────────────── billing + promotions ────────────────────────────
 * The brief's Billing Platform + Promotions sections, staged honestly.
 */

export interface BillingCapability extends CatalogueEntry {
  name: string;
  /** "billing" | "promotion" grouping. */
  kind: "billing" | "promotion";
  description: string;
  note?: string;
}

export const BILLING_AND_PROMOTIONS: BillingCapability[] = [
  { id: "payment-history", name: "Payment & subscription history", kind: "billing", source: "lib/monetization/stats.ts", status: "live", description: "Subscriber + revenue history from the `subscriptions` domain." },
  { id: "renewal", name: "Renewal handling", kind: "billing", source: "app/api/paystack/webhook/route.ts", status: "live", description: "Renewals settle via the webhook; a lapsed charge downgrades the plan." },
  { id: "billing-analytics", name: "Billing analytics", kind: "billing", source: "lib/monetization/stats.ts", status: "live", description: "MRR/revenue derived from the real admin-set price, never a guessed env." },
  { id: "receipts", name: "Receipts", kind: "billing", source: "", status: "planned", description: "A branded in-app receipt/invoice store.", note: "Paystack emails a provider payment receipt today; an in-app receipt store is deferred (grouped with invoices)." },
  { id: "invoices", name: "Invoices + tax hooks", kind: "billing", source: "", status: "planned", description: "Formal invoices with tax calculation hooks." },
  { id: "dunning", name: "Failed-payment recovery (dunning)", kind: "billing", source: "", status: "planned", description: "Retry + reminder sequence on a failed charge.", note: "A failed renewal downgrades today; an active recovery sequence is deferred." },
  { id: "coupons", name: "Coupons & discounts", kind: "promotion", source: "", status: "planned", description: "Percentage/fixed codes at checkout." },
  { id: "referrals", name: "Referral rewards", kind: "promotion", source: "", status: "planned", description: "Give/get credit for referrals." },
  { id: "loyalty", name: "Loyalty & credits", kind: "promotion", source: "", status: "planned", description: "Credit balance + loyalty tiers." },
  { id: "campaigns", name: "Campaigns & bundles", kind: "promotion", source: "", status: "planned", description: "Limited-time offers + bundle pricing." },
];

/* ─────────────────────────── AI (Commerce Intelligence) ──────────────────────
 * The brief's AI Platform Integration. None built — analytics today are real but
 * descriptive (counts + derived MRR), not predictive. Each row is `planned`.
 */

export interface CommerceAiCapability extends CatalogueEntry {
  name: string;
  description: string;
}

export const COMMERCE_AI: CommerceAiCapability[] = [
  { id: "fraud-analysis", name: "Fraud analysis", source: "", status: "planned", description: "ML risk scoring on transactions + promo abuse." },
  { id: "insights", name: "Commerce insights", source: "", status: "planned", description: "Narrated trends beyond the raw dashboards." },
  { id: "promo-recs", name: "Promotion recommendations", source: "", status: "planned", description: "Which offer to show whom." },
  { id: "sub-optimization", name: "Subscription optimization", source: "", status: "planned", description: "Churn-risk + best-plan nudges." },
  { id: "forecasting", name: "Revenue forecasting", source: "", status: "planned", description: "Predicted MRR / growth." },
  { id: "support-assist", name: "Customer support assistance", source: "", status: "planned", description: "AI help for billing questions." },
];

/* ─────────────────────────────────── reads ──────────────────────────────────── */

export function getCommerceServices(): CommerceService[] {
  return COMMERCE_SERVICES;
}
export function getCommerceTypes(): CommerceType[] {
  return COMMERCE_TYPES;
}
export function getPaymentCapabilities(): PaymentCapability[] {
  return PAYMENT_CAPABILITIES;
}
export function getSubscriptionTiers(): SubscriptionTier[] {
  return SUBSCRIPTION_TIERS;
}
export function getBillingAndPromotions(): BillingCapability[] {
  return BILLING_AND_PROMOTIONS;
}
export function getCommerceAi(): CommerceAiCapability[] {
  return COMMERCE_AI;
}

/** Everything source-backed, for the platform-health summary + teeth. */
export function commercePlatformEntries(): CatalogueEntry[] {
  return [
    ...COMMERCE_SERVICES,
    ...PAYMENT_CAPABILITIES,
    ...SUBSCRIPTION_TIERS,
    ...BILLING_AND_PROMOTIONS,
    ...COMMERCE_AI,
  ];
}
