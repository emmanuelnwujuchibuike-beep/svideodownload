"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

import { useSensitiveAction } from "@/features/admin/use-sensitive-action";
import type { FrenzCoinConfig } from "@/lib/coin/config";
import { cn } from "@/lib/utils";

import { CoinSettings } from "./coin-settings";

// each tab's code is fetched the first time it opens; the settings tab is the one that renders first
const CoinWithdrawals = dynamic(() => import("./coin-withdrawals").then((m) => m.CoinWithdrawals), { loading: () => <p className="text-sm text-muted-foreground">Loading…</p> });
const CoinTransfers = dynamic(() => import("./coin-transfers").then((m) => m.CoinTransfers), { loading: () => <p className="text-sm text-muted-foreground">Loading…</p> });
const CoinReversals = dynamic(() => import("./coin-reversals").then((m) => m.CoinReversals), { loading: () => <p className="text-sm text-muted-foreground">Loading…</p> });

type Tab = "settings" | "withdrawals" | "transfers" | "reversals";
const TABS: { id: Tab; label: string }[] = [
  { id: "settings", label: "Settings" },
  { id: "withdrawals", label: "Withdrawals" },
  { id: "transfers", label: "Transfers" },
  { id: "reversals", label: "Deposit reversals" },
];

/**
 * Admin → Frenz Coin (Part 6): configuration, withdrawals, transfer corrections and deposit reversals, on the existing
 * audited APIs only. One password prompt for the whole console (useSensitiveAction): any money route that answers
 * REAUTH_REQUIRED raises it and replays the request once. Tabs keep their state while open; a tab's data is read when
 * it is first opened and when the operator refreshes or acts — never on a timer.
 */
export function CoinAdminConsole({ config, pinConfigured = true }: { config: FrenzCoinConfig; pinConfigured?: boolean }) {
  const { sensitiveFetch, reauthPrompt } = useSensitiveAction();
  const [tab, setTab] = useState<Tab>("settings");
  const [seen, setSeen] = useState<Set<Tab>>(() => new Set(["settings"]));
  const w = config.withdrawals;
  const payoutRateApproved = w.payoutRateSource === "market" || (w.payoutRateSource === "fixed" && !!w.payoutMinorPerUsd);

  const open = (t: Tab) => {
    setTab(t);
    setSeen((s) => (s.has(t) ? s : new Set([...s, t])));
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", config.enabled ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground")}>{config.enabled ? "Live for members" : "Off for members"}</span>
        <span className="text-xs text-muted-foreground">Payout rate: {w.payoutRateSource === "none" ? "none (withdrawals can't be paid)" : w.payoutRateSource === "fixed" ? (w.payoutMinorPerUsd ? `fixed ₦${(w.payoutMinorPerUsd / 100).toFixed(2)} per $1` : "fixed — no rate set") : "market"}</span>
      </div>
      {/* owner, 2026-10-25: "transfer is still saying transfers are paused" — the PIN secret was missing on Vercel and nothing said so */}
      {!pinConfigured ? (
        <p role="alert" className="rounded-2xl bg-rose-500/10 px-4 py-3 text-sm text-rose-800 dark:text-rose-200">
          <strong>Transfers and withdrawals are paused:</strong> the transaction-PIN secret <code>FRENZ_COIN_PIN_PEPPER</code> is not set on the server. Add it in Vercel → Settings → Environment Variables (Production), then redeploy. Set it once and never change it — changing it invalidates every member&apos;s PIN.
        </p>
      ) : null}
      <div role="tablist" aria-label="Frenz Coin admin" className="flex gap-1 overflow-x-auto rounded-2xl border border-border p-1 [scrollbar-width:none]">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" id={`coin-tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`coin-panel-${t.id}`} onClick={() => open(t.id)} className={cn("whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary", tab === t.id ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted")}>
            {t.label}
          </button>
        ))}
      </div>
      {/* opened tabs stay mounted (hidden) so going back to one never refetches or loses a half-filled form */}
      {TABS.filter((t) => seen.has(t.id)).map((t) => (
        <div key={t.id} role="tabpanel" id={`coin-panel-${t.id}`} aria-labelledby={`coin-tab-${t.id}`} hidden={tab !== t.id}>
          {t.id === "settings" ? <CoinSettings config={config} sensitiveFetch={sensitiveFetch} /> : null}
          {t.id === "withdrawals" ? <CoinWithdrawals sensitiveFetch={sensitiveFetch} payoutRateApproved={payoutRateApproved} /> : null}
          {t.id === "transfers" ? <CoinTransfers sensitiveFetch={sensitiveFetch} /> : null}
          {t.id === "reversals" ? <CoinReversals sensitiveFetch={sensitiveFetch} /> : null}
        </div>
      ))}
      {reauthPrompt}
    </div>
  );
}
