import {
  Headphones,
  Infinity as InfinityIcon,
  Layers,
  Lock,
  LogIn,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Zap,
} from "lucide-react";

import { Reveal } from "@/components/ui/reveal";

const features = [
  { icon: LogIn, title: "No Login Required", body: "Start downloading instantly — no account, no email, no friction.", color: "from-blue-600 to-blue-400" },
  { icon: InfinityIcon, title: "Unlimited Downloads", body: "No daily caps on the free tier. Download as much as you need.", color: "from-violet-600 to-violet-400" },
  { icon: Layers, title: "Multi-Platform Support", body: "Every major platform supported through one powerful engine.", color: "from-pink-600 to-rose-400" },
  { icon: Headphones, title: "Audio Extraction", body: "Pull MP3, M4A, AAC or WAV audio from any video.", color: "from-orange-600 to-amber-400" },
  { icon: Sparkles, title: "HD Quality", body: "Up to 4K where the source provides it. No quality compromise.", color: "from-cyan-600 to-sky-400" },
  { icon: Zap, title: "Fast Processing", body: "Edge caching keeps extraction lightning quick every time.", color: "from-yellow-600 to-amber-400" },
  { icon: ShieldCheck, title: "Secure Downloads", body: "Encrypted transfers with no third-party redirects ever.", color: "from-emerald-600 to-green-400" },
  { icon: Smartphone, title: "Mobile Friendly", body: "A responsive, mobile-first experience built for every device.", color: "from-indigo-600 to-blue-400" },
  { icon: Lock, title: "Privacy Focused", body: "We don't store your files or track your links. Zero logging.", color: "from-teal-600 to-cyan-400" },
];

export function Features() {
  return (
    <section id="features" className="relative py-28 sm:py-36">
      {/* Section divider */}
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
      {/* Blue glow — left */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-[3%] top-[15%] -z-10 h-[280px] w-[380px] rounded-full bg-gradient-to-r from-blue-600/10 to-transparent blur-[80px]"
      />
      {/* Gold glow — right */}
      <div
        aria-hidden
        className="pointer-events-none absolute right-[3%] top-[40%] -z-10 h-[240px] w-[340px] rounded-full bg-gradient-to-l from-amber-500/10 to-transparent blur-[75px]"
      />
      {/* Cyan glow — bottom center */}
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-[10%] left-1/2 -z-10 h-[200px] w-[500px] -translate-x-1/2 rounded-full bg-gradient-to-t from-cyan-500/8 to-transparent blur-[70px]"
      />

      <div className="container">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center rounded-full border border-border bg-secondary/60 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Why SVideoDownload
          </span>
          <h2 className="mt-6 text-3xl font-bold tracking-[-0.03em] sm:text-[2.75rem] sm:leading-[1.1]">
            Everything you need,
            <br className="hidden sm:block" /> nothing you don&apos;t
          </h2>
          <p className="mx-auto mt-5 max-w-md text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
            A premium downloading experience engineered for speed, privacy, and
            quality — with zero compromises.
          </p>
        </Reveal>

        <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, title, body, color }, i) => (
            <Reveal key={title} delay={(i % 3) * 0.06}>
              <div className="group relative h-full overflow-hidden rounded-2xl border border-border/70 bg-card p-7 shadow-soft transition-all duration-300 hover:-translate-y-1.5 hover:border-foreground/12 hover:shadow-card">
                {/* Subtle gradient background on hover */}
                <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                  <div className={`absolute -right-8 -top-8 h-32 w-32 rounded-full bg-gradient-to-br ${color} opacity-[0.07] blur-2xl`} />
                </div>

                <div className={`relative inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${color} text-white shadow-md transition-all duration-300 group-hover:scale-110 group-hover:shadow-lg`}>
                  <Icon className="h-[22px] w-[22px]" />
                </div>
                <h3 className="mt-5 text-[15px] font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
