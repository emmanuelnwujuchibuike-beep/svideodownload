/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  FRENZ AI MONEY — what came in, what was spent, what went back (pure)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Credit brief §18: "Admin should also be able to view: AI credit usage ·
 * top-ups · AI revenue · credit consumption · failed jobs · refunds ·
 * feature usage · user usage · cost/revenue metrics." Failed jobs already
 * live on the operations panel (lib/ai/admin-ops*); this is the money side,
 * read from the one wallet ledger (`ai_product_ledger`) and, for cost, the
 * jobs' own provider-cost estimates.
 *
 * Only rows in the wallet's CREDIT unit (0184) are summed; dollar rows from
 * before the switch are counted separately and never mixed into a credit
 * figure. Revenue is the USD a top-up actually settled (`metadata.paid_cents`
 * written by the verified credit); a top-up without it is counted, not guessed.
 */
export interface MoneyLedgerRow {
  user_id: string;
  kind: string;
  status: string;
  delta_cents: number | string;
  currency: string;
  created_at: string;
  paid_cents?: number | string | null;
  /** snapshot->>product ?? snapshot->>feature — which tool a charge paid for. */
  tool?: string | null;
}

export interface MoneyCostRow {
  feature: string;
  status: string;
  provider_cost_usd_cents?: number | string | null;
  completed_at: string | null;
}

export interface AiMoneySummary {
  windowDays: number;
  capped: boolean;
  unreadable: boolean;
  centsPerCredit: number;
  topups: { count: number; credits: number; bonusCredits: number; revenueUsdCents: number; withoutPaidAmount: number };
  consumption: { settledCredits: number; reservedCredits: number; jobs: number };
  refunds: { count: number; credits: number };
  adjustments: { count: number; netCredits: number };
  /** 0193: member-to-member transfers — how many, credits moved, fees taken. */
  transfers: { count: number; credits: number; fees: number };
  /** Settled credits by tool, largest first. */
  byFeature: { tool: string; credits: number; jobs: number }[];
  /** The five members who spent the most credits (ids only — the panel links them). */
  topUsers: { userId: string; credits: number }[];
  /** Provider cost estimate (USD cents) of completed jobs in the window, and how many had one. */
  providerCost: { usdCents: number; jobs: number; withEstimate: number };
  /** Credits spent valued at the credit rate, minus the provider estimate — null when no job carried an estimate (never a fake margin). */
  estimatedMarginUsdCents: number | null;
  legacyMoneyRows: number;
}

const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(x) ? x : 0;
};

export function summarizeAiMoney(ledger: readonly MoneyLedgerRow[], costs: readonly MoneyCostRow[], opts: { windowDays: number; centsPerCredit: number; capped?: boolean; unreadable?: boolean }): AiMoneySummary {
  const s: AiMoneySummary = {
    windowDays: opts.windowDays,
    capped: !!opts.capped,
    unreadable: !!opts.unreadable,
    centsPerCredit: opts.centsPerCredit,
    topups: { count: 0, credits: 0, bonusCredits: 0, revenueUsdCents: 0, withoutPaidAmount: 0 },
    consumption: { settledCredits: 0, reservedCredits: 0, jobs: 0 },
    refunds: { count: 0, credits: 0 },
    adjustments: { count: 0, netCredits: 0 },
    transfers: { count: 0, credits: 0, fees: 0 },
    byFeature: [],
    topUsers: [],
    providerCost: { usdCents: 0, jobs: 0, withEstimate: 0 },
    estimatedMarginUsdCents: null,
    legacyMoneyRows: 0,
  };
  const byTool = new Map<string, { credits: number; jobs: number }>();
  const byUser = new Map<string, number>();
  for (const r of ledger) {
    if (r.currency !== "CREDIT") {
      s.legacyMoneyRows += 1;
      continue;
    }
    const delta = n(r.delta_cents);
    switch (r.kind) {
      case "recharge": {
        s.topups.count += 1;
        s.topups.credits += delta;
        const paid = n(r.paid_cents);
        if (paid > 0) s.topups.revenueUsdCents += paid;
        else s.topups.withoutPaidAmount += 1;
        break;
      }
      case "bonus":
        s.topups.bonusCredits += delta;
        break;
      case "processing_charge": {
        const credits = -delta;
        // a refunded charge was given back — the refund row says so; count only what stands
        if (r.status === "reserved") s.consumption.reservedCredits += credits;
        else if (r.status === "settled") {
          s.consumption.settledCredits += credits;
          s.consumption.jobs += 1;
          const tool = r.tool || "unknown";
          const t = byTool.get(tool) ?? { credits: 0, jobs: 0 };
          t.credits += credits;
          t.jobs += 1;
          byTool.set(tool, t);
          byUser.set(r.user_id, (byUser.get(r.user_id) ?? 0) + credits);
        }
        break;
      }
      case "refund":
        s.refunds.count += 1;
        s.refunds.credits += delta;
        break;
      case "adjustment":
      case "grant":
      case "reversal":
        s.adjustments.count += 1;
        s.adjustments.netCredits += delta;
        break;
      case "transfer_out":
        s.transfers.count += 1;
        s.transfers.credits += -delta;
        break;
      case "transfer_fee":
        s.transfers.fees += -delta;
        break;
    }
  }
  s.byFeature = [...byTool.entries()].map(([tool, v]) => ({ tool, ...v })).sort((a, b) => b.credits - a.credits);
  s.topUsers = [...byUser.entries()].map(([userId, credits]) => ({ userId, credits })).sort((a, b) => b.credits - a.credits).slice(0, 5);
  for (const c of costs) {
    if (c.status !== "completed") continue;
    s.providerCost.jobs += 1;
    const cost = n(c.provider_cost_usd_cents);
    if (cost > 0) {
      s.providerCost.withEstimate += 1;
      s.providerCost.usdCents += cost;
    }
  }
  s.estimatedMarginUsdCents = s.providerCost.withEstimate > 0 ? Math.round(s.consumption.settledCredits * opts.centsPerCredit - s.providerCost.usdCents) : null;
  return s;
}
