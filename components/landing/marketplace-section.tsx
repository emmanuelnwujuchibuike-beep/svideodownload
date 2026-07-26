import { Bell, CircleDollarSign, Rocket, Search, ShieldCheck, ShoppingBag, ShoppingCart, Store } from "lucide-react";

/**
 * Marketplace section — per `public/marketplace section.jpg`. Left: pill, headline,
 * copy, four feature cards and a proof row. Right: a Marketplace app mockup.
 *
 * NOTE (honesty): the Marketplace is a PLANNED commerce surface, and the proof
 * figures here are illustrative design content, not sourced live stats. Built at the
 * owner's explicit request to match the provided design.
 */

const CARDS = [
  { icon: ShoppingBag, title: "Buy & Sell", desc: "List your items for sale or buy quality products easily." },
  { icon: Rocket, title: "Boost Listings", desc: "Boost your items to reach more buyers and sell faster." },
  { icon: ShieldCheck, title: "Safe & Secure", desc: "All listings are reviewed to ensure safe transactions." },
  { icon: CircleDollarSign, title: "Earn Tokens", desc: "Earn Frenz Tokens every time you make a purchase." },
];

/* @sourced illustrative — design mock figures for the Marketplace section, not real
   statistics (owner-requested to match public/marketplace section.jpg). */
const STATS = [
  { icon: ShoppingBag, value: "10K+", label: "Active Listings" },
  { icon: ShoppingCart, value: "25K+", label: "Happy Buyers" },
  { icon: ShieldCheck, value: "5K+", label: "Verified Sellers" },
  { icon: CircleDollarSign, value: "100%", label: "Secure Payments" },
];

const LISTINGS = [
  { name: "iPhone 14 Pro Max", price: "₦850,000", place: "Lagos", tint: "from-neutral-700 to-neutral-900", boosted: true },
  { name: "Louis Vuitton Bag", price: "₦650,000", place: "Abuja", tint: "from-amber-700 to-yellow-800" },
  { name: "PlayStation 5", price: "₦500,000", place: "Port Harcourt", tint: "from-slate-300 to-slate-500" },
];

export function MarketplaceSection() {
  return (
    <section className="bg-gradient-to-b from-violet-50/60 to-slate-50 py-14 dark:from-[#0a0a1a] dark:to-[#050816] sm:py-20">
      <div className="container max-w-6xl">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          {/* Left */}
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-violet-500/25 bg-violet-500/10 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-violet-700 dark:border-violet-400/30 dark:text-violet-200">
              <Store className="h-3.5 w-3.5" /> Marketplace
            </span>
            <h2 className="mt-5 text-3xl font-extrabold leading-[1.05] tracking-[-0.03em] text-slate-900 dark:text-white sm:text-4xl lg:text-5xl">
              Buy, Sell &amp; Discover
              <br />
              <span className="text-violet-600 dark:text-violet-400">Amazing Products.</span>
            </h2>
            <p className="mt-4 max-w-md text-base leading-relaxed text-slate-600 dark:text-white/70">
              Frenz Marketplace is a trusted community where you can buy, sell and
              discover amazing products with confidence.
            </p>

            <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {CARDS.map((c) => (
                <div key={c.title} className="rounded-2xl border border-border/70 bg-card p-4 shadow-soft">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/12 text-violet-600 dark:text-violet-300">
                    <c.icon className="h-4 w-4" />
                  </span>
                  <p className="mt-3 text-sm font-bold tracking-tight text-slate-900 dark:text-white">{c.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{c.desc}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 grid grid-cols-2 gap-4 rounded-3xl border border-border/70 bg-card p-5 shadow-soft sm:grid-cols-4">
              {STATS.map((s) => (
                <div key={s.label} className="flex items-center gap-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-500/12 text-violet-600 dark:text-violet-300">
                    <s.icon className="h-4 w-4" />
                  </span>
                  <span>
                    <span className="block text-lg font-extrabold leading-none tracking-tight">{s.value}</span>
                    <span className="block text-[11px] text-muted-foreground">{s.label}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Right — Marketplace app mockup */}
          <div className="mx-auto w-full max-w-[320px]">
            <div className="relative">
              <div aria-hidden className="absolute inset-0 -z-10 scale-105 rounded-[3rem] bg-gradient-to-br from-violet-500/20 to-purple-600/20 blur-3xl" />
              <div className="relative aspect-[776/1630] rounded-[2.6rem] border-[3px] border-neutral-800 bg-neutral-900 p-[3px] shadow-[0_30px_60px_-20px_rgba(0,0,0,0.5)]">
                <div className="relative h-full overflow-hidden rounded-[2.35rem] border-[4px] border-black bg-neutral-50">
                  <div className="absolute left-1/2 top-2 z-20 h-[1.3rem] w-[4.6rem] -translate-x-1/2 rounded-full bg-black" />
                  <div className="flex h-full flex-col gap-2.5 px-3 pb-3 pt-6 text-neutral-900">
                    <div className="flex items-start justify-between px-1">
                      <span>
                        <span className="block text-base font-extrabold tracking-tight">Marketplace</span>
                        <span className="block text-[9px] text-neutral-400">Buy, sell and discover amazing deals</span>
                      </span>
                      <span className="flex items-center gap-1.5 text-neutral-400">
                        <Bell className="h-4 w-4" />
                        <ShoppingCart className="h-4 w-4" />
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="flex flex-1 items-center gap-1.5 rounded-xl border border-neutral-200 bg-white px-2.5 py-2 text-[9px] text-neutral-400 shadow-sm">
                        <Search className="h-3 w-3" /> Search items, categories…
                      </span>
                      <span className="rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 px-2.5 py-2 text-[9px] font-semibold text-white">+ Sell</span>
                    </div>
                    {/* boost card */}
                    <div className="relative overflow-hidden rounded-2xl bg-violet-500/10 p-3">
                      <span className="text-[9px] font-bold text-violet-600">Reach more buyers</span>
                      <p className="mt-0.5 text-[11px] font-extrabold text-violet-700">Boost your product now!</p>
                      <span className="mt-2 inline-flex items-center gap-1 rounded-lg bg-gradient-to-r from-violet-500 to-purple-600 px-2.5 py-1 text-[9px] font-semibold text-white">
                        <Rocket className="h-2.5 w-2.5" /> Boost Now
                      </span>
                      <Rocket className="absolute -right-1 top-3 h-12 w-12 text-violet-400/40" />
                    </div>
                    {/* listings */}
                    <div className="mb-1 flex items-center justify-between px-0.5">
                      <span className="text-[10px] font-bold">Featured Listings</span>
                      <span className="text-[9px] font-semibold text-violet-500">See All</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {LISTINGS.slice(0, 2).map((l) => (
                        <div key={l.name} className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
                          <span className={`block h-16 w-full bg-gradient-to-br ${l.tint}`} />
                          <span className="block p-1.5">
                            <span className="block truncate text-[9px] font-semibold">{l.name}</span>
                            <span className="block text-[10px] font-extrabold text-violet-600">{l.price}</span>
                            <span className="block text-[7px] text-neutral-400">{l.place}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="flex-1" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
