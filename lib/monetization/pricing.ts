import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Editable display pricing for the /pricing page. Stored in the `settings` table
 * (key `pricing`) so an admin can change the shown prices without a redeploy.
 * NOTE: this is the DISPLAYED price only — the amount actually charged is set on
 * the Paystack plan. Keep them in sync.
 */

export interface PricingTier {
  name: string;
  price: string; // includes currency symbol, e.g. "$4.99" or "₦2,500"
  period: string; // e.g. "/mo"
}
export interface Pricing {
  pro: PricingTier;
  business: PricingTier;
  /**
   * 3-month prepaid bundles for members in NIGERIA (owner, 2026-10-24: "Nigeria users … 3months for 4.99 … 3 months
   * business plan for 12.99"): paid once in naira at today's rate (bank transfer, USSD, card), three months, nothing
   * renews. A plain US-dollar price ("$4.99"); "" = that bundle is not offered. Shown on its own button with the naira amount.
   */
  ngQuarterly?: { pro: string; business: string };
}

const hasSupabase =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY;

export const DEFAULT_PRICING: Pricing = {
  pro: {
    name: "Pro",
    price: process.env.PRICE_DISPLAY_PRO || "$4.99",
    period: "/mo",
  },
  business: {
    name: "Business",
    price: process.env.PRICE_DISPLAY_BUSINESS || "$9.99",
    period: "/mo",
  },
};

/**
 * The admin editor (features/admin/pricing-editor.tsx) is a bare text input
 * with no format validation, so a price typed without its symbol — "4.99"
 * instead of "$4.99" — is stored exactly as typed and renders on /pricing
 * looking like a broken currency (found via screenshot review, 2026-08-26).
 *
 * Only normalizes a value that starts with a DIGIT — the actual shape of that
 * bug. A price already carrying a symbol (`$4.99`, `₦2,500` — the docblock
 * above explicitly allows non-`$` currencies) is left exactly as entered.
 */
function normalizePrice(price: string): string {
  return /^\d/.test(price) ? `$${price}` : price;
}

export async function getPricing(): Promise<Pricing> {
  if (!hasSupabase) return DEFAULT_PRICING;
  try {
    const db = createAdminClient();
    const { data } = await db
      .from("settings")
      .select("value")
      .eq("key", "pricing")
      .maybeSingle();
    const v = (data?.value ?? null) as Partial<Pricing> | null;
    if (!v) return DEFAULT_PRICING;
    const merged = {
      pro: { ...DEFAULT_PRICING.pro, ...(v.pro ?? {}) },
      business: { ...DEFAULT_PRICING.business, ...(v.business ?? {}) },
    };
    const q = v.ngQuarterly;
    return {
      pro: { ...merged.pro, price: normalizePrice(merged.pro.price) },
      business: {
        ...merged.business,
        price: normalizePrice(merged.business.price),
      },
      ngQuarterly: {
        pro: typeof q?.pro === "string" && q.pro.trim() ? normalizePrice(q.pro.trim()) : "",
        business: typeof q?.business === "string" && q.business.trim() ? normalizePrice(q.business.trim()) : "",
      },
    };
  } catch {
    return DEFAULT_PRICING;
  }
}

export async function setPricing(p: Pricing): Promise<void> {
  const db = createAdminClient();
  // a save that does not name the Nigeria bundles keeps them (an older editor must never wipe them)
  let value: Pricing = p;
  if (p.ngQuarterly === undefined) {
    const { data } = await db.from("settings").select("value").eq("key", "pricing").maybeSingle();
    const kept = (data?.value as Partial<Pricing> | null)?.ngQuarterly;
    if (kept) value = { ...p, ngQuarterly: kept };
  }
  await db
    .from("settings")
    .upsert({ key: "pricing", value }, { onConflict: "key" });
}
