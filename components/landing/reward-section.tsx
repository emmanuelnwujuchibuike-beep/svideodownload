import { ArrowRight, BadgeCheck, Coins, Gift, Landmark, ShieldCheck, Sparkles, TrendingUp, Wallet } from "lucide-react";

/**
 * Reward section — per `public/rewardsection.jpg`. Left: pill, headline, copy, three
 * feature rows and the conversion-rate card. Right: a Rewards profile mockup. Below:
 * the earn → convert → withdraw steps and a "top earners" banner.
 *
 * NOTE (honesty): the token economy shown is illustrative design content
 * (owner-requested to match the provided design), not sourced live figures.
 */

const FEATURES = [
  { icon: Gift, title: "Multiple Ways to Earn", desc: "Complete tasks, invite friends, watch ads and stay active." },
  { icon: Coins, title: "Tokens to Money", desc: "Convert your tokens to real money and withdraw instantly." },
  { icon: ShieldCheck, title: "Secure & Reliable", desc: "Your earnings are safe with fully secure transactions." },
];

/* @sourced illustrative — design mock figures for the Rewards section, not real
   statistics (owner-requested to match public/rewardsection.jpg). */
const EARN = [
  { label: "Daily Check-in", pts: "+20" },
  { label: "Watch Ads", pts: "+10–50" },
  { label: "Invite Friends", pts: "+500" },
  { label: "Download Content", pts: "+5–20" },
  { label: "Create Post", pts: "+10–100" },
];

const STEPS = [
  { icon: Gift, title: "Earn Tokens", desc: "Complete tasks and collect reward tokens." },
  { icon: Coins, title: "Convert", desc: "100 tokens = $1.00 real cash value." },
  { icon: Wallet, title: "Withdraw", desc: "Withdraw to your preferred payment method." },
];

/* @sourced illustrative leaderboard — design mock, not real earners. */
const EARNERS = [
  { name: "Alex T.", amt: "32,450", from: "from-blue-500 to-indigo-600" },
  { name: "Sarah K.", amt: "28,600", from: "from-rose-500 to-pink-600" },
  { name: "John D.", amt: "21,300", from: "from-emerald-500 to-teal-600" },
];

export function RewardSection() {
  return (
    <section className="container max-w-6xl py-14 sm:py-20">
      <div className="grid items-center gap-10 lg:grid-cols-2">
        {/* Left */}
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-blue-500/25 bg-blue-500/10 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-blue-700 dark:border-blue-400/30 dark:text-blue-200">
            <Sparkles className="h-3.5 w-3.5" /> Rewards
          </span>
          <h2 className="mt-5 text-3xl font-extrabold leading-[1.05] tracking-[-0.03em] text-slate-900 dark:text-white sm:text-4xl lg:text-5xl">
            Earn Rewards.
            <br />
            <span className="text-blue-600 dark:text-blue-400">Get Paid.</span>
          </h2>
          <p className="mt-4 max-w-md text-base leading-relaxed text-slate-600 dark:text-white/70">
            Earn reward tokens for your activities and convert them to real cash anytime.
          </p>

          <div className="mt-8 space-y-5">
            {FEATURES.map((f) => (
              <div key={f.title} className="flex gap-3.5">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-500/12 text-blue-600 dark:text-blue-300">
                  <f.icon className="h-5 w-5" />
                </span>
                <span>
                  <span className="block font-bold tracking-tight text-slate-900 dark:text-white">{f.title}</span>
                  <span className="mt-0.5 block max-w-sm text-sm leading-relaxed text-muted-foreground">{f.desc}</span>
                </span>
              </div>
            ))}
          </div>

          <div className="mt-8 inline-flex flex-col rounded-2xl border border-border/70 bg-card p-4 shadow-soft">
            <span className="text-xs text-muted-foreground">Current Rate</span>
            <span className="mt-1 flex items-center gap-1.5 text-xl font-extrabold">
              100 <Coins className="h-4 w-4 text-amber-500" /> ={" "}
              <span className="text-emerald-600 dark:text-emerald-400">$1.00</span>
            </span>
            <span className="mt-0.5 text-[11px] text-muted-foreground">Rate updates every 7 days</span>
          </div>
        </div>

        {/* Right — Rewards profile mockup */}
        <div className="mx-auto w-full max-w-[320px]">
          <div className="relative">
            <div aria-hidden className="absolute inset-0 -z-10 scale-105 rounded-[3rem] bg-gradient-to-br from-blue-500/20 to-violet-600/20 blur-3xl" />
            <div className="relative aspect-[776/1630] rounded-[2.6rem] border-[3px] border-neutral-800 bg-neutral-900 p-[3px] shadow-[0_30px_60px_-20px_rgba(0,0,0,0.5)]">
              <div className="relative h-full overflow-hidden rounded-[2.35rem] border-[4px] border-black bg-neutral-50">
                <div className="absolute left-1/2 top-2 z-20 h-[1.3rem] w-[4.6rem] -translate-x-1/2 rounded-full bg-black" />
                <div className="flex h-full flex-col gap-2 px-3 pb-3 pt-6 text-neutral-900">
                  <span className="px-1 text-base font-extrabold tracking-tight">Profile</span>
                  {/* profile row */}
                  <div className="flex items-center gap-2 px-1">
                    <span className="h-9 w-9 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1 text-[11px] font-bold">David M. <BadgeCheck className="h-3 w-3 text-blue-500" /></span>
                      <span className="block text-[8px] text-neutral-400">@david.m</span>
                    </span>
                    <span className="rounded-full bg-violet-500/12 px-2 py-0.5 text-[8px] font-semibold text-violet-600">Premium</span>
                  </div>
                  {/* balance */}
                  <div className="rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-700 p-3 text-white">
                    <div className="flex items-start justify-between">
                      <span>
                        <span className="flex items-center gap-1 text-lg font-extrabold"><Coins className="h-3.5 w-3.5 text-amber-300" /> 12,450</span>
                        <span className="text-[8px] text-white/70">Reward Tokens</span>
                      </span>
                      <span className="text-right">
                        <span className="block text-lg font-extrabold">$124.50</span>
                        <span className="text-[8px] text-white/70">Cash Value</span>
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between rounded-lg bg-white/15 px-2 py-1 text-[9px]">
                      <span>100 = $1.00</span>
                      <span className="opacity-80">How it works</span>
                    </div>
                  </div>
                  {/* earnings overview */}
                  <div className="rounded-2xl border border-neutral-200 bg-white p-2.5 shadow-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold">Earnings Overview</span>
                      <span className="text-[8px] text-neutral-400">This Month</span>
                    </div>
                    <div className="mt-1.5 flex items-end justify-between">
                      <span>
                        <span className="block text-sm font-extrabold">8,250</span>
                        <span className="text-[8px] text-neutral-400">Tokens Earned</span>
                      </span>
                      <span className="text-right">
                        <span className="block text-sm font-extrabold">$82.50</span>
                        <span className="text-[8px] text-neutral-400">Cash Earned</span>
                      </span>
                      <TrendingUp className="h-6 w-6 text-emerald-500" />
                    </div>
                  </div>
                  {/* how you earn */}
                  <div className="rounded-2xl border border-neutral-200 bg-white p-2.5 shadow-sm">
                    <span className="text-[10px] font-bold">How You Earn</span>
                    <div className="mt-1 space-y-1">
                      {EARN.slice(0, 3).map((e) => (
                        <div key={e.label} className="flex items-center justify-between text-[9px]">
                          <span className="text-neutral-600">{e.label}</span>
                          <span className="font-semibold text-amber-600">{e.pts}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* withdraw */}
                  <div className="mt-auto rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 py-2 text-center text-[10px] font-semibold text-white">
                    Withdraw Now
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Earn → Convert → Withdraw */}
      <div className="mt-12 grid gap-4 rounded-3xl border border-border/70 bg-card p-6 shadow-soft sm:grid-cols-3">
        {STEPS.map((s, i) => (
          <div key={s.title} className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-500/12 text-violet-600 dark:text-violet-300">
              <s.icon className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-sm font-bold text-slate-900 dark:text-white">{s.title}</span>
              <span className="block text-xs text-muted-foreground">{s.desc}</span>
            </span>
            {i < STEPS.length - 1 ? <ArrowRight className="ml-auto hidden h-4 w-4 text-muted-foreground sm:block" /> : null}
          </div>
        ))}
      </div>

      {/* Top earners banner */}
      <div className="mt-4 grid items-center gap-6 overflow-hidden rounded-3xl bg-gradient-to-r from-violet-600 to-indigo-600 p-6 text-white sm:grid-cols-[1fr_auto] sm:p-8">
        <div className="flex flex-wrap items-center gap-6">
          <div>
            <p className="text-lg font-extrabold">Top Earners This Month</p>
            <span className="mt-2 inline-flex rounded-xl bg-white/15 px-4 py-2 text-xs font-semibold">View Leaderboard</span>
          </div>
          <div className="flex gap-4">
            {EARNERS.map((e, i) => (
              <div key={e.name} className="text-center">
                <span className={`relative mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br ${e.from} text-xs font-bold`}>
                  <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-[8px] text-black">{i + 1}</span>
                </span>
                <span className="mt-1 block text-[10px] font-semibold">{e.name}</span>
                <span className="block text-[9px] text-white/70">{e.amt}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-2xl bg-white/10 p-4 text-center">
          <Landmark className="mx-auto h-5 w-5" />
          <p className="mt-1 text-2xl font-extrabold">$24,532</p>
          <p className="text-[11px] text-white/70">Total Paid Out</p>
        </div>
      </div>
    </section>
  );
}
