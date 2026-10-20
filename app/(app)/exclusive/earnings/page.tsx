import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { EarningsDashboard } from "@/features/sub/earnings-dashboard";
import { earningsOverview, ledgerPage } from "@/lib/sub/earnings";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Earnings", robots: { index: false, follow: false } };

/**
 * /exclusive/earnings — the signed-in creator's own earnings, analytics and history (Frenz
 * Exclusive Part 7). The first view is rendered here on the server (no client fetch on open);
 * every read is the session user's own.
 */
export default async function EarningsRoute() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/exclusive/earnings");
  const [overview, ledger] = await Promise.all([earningsOverview(user.id, 30), ledgerPage(user.id)]);
  return (
    <div className="w-full flex-1 bg-frenz-page">
      <div className="mx-auto w-full max-w-2xl px-4 pt-4" style={{ paddingBottom: "calc(var(--frenz-bottom-nav) + 1rem)" }}>
      {/* step 21 (design/Earnings.dc.html): ‹ Subscriptions, then the large title */}
      <header className="frenz-ui mb-4 text-frenz-ink">
        <Link href="/exclusive/dashboard" className="-ml-1 inline-flex min-h-[44px] items-center gap-0.5 text-[16px] font-bold text-frenz-blue no-underline">
          <ChevronLeft className="h-5 w-5" aria-hidden /> Subscriptions
        </Link>
        <h1 className="m-0 font-heading text-[30px] font-extrabold leading-tight tracking-[-0.8px]">Earnings &amp; analytics</h1>
        <p className="m-0 mt-0.5 text-[13.5px] text-frenz-muted">Your Exclusive income, in US dollars. Only you can see this.</p>
      </header>
      <EarningsDashboard initial={overview.ok ? (({ ok: _ok, ...rest }) => rest)(overview) : null} initialLedger={ledger.ok ? { items: ledger.items, next: ledger.next } : null} />
      </div>
    </div>
  );
}
