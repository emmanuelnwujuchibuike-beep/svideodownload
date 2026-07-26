import { Cloud, Gauge, Layers, MonitorSmartphone, ShieldCheck, Sparkles, Zap } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * The six product features, per `public/newlandingfull.jpg` ("Everything you need.
 * All in one place.") and shown again as the floating cards around the download
 * phone in `public/newlanding.jpg`. Exported so both surfaces render the SAME set
 * and cannot drift.
 */
export interface Feature {
  icon: LucideIcon;
  title: string;
  desc: string;
  tint: string;
}

export const FEATURES: Feature[] = [
  { icon: ShieldCheck, title: "No Watermark", desc: "Download videos without a watermark, in high quality.", tint: "from-sky-500 to-blue-600" },
  { icon: Zap, title: "Ultra Fast", desc: "Blazing-fast servers that deliver at lightning speed.", tint: "from-violet-500 to-purple-600" },
  { icon: Layers, title: "100+ Platforms", desc: "Support for almost every social and media platform you use.", tint: "from-fuchsia-500 to-pink-600" },
  { icon: Gauge, title: "HD Quality", desc: "Download in the highest quality available.", tint: "from-blue-500 to-indigo-600" },
  { icon: ShieldCheck, title: "Privacy First", desc: "We respect your privacy. No data is stored.", tint: "from-emerald-500 to-teal-600" },
  { icon: MonitorSmartphone, title: "Cross Device", desc: "Works perfectly on mobile, tablet and desktop.", tint: "from-amber-500 to-orange-600" },
];

/**
 * "Powerful Features — Everything you need. All in one place." The 6-card grid from
 * the large-screen reference. Server component, zero client JS.
 */
export function FeaturesGrid() {
  return (
    <section id="features" className="container max-w-6xl scroll-mt-24 py-14 sm:py-20">
      <div className="mx-auto max-w-2xl text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/25 bg-violet-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-violet-700 dark:border-violet-400/30 dark:text-violet-200">
          <Sparkles className="h-3.5 w-3.5" /> Powerful Features
        </span>
        <h2 className="mt-4 text-3xl font-extrabold tracking-[-0.03em] text-slate-900 dark:text-white sm:text-4xl">
          Everything you need.{" "}
          <span className="bg-gradient-to-r from-blue-600 to-fuchsia-600 bg-clip-text text-transparent dark:from-blue-400 dark:to-fuchsia-400">
            All in one place.
          </span>
        </h2>
      </div>

      <div className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <div
            key={f.title}
            className="group rounded-3xl border border-border/70 bg-card p-6 shadow-soft transition-all duration-300 hover:-translate-y-1 hover:border-foreground/15 hover:shadow-card"
          >
            <span className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${f.tint} text-white shadow-md transition-transform duration-300 group-hover:scale-110`}>
              {f.title === "HD Quality" ? <span className="text-sm font-extrabold">HD</span> : <f.icon className="h-5 w-5" />}
            </span>
            <h3 className="mt-4 text-lg font-bold tracking-tight text-slate-900 dark:text-white">{f.title}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
