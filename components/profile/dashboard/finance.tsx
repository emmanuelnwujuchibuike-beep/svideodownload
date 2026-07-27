import {
  ArrowUpRight,
  BadgeCheck,
  Gift,
  Megaphone,
  Plus,
  Store,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { SoonButton, ViewAll } from "@/components/profile/dashboard/soon";
import { cn } from "@/lib/utils";

/* ── My Wallet ────────────────────────────────────────────────────────────── */
export function MyWallet({ className }: { className?: string }) {
  return (
    <section className={cn("flex flex-col rounded-3xl border border-border/70 bg-card p-5 shadow-card", className)}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-bold">My Wallet</h2>
        <ViewAll feature="Wallet" />
      </div>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Balance</p>
          <p className="mt-1 text-2xl font-extrabold tracking-tight">₦245,000.50</p>
          <p className="mt-0.5 text-xs">
            <span className="font-semibold text-emerald-500">+12.4%</span>{" "}
            <span className="text-muted-foreground">this month</span>
          </p>
        </div>
        {/* Mini card graphic */}
        <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-violet-600 to-indigo-700 p-2.5 text-white shadow-md">
          <span className="block h-3 w-4 rounded-[3px] bg-white/70" />
          <Wallet className="absolute bottom-2 right-2 h-4 w-4 opacity-80" />
          <span className="absolute bottom-2 left-2.5 text-[11px] font-bold tracking-wider">₦</span>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <SoonButton
          feature="Add money"
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-violet-600 py-2.5 text-sm font-semibold text-white shadow-md shadow-violet-500/25 transition hover:opacity-95"
        >
          <Plus className="h-4 w-4" /> Add Money
        </SoonButton>
        <SoonButton
          feature="Withdraw"
          className="inline-flex flex-1 items-center justify-center rounded-xl border border-border py-2.5 text-sm font-semibold transition hover:bg-secondary"
        >
          Withdraw
        </SoonButton>
      </div>
    </section>
  );
}

/* ── Recent transactions ──────────────────────────────────────────────────── */
type Txn = { label: string; time: string; amount: string; positive: boolean; icon: LucideIcon; tile: string };

const TXNS: Txn[] = [
  { label: "Reward Ad Earnings", time: "Today, 10:45 AM", amount: "+₦5,200.00", positive: true, icon: Megaphone, tile: "from-sky-500 to-blue-600" },
  { label: "Marketplace Sale", time: "Today, 09:15 AM", amount: "+₦12,000.00", positive: true, icon: Store, tile: "from-violet-500 to-purple-600" },
  { label: "Withdrawal", time: "Yesterday, 04:30 PM", amount: "-₦20,000.00", positive: false, icon: ArrowUpRight, tile: "from-rose-500 to-red-600" },
  { label: "Referral Bonus", time: "May 25, 11:20 AM", amount: "+₦2,500.00", positive: true, icon: Gift, tile: "from-emerald-500 to-teal-600" },
];

export function RecentTransactions({ className }: { className?: string }) {
  return (
    <section className={cn("rounded-3xl border border-border/70 bg-card p-5 shadow-card", className)}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-bold">Recent Transactions</h2>
        <ViewAll feature="Transactions" />
      </div>
      <ul className="divide-y divide-border/60">
        {TXNS.map((t) => (
          <li key={t.label} className="flex items-center gap-3 py-2.5">
            <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white", t.tile)}>
              <t.icon className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{t.label}</p>
              <p className="truncate text-xs text-muted-foreground">{t.time}</p>
            </div>
            <span className={cn("shrink-0 text-sm font-bold", t.positive ? "text-emerald-500" : "text-rose-500")}>{t.amount}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ── Who to follow ────────────────────────────────────────────────────────── */
type Person = { name: string; handle: string; initials: string; tile: string };

const PEOPLE: Person[] = [
  { name: "Jessica Lee", handle: "jessicalee", initials: "JL", tile: "from-rose-500 to-pink-600" },
  { name: "Daniel Carter", handle: "daniel.carter", initials: "DC", tile: "from-blue-500 to-indigo-600" },
  { name: "Travel With Sam", handle: "travelwithsam", initials: "TS", tile: "from-emerald-500 to-teal-600" },
];

export function WhoToFollow({ className }: { className?: string }) {
  return (
    <section className={cn("rounded-3xl border border-border/70 bg-card p-5 shadow-card", className)}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-bold">Who to Follow</h2>
        <ViewAll feature="Suggestions" href="/friends/discover" />
      </div>
      <ul className="space-y-1">
        {PEOPLE.map((p) => (
          <li key={p.handle} className="flex items-center gap-3 py-2">
            <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-sm font-bold text-white", p.tile)}>
              {p.initials}
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1 truncate text-sm font-semibold">
                {p.name}
                <BadgeCheck className="h-4 w-4 shrink-0 fill-blue-500 text-white" />
              </p>
              <p className="truncate text-xs text-muted-foreground">@{p.handle}</p>
            </div>
            <SoonButton
              feature="Follow"
              className="shrink-0 rounded-lg bg-primary/10 px-3.5 py-1.5 text-sm font-semibold text-primary transition hover:bg-primary/20"
            >
              Follow
            </SoonButton>
          </li>
        ))}
      </ul>
    </section>
  );
}
