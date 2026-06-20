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
  { icon: LogIn, title: "No Login Required", body: "Start downloading instantly — no account, no email." },
  { icon: InfinityIcon, title: "Unlimited Downloads", body: "No daily caps. Download as much as you need." },
  { icon: Layers, title: "Multi-Platform Support", body: "1000+ sites supported through one engine." },
  { icon: Headphones, title: "Audio Extraction", body: "Pull MP3, M4A, AAC or WAV from any video." },
  { icon: Sparkles, title: "HD Quality", body: "Up to 4K where the source provides it." },
  { icon: Zap, title: "Fast Processing", body: "Edge caching keeps extraction lightning quick." },
  { icon: ShieldCheck, title: "Secure Downloads", body: "Encrypted transfers, no third-party redirects." },
  { icon: Smartphone, title: "Mobile Friendly", body: "A responsive, mobile-first experience." },
  { icon: Lock, title: "Privacy Focused", body: "We don't store your files or watch your links." },
];

export function Features() {
  return (
    <section id="features" className="border-t border-border/60 py-28 sm:py-36">
      <div className="container">
        <Reveal className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center rounded-full border border-border bg-secondary/50 px-3 py-1 text-xs font-medium text-muted-foreground">
            Why SVideoDownload
          </span>
          <h2 className="mt-5 text-3xl font-semibold tracking-[-0.02em] sm:text-[2.75rem] sm:leading-[1.1]">
            Everything you need,
            <br className="hidden sm:block" /> nothing you don&apos;t
          </h2>
          <p className="mx-auto mt-4 max-w-md text-pretty text-base text-muted-foreground sm:text-lg">
            A premium downloading experience engineered for speed, privacy and
            quality.
          </p>
        </Reveal>

        <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, title, body }, i) => (
            <Reveal key={title} delay={(i % 3) * 0.06}>
              <div className="group h-full rounded-2xl border border-border bg-card p-7 shadow-soft transition-all duration-300 hover:-translate-y-1 hover:border-foreground/15 hover:shadow-card">
                <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary transition-all duration-300 group-hover:scale-105 group-hover:bg-primary group-hover:text-primary-foreground">
                  <Icon className="h-[22px] w-[22px]" />
                </div>
                <h3 className="mt-5 text-[15px] font-semibold">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
