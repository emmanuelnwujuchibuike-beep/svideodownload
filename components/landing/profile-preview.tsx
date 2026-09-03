import {
  BadgeCheck,
  Coins,
  CreditCard,
  Gift,
  Landmark,
  Settings,
  TrendingUp,
  Wallet,
} from "lucide-react";

/**
 * The rewards-profile PREVIEW shown on the /profile page (owner) — the Profile
 * screen from `public/rewardsection.jpg` rebuilt as a responsive page section:
 * balance, earnings overview, how you earn, and withdraw. It sits above the
 * Login/Sign up card, so a signed-out visitor sees what a profile unlocks before
 * signing in.
 *
 * NOTE (honesty): it is clearly labelled a PREVIEW and the figures ("David M.",
 * balances, task points) are illustrative design content — the same illustrative
 * kind the Rewards landing section uses — not a real account. Server component.
 */

/* @sourced illustrative — preview figures for the profile mock, not real account
   data (owner-requested to match public/rewardsection.jpg). */
const EARN = [
  { label: "Daily Check-in", pts: "+20" },
  { label: "Watch Ads", pts: "+10–50" },
  { label: "Invite Friends", pts: "+500" },
  { label: "Save Content", pts: "+5–20" },
  { label: "Create Post", pts: "+10–100" },
];

const WITHDRAW = [
  { icon: CreditCard, label: "PayPal", tint: "text-blue-600" },
  { icon: Wallet, label: "Payoneer", tint: "text-orange-500" },
  { icon: Landmark, label: "Bank Transfer", tint: "text-violet-600" },
];

export function ProfilePreview() {
  return (
    <section className="mx-auto w-full max-w-md">
      <div className="mb-3 flex items-center justify-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/25 bg-violet-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-violet-700 dark:border-violet-400/30 dark:text-violet-200">
          <Coins className="h-3.5 w-3.5" /> Rewards profile · preview
        </span>
      </div>

      <div className="space-y-3 rounded-3xl border border-border/70 bg-card p-4 shadow-card sm:p-5">
        {/* Profile header */}
        <div className="flex items-center gap-3">
          <span className="h-11 w-11 shrink-0 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600" />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1 font-bold">
              David M. <BadgeCheck className="h-4 w-4 text-blue-500" />
              <span className="ml-1 rounded-full bg-violet-500/12 px-2 py-0.5 text-[10px] font-semibold text-violet-600 dark:text-violet-300">Premium</span>
            </span>
            <span className="block text-xs text-muted-foreground">@david.m</span>
          </span>
          <Settings className="h-5 w-5 text-muted-foreground" />
        </div>

        {/* Balance */}
        <div className="rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-700 p-4 text-white">
          <div className="flex items-start justify-between">
            <span>
              <span className="flex items-center gap-1.5 text-2xl font-extrabold">
                <Coins className="h-5 w-5 text-amber-300" /> 12,450
              </span>
              <span className="text-xs text-white/70">Reward Tokens</span>
            </span>
            <span className="text-right">
              <span className="block text-2xl font-extrabold">$124.50</span>
              <span className="text-xs text-white/70">Cash Value</span>
            </span>
          </div>
          <div className="mt-3 flex items-center justify-between rounded-xl bg-white/15 px-3 py-1.5 text-xs">
            <span>100 = $1.00</span>
            <span className="opacity-80">How it works</span>
          </div>
        </div>

        {/* Earnings overview */}
        <div className="rounded-2xl border border-border/70 bg-secondary/20 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold">Earnings Overview</span>
            <span className="text-xs text-muted-foreground">This Month</span>
          </div>
          <div className="mt-2 flex items-end justify-between">
            <span>
              <span className="block text-xl font-extrabold">8,250</span>
              <span className="text-xs text-muted-foreground">Tokens Earned</span>
            </span>
            <span className="text-center">
              <span className="block text-xl font-extrabold">$82.50</span>
              <span className="text-xs text-muted-foreground">Cash Earned</span>
            </span>
            <TrendingUp className="h-8 w-8 text-emerald-500" />
          </div>
        </div>

        {/* How you earn */}
        <div className="rounded-2xl border border-border/70 bg-secondary/20 p-4">
          <div className="mb-2 flex items-center gap-1.5">
            <Gift className="h-4 w-4 text-violet-500" />
            <span className="text-sm font-bold">How You Earn</span>
          </div>
          <ul className="space-y-1.5">
            {EARN.map((e) => (
              <li key={e.label} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{e.label}</span>
                <span className="flex items-center gap-1 font-semibold text-amber-600 dark:text-amber-400">
                  {e.pts} <Coins className="h-3.5 w-3.5" />
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Withdraw */}
        <div className="rounded-2xl border border-border/70 bg-secondary/20 p-4">
          <span className="text-sm font-bold">Withdraw Earnings</span>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {WITHDRAW.map((w) => (
              <div key={w.label} className="flex flex-col items-center gap-1 rounded-xl border border-border/60 bg-card p-2.5 text-center">
                <w.icon className={`h-5 w-5 ${w.tint}`} />
                <span className="text-[10px] font-medium leading-tight">{w.label}</span>
              </div>
            ))}
          </div>
          <span className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 py-2.5 text-sm font-semibold text-white">
            Withdraw Now <Wallet className="h-4 w-4" />
          </span>
        </div>
      </div>
    </section>
  );
}
