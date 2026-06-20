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
    <section id="features" className="border-t border-border/60 py-20">
      <div className="container">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Everything you need, <span className="text-gradient">nothing you don&apos;t</span>
          </h2>
          <p className="mt-3 text-muted-foreground">
            A premium downloading experience engineered for speed, privacy and
            quality.
          </p>
        </Reveal>

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, title, body }, i) => (
            <Reveal key={title} delay={(i % 3) * 0.06}>
              <div className="group h-full rounded-2xl border border-border bg-card p-6 transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-xl">
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary transition-transform duration-300 group-hover:scale-110 group-hover:bg-primary group-hover:text-primary-foreground">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 font-semibold">{title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
