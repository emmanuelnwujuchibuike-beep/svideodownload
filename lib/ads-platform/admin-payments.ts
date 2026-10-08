import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { activatePaidCampaigns, adPaymentStatus } from "./payment-server";

/**
 * The admin's view of ad payments (Part 3) — over the SAME attempt ledger
 * every payment uses (ai_topup_attempts, purpose ad_campaign), joined to the
 * campaigns it paid for. One page of rows per request, filtered in the
 * database; fetched only when the admin opens the panel.
 */

type Db = SupabaseClient;

export interface AdminPaymentFilters {
  provider?: string;
  status?: string;
  campaignStatus?: string;
  currency?: string;
  advertiser?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export interface AdminPaymentRow {
  reference: string;
  provider: string;
  status: string;
  statusReason: string | null;
  usdCents: number;
  providerAmount: number | null;
  providerCurrency: string | null;
  fxMinorPerUsd: number | null;
  paidAmount: number | null;
  paidCurrency: string | null;
  chargeId: string | null;
  createdAt: string;
  verifiedAt: string | null;
  refundedAmount: number | null;
  refundedAt: string | null;
  disputedAt: string | null;
  advertiser: string | null;
  campaigns: { id: string; name: string; status: string; activatedAt: string | null; startAt: string | null; endAt: string | null }[];
}

const STATUSES = ["pending", "success", "failed", "abandoned", "verification_required", "mismatch", "refunded", "partially_refunded", "chargeback", "expired"];
const iso = (v?: string) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

export async function listAdPayments(db: Db, f: AdminPaymentFilters): Promise<{ rows: AdminPaymentRow[]; flags: { kind: string; reference: string | null; campaignId: string | null; detail: string; since: string | null }[] }> {
  let q = db
    .from("ai_topup_attempts")
    .select("reference, user_id, provider, status, status_reason, amount_cents, provider_amount, provider_currency, fx_minor_per_usd, paid_amount, paid_currency, charge_id, item_id, created_at, verified_at, refunded_amount, refunded_at, disputed_at")
    .eq("purpose", "ad_campaign")
    .order("created_at", { ascending: false })
    .limit(Math.min(200, Math.max(1, f.limit ?? 50)));
  if (f.provider === "paystack" || f.provider === "bachs") q = q.eq("provider", f.provider);
  if (f.status && STATUSES.includes(f.status)) q = q.eq("status", f.status);
  if (f.currency && /^[A-Z]{3,6}$/.test(f.currency)) q = q.eq("provider_currency", f.currency);
  if (iso(f.from)) q = q.gte("created_at", iso(f.from)!);
  if (iso(f.to)) q = q.lte("created_at", iso(f.to)!);
  const { data, error } = await q;
  if (error) throw new Error(`ad payments: ${error.message}`);
  const attempts = (data ?? []) as Record<string, unknown>[];

  const apps = [...new Set(attempts.map((a) => a.item_id as string))];
  const { data: camps } = apps.length
    ? await db.from("ad_campaigns").select("id, name, status, application_id, payment_reference, activated_at, start_at, end_at, advertisers(business_name)").in("application_id", apps)
    : { data: [] };
  const byRef = new Map<string, { id: string; name: string; status: string; activatedAt: string | null; startAt: string | null; endAt: string | null; advertiser: string | null }[]>();
  for (const c of (camps ?? []) as unknown as { id: string; name: string; status: string; payment_reference: string | null; activated_at: string | null; start_at: string | null; end_at: string | null; advertisers: { business_name: string } | null }[]) {
    if (!c.payment_reference) continue;
    byRef.set(c.payment_reference, [...(byRef.get(c.payment_reference) ?? []), { id: c.id, name: c.name, status: c.status, activatedAt: c.activated_at, startAt: c.start_at, endAt: c.end_at, advertiser: c.advertisers?.business_name ?? null }]);
  }

  let rows: AdminPaymentRow[] = attempts.map((a) => {
    const cs = byRef.get(a.reference as string) ?? [];
    const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    return {
      reference: a.reference as string,
      provider: a.provider as string,
      status: a.status as string,
      statusReason: (a.status_reason as string | null) ?? null,
      usdCents: Number(a.amount_cents),
      providerAmount: n(a.provider_amount),
      providerCurrency: (a.provider_currency as string | null) ?? null,
      fxMinorPerUsd: n(a.fx_minor_per_usd),
      paidAmount: n(a.paid_amount),
      paidCurrency: (a.paid_currency as string | null) ?? null,
      chargeId: (a.charge_id as string | null) ?? null,
      createdAt: a.created_at as string,
      verifiedAt: (a.verified_at as string | null) ?? null,
      refundedAmount: n(a.refunded_amount),
      refundedAt: (a.refunded_at as string | null) ?? null,
      disputedAt: (a.disputed_at as string | null) ?? null,
      advertiser: cs[0]?.advertiser ?? null,
      campaigns: cs.map(({ advertiser: _a, ...c }) => c),
    };
  });
  if (f.campaignStatus) rows = rows.filter((r) => r.campaigns.some((c) => c.status === f.campaignStatus));
  if (f.advertiser) {
    const needle = f.advertiser.toLowerCase();
    rows = rows.filter((r) => (r.advertiser ?? "").toLowerCase().includes(needle));
  }

  const { data: flags } = await db.rpc("ad_payment_inconsistencies");
  return {
    rows,
    flags: ((flags ?? []) as { kind: string; reference: string | null; campaign_id: string | null; detail: string; since: string | null }[]).map((x) => ({ kind: x.kind, reference: x.reference, campaignId: x.campaign_id, detail: x.detail, since: x.since })),
  };
}

/**
 * Two safe admin actions, both idempotent:
 *   recheck   ask the provider about this payment again (the same path as the
 *             advertiser's verify-on-return - it can only settle what the
 *             provider confirms)
 *   activate  retry activation of campaigns whose payment is verified
 */
export async function adminPaymentAction(db: Db, reference: string, action: "recheck" | "activate"): Promise<unknown> {
  const { data: a } = await db.from("ai_topup_attempts").select("user_id, status, item_id").eq("reference", reference).eq("purpose", "ad_campaign").maybeSingle();
  if (!a) return { ok: false, reason: "not_found" };
  if (action === "recheck") return { ok: true, view: await adPaymentStatus(db, a.user_id as string, reference) };
  if (a.status !== "success") return { ok: false, reason: "not_verified" };
  const { data: camps } = await db.from("ad_campaigns").select("id").eq("application_id", a.item_id).eq("payment_reference", reference).in("status", ["paid", "validating"]);
  await activatePaidCampaigns(db, ((camps ?? []) as { id: string }[]).map((c) => c.id));
  return { ok: true };
}
