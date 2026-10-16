import { ArrowLeft } from "lucide-react";
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
    <div className="ex-ground w-full flex-1">
      <div className="mx-auto w-full max-w-2xl px-4 pt-4" style={{ paddingBottom: "calc(var(--frenz-bottom-nav) + 1rem)" }}>
      <header className="mb-5 flex items-center gap-3">
        <Link href="/exclusive" aria-label="Back to Exclusive" className="ex-icon-btn -ml-1">
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        <div>
          <h1 className="text-[28px] font-bold leading-tight tracking-[-0.03em]">Earnings</h1>
          <p className="text-[13.5px] text-muted-foreground">Your Exclusive income, in US dollars. Only you can see this.</p>
        </div>
      </header>
      <EarningsDashboard initial={overview.ok ? (({ ok: _ok, ...rest }) => rest)(overview) : null} initialLedger={ledger.ok ? { items: ledger.items, next: ledger.next } : null} />
      </div>
    </div>
  );
}
