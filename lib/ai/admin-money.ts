import "server-only";

import { summarizeAiMoney, type AiMoneySummary, type MoneyCostRow, type MoneyLedgerRow } from "@/lib/ai/admin-money-view";
import { createAdminClient } from "@/lib/supabase/admin";
import { paginatedSelect } from "@/lib/supabase/paginate";

/**
 * The money read for the admin Frenz AI section (credit brief §18). Like the
 * operations read beside it: run only when an admin opens the page — no
 * timer, nothing while nobody looks. PAGINATED (PostgREST stops at 1,000 rows
 * and answers `error: null`), capped, and the cap is reported.
 */
const WINDOW_DAYS = 30;
const CAP = 10_000;

export async function loadAiMoney(centsPerCredit: number): Promise<AiMoneySummary> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  const db = createAdminClient();
  try {
    const [ledger, costs] = await Promise.all([
      paginatedSelect<MoneyLedgerRow>(
        (from, to) =>
          db
            .from("ai_product_ledger")
            .select("user_id, kind, status, delta_cents, currency, created_at, paid_cents:metadata->>paid_cents, tool:snapshot->>product, feature:snapshot->>feature")
            .gte("created_at", since)
            .order("created_at", { ascending: false })
            .range(from, to) as unknown as PromiseLike<{ data: MoneyLedgerRow[] | null; error: { message: string } | null }>,
        CAP,
      ),
      paginatedSelect<MoneyCostRow>(
        (from, to) =>
          db
            .from("ai_jobs")
            .select("feature, status, completed_at, provider_cost_usd_cents:metadata->provider_cost_estimate->>totalUsdCents")
            .gte("created_at", since)
            .eq("status", "completed")
            .order("created_at", { ascending: false })
            .range(from, to) as unknown as PromiseLike<{ data: MoneyCostRow[] | null; error: { message: string } | null }>,
        CAP,
      ),
    ]);
    if (ledger.error || costs.error) console.error("[ai/money] read failed", { ledger: ledger.error?.message, costs: costs.error?.message });
    // a charge names its tool as `product` (lip sync, audio, voice) or `feature` (video)
    const rows = ledger.rows.map((r) => ({ ...r, tool: r.tool ?? (r as { feature?: string | null }).feature ?? null }));
    return summarizeAiMoney(rows, costs.rows, { windowDays: WINDOW_DAYS, centsPerCredit, capped: ledger.capped || costs.capped, unreadable: !!ledger.error });
  } catch (e) {
    console.error("[ai/money] read failed", { error: String(e).slice(0, 200) });
    return summarizeAiMoney([], [], { windowDays: WINDOW_DAYS, centsPerCredit, unreadable: true });
  }
}
